using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services
{
    public interface IPcbService
    {
        Task<PcbResultDto> SubmitResultAsync(SubmitPcbRequest req);
        Task<List<PcbResultDto>> GetLatestResultsAsync(int limit = 50, int? lineId = null, int? stationId = null, string? searchPid = null, string? resultFilter = null);
        Task<List<HourlyStatDto>> GetHourlyStatsAsync(int hours = 24, int? lineId = null, int? stationId = null);
        Task<ProductionSummaryDto> GetSummaryAsync();
        Task<List<LineYieldStatDto>> GetLineYieldStatsAsync(int? lineId = null);
        Task<List<StationYieldStatDto>> GetStationYieldStatsAsync(int? lineId = null);
        Task<List<DefectParetoStatDto>> GetDefectParetoAsync(int? lineId = null, int? stationId = null);
    }

    public class PcbService : IPcbService
    {
        private readonly AppDbContext _db;
        private readonly IMasterDataService _masterDataService;
        private readonly IHubContext<ProductionHub, IProductionClient> _hubContext;
        private readonly ILogger<PcbService> _logger;

        public PcbService(
            AppDbContext db,
            IMasterDataService masterDataService,
            IHubContext<ProductionHub, IProductionClient> hubContext,
            ILogger<PcbService> logger)
        {
            _db = db;
            _masterDataService = masterDataService;
            _hubContext = hubContext;
            _logger = logger;
        }

        public async Task<PcbResultDto> SubmitResultAsync(SubmitPcbRequest req)
        {
            int channelId = req.ChannelId;
            var hierarchy = _masterDataService.GetChannelHierarchy(channelId);
            if (hierarchy == null)
            {
                // Fallback: If cache miss, refresh cache and try again
                await _masterDataService.RefreshCacheAsync();
                hierarchy = _masterDataService.GetChannelHierarchy(channelId);
            }

            if (hierarchy == null)
            {
                var channels = await _masterDataService.GetChannelsAsync();
                var fallbackChannel = channels.FirstOrDefault();
                if (fallbackChannel != null)
                {
                    channelId = fallbackChannel.Id;
                    hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                }
                else
                {
                    var stations = await _masterDataService.GetStationsAsync();
                    int stationId = stations.FirstOrDefault()?.Id ?? 1;
                    var newCh = await _masterDataService.CreateChannelAsync(new CreateChannelRequest(stationId, "Default Channel", "127.0.0.1"));
                    channelId = newCh.Id;
                    hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                }
            }

            if (hierarchy == null)
            {
                throw new ArgumentException($"Unable to resolve channel hierarchy for Channel ID {req.ChannelId}.");
            }

            var normalizedResult = req.Result.ToUpperInvariant();
            var rawInspectTime = req.InspectTime ?? req.StartTime ?? DateTime.UtcNow;
            var inspectTime = DateTime.SpecifyKind(rawInspectTime, DateTimeKind.Utc);

            // 1. Check if an identical PCB test result already exists (Deduplication)
            var existingRecord = await _db.PcbResults
                .AsNoTracking()
                .Include(p => p.TestSteps)
                .FirstOrDefaultAsync(p => p.StationId == hierarchy.StationId
                                       && p.Pid == req.Pid
                                       && p.InspectTime == inspectTime
                                       && p.Result == normalizedResult);

            if (existingRecord != null)
            {
                _logger.LogWarning("[DEDUPLICATION] Duplicate PCB result ignored for PID: {Pid}, StationId: {StationId}, InspectTime: {InspectTime}",
                    req.Pid, hierarchy.StationId, inspectTime);

                return new PcbResultDto(
                    existingRecord.Id,
                    existingRecord.ChannelId,
                    hierarchy.ChannelName,
                    existingRecord.StationId,
                    hierarchy.StationName,
                    hierarchy.LineId,
                    hierarchy.LineName,
                    existingRecord.Pid,
                    existingRecord.Result,
                    existingRecord.ErrorCode,
                    existingRecord.InspectTime,
                    existingRecord.TestSteps.OrderBy(t => t.StepNumber).Select(t => new TestStepInputDto
                    {
                        StepType = t.StepType,
                        StepNumber = t.StepNumber,
                        StepName = t.StepName,
                        Result = t.Result,
                        Value = t.Value,
                        SpecMin = t.SpecMin,
                        SpecMax = t.SpecMax
                    }).ToList()
                );
            }

            var entity = new PcbResult
            {
                ChannelId = channelId,
                StationId = hierarchy.StationId,
                LineId = hierarchy.LineId,
                Pid = req.Pid,
                Result = normalizedResult,
                ErrorCode = req.ErrorCode,
                InspectTime = inspectTime
            };

            if (req.Steps != null && req.Steps.Count > 0)
            {
                foreach (var s in req.Steps)
                {
                    entity.TestSteps.Add(new TestStep
                    {
                        StepType = s.StepType,
                        StepNumber = s.StepNumber,
                        StepName = s.StepName,
                        Result = s.Result.ToUpperInvariant(),
                        Value = s.Value,
                        SpecMin = s.SpecMin,
                        SpecMax = s.SpecMax
                    });
                }
            }

            try
            {
                _db.PcbResults.Add(entity);
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "[DEDUPLICATION] DB Unique constraint prevented inserting duplicate PCB result for PID: {Pid}", req.Pid);
                _db.Entry(entity).State = EntityState.Detached;

                // Fallback: Fetch existing record
                var duplicate = await _db.PcbResults
                    .AsNoTracking()
                    .FirstOrDefaultAsync(p => p.StationId == hierarchy.StationId && p.Pid == req.Pid && p.InspectTime == inspectTime);

                return new PcbResultDto(
                    duplicate?.Id ?? entity.Id,
                    channelId,
                    hierarchy.ChannelName,
                    hierarchy.StationId,
                    hierarchy.StationName,
                    hierarchy.LineId,
                    hierarchy.LineName,
                    req.Pid,
                    normalizedResult,
                    req.ErrorCode,
                    inspectTime,
                    req.Steps ?? new List<TestStepInputDto>()
                );
            }

            var dto = new PcbResultDto(
                entity.Id,
                entity.ChannelId,
                hierarchy.ChannelName,
                entity.StationId,
                hierarchy.StationName,
                entity.LineId,
                hierarchy.LineName,
                entity.Pid,
                entity.Result,
                entity.ErrorCode,
                entity.InspectTime,
                req.Steps ?? new List<TestStepInputDto>()
            );

            // Broadcast via SignalR to all connected clients & target groups
            await _hubContext.Clients.All.ReceivePcbResult(dto);
            await _hubContext.Clients.Group($"Line_{entity.LineId}").ReceivePcbResult(dto);
            await _hubContext.Clients.Group($"Station_{entity.StationId}").ReceivePcbResult(dto);

            return dto;
        }

        public async Task<List<PcbResultDto>> GetLatestResultsAsync(
            int limit = 50, 
            int? lineId = null, 
            int? stationId = null,
            string? searchPid = null,
            string? resultFilter = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                query = query.Where(p => p.LineId == lineId.Value);
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }
            if (!string.IsNullOrWhiteSpace(searchPid))
            {
                var term = searchPid.Trim().ToLower();
                query = query.Where(p => p.Pid.ToLower().Contains(term));
            }
            if (!string.IsNullOrWhiteSpace(resultFilter) && resultFilter != "ALL")
            {
                if (resultFilter == "OK")
                {
                    query = query.Where(p => p.Result == "OK" || p.Result == "PASS");
                }
                else if (resultFilter == "NG")
                {
                    query = query.Where(p => p.Result == "NG" || p.Result == "FAIL");
                }
            }

            var list = await query
                .OrderByDescending(p => p.InspectTime)
                .Take(limit)
                .Include(p => p.TestSteps)
                .ToListAsync();

            var results = new List<PcbResultDto>();
            foreach (var item in list)
            {
                var hierarchy = _masterDataService.GetChannelHierarchy(item.ChannelId);
                results.Add(new PcbResultDto(
                    item.Id,
                    item.ChannelId,
                    hierarchy?.ChannelName ?? $"Channel {item.ChannelId}",
                    item.StationId,
                    hierarchy?.StationName ?? $"Station {item.StationId}",
                    item.LineId,
                    hierarchy?.LineName ?? $"Line {item.LineId}",
                    item.Pid,
                    item.Result,
                    item.ErrorCode,
                    item.InspectTime,
                    item.TestSteps.OrderBy(t => t.StepNumber).Select(t => new TestStepInputDto {
                        StepType = t.StepType,
                        StepNumber = t.StepNumber,
                        StepName = t.StepName,
                        Result = t.Result,
                        Value = t.Value,
                        SpecMin = t.SpecMin,
                        SpecMax = t.SpecMax
                    }).ToList()
                ));
            }

            return results;
        }

        public async Task<List<HourlyStatDto>> GetHourlyStatsAsync(int hours = 24, int? lineId = null, int? stationId = null)
        {
            var query = _db.PcbResults.AsNoTracking();

            if (lineId.HasValue)
            {
                query = query.Where(p => p.LineId == lineId.Value);
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }

            var cutoff = DateTime.UtcNow.AddHours(-hours);
            query = query.Where(p => p.InspectTime >= cutoff);

            var list = await query
                .OrderByDescending(p => p.InspectTime)
                .ToListAsync();

            var grouped = list
                .GroupBy(p => new {
                    Date = p.InspectTime.Date,
                    Hour = p.InspectTime.Hour
                })
                .Select(g => {
                    var total = g.Count();
                    var ok = g.Count(x => x.Result == "OK" || x.Result == "PASS");
                    var ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL");
                    return new HourlyStatDto(
                        DateTime.SpecifyKind(g.Key.Date.AddHours(g.Key.Hour), DateTimeKind.Utc),
                        lineId ?? 0,
                        stationId ?? 0,
                        total,
                        ok,
                        ng,
                        total > 0 ? Math.Round((double)ok / total * 100.0, 2) : 0.0
                    );
                })
                .OrderBy(g => g.Bucket)
                .ToList();

            return grouped;
        }

        public async Task<ProductionSummaryDto> GetSummaryAsync()
        {
            var totalInspected = await _db.PcbResults.CountAsync();
            var totalOk = await _db.PcbResults.CountAsync(p => p.Result == "OK" || p.Result == "PASS");
            var totalNg = await _db.PcbResults.CountAsync(p => p.Result == "NG" || p.Result == "FAIL");

            var yieldRate = totalInspected > 0 ? Math.Round((double)totalOk / totalInspected * 100.0, 2) : 0.0;
            var activeChannels = (await _masterDataService.GetChannelsAsync()).Count(c => c.Status == "online");
            var recentHourly = await GetHourlyStatsAsync(12);

            return new ProductionSummaryDto(
                totalInspected,
                totalOk,
                totalNg,
                yieldRate,
                activeChannels,
                recentHourly
            );
        }

        public async Task<List<LineYieldStatDto>> GetLineYieldStatsAsync(int? lineId = null)
        {
            var lines = await _masterDataService.GetLinesAsync();
            var query = _db.PcbResults.AsNoTracking().AsQueryable();
            if (lineId.HasValue)
            {
                query = query.Where(p => p.LineId == lineId.Value);
            }

            var grouped = await query
                .GroupBy(p => p.LineId)
                .Select(g => new {
                    LineId = g.Key,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .ToListAsync();

            var result = new List<LineYieldStatDto>();
            foreach (var g in grouped)
            {
                var lineName = lines.FirstOrDefault(l => l.Id == g.LineId)?.Name ?? $"Line {g.LineId}";
                var yieldRate = g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0;
                result.Add(new LineYieldStatDto(g.LineId, lineName, g.Total, g.Ok, g.Ng, yieldRate));
            }

            return result.OrderByDescending(r => r.Total).ToList();
        }

        public async Task<List<StationYieldStatDto>> GetStationYieldStatsAsync(int? lineId = null)
        {
            var stations = await _masterDataService.GetStationsAsync();
            var lines = await _masterDataService.GetLinesAsync();
            var query = _db.PcbResults.AsNoTracking().AsQueryable();
            if (lineId.HasValue)
            {
                query = query.Where(p => p.LineId == lineId.Value);
            }

            var grouped = await query
                .GroupBy(p => p.StationId)
                .Select(g => new {
                    StationId = g.Key,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .ToListAsync();

            var result = new List<StationYieldStatDto>();
            foreach (var g in grouped)
            {
                var st = stations.FirstOrDefault(s => s.Id == g.StationId);
                var stName = st?.Name ?? $"Station {g.StationId}";
                var lineIdVal = st?.LineId ?? 0;
                var lineName = lines.FirstOrDefault(l => l.Id == lineIdVal)?.Name ?? $"Line {lineIdVal}";
                var yieldRate = g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0;
                result.Add(new StationYieldStatDto(g.StationId, stName, lineIdVal, lineName, g.Total, g.Ok, g.Ng, yieldRate));
            }

            return result.OrderBy(r => r.YieldRate).ToList();
        }

        public async Task<List<DefectParetoStatDto>> GetDefectParetoAsync(int? lineId = null, int? stationId = null)
        {
            var query = _db.PcbResults.AsNoTracking()
                .Where(p => p.Result == "NG" || p.Result == "FAIL");

            if (lineId.HasValue)
            {
                query = query.Where(p => p.LineId == lineId.Value);
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }

            var totalNg = await query.CountAsync();
            if (totalNg == 0) return new List<DefectParetoStatDto>();

            var grouped = await query
                .GroupBy(p => p.ErrorCode ?? "UNKNOWN_DEFECT")
                .Select(g => new {
                    Code = g.Key,
                    Count = g.Count()
                })
                .OrderByDescending(g => g.Count)
                .Take(20)
                .ToListAsync();

            return grouped.Select(g => new DefectParetoStatDto(
                g.Code,
                g.Count,
                Math.Round((double)g.Count / totalNg * 100.0, 2)
            )).ToList();
        }
    }
}

