using Microsoft.AspNetCore.Mvc;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers
{
    [ApiController]
    [Route("api/v1/master")]
    [Route("api/master")]
    public class MasterDataController : ControllerBase
    {
        private readonly IMasterDataService _masterDataService;
        private readonly Microsoft.AspNetCore.SignalR.IHubContext<PMSystem2.Api.Hubs.CommandHub, PMSystem2.Api.Hubs.ICommandClient> _commandHubContext;

        public MasterDataController(
            IMasterDataService masterDataService,
            Microsoft.AspNetCore.SignalR.IHubContext<PMSystem2.Api.Hubs.CommandHub, PMSystem2.Api.Hubs.ICommandClient> commandHubContext)
        {
            _masterDataService = masterDataService;
            _commandHubContext = commandHubContext;
        }

        private async Task NotifyMasterDataChangedAsync(string entityType)
        {
            try
            {
                await _commandHubContext.Clients.All.NotifyMasterDataUpdated(entityType);
            }
            catch
            {
                // Non-blocking notification
            }
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

        [HttpPost("channels/heartbeat")]
        public async Task<IActionResult> Heartbeat([FromBody] HeartbeatPayload? req)
        {
            var targetChannelId = req?.ChannelId ?? req?.Channelid;
            if (targetChannelId.HasValue && targetChannelId.Value > 0)
            {
                var channels = await _masterDataService.GetChannelsAsync();
                var ch = channels.FirstOrDefault(c => c.Id == targetChannelId.Value);
                if (ch != null)
                {
                    await _masterDataService.UpdateChannelAsync(ch.Id, new UpdateChannelRequest(ch.StationId, ch.Name, ch.IpAddress, "online"));
                }
            }
            Response.Headers["Date"] = DateTime.UtcNow.ToString("r");
            return Ok(new { status = "online", timestamp = DateTime.UtcNow });
        }

        [HttpGet("channels/trace/{macAddress}")]
        public async Task<IActionResult> CheckMacExists(string macAddress)
        {
            if (string.IsNullOrWhiteSpace(macAddress)) return Ok(new { exists = false });

            var channels = await _masterDataService.GetChannelsAsync();
            var ch = channels.FirstOrDefault(c => 
                (c.IpAddress != null && c.IpAddress.Equals(macAddress, StringComparison.OrdinalIgnoreCase)) ||
                (c.Name != null && c.Name.Contains(macAddress, StringComparison.OrdinalIgnoreCase)));

            if (ch != null)
            {
                return Ok(new { exists = true, data = new { id = ch.Id, station_id = ch.StationId, name = ch.Name, remark = "", status = ch.Status } });
            }

            return Ok(new { exists = false });
        }

        [HttpPost("channels")]
        public async Task<IActionResult> CreateChannel([FromBody] ChannelRegisterPayload req)
        {
            try
            {
                var stations = await _masterDataService.GetStationsAsync();
                int stationId = req.StationId ?? req.Station_Id ?? (stations.FirstOrDefault()?.Id ?? 1);

                var createReq = new CreateChannelRequest(stationId, req.Name, req.IpAddress ?? req.Ip_Address ?? "127.0.0.1");
                var res = await _masterDataService.CreateChannelAsync(createReq);
                return Ok(new { data = new { id = res.Id, station_id = res.StationId, name = res.Name, status = res.Status } });
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

    public class HeartbeatPayload
    {
        public int? ChannelId { get; set; }
        public int? Channelid { get; set; }
        public string? MacAddress { get; set; }
        public string? Mac_Address { get; set; }
    }

    public class ChannelRegisterPayload
    {
        public string Name { get; set; } = string.Empty;
        public string? MacAddress { get; set; }
        public string? Mac_Address { get; set; }
        public string? IpAddress { get; set; }
        public string? Ip_Address { get; set; }
        public string? Remark { get; set; }
        public int? StationId { get; set; }
        public int? Station_Id { get; set; }
    }
}
