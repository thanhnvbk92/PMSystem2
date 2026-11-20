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
        Task<List<ExistingPcbKey>> FindExistingAsync(List<ExistingPcbQuery> keys);
        Task<List<PcbResultDto>> GetLatestResultsAsync(int limit = 50, int? lineId = null, int? stationId = null, string? searchPid = null, string? searchFid = null, string? searchError = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null, IReadOnlyCollection<int>? lineIds = null, IReadOnlyCollection<int>? stationIds = null, IReadOnlyCollection<int>? channelIds = null);
        Task<int> GetExportCountAsync(int? lineId = null, int? stationId = null, string? searchPid = null, string? searchFid = null, string? searchError = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null, IReadOnlyCollection<int>? lineIds = null, IReadOnlyCollection<int>? stationIds = null, IReadOnlyCollection<int>? channelIds = null);
        Task<byte[]> GetExportCsvAsync(int? limit = null, int? lineId = null, int? stationId = null, string? searchPid = null, string? searchFid = null, string? searchError = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null, IReadOnlyCollection<int>? lineIds = null, IReadOnlyCollection<int>? stationIds = null, IReadOnlyCollection<int>? channelIds = null);
        Task<List<HourlyStatDto>> GetHourlyStatsAsync(int hours = 24, int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<ProductionSummaryDto> GetSummaryAsync(int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<ProductionCounterDto> GetCountersAsync(int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<QualityModeSummaryDto> GetQualityModesAsync(int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<List<LineYieldStatDto>> GetLineYieldStatsAsync(int? lineId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<List<StationYieldStatDto>> GetStationYieldStatsAsync(int? lineId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<List<DefectParetoStatDto>> GetDefectParetoAsync(int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<BiAnalyticsMatrixDto> GetBiMatrixAsync(int? lineId = null, int? stationId = null, int? channelId = null, int? modelId = null, string? errorCode = null, string? jobFile = null, DateTime? startDate = null, DateTime? endDate = null, int hours = 24);
        Task<List<CpkStepOptionDto>> GetCpkStepsAsync(int channelId);
        Task<List<CpkStepOptionDto>> GetStationCpkStepsAsync(int stationId);
        Task<CpkAnalysisDto> GetCpkAnalysisAsync(int channelId, int stepNumber, string stepName, string? jobFile, int limit = 50, bool forceRefresh = false);
        Task<List<CpkCacheOverviewDto>> GetCpkOverviewAsync();
        Task<byte[]> GetCpkReportAsync(CancellationToken cancellationToken = default);
    }

    public partial class PcbService : IPcbService
    {
        private static long _productionVersion;
        private static readonly SemaphoreSlim ProductionBroadcastGate = new(1, 1);
        private readonly AppDbContext _db;
        private readonly IMasterDataService _masterDataService;
        private readonly IHubContext<ProductionHub, IProductionClient> _hubContext;
        private readonly ILogger<PcbService> _logger;
        private readonly IMemoryCache _memoryCache;
        private readonly PMSystem2.Api.Services.Cpk.CpkEngine _cpkEngine;
        private readonly QualitySummaryQueue _qualitySummaryQueue;

        public PcbService(
            AppDbContext db,
            IMasterDataService masterDataService,
            IHubContext<ProductionHub, IProductionClient> hubContext,
            ILogger<PcbService> logger,
            IMemoryCache memoryCache,
            PMSystem2.Api.Services.Cpk.CpkEngine cpkEngine,
            QualitySummaryQueue qualitySummaryQueue)
        {
            _db = db;
            _masterDataService = masterDataService;
            _hubContext = hubContext;
            _logger = logger;
            _memoryCache = memoryCache;
            _cpkEngine = cpkEngine;
            _qualitySummaryQueue = qualitySummaryQueue;
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

            var normalizedResult = NormalizePcbResult(req.Result);
            var rawInspectTime = req.InspectTime ?? req.StartTime ?? FactoryClockNow();
            var inspectTime = EnsureUtc(rawInspectTime);
            var startTime = req.StartTime.HasValue ? EnsureUtc(req.StartTime.Value) : inspectTime;

            // Calculate ErrorCode: First NG step name if NG/FAIL, else null if OK
            string? computedErrorCode = null;
            if (normalizedResult == "NG" || normalizedResult == "FAIL")
            {
                var firstNgStep = req.Steps?.FirstOrDefault(s => IsNgStepResult(s.Result));

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
                    && p.StartTime == startTime)
                .OrderByDescending(p => p.Result == "OK" || p.Result == "PASS")
                .ThenBy(p => p.CreatedAt)
                .FirstOrDefaultAsync();

            if (existingRecord != null)
            {
                // Exact-key upsert: the identity fields (PID, StartTime)
                // are intentionally immutable. A replay with the same identity
                // refreshes the values parsed from the source log.
                bool existingChanged = ApplyParsedFields(existingRecord, req, inspectTime);
                if (existingRecord.ChannelId != channelId)
                {
                    int oldChannelId = existingRecord.ChannelId;
                    existingRecord.ChannelId = channelId;
                    existingRecord.StationId = hierarchy.StationId;
                    existingChanged = true;
                    ReportChannelReassignment(oldChannelId, channelId, cleanPid, existingRecord.StartTime);
                }
                else
                {
                    _logger.LogWarning("[DEDUPLICATION] Duplicate PCB result ignored for PID: {Pid}, StationId: {StationId}, InspectTime: {InspectTime}",
                        cleanPid, hierarchy.StationId, inspectTime);
                }

                var incomingWins = PreferIncomingResult(existingRecord.Result, normalizedResult);
                if (incomingWins)
                {
                    existingRecord.Result = normalizedResult;
                    existingRecord.ErrorCode = null;
                    _db.TestSteps.RemoveRange(existingRecord.TestSteps.ToList());
                    existingRecord.TestSteps.Clear();
                    existingChanged = true;
                }

                if (IsNgResult(normalizedResult) && !IsOkResult(existingRecord.Result))
                {
                    ReplaceNgSteps(existingRecord, req.Steps, computedErrorCode);
                    existingRecord.ErrorCode = computedErrorCode;
                    existingChanged = true;
                }

                if (existingChanged)
                {
                    await _db.SaveChangesAsync();
                    await TryRefreshQualitySummariesAsync(new[] { cleanPid });
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
                _cpkEngine.Enqueue(entity);
                await TryRefreshQualitySummariesAsync(new[] { cleanPid });
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                _logger.LogWarning(ex, "[DEDUPLICATION] DB Unique constraint prevented inserting duplicate PCB result for PID: {Pid}", cleanPid);
                _db.ChangeTracker.Clear();

                // Fallback: Fetch existing record
                var duplicate = await _db.PcbResults
                    .Include(p => p.TestSteps)
                    .FirstOrDefaultAsync(p => p.Pid == cleanPid
                        && p.StartTime == startTime);

                bool duplicateChanged = false;
                if (duplicate != null && duplicate.ChannelId != channelId)
                {
                    int oldChannelId = duplicate.ChannelId;
                    duplicate.ChannelId = channelId;
                    duplicate.StationId = hierarchy.StationId;
                    duplicateChanged = true;
                    ReportChannelReassignment(oldChannelId, channelId, cleanPid, duplicate.StartTime);
                }

                if (duplicate != null && PreferIncomingResult(duplicate.Result, normalizedResult))
                {
                    duplicate.Result = normalizedResult;
                    duplicate.ErrorCode = null;
                    _db.TestSteps.RemoveRange(duplicate.TestSteps.ToList());
                    duplicate.TestSteps.Clear();
                    duplicateChanged = true;
                }
                if (duplicate != null && IsNgResult(normalizedResult) && !IsOkResult(duplicate.Result))
                {
                    ReplaceNgSteps(duplicate, req.Steps, computedErrorCode);
                    duplicate.ErrorCode = computedErrorCode;
                    duplicateChanged = true;
                }
                if (duplicate != null)
                    duplicateChanged |= ApplyParsedFields(duplicate, req, inspectTime);
                if (duplicateChanged)
                {
                    await _db.SaveChangesAsync();
                    await TryRefreshQualitySummariesAsync(new[] { cleanPid });
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

            return dto;
        }

        private const int MaxDeadlockAttempts = 3;

        public async Task<List<PcbResultDto>> SubmitBatchAsync(List<SubmitPcbRequest> requests)
        {
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    return await SubmitBatchCoreAsync(requests, retried: false);
                }
                catch (Exception ex) when (IsDeadlock(ex) && attempt < MaxDeadlockAttempts)
                {
                    // Two uploads updated the same daily-rollup rows (trigger on pcb_results)
                    // in opposite order; PostgreSQL rolled this batch back. Re-run it from a
                    // clean state after a short random pause so the other upload finishes.
                    _db.ChangeTracker.Clear();
                    _logger.LogWarning("[BATCH SUBMIT] Deadlock with a concurrent upload ({Count} records); retrying {Attempt}/{Max}.",
                        requests.Count, attempt + 1, MaxDeadlockAttempts);
                    await Task.Delay(Random.Shared.Next(200, 800) * attempt);
                }
            }
        }

        private async Task<List<PcbResultDto>> SubmitBatchCoreAsync(List<SubmitPcbRequest> requests, bool retried)
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

                var normalizedResult = NormalizePcbResult(req.Result);
                var rawInspectTime = req.InspectTime ?? req.StartTime ?? FactoryClockNow();
                var inspectTime = EnsureUtc(rawInspectTime);
                var startTime = req.StartTime.HasValue ? EnsureUtc(req.StartTime.Value) : inspectTime;

                string? computedErrorCode = null;
                if (normalizedResult == "NG" || normalizedResult == "FAIL")
                {
                    var firstNgStep = req.Steps?.FirstOrDefault(s => IsNgStepResult(s.Result));

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

            // A source file or retry queue can contain the same PCB more than once
            // in a single request. Keep the latest payload for the unique database
            // identity before checking existing rows or calling AddRange.
            newEntities = newEntities
                .GroupBy(entity => new { entity.Pid, Start = entity.StartTime ?? entity.InspectTime })
                .Select(group => group.FirstOrDefault(entity => IsOkResult(entity.Result)) ?? group.First())
                .ToList();

            // A full local rescan primarily sends records that already exist.
            // Resolve duplicates in one database read and reassign their Channel
            // instead of attempting a bulk insert and falling back one-by-one.
            var duplicateRecordsChanged = false;
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
                    .GroupBy(p => (p.Pid, Start: p.StartTime!.Value))
                    .ToDictionary(g => g.Key, g => g
                        .OrderByDescending(x => IsOkResult(x.Result))
                        .ThenBy(x => x.CreatedAt)
                        .First());

                var existingIds = existingByKey.Values.Select(x => x.Id).ToList();
                var existingNgSteps = await _db.TestSteps
                    .Where(step => existingIds.Contains(step.PcbResultId)
                        && step.Result != "OK" && step.Result != "PASS")
                    .ToListAsync();
                var existingNgStepsByPcb = existingNgSteps
                    .GroupBy(step => step.PcbResultId)
                    .ToDictionary(group => group.Key, group => group.ToList());

                var toInsert = new List<PcbResult>();
                foreach (var entity in newEntities)
                {
                    var key = (entity.Pid, Start: entity.StartTime ?? entity.InspectTime);
                    if (!existingByKey.TryGetValue(key, out var existing))
                    {
                        toInsert.Add(entity);
                        continue;
                    }

                    duplicateRecordsChanged |= ApplyParsedFields(existing, entity);

                    if (existing.ChannelId != entity.ChannelId || existing.StationId != entity.StationId)
                    {
                        var oldChannelId = existing.ChannelId;
                        existing.ChannelId = entity.ChannelId;
                        existing.StationId = entity.StationId;
                        duplicateRecordsChanged = true;
                        ReportChannelReassignment(oldChannelId, existing.ChannelId, existing.Pid, existing.StartTime);
                    }
                    if (PreferIncomingResult(existing.Result, entity.Result))
                    {
                        existing.Result = entity.Result;
                        existing.ErrorCode = null;
                        if (existingNgStepsByPcb.TryGetValue(existing.Id, out var replacedSteps))
                            _db.TestSteps.RemoveRange(replacedSteps);
                        duplicateRecordsChanged = true;
                    }
                    if (IsNgResult(entity.Result) && !IsOkResult(existing.Result))
                    {
                        if (existingNgStepsByPcb.TryGetValue(existing.Id, out var oldNgSteps))
                            _db.TestSteps.RemoveRange(oldNgSteps);
                        foreach (var incomingStep in entity.TestSteps.Where(step => IsNgStepResult(step.Result)))
                            existing.TestSteps.Add(CloneStep(incomingStep));
                        existing.ErrorCode = entity.ErrorCode;
                        duplicateRecordsChanged = true;
                    }
                    resultDtos.Add(BuildResultDto(existing));
                }
                newEntities = toInsert;
            }

            if (newEntities.Count == 0 && duplicateRecordsChanged)
            {
                try
                {
                    await _db.SaveChangesAsync();
                }
                catch (DbUpdateConcurrencyException ex)
                {
                    // Another overlapping replay already updated or removed the
                    // same child step. The PCB identity still exists, so this is
                    // a recoverable duplicate race rather than a failed upload.
                    _logger.LogWarning(ex,
                        "[BATCH DEDUPLICATION] Concurrent duplicate update detected; using the committed database result.");
                    _db.ChangeTracker.Clear();
                }
            }

            if (newEntities.Count > 0)
            {
                try
                {
                    // The daily-rollup trigger locks one aggregate row for every
                    // PCB result. Concurrent batches must acquire those rows in a
                    // stable order or PostgreSQL can detect a 40P01 deadlock.
                    newEntities = newEntities
                        .OrderBy(entity => entity.InspectTime.Date)
                        .ThenBy(entity => entity.StationId)
                        .ThenBy(entity => entity.ChannelId)
                        .ThenBy(entity => entity.Result, StringComparer.Ordinal)
                        .ThenBy(entity => entity.ErrorCode ?? string.Empty, StringComparer.Ordinal)
                        .ThenBy(entity => entity.JobFile ?? string.Empty, StringComparer.Ordinal)
                        .ThenBy(entity => entity.ModelId ?? 0)
                        .ThenBy(entity => entity.Id)
                        .ToList();
                    _db.PcbResults.AddRange(newEntities);
                    await _db.SaveChangesAsync();
                    foreach (var saved in newEntities) _cpkEngine.Enqueue(saved);
                }
                catch (Exception ex)
                {
                    if (IsDatabaseCapacityFailure(ex) || IsDeadlock(ex))
                    {
                        // Deadlocks are retried as a whole batch by SubmitBatchAsync; the
                        // one-by-one fallback below would only hit the same rows again.
                        _db.ChangeTracker.Clear();
                        throw;
                    }
                    if (!retried && IsUniqueViolation(ex))
                    {
                        // Another request stored some of these PCBs between our duplicate
                        // check and SaveChanges. The batch was rolled back, so re-run it
                        // once: the fresh duplicate check now sees those rows.
                        _logger.LogInformation("[BATCH SUBMIT] Concurrent duplicate detected; re-checking the batch once.");
                        _db.ChangeTracker.Clear();
                        return await SubmitBatchCoreAsync(requests, retried: true);
                    }
                    _logger.LogWarning(ex, "[BATCH SUBMIT] Bulk save encountered issue, falling back to individual insert");
                    // SaveChanges may leave modified/deleted duplicate entities and
                    // their TestSteps tracked. Reusing that state makes the fallback
                    // throw DbUpdateConcurrencyException, so start it clean.
                    _db.ChangeTracker.Clear();
                    newEntities.Clear();
                    resultDtos.Clear();
                    foreach (var req in requests)
                    {
                        try
                        {
                            var dto = await SubmitResultAsync(req);
                            resultDtos.Add(dto);
                        }
                        catch (Exception individualEx)
                        {
                            _logger.LogWarning(individualEx,
                                "[BATCH SUBMIT] Individual fallback failed for PID {Pid}", req.Pid);
                            _db.ChangeTracker.Clear();
                        }
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
                var insertedJobFiles = insertedResultDtos
                    .Where(x => !string.IsNullOrWhiteSpace(x.JobFile))
                    .Select(x => x.JobFile!)
                    .Distinct()
                    .ToList();
                // Effective model = Job File mapping, else the model id sent by the PC (same rule as KPIs).
                var jobModel = insertedJobFiles.Count == 0
                    ? new Dictionary<string, int>(StringComparer.Ordinal)
                    : (await _db.JobFileModelMappings.AsNoTracking()
                        .Where(x => x.ModelId != null && insertedJobFiles.Contains(x.JobFile))
                        .Select(x => new { x.JobFile, x.ModelId })
                        .ToListAsync()).ToDictionary(x => x.JobFile, x => x.ModelId!.Value, StringComparer.Ordinal);
                insertedResultDtos = insertedResultDtos
                    .Where(x => !string.Equals(x.ErrorCode, "DEFECT_UNSPECIFIED", StringComparison.OrdinalIgnoreCase)
                        && !IsNotATest(x.ErrorCode)
                        && (x.JobFile != null && jobModel.TryGetValue(x.JobFile, out var mapped) ? mapped : x.ModelId) != 0)
                    .ToList();
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
            }

            if (newEntities.Count > 0 || duplicateRecordsChanged)
            {
                await TryRefreshQualitySummariesAsync(requests
                    .Select(request => CleanDbText(request.Pid))
                    .Where(pid => !string.IsNullOrWhiteSpace(pid))
                    .Select(pid => pid!));
            }

            return resultDtos;
        }

        // NTF/RTY summaries are refreshed by QualitySummaryService in the background.
        // Uploads only enqueue the PIDs, so a slow summary query can no longer hold
        // machine requests in a queue until they time out.
        private Task TryRefreshQualitySummariesAsync(IEnumerable<string> pids)
        {
            _qualitySummaryQueue.Enqueue(pids);
            return Task.CompletedTask;
        }

        /// <summary>Invalidates caches keyed by the production version (called after summaries change).</summary>
        internal static void MarkQualitySummariesChanged() => Interlocked.Increment(ref _productionVersion);

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
            string? searchFid = null,
            string? searchError = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null,
            IReadOnlyCollection<int>? lineIds = null,
            IReadOnlyCollection<int>? stationIds = null,
            IReadOnlyCollection<int>? channelIds = null)
        {
            var query = _db.PcbResults.AsNoTracking().Include(p => p.TestSteps).AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var lineStationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => lineStationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }
            if (lineIds?.Count > 0)
            {
                var allChannels = await _masterDataService.GetChannelsAsync();
                var selectedChannelIds = allChannels.Where(c => lineIds.Contains(c.LineId)).Select(c => c.Id).ToList();
                query = query.Where(p => selectedChannelIds.Contains(p.ChannelId));
            }
            if (stationIds?.Count > 0)
            {
                var allChannels = await _masterDataService.GetChannelsAsync();
                var selectedChannelIds = allChannels.Where(c => stationIds.Contains(c.StationId)).Select(c => c.Id).ToList();
                query = query.Where(p => selectedChannelIds.Contains(p.ChannelId));
            }
            if (channelIds?.Count > 0) query = query.Where(p => channelIds.Contains(p.ChannelId));
            if (!string.IsNullOrWhiteSpace(searchError))
            {
                var errorTerm = searchError.Trim();
                query = query.Where(p => p.ErrorCode != null && EF.Functions.ILike(p.ErrorCode, $"%{errorTerm}%"));
            }
            if (!string.IsNullOrWhiteSpace(searchFid))
            {
                var fidTerm = searchFid.Trim();
                // FID is a unique scanner value. Exact matching allows PostgreSQL
                // to use the fid index instead of scanning the full production table.
                query = query.Where(p => p.Fid == fidTerm);
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
                query = query.Where(p => p.InspectTime >= ToDbFilterTime(startDate.Value));
            }
            if (endDate.HasValue)
            {
                query = query.Where(p => p.InspectTime <= ToDbFilterTime(endDate.Value));
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
            string? searchFid = null,
            string? searchError = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null,
            IReadOnlyCollection<int>? lineIds = null,
            IReadOnlyCollection<int>? stationIds = null,
            IReadOnlyCollection<int>? channelIds = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var lineStationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => lineStationIds.Contains(p.StationId));
            }
            if (stationId.HasValue) query = query.Where(p => p.StationId == stationId.Value);
            if (lineIds?.Count > 0)
            {
                var allChannels = await _masterDataService.GetChannelsAsync();
                var selectedChannelIds = allChannels.Where(c => lineIds.Contains(c.LineId)).Select(c => c.Id).ToList();
                query = query.Where(p => selectedChannelIds.Contains(p.ChannelId));
            }
            if (stationIds?.Count > 0)
            {
                var allChannels = await _masterDataService.GetChannelsAsync();
                var selectedChannelIds = allChannels.Where(c => stationIds.Contains(c.StationId)).Select(c => c.Id).ToList();
                query = query.Where(p => selectedChannelIds.Contains(p.ChannelId));
            }
            if (channelIds?.Count > 0) query = query.Where(p => channelIds.Contains(p.ChannelId));
            if (!string.IsNullOrWhiteSpace(searchError))
            {
                var errorTerm = searchError.Trim();
                query = query.Where(p => p.ErrorCode != null && EF.Functions.ILike(p.ErrorCode, $"%{errorTerm}%"));
            }
            if (!string.IsNullOrWhiteSpace(searchFid))
            {
                var fidTerm = searchFid.Trim();
                query = query.Where(p => p.Fid == fidTerm);
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
            if (startDate.HasValue) query = query.Where(p => p.InspectTime >= ToDbFilterTime(startDate.Value));
            if (endDate.HasValue) query = query.Where(p => p.InspectTime <= ToDbFilterTime(endDate.Value));

            return await query.CountAsync();
        }

        public async Task<byte[]> GetExportCsvAsync(
            int? limit = null,
            int? lineId = null,
            int? stationId = null,
            string? searchPid = null,
            string? searchFid = null,
            string? searchError = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null,
            IReadOnlyCollection<int>? lineIds = null,
            IReadOnlyCollection<int>? stationIds = null,
            IReadOnlyCollection<int>? channelIds = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var lineStationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => lineStationIds.Contains(p.StationId));
            }
            if (stationId.HasValue) query = query.Where(p => p.StationId == stationId.Value);
            if (lineIds?.Count > 0)
            {
                var allChannels = await _masterDataService.GetChannelsAsync();
                var selectedChannelIds = allChannels.Where(c => lineIds.Contains(c.LineId)).Select(c => c.Id).ToList();
                query = query.Where(p => selectedChannelIds.Contains(p.ChannelId));
            }
            if (stationIds?.Count > 0)
            {
                var allChannels = await _masterDataService.GetChannelsAsync();
                var selectedChannelIds = allChannels.Where(c => stationIds.Contains(c.StationId)).Select(c => c.Id).ToList();
                query = query.Where(p => selectedChannelIds.Contains(p.ChannelId));
            }
            if (channelIds?.Count > 0) query = query.Where(p => channelIds.Contains(p.ChannelId));
            if (!string.IsNullOrWhiteSpace(searchError))
            {
                var errorTerm = searchError.Trim();
                query = query.Where(p => p.ErrorCode != null && EF.Functions.ILike(p.ErrorCode, $"%{errorTerm}%"));
            }
            if (!string.IsNullOrWhiteSpace(searchFid))
            {
                var fidTerm = searchFid.Trim();
                query = query.Where(p => p.Fid == fidTerm);
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
            if (startDate.HasValue) query = query.Where(p => p.InspectTime >= ToDbFilterTime(startDate.Value));
            if (endDate.HasValue) query = query.Where(p => p.InspectTime <= ToDbFilterTime(endDate.Value));

            query = query.OrderByDescending(p => p.InspectTime);

            if (limit.HasValue && limit.Value > 0)
            {
                query = query.Take(limit.Value);
            }

            // Large exports: joining every test step (20-300 per PCB) and sorting the join
            // took over a minute and timed out. Read the PCBs first (index on channel/time),
            // then only their failed steps, in chunks.
            _db.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
            var list = await query.ToListAsync();
            var failedStepsByPcb = new Dictionary<Guid, List<TestStep>>();
            foreach (var chunk in list.Select(p => p.Id).Chunk(2000))
            {
                var ids = chunk.ToList();
                var steps = await _db.TestSteps.AsNoTracking()
                    .Where(t => ids.Contains(t.PcbResultId) && t.Result != null && t.Result != "" && t.Result != "OK" && t.Result != "PASS")
                    .ToListAsync();
                foreach (var step in steps)
                {
                    if (!failedStepsByPcb.TryGetValue(step.PcbResultId, out var bucket))
                        failedStepsByPcb[step.PcbResultId] = bucket = new List<TestStep>();
                    bucket.Add(step);
                }
            }

            var sb = new System.Text.StringBuilder();
            sb.Append('\uFEFF'); // UTF-8 BOM for Excel compatibility

            sb.AppendLine("\"ID\",\"Mã PCB (PID)\",\"Tên Lỗi (Defect Name)\",\"Tên Channel (Máy)\",\"Địa chỉ IP Channel\",\"Dây Chuyền (Line)\",\"Trạm (Station)\",\"Ngày Test\",\"Giờ Test\",\"Kết quả (Result)\",\"JobFile / Model\"," +
                "\"Step lỗi (Failed Step)\",\"Step No\",\"Loại Step (Type)\",\"Value\",\"Spec Min\",\"Spec Max\",\"Kết quả Step\",\"Số Step lỗi\",\"Chi tiết Lỗi (Failed Steps)\"");

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

                var failed = failedStepsByPcb.GetValueOrDefault(item.Id, new List<TestStep>())
                    .Where(t => IsNgStepResult(t.Result) || (!IsOkResult(t.Result) && !string.IsNullOrWhiteSpace(t.Result)))
                    .OrderBy(t => t.StepNumber)
                    .ToList();
                // Main failed step: the one the error code names, else the first by step number.
                var main = failed.FirstOrDefault(t => !string.IsNullOrWhiteSpace(item.ErrorCode) &&
                               string.Equals(t.StepName, item.ErrorCode, StringComparison.OrdinalIgnoreCase))
                           ?? failed.FirstOrDefault();
                var failedSteps = failed
                    .Select(t => {
                        var name = string.IsNullOrWhiteSpace(t.StepName) ? $"Step {t.StepNumber}" : t.StepName;
                        var val = !string.IsNullOrWhiteSpace(t.Value) ? t.Value : "-";
                        var hasSpec = !string.IsNullOrWhiteSpace(t.SpecMin) || !string.IsNullOrWhiteSpace(t.SpecMax);
                        var specStr = hasSpec ? $" [{(string.IsNullOrWhiteSpace(t.SpecMin) ? "-" : t.SpecMin)} ~ {(string.IsNullOrWhiteSpace(t.SpecMax) ? "-" : t.SpecMax)}]" : "";
                        return $"#{t.StepNumber} {name} = {val}{specStr} ({t.Result})";
                    })
                    .ToList();
                string failedStepsStr = failedSteps.Count > 0 ? string.Join("; ", failedSteps)
                    : IsNgResult(item.Result) ? (item.ErrorCode != null ? $"Lỗi hệ thống ({item.ErrorCode})" : "Lỗi tổng hợp") : "";

                var channelName = hierarchy?.ChannelName ?? (item.ChannelId > 0 ? $"Channel #{item.ChannelId}" : "Unassigned Channel");
                var lineName = hierarchy?.LineName ?? (hierarchy?.LineId > 0 ? $"Line #{hierarchy.LineId}" : "Unassigned Line");
                var stationName = hierarchy?.StationName ?? (item.StationId > 0 ? $"Station #{item.StationId}" : "Unassigned Station");

                sb.AppendLine($"\"{item.Id}\",\"{EscapeCsv(item.Pid)}\",\"{EscapeCsv(errorCode)}\",\"{EscapeCsv(channelName)}\",\"{EscapeCsv(hierarchy?.IpAddress ?? "")}\",\"{EscapeCsv(lineName)}\",\"{EscapeCsv(stationName)}\",\"{dateStr}\",\"{timeStr}\",\"{item.Result}\",\"{EscapeCsv(jobFile)}\"," +
                    $"\"{EscapeCsv(main?.StepName ?? "")}\",\"{main?.StepNumber.ToString() ?? ""}\",\"{EscapeCsv(main?.StepType ?? "")}\"," +
                    $"\"{EscapeCsv(main?.Value ?? "")}\",\"{EscapeCsv(main?.SpecMin ?? "")}\",\"{EscapeCsv(main?.SpecMax ?? "")}\",\"{EscapeCsv(main?.Result ?? "")}\"," +
                    $"\"{failed.Count}\",\"{EscapeCsv(failedStepsStr)}\"");
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
            var query = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking());

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
            var query = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking());

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
                var query = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking());
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

        public async Task<QualityModeSummaryDto> GetQualityModesAsync(
            int? lineId = null, int? stationId = null, DateTime? startDate = null, DateTime? endDate = null)
        {
            var cacheKey = $"quality-modes-v2:{Volatile.Read(ref _productionVersion)}:{lineId}:{stationId}:{startDate?.Ticks}:{endDate?.Ticks}";
            return await _memoryCache.GetOrCreateAsync(cacheKey, async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
                var periodQuery = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking());
                if (startDate.HasValue)
                {
                    var start = EnsureUtc(startDate.Value);
                    periodQuery = periodQuery.Where(p => p.InspectTime >= start);
                }
                if (endDate.HasValue)
                {
                    var end = EnsureUtc(endDate.Value);
                    periodQuery = periodQuery.Where(p => p.InspectTime <= end);
                }

                // Retest: every test attempt is counted once in the selected scope.
                var scopedQuery = periodQuery;
                if (lineId.HasValue)
                {
                    var stationIds = (await _masterDataService.GetStationsAsync())
                        .Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                    scopedQuery = scopedQuery.Where(p => stationIds.Contains(p.StationId));
                }
                if (stationId.HasValue) scopedQuery = scopedQuery.Where(p => p.StationId == stationId.Value);
                var retest = await scopedQuery.GroupBy(_ => 1).Select(g => new
                {
                    Total = g.LongCount(),
                    Ng = g.LongCount(x => x.Result == "NG" || x.Result == "FAIL")
                }).SingleOrDefaultAsync();

                // NTF: one PCB per PID + Station. The period selects the PCB set;
                // its complete history at that Station determines whether it ever failed.
                var selectedPidStations = scopedQuery.Select(p => new { p.Pid, p.StationId }).Distinct();
                long ntfTotal = await selectedPidStations.LongCountAsync();
                long ntfNg = await selectedPidStations
                    .Join(_db.PcbNtfSummaries.AsNoTracking().Where(summary => summary.EverNg),
                        selected => new { selected.Pid, selected.StationId },
                        summary => new { summary.Pid, summary.StationId },
                        (_, _) => 1)
                    .LongCountAsync();

                // RTY: system-wide unique PIDs appearing in the period. Any NG at
                // any Station in their complete history means they did not run straight through.
                var selectedPids = periodQuery.Select(p => p.Pid).Distinct();
                long rtyTotal = await selectedPids.LongCountAsync();
                long rtyEverNg = await selectedPids
                    .Join(_db.PcbRtySummaries.AsNoTracking().Where(summary => summary.EverNg),
                        pid => pid,
                        summary => summary.Pid,
                        (_, _) => 1)
                    .LongCountAsync();
                long rtyStraight = rtyTotal - rtyEverNg;

                long retestTotal = retest?.Total ?? 0;
                long retestNg = retest?.Ng ?? 0;
                return new QualityModeSummaryDto(
                    retestTotal, retestNg, retestTotal > 0 ? Math.Round(retestNg * 100.0 / retestTotal, 2) : 0,
                    ntfTotal, ntfNg, ntfTotal > 0 ? Math.Round(ntfNg * 100.0 / ntfTotal, 2) : 0,
                    rtyTotal, rtyStraight, rtyTotal > 0 ? Math.Round(rtyStraight * 100.0 / rtyTotal, 2) : 0);
            }) ?? new QualityModeSummaryDto(0, 0, 0, 0, 0, 0, 0, 0, 0);
        }

        public async Task<List<LineYieldStatDto>> GetLineYieldStatsAsync(
            int? lineId = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var stations = await _masterDataService.GetStationsAsync();
            var lines = await _masterDataService.GetLinesAsync();
            var query = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking());

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
            var query = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking());

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
            var query = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking())
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
            var requestedEnd = endDate ?? DateTime.UtcNow;
            var requestedStart = startDate ?? requestedEnd.AddHours(-hours);
            var requestedSpan = requestedEnd - requestedStart;
            // Calendar presets differ by milliseconds between browsers. Bucket
            // long-range cache keys so users share the same BI result instead of
            // triggering another full-table aggregation for every page load.
            long cacheStartTicks = requestedSpan.TotalHours > 48
                ? requestedStart.Date.Ticks
                : requestedStart.Ticks;
            long cacheEndTicks = requestedSpan.TotalHours > 48
                ? new DateTime(requestedEnd.Year, requestedEnd.Month, requestedEnd.Day,
                    requestedEnd.Hour, requestedEnd.Minute / 15 * 15, 0).Ticks
                : requestedEnd.Ticks;
            var cacheKey = string.Join('|', "bi-matrix-v11", lineId, stationId, channelId, modelId,
                errorCode ?? "", jobFile ?? "", cacheStartTicks, cacheEndTicks, hours);
            if (_memoryCache.TryGetValue<BiAnalyticsMatrixDto>(cacheKey, out var cachedMatrix)
                && cachedMatrix != null)
            {
                return cachedMatrix;
            }

            var stations = await _masterDataService.GetStationsAsync();
            var lines = await _masterDataService.GetLinesAsync();
            var channels = await _masterDataService.GetChannelsAsync();

            if (requestedSpan.TotalHours > 48)
            {
                var rollupMatrix = await GetBiMatrixFromDailyRollupAsync(lineId, stationId, channelId,
                    modelId, errorCode, jobFile, requestedStart, requestedEnd, stations, lines, channels);
                _memoryCache.Set(cacheKey, rollupMatrix, TimeSpan.FromMinutes(15));
                return rollupMatrix;
            }

            var query = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking());

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
                var mappingQuery = _db.JobFileModelMappings.AsNoTracking()
                    .Where(mapping => mapping.ModelId != null);
                var mappedJobFiles = await mappingQuery
                    .Where(mapping => mapping.ModelId == modelId.Value)
                    .Select(mapping => mapping.JobFile).ToListAsync();
                var allMappedJobFiles = mappingQuery.Select(mapping => mapping.JobFile);
                // The manual Job File mapping is authoritative. Fall back to the
                // legacy pcb_results.model_id only when that Job File has no mapping.
                query = query.Where(p =>
                    (p.JobFile != null && mappedJobFiles.Contains(p.JobFile))
                    || (p.ModelId == modelId.Value
                        && (p.JobFile == null || !allMappedJobFiles.Contains(p.JobFile))));
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

            // 2. Time Trend. Avoid returning tens of thousands of hourly points
            // for year-scale filters: hour (<=48h), day, then month (>2 years).
            var aggregationEnd = endDate.HasValue ? EnsureUtc(endDate.Value) : DateTime.UtcNow;
            var aggregationStart = startDate.HasValue ? EnsureUtc(startDate.Value) : aggregationEnd.AddHours(-hours);
            var aggregationSpan = aggregationEnd - aggregationStart;
            List<HourlyStatDto> timeTrend;
            if (aggregationSpan.TotalDays > 180)
            {
                var grouped = await scopeQuery.GroupBy(p => new { p.InspectTime.Year, p.InspectTime.Month })
                    .Select(g => new { g.Key.Year, g.Key.Month, Total = g.Count(),
                        Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                        Ng = !string.IsNullOrWhiteSpace(errorCode)
                            ? g.Count(x => x.ErrorCode == errorCode && (x.Result == "NG" || x.Result == "FAIL"))
                            : g.Count(x => x.Result == "NG" || x.Result == "FAIL") })
                    .OrderBy(g => g.Year).ThenBy(g => g.Month).ToListAsync();
                timeTrend = grouped.Select(g => BuildTrendPoint(
                    new DateTime(g.Year, g.Month, 1, 0, 0, 0, DateTimeKind.Utc), g.Total, g.Ok, g.Ng, lineId, stationId)).ToList();
            }
            else if (aggregationSpan.TotalHours > 48)
            {
                var grouped = await scopeQuery.GroupBy(p => new { p.InspectTime.Year, p.InspectTime.Month, p.InspectTime.Day })
                    .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Day, Total = g.Count(),
                        Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                        Ng = !string.IsNullOrWhiteSpace(errorCode)
                            ? g.Count(x => x.ErrorCode == errorCode && (x.Result == "NG" || x.Result == "FAIL"))
                            : g.Count(x => x.Result == "NG" || x.Result == "FAIL") })
                    .OrderBy(g => g.Year).ThenBy(g => g.Month).ThenBy(g => g.Day).ToListAsync();
                timeTrend = grouped.Select(g => BuildTrendPoint(
                    new DateTime(g.Year, g.Month, g.Day, 0, 0, 0, DateTimeKind.Utc), g.Total, g.Ok, g.Ng, lineId, stationId)).ToList();
            }
            else
            {
                var grouped = await scopeQuery.GroupBy(p => new { p.InspectTime.Year, p.InspectTime.Month, p.InspectTime.Day, p.InspectTime.Hour })
                    .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Day, g.Key.Hour, Total = g.Count(),
                        Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                        Ng = !string.IsNullOrWhiteSpace(errorCode)
                            ? g.Count(x => x.ErrorCode == errorCode && (x.Result == "NG" || x.Result == "FAIL"))
                            : g.Count(x => x.Result == "NG" || x.Result == "FAIL") })
                    .OrderBy(g => g.Year).ThenBy(g => g.Month).ThenBy(g => g.Day).ThenBy(g => g.Hour).ToListAsync();
                timeTrend = grouped.Select(g => BuildTrendPoint(
                    new DateTime(g.Year, g.Month, g.Day, g.Hour, 0, 0, DateTimeKind.Utc), g.Total, g.Ok, g.Ng, lineId, stationId)).ToList();
            }

            // Show which Line contributes to the overall defect rate in every
            // time bucket. Total remains the complete production denominator;
            // NG respects the currently selected defect filter, if any.
            var hourlyLineGroups = await scopeQuery
                .GroupBy(p => new { p.InspectTime.Year, p.InspectTime.Month, p.InspectTime.Day, p.InspectTime.Hour, p.StationId })
                .Select(g => new
                {
                    g.Key.Year, g.Key.Month, g.Key.Day, g.Key.Hour, g.Key.StationId,
                    Total = g.LongCount(),
                    Ng = !string.IsNullOrWhiteSpace(errorCode)
                        ? g.LongCount(x => x.ErrorCode == errorCode && (x.Result == "NG" || x.Result == "FAIL"))
                        : g.LongCount(x => x.Result == "NG" || x.Result == "FAIL")
                }).ToListAsync();
            var contributionsByBucket = hourlyLineGroups
                .GroupBy(x => new DateTime(x.Year, x.Month, x.Day, x.Hour, 0, 0, DateTimeKind.Utc))
                .ToDictionary(g => g.Key, g =>
                {
                    long bucketTotal = g.Sum(x => x.Total);
                    return g.GroupBy(x => stations.FirstOrDefault(s => s.Id == x.StationId)?.LineId ?? 0)
                        .Select(lineGroup =>
                        {
                            long lineTotal = lineGroup.Sum(x => x.Total);
                            long lineNg = lineGroup.Sum(x => x.Ng);
                            return new LineDefectContributionDto(lineGroup.Key,
                                lines.FirstOrDefault(l => l.Id == lineGroup.Key)?.Name ?? $"Line {lineGroup.Key}",
                                lineTotal, lineNg,
                                lineTotal > 0 ? Math.Round(lineNg * 100.0 / lineTotal, 4) : 0,
                                bucketTotal > 0 ? Math.Round(lineNg * 100.0 / bucketTotal, 4) : 0);
                        }).Where(x => x.NgCount > 0).OrderByDescending(x => x.ContributionRate).ToList();
                });
            timeTrend = timeTrend.Select(point => point with
            {
                LineContributions = contributionsByBucket.GetValueOrDefault(point.Bucket) ?? new List<LineDefectContributionDto>()
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
            stationStats = stationStats
                .OrderByDescending(r => r.Total > 0 ? (double)r.Ng / r.Total : 0.0)
                .ThenByDescending(r => r.Ng)
                .ToList();

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

            stationStats = stationStats.Take(10).ToList();

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
            machineStats = machineStats
                .OrderByDescending(r => r.Total > 0 ? (double)r.Ng / r.Total : 0.0)
                .ThenByDescending(r => r.Ng)
                .Take(10)
                .ToList();

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
                AbsoluteExpirationRelativeToNow = requestedSpan.TotalHours > 48
                    ? TimeSpan.FromMinutes(15)
                    : TimeSpan.FromMinutes(2),
                SlidingExpiration = requestedSpan.TotalHours > 48
                    ? TimeSpan.FromMinutes(5)
                    : TimeSpan.FromSeconds(45)
            });
            return matrix;
        }

        private async Task<BiAnalyticsMatrixDto> GetBiMatrixFromDailyRollupAsync(
            int? lineId, int? stationId, int? channelId, int? modelId, string? errorCode, string? jobFile,
            DateTime startDate, DateTime endDate, IReadOnlyCollection<StationDto> stations,
            IReadOnlyCollection<LineDto> lines, IReadOnlyCollection<ChannelDto> channels)
        {
            var fromDay = DateOnly.FromDateTime(startDate);
            var toDay = DateOnly.FromDateTime(endDate);
            var rollupQuery = _db.PcbAnalyticsDaily.AsNoTracking()
                .Where(x => x.BucketDate >= fromDay && x.BucketDate <= toDay
                    && x.ErrorCode != "DEFECT_UNSPECIFIED");
            var unassignedJobs = _db.JobFileModelMappings.AsNoTracking()
                .Where(x => x.ModelId == 0)
                .Select(x => x.JobFile);
            // The rollup stores a null PCB ModelId as 0, so use the Job File
            // mapping to distinguish ordinary unmapped data from data explicitly
            // assigned to the Unassigned Model.
            rollupQuery = rollupQuery.Where(x => x.ModelId != 0 || !unassignedJobs.Contains(x.JobFile));
            if (lineId.HasValue)
            {
                var ids = channels.Where(x => x.LineId == lineId.Value).Select(x => x.Id).ToList();
                rollupQuery = rollupQuery.Where(x => ids.Contains(x.ChannelId));
            }
            if (stationId.HasValue)
            {
                var ids = channels.Where(x => x.StationId == stationId.Value).Select(x => x.Id).ToList();
                rollupQuery = rollupQuery.Where(x => ids.Contains(x.ChannelId));
            }
            if (channelId.HasValue) rollupQuery = rollupQuery.Where(x => x.ChannelId == channelId.Value);
            if (!string.IsNullOrWhiteSpace(jobFile)) rollupQuery = rollupQuery.Where(x => x.JobFile == jobFile);

            var mappings = await _db.JobFileModelMappings.AsNoTracking().Include(x => x.Model)
                .Where(x => x.ModelId != null && x.Model != null).ToListAsync();
            if (modelId.HasValue)
            {
                var mappedJobs = mappings.Where(x => x.ModelId == modelId.Value).Select(x => x.JobFile).ToList();
                var allMappedJobs = mappings.Select(x => x.JobFile).Distinct().ToList();
                // Use the current manual mapping before the historical ModelId
                // stored in the daily rollup. This prevents stale model IDs from
                // mixing another model (for example IGM) into the selected model.
                rollupQuery = rollupQuery.Where(x => mappedJobs.Contains(x.JobFile)
                    || (x.ModelId == modelId.Value && !allMappedJobs.Contains(x.JobFile)));
            }

            // The rollup is already highly compressed. One read supplies every
            // chart and avoids repeatedly scanning the production fact table.
            var rows = await rollupQuery.ToListAsync();
            var channelById = channels.GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First());
            var stationById = stations.GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First());
            int EffectiveStation(PcbAnalyticsDaily row) => channelById.TryGetValue(row.ChannelId, out var channel)
                ? channel.StationId
                : row.StationId;
            int EffectiveLine(PcbAnalyticsDaily row)
            {
                if (channelById.TryGetValue(row.ChannelId, out var channel)) return channel.LineId;
                return stationById.TryGetValue(row.StationId, out var station) ? station.LineId : 0;
            }
            bool IsOk(PcbAnalyticsDaily x) => x.Result is "OK" or "PASS";
            bool IsNg(PcbAnalyticsDaily x) => x.Result is "NG" or "FAIL";
            long total = rows.Sum(x => x.TotalCount);
            long ok = rows.Where(IsOk).Sum(x => x.TotalCount);
            long ng = rows.Where(x => IsNg(x) && (string.IsNullOrWhiteSpace(errorCode) || x.ErrorCode == errorCode))
                .Sum(x => x.TotalCount);
            double Yield(long t, long o) => t > 0 ? Math.Round(o * 100.0 / t, 2) : 0;

            bool monthly = (endDate - startDate).TotalDays > 180;
            var trendGroups = rows.GroupBy(x => monthly
                    ? new DateOnly(x.BucketDate.Year, x.BucketDate.Month, 1)
                    : x.BucketDate).OrderBy(g => g.Key).ToList();
            var trend = trendGroups.Select(g =>
                {
                    long t = g.Sum(x => x.TotalCount);
                    long o = g.Where(IsOk).Sum(x => x.TotalCount);
                    long n = g.Where(x => IsNg(x) && (string.IsNullOrWhiteSpace(errorCode) || x.ErrorCode == errorCode)).Sum(x => x.TotalCount);
                    var contributions = g.GroupBy(EffectiveLine)
                        .Select(lineGroup =>
                        {
                            long lineTotal = lineGroup.Sum(x => x.TotalCount);
                            long lineNg = lineGroup.Where(x => IsNg(x) && (string.IsNullOrWhiteSpace(errorCode) || x.ErrorCode == errorCode)).Sum(x => x.TotalCount);
                            return new LineDefectContributionDto(lineGroup.Key,
                                lines.FirstOrDefault(l => l.Id == lineGroup.Key)?.Name ?? $"Line {lineGroup.Key}",
                                lineTotal, lineNg,
                                lineTotal > 0 ? Math.Round(lineNg * 100.0 / lineTotal, 4) : 0,
                                t > 0 ? Math.Round(lineNg * 100.0 / t, 4) : 0);
                        }).Where(x => x.NgCount > 0).OrderByDescending(x => x.ContributionRate).ToList();
                    return BuildTrendPoint(g.Key.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), (int)Math.Min(int.MaxValue, t),
                        (int)Math.Min(int.MaxValue, o), (int)Math.Min(int.MaxValue, n), lineId, stationId) with { LineContributions = contributions };
                }).ToList();

            var stationStats = rows.GroupBy(EffectiveStation).Select(g =>
            {
                stationById.TryGetValue(g.Key, out var station);
                int lId = station?.LineId ?? 0;
                long t = g.Sum(x => x.TotalCount); long o = g.Where(IsOk).Sum(x => x.TotalCount);
                long n = g.Where(x => IsNg(x) && (string.IsNullOrWhiteSpace(errorCode) || x.ErrorCode == errorCode)).Sum(x => x.TotalCount);
                return new StationYieldStatDto(g.Key, station?.Name ?? $"Station {g.Key}", lId,
                    lines.FirstOrDefault(x => x.Id == lId)?.Name ?? $"Line {lId}", t, o, n, Yield(t, o));
            }).OrderByDescending(x => x.Total > 0 ? (double)x.Ng / x.Total : 0.0)
                .ThenByDescending(x => x.Ng)
                .Take(10)
                .ToList();

            var lineStats = rows.GroupBy(EffectiveLine).Select(g =>
            {
                long t = g.Sum(x => x.TotalCount); long o = g.Where(IsOk).Sum(x => x.TotalCount);
                long n = g.Where(x => IsNg(x) && (string.IsNullOrWhiteSpace(errorCode) || x.ErrorCode == errorCode)).Sum(x => x.TotalCount);
                return new LineYieldStatDto(g.Key, lines.FirstOrDefault(x => x.Id == g.Key)?.Name ?? $"Line {g.Key}", t, o, n, Yield(t, o));
            }).OrderBy(x => x.LineName).ToList();

            var machineStats = rows.GroupBy(x => x.ChannelId).Select(g =>
            {
                channelById.TryGetValue(g.Key, out var channel);
                stationById.TryGetValue(channel?.StationId ?? 0, out var station);
                int lId = channel?.LineId ?? station?.LineId ?? 0;
                long t = g.Sum(x => x.TotalCount); long o = g.Where(IsOk).Sum(x => x.TotalCount);
                long n = g.Where(x => IsNg(x) && (string.IsNullOrWhiteSpace(errorCode) || x.ErrorCode == errorCode)).Sum(x => x.TotalCount);
                return new ChannelYieldStatDto(g.Key, channel?.Name ?? $"Channel #{g.Key}", channel?.IpAddress ?? "",
                    channel?.StationId ?? 0, station?.Name ?? "Unknown Station", lId,
                    lines.FirstOrDefault(x => x.Id == lId)?.Name ?? "Unknown Line", t, o, n, Yield(t, o));
            }).Where(x => x.Total >= 10)
                .OrderByDescending(x => x.Total > 0 ? (double)x.Ng / x.Total : 0.0)
                .ThenByDescending(x => x.Ng)
                .Take(10)
                .ToList();

            var ngRows = rows.Where(IsNg).ToList();
            long allNg = ngRows.Sum(x => x.TotalCount);
            var defectStats = ngRows.GroupBy(x => string.IsNullOrWhiteSpace(x.ErrorCode) ? "DEFECT_UNSPECIFIED" : x.ErrorCode)
                .Select(g => new DefectParetoStatDto(g.Key, g.Sum(x => x.TotalCount),
                    allNg > 0 ? Math.Round(g.Sum(x => x.TotalCount) * 100.0 / allNg, 2) : 0))
                .OrderByDescending(x => x.Count).Take(20).ToList();

            var jobGroups = rows.GroupBy(x => string.IsNullOrWhiteSpace(x.JobFile) ? "DEFAULT_JOB" : x.JobFile)
                .Select(g => new { Job = g.Key, Total = g.Sum(x => x.TotalCount), Ok = g.Where(IsOk).Sum(x => x.TotalCount),
                    Ng = g.Where(x => IsNg(x) && (string.IsNullOrWhiteSpace(errorCode) || x.ErrorCode == errorCode)).Sum(x => x.TotalCount) }).ToList();
            var jobStats = jobGroups.Select(g => new JobFileYieldStatDto(g.Job, g.Total, g.Ok, g.Ng,
                    Yield(g.Total, g.Ok), g.Total > 0 ? Math.Round(g.Ng * 100.0 / g.Total, 2) : 0))
                .Where(x => x.Total >= 10).OrderByDescending(x => x.DefectRate).ThenByDescending(x => x.Ng).Take(15).ToList();

            var mappingByJob = mappings.Where(x => !string.IsNullOrWhiteSpace(x.JobFile))
                .GroupBy(x => x.JobFile.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.UpdatedAt).First(), StringComparer.OrdinalIgnoreCase);
            var modelStats = jobGroups.Where(g => mappingByJob.ContainsKey(g.Job.Trim())).Select(g =>
                {
                    var m = mappingByJob[g.Job.Trim()]; return new { Id = m.ModelId!.Value,
                        Name = m.Model?.Name ?? $"Model #{m.ModelId}", g.Total, g.Ok, g.Ng };
                }).GroupBy(x => new { x.Id, x.Name }).Select(g =>
                {
                    long t = g.Sum(x => x.Total); long o = g.Sum(x => x.Ok); long n = g.Sum(x => x.Ng);
                    return new ModelYieldStatDto(g.Key.Id, g.Key.Name, t, o, n, Yield(t, o), t > 0 ? Math.Round(n * 100.0 / t, 2) : 0);
                }).Where(x => x.Total >= 10).OrderByDescending(x => x.DefectRate).ThenByDescending(x => x.Ng).ToList();

            return new BiAnalyticsMatrixDto(total, ok, ng, Yield(total, ok), trend, lineStats, modelStats,
                stationStats, machineStats, defectStats, jobStats);
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

        /// <summary>Error codes that mark a job change, not a test (same rule as the rollup trigger and the summaries).</summary>
        internal const string NotATestPattern = "CHANGE[_.]JOB";
        /// <summary>The same rule for SQL LIKE ('_' matches any one character, so also 'CHANGE.JOB').</summary>
        private const string NotATestLike = "%CHANGE_JOB%";
        internal static bool IsNotATest(string? errorCode) =>
            errorCode != null && Regex.IsMatch(errorCode, NotATestPattern, RegexOptions.IgnoreCase);

        private IQueryable<PcbResult> ExcludeUnassignedModelData(IQueryable<PcbResult> query)
        {
            var unassignedJobs = _db.JobFileModelMappings.AsNoTracking()
                .Where(x => x.ModelId == 0)
                .Select(x => x.JobFile);

            var mappedJobs = _db.JobFileModelMappings.AsNoTracking()
                .Where(x => x.ModelId != null)
                .Select(x => x.JobFile);

            // The Job File mapping is authoritative (the model id sent by the PC is only the model
            // selected on that PC and is 0 when none was set). Fall back to pcb_results.model_id
            // only for unmapped Job Files. Exclude records whose effective model is Unassigned (0).
            // A job change (CHANGE_JOB / CHANGE.JOB.) is not a test and is left out of every KPI.
            return query.Where(x => (x.ErrorCode == null || x.ErrorCode != "DEFECT_UNSPECIFIED")
                && (x.ErrorCode == null || !EF.Functions.ILike(x.ErrorCode, NotATestLike))
                && !(x.JobFile != null && unassignedJobs.Contains(x.JobFile))
                && !(x.ModelId == 0 && (x.JobFile == null || !mappedJobs.Contains(x.JobFile))));
        }

        /// <summary>
        /// Trace-page date filters: the page sends the instant the user picked in the PC's own time
        /// zone (ISO, UTC). With Npgsql legacy timestamps the database reads a DateTime parameter as
        /// wall-clock time of the server time zone (the same way results are stored), so the instant
        /// is passed as server local time; filtering then matches the times shown on the page.
        /// </summary>
        private static DateTime ToDbFilterTime(DateTime dt) => dt.Kind switch
        {
            DateTimeKind.Utc => DateTime.SpecifyKind(dt.ToLocalTime(), DateTimeKind.Unspecified),
            DateTimeKind.Local => DateTime.SpecifyKind(dt, DateTimeKind.Unspecified),
            _ => dt
        };

        /// <summary>
        /// Current time in the convention of the stored production timestamps: the factory (server)
        /// wall clock with a UTC marker, like the start_time read from the machine logs.
        /// </summary>
        private static DateTime FactoryClockNow() => DateTime.SpecifyKind(DateTime.Now, DateTimeKind.Utc);

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

        // Existing PCB results moved to another Channel by an upload, per (old, new) pair.
        // A full log rescan can move thousands of rows, so the pair is reported at most
        // once per interval with the count accumulated since the previous report.
        private static readonly TimeSpan ReassignmentReportInterval = TimeSpan.FromMinutes(1);
        private static readonly object ReassignmentLock = new();
        private static readonly Dictionary<(int Old, int New), (DateTime LastReport, int Pending, string SamplePid, DateTime? SampleStart)> ReassignmentReports = new();

        private void ReportChannelReassignment(int oldChannelId, int newChannelId, string pid, DateTime? startTime)
        {
            int count;
            string samplePid;
            DateTime? sampleStart;
            lock (ReassignmentLock)
            {
                var key = (oldChannelId, newChannelId);
                ReassignmentReports.TryGetValue(key, out var state);
                if (state.Pending == 0) { state.SamplePid = pid; state.SampleStart = startTime; }
                state.Pending++;
                var now = DateTime.UtcNow;
                if (now - state.LastReport < ReassignmentReportInterval)
                {
                    ReassignmentReports[key] = state;
                    return;
                }
                count = state.Pending;
                samplePid = state.SamplePid;
                sampleStart = state.SampleStart;
                ReassignmentReports[key] = (now, 0, string.Empty, null);
            }
            var from = _masterDataService.GetChannelHierarchy(oldChannelId);
            var to = _masterDataService.GetChannelHierarchy(newChannelId);
            _logger.LogWarning(
                "[DEDUPLICATION] {Count} existing PCB result(s) moved from Channel {OldChannelId} ({OldChannel} / {OldStation}) to Channel {NewChannelId} ({NewChannel} / {NewStation}) since the last report; e.g. PID {Pid} started {StartTime:yyyy-MM-dd HH:mm:ss}. Two Backup_Log configurations may be uploading the same logs.",
                count, oldChannelId, from?.ChannelName ?? "?", from?.StationName ?? "?",
                newChannelId, to?.ChannelName ?? "?", to?.StationName ?? "?", samplePid, sampleStart);
        }

        internal static bool IsDeadlock(Exception ex)
        {
            for (Exception? current = ex; current != null; current = current.InnerException)
                if (current is PostgresException { SqlState: PostgresErrorCodes.DeadlockDetected }) return true;
            return false;
        }

        private static bool IsUniqueViolation(Exception ex)
        {
            for (Exception? current = ex; current != null; current = current.InnerException)
                if (current is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation }) return true;
            return false;
        }

        /// <summary>
        /// Returns the records that are already stored with the same PID, start time and
        /// Channel and whose stored result would not change (same result, or stored OK).
        /// The collector skips those instead of uploading them again. A record whose
        /// Channel or result differs is not returned, so the upload can still correct it.
        /// </summary>
        public async Task<List<ExistingPcbKey>> FindExistingAsync(List<ExistingPcbQuery> keys)
        {
            var items = keys
                .Where(k => !string.IsNullOrWhiteSpace(k.Pid) && k.StartTime.HasValue)
                .Select(k => (Pid: CleanDbText(k.Pid)!.Trim(), Start: EnsureUtc(k.StartTime!.Value),
                    Raw: k.StartTime!.Value, Result: NormalizePcbResult(k.Result), k.ChannelId))
                .ToList();
            if (items.Count == 0) return new List<ExistingPcbKey>();

            var pids = items.Select(i => i.Pid).Distinct().ToList();
            var minStart = items.Min(i => i.Start);
            var maxStart = items.Max(i => i.Start);
            // Same lookup shape as the batch duplicate check (IX_pcb_results_pid_start_time).
            var rows = await _db.PcbResults.AsNoTracking()
                .Where(p => pids.Contains(p.Pid) && p.StartTime.HasValue
                    && p.StartTime.Value >= minStart && p.StartTime.Value <= maxStart)
                .Select(p => new { p.Pid, Start = p.StartTime!.Value, p.ChannelId, p.Result })
                .ToListAsync();
            var byKey = rows.GroupBy(r => (r.Pid, r.Start)).ToDictionary(g => g.Key, g => g.ToList());

            var existing = new List<ExistingPcbKey>();
            foreach (var item in items)
            {
                if (byKey.TryGetValue((item.Pid, item.Start), out var found)
                    && found.Any(f => f.ChannelId == item.ChannelId
                        && (string.Equals(f.Result, item.Result, StringComparison.OrdinalIgnoreCase) || IsOkResult(f.Result))))
                    existing.Add(new ExistingPcbKey(item.Pid, item.Raw));
            }
            return existing;
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
            // The incremental engine already holds the latest samples for every
            // active Channel/Job/Step; serve them so detail and overview agree.
            if (!forceRefresh && _cpkEngine.TryGetAnalysis(channelId, normalizedJobFile, stepNumber, stepName, out var live))
                return live;
            if (!forceRefresh)
            {
                var cached = await _db.CpkResultCache.AsNoTracking().FirstOrDefaultAsync(c =>
                    c.ChannelId == channelId && c.JobFile == normalizedJobFile
                    && c.StepNumber == stepNumber && c.StepName == stepName && c.FromDate == fromDate);
                if (cached != null && cached.SampleCount >= limit && cached.Cpk.HasValue
                    && cached.CalculatedAt >= DateTime.UtcNow.AddMinutes(-5))
                {
                    return new CpkAnalysisDto(channelId, stepNumber, stepName, cached.FromDate,
                        cached.SampleCount, cached.SpecMin, cached.SpecMax, cached.Mean,
                        cached.StandardDeviation, cached.Cpl, cached.Cpu, cached.Cpk,
                        JsonSerializer.Deserialize<List<CpkPointDto>>(cached.PointsJson) ?? new());
                }
            }
            var measurementQuery = _db.TestSteps.AsNoTracking()
                .Where(s => s.PcbResult != null
                    && s.PcbResult.ChannelId == channelId
                    && (s.PcbResult.Result == "OK" || s.PcbResult.Result == "PASS")
                    // FAIL step rows of an OK PCB (retests) are out of spec by definition.
                    && (s.Result == "OK" || s.Result == "PASS" || s.Result == "")
                    && s.StepNumber == stepNumber
                    && s.StepName == stepName
                    && (string.IsNullOrEmpty(jobFile) || s.PcbResult.JobFile == jobFile));
            var rows = await measurementQuery
                .Where(s => s.PcbResult!.InspectTime >= fromDate)
                .OrderByDescending(s => s.PcbResult!.InspectTime)
                .ThenByDescending(s => s.Id)
                .Take(500)
                .Select(s => new { s.PcbResult!.Pid, s.PcbResult.InspectTime, s.Value, s.SpecMin, s.SpecMax })
                .ToListAsync();

            var numericRows = rows
                .Select(r => new { Row = r, Value = ParseMeasurement(r.Value) })
                .Where(x => x.Value.HasValue)
                .Take(limit)
                .ToList();
            // Complete the latest sample with measurements before this month.
            // Keep the same Channel/Job/Step filters for both periods.
            if (numericRows.Count < limit)
            {
                var olderRows = await measurementQuery
                    .Where(s => s.PcbResult!.InspectTime < fromDate)
                    .OrderByDescending(s => s.PcbResult!.InspectTime)
                    .ThenByDescending(s => s.Id)
                    .Take(500)
                    .Select(s => new { s.PcbResult!.Pid, s.PcbResult.InspectTime, s.Value, s.SpecMin, s.SpecMax })
                    .ToListAsync();
                numericRows.AddRange(olderRows
                    .Select(r => new { Row = r, Value = ParseMeasurement(r.Value) })
                    .Where(x => x.Value.HasValue)
                    .Take(limit - numericRows.Count));
            }
            if (numericRows.Count < limit)
            {
                // Daily history can outlive imported measurements and monthly
                // caches. Prefer a complete study over a newer empty snapshot.
                var previous = await _db.CpkResultHistory.AsNoTracking()
                    .Where(c => c.ChannelId == channelId && c.JobFile == normalizedJobFile
                        && c.StepNumber == stepNumber && c.StepName == stepName
                        && c.SampleCount >= limit && c.Cpk != null)
                    .OrderByDescending(c => c.PeriodStart)
                    .ThenByDescending(c => c.CalculationDate)
                    .FirstOrDefaultAsync();
                if (previous != null)
                {
                    var previousPoints = await _db.RawCpk.AsNoTracking()
                        .Where(r => r.ChannelId == channelId && r.JobFile == normalizedJobFile
                            && r.StepNumber == stepNumber && r.StepName == stepName
                            && r.CalculationDate == previous.CalculationDate)
                        .OrderBy(r => r.InspectTime).ThenBy(r => r.Id)
                        .Select(r => new CpkPointDto(r.Pid ?? string.Empty, r.InspectTime, r.Value))
                        .ToListAsync();
                    return new CpkAnalysisDto(channelId, stepNumber, stepName, previous.PeriodStart,
                        previous.SampleCount, previous.SpecMin, previous.SpecMax, previous.Mean,
                        previous.StandardDeviation, previous.Cpl, previous.Cpu, previous.Cpk,
                        previousPoints, IsHistoricalCpkPeriod(previous.PeriodStart, fromDate));
                }
                var previousCache = await _db.CpkResultCache.AsNoTracking()
                    .Where(c => c.ChannelId == channelId && c.JobFile == normalizedJobFile
                        && c.StepNumber == stepNumber && c.StepName == stepName
                        && c.FromDate < fromDate && c.SampleCount >= limit && c.Cpk != null)
                    .OrderByDescending(c => c.FromDate).FirstOrDefaultAsync();
                if (previousCache != null)
                {
                    return new CpkAnalysisDto(channelId, stepNumber, stepName, previousCache.FromDate,
                        previousCache.SampleCount, previousCache.SpecMin, previousCache.SpecMax, previousCache.Mean,
                        previousCache.StandardDeviation, previousCache.Cpl, previousCache.Cpu, previousCache.Cpk,
                        JsonSerializer.Deserialize<List<CpkPointDto>>(previousCache.PointsJson) ?? new(), true);
                }
            }
            var values = numericRows.Select(x => x.Value!.Value).ToList();
            var periodStart = numericRows.Count > 0
                ? numericRows.Min(x => x.Row.InspectTime) : fromDate;
            var isHistorical = periodStart < fromDate;
            if (!isHistorical) periodStart = fromDate;
            var specSource = numericRows.Select(x => x.Row)
                .FirstOrDefault(r => ParseMeasurement(r.SpecMin).HasValue && ParseMeasurement(r.SpecMax).HasValue);
            double? specMin = ParseMeasurement(specSource?.SpecMin);
            double? specMax = ParseMeasurement(specSource?.SpecMax);
            double? mean = values.Count > 0 ? values.Average() : null;
            double? stdDev = values.Count > 1
                ? Math.Sqrt(values.Sum(v => Math.Pow(v - mean!.Value, 2)) / (values.Count - 1))
                : null;
            double? cpl = null, cpu = null, cpk = null;
            if (values.Count >= 30 && mean.HasValue && stdDev is > 0 && specMin.HasValue && specMax.HasValue)
            {
                cpl = (mean.Value - specMin.Value) / (3 * stdDev.Value);
                cpu = (specMax.Value - mean.Value) / (3 * stdDev.Value);
                cpk = Math.Min(cpl.Value, cpu.Value);
            }

            var points = numericRows
                .OrderBy(x => x.Row.InspectTime)
                .Select(x => new CpkPointDto(x.Row.Pid, x.Row.InspectTime, x.Value!.Value))
                .ToList();
            var analysis = new CpkAnalysisDto(channelId, stepNumber, stepName, periodStart, values.Count,
                specMin, specMax, mean, stdDev, cpl, cpu, cpk, points, isHistorical);
            var cache = await _db.CpkResultCache.FirstOrDefaultAsync(c =>
                c.ChannelId == channelId && c.JobFile == normalizedJobFile
                && c.StepNumber == stepNumber && c.StepName == stepName && c.FromDate == periodStart);
            if (cache == null)
            {
                cache = new CpkResultCache { ChannelId = channelId, JobFile = normalizedJobFile,
                    StepNumber = stepNumber, StepName = stepName, FromDate = periodStart };
                _db.CpkResultCache.Add(cache);
            }
            cache.SampleCount = values.Count; cache.SpecMin = specMin; cache.SpecMax = specMax;
            cache.Mean = mean; cache.StandardDeviation = stdDev; cache.Cpl = cpl; cache.Cpu = cpu; cache.Cpk = cpk;
            cache.PointsJson = JsonSerializer.Serialize(points); cache.CalculatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return analysis;
        }

        // Served from the in-memory snapshot maintained by CpkEngineService
        // (no database query); updates are pushed via ReceiveCpkUpdate.
        public Task<List<CpkCacheOverviewDto>> GetCpkOverviewAsync() =>
            Task.FromResult(_cpkEngine.GetOverview());

        private static bool IsHistoricalCpkPeriod(DateTime periodStart, DateTime monthStart) =>
            periodStart.Year < monthStart.Year
            || (periodStart.Year == monthStart.Year && periodStart.Month < monthStart.Month);

        private static DateTime MonthStartUtc()
        {
            var now = DateTime.UtcNow;
            return new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        }

        private static HourlyStatDto BuildTrendPoint(DateTime bucket, int total, int ok, int ng,
            int? lineId, int? stationId) => new(
                bucket, lineId ?? 0, stationId ?? 0, total, ok, ng,
                total > 0 ? Math.Round((double)ok / total * 100.0, 2) : 0.0);

        private static bool IsNgResult(string? result) =>
            string.Equals(result, "NG", StringComparison.OrdinalIgnoreCase);

        private static bool IsOkResult(string? result) =>
            string.Equals(result, "OK", StringComparison.OrdinalIgnoreCase)
            || string.Equals(result, "PASS", StringComparison.OrdinalIgnoreCase);

        private static bool PreferIncomingResult(string? existingResult, string? incomingResult) =>
            !IsOkResult(existingResult) && IsOkResult(incomingResult);

        private static string NormalizePcbResult(string? result)
        {
            string normalized = (CleanDbText(result) ?? string.Empty).ToUpperInvariant();
            return normalized switch
            {
                "PASS" => "OK",
                "FAIL" or "CHECK" or "STOP" or "EJECT" or "TIMEOUT" or "GOTO_ERR" => "NG",
                _ => normalized
            };
        }

        private static bool IsNgStepResult(string? result) =>
            string.Equals(result, "NG", StringComparison.OrdinalIgnoreCase)
            || string.Equals(result, "FAIL", StringComparison.OrdinalIgnoreCase)
            || string.Equals(result, "CHECK", StringComparison.OrdinalIgnoreCase)
            || string.Equals(result, "STOP", StringComparison.OrdinalIgnoreCase)
            || string.Equals(result, "TIMEOUT", StringComparison.OrdinalIgnoreCase);

        private static bool ApplyParsedFields(PcbResult target, SubmitPcbRequest source, DateTime inspectTime)
        {
            var incoming = new PcbResult
            {
                JobFile = CleanDbText(source.JobFile),
                ModelId = source.ModelId,
                Fid = CleanDbText(source.Fid),
                PcbaPartNo = CleanDbText(source.PcbaPartNo),
                EndTime = EnsureUtc(source.EndTime),
                TestTime = source.TestTime,
                FilePath = CleanDbText(source.FilePath),
                GmesStatus = CleanDbText(source.GmesStatus),
                InspectTime = inspectTime
            };
            return ApplyParsedFields(target, incoming);
        }

        private static bool ApplyParsedFields(PcbResult target, PcbResult source)
        {
            bool changed = false;

            void Set<T>(T current, T value, Action<T> assign)
            {
                if (EqualityComparer<T>.Default.Equals(current, value)) return;
                assign(value);
                changed = true;
            }

            Set(target.JobFile, source.JobFile, value => target.JobFile = value);
            // Backup Log normally has no database ModelId. Preserve an existing
            // manual/model-mapping value when the replay does not provide one.
            if (source.ModelId.HasValue)
                Set(target.ModelId, source.ModelId, value => target.ModelId = value);
            Set(target.Fid, source.Fid, value => target.Fid = value);
            Set(target.PcbaPartNo, source.PcbaPartNo, value => target.PcbaPartNo = value);
            Set(target.EndTime, source.EndTime, value => target.EndTime = value);
            Set(target.TestTime, source.TestTime, value => target.TestTime = value);
            Set(target.FilePath, source.FilePath, value => target.FilePath = value);
            Set(target.GmesStatus, source.GmesStatus, value => target.GmesStatus = value);
            Set(target.InspectTime, source.InspectTime, value => target.InspectTime = value);

            return changed;
        }

        private void ReplaceNgSteps(PcbResult existing, IReadOnlyCollection<TestStepInputDto>? incomingSteps, string? errorCode)
        {
            foreach (var oldStep in existing.TestSteps.Where(step => IsNgStepResult(step.Result)).ToList())
            {
                existing.TestSteps.Remove(oldStep);
                _db.TestSteps.Remove(oldStep);
            }

            var incomingNgSteps = incomingSteps?.Where(step => IsNgStepResult(step.Result)).ToList()
                                  ?? new List<TestStepInputDto>();
            if (incomingNgSteps.Count == 0)
            {
                existing.TestSteps.Add(new TestStep
                {
                    PcbResultId = existing.Id,
                    StepNumber = 1,
                    StepName = !string.IsNullOrWhiteSpace(errorCode) ? errorCode : "DEFECT_UNSPECIFIED",
                    StepType = "ERROR_CODE",
                    Result = "NG",
                    Value = "-",
                    SpecMin = "-",
                    SpecMax = "-"
                });
                return;
            }

            foreach (var step in incomingNgSteps)
            {
                existing.TestSteps.Add(new TestStep
                {
                    PcbResultId = existing.Id,
                    StepType = CleanDbText(step.StepType),
                    StepNumber = step.StepNumber,
                    StepName = CleanDbText(step.StepName) ?? string.Empty,
                    Result = "NG",
                    Value = CleanDbText(step.Value),
                    SpecMin = CleanDbText(step.SpecMin),
                    SpecMax = CleanDbText(step.SpecMax)
                });
            }
        }

        private static TestStep CloneStep(TestStep source) => new()
        {
            StepType = source.StepType,
            StepNumber = source.StepNumber,
            StepName = source.StepName,
            Result = "NG",
            Value = source.Value,
            SpecMin = source.SpecMin,
            SpecMax = source.SpecMax
        };

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
