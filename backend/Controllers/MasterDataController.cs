using Microsoft.AspNetCore.Mvc;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers
{
    [ApiController]
    [Route("api/v1/master")]
    public class MasterDataController : ControllerBase
    {
        private readonly IMasterDataService _masterDataService;

        public MasterDataController(IMasterDataService masterDataService)
        {
            _masterDataService = masterDataService;
        }

        [HttpGet("buyers")]
        public async Task<ActionResult<List<BuyerDto>>> GetBuyers()
        {
            return Ok(await _masterDataService.GetBuyersAsync());
        }

        [HttpPost("buyers")]
        public async Task<ActionResult<BuyerDto>> CreateBuyer([FromBody] CreateBuyerRequest req)
        {
            var res = await _masterDataService.CreateBuyerAsync(req);
            return CreatedAtAction(nameof(GetBuyers), new { id = res.Id }, res);
        }

        [HttpGet("lines")]
        public async Task<ActionResult<List<LineDto>>> GetLines()
        {
            return Ok(await _masterDataService.GetLinesAsync());
        }

        [HttpPost("lines")]
        public async Task<ActionResult<LineDto>> CreateLine([FromBody] CreateLineRequest req)
        {
            var res = await _masterDataService.CreateLineAsync(req);
            return CreatedAtAction(nameof(GetLines), new { id = res.Id }, res);
        }

        [HttpGet("stations")]
        public async Task<ActionResult<List<StationDto>>> GetStations()
        {
            return Ok(await _masterDataService.GetStationsAsync());
        }

        [HttpPost("stations")]
        public async Task<ActionResult<StationDto>> CreateStation([FromBody] CreateStationRequest req)
        {
            var res = await _masterDataService.CreateStationAsync(req);
            return CreatedAtAction(nameof(GetStations), new { id = res.Id }, res);
        }

        [HttpGet("channels")]
        public async Task<ActionResult<List<ChannelDto>>> GetChannels()
        {
            return Ok(await _masterDataService.GetChannelsAsync());
        }

        [HttpPost("channels")]
        public async Task<ActionResult<ChannelDto>> CreateChannel([FromBody] CreateChannelRequest req)
        {
            var res = await _masterDataService.CreateChannelAsync(req);
            return CreatedAtAction(nameof(GetChannels), new { id = res.Id }, res);
        }
    }
}
