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
        private readonly IPcbService _pcbService;

        public ProductionController(IPcbService pcbService)
        {
            _pcbService = pcbService;
        }

        /// <summary>
        /// High-throughput PCB inspection ingestion endpoint.
        /// Called by AOI / SPI / X-Ray machine stations.
        /// </summary>
        [HttpPost("submit")]
        public async Task<ActionResult<PcbResultDto>> Submit([FromBody] SubmitPcbRequest req)
        {
            try
            {
                var result = await _pcbService.SubmitResultAsync(req);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
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

            int successCount = 0;
            int failedCount = 0;
            var details = new List<object>();

            foreach (var req in requests)
            {
                try
                {
                    var result = await _pcbService.SubmitResultAsync(req);
                    successCount++;
                    details.Add(new
                    {
                        pid = req.Pid,
                        start_time = DateTime.UtcNow.ToString("o"),
                        status = "success",
                        inserted_pcb = 1,
                        inserted_steps = req.Steps?.Count ?? 0,
                        error = (string?)null
                    });
                }
                catch (Exception ex)
                {
                    failedCount++;
                    details.Add(new
                    {
                        pid = req.Pid,
                        start_time = DateTime.UtcNow.ToString("o"),
                        status = "failed",
                        inserted_pcb = 0,
                        inserted_steps = 0,
                        error = ex.Message
                    });
                }
            }

            return Ok(new
            {
                status = failedCount == 0 ? "success" : "partial_success",
                count = requests.Count,
                summary = new
                {
                    total = requests.Count,
                    success = successCount,
                    failed = failedCount,
                    skipped = 0
                },
                details = details
            });
        }

        [HttpGet("latest")]
        public async Task<ActionResult<List<PcbResultDto>>> GetLatest(
            [FromQuery] int limit = 100,
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null,
            [FromQuery] string? searchPid = null,
            [FromQuery] string? resultFilter = null)
        {
            return Ok(await _pcbService.GetLatestResultsAsync(limit, lineId, stationId, searchPid, resultFilter));
        }

        [HttpGet("stats/hourly")]
        public async Task<ActionResult<List<HourlyStatDto>>> GetHourlyStats(
            [FromQuery] int hours = 24,
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null)
        {
            return Ok(await _pcbService.GetHourlyStatsAsync(hours, lineId, stationId));
        }

        [HttpGet("stats/line-yield")]
        public async Task<ActionResult<List<LineYieldStatDto>>> GetLineYieldStats([FromQuery] int? lineId = null)
        {
            return Ok(await _pcbService.GetLineYieldStatsAsync(lineId));
        }

        [HttpGet("stats/station-yield")]
        public async Task<ActionResult<List<StationYieldStatDto>>> GetStationYieldStats([FromQuery] int? lineId = null)
        {
            return Ok(await _pcbService.GetStationYieldStatsAsync(lineId));
        }

        [HttpGet("stats/defect-pareto")]
        public async Task<ActionResult<List<DefectParetoStatDto>>> GetDefectPareto(
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null)
        {
            return Ok(await _pcbService.GetDefectParetoAsync(lineId, stationId));
        }

        [HttpGet("summary")]
        public async Task<ActionResult<ProductionSummaryDto>> GetSummary()
        {
            return Ok(await _pcbService.GetSummaryAsync());
        }
    }
}

