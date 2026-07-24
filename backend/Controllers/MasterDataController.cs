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

        // --- BUYERS ---
        [HttpGet("buyers")]
        public async Task<ActionResult<List<BuyerDto>>> GetBuyers()
        {
            return Ok(await _masterDataService.GetBuyersAsync());
        }

        [HttpPost("buyers")]
        public async Task<ActionResult<BuyerDto>> CreateBuyer([FromBody] CreateBuyerRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateBuyerAsync(req);
                return CreatedAtAction(nameof(GetBuyers), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("buyers/{id}")]
        public async Task<ActionResult<BuyerDto>> UpdateBuyer(int id, [FromBody] UpdateBuyerRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateBuyerAsync(id, req);
                if (res == null) return NotFound(new { error = "Buyer not found" });
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("buyers/{id}")]
        public async Task<IActionResult> DeleteBuyer(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteBuyerAsync(id);
                if (!success) return NotFound(new { error = "Buyer không tồn tại" });
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = $"Không thể xóa Buyer: {ex.Message}" });
            }
        }

        // --- LINES ---
        [HttpGet("lines")]
        public async Task<ActionResult<List<LineDto>>> GetLines()
        {
            return Ok(await _masterDataService.GetLinesAsync());
        }

        [HttpPost("lines")]
        public async Task<ActionResult<LineDto>> CreateLine([FromBody] CreateLineRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateLineAsync(req);
                return CreatedAtAction(nameof(GetLines), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("lines/{id}")]
        public async Task<ActionResult<LineDto>> UpdateLine(int id, [FromBody] UpdateLineRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateLineAsync(id, req);
                if (res == null) return NotFound(new { error = "Line not found" });
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("lines/{id}")]
        public async Task<IActionResult> DeleteLine(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteLineAsync(id);
                if (!success) return NotFound(new { error = "Line không tồn tại" });
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = $"Không thể xóa Line này do có dữ liệu liên quan: {ex.Message}" });
            }
        }

        // --- STATIONS ---
        [HttpGet("stations")]
        public async Task<ActionResult<List<StationDto>>> GetStations()
        {
            return Ok(await _masterDataService.GetStationsAsync());
        }

        [HttpPost("stations")]
        public async Task<ActionResult<StationDto>> CreateStation([FromBody] CreateStationRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateStationAsync(req);
                return CreatedAtAction(nameof(GetStations), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("stations/{id}")]
        public async Task<ActionResult<StationDto>> UpdateStation(int id, [FromBody] UpdateStationRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateStationAsync(id, req);
                if (res == null) return NotFound(new { error = "Station not found" });
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("stations/{id}")]
        public async Task<IActionResult> DeleteStation(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteStationAsync(id);
                if (!success) return NotFound(new { error = "Station không tồn tại" });
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = $"Không thể xóa Station này do có dữ liệu liên quan: {ex.Message}" });
            }
        }

        // --- CHANNELS ---
        [HttpGet("channels")]
        public async Task<ActionResult<List<ChannelDto>>> GetChannels()
        {
            return Ok(await _masterDataService.GetChannelsAsync());
        }

        [HttpPost("channels")]
        public async Task<ActionResult<ChannelDto>> CreateChannel([FromBody] CreateChannelRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateChannelAsync(req);
                return CreatedAtAction(nameof(GetChannels), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("channels/{id}")]
        public async Task<ActionResult<ChannelDto>> UpdateChannel(int id, [FromBody] UpdateChannelRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateChannelAsync(id, req);
                if (res == null) return NotFound(new { error = "Channel not found" });
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("channels/{id}")]
        public async Task<IActionResult> DeleteChannel(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteChannelAsync(id);
                if (!success) return NotFound(new { error = "Channel không tồn tại" });
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = $"Không thể xóa Channel này do có dữ liệu liên quan: {ex.Message}" });
            }
        }
    }
}
