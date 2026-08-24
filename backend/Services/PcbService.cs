using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services
{
    public interface IPcbService
    {
        Task<PcbResultDto> SubmitResultAsync(SubmitPcbRequest req);
        Task<List<PcbResultDto>> SubmitBatchAsync(List<SubmitPcbRequest> requests);
        Task<List<PcbResultDto>> GetLatestResultsAsync(int limit = 50, int? lineId = null, int? stationId = null, string? searchPid = null, string? searchError = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<int> GetExportCountAsync(int? lineId = null, int? stationId = null, string? searchPid = null, string? searchError = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<byte[]> GetExportCsvAsync(int? limit = null, int? lineId = null, int? stationId = null, string? searchPid = null, string? searchError = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<List<HourlyStatDto>> GetHourlyStatsAsync(int hours = 24, int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<ProductionSummaryDto> GetSummaryAsync(int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<ProductionCounterDto> GetCountersAsync(int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<List<LineYieldStatDto>> GetLineYieldStatsAsync(int? lineId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<List<StationYieldStatDto>> GetStationYieldStatsAsync(int? lineId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<List<DefectParetoStatDto>> GetDefectParetoAsync(int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<BiAnalyticsMatrixDto> GetBiMatrixAsync(int? lineId = null, int? stationId = null, int? channelId = null, int? modelId = null, string? errorCode = null, string? jobFile = null, DateTime? startDate = null, DateTime? endDate = null, int hours = 24);
        Task<List<CpkStepOptionDto>> GetCpkStepsAsync(int channelId);
        Task<List<CpkStepOptionDto>> GetStationCpkStepsAsync(int stationId);
        Task<CpkAnalysisDto> GetCpkAnalysisAsync(int channelId, int stepNumber, string stepName, string? jobFile, int limit = 50, bool forceRefresh = false);
        Task<List<CpkCacheOverviewDto>> GetCpkOverviewAsync();
    }

    public class PcbService : IPcbService
    {
        private static long _productionVersion;
        private static readonly SemaphoreSlim ProductionBroadcastGate = new(1, 1);
        private readonly AppDbContext _db;
        private readonly IMasterDataService _masterDataService;
        private readonly IHubContext<ProductionHub, IProductionClient> _hubContext;
        private readonly ILogger<PcbService> _logger;
        private readonly IMemoryCache _memoryCache;

        public PcbService(
            AppDbContext db,
            IMasterDataService masterDataService,
            IHubContext<ProductionHub, IProductionClient> hubContext,
            ILogger<PcbService> logger,
            IMemoryCache memoryCache)
        {
            _db = db;
            _masterDataService = masterDataService;
            _hubContext = hubContext;
            _logger = logger;
            _memoryCache = memoryCache;
        }

        public async Task<PcbResultDto> SubmitResultAsync(SubmitPcbRequest req)
        {
            var cleanPid = CleanDbText(req.Pid) ?? string.Empty;
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
                    var newCh = await _masterDataService.CreateChannelAsync(new CreateChannelRequest(stationId, "Default Channel", IpAddress: "127.0.0.1"));
                    channelId = newCh.Id;
                    hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                }
            }

            if (hierarchy == null)
            {
                throw new ArgumentException($"Unable to resolve channel hierarchy for Channel ID {req.ChannelId}.");
            }

            var normalizedResult = (CleanDbText(req.Result) ?? string.Empty).ToUpperInvariant();
            var rawInspectTime = req.InspectTime ?? req.StartTime ?? DateTime.UtcNow;
            var inspectTime = EnsureUtc(rawInspectTime);
            var startTime = req.StartTime.HasValue ? EnsureUtc(req.StartTime.Value) : inspectTime;

            // Calculate ErrorCode: First NG step name if NG/FAIL, else null if OK
            string? computedErrorCode = null;
            if (normalizedResult == "NG" || normalizedResult == "FAIL")
            {
                var firstNgStep = req.Steps?.FirstOrDefault(s =>
                    !string.Equals(s.Result, "OK", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(s.Result, "PASS", StringComparison.OrdinalIgnoreCase));

                if (firstNgStep != null)
                {
                    computedErrorCode = !string.IsNullOrWhiteSpace(firstNgStep.StepName)
                        ? firstNgStep.StepName
                        : (!string.IsNullOrWhiteSpace(firstNgStep.Value) ? firstNgStep.Value : "DEFECT_UNSPECIFIED");
                }
                else
                {
                    computedErrorCode = !string.IsNullOrWhiteSpace(req.ErrorCode) ? req.ErrorCode : "DEFECT_UNSPECIFIED";
                }
            }
            computedErrorCode = CleanDbText(computedErrorCode);
            if ((normalizedResult == "NG" || normalizedResult == "FAIL") && string.IsNullOrWhiteSpace(computedErrorCode))
                computedErrorCode = "DEFECT_UNSPECIFIED";

            // Deduplication Check
            var existingRecord = await _db.PcbResults
                .Include(p => p.TestSteps)
                .Where(p => p.Pid == cleanPid
                    && p.Result == normalizedResult
                    && p.StartTime == startTime)
                .OrderByDescending(p => p.Id)
                .FirstOrDefaultAsync();

            if (existingRecord != null)
            {
                if (existingRecord.ChannelId != channelId)
                {
                    int oldChannelId = existingRecord.ChannelId;
                    existingRecord.ChannelId = channelId;
                    existingRecord.StationId = hierarchy.StationId;
                    await _db.SaveChangesAsync();
                    _logger.LogWarning(
                        "[DEDUPLICATION] Duplicate PCB result reassigned to current channel. PID: {Pid}, StationId: {StationId}, InspectTime: {InspectTime}, OldChannelId: {OldChannelId}, NewChannelId: {NewChannelId}",
                        cleanPid, hierarchy.StationId, inspectTime, oldChannelId, channelId);
                }
                else
                {
                    _logger.LogWarning("[DEDUPLICATION] Duplicate PCB result ignored for PID: {Pid}, StationId: {StationId}, InspectTime: {InspectTime}",
                        cleanPid, hierarchy.StationId, inspectTime);
                }

                return new PcbResultDto(
                    existingRecord.Id,
                    existingRecord.ChannelId,
                    hierarchy.ChannelName,
                    hierarchy.IpAddress,
                    existingRecord.StationId,
                    hierarchy.StationName,
                    hierarchy.LineId,
                    hierarchy.LineName,
                    existingRecord.Pid,
                    existingRecord.Result,
                    existingRecord.ErrorCode,
                    existingRecord.GmesStatus,
                    existingRecord.InspectTime,
                    existingRecord.CreatedAt,
                    existingRecord.JobFile,
                    existingRecord.ModelId,
                    null,
                    existingRecord.Fid,
                    existingRecord.PcbaPartNo,
                    existingRecord.StartTime,
                    existingRecord.EndTime,
                    existingRecord.TestTime,
                    existingRecord.FilePath,
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
                Pid = cleanPid,
                JobFile = CleanDbText(req.JobFile),
                ModelId = req.ModelId,
                Fid = CleanDbText(req.Fid),
                PcbaPartNo = CleanDbText(req.PcbaPartNo),
                StartTime = req.StartTime.HasValue ? EnsureUtc(req.StartTime.Value) : inspectTime,
                EndTime = EnsureUtc(req.EndTime),
                TestTime = req.TestTime,
                FilePath = CleanDbText(req.FilePath),
                Result = normalizedResult,
                ErrorCode = computedErrorCode,
                GmesStatus = CleanDbText(req.GmesStatus),
                InspectTime = inspectTime,
                CreatedAt = DateTime.UtcNow
            };

            if (req.Steps != null && req.Steps.Count > 0)
            {
                foreach (var s in req.Steps)
                {
                    entity.TestSteps.Add(new TestStep
                    {
                        StepType = CleanDbText(s.StepType),
                        StepNumber = s.StepNumber,
                        StepName = CleanDbText(s.StepName) ?? string.Empty,
                        Result = (CleanDbText(s.Result) ?? string.Empty).ToUpperInvariant(),
                        Value = CleanDbText(s.Value),
                        SpecMin = CleanDbText(s.SpecMin),
                        SpecMax = CleanDbText(s.SpecMax)
                    });
                }
            }
            else if (normalizedResult == "NG" || normalizedResult == "FAIL")
            {
                entity.TestSteps.Add(new TestStep
                {
                    StepNumber = 1,
                    StepName = !string.IsNullOrWhiteSpace(computedErrorCode) ? computedErrorCode : "DEFECT_UNSPECIFIED",
                    StepType = "ERROR_CODE",
                    Result = "NG",
                    Value = "-",
                    SpecMin = "-",
                    SpecMax = "-"
                });
            }

            try
            {
                _db.PcbResults.Add(entity);
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                _logger.LogWarning(ex, "[DEDUPLICATION] DB Unique constraint prevented inserting duplicate PCB result for PID: {Pid}", cleanPid);
                _db.Entry(entity).State = EntityState.Detached;

                // Fallback: Fetch existing record
                var duplicate = await _db.PcbResults
                    .FirstOrDefaultAsync(p => p.StationId == hierarchy.StationId
                        && p.Pid == cleanPid
                        && p.InspectTime == inspectTime
                        && p.Result == normalizedResult);

                if (duplicate != null && duplicate.ChannelId != channelId)
                {
                    int oldChannelId = duplicate.ChannelId;
                    duplicate.ChannelId = channelId;
                    await _db.SaveChangesAsync();
                    _logger.LogWarning(
                        "[DEDUPLICATION] Unique-conflict PCB result reassigned to current channel. PID: {Pid}, StationId: {StationId}, InspectTime: {InspectTime}, OldChannelId: {OldChannelId}, NewChannelId: {NewChannelId}",
                        cleanPid, hierarchy.StationId, inspectTime, oldChannelId, channelId);
                }

                return new PcbResultDto(
                    duplicate?.Id ?? entity.Id,
                    duplicate?.ChannelId ?? channelId,
                    hierarchy.ChannelName,
                    hierarchy.IpAddress,
                    hierarchy.StationId,
                    hierarchy.StationName,
                    hierarchy.LineId,
                    hierarchy.LineName,
                    cleanPid,
                    normalizedResult,
                    computedErrorCode,
                    duplicate?.GmesStatus ?? req.GmesStatus,
                    inspectTime,
                    duplicate?.CreatedAt ?? entity.CreatedAt,
                    duplicate?.JobFile ?? req.JobFile,
                    duplicate?.ModelId ?? req.ModelId,
                    null,
                    duplicate?.Fid ?? req.Fid,
                    duplicate?.PcbaPartNo ?? req.PcbaPartNo,
                    duplicate?.StartTime ?? entity.StartTime,
                    duplicate?.EndTime ?? entity.EndTime,
                    duplicate?.TestTime ?? entity.TestTime,
                    duplicate?.FilePath ?? entity.FilePath,
                    req.Steps ?? new List<TestStepInputDto>()
                );
            }

            var dto = new PcbResultDto(
                entity.Id,
                entity.ChannelId,
                hierarchy.ChannelName,
                hierarchy.IpAddress,
                entity.StationId,
                hierarchy.StationName,
                hierarchy.LineId,
                hierarchy.LineName,
                entity.Pid,
                entity.Result,
                entity.ErrorCode,
                entity.GmesStatus,
                entity.InspectTime,
                entity.CreatedAt,
                entity.JobFile,
                entity.ModelId,
                null,
                entity.Fid,
                entity.PcbaPartNo,
                entity.StartTime,
                entity.EndTime,
                entity.TestTime,
                entity.FilePath,
                req.Steps ?? new List<TestStepInputDto>()
            );

            await _hubContext.Clients.All.ReceivePcbResult(dto);
            await _hubContext.Clients.Group($"Line_{hierarchy.LineId}").ReceivePcbResult(dto);
            await _hubContext.Clients.Group($"Station_{entity.StationId}").ReceivePcbResult(dto);

            // Supplementary master-data/catalog maintenance must never delay
            // the real-time event that drives Dashboard counters.
            try
            {
                await EnsureJobFileMappingsAsync(new[] { entity.JobFile });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Job File mapping registration failed after PCB was saved and broadcast.");
            }
            if (entity.Result == "OK" || entity.Result == "PASS")
                await TrySyncCpkStepCatalogAsync(entity.StationId, entity.JobFile, entity.TestSteps);

            return dto;
        }

        public async Task<List<PcbResultDto>> SubmitBatchAsync(List<SubmitPcbRequest> requests)
        {
            if (requests == null || requests.Count == 0)
                return new List<PcbResultDto>();

            var resultDtos = new List<PcbResultDto>();
            var newEntities = new List<PcbResult>();

            foreach (var req in requests)
            {
                var cleanPid = CleanDbText(req.Pid) ?? string.Empty;
                int channelId = req.ChannelId;
                var hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                if (hierarchy == null)
                {
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
                }

                if (hierarchy == null) continue;

                var normalizedResult = (CleanDbText(req.Result) ?? string.Empty).ToUpperInvariant();
                var rawInspectTime = req.InspectTime ?? req.StartTime ?? DateTime.UtcNow;
                var inspectTime = EnsureUtc(rawInspectTime);
                var startTime = req.StartTime.HasValue ? EnsureUtc(req.StartTime.Value) : inspectTime;

                string? computedErrorCode = null;
                if (normalizedResult == "NG" || normalizedResult == "FAIL")
                {
                    var firstNgStep = req.Steps?.FirstOrDefault(s =>
                        !string.Equals(s.Result, "OK", StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(s.Result, "PASS", StringComparison.OrdinalIgnoreCase));

                    if (firstNgStep != null)
                    {
                        computedErrorCode = !string.IsNullOrWhiteSpace(firstNgStep.StepName)
                            ? firstNgStep.StepName
                            : (!string.IsNullOrWhiteSpace(firstNgStep.Value) ? firstNgStep.Value : "DEFECT_UNSPECIFIED");
                    }
                    else
                    {
                        computedErrorCode = !string.IsNullOrWhiteSpace(req.ErrorCode) ? req.ErrorCode : "DEFECT_UNSPECIFIED";
                    }
                }
                computedErrorCode = CleanDbText(computedErrorCode);
                if ((normalizedResult == "NG" || normalizedResult == "FAIL") && string.IsNullOrWhiteSpace(computedErrorCode))
                    computedErrorCode = "DEFECT_UNSPECIFIED";

                var entity = new PcbResult
                {
                    ChannelId = channelId,
                    StationId = hierarchy.StationId,
                    Pid = cleanPid,
                    JobFile = CleanDbText(req.JobFile),
                    ModelId = req.ModelId,
                    Fid = CleanDbText(req.Fid),
                    PcbaPartNo = CleanDbText(req.PcbaPartNo),
                    StartTime = startTime,
                    EndTime = EnsureUtc(req.EndTime),
                    TestTime = req.TestTime,
                    FilePath = CleanDbText(req.FilePath),
                    Result = normalizedResult,
                    ErrorCode = computedErrorCode,
                    GmesStatus = CleanDbText(req.GmesStatus),
                    InspectTime = inspectTime,
                    CreatedAt = DateTime.UtcNow
                };

                if (req.Steps != null && req.Steps.Count > 0)
                {
                    foreach (var s in req.Steps)
                    {
                        entity.TestSteps.Add(new TestStep
                        {
                            StepType = CleanDbText(s.StepType),
                            StepNumber = s.StepNumber,
                            StepName = CleanDbText(s.StepName) ?? string.Empty,
                            Result = (CleanDbText(s.Result) ?? string.Empty).ToUpperInvariant(),
                            Value = CleanDbText(s.Value),
                            SpecMin = CleanDbText(s.SpecMin),
                            SpecMax = CleanDbText(s.SpecMax)
                        });
                    }
                }
                else if (normalizedResult == "NG" || normalizedResult == "FAIL")
                {
                    entity.TestSteps.Add(new TestStep
                    {
                        StepNumber = 1,
                        StepName = !string.IsNullOrWhiteSpace(computedErrorCode) ? computedErrorCode : "DEFECT_UNSPECIFIED",
                        StepType = "ERROR_CODE",
                        Result = "NG",
                        Value = "-",
                        SpecMin = "-",
                        SpecMax = "-"
                    });
                }

                newEntities.Add(entity);
            }

            // A full local rescan primarily sends records that already exist.
            // Resolve duplicates in one database read and reassign their Channel
            // instead of attempting a bulk insert and falling back one-by-one.
            var duplicateAssignmentsChanged = false;
            if (newEntities.Count > 0)
            {
                var candidatePids = newEntities.Select(e => e.Pid).Distinct().ToList();
                var minStart = newEntities.Min(e => e.StartTime ?? e.InspectTime);
                var maxStart = newEntities.Max(e => e.StartTime ?? e.InspectTime);
                // Deduplication only needs the PCB identity and ownership fields.
                // Loading TestSteps here creates a very large JOIN during full
                // rescans and can exceed the database command timeout.
                var existingCandidates = await _db.PcbResults
                    .Where(p => candidatePids.Contains(p.Pid) && p.StartTime.HasValue &&
                        p.StartTime.Value >= minStart && p.StartTime.Value <= maxStart)
                    .ToListAsync();
                var existingByKey = existingCandidates
                    .GroupBy(p => (p.Pid, p.Result, Start: p.StartTime!.Value))
                    .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Id).First());

                var toInsert = new List<PcbResult>();
                foreach (var entity in newEntities)
                {
                    var key = (entity.Pid, entity.Result, Start: entity.StartTime ?? entity.InspectTime);
                    if (!existingByKey.TryGetValue(key, out var existing))
                    {
                        toInsert.Add(entity);
                        continue;
                    }

                    if (existing.ChannelId != entity.ChannelId || existing.StationId != entity.StationId)
                    {
                        var oldChannelId = existing.ChannelId;
                        existing.ChannelId = entity.ChannelId;
                        existing.StationId = entity.StationId;
                        duplicateAssignmentsChanged = true;
                        _logger.LogDebug("[BATCH DEDUPLICATION] PID {Pid}, Result {Result}, StartTime {StartTime}: Channel {OldChannelId} -> {NewChannelId}",
                            existing.Pid, existing.Result, existing.StartTime, oldChannelId, existing.ChannelId);
                    }
                    resultDtos.Add(BuildResultDto(existing));
                }
                newEntities = toInsert;
            }

            if (newEntities.Count == 0 && duplicateAssignmentsChanged)
                await _db.SaveChangesAsync();

            if (newEntities.Count > 0)
            {
                try
                {
                    _db.PcbResults.AddRange(newEntities);
                    await _db.SaveChangesAsync();
                }
                catch (Exception ex)
                {
                    if (IsDatabaseCapacityFailure(ex))
                    {
                        _db.ChangeTracker.Clear();
                        throw;
                    }
                    _logger.LogWarning(ex, "[BATCH SUBMIT] Bulk save encountered issue, falling back to individual insert");
                    foreach (var entity in newEntities)
                    {
                        _db.Entry(entity).State = EntityState.Detached;
                    }
                    newEntities.Clear();
                    foreach (var req in requests)
                    {
                        try
                        {
                            var dto = await SubmitResultAsync(req);
                            resultDtos.Add(dto);
                        }
                        catch { }
                    }
                    return resultDtos;
                }

                foreach (var entity in newEntities)
                {
                    var hierarchy = _masterDataService.GetChannelHierarchy(entity.ChannelId);
                    var dto = new PcbResultDto(
                        entity.Id,
                        entity.ChannelId,
                        hierarchy?.ChannelName ?? "Unknown",
                        hierarchy?.IpAddress ?? "127.0.0.1",
                        entity.StationId,
                        hierarchy?.StationName ?? "Unknown",
                        hierarchy?.LineId ?? 1,
                        hierarchy?.LineName ?? "Unknown",
                        entity.Pid,
                        entity.Result,
                        entity.ErrorCode,
                        entity.GmesStatus,
                        entity.InspectTime,
                        entity.CreatedAt,
                        entity.JobFile,
                        entity.ModelId,
                        null,
                        entity.Fid,
                        entity.PcbaPartNo,
                        entity.StartTime,
                        entity.EndTime,
                        entity.TestTime,
                        entity.FilePath,
                        entity.TestSteps.Select(t => new TestStepInputDto
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
                    resultDtos.Add(dto);
                }

                // Only genuinely inserted rows affect live production counters;
                // duplicate rescans merely correct ownership and must not inflate KPIs.
                var insertedResultDtos = resultDtos.TakeLast(newEntities.Count).ToList();
                var latestDto = insertedResultDtos.LastOrDefault();
                if (latestDto != null)
                {
                    try
                    {
                        await _hubContext.Clients.All.ReceivePcbResult(latestDto);
                        await _hubContext.Clients.Group($"Line_{latestDto.LineId}").ReceivePcbResult(latestDto);
                        await _hubContext.Clients.Group($"Station_{latestDto.StationId}").ReceivePcbResult(latestDto);

                        // The representative result above updates the live log and
                        // accounts for one PCB. Send only the remaining aggregate
                        // so large batches update KPIs accurately without flooding
                        // SignalR with every result and its test steps.
                        var remaining = insertedResultDtos.Take(Math.Max(0, insertedResultDtos.Count - 1)).ToList();
                        if (remaining.Count > 0)
                        {
                            var deltaItems = remaining
                                    .GroupBy(x => new
                                    {
                                        x.LineId,
                                        x.StationId,
                                        Minute = new DateTime(x.InspectTime.Year, x.InspectTime.Month, x.InspectTime.Day,
                                            x.InspectTime.Hour, x.InspectTime.Minute, 0, x.InspectTime.Kind)
                                    })
                                    .Select(g => new
                                    {
                                        lineId = g.Key.LineId,
                                        stationId = g.Key.StationId,
                                        inspectTime = g.Key.Minute,
                                        total = g.Count(),
                                        ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                                        ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                                    }).ToList();
                            await BroadcastProductionDeltaAsync(deltaItems);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to broadcast SignalR notification for batch submit");
                    }
                }

                // These tasks are supplementary and intentionally run only
                // after SignalR has notified the Dashboard.
                try
                {
                    await EnsureJobFileMappingsAsync(newEntities.Select(x => x.JobFile));
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Job File mapping registration failed after PCB batch was saved and broadcast.");
                }

                var catalogGroups = newEntities
                    .Where(e => e.Result == "OK" || e.Result == "PASS")
                    .GroupBy(e => new { e.StationId, JobFile = e.JobFile ?? string.Empty });
                foreach (var group in catalogGroups)
                {
                    await TrySyncCpkStepCatalogAsync(group.Key.StationId, group.Key.JobFile,
                        group.SelectMany(e => e.TestSteps));
                }
            }

            return resultDtos;
        }

        private async Task BroadcastProductionDeltaAsync(object items)
        {
            await ProductionBroadcastGate.WaitAsync();
            try
            {
                await _hubContext.Clients.All.ReceiveProductionDelta(new
                {
                    version = Interlocked.Increment(ref _productionVersion),
                    items
                });
            }
            finally
            {
                ProductionBroadcastGate.Release();
            }
        }

        private PcbResultDto BuildResultDto(PcbResult entity)
        {
            var hierarchy = _masterDataService.GetChannelHierarchy(entity.ChannelId);
            return new PcbResultDto(entity.Id, entity.ChannelId,
                hierarchy?.ChannelName ?? $"Channel #{entity.ChannelId}", hierarchy?.IpAddress ?? string.Empty,
                entity.StationId, hierarchy?.StationName ?? $"Station #{entity.StationId}",
                hierarchy?.LineId ?? 0, hierarchy?.LineName ?? "Unknown Line",
                entity.Pid, entity.Result, entity.ErrorCode, entity.GmesStatus, entity.InspectTime, entity.CreatedAt,
                entity.JobFile, entity.ModelId, null, entity.Fid, entity.PcbaPartNo, entity.StartTime, entity.EndTime,
                entity.TestTime, entity.FilePath,
                entity.TestSteps.OrderBy(t => t.StepNumber).Select(t => new TestStepInputDto
                {
                    StepType = t.StepType, StepNumber = t.StepNumber, StepName = t.StepName,
                    Result = t.Result, Value = t.Value, SpecMin = t.SpecMin, SpecMax = t.SpecMax
                }).ToList());
        }

        public async Task<List<PcbResultDto>> GetLatestResultsAsync(
            int limit = 50, 
            int? lineId = null, 
            int? stationId = null,
            string? searchPid = null,
            string? searchError = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking().Include(p => p.TestSteps).AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }
            if (!string.IsNullOrWhiteSpace(searchError))
            {
                var errorTerm = searchError.Trim();
                query = query.Where(p => p.ErrorCode != null && EF.Functions.ILike(p.ErrorCode, $"%{errorTerm}%"));
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
            if (startDate.HasValue)
            {
                query = query.Where(p => p.InspectTime >= startDate.Value.ToUniversalTime());
            }
            if (endDate.HasValue)
            {
                query = query.Where(p => p.InspectTime <= endDate.Value.ToUniversalTime());
            }

            List<PcbResult> list;
            if (!string.IsNullOrWhiteSpace(searchPid))
            {
                var term = searchPid.Trim();
                // 1. Try fast prefix search first (e.g., term%) to hit idx_pcb_results_pid_pattern index (<10ms)
                var prefixQuery = query.Where(p => EF.Functions.Like(p.Pid, $"{term}%") || EF.Functions.Like(p.Pid, $"{term.ToUpper()}%"));
                var prefixList = await prefixQuery
                    .OrderByDescending(p => p.InspectTime)
                    .Take(limit)
                    .ToListAsync();

                if (prefixList.Count > 0)
                {
                    list = prefixList;
                }
                else
                {
                    // 2. Fallback to GIN trigram substring search (%term%) if no prefix matches
                    list = await query
                        .Where(p => EF.Functions.ILike(p.Pid, $"%{term}%"))
                        .OrderByDescending(p => p.InspectTime)
                        .Take(limit)
                        .ToListAsync();
                }
            }
            else
            {
                list = await query
                    .OrderByDescending(p => p.InspectTime)
                    .Take(limit)
                    .ToListAsync();
            }

            var results = new List<PcbResultDto>();
            foreach (var item in list)
            {
                var hierarchy = _masterDataService.GetChannelHierarchy(item.ChannelId);
                results.Add(new PcbResultDto(
                    item.Id,
                    item.ChannelId,
                    hierarchy?.ChannelName ?? (item.ChannelId > 0 ? $"Channel #{item.ChannelId}" : "Unassigned Channel"),
                    hierarchy?.IpAddress ?? "",
                    item.StationId,
                    hierarchy?.StationName ?? (item.StationId > 0 ? $"Station #{item.StationId}" : "Unassigned Station"),
                    hierarchy?.LineId ?? 0,
                    hierarchy?.LineName ?? (hierarchy?.LineId > 0 ? $"Line #{hierarchy.LineId}" : "Unassigned Line"),
                    item.Pid,
                    item.Result,
                    item.ErrorCode,
                    item.GmesStatus,
                    item.InspectTime,
                    item.CreatedAt,
                    item.JobFile,
                    item.ModelId,
                    null,
                    item.Fid,
                    item.PcbaPartNo,
                    item.StartTime,
                    item.EndTime,
                    item.TestTime,
                    item.FilePath,
                    item.TestSteps != null && item.TestSteps.Count > 0 ? item.TestSteps.OrderBy(t => t.StepNumber).Select(t => new TestStepInputDto {
                        StepType = t.StepType,
                        StepNumber = t.StepNumber,
                        StepName = t.StepName,
                        Result = t.Result,
                        Value = t.Value,
                        SpecMin = t.SpecMin,
                        SpecMax = t.SpecMax
                    }).ToList() : (string.Equals(item.Result, "NG", StringComparison.OrdinalIgnoreCase) || string.Equals(item.Result, "FAIL", StringComparison.OrdinalIgnoreCase) ? new List<TestStepInputDto> {
                        new TestStepInputDto {
                            StepNumber = 1,
                            StepName = !string.IsNullOrWhiteSpace(item.ErrorCode) ? item.ErrorCode : "DEFECT_UNSPECIFIED",
                            StepType = "ERROR_CODE",
                            Result = "NG",
                            Value = "-",
                            SpecMin = "-",
                            SpecMax = "-"
                        }
                    } : new List<TestStepInputDto>())
                ));
            }

            return results;
        }

        public async Task<int> GetExportCountAsync(
            int? lineId = null,
            int? stationId = null,
            string? searchPid = null,
            string? searchError = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue) query = query.Where(p => p.StationId == stationId.Value);
            if (!string.IsNullOrWhiteSpace(searchError))
            {
                var errorTerm = searchError.Trim();
                query = query.Where(p => p.ErrorCode != null && EF.Functions.ILike(p.ErrorCode, $"%{errorTerm}%"));
            }
            if (!string.IsNullOrWhiteSpace(searchPid))
            {
                var term = searchPid.Trim();
                query = query.Where(p => EF.Functions.ILike(p.Pid, $"%{term}%"));
            }
            if (!string.IsNullOrWhiteSpace(resultFilter) && resultFilter != "ALL")
            {
                if (resultFilter == "OK") query = query.Where(p => p.Result == "OK" || p.Result == "PASS");
                else if (resultFilter == "NG") query = query.Where(p => p.Result == "NG" || p.Result == "FAIL");
            }
            if (startDate.HasValue) query = query.Where(p => p.InspectTime >= startDate.Value.ToUniversalTime());
            if (endDate.HasValue) query = query.Where(p => p.InspectTime <= endDate.Value.ToUniversalTime());

            return await query.CountAsync();
        }

        public async Task<byte[]> GetExportCsvAsync(
            int? limit = null,
            int? lineId = null,
            int? stationId = null,
            string? searchPid = null,
            string? searchError = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue) query = query.Where(p => p.StationId == stationId.Value);
            if (!string.IsNullOrWhiteSpace(searchError))
            {
                var errorTerm = searchError.Trim();
                query = query.Where(p => p.ErrorCode != null && EF.Functions.ILike(p.ErrorCode, $"%{errorTerm}%"));
            }
            if (!string.IsNullOrWhiteSpace(searchPid))
            {
                var term = searchPid.Trim();
                query = query.Where(p => EF.Functions.ILike(p.Pid, $"%{term}%"));
            }
            if (!string.IsNullOrWhiteSpace(resultFilter) && resultFilter != "ALL")
            {
                if (resultFilter == "OK") query = query.Where(p => p.Result == "OK" || p.Result == "PASS");
                else if (resultFilter == "NG") query = query.Where(p => p.Result == "NG" || p.Result == "FAIL");
            }
            if (startDate.HasValue) query = query.Where(p => p.InspectTime >= startDate.Value.ToUniversalTime());
            if (endDate.HasValue) query = query.Where(p => p.InspectTime <= endDate.Value.ToUniversalTime());

            query = query.OrderByDescending(p => p.InspectTime);

            if (limit.HasValue && limit.Value > 0)
            {
                query = query.Take(limit.Value);
            }

            var list = await query
                .Include(p => p.TestSteps)
                .ToListAsync();

            var sb = new System.Text.StringBuilder();
            sb.Append('\uFEFF'); // UTF-8 BOM for Excel compatibility

            sb.AppendLine("\"ID\",\"Mã PCB (PID)\",\"Tên Lỗi (Defect Name)\",\"Tên Channel (Máy)\",\"Địa chỉ IP Channel\",\"Dây Chuyền (Line)\",\"Trạm (Station)\",\"Ngày Test\",\"Giờ Test\",\"Kết quả (Result)\",\"JobFile / Model\",\"Chi tiết Lỗi (Failed Steps)\"");

            foreach (var item in list)
            {
                var hierarchy = _masterDataService.GetChannelHierarchy(item.ChannelId);
                var inspectTimeLocal = item.InspectTime.ToLocalTime();
                var dateStr = inspectTimeLocal.ToString("yyyy-MM-dd");
                var timeStr = inspectTimeLocal.ToString("HH:mm:ss");

                string jobFile = item.JobFile ?? "";
                if (string.IsNullOrWhiteSpace(jobFile) && !string.IsNullOrWhiteSpace(item.Pid))
                {
                    var parts = item.Pid.Split(new[] { '-', '_', '/' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length > 1) jobFile = parts[0];
                    else jobFile = item.Pid;
                }
                if (string.IsNullOrWhiteSpace(jobFile)) jobFile = "DEFAULT_JOB";

                string errorCode = item.ErrorCode ?? (item.Result == "NG" || item.Result == "FAIL" ? "DEFECT_UNSPECIFIED" : "OK");

                var failedSteps = item.TestSteps
                    .Where(t => t.Result != "OK" && t.Result != "PASS")
                    .Select(t => {
                        var name = t.StepName ?? "";
                        var val = !string.IsNullOrWhiteSpace(t.Value) ? t.Value : "NG";
                        var hasSpec = !string.IsNullOrWhiteSpace(t.SpecMin) || !string.IsNullOrWhiteSpace(t.SpecMax);
                        var specStr = hasSpec ? $" [Min: {t.SpecMin ?? "-"}, Max: {t.SpecMax ?? "-"}]" : "";
                        return string.IsNullOrEmpty(name) ? $"{val}{specStr}" : $"{name}: {val}{specStr}";
                    })
                    .ToList();
                string failedStepsStr = failedSteps.Count > 0 ? string.Join("; ", failedSteps) : (item.Result == "NG" ? (item.ErrorCode != null ? $"Lỗi hệ thống ({item.ErrorCode})" : "Lỗi tổng hợp") : "N/A");

                var channelName = hierarchy?.ChannelName ?? (item.ChannelId > 0 ? $"Channel #{item.ChannelId}" : "Unassigned Channel");
                var lineName = hierarchy?.LineName ?? (hierarchy?.LineId > 0 ? $"Line #{hierarchy.LineId}" : "Unassigned Line");
                var stationName = hierarchy?.StationName ?? (item.StationId > 0 ? $"Station #{item.StationId}" : "Unassigned Station");

                sb.AppendLine($"\"{item.Id}\",\"{EscapeCsv(item.Pid)}\",\"{EscapeCsv(errorCode)}\",\"{EscapeCsv(channelName)}\",\"{EscapeCsv(hierarchy?.IpAddress ?? "")}\",\"{EscapeCsv(lineName)}\",\"{EscapeCsv(stationName)}\",\"{dateStr}\",\"{timeStr}\",\"{item.Result}\",\"{EscapeCsv(jobFile)}\",\"{EscapeCsv(failedStepsStr)}\"");
            }

            return System.Text.Encoding.UTF8.GetBytes(sb.ToString());
        }

        private static string EscapeCsv(string str)
        {
            if (string.IsNullOrEmpty(str)) return "";
            return str.Replace("\"", "\"\"");
        }

        public async Task<List<HourlyStatDto>> GetHourlyStatsAsync(
            int hours = 24, 
            int? lineId = null, 
            int? stationId = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }

            if (startDate.HasValue)
            {
                var utcStart = EnsureUtc(startDate.Value);
                query = query.Where(p => p.InspectTime >= utcStart);
            }
            else if (hours > 0)
            {
                var nowUtc = DateTime.UtcNow;
                var cutoff = nowUtc.AddHours(-hours);
                query = query.Where(p => p.InspectTime >= cutoff && p.InspectTime <= nowUtc);
            }

            if (endDate.HasValue)
            {
                var utcEnd = EnsureUtc(endDate.Value);
                query = query.Where(p => p.InspectTime <= utcEnd);
            }

            var grouped = await query
                .GroupBy(p => new {
                    Year = p.InspectTime.Year,
                    Month = p.InspectTime.Month,
                    Day = p.InspectTime.Day,
                    Hour = p.InspectTime.Hour
                })
                .Select(g => new {
                    g.Key.Year,
                    g.Key.Month,
                    g.Key.Day,
                    g.Key.Hour,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .OrderBy(g => g.Year).ThenBy(g => g.Month).ThenBy(g => g.Day).ThenBy(g => g.Hour)
                .ToListAsync();

            return grouped.Select(g => {
                var dt = new DateTime(g.Year, g.Month, g.Day, g.Hour, 0, 0, DateTimeKind.Utc);
                return new HourlyStatDto(
                    dt,
                    lineId ?? 0,
                    stationId ?? 0,
                    g.Total,
                    g.Ok,
                    g.Ng,
                    g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0
                );
            }).ToList();
        }

        public async Task<ProductionSummaryDto> GetSummaryAsync(
            int? lineId = null,
            int? stationId = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }
            if (startDate.HasValue)
            {
                var utcStart = EnsureUtc(startDate.Value);
                query = query.Where(p => p.InspectTime >= utcStart);
            }
            if (endDate.HasValue)
            {
                var utcEnd = EnsureUtc(endDate.Value);
                query = query.Where(p => p.InspectTime <= utcEnd);
            }

            var stats = await query
                .GroupBy(x => 1)
                .Select(g => new {
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .SingleOrDefaultAsync();

            int totalInspected = stats?.Total ?? 0;
            int totalOk = stats?.Ok ?? 0;
            int totalNg = stats?.Ng ?? 0;

            var yieldRate = totalInspected > 0 ? Math.Round((double)totalOk / totalInspected * 100.0, 2) : 0.0;
            var activeChannels = (await _masterDataService.GetChannelsAsync()).Count(c => c.Status == "online");
            var recentHourly = await GetHourlyStatsAsync(24, lineId, stationId, startDate, endDate);

            return new ProductionSummaryDto(
                totalInspected,
                totalOk,
                totalNg,
                yieldRate,
                activeChannels,
                recentHourly
            );
        }

        public async Task<ProductionCounterDto> GetCountersAsync(
            int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null)
        {
            var cacheKey = $"production-counters:{lineId}:{stationId}:{startDate?.Ticks}:{endDate?.Ticks}";
            return await _memoryCache.GetOrCreateAsync(cacheKey, async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(2);
                var query = _db.PcbResults.AsNoTracking().AsQueryable();
                if (lineId.HasValue)
                {
                    var stationIds = (await _masterDataService.GetStationsAsync())
                        .Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                    query = query.Where(p => stationIds.Contains(p.StationId));
                }
                if (stationId.HasValue) query = query.Where(p => p.StationId == stationId.Value);
                if (startDate.HasValue)
                {
                    var start = EnsureUtc(startDate.Value);
                    query = query.Where(p => p.InspectTime >= start);
                }
                if (endDate.HasValue)
                {
                    var end = EnsureUtc(endDate.Value);
                    query = query.Where(p => p.InspectTime <= end);
                }
                var stats = await query.GroupBy(_ => 1).Select(g => new
                {
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                }).SingleOrDefaultAsync();
                var total = stats?.Total ?? 0;
                var ok = stats?.Ok ?? 0;
                var ng = stats?.Ng ?? 0;
                return new ProductionCounterDto(total, ok, ng,
                    total > 0 ? Math.Round((double)ok / total * 100.0, 2) : 0.0);
            }) ?? new ProductionCounterDto(0, 0, 0, 0);
        }

        public async Task<List<LineYieldStatDto>> GetLineYieldStatsAsync(
            int? lineId = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var stations = await _masterDataService.GetStationsAsync();
            var lines = await _masterDataService.GetLinesAsync();
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var lineStationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => lineStationIds.Contains(p.StationId));
            }
            if (startDate.HasValue)
            {
                var utcStart = EnsureUtc(startDate.Value);
                query = query.Where(p => p.InspectTime >= utcStart);
            }
            if (endDate.HasValue)
            {
                var utcEnd = EnsureUtc(endDate.Value);
                query = query.Where(p => p.InspectTime <= utcEnd);
            }

            var stationStats = await query
                .GroupBy(p => p.StationId)
                .Select(g => new {
                    StationId = g.Key,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .ToListAsync();

            var lineGroups = stationStats
                .Select(stStat => {
                    var st = stations.FirstOrDefault(s => s.Id == stStat.StationId);
                    return new { LineId = st?.LineId ?? 0, stStat.Total, stStat.Ok, stStat.Ng };
                })
                .GroupBy(x => x.LineId)
                .Select(g => new {
                    LineId = g.Key,
                    Total = g.Sum(x => x.Total),
                    Ok = g.Sum(x => x.Ok),
                    Ng = g.Sum(x => x.Ng)
                });

            var result = new List<LineYieldStatDto>();
            foreach (var g in lineGroups)
            {
                var lineName = lines.FirstOrDefault(l => l.Id == g.LineId)?.Name ?? $"Line {g.LineId}";
                var yieldRate = g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0;
                result.Add(new LineYieldStatDto(g.LineId, lineName, g.Total, g.Ok, g.Ng, yieldRate));
            }

            return result.OrderByDescending(r => r.Total).ToList();
        }

        public async Task<List<StationYieldStatDto>> GetStationYieldStatsAsync(
            int? lineId = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var stations = await _masterDataService.GetStationsAsync();
            var lines = await _masterDataService.GetLinesAsync();
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var lineStationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => lineStationIds.Contains(p.StationId));
            }
            if (startDate.HasValue)
            {
                var utcStart = EnsureUtc(startDate.Value);
                query = query.Where(p => p.InspectTime >= utcStart);
            }
            if (endDate.HasValue)
            {
                var utcEnd = EnsureUtc(endDate.Value);
                query = query.Where(p => p.InspectTime <= utcEnd);
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

        public async Task<List<DefectParetoStatDto>> GetDefectParetoAsync(
            int? lineId = null, 
            int? stationId = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking()
                .Where(p => p.Result == "NG" || p.Result == "FAIL");

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }
            if (startDate.HasValue)
            {
                var utcStart = EnsureUtc(startDate.Value);
                query = query.Where(p => p.InspectTime >= utcStart);
            }
            if (endDate.HasValue)
            {
                var utcEnd = EnsureUtc(endDate.Value);
                query = query.Where(p => p.InspectTime <= utcEnd);
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

        public async Task<BiAnalyticsMatrixDto> GetBiMatrixAsync(
            int? lineId = null,
            int? stationId = null,
            int? channelId = null,
            int? modelId = null,
            string? errorCode = null,
            string? jobFile = null,
            DateTime? startDate = null,
            DateTime? endDate = null,
            int hours = 24)
        {
            var cacheKey = string.Join('|', "bi-matrix-v5", lineId, stationId, channelId, modelId,
                errorCode ?? "", jobFile ?? "", startDate?.Ticks, endDate?.Ticks, hours);
            if (_memoryCache.TryGetValue<BiAnalyticsMatrixDto>(cacheKey, out var cachedMatrix)
                && cachedMatrix != null)
            {
                return cachedMatrix;
            }

            var stations = await _masterDataService.GetStationsAsync();
            var lines = await _masterDataService.GetLinesAsync();
            var channels = await _masterDataService.GetChannelsAsync();

            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var lineStationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => lineStationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }
            if (channelId.HasValue)
            {
                query = query.Where(p => p.ChannelId == channelId.Value);
            }
            if (modelId.HasValue)
            {
                var mappedJobFiles = await _db.JobFileModelMappings.AsNoTracking()
                    .Where(mapping => mapping.ModelId == modelId.Value)
                    .Select(mapping => mapping.JobFile)
                    .ToListAsync();
                query = query.Where(p => p.ModelId == modelId.Value ||
                    (p.JobFile != null && mappedJobFiles.Contains(p.JobFile)));
            }
            if (!string.IsNullOrWhiteSpace(jobFile))
            {
                query = query.Where(p => p.JobFile == jobFile);
            }
            if (startDate.HasValue)
            {
                var utcStart = EnsureUtc(startDate.Value);
                query = query.Where(p => p.InspectTime >= utcStart);
            }
            else if (hours > 0)
            {
                var nowUtc = DateTime.UtcNow;
                var cutoff = nowUtc.AddHours(-hours);
                query = query.Where(p => p.InspectTime >= cutoff && p.InspectTime <= nowUtc);
            }
            if (endDate.HasValue)
            {
                var utcEnd = EnsureUtc(endDate.Value);
                query = query.Where(p => p.InspectTime <= utcEnd);
            }

            // Keep the production scope intact for Total/OK. A selected defect is
            // a cross-filter for NG occurrences, not the denominator of production.
            var scopeQuery = query;
            if (!string.IsNullOrWhiteSpace(errorCode))
            {
                query = query.Where(p => p.ErrorCode == errorCode);
            }

            // 1. Overall Summary
            var summary = await scopeQuery
                .GroupBy(x => 1)
                .Select(g => new {
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .SingleOrDefaultAsync();

            long totalInspected = summary?.Total ?? 0;
            long totalOk = summary?.Ok ?? 0;
            long totalNg = !string.IsNullOrWhiteSpace(errorCode)
                ? await query.LongCountAsync(p => p.Result == "NG" || p.Result == "FAIL")
                : summary?.Ng ?? 0;
            double overallYieldRate = totalInspected > 0 ? Math.Round((double)totalOk / totalInspected * 100.0, 2) : 0.0;

            // 2. Time Trend (Hourly)
            var hourlyGrouped = await scopeQuery
                .GroupBy(p => new {
                    Year = p.InspectTime.Year,
                    Month = p.InspectTime.Month,
                    Day = p.InspectTime.Day,
                    Hour = p.InspectTime.Hour
                })
                .Select(g => new {
                    g.Key.Year, g.Key.Month, g.Key.Day, g.Key.Hour,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = !string.IsNullOrWhiteSpace(errorCode)
                        ? g.Count(x => x.ErrorCode == errorCode && (x.Result == "NG" || x.Result == "FAIL"))
                        : g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .OrderBy(g => g.Year).ThenBy(g => g.Month).ThenBy(g => g.Day).ThenBy(g => g.Hour)
                .ToListAsync();

            var timeTrend = hourlyGrouped.Select(g => {
                var dt = new DateTime(g.Year, g.Month, g.Day, g.Hour, 0, 0, DateTimeKind.Utc);
                return new HourlyStatDto(
                    dt,
                    lineId ?? 0,
                    stationId ?? 0,
                    g.Total,
                    g.Ok,
                    g.Ng,
                    g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0
                );
            }).ToList();

            // 3. Station Stats & Line Stats
            var stationGrouped = await scopeQuery
                .GroupBy(p => p.StationId)
                .Select(g => new {
                    StationId = g.Key,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = !string.IsNullOrWhiteSpace(errorCode)
                        ? g.Count(x => x.ErrorCode == errorCode && (x.Result == "NG" || x.Result == "FAIL"))
                        : g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .ToListAsync();

            var stationStats = new List<StationYieldStatDto>();
            foreach (var stStat in stationGrouped)
            {
                var st = stations.FirstOrDefault(s => s.Id == stStat.StationId);
                var stName = st?.Name ?? $"Station {stStat.StationId}";
                var lId = st?.LineId ?? 0;
                var lName = lines.FirstOrDefault(l => l.Id == lId)?.Name ?? $"Line {lId}";
                var yieldRate = stStat.Total > 0 ? Math.Round((double)stStat.Ok / stStat.Total * 100.0, 2) : 0.0;
                stationStats.Add(new StationYieldStatDto(stStat.StationId, stName, lId, lName, stStat.Total, stStat.Ok, stStat.Ng, yieldRate));
            }
            stationStats = stationStats.OrderBy(r => r.YieldRate).ToList();

            var lineGrouped = stationGrouped
                .Select(stStat => {
                    var st = stations.FirstOrDefault(s => s.Id == stStat.StationId);
                    return new { LineId = st?.LineId ?? 0, stStat.Total, stStat.Ok, stStat.Ng };
                })
                .GroupBy(x => x.LineId)
                .Select(g => new {
                    LineId = g.Key,
                    Total = g.Sum(x => x.Total),
                    Ok = g.Sum(x => x.Ok),
                    Ng = g.Sum(x => x.Ng)
                });

            var lineStats = new List<LineYieldStatDto>();
            foreach (var g in lineGrouped)
            {
                var lName = lines.FirstOrDefault(l => l.Id == g.LineId)?.Name ?? $"Line {g.LineId}";
                var yieldRate = g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0;
                lineStats.Add(new LineYieldStatDto(g.LineId, lName, g.Total, g.Ok, g.Ng, yieldRate));
            }
            lineStats = lineStats.OrderBy(r => r.LineName).ToList();

            stationStats = stationStats.OrderBy(r => r.YieldRate).Take(10).ToList();

            // 4. Machine / Channel Stats
            var channelGrouped = await scopeQuery
                .GroupBy(p => p.ChannelId)
                .Where(g => g.Count() >= 10)
                .Select(g => new {
                    ChannelId = g.Key,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = !string.IsNullOrWhiteSpace(errorCode)
                        ? g.Count(x => x.ErrorCode == errorCode && (x.Result == "NG" || x.Result == "FAIL"))
                        : g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .ToListAsync();

            var machineStats = new List<ChannelYieldStatDto>();
            foreach (var chStat in channelGrouped)
            {
                var ch = channels.FirstOrDefault(c => c.Id == chStat.ChannelId);
                var st = stations.FirstOrDefault(s => s.Id == ch?.StationId);
                var lName = lines.FirstOrDefault(l => l.Id == st?.LineId)?.Name ?? "Unknown Line";
                var yieldRate = chStat.Total > 0 ? Math.Round((double)chStat.Ok / chStat.Total * 100.0, 2) : 0.0;
                machineStats.Add(new ChannelYieldStatDto(
                    chStat.ChannelId,
                    ch?.Name ?? $"Channel #{chStat.ChannelId}",
                    ch?.IpAddress ?? "",
                    ch?.StationId ?? 0,
                    st?.Name ?? "Unknown Station",
                    st?.LineId ?? 0,
                    lName,
                    chStat.Total,
                    chStat.Ok,
                    chStat.Ng,
                    yieldRate
                ));
            }
            machineStats = machineStats.OrderBy(r => r.YieldRate).Take(10).ToList();

            // 5. Defect Pareto Stats (Error Codes)
            var ngQuery = scopeQuery.Where(p => p.Result == "NG" || p.Result == "FAIL");
            var defectGrouped = await ngQuery
                .GroupBy(p => p.ErrorCode ?? "DEFECT_UNSPECIFIED")
                .Select(g => new {
                    Code = g.Key,
                    Count = g.Count()
                })
                .OrderByDescending(g => g.Count)
                .Take(20)
                .ToListAsync();

            long totalNgQuery = defectGrouped.Sum(g => (long)g.Count);

            var defectStats = defectGrouped.Select(g => new DefectParetoStatDto(
                g.Code,
                g.Count,
                totalNgQuery > 0 ? Math.Round((double)g.Count / totalNgQuery * 100.0, 2) : 0.0
            )).ToList();

            // 6. Job File Stats
            var jobGrouped = await scopeQuery
                .GroupBy(p => p.JobFile ?? "DEFAULT_JOB")
                .Select(g => new {
                    JobFile = g.Key,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .ToListAsync();

            Dictionary<string, long>? selectedDefectByJob = null;
            if (!string.IsNullOrWhiteSpace(errorCode))
            {
                selectedDefectByJob = await query
                    .Where(p => p.Result == "NG" || p.Result == "FAIL")
                    .GroupBy(p => p.JobFile ?? "DEFAULT_JOB")
                    .ToDictionaryAsync(g => g.Key, g => g.LongCount());
            }

            var jobFileStats = jobGrouped.Select(g => {
                var displayedNg = selectedDefectByJob != null
                    ? selectedDefectByJob.GetValueOrDefault(g.JobFile, 0)
                    : g.Ng;
                var yieldRate = g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0;
                var defectRate = g.Total > 0 ? Math.Round(displayedNg * 100.0 / g.Total, 2) : 0.0;
                return new JobFileYieldStatDto(g.JobFile, g.Total, g.Ok, displayedNg, yieldRate, defectRate);
            })
            .Where(g => g.Total >= 10)
            .OrderByDescending(g => g.DefectRate)
            .ThenByDescending(g => g.Ng)
            .ThenBy(g => g.JobFile)
            .Take(15)
            .ToList();

            var mappings = await _db.JobFileModelMappings.AsNoTracking().Include(x => x.Model)
                .Where(x => x.ModelId != null && x.Model != null).ToListAsync();
            var mappingByJob = mappings
                .Where(x => !string.IsNullOrWhiteSpace(x.JobFile))
                .GroupBy(x => x.JobFile.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderByDescending(x => x.UpdatedAt).ThenByDescending(x => x.Id).First(),
                    StringComparer.OrdinalIgnoreCase);
            var modelStats = jobGrouped
                .Where(g => mappingByJob.ContainsKey(g.JobFile.Trim()))
                .Select(g => {
                    var mapping = mappingByJob[g.JobFile.Trim()];
                    var displayedNg = selectedDefectByJob != null ? selectedDefectByJob.GetValueOrDefault(g.JobFile, 0) : g.Ng;
                    return new { ModelId = mapping.ModelId!.Value, ModelName = mapping.Model?.Name ?? $"Model #{mapping.ModelId}", g.Total, g.Ok, Ng = displayedNg };
                })
                .GroupBy(x => new { x.ModelId, x.ModelName })
                .Select(g => {
                    var total = g.Sum(x => (long)x.Total);
                    var ok = g.Sum(x => (long)x.Ok);
                    var ng = g.Sum(x => x.Ng);
                    return new ModelYieldStatDto(g.Key.ModelId, g.Key.ModelName, total, ok, ng,
                        total > 0 ? Math.Round(ok * 100.0 / total, 2) : 0,
                        total > 0 ? Math.Round(ng * 100.0 / total, 2) : 0);
                })
                .Where(x => x.Total >= 10)
                .OrderByDescending(x => x.DefectRate)
                .ThenByDescending(x => x.Ng)
                .ToList();

            var matrix = new BiAnalyticsMatrixDto(
                totalInspected,
                totalOk,
                totalNg,
                overallYieldRate,
                timeTrend,
                lineStats,
                modelStats,
                stationStats,
                machineStats,
                defectStats,
                jobFileStats
            );
            _memoryCache.Set(cacheKey, matrix, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2),
                SlidingExpiration = TimeSpan.FromSeconds(45)
            });
            return matrix;
        }

        private async Task EnsureJobFileMappingsAsync(IEnumerable<string?> jobFiles)
        {
            foreach (var jobFile in jobFiles
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x!.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase))
            {
                await _db.Database.ExecuteSqlInterpolatedAsync($@"
                    INSERT INTO job_file_model_mappings (job_file, model_id, created_at, updated_at)
                    VALUES ({jobFile}, NULL, NOW(), NOW())
                    ON CONFLICT (job_file) DO NOTHING");
            }
        }

        private static DateTime EnsureUtc(DateTime dt)
        {
            if (dt.Kind == DateTimeKind.Unspecified)
                return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
            return dt.ToUniversalTime();
        }

        private static DateTime? EnsureUtc(DateTime? dt)
        {
            if (!dt.HasValue) return null;
            return EnsureUtc(dt.Value);
        }

        private static string? CleanDbText(string? value)
        {
            return value?.Replace("\0", string.Empty);
        }

        private static bool IsDatabaseCapacityFailure(Exception ex)
        {
            for (Exception? current = ex; current != null; current = current.InnerException)
            {
                if (current is NpgsqlException || current is TimeoutException)
                {
                    var message = current.Message;
                    if (message.Contains("connection pool", StringComparison.OrdinalIgnoreCase) ||
                        message.Contains("timed out", StringComparison.OrdinalIgnoreCase) ||
                        message.Contains("transient failure", StringComparison.OrdinalIgnoreCase))
                        return true;
                }
            }
            return false;
        }

        public async Task<List<CpkStepOptionDto>> GetCpkStepsAsync(int channelId)
        {
            var fromDate = MonthStartUtc();
            var rows = await _db.TestSteps.AsNoTracking()
                .Where(s => s.PcbResult != null
                    && s.PcbResult.ChannelId == channelId
                    && (s.PcbResult.Result == "OK" || s.PcbResult.Result == "PASS")
                    && s.PcbResult.InspectTime >= fromDate)
                .Select(s => new { s.StepNumber, s.StepName, s.StepType })
                .Distinct()
                .OrderBy(s => s.StepNumber)
                .ThenBy(s => s.StepName)
                .ToListAsync();
            return rows.Select(s => new CpkStepOptionDto(s.StepNumber, s.StepName, s.StepType, string.Empty)).ToList();
        }

        public async Task<List<CpkStepOptionDto>> GetStationCpkStepsAsync(int stationId)
        {
            return await _db.CpkStepCatalog.AsNoTracking()
                .Where(s => s.StationId == stationId)
                .OrderBy(s => s.JobFile).ThenBy(s => s.StepNumber).ThenBy(s => s.StepName)
                .Select(s => new CpkStepOptionDto(s.StepNumber, s.StepName, s.StepType, s.JobFile))
                .ToListAsync();
        }

        public async Task<CpkAnalysisDto> GetCpkAnalysisAsync(int channelId, int stepNumber, string stepName, string? jobFile, int limit = 50, bool forceRefresh = false)
        {
            limit = Math.Clamp(limit, 2, 50);
            var fromDate = MonthStartUtc();
            var normalizedJobFile = jobFile ?? string.Empty;
            if (!forceRefresh)
            {
                var cached = await _db.CpkResultCache.AsNoTracking().FirstOrDefaultAsync(c =>
                    c.ChannelId == channelId && c.JobFile == normalizedJobFile
                    && c.StepNumber == stepNumber && c.StepName == stepName && c.FromDate == fromDate);
                if (cached != null)
                {
                    return new CpkAnalysisDto(channelId, stepNumber, stepName, cached.FromDate,
                        cached.SampleCount, cached.SpecMin, cached.SpecMax, cached.Mean,
                        cached.StandardDeviation, cached.Cpl, cached.Cpu, cached.Cpk,
                        JsonSerializer.Deserialize<List<CpkPointDto>>(cached.PointsJson) ?? new());
                }
            }
            var rows = await _db.TestSteps.AsNoTracking()
                .Where(s => s.PcbResult != null
                    && s.PcbResult.ChannelId == channelId
                    && (s.PcbResult.Result == "OK" || s.PcbResult.Result == "PASS")
                    && s.PcbResult.InspectTime >= fromDate
                    && s.StepNumber == stepNumber
                    && s.StepName == stepName
                    && (string.IsNullOrEmpty(jobFile) || s.PcbResult.JobFile == jobFile))
                .OrderByDescending(s => s.PcbResult!.InspectTime)
                .Take(500)
                .Select(s => new { s.PcbResult!.Pid, s.PcbResult.InspectTime, s.Value, s.SpecMin, s.SpecMax })
                .ToListAsync();

            var numericRows = rows
                .Select(r => new { Row = r, Value = ParseMeasurement(r.Value) })
                .Where(x => x.Value.HasValue)
                .Take(limit)
                .ToList();
            var values = numericRows.Select(x => x.Value!.Value).ToList();
            var specSource = numericRows.Select(x => x.Row)
                .FirstOrDefault(r => ParseMeasurement(r.SpecMin).HasValue && ParseMeasurement(r.SpecMax).HasValue);
            double? specMin = ParseMeasurement(specSource?.SpecMin);
            double? specMax = ParseMeasurement(specSource?.SpecMax);
            double? mean = values.Count > 0 ? values.Average() : null;
            double? stdDev = values.Count > 1
                ? Math.Sqrt(values.Sum(v => Math.Pow(v - mean!.Value, 2)) / (values.Count - 1))
                : null;
            double? cpl = null, cpu = null, cpk = null;
            if (mean.HasValue && stdDev is > 0 && specMin.HasValue && specMax.HasValue)
            {
                cpl = (mean.Value - specMin.Value) / (3 * stdDev.Value);
                cpu = (specMax.Value - mean.Value) / (3 * stdDev.Value);
                cpk = Math.Min(cpl.Value, cpu.Value);
            }

            var points = numericRows
                .OrderBy(x => x.Row.InspectTime)
                .Select(x => new CpkPointDto(x.Row.Pid, x.Row.InspectTime, x.Value!.Value))
                .ToList();
            var analysis = new CpkAnalysisDto(channelId, stepNumber, stepName, fromDate, values.Count,
                specMin, specMax, mean, stdDev, cpl, cpu, cpk, points);
            var cache = await _db.CpkResultCache.FirstOrDefaultAsync(c =>
                c.ChannelId == channelId && c.JobFile == normalizedJobFile
                && c.StepNumber == stepNumber && c.StepName == stepName && c.FromDate == fromDate);
            if (cache == null)
            {
                cache = new CpkResultCache { ChannelId = channelId, JobFile = normalizedJobFile,
                    StepNumber = stepNumber, StepName = stepName, FromDate = fromDate };
                _db.CpkResultCache.Add(cache);
            }
            cache.SampleCount = values.Count; cache.SpecMin = specMin; cache.SpecMax = specMax;
            cache.Mean = mean; cache.StandardDeviation = stdDev; cache.Cpl = cpl; cache.Cpu = cpu; cache.Cpk = cpk;
            cache.PointsJson = JsonSerializer.Serialize(points); cache.CalculatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            _memoryCache.Remove("cpk-overview-latest-history");
            return analysis;
        }

        public async Task<List<CpkCacheOverviewDto>> GetCpkOverviewAsync()
        {
            return await _memoryCache.GetOrCreateAsync("cpk-overview-latest-history", async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromDays(1);
                var latest = await _db.CpkResultHistory.FromSqlRaw(@"
                    SELECT DISTINCT ON (channel_id, job_file, step_number, step_name) *
                    FROM cpk_result_history
                    ORDER BY channel_id, job_file, step_number, step_name, calculation_date DESC")
                    .AsNoTracking().ToListAsync();
                return latest.Select(c => new CpkCacheOverviewDto(c.ChannelId, c.JobFile, c.StepNumber,
                    c.StepName, c.SampleCount, c.SpecMin, c.SpecMax, c.Mean,
                    c.StandardDeviation, c.Cpl, c.Cpu, c.Cpk, c.CalculatedAt)).ToList();
            }) ?? new List<CpkCacheOverviewDto>();
        }

        private static DateTime MonthStartUtc()
        {
            var now = DateTime.UtcNow;
            return new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        }

        private async Task SyncCpkStepCatalogAsync(int stationId, string? jobFile, IEnumerable<TestStep> steps, CancellationToken cancellationToken = default)
        {
            var eligible = steps
                .Where(s => !string.IsNullOrWhiteSpace(s.StepName)
                    && !string.IsNullOrWhiteSpace(s.Value)
                    && !string.IsNullOrWhiteSpace(s.SpecMin)
                    && !string.IsNullOrWhiteSpace(s.SpecMax))
                .GroupBy(s => new { s.StepNumber, s.StepName })
                .Select(g => g.First());

            foreach (var step in eligible)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync($@"
                    INSERT INTO cpk_step_catalog (station_id, job_file, step_number, step_name, step_type, updated_at)
                    VALUES ({stationId}, {jobFile ?? string.Empty}, {step.StepNumber}, {step.StepName}, {step.StepType}, NOW())
                    ON CONFLICT (station_id, job_file, step_number, step_name)
                    DO UPDATE SET step_type = EXCLUDED.step_type, updated_at = NOW()", cancellationToken);
            }
        }

        private async Task TrySyncCpkStepCatalogAsync(int stationId, string? jobFile, IEnumerable<TestStep> steps)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await SyncCpkStepCatalogAsync(stationId, jobFile, steps, timeout.Token);
            }
            catch (OperationCanceledException)
            {
                _logger.LogWarning("CPK catalog sync timed out for StationId={StationId}, JobFile={JobFile}; PCB data was saved successfully.", stationId, jobFile);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "CPK catalog sync skipped for StationId={StationId}, JobFile={JobFile}; PCB data was saved successfully.", stationId, jobFile);
            }
        }

        private static double? ParseMeasurement(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var match = Regex.Match(text.Trim(), @"[-+]?\d+(?:[\.,]\d+)?");
            if (!match.Success) return null;
            return double.TryParse(match.Value.Replace(',', '.'), NumberStyles.Float,
                CultureInfo.InvariantCulture, out var value) ? value : null;
        }
    }
}
