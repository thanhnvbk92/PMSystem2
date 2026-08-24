using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Controllers;

[ApiController]
[Route("api/v1/improvements")]
public class ImprovementsController(AppDbContext db) : ControllerBase
{
    [HttpGet("top-defects")]
    public async Task<IActionResult> TopDefects([FromQuery] DateTime startDate, [FromQuery] DateTime endDate, [FromQuery] int limit = 5)
    {
        if (startDate >= endDate) return BadRequest(new { error = "Khoảng thời gian không hợp lệ." });
        limit = Math.Clamp(limit, 1, 20);
        var grouped = await db.PcbResults.AsNoTracking()
            .Where(p => p.InspectTime >= startDate.ToUniversalTime() && p.InspectTime <= endDate.ToUniversalTime()
                && (p.Result == "NG" || p.Result == "FAIL"))
            .GroupBy(p => new { Code = p.ErrorCode ?? "DEFECT_UNSPECIFIED", p.StationId })
            .Select(g => new { g.Key.Code, g.Key.StationId, Count = g.LongCount() })
            .ToListAsync();

        var topCodes = grouped.GroupBy(x => x.Code)
            .Select(g => new { Code = g.Key, Count = g.Sum(x => x.Count), TopStation = g.OrderByDescending(x => x.Count).First() })
            .OrderByDescending(x => x.Count).Take(limit).ToList();
        var totalNg = grouped.Sum(x => x.Count);
        var stationIds = topCodes.Select(x => x.TopStation.StationId).Distinct().ToList();
        var stationMap = await db.Stations.AsNoTracking().Where(s => stationIds.Contains(s.Id))
            .Select(s => new { s.Id, s.Name, s.LineId }).ToDictionaryAsync(s => s.Id);
        var lineIds = stationMap.Values.Select(s => s.LineId).Distinct().ToList();
        var lineMap = await db.Lines.AsNoTracking().Where(l => lineIds.Contains(l.Id))
            .ToDictionaryAsync(l => l.Id, l => l.Name);

        return Ok(topCodes.Select(x => {
            stationMap.TryGetValue(x.TopStation.StationId, out var station);
            var lineId = station?.LineId ?? 0;
            return new {
                code = x.Code, count = x.Count, pct = totalNg > 0 ? Math.Round(x.Count * 100.0 / totalNg, 2) : 0,
                stationId = station?.Id, stationName = station?.Name ?? $"Station #{x.TopStation.StationId}",
                lineId = lineId > 0 ? lineId : (int?)null,
                lineName = lineId > 0 && lineMap.TryGetValue(lineId, out var lineName) ? lineName : "Chưa xác định"
            };
        }));
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? status = null)
    {
        var query = db.Improvements.AsNoTracking().Include(x => x.Actions).AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
        var items = await query.OrderByDescending(x => x.UpdatedAt).ToListAsync();
        var result = new List<object>();
        foreach (var item in items) result.Add(await ToDto(item));
        return Ok(result);
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> Get(long id)
    {
        var item = await db.Improvements.AsNoTracking().Include(x => x.Actions).FirstOrDefaultAsync(x => x.Id == id);
        return item == null ? NotFound() : Ok(await ToDto(item));
    }

    [HttpGet("{id:long}/trend")]
    public async Task<IActionResult> Trend(long id, [FromQuery] DateTime? startDate = null, [FromQuery] DateTime? endDate = null, [FromQuery] string granularity = "day")
    {
        var item = await db.Improvements.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (item == null) return NotFound();
        var start = (startDate ?? item.BaselineStart).ToUniversalTime();
        var end = (endDate ?? (item.TrackingEnd > DateTime.UtcNow ? DateTime.UtcNow : item.TrackingEnd)).ToUniversalTime();
        if (start >= end) return BadRequest(new { error = "Khoảng ngày xem biểu đồ không hợp lệ." });
        if ((end - start).TotalDays > 730) return BadRequest(new { error = "Chỉ có thể xem tối đa 730 ngày mỗi lần." });
        granularity = granularity.ToLowerInvariant();
        if (granularity is not ("day" or "week" or "month")) return BadRequest(new { error = "Mức tổng hợp phải là day, week hoặc month." });
        var query = db.PcbResults.AsNoTracking()
            .Where(p => p.InspectTime >= start && p.InspectTime < end);
        if (item.StationId.HasValue) query = query.Where(p => p.StationId == item.StationId);
        else if (item.LineId.HasValue)
            query = from p in query join s in db.Stations on p.StationId equals s.Id where s.LineId == item.LineId select p;

        var daily = await query.GroupBy(p => p.InspectTime.Date)
            .Select(g => new
            {
                date = g.Key,
                total = g.Count(),
                defects = g.Count(p => p.ErrorCode == item.ErrorCode)
            })
            .OrderBy(x => x.date)
            .ToListAsync();

        static DateTime Bucket(DateTime date, string level) => level switch
        {
            "month" => new DateTime(date.Year, date.Month, 1, 0, 0, 0, date.Kind),
            "week" => date.Date.AddDays(-(((int)date.DayOfWeek + 6) % 7)),
            _ => date.Date
        };
        var aggregated = daily.GroupBy(x => Bucket(x.date, granularity))
            .ToDictionary(g => g.Key, g => new TrendPoint(g.Key, g.Sum(x => x.total), g.Sum(x => x.defects)));

        // Always return every bucket touched by the requested range. This keeps
        // the final week/month visible even when it has no PCB data yet, and it
        // gives improvement milestones a real X-axis coordinate.
        static DateTime NextBucket(DateTime date, string level) => level switch
        {
            "month" => date.AddMonths(1),
            "week" => date.AddDays(7),
            _ => date.AddDays(1)
        };
        var firstBucket = Bucket(start, granularity);
        var lastBucket = Bucket(end, granularity);
        var points = new List<TrendPoint>();
        for (var cursor = firstBucket; cursor <= lastBucket; cursor = NextBucket(cursor, granularity))
        {
            points.Add(aggregated.TryGetValue(cursor, out var point)
                ? point
                : new TrendPoint(cursor, 0, 0));
        }
        return Ok(points.Select(x => new
        {
            date = x.Date, total = x.Total, defects = x.Defects,
            defectRate = x.Total == 0 ? 0 : Math.Round(x.Defects * 100.0 / x.Total, 4),
            period = x.Date < item.TrackingStart.Date ? "baseline" : "tracking"
        }));
    }

    public record RootCauseRequest(string? RootCause);

    [HttpPatch("{id:long}/root-cause")]
    public async Task<IActionResult> UpdateRootCause(long id, RootCauseRequest request)
    {
        var item = await db.Improvements.FindAsync(id);
        if (item == null) return NotFound();
        item.RootCause = request.RootCause?.Trim();
        item.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { item.Id, item.RootCause, item.UpdatedAt });
    }

