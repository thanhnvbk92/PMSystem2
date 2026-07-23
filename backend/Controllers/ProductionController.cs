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
            [FromQuery] int limit = 50,
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null)
        {
            return Ok(await _pcbService.GetLatestResultsAsync(limit, lineId, stationId));
        }

        [HttpGet("stats/hourly")]
        public async Task<ActionResult<List<HourlyStatDto>>> GetHourlyStats(
            [FromQuery] int hours = 24,
            [FromQuery] int? lineId = null,
            [FromQuery] int? stationId = null)
        {
            return Ok(await _pcbService.GetHourlyStatsAsync(hours, lineId, stationId));
        }

        [HttpGet("summary")]
        public async Task<ActionResult<ProductionSummaryDto>> GetSummary()
        {
            return Ok(await _pcbService.GetSummaryAsync());
        }
    }
}
