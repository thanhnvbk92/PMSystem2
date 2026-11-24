using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers;

/// <summary>
/// Disk clean-up of the Backup_Log2 PCs: one set of rules for every PC (settings page), and the
/// report each PC sends after a check (which rules applied, files and space freed, drives still full).
/// </summary>
[ApiController]
[Route("api/v1/disk-cleanup")]
[Route("api/disk-cleanup")]
public sealed class DiskCleanupController : ControllerBase
{
    public const string ConfigKey = "diskcleanup.config";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly AppDbContext _db;
    private readonly MachineStatusService _machines;
    private readonly IHubContext<CommandHub, ICommandClient> _commandHub;
    private readonly IHubContext<ProductionHub, IProductionClient> _productionHub;
    private readonly ILogger<DiskCleanupController> _logger;

    public DiskCleanupController(AppDbContext db, MachineStatusService machines,
        IHubContext<CommandHub, ICommandClient> commandHub,
        IHubContext<ProductionHub, IProductionClient> productionHub,
        ILogger<DiskCleanupController> logger)
    {
        _db = db;
        _machines = machines;
        _commandHub = commandHub;
        _productionHub = productionHub;
        _logger = logger;
    }

    // ---------------------------------------------------------------- settings

    [HttpGet("config")]
    public async Task<ActionResult<DiskCleanupConfig>> GetConfig() => Ok(await LoadConfigAsync());

    [HttpPut("config")]
    public async Task<IActionResult> SaveConfig([FromBody] DiskCleanupConfig config)
    {
        var error = Validate(config);
        if (error != null) return BadRequest(new { message = error });

        config.UpdatedAt = DateTime.Now;
        await _machines.SetSettingAsync(ConfigKey, JsonSerializer.Serialize(config, Json));

        // Every connected PC reads the settings again (older builds ignore the message).
        try { await _commandHub.Clients.Group("AllCommandClients").NotifyDiskCleanupUpdated(); }
        catch (Exception ex) { _logger.LogWarning(ex, "[DiskCleanup] Cannot notify the PCs"); }

        return Ok(config);
    }

    private async Task<DiskCleanupConfig> LoadConfigAsync()
    {
        var json = await _machines.GetSettingAsync(ConfigKey);
        if (string.IsNullOrWhiteSpace(json)) return new DiskCleanupConfig();
        try { return JsonSerializer.Deserialize<DiskCleanupConfig>(json, Json) ?? new DiskCleanupConfig(); }
        catch (JsonException) { return new DiskCleanupConfig(); }
    }

    private static string? Validate(DiskCleanupConfig config)
    {
        if (config.TriggerUsedPercent is < 1 or > 99) return "Ngưỡng bắt đầu xóa phải từ 1 đến 99%.";
        if (config.OkUsedPercent < 1 || config.OkUsedPercent >= config.TriggerUsedPercent)
            return "Ngưỡng OK phải nhỏ hơn ngưỡng bắt đầu xóa.";
        if (config.CheckIntervalMinutes is < 1 or > 1440) return "Chu kỳ kiểm tra phải từ 1 đến 1440 phút.";

        config.Rules ??= new();
        var ids = new HashSet<string>();
        for (var i = 0; i < config.Rules.Count; i++)
        {
            var rule = config.Rules[i];
            var label = $"Quy tắc {i + 1}";
            rule.Folder = (rule.Folder ?? string.Empty).Trim();
            if (rule.Folder.Length == 0) return $"{label}: chưa nhập thư mục.";
            var bare = rule.Folder.TrimEnd('\\', '/');
            if (bare.Length <= 2 && bare.EndsWith(':')) return $"{label}: không được xóa ở gốc ổ ({rule.Folder}).";
            if (rule.Folder.StartsWith(@"\\")) return $"{label}: không hỗ trợ thư mục mạng.";

            rule.Pattern = string.IsNullOrWhiteSpace(rule.Pattern) ? "*" : rule.Pattern.Trim();
            rule.Mode = string.Equals(rule.Mode, DiskCleanupModes.DeleteAll, StringComparison.OrdinalIgnoreCase) ? DiskCleanupModes.DeleteAll
                : string.Equals(rule.Mode, DiskCleanupModes.KeepNewest, StringComparison.OrdinalIgnoreCase) ? DiskCleanupModes.KeepNewest
                : DiskCleanupModes.OldestFirst;
            if (rule.KeepDays is < 0 or > 3650) return $"{label}: số ngày giữ lại phải từ 0 đến 3650.";
            rule.Name = string.IsNullOrWhiteSpace(rule.Name) ? rule.Folder : rule.Name.Trim();
            if (string.IsNullOrWhiteSpace(rule.Id) || !ids.Add(rule.Id)) rule.Id = Guid.NewGuid().ToString("N");
            ids.Add(rule.Id);
        }
        return null;
    }

