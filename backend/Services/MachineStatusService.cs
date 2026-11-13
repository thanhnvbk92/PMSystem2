using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services;

/// <summary>Telemetry a Backup_Log2 PC reports (fields are optional: old builds send only a few).</summary>
public sealed class MachineTelemetryInput
{
    public string MacAddress { get; init; } = string.Empty;
    public int? ChannelId { get; init; }
    public string? CurrentModel { get; init; }
    public string? AppVersion { get; init; }
    public string? Status { get; init; }
    public int TelemetryVersion { get; init; }
    public string? Hostname { get; init; }
    public string? IpAddress { get; init; }
    public string? OsVersion { get; init; }
    public double? CpuPercent { get; init; }
    public int? RamTotalMb { get; init; }
    public int? RamUsedMb { get; init; }
    public string? DiskDrive { get; init; }
    public double? DiskTotalGb { get; init; }
    public double? DiskFreeGb { get; init; }
    public DateTime? AppStartedAt { get; init; }
    public DateTime? LastUploadAt { get; init; }
    public string? LogType { get; init; }
    public string? LogFolders { get; init; }
}

/// <summary>One PC as shown on the PC monitoring page.</summary>
public sealed record MachineStatusDto(
    string MacKey, string? MacAddress, int? ChannelId, bool IsOnline, bool IsConnected, bool IsLegacy,
    string? Hostname, string? IpAddress, string? OsVersion, string? AppVersion, string? CurrentModel,
    string? LogType, string? LogFolders, string? AppStatus, double? CpuPercent, int? RamTotalMb, int? RamUsedMb,
    string? DiskDrive, double? DiskTotalGb, double? DiskFreeGb, DateTime? AppStartedAt, DateTime? LastUploadAt,
    DateTime? ConnectedAt, DateTime? DisconnectedAt, DateTime? LastSeenAt, DateTime? LastTelemetryAt);