    [HttpPost]
    public async Task<IActionResult> Create(Improvement input)
    {
        NormalizePeriodDates(input);
        var error = Validate(input); if (error != null) return BadRequest(new { error });
        input.Id = 0; input.Code = string.IsNullOrWhiteSpace(input.Code) ? $"CI-{DateTime.UtcNow:yyyyMMddHHmmss}" : input.Code.Trim();
        input.CreatedAt = input.UpdatedAt = DateTime.UtcNow;
        input.Actions = input.Actions.Select(a => { a.Id = 0; a.CreatedAt = DateTime.UtcNow; return a; }).ToList();
        db.Improvements.Add(input);
        try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Conflict(new { error = "Mã cải tiến đã tồn tại." }); }
        // Persisting an improvement must stay fast. The measurement queries scan FCT data
        // and are loaded by GET afterwards; keeping them out of POST also avoids making a
        // successful save look as if it failed when the database is busy.
        return CreatedAtAction(nameof(Get), new { id = input.Id }, new { input.Id, input.Code });
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, Improvement input)
    {
        var item = await db.Improvements.FindAsync(id); if (item == null) return NotFound();
        NormalizePeriodDates(input);
        var error = Validate(input); if (error != null) return BadRequest(new { error });
        item.Title = input.Title.Trim(); item.ErrorCode = input.ErrorCode?.Trim(); item.LineId = input.LineId;
        item.StationId = input.StationId; item.ProblemDescription = input.ProblemDescription; item.RootCause = input.RootCause;
        item.Owner = input.Owner; item.Status = input.Status; item.BaselineStart = input.BaselineStart; item.BaselineEnd = input.BaselineEnd;
        item.TrackingStart = input.TrackingStart; item.TrackingEnd = input.TrackingEnd; item.TargetReductionPercent = input.TargetReductionPercent;
        item.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { item.Id, item.Code, item.UpdatedAt });
    }

    [HttpPost("{id:long}/actions")]
    public async Task<IActionResult> AddAction(long id, ImprovementAction action)
    {
        if (!await db.Improvements.AnyAsync(x => x.Id == id)) return NotFound();
        if (string.IsNullOrWhiteSpace(action.Description)) return BadRequest(new { error = "Nội dung hành động là bắt buộc." });
        action.Id = 0; action.ImprovementId = id; action.CreatedAt = DateTime.UtcNow; db.ImprovementActions.Add(action);
        await db.SaveChangesAsync(); return Ok(action);
    }

    [HttpPut("actions/{actionId:long}")]
    public async Task<IActionResult> UpdateAction(long actionId, ImprovementAction input)
    {
        var item = await db.ImprovementActions.FindAsync(actionId); if (item == null) return NotFound();
        item.Description = input.Description; item.Owner = input.Owner; item.Status = input.Status; item.DueDate = input.DueDate;
        item.Evidence = input.Evidence; item.CompletedAt = input.Status == "DONE" ? input.CompletedAt ?? DateTime.UtcNow : null;
        await db.SaveChangesAsync(); return Ok(item);
    }

    [HttpDelete("actions/{actionId:long}")]
    public async Task<IActionResult> DeleteAction(long actionId)
    {
        var item = await db.ImprovementActions.FindAsync(actionId); if (item == null) return NotFound();
        db.Remove(item); await db.SaveChangesAsync(); return NoContent();
    }

    private static DateTime AsServerLocal(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value.ToLocalTime(),
        DateTimeKind.Unspecified => DateTime.SpecifyKind(value, DateTimeKind.Local),
        _ => value
    };

    private static void NormalizePeriodDates(Improvement item)
    {
        // Npgsql legacy timestamp mode preserves clock components. Normalize
        // incoming ISO/UTC values first so calendar dates do not move backward.
        item.BaselineStart = AsServerLocal(item.BaselineStart);
        item.BaselineEnd = AsServerLocal(item.BaselineEnd);
        item.TrackingStart = AsServerLocal(item.TrackingStart);
        item.TrackingEnd = AsServerLocal(item.TrackingEnd);
    }

    private static string? Validate(Improvement x)
    {
        if (string.IsNullOrWhiteSpace(x.Title)) return "Tên cải tiến là bắt buộc.";
        if (string.IsNullOrWhiteSpace(x.ErrorCode)) return "Phải chọn mã lỗi FCT cần cải tiến.";
        if (x.BaselineStart >= x.BaselineEnd || x.TrackingStart >= x.TrackingEnd) return "Khoảng thời gian đo không hợp lệ.";
        if (x.TargetReductionPercent < 0 || x.TargetReductionPercent > 100) return "Mục tiêu giảm lỗi phải từ 0 đến 100%.";
        return null;
    }

    private async Task<object> ToDto(Improvement x)
    {
        var baseline = await Measure(x, x.BaselineStart, x.BaselineEnd);
        var effectiveEnd = x.TrackingEnd > DateTime.UtcNow ? DateTime.UtcNow : x.TrackingEnd;
        var tracking = effectiveEnd > x.TrackingStart ? await Measure(x, x.TrackingStart, effectiveEnd) : new Metric(0, 0, 0);
        double? reduction = baseline.Rate > 0 ? (baseline.Rate - tracking.Rate) / baseline.Rate * 100 : null;
        return new { x.Id, x.Code, x.Title, x.ErrorCode, x.LineId, x.StationId, x.ProblemDescription, x.RootCause,
            x.Owner, x.Status, x.BaselineStart, x.BaselineEnd, x.TrackingStart, x.TrackingEnd, x.TargetReductionPercent,
            x.CreatedAt, x.UpdatedAt,
            actions = x.Actions.OrderBy(a => a.DueDate).Select(a => new
            {
                a.Id,
                a.ImprovementId,
                a.Description,
                a.Owner,
                a.Status,
                a.DueDate,
                a.CompletedAt,
                a.Evidence,
                a.CreatedAt
            }).ToList(),
            baseline, tracking,
            reductionPercent = reduction, targetAchieved = reduction.HasValue && reduction >= x.TargetReductionPercent,
            measurementComplete = DateTime.UtcNow >= x.TrackingEnd };
    }

    private async Task<Metric> Measure(Improvement x, DateTime start, DateTime end)
    {
        var q = db.PcbResults.AsNoTracking().Where(p => p.InspectTime >= start && p.InspectTime < end);
        if (x.StationId.HasValue) q = q.Where(p => p.StationId == x.StationId);
        else if (x.LineId.HasValue) q = from p in q join s in db.Stations on p.StationId equals s.Id where s.LineId == x.LineId select p;
        var counts = await q
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Defects = g.Count(p => p.ErrorCode == x.ErrorCode)
            })
            .FirstOrDefaultAsync();
        var total = counts?.Total ?? 0;
        var defects = counts?.Defects ?? 0;
        return new Metric(total, defects, total == 0 ? 0 : defects * 100.0 / total);
    }

    private record Metric(int Total, int Defects, double Rate);
    private record TrendPoint(DateTime Date, int Total, int Defects);
}
