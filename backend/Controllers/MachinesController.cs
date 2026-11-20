using Microsoft.AspNetCore.Mvc;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers;

/// <summary>PC monitoring: state of every Backup_Log2 PC and the standard Backup_Log2 version.</summary>
[ApiController]
[Route("api/v1/machines")]
[Route("api/machines")]
public sealed class MachinesController : ControllerBase
{
    private readonly MachineStatusService _machines;

    public MachinesController(MachineStatusService machines) => _machines = machines;

    /// <summary>The standard version is always the highest version the PCs report (no manual value).</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var machines = await _machines.GetAllAsync();
        return Ok(new
        {
            machines,
            standardVersion = LatestReportedVersion(machines),
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

    /// <summary>Standard version (highest version the PCs report).</summary>
    [HttpGet("standard-version")]
    public async Task<IActionResult> GetStandardVersion() =>
        Ok(new { version = LatestReportedVersion(await _machines.GetAllAsync()) });

    /// <summary>Removes a PC that is no longer used (it comes back by itself if it connects again).</summary>
    [HttpDelete("{mac}")]
    public async Task<IActionResult> Delete(string mac) =>
        await _machines.DeleteAsync(mac) > 0 ? Ok(new { deleted = true }) : NotFound();
}
