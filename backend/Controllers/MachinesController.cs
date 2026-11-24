using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers;

public sealed record AssignChannelRequest(int ChannelId);

/// <summary>PC monitoring: state of every Backup_Log2 PC and the standard Backup_Log2 version.</summary>
[ApiController]
[Route("api/v1/machines")]
[Route("api/machines")]
public sealed class MachinesController : ControllerBase
{
    private readonly MachineStatusService _machines;
    private readonly AppDbContext _db;
    private readonly IMasterDataService _masterData;
    private readonly IHubContext<CommandHub, ICommandClient> _commandHub;

    public MachinesController(MachineStatusService machines, AppDbContext db, IMasterDataService masterData,
        IHubContext<CommandHub, ICommandClient> commandHub)
    {
        _machines = machines;
        _db = db;
        _masterData = masterData;
        _commandHub = commandHub;
    }

    /// <summary>
    /// Puts a PC on a channel in one step, in the safe order: the PC's MAC (and its IP) are removed
    /// from every other channel (e.g. the "New Chanel-..." one it created, or its previous line), then
    /// set on the target channel; the PC that was on the target channel is detached. No channel is
    /// deleted, so no data is lost. Refused, without any change, when the PC's IP belongs to another
    /// real channel (the server would block the PC on an IP conflict).
    /// Backup_Log2 takes the new channel when it starts (restart it after this call).
    /// </summary>
    [HttpPost("{mac}/assign")]
    public async Task<IActionResult> AssignToChannel(string mac, [FromBody] AssignChannelRequest request)
    {
        var key = MachineStatusService.MacKey(mac);
        if (key == null) return BadRequest(new { message = "MAC không hợp lệ." });
        var target = await _db.Channels.FirstOrDefaultAsync(c => c.Id == request.ChannelId);
        if (target == null) return NotFound(new { message = $"Không có channel #{request.ChannelId}." });

        var pc = (await _machines.GetAllAsync()).FirstOrDefault(m => m.MacKey == key);
        // Same text the PC sends (the server matches the PC by it).
        var macText = !string.IsNullOrWhiteSpace(pc?.MacAddress) ? pc!.MacAddress!.Trim() : mac.Trim();
        var ip = string.IsNullOrWhiteSpace(pc?.ConnectedIp) ? null : pc!.ConnectedIp!.Trim();

        var channels = await _db.Channels.ToListAsync();
        static bool SameIp(string? a, string? b) => !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) &&
            string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
        var holders = channels.Where(c => c.Id != target.Id && MachineStatusService.MacKey(c.MacAddress) == key).ToList();
        var ipOwner = ip == null ? null : channels.FirstOrDefault(c => c.Id != target.Id && !holders.Contains(c) && SameIp(c.IpAddress, ip));
        if (ipOwner != null)
            return Conflict(new
            {
                message = $"IP {ip} của PC đang thuộc channel #{ipOwner.Id} \"{ipOwner.Name}\". " +
                          "Sửa IP của channel đó trong Master Data trước, rồi gắn lại."
            });

        var previousKey = MachineStatusService.MacKey(target.MacAddress);
        var detachedMac = previousKey != null && previousKey != key ? target.MacAddress : null;
        foreach (var holder in holders)
        {
            holder.MacAddress = null;
            if (SameIp(holder.IpAddress, ip)) holder.IpAddress = null;
        }
        target.MacAddress = macText;
        if (ip != null) target.IpAddress = ip;
        await _db.SaveChangesAsync();

        await _machines.ReassignChannelAsync(key, target.Id, detachedMac == null ? null : previousKey);
        await _masterData.RefreshCacheAsync();
        try { await _commandHub.Clients.All.NotifyMasterDataUpdated("channels"); } catch { /* non-blocking */ }

        return Ok(new
        {
            channelId = target.Id,
            channelName = target.Name,
            freedChannels = holders.Select(h => new { h.Id, h.Name }),
            detachedMac
        });
    }

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
