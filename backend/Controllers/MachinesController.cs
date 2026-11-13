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

    [HttpGet]
    public async Task<IActionResult> GetAll() => Ok(new
    {
        machines = await _machines.GetAllAsync(),
        standardVersion = await _machines.GetSettingAsync(MachineStatusService.StandardVersionKey),
        offlineAfterSeconds = (int)MachineStatusService.OfflineAfter.TotalSeconds,
        serverTime = DateTime.Now
    });

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
