using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers;

public sealed record AssignChannelRequest(int ChannelId, bool MoveData = false);

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
    private readonly QualitySummaryQueue _qualityQueue;

    public MachinesController(MachineStatusService machines, AppDbContext db, IMasterDataService masterData,
        IHubContext<CommandHub, ICommandClient> commandHub, QualitySummaryQueue qualityQueue)
    {
        _machines = machines;
        _db = db;
        _masterData = masterData;
        _commandHub = commandHub;
        _qualityQueue = qualityQueue;
    }

    /// <summary>Channel Backup_Log2 created by itself (no real line / station yet).</summary>
    private static bool IsAutoChannel(PMSystem2.Api.Models.Channel c) =>
        c.StationId == 0 || c.Name.StartsWith("New Chanel", StringComparison.OrdinalIgnoreCase);

    private sealed record MovePlan(PMSystem2.Api.Models.Channel? Source, long Results, DateTime? First, DateTime? Last, string? Blocked);

    /// <summary>
    /// The results the PC wrote on its auto-created channel, which can follow it to the target channel.
    /// Only when that channel was used by this PC alone (results do not store the MAC, so data of
    /// several PCs could not be told apart).
    /// </summary>
    private async Task<MovePlan> PlanMoveAsync(string key, MachineStatusDto? pc, PMSystem2.Api.Models.Channel target)
    {
        var channels = await _db.Channels.AsNoTracking().ToListAsync();
        var source = (pc?.ChannelId is int id ? channels.FirstOrDefault(c => c.Id == id) : null)
            ?? channels.FirstOrDefault(c => MachineStatusService.MacKey(c.MacAddress) == key);
        if (source == null || source.Id == target.Id) return new MovePlan(null, 0, null, null, null);
        if (!IsAutoChannel(source))
            return new MovePlan(source, 0, null, null, "Channel hiện tại là channel thật: dữ liệu của nó giữ nguyên.");
        var otherPcs = (await _machines.GetAllAsync()).Count(m => m.ChannelId == source.Id && m.MacKey != key);
        var sourceKey = MachineStatusService.MacKey(source.MacAddress);
        if (otherPcs > 0 || (sourceKey != null && sourceKey != key))
            return new MovePlan(source, 0, null, null,
                $"Channel {source.Name} đã có {otherPcs + 1} PC ghi dữ liệu: không tách được dữ liệu của từng PC nên không chuyển.");
        var stats = await _db.PcbResults.AsNoTracking().Where(p => p.ChannelId == source.Id)
            .GroupBy(_ => 1)
            .Select(g => new { Count = g.LongCount(), First = g.Min(p => p.InspectTime), Last = g.Max(p => p.InspectTime) })
            .FirstOrDefaultAsync();
        return new MovePlan(source, stats?.Count ?? 0, stats?.First, stats?.Last, null);
    }

    /// <summary>What assigning the PC to the channel would move (shown in the dialog before confirming).</summary>
    [HttpGet("{mac}/assign-preview")]
    public async Task<IActionResult> AssignPreview(string mac, [FromQuery] int channelId)
    {
        var key = MachineStatusService.MacKey(mac);
        if (key == null) return BadRequest(new { message = "MAC không hợp lệ." });
        var target = await _db.Channels.AsNoTracking().FirstOrDefaultAsync(c => c.Id == channelId);
        if (target == null) return NotFound(new { message = $"Không có channel #{channelId}." });
        var pc = (await _machines.GetAllAsync()).FirstOrDefault(m => m.MacKey == key);
        var plan = await PlanMoveAsync(key, pc, target);
        return Ok(new
        {
            sourceChannelId = plan.Source?.Id,
            sourceChannelName = plan.Source?.Name,
            movableResults = plan.Blocked == null ? plan.Results : 0,
            firstTest = plan.First,
            lastTest = plan.Last,
            canMove = plan.Blocked == null && plan.Results > 0,
            reason = plan.Blocked
        });
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
        var plan = request.MoveData ? await PlanMoveAsync(key, pc, target) : null;
        if (plan?.Blocked != null) return Conflict(new { message = plan.Blocked });
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

        // Channel mapping and data move together: any failure leaves everything as it was.
        // (The context retries on transient errors, so the transaction runs inside its execution strategy.)
        long moved = 0;
        string[] movedPids = Array.Empty<string>();
        await _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var tx = await _db.Database.BeginTransactionAsync();
            await _db.SaveChangesAsync();
            movedPids = Array.Empty<string>();
            if (plan?.Source != null && plan.Results > 0)
            {
                _db.Database.SetCommandTimeout(TimeSpan.FromMinutes(10));
                // The results take the line / station of the target channel (the daily rollup follows
                // through its trigger); raw CPK samples move with them.
                movedPids = (await _db.Database.SqlQueryRaw<string>(
                        @"UPDATE pcb_results SET channel_id = {0}, station_id = {1} WHERE channel_id = {2} RETURNING pid AS ""Value""",
                        target.Id, target.StationId, plan.Source.Id).ToListAsync())
                    .Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();
                await _db.Database.ExecuteSqlRawAsync(
                    "UPDATE raw_cpk SET channel_id = {0}, station_id = {1} WHERE channel_id = {2}",
                    target.Id, target.StationId, plan.Source.Id);
            }
            await tx.CommitAsync();
        });
        moved = movedPids.LongLength;
        // NTF / RTY of the moved PCBs are rebuilt from their results (now on the right station).
        if (movedPids.Length > 0) _qualityQueue.Enqueue(movedPids.Distinct());

        await _machines.ReassignChannelAsync(key, target.Id, detachedMac == null ? null : previousKey);
        await _masterData.RefreshCacheAsync();
        try { await _commandHub.Clients.All.NotifyMasterDataUpdated("channels"); } catch { /* non-blocking */ }

        return Ok(new
        {
            channelId = target.Id,
            channelName = target.Name,
            freedChannels = holders.Select(h => new { h.Id, h.Name }),
            detachedMac,
            movedResults = moved,
            movedFrom = moved > 0 ? plan!.Source!.Name : null
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
