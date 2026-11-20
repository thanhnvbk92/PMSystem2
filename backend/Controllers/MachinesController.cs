using Microsoft.AspNetCore.Mvc;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers;

public sealed record StandardVersionRequest(string? Version);

/// <summary>PC monitoring: state of every Backup_Log2 PC and the standard Backup_Log2 version.</summary>
[ApiController]
[Route("api/v1/machines")]
[Route("api/machines")]
public sealed class MachinesController : ControllerBase
{
    private readonly MachineStatusService _machines;

    public MachinesController(MachineStatusService machines) => _machines = machines;

    /// <summary>
    /// The standard version is the highest version the PCs report (automatic), unless one is set by hand
    /// on the PC overview page (override). standardVersionSource: "manual" | "auto" | null (no data).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var machines = await _machines.GetAllAsync();
        var manual = await _machines.GetSettingAsync(MachineStatusService.StandardVersionKey);
        var latest = LatestReportedVersion(machines);
        var standard = !string.IsNullOrWhiteSpace(manual) ? manual : latest;
        return Ok(new
        {
            machines,
            standardVersion = standard,
            standardVersionSource = !string.IsNullOrWhiteSpace(manual) ? "manual" : latest != null ? "auto" : null,
            latestReportedVersion = latest,
            manualStandardVersion = manual,
            offlineAfterSeconds = (int)MachineStatusService.OfflineAfter.TotalSeconds,
            serverTime = DateTime.Now
        });
    }

    /// <summary>Highest Backup_Log2 version reported by the PCs (old builds report a fixed one and are skipped).</summary>
    private static string? LatestReportedVersion(IEnumerable<MachineStatusDto> machines) => machines
        .Where(m => !m.IsLegacy && !string.IsNullOrWhiteSpace(m.AppVersion))
        .Select(m => Version.TryParse(m.AppVersion!.Trim(), out var v) ? (Version: v, Text: m.AppVersion.Trim()) : default)
        .Where(x => x.Version != null)
        .OrderByDescending(x => x.Version)
        .Select(x => x.Text)
        .FirstOrDefault();

    /// <summary>
    /// Server clock with its offset ("2026-11-20T07:00:00+07:00"). Backup_Log2 sets the PC clock to this
    /// wall clock (07:00) at start-up and on the time.sync command, keeping the PC time zone.
    /// </summary>
    [HttpGet("time")]
    public IActionResult GetTime() => Ok(new { serverTime = DateTimeOffset.Now });

    [HttpGet("standard-version")]
    public async Task<IActionResult> GetStandardVersion() =>
        Ok(new { version = await _machines.GetSettingAsync(MachineStatusService.StandardVersionKey) });

    [HttpPut("standard-version")]
    public async Task<IActionResult> SetStandardVersion([FromBody] StandardVersionRequest request)
    {
        var version = request.Version?.Trim();
        if (!string.IsNullOrEmpty(version) && !Version.TryParse(version, out _))
            return BadRequest(new { message = "Version không hợp lệ, ví dụ đúng: 2.0.6.144" });
        await _machines.SetSettingAsync(MachineStatusService.StandardVersionKey, version);
        return Ok(new { version = string.IsNullOrEmpty(version) ? null : version });
    }

    /// <summary>Removes a PC that is no longer used (it comes back by itself if it connects again).</summary>
    [HttpDelete("{mac}")]
    public async Task<IActionResult> Delete(string mac) =>
        await _machines.DeleteAsync(mac) > 0 ? Ok(new { deleted = true }) : NotFound();
}
