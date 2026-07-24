using Microsoft.AspNetCore.Mvc;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers
{
    [ApiController]
    [Route("api/v1/production")]
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

