using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers
{
    [ApiController]
    [Route("api/v1/production")]
    [Route("api/production")]
    public class ProductionController : ControllerBase
    {
        // Bound concurrent ingestion without serializing every station behind one
        // large RF/backlog batch. Database uniqueness on (PID, StartTime), plus the
        // conflict recovery in PcbService, protects overlapping submissions.
        private const int MaxConcurrentIngestionRequests = 8;
        private static readonly SemaphoreSlim IngestionGate =
            new(MaxConcurrentIngestionRequests, MaxConcurrentIngestionRequests);
        // One upload at a time per Channel: a collector that resends a batch after a
        // client timeout waits for its own previous request to finish, so the
        // duplicate check sees the rows already stored instead of racing them.
        private static readonly ConcurrentDictionary<int, SemaphoreSlim> ChannelGates = new();
        private static readonly TimeSpan ChannelGateWait = TimeSpan.FromSeconds(60);

        private readonly IPcbService _pcbService;
        private readonly IInvalidPcbResultService _invalidResults;

        /// <summary>Acquires the gates of all Channels (ascending order); null when busy.</summary>
        private static async Task<List<SemaphoreSlim>?> AcquireChannelsAsync(IEnumerable<int> channelIds, CancellationToken token)
        {
            var acquired = new List<SemaphoreSlim>();
            foreach (var id in channelIds.Distinct().OrderBy(id => id))
            {
                var gate = ChannelGates.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
                if (!await gate.WaitAsync(ChannelGateWait, token))
                {
                    foreach (var held in acquired) held.Release();
                    return null;
                }
                acquired.Add(gate);
            }
            return acquired;
        }

        private ObjectResult ChannelBusy()
        {
            Response.Headers["Retry-After"] = "30";
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { error = "CHANNEL_BUSY", retryable = true, message = "A previous upload of this Channel is still being processed." });
        }

        public ProductionController(IPcbService pcbService, IInvalidPcbResultService invalidResults)
        {
            _pcbService = pcbService;
            _invalidResults = invalidResults;
        }

        private static int[] ParseIds(string? value) => string.IsNullOrWhiteSpace(value)
            ? Array.Empty<int>()
            : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => int.TryParse(x, out var id) ? (int?)id : null)
                .Where(id => id.HasValue && id.Value >= 0)
                .Select(id => id!.Value)
                .Distinct()
                .ToArray();

        /// <summary>
        /// High-throughput PCB inspection ingestion endpoint.
        /// Called by AOI / SPI / X-Ray machine stations.
        /// </summary>
        [HttpPost("submit")]
        public async Task<ActionResult<PcbResultDto>> Submit([FromBody] SubmitPcbRequest req)
        {
            if (!_invalidResults.IsValidResult(req.Result))
            {
                await _invalidResults.QuarantineAsync(req, HttpContext.RequestAborted);
                return Accepted(new
                {
                    status = "quarantined",
                    pid = req.Pid,
                    raw_result = req.Result,
                    message = "PCB result was preserved for review and was not included in production KPIs."
                });
            }
            var channelGates = await AcquireChannelsAsync(new[] { req.ChannelId }, HttpContext.RequestAborted);
            if (channelGates == null) return ChannelBusy();
            try
            {
            await IngestionGate.WaitAsync(HttpContext.RequestAborted);
            try
            {
                var result = await _pcbService.SubmitResultAsync(req);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex) when (IsDatabaseCapacityFailure(ex))
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    new { error = "DATABASE_BUSY", retryable = true });
            }
            finally
            {
                IngestionGate.Release();
            }
            }
            finally
            {
                foreach (var gate in channelGates) gate.Release();
            }
        }

        /// <summary>
        /// Lets a collector skip records that are already stored (same PID, start time,
        /// Channel and an equal-or-better result) before it resends them.
        /// </summary>
        [HttpPost("existing")]
        public async Task<ActionResult<List<ExistingPcbKey>>> Existing([FromBody] List<ExistingPcbQuery> keys)
        {
            if (keys == null || keys.Count == 0) return Ok(new List<ExistingPcbKey>());
            if (keys.Count > 1000) return BadRequest(new { error = "At most 1000 records per request." });
            return Ok(await _pcbService.FindExistingAsync(keys));
        }

        /// <summary>
        /// Batch PCB inspection ingestion endpoint.
        /// </summary>
        [HttpPost("submit_batch")]
        public async Task<IActionResult> SubmitBatch([FromBody] List<SubmitPcbRequest> requests)
        {
            if (requests == null || requests.Count == 0)
            {
                return Ok(new
                {
                    status = "success",
                    count = 0,
                    summary = new { total = 0, success = 0, failed = 0, skipped = 0 },
                    details = new List<object>()
                });
            }

            var invalidRequests = requests.Where(x => !_invalidResults.IsValidResult(x.Result)).ToList();
            foreach (var invalid in invalidRequests)
                await _invalidResults.QuarantineAsync(invalid, HttpContext.RequestAborted);
            var validRequests = requests.Where(x => _invalidResults.IsValidResult(x.Result)).ToList();

            var channelGates = await AcquireChannelsAsync(validRequests.Select(r => r.ChannelId), HttpContext.RequestAborted);
            if (channelGates == null) return ChannelBusy();
            List<PcbResultDto> results;
            try
            {
                await IngestionGate.WaitAsync(HttpContext.RequestAborted);
                try
                {
                    results = await _pcbService.SubmitBatchAsync(validRequests);
                }
                finally
                {
                    IngestionGate.Release();
                }
            }
            catch (Exception ex) when (IsDatabaseCapacityFailure(ex))
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    new { error = "DATABASE_BUSY", retryable = true });
            }
            finally
            {
                foreach (var gate in channelGates) gate.Release();
            }

            // Report every record that was not stored as an "error" detail with its own
            // PID/start time, so the collector retries exactly those (before, failed
            // records were only counted and therefore never retried).
            var stored = results.Select(r => (Pid: r.Pid ?? "", Start: r.StartTime)).ToList();
            var failedRequests = validRequests.Where(req => !stored.Any(s =>
                    string.Equals(s.Pid, (req.Pid ?? "").Trim(), StringComparison.OrdinalIgnoreCase)
                    && (s.Start.HasValue && (req.StartTime ?? req.InspectTime).HasValue
                        ? Math.Abs((s.Start.Value - (req.StartTime ?? req.InspectTime)!.Value).TotalSeconds) < 1
                        : true)))
                .ToList();
            int successCount = results.Count;
            int skippedCount = invalidRequests.Count;
            int failedCount = Math.Max(validRequests.Count - successCount, failedRequests.Count);

            return Ok(new
            {
                status = failedCount == 0 && skippedCount == 0 ? "success" : "partial_success",
                count = requests.Count,
                summary = new
                {
                    total = requests.Count,
                    success = successCount,
                    failed = failedCount,
                    skipped = skippedCount
                },
                details = results.Select(r => (object)new
                {
                    pid = r.Pid,
                    // The tester's own wall-clock start time (not the server time).
                    start_time = r.StartTime.HasValue
                        ? DateTime.SpecifyKind(r.StartTime.Value, DateTimeKind.Unspecified).ToString("o") : null,
                    status = "success",
                    inserted_pcb = 1,
                    inserted_steps = r.Steps?.Count ?? 0,
                    error = (string?)null
                }).Concat(failedRequests.Select(r => (object)new
                {
                    pid = r.Pid,
                    start_time = (r.StartTime ?? r.InspectTime)?.ToString("o"),
                    status = "error",
                    inserted_pcb = 0,
                    inserted_steps = 0,
                    error = (string?)"Record was not stored; please retry."
                })).Concat(invalidRequests.Select(r => (object)new
                {
                    pid = r.Pid,
                    start_time = r.StartTime?.ToString("o"),
                    status = "quarantined",
                    inserted_pcb = 0,
                    inserted_steps = 0,
                    error = (string?)null,
                    raw_result = r.Result
                })).ToList()
            });
        }

        private static bool IsDatabaseCapacityFailure(Exception ex)
        {
            for (Exception? current = ex; current != null; current = current.InnerException)
            {
                var message = current.Message;
                if (message.Contains("connection pool", StringComparison.OrdinalIgnoreCase) ||
                    message.Contains("timed out", StringComparison.OrdinalIgnoreCase) ||
                    message.Contains("transient failure", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        [HttpGet("cpk/steps")]
        public async Task<ActionResult<List<CpkStepOptionDto>>> GetCpkSteps([FromQuery] int channelId)
        {
            if (channelId <= 0) return BadRequest(new { error = "channelId is required" });
            return Ok(await _pcbService.GetCpkStepsAsync(channelId));
        }

        [HttpGet("cpk/station-steps")]
        public async Task<ActionResult<List<CpkStepOptionDto>>> GetStationCpkSteps([FromQuery] int stationId)
        {
            if (stationId <= 0) return BadRequest(new { error = "stationId is required" });
            return Ok(await _pcbService.GetStationCpkStepsAsync(stationId));
        }

        [HttpGet("cpk")]
        public async Task<ActionResult<CpkAnalysisDto>> GetCpk(
            [FromQuery] int channelId,
            [FromQuery] int stepNumber,
            [FromQuery] string stepName,
            [FromQuery] string? jobFile = null,
            [FromQuery] int limit = 50)
        {
            if (channelId <= 0 || string.IsNullOrWhiteSpace(stepName))
                return BadRequest(new { error = "channelId and stepName are required" });
            return Ok(await _pcbService.GetCpkAnalysisAsync(channelId, stepNumber, stepName, jobFile, limit));
        }

        [HttpGet("cpk/overview")]
        public async Task<ActionResult<List<CpkCacheOverviewDto>>> GetCpkOverview()
        {
            return Ok(await _pcbService.GetCpkOverviewAsync());
        }

        [HttpGet("cpk/report")]
        public async Task<IActionResult> ExportCpkReport(CancellationToken cancellationToken)
        {
            var bytes = await _pcbService.GetCpkReportAsync(cancellationToken);
            var reportTime = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Bangkok");
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"CPK_Report_All_{reportTime:yyyyMMdd_HHmmss}.xlsx");
        }

        [HttpGet("latest")]
        public async Task<ActionResult<List<PcbResultDto>>> GetLatest(
            [FromQuery] int limit = 100,
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null,
            [FromQuery] string? lineIds = null,
            [FromQuery] string? stationIds = null,
            [FromQuery] string? channelIds = null,
            [FromQuery] string? searchPid = null,
            [FromQuery] string? searchFid = null,
            [FromQuery] string? searchError = null,
            [FromQuery] string? resultFilter = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            return Ok(await _pcbService.GetLatestResultsAsync(limit, lineId, stationId, searchPid, searchFid, searchError, resultFilter, startDate, endDate, ParseIds(lineIds), ParseIds(stationIds), ParseIds(channelIds)));
        }

        /// <summary>
        /// Get matching total record count for CSV export filtering.
        /// </summary>
        [HttpGet("export-count")]
        public async Task<ActionResult<int>> GetExportCount(
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null,
            [FromQuery] string? lineIds = null,
            [FromQuery] string? stationIds = null,
            [FromQuery] string? channelIds = null,
            [FromQuery] string? searchPid = null,
            [FromQuery] string? searchFid = null,
            [FromQuery] string? searchError = null,
            [FromQuery] string? resultFilter = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            var count = await _pcbService.GetExportCountAsync(lineId, stationId, searchPid, searchFid, searchError, resultFilter, startDate, endDate, ParseIds(lineIds), ParseIds(stationIds), ParseIds(channelIds));
            return Ok(count);
        }

        /// <summary>
        /// Export filtered PCB inspection data to a formatted CSV file.
        /// If limit is omitted or null, exports all matching records without restriction.
        /// </summary>
        [HttpGet("export-csv")]
        public async Task<IActionResult> ExportCsv(
            [FromQuery] int? limit = null,
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null,
            [FromQuery] string? lineIds = null,
            [FromQuery] string? stationIds = null,
            [FromQuery] string? channelIds = null,
            [FromQuery] string? searchPid = null,
            [FromQuery] string? searchFid = null,
            [FromQuery] string? searchError = null,
            [FromQuery] string? resultFilter = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            var bytes = await _pcbService.GetExportCsvAsync(limit, lineId, stationId, searchPid, searchFid, searchError, resultFilter, startDate, endDate, ParseIds(lineIds), ParseIds(stationIds), ParseIds(channelIds));
            var fileName = $"PMSystem_Production_Data_{DateTime.Now:yyyyMMdd_HHmmss}.csv";
            return File(bytes, "text/csv; charset=utf-8", fileName);
        }

        [HttpGet("stats/hourly")]
        public async Task<ActionResult<List<HourlyStatDto>>> GetHourlyStats(
            [FromQuery] int hours = 24,
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            return Ok(await _pcbService.GetHourlyStatsAsync(hours, lineId, stationId, startDate, endDate));
        }

        [HttpGet("stats/line-yield")]
        public async Task<ActionResult<List<LineYieldStatDto>>> GetLineYieldStats(
            [FromQuery] int? lineId = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            return Ok(await _pcbService.GetLineYieldStatsAsync(lineId, startDate, endDate));
        }

        [HttpGet("stats/station-yield")]
        public async Task<ActionResult<List<StationYieldStatDto>>> GetStationYieldStats(
            [FromQuery] int? lineId = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            return Ok(await _pcbService.GetStationYieldStatsAsync(lineId, startDate, endDate));
        }

        [HttpGet("stats/defect-pareto")]
        public async Task<ActionResult<List<DefectParetoStatDto>>> GetDefectPareto(
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            return Ok(await _pcbService.GetDefectParetoAsync(lineId, stationId, startDate, endDate));
        }

        [HttpGet("summary")]
        public async Task<ActionResult<ProductionSummaryDto>> GetSummary(
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            return Ok(await _pcbService.GetSummaryAsync(lineId, stationId, startDate, endDate));
        }

        [HttpGet("counters")]
        public async Task<ActionResult<ProductionCounterDto>> GetCounters(
            [FromQuery] int? lineId = null, [FromQuery] int? stationId = null,
            [FromQuery] DateTime? startDate = null, [FromQuery] DateTime? endDate = null)
        {
            return Ok(await _pcbService.GetCountersAsync(lineId, stationId, startDate, endDate));
        }

        [HttpGet("quality-modes")]
        public async Task<ActionResult<QualityModeSummaryDto>> GetQualityModes(
            [FromQuery] int? lineId = null, [FromQuery] int? stationId = null,
            [FromQuery] DateTime? startDate = null, [FromQuery] DateTime? endDate = null)
        {
            return Ok(await _pcbService.GetQualityModesAsync(lineId, stationId, startDate, endDate));
        }

        [HttpGet("stats/bi-matrix")]
        public async Task<ActionResult<BiAnalyticsMatrixDto>> GetBiMatrix(
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null,
            [FromQuery] int? channelId = null,
            [FromQuery] int? modelId = null,
            [FromQuery] string? errorCode = null,
            [FromQuery] string? jobFile = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null,
            [FromQuery] int hours = 24)
        {
            return Ok(await _pcbService.GetBiMatrixAsync(lineId, stationId, channelId, modelId, errorCode, jobFile, startDate, endDate, hours));
        }
    }
}