    // ---------------------------------------------------------------- reports

    /// <summary>Latest report of every PC.</summary>
    [HttpGet("reports")]
    public async Task<IActionResult> GetReports()
    {
        var rows = await _db.DiskCleanupReports.AsNoTracking().OrderBy(r => r.MacKey).ToListAsync();
        return Ok(rows.Select(r => new
        {
            r.MacKey,
            r.MacAddress,
            r.Hostname,
            r.Kind,
            r.RanAt,
            r.ReceivedAt,
            r.Warning,
            r.LastCleanupAt,
            r.LastCleanupFiles,
            r.LastCleanupBytes,
            report = ParseOrNull(r.ReportJson)
        }));
    }

    /// <summary>Sent by Backup_Log2 after every check and every "Dọn ngay".</summary>
    [HttpPost("reports")]
    public async Task<IActionResult> PostReport([FromBody] JsonElement report)
    {
        if (report.ValueKind != JsonValueKind.Object) return BadRequest(new { message = "Report must be a JSON object." });
        var mac = Str(report, "macAddress");
        var key = MachineStatusService.MacKey(mac);
        if (key == null) return BadRequest(new { message = "macAddress is required." });

        var kind = Str(report, "kind") ?? "auto";
        if (kind == "preview") return Ok(new { saved = false });
        var warning = Str(report, "warning");
        var files = Int(report, "totalFiles");
        var bytes = Long(report, "totalBytes");
        var now = DateTime.Now;

        var entry = await _db.DiskCleanupReports.FirstOrDefaultAsync(r => r.MacKey == key);
        if (entry == null) _db.DiskCleanupReports.Add(entry = new DiskCleanupReportEntry { MacKey = key });
        entry.MacAddress = Cut(mac, 50);
        entry.Hostname = Cut(Str(report, "hostname"), 100);
        entry.Kind = Cut(kind, 20);
        entry.RanAt = TryGet(report, "ranAt", out var ranAt) && ranAt.TryGetDateTime(out var ran) ? ran : now;
        entry.ReceivedAt = now;
        entry.ReportJson = report.GetRawText();
        entry.Warning = warning;
        if (files > 0)
        {
            entry.LastCleanupAt = now;
            entry.LastCleanupFiles = files;
            entry.LastCleanupBytes = bytes;
        }
        await _db.SaveChangesAsync();

        if (!string.IsNullOrWhiteSpace(warning))
        {
            await _productionHub.Clients.All.ReceiveMachineAlert(new MachineAlertDto
            {
                MacAddress = mac!,
                AlertType = "DiskFull",
                Severity = "Warning",
                Message = $"Dọn ổ cứng chưa đủ: {warning}",
                Timestamp = DateTime.UtcNow
            });
        }
        return Ok(new { saved = true });
    }

    [HttpDelete("reports/{mac}")]
    public async Task<IActionResult> DeleteReport(string mac)
    {
        var key = MachineStatusService.MacKey(mac);
        if (key == null) return NotFound();
        var deleted = await _db.DiskCleanupReports.Where(r => r.MacKey == key).ExecuteDeleteAsync();
        return deleted > 0 ? Ok(new { deleted = true }) : NotFound();
    }

    private static JsonElement? ParseOrNull(string json)
    {
        try { return JsonSerializer.Deserialize<JsonElement>(json); }
        catch (JsonException) { return null; }
    }

    private static bool TryGet(JsonElement e, string name, out JsonElement value)
    {
        foreach (var p in e.EnumerateObject())
        {
            if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)) { value = p.Value; return true; }
        }
        value = default;
        return false;
    }

    private static string? Str(JsonElement e, string name) =>
        TryGet(e, name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int Int(JsonElement e, string name) =>
        TryGet(e, name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;

    private static long Long(JsonElement e, string name) =>
        TryGet(e, name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;

    private static string? Cut(string? text, int max) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Trim().Length <= max ? text.Trim() : text.Trim()[..max];
}