/// <summary>
/// Keeps the latest state of each Backup_Log2 PC in <c>machine_status</c>.
/// Online = SignalR connection open AND (telemetry within <see cref="OfflineAfter"/>, or an old build
/// that only reports once per connection). A closed connection makes the PC offline immediately.
/// Times are stored as server local time (the database reads DateTime parameters as local wall time).
/// </summary>
public sealed class MachineStatusService
{
    public static readonly TimeSpan OfflineAfter = TimeSpan.FromMinutes(3);
    public const string StandardVersionKey = "backuplog.standard_version";

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MachineStatusService> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public MachineStatusService(IServiceScopeFactory scopeFactory, ILogger<MachineStatusService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <summary>"00:19:0F:41:EB:9F" / "00-19-0f-41-eb-9f" -> "00190F41EB9F".</summary>
    public static string? MacKey(string? mac)
    {
        if (string.IsNullOrWhiteSpace(mac)) return null;
        var key = new string(mac.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
        return key.Length == 0 || key.Length > 32 ? null : key;
    }

    private static DateTime? Local(DateTime? value) => value switch
    {
        null => null,
        { Kind: DateTimeKind.Utc } v => v.ToLocalTime(),
        { } v => v
    };

    private static string? Cut(string? text, int max) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Trim().Length <= max ? text.Trim() : text.Trim()[..max];

    private async Task<MachineStatusDto?> UpdateAsync(string? mac, Action<MachineStatusEntry, DateTime> change)
    {
        var key = MacKey(mac);
        if (key == null) return null;
        await _gate.WaitAsync();
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entry = await db.MachineStatus.FirstOrDefaultAsync(m => m.MacKey == key);
            if (entry == null)
            {
                entry = new MachineStatusEntry { MacKey = key };
                db.MachineStatus.Add(entry);
            }
            entry.MacAddress = Cut(mac, 50);
            change(entry, DateTime.Now);
            await db.SaveChangesAsync();
            return ToDto(entry, DateTime.Now);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[MachineStatus] Cannot save state of MAC {Mac}", mac);
            return null;
        }
        finally { _gate.Release(); }
    }

    public Task<MachineStatusDto?> MarkConnectedAsync(string? mac, int? channelId) =>
        UpdateAsync(mac, (m, now) =>
        {
            m.IsConnected = true;
            m.ConnectedAt = now;
            m.LastSeenAt = now;
            if (channelId is > 0) m.ChannelId = channelId;
        });

    /// <summary>Called when a connection closes; the PC stays online if it still has another connection.</summary>
    public Task<MachineStatusDto?> MarkDisconnectedAsync(string? mac, bool stillConnected) =>
        UpdateAsync(mac, (m, now) =>
        {
            m.IsConnected = stillConnected;
            if (!stillConnected) m.DisconnectedAt = now;
        });

    public Task<MachineStatusDto?> SaveTelemetryAsync(MachineTelemetryInput t) =>
        UpdateAsync(t.MacAddress, (m, now) =>
        {
            m.IsConnected = true;
            m.LastSeenAt = now;
            m.LastTelemetryAt = now;
            if (t.ChannelId is > 0) m.ChannelId = t.ChannelId;
            m.CurrentModel = Cut(t.CurrentModel, 200) ?? m.CurrentModel;
            m.AppStatus = Cut(t.Status, 50) ?? m.AppStatus;
            // Builds before telemetry version 2 report a fixed "2.0.0": do not show it as their version.
            m.IsLegacy = t.TelemetryVersion < 2;
            if (m.IsLegacy) return;
            // A value missing from one report (e.g. CPU on the first sample) keeps the previous one.
            m.AppVersion = Cut(t.AppVersion, 50) ?? m.AppVersion;
            m.Hostname = Cut(t.Hostname, 100) ?? m.Hostname;
            m.IpAddress = Cut(t.IpAddress, 200) ?? m.IpAddress;
            m.OsVersion = Cut(t.OsVersion, 200) ?? m.OsVersion;
            m.CpuPercent = t.CpuPercent ?? m.CpuPercent;
            m.RamTotalMb = t.RamTotalMb ?? m.RamTotalMb;
            m.RamUsedMb = t.RamUsedMb ?? m.RamUsedMb;
            m.DiskDrive = Cut(t.DiskDrive, 20) ?? m.DiskDrive;
            m.DiskTotalGb = t.DiskTotalGb ?? m.DiskTotalGb;
            m.DiskFreeGb = t.DiskFreeGb ?? m.DiskFreeGb;
            m.AppStartedAt = Local(t.AppStartedAt) ?? m.AppStartedAt;
            m.LastUploadAt = Local(t.LastUploadAt) ?? m.LastUploadAt;
            m.LogType = Cut(t.LogType, 200) ?? m.LogType;
            m.LogFolders = string.IsNullOrWhiteSpace(t.LogFolders) ? m.LogFolders : t.LogFolders.Trim();
        });

    public async Task<List<MachineStatusDto>> GetAllAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.Now;
        var rows = await db.MachineStatus.AsNoTracking().ToListAsync();
        return rows.Select(r => ToDto(r, now)).OrderBy(r => r.ChannelId ?? int.MaxValue).ThenBy(r => r.MacKey).ToList();
    }

    public async Task<int> DeleteAsync(string mac)
    {
        var key = MacKey(mac);
        if (key == null) return 0;
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.MachineStatus.Where(m => m.MacKey == key).ExecuteDeleteAsync();
    }

    public async Task<string?> GetSettingAsync(string key)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return (await db.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key))?.Value;
    }

    public async Task SetSettingAsync(string key, string? value)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var setting = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting == null) db.AppSettings.Add(setting = new AppSetting { Key = key });
        setting.Value = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        setting.UpdatedAt = DateTime.Now;
        await db.SaveChangesAsync();
    }

    private static MachineStatusDto ToDto(MachineStatusEntry m, DateTime now)
    {
        var fresh = m.LastSeenAt is { } seen && now - Local(seen)!.Value <= OfflineAfter;
        var online = m.IsConnected && (m.IsLegacy || fresh);
        return new MachineStatusDto(m.MacKey, m.MacAddress, m.ChannelId, online, m.IsConnected, m.IsLegacy,
            m.Hostname, m.IpAddress, m.OsVersion, m.AppVersion, m.CurrentModel, m.LogType, m.LogFolders, m.AppStatus,
            m.CpuPercent, m.RamTotalMb, m.RamUsedMb, m.DiskDrive, m.DiskTotalGb, m.DiskFreeGb,
            Local(m.AppStartedAt), Local(m.LastUploadAt), Local(m.ConnectedAt), Local(m.DisconnectedAt),
            Local(m.LastSeenAt), Local(m.LastTelemetryAt));
    }
}
