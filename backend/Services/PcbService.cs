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
        Task<List<PcbResultDto>> GetLatestResultsAsync(int limit = 50, int? lineId = null, int? stationId = null);
        Task<List<HourlyStatDto>> GetHourlyStatsAsync(int hours = 24, int? lineId = null, int? stationId = null);
        Task<ProductionSummaryDto> GetSummaryAsync();
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
            var hierarchy = _masterDataService.GetChannelHierarchy(req.ChannelId);
            if (hierarchy == null)
            {
                // Fallback: If cache miss, refresh cache and try again
                await _masterDataService.RefreshCacheAsync();
                hierarchy = _masterDataService.GetChannelHierarchy(req.ChannelId)
                    ?? throw new ArgumentException($"Channel ID {req.ChannelId} not found in master data.");
            }

            var entity = new PcbResult
            {
                ChannelId = req.ChannelId,
                StationId = hierarchy.StationId,
                LineId = hierarchy.LineId,
                Pid = req.Pid,
                Result = req.Result.ToUpperInvariant(),
                ErrorCode = req.ErrorCode,
                InspectTime = DateTime.UtcNow
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

            _db.PcbResults.Add(entity);
            await _db.SaveChangesAsync();

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

        public async Task<List<PcbResultDto>> GetLatestResultsAsync(int limit = 50, int? lineId = null, int? stationId = null)
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
            var startTime = DateTime.UtcNow.AddHours(-hours);
            var query = _db.PcbResults.AsNoTracking()
                .Where(p => p.InspectTime >= startTime);

            if (lineId.HasValue)
            {
                query = query.Where(p => p.LineId == lineId.Value);
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }

            var grouped = await query
                .GroupBy(p => new {
                    Date = p.InspectTime.Date,
                    Hour = p.InspectTime.Hour,
                    p.LineId,
                    p.StationId
                })
                .Select(g => new {
                    g.Key.Date,
                    g.Key.Hour,
                    g.Key.LineId,
                    g.Key.StationId,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK"),
                    Ng = g.Count(x => x.Result == "NG")
                })
                .ToListAsync();

            return grouped.Select(g => new HourlyStatDto(
                DateTime.SpecifyKind(g.Date.AddHours(g.Hour), DateTimeKind.Utc),
                g.LineId,
                g.StationId,
                g.Total,
                g.Ok,
                g.Ng,
                g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0
            )).OrderBy(g => g.Bucket).ToList();
        }

        public async Task<ProductionSummaryDto> GetSummaryAsync()
        {
            var totalInspected = await _db.PcbResults.CountAsync();
            var totalOk = await _db.PcbResults.CountAsync(p => p.Result == "OK");
            var totalNg = await _db.PcbResults.CountAsync(p => p.Result == "NG");

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
    }
}
