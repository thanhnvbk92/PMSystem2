using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;
using System.Text.Json.Serialization;

namespace PMSystem2.Api.Controllers
{
    [ApiController]
    [Route("api/v1/master")]
    [Route("api/master")]
    public class MasterDataController : ControllerBase
    {
        private readonly IMasterDataService _masterDataService;
        private readonly AppDbContext _db;
        private readonly Microsoft.AspNetCore.SignalR.IHubContext<PMSystem2.Api.Hubs.CommandHub, PMSystem2.Api.Hubs.ICommandClient> _commandHubContext;

        public MasterDataController(
            IMasterDataService masterDataService,
            AppDbContext db,
            Microsoft.AspNetCore.SignalR.IHubContext<PMSystem2.Api.Hubs.CommandHub, PMSystem2.Api.Hubs.ICommandClient> commandHubContext)
        {
            _masterDataService = masterDataService;
            _db = db;
            _commandHubContext = commandHubContext;
        }

        [HttpGet("job-file-model-mappings")]
        public async Task<IActionResult> GetJobFileModelMappings(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50,
            [FromQuery] string? search = null,
            [FromQuery] string status = "all")
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 10, 200);

            var all = _db.JobFileModelMappings.AsNoTracking();
            var totalCount = await all.CountAsync();
            var unmappedCount = await all.CountAsync(x => x.ModelId == null);
            var query = all.AsQueryable();

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = $"%{search.Trim()}%";
                query = query.Where(x => EF.Functions.ILike(x.JobFile, term)
                    || (x.Model != null && EF.Functions.ILike(x.Model.Name, term))
                    || (x.Remark != null && EF.Functions.ILike(x.Remark, term)));
            }

            query = status.ToLowerInvariant() switch
            {
                "mapped" => query.Where(x => x.ModelId != null),
                "unmapped" => query.Where(x => x.ModelId == null),
                _ => query
            };

            var filteredCount = await query.CountAsync();
            var items = await query.Include(x => x.Model)
                .OrderBy(x => x.ModelId != null)
                .ThenBy(x => x.JobFile)
                .Select(x => new JobFileModelMappingDto(x.Id, x.JobFile, x.ModelId, x.Model != null ? x.Model.Name : null, x.Remark))
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return Ok(new
            {
                items,
                page,
                pageSize,
                totalCount,
                filteredCount,
                unmappedCount,
                totalPages = Math.Max(1, (int)Math.Ceiling(filteredCount / (double)pageSize))
            });
        }

        [HttpPost("job-file-model-mappings")]
        public async Task<ActionResult<JobFileModelMappingDto>> SaveJobFileModelMapping([FromBody] SaveJobFileModelMappingRequest req)
        {
            var jobFile = req.JobFile?.Trim();
            if (string.IsNullOrWhiteSpace(jobFile)) return BadRequest(new { error = "Job File là bắt buộc." });
            var model = await _db.Models.FindAsync(req.ModelId);
            if (model == null) return BadRequest(new { error = "Model không tồn tại." });
            var item = await _db.JobFileModelMappings.FirstOrDefaultAsync(x => x.JobFile == jobFile);
            if (item == null)
            {
                item = new JobFileModelMapping { JobFile = jobFile, ModelId = req.ModelId, Remark = req.Remark };
                _db.JobFileModelMappings.Add(item);
            }
            else
            {
                item.ModelId = req.ModelId; item.Remark = req.Remark; item.UpdatedAt = DateTime.UtcNow;
            }
            await _db.SaveChangesAsync();
            await NotifyMasterDataChangedAsync("job-file-model-mappings");
            return Ok(new JobFileModelMappingDto(item.Id, item.JobFile, item.ModelId, model.Name, item.Remark));
        }

        [HttpPost("job-file-model-mappings/bulk")]
        public async Task<IActionResult> BulkSaveJobFileModelMappings([FromBody] BulkSaveJobFileModelMappingRequest req)
        {
            var ids = (req.Ids ?? new List<int>()).Where(id => id > 0).Distinct().ToList();
            if (ids.Count == 0) return BadRequest(new { error = "Vui lòng chọn ít nhất một Job File." });
            if (!await _db.Models.AnyAsync(x => x.Id == req.ModelId))
                return BadRequest(new { error = "Model không tồn tại." });

            var updatedAt = DateTime.UtcNow;
            var updated = await _db.JobFileModelMappings
                .Where(x => ids.Contains(x.Id))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.ModelId, req.ModelId)
                    .SetProperty(x => x.UpdatedAt, updatedAt));

            await NotifyMasterDataChangedAsync("job-file-model-mappings");
            return Ok(new { updated });
        }

        [HttpDelete("job-file-model-mappings/{id:int}")]
        public async Task<IActionResult> DeleteJobFileModelMapping(int id)
        {
            var item = await _db.JobFileModelMappings.FindAsync(id);
            if (item == null) return NotFound();
            item.ModelId = null;
            item.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            await NotifyMasterDataChangedAsync("job-file-model-mappings");
            return NoContent();
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
                await NotifyMasterDataChangedAsync("buyers");
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
                await NotifyMasterDataChangedAsync("buyers");
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
                await NotifyMasterDataChangedAsync("buyers");
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = $"Không thể xóa Buyer: {ex.Message}" });
            }
        }

        // --- MODEL GROUPS ---
        [HttpGet("model-groups")]
        public async Task<ActionResult<List<ModelGroupDto>>> GetModelGroups()
        {
            return Ok(await _masterDataService.GetModelGroupsAsync());
        }

        [HttpPost("model-groups")]
        public async Task<ActionResult<ModelGroupDto>> CreateModelGroup([FromBody] CreateModelGroupRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateModelGroupAsync(req);
                await NotifyMasterDataChangedAsync("model-groups");
                return CreatedAtAction(nameof(GetModelGroups), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("model-groups/{id}")]
        public async Task<ActionResult<ModelGroupDto>> UpdateModelGroup(int id, [FromBody] UpdateModelGroupRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateModelGroupAsync(id, req);
                if (res == null) return NotFound(new { error = "ModelGroup not found" });
                await NotifyMasterDataChangedAsync("model-groups");
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("model-groups/{id}")]
        public async Task<IActionResult> DeleteModelGroup(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteModelGroupAsync(id);
                if (!success) return NotFound(new { error = "ModelGroup không tồn tại" });
                await NotifyMasterDataChangedAsync("model-groups");
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        // --- MODELS ---
        [HttpGet("models")]
        public async Task<ActionResult<List<ModelItemDto>>> GetModels()
        {
            return Ok(await _masterDataService.GetModelsAsync());
        }

        [HttpPost("models")]
        public async Task<ActionResult<ModelItemDto>> CreateModel([FromBody] CreateModelItemRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateModelAsync(req);
                await NotifyMasterDataChangedAsync("models");
                return CreatedAtAction(nameof(GetModels), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("models/{id}")]
        public async Task<ActionResult<ModelItemDto>> UpdateModel(int id, [FromBody] UpdateModelItemRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateModelAsync(id, req);
                if (res == null) return NotFound(new { error = "Model not found" });
                await NotifyMasterDataChangedAsync("models");
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("models/{id}")]
        public async Task<IActionResult> DeleteModel(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteModelAsync(id);
                if (!success) return NotFound(new { error = "Model không tồn tại" });
                await NotifyMasterDataChangedAsync("models");
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        // --- STATION TYPES ---
        [HttpGet("station-types")]
        public async Task<ActionResult<List<StationTypeDto>>> GetStationTypes()
        {
            return Ok(await _masterDataService.GetStationTypesAsync());
        }

        [HttpPost("station-types")]
        public async Task<ActionResult<StationTypeDto>> CreateStationType([FromBody] CreateStationTypeRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateStationTypeAsync(req);
                await NotifyMasterDataChangedAsync("station-types");
                return CreatedAtAction(nameof(GetStationTypes), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("station-types/{id}")]
        public async Task<ActionResult<StationTypeDto>> UpdateStationType(int id, [FromBody] UpdateStationTypeRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateStationTypeAsync(id, req);
                if (res == null) return NotFound(new { error = "StationType not found" });
                await NotifyMasterDataChangedAsync("station-types");
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("station-types/{id}")]
        public async Task<IActionResult> DeleteStationType(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteStationTypeAsync(id);
                if (!success) return NotFound(new { error = "StationType không tồn tại" });
                await NotifyMasterDataChangedAsync("station-types");
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
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
                await NotifyMasterDataChangedAsync("lines");
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
                await NotifyMasterDataChangedAsync("lines");
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
                await NotifyMasterDataChangedAsync("lines");
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
                await NotifyMasterDataChangedAsync("stations");
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
                await NotifyMasterDataChangedAsync("stations");
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
                await NotifyMasterDataChangedAsync("stations");
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
            var targetChannelId = req?.EffectiveChannelId;
            var reqMac = req?.EffectiveMacAddress?.Trim();

            if (targetChannelId.HasValue && targetChannelId.Value > 0)
            {
                // Heartbeat is a high-frequency endpoint. Query only the target
                // Channel instead of loading the complete Channel hierarchy.
                var ch = await _masterDataService.GetChannelAsync(targetChannelId.Value);
                if (ch != null)
                {
                    // Heartbeat reports liveness only; it must never create or
                    // replace a Channel identity copied from another machine.
                    if (!string.IsNullOrWhiteSpace(reqMac) &&
                        !string.IsNullOrWhiteSpace(ch.MacAddress) &&
                        !ch.MacAddress.Equals(reqMac, StringComparison.OrdinalIgnoreCase))
                    {
                        Response.Headers["Date"] = DateTime.UtcNow.ToString("r");
                        return Conflict(new
                        {
                            status = "identity_mismatch",
                            timestamp = DateTime.UtcNow,
                            warning = "MAC_MISMATCH",
                            channelId = ch.Id,
                            registeredMac = ch.MacAddress,
                            requestMac = reqMac,
                            message = $"MAC does not match Channel #{ch.Id}. Heartbeat cannot modify Master Data."
                        });
                    }

                    // A blank server MAC is also left untouched. Assign it only
                    // through an explicit Master Data operation.
                    if (string.IsNullOrWhiteSpace(ch.MacAddress)) reqMac = null;

                    if (!string.IsNullOrWhiteSpace(reqMac))
                    {
                        if (string.IsNullOrWhiteSpace(ch.MacAddress))
                        {
                            await _masterDataService.UpdateChannelAsync(ch.Id, new UpdateChannelRequest(ch.StationId, ch.Name, IpAddress: ch.IpAddress, MacAddress: reqMac, Status: "online"));
                            await NotifyMasterDataChangedAsync("channels");
                        }
                        else if (!ch.MacAddress.Equals(reqMac, StringComparison.OrdinalIgnoreCase))
                        {
                            string oldMac = ch.MacAddress;
                            await _masterDataService.UpdateChannelAsync(ch.Id, new UpdateChannelRequest(ch.StationId, ch.Name, IpAddress: ch.IpAddress, MacAddress: reqMac, Status: "online"));
                            await NotifyMasterDataChangedAsync("channels");

                            Response.Headers["Date"] = DateTime.UtcNow.ToString("r");
                            return Ok(new { 
                                status = "online", 
                                timestamp = DateTime.UtcNow,
                                warning = "MAC_CHANGED",
                                oldMac = oldMac,
                                newMac = reqMac,
                                message = $"Cảnh báo: Địa chỉ MAC của Channel #{ch.Id} ({ch.Name}) vừa thay đổi từ [{oldMac}] sang [{reqMac}]. Hệ thống đã tự động cập nhật địa chỉ MAC mới."
                            });
                        }
                        else
                        {
                            if (!string.Equals(ch.Status, "online", StringComparison.OrdinalIgnoreCase))
                            {
                                await _masterDataService.UpdateChannelAsync(ch.Id, new UpdateChannelRequest(ch.StationId, ch.Name, IpAddress: ch.IpAddress, MacAddress: ch.MacAddress, Status: "online"));
                                await NotifyMasterDataChangedAsync("channels");
                            }
                        }
                    }
                    else
                    {
                        if (!string.Equals(ch.Status, "online", StringComparison.OrdinalIgnoreCase))
                        {
                            await _masterDataService.UpdateChannelAsync(ch.Id, new UpdateChannelRequest(ch.StationId, ch.Name, IpAddress: ch.IpAddress, MacAddress: ch.MacAddress, Status: "online"));
                            await NotifyMasterDataChangedAsync("channels");
                        }
                    }
                }
            }
            Response.Headers["Date"] = DateTime.UtcNow.ToString("r");
            return Ok(new { status = "online", timestamp = DateTime.UtcNow });
        }

        [HttpGet("channels/trace/{macAddress}")]
        public async Task<IActionResult> CheckMacExists(
            string macAddress, 
            [FromQuery] int? stationId = null, 
            [FromQuery] string? stationName = null)
        {
            if (string.IsNullOrWhiteSpace(macAddress)) return Ok(new { exists = false });

            var ch = await _masterDataService.FindChannelAsync(macAddress);

            if (ch != null)
            {
                bool isStationMatch = true;
                if (stationId.HasValue && ch.StationId != stationId.Value)
                {
                    isStationMatch = false;
                }
                else if (!string.IsNullOrWhiteSpace(stationName) && !string.Equals(ch.StationName, stationName, StringComparison.OrdinalIgnoreCase))
                {
                    isStationMatch = false;
                }

                return Ok(new { 
                    exists = true, 
                    isStationMatch = isStationMatch,
                    data = new { id = ch.Id, station_id = ch.StationId, name = ch.Name, station_name = ch.StationName, line_name = ch.LineName, ip = ch.IpAddress, mac = ch.MacAddress, status = ch.Status },
                    conflictDetails = !isStationMatch ? new {
                        conflictingChannelId = ch.Id,
                        conflictingChannelName = ch.Name,
                        conflictingStationId = ch.StationId,
                        conflictingStationName = ch.StationName,
                        conflictingLineName = ch.LineName,
                        ipAddress = ch.IpAddress,
                        macAddress = ch.MacAddress
                    } : null
                });
            }

            return Ok(new { exists = false });
        }

        [HttpGet("channels/resolve")]
        public async Task<IActionResult> ResolveChannel([FromQuery] string? mac = null, [FromQuery] string? ip = null)
        {
            var normalizedMac = mac?.Trim();
            var normalizedIp = ip?.Trim();
            if (string.IsNullOrWhiteSpace(normalizedMac) && string.IsNullOrWhiteSpace(normalizedIp))
                return BadRequest(new { error = "MAC hoặc IP là bắt buộc." });

            var query = _db.Channels
                .Include(c => c.Station).ThenInclude(s => s!.Line)
                .Include(c => c.Station).ThenInclude(s => s!.ModelGroup).ThenInclude(g => g!.Buyer)
                .AsQueryable();

            Channel? channel = null;
            string? matchedBy = null;
            if (!string.IsNullOrWhiteSpace(normalizedMac))
            {
                channel = await query.OrderBy(c => c.Id).FirstOrDefaultAsync(c =>
                    c.MacAddress != null && EF.Functions.ILike(c.MacAddress, normalizedMac));
                if (channel != null) matchedBy = "MAC";
            }
            if (channel != null && !string.IsNullOrWhiteSpace(normalizedIp) &&
                !string.Equals(channel.IpAddress, normalizedIp, StringComparison.OrdinalIgnoreCase))
            {
                var ipOwner = await _db.Channels.AsNoTracking().FirstOrDefaultAsync(c =>
                    c.Id != channel.Id && c.IpAddress != null && EF.Functions.ILike(c.IpAddress, normalizedIp));
                if (ipOwner != null)
                    return Conflict(new { error = "IP_CONFLICT", channelId = channel.Id, conflictingChannelId = ipOwner.Id });

                channel.IpAddress = normalizedIp;
                await _db.SaveChangesAsync();
                await _masterDataService.RefreshCacheAsync();
                await NotifyMasterDataChangedAsync("channels");
            }
            if (channel == null && !string.IsNullOrWhiteSpace(normalizedIp))
            {
                channel = await query.OrderBy(c => c.Id).FirstOrDefaultAsync(c =>
                    c.IpAddress != null && EF.Functions.ILike(c.IpAddress, normalizedIp));
                if (channel != null)
                {
                    matchedBy = "IP";
                    if (!string.IsNullOrWhiteSpace(normalizedMac) &&
                        !string.IsNullOrWhiteSpace(channel.MacAddress) &&
                        !string.Equals(channel.MacAddress, normalizedMac, StringComparison.OrdinalIgnoreCase))
                        return Conflict(new
                        {
                            error = "MAC_CONFLICT",
                            channelId = channel.Id,
                            registeredMac = channel.MacAddress,
                            requestMac = normalizedMac
                        });

                    if (string.IsNullOrWhiteSpace(channel.MacAddress) && !string.IsNullOrWhiteSpace(normalizedMac))
                    {
                        channel.MacAddress = normalizedMac;
                        await _db.SaveChangesAsync();
                        await _masterDataService.RefreshCacheAsync();
                        await NotifyMasterDataChangedAsync("channels");
                    }
                }
            }

            if (channel == null) return Ok(new { exists = false });
            return Ok(new
            {
                exists = true,
                matchedBy,
                data = new
                {
                    channelId = channel.Id,
                    channelName = channel.Name,
                    channel.IpAddress,
                    channel.MacAddress,
                    stationId = channel.StationId,
                    stationName = channel.Station?.Name,
                    lineId = channel.Station?.LineId,
                    lineName = channel.Station?.Line?.Name,
                    modelGroupId = channel.Station?.ModelGroupId,
                    modelGroupName = channel.Station?.ModelGroup?.Name,
                    buyerId = channel.Station?.ModelGroup?.BuyerId,
                    buyerName = channel.Station?.ModelGroup?.Buyer?.Name
                }
            });
        }

        [HttpGet("channels/machine-options")]
        public async Task<IActionResult> GetMachineOptions()
        {
            return Ok(new
            {
                buyers = await _masterDataService.GetBuyersAsync(),
                modelGroups = await _masterDataService.GetModelGroupsAsync(),
                lines = await _masterDataService.GetLinesAsync(),
                stations = await _masterDataService.GetStationsAsync()
            });
        }

        [HttpPatch("channels/{id:int}/station")]
        public async Task<IActionResult> AssignChannelStation(int id, [FromBody] AssignChannelStationRequest req)
        {
            var channel = await _db.Channels.FindAsync(id);
            if (channel == null) return NotFound(new { error = "Channel not found" });
            if (!await _db.Stations.AnyAsync(s => s.Id == req.StationId))
                return BadRequest(new { error = "Station not found" });

            channel.StationId = req.StationId;
            await _db.SaveChangesAsync();
            await _masterDataService.RefreshCacheAsync();
            await NotifyMasterDataChangedAsync("channels");
            return Ok(new { channelId = channel.Id, stationId = channel.StationId });
        }

        [HttpPost("channels")]
        public async Task<IActionResult> CreateChannel([FromBody] ChannelRegisterPayload req)
        {
            try
            {
                var stations = await _masterDataService.GetStationsAsync();
                int stationId = req.StationId ?? req.Station_Id ?? (stations.FirstOrDefault()?.Id ?? 1);

                var targetIp = req.IpAddress ?? req.Ip_Address ?? "127.0.0.1";
                targetIp = string.IsNullOrWhiteSpace(targetIp) ? "127.0.0.1" : targetIp.Trim();
                var targetMac = (req.MacAddress ?? req.Mac_Address)?.Trim();

                if (targetIp != "127.0.0.1")
                {
                    var matchedChannel = await _masterDataService.FindChannelAsync(targetIp);

                    if (matchedChannel != null)
                    {
                        if (!string.IsNullOrWhiteSpace(targetMac) &&
                            !string.IsNullOrWhiteSpace(matchedChannel.MacAddress) &&
                            !matchedChannel.MacAddress.Equals(targetMac, StringComparison.OrdinalIgnoreCase))
                        {
                            return Conflict(new
                            {
                                error = "MAC_CONFLICT",
                                channelId = matchedChannel.Id,
                                registeredMac = matchedChannel.MacAddress,
                                requestMac = targetMac
                            });
                        }

                        if (matchedChannel.StationId == stationId)
                        {
                            if (!string.IsNullOrWhiteSpace(targetMac))
                            {
                                if (string.IsNullOrWhiteSpace(matchedChannel.MacAddress))
                                {
                                    await _masterDataService.UpdateChannelAsync(matchedChannel.Id, new UpdateChannelRequest(
                                        matchedChannel.StationId, matchedChannel.Name, IpAddress: matchedChannel.IpAddress, MacAddress: targetMac, Status: matchedChannel.Status
                                    ));
                                    await NotifyMasterDataChangedAsync("channels");
                                }
                                else if (!matchedChannel.MacAddress.Equals(targetMac, StringComparison.OrdinalIgnoreCase))
                                {
                                    string oldMac = matchedChannel.MacAddress;
                                    await _masterDataService.UpdateChannelAsync(matchedChannel.Id, new UpdateChannelRequest(
                                        matchedChannel.StationId, matchedChannel.Name, IpAddress: matchedChannel.IpAddress, MacAddress: targetMac, Status: matchedChannel.Status
                                    ));
                                    await NotifyMasterDataChangedAsync("channels");

                                    return Ok(new { 
                                        data = new { id = matchedChannel.Id, station_id = matchedChannel.StationId, name = matchedChannel.Name, status = matchedChannel.Status, macAddress = targetMac },
                                        warning = "MAC_CHANGED",
                                        message = $"Địa chỉ MAC của Channel #{matchedChannel.Id} ({matchedChannel.Name}) vừa thay đổi từ [{oldMac}] sang [{targetMac}]. Hệ thống đã tự động cập nhật địa chỉ MAC mới."
                                    });
                                }
                            }

                            return Ok(new { data = new { id = matchedChannel.Id, station_id = matchedChannel.StationId, name = matchedChannel.Name, status = matchedChannel.Status, macAddress = matchedChannel.MacAddress } });
                        }

                        return BadRequest(new { 
                            error = "CONFIG_MISMATCH", 
                            message = $"Địa chỉ IP {targetIp} đang được đăng ký chính thức cho Station '{matchedChannel.StationName}' (Chuyền: {matchedChannel.LineName ?? "N/A"}) trên Master Data Server, nhưng Backup Log lại khai báo Station ID {stationId}. Vui lòng sửa lại tên Station cho đúng hoặc cập nhật Master Data trên Web UI.",
                            serverChannelId = matchedChannel.Id,
                            serverStationName = matchedChannel.StationName,
                            serverLineName = matchedChannel.LineName
                        });
                    }
                }

                var createReq = new CreateChannelRequest(stationId, req.Name, IpAddress: targetIp, MacAddress: targetMac);
                var res = await _masterDataService.CreateChannelAsync(createReq);
                await NotifyMasterDataChangedAsync("channels");
                return Ok(new { data = new { id = res.Id, station_id = res.StationId, name = res.Name, status = res.Status, macAddress = res.MacAddress } });
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
                await NotifyMasterDataChangedAsync("channels");
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
                await NotifyMasterDataChangedAsync("channels");
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = $"Không thể xóa Channel này do có dữ liệu liên quan: {ex.Message}" });
            }
        }

        [HttpPost("channels/merge")]
        public async Task<ActionResult<ChannelDto>> MergeChannels([FromBody] MergeChannelsPayload req)
        {
            try
            {
                var res = await _masterDataService.MergeChannelsAsync(req.SourceChannelId, req.TargetChannelId);
                await NotifyMasterDataChangedAsync("channels");
                return Ok(res);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        // --- DEVICE TYPES ---
        [HttpGet("device-types")]
        public async Task<ActionResult<List<DeviceTypeDto>>> GetDeviceTypes()
        {
            return Ok(await _masterDataService.GetDeviceTypesAsync());
        }

        [HttpPost("device-types")]
        public async Task<ActionResult<DeviceTypeDto>> CreateDeviceType([FromBody] CreateDeviceTypeRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateDeviceTypeAsync(req);
                await NotifyMasterDataChangedAsync("device-types");
                return CreatedAtAction(nameof(GetDeviceTypes), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("device-types/{id}")]
        public async Task<ActionResult<DeviceTypeDto>> UpdateDeviceType(int id, [FromBody] UpdateDeviceTypeRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateDeviceTypeAsync(id, req);
                if (res == null) return NotFound(new { error = "DeviceType not found" });
                await NotifyMasterDataChangedAsync("device-types");
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("device-types/{id}")]
        public async Task<IActionResult> DeleteDeviceType(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteDeviceTypeAsync(id);
                if (!success) return NotFound(new { error = "DeviceType không tồn tại" });
                await NotifyMasterDataChangedAsync("device-types");
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        // --- DEVICES ---
        [HttpGet("devices")]
        public async Task<ActionResult<List<DeviceDto>>> GetDevices()
        {
            return Ok(await _masterDataService.GetDevicesAsync());
        }

        [HttpPost("devices")]
        public async Task<ActionResult<DeviceDto>> CreateDevice([FromBody] CreateDeviceRequest req)
        {
            try
            {
                var res = await _masterDataService.CreateDeviceAsync(req);
                await NotifyMasterDataChangedAsync("devices");
                return CreatedAtAction(nameof(GetDevices), new { id = res.Id }, res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("devices/{id}")]
        public async Task<ActionResult<DeviceDto>> UpdateDevice(int id, [FromBody] UpdateDeviceRequest req)
        {
            try
            {
                var res = await _masterDataService.UpdateDeviceAsync(id, req);
                if (res == null) return NotFound(new { error = "Device not found" });
                await NotifyMasterDataChangedAsync("devices");
                return Ok(res);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("devices/{id}")]
        public async Task<IActionResult> DeleteDevice(int id)
        {
            try
            {
                var success = await _masterDataService.DeleteDeviceAsync(id);
                if (!success) return NotFound(new { error = "Device không tồn tại" });
                await NotifyMasterDataChangedAsync("devices");
                return NoContent();
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }
    }

    public class MergeChannelsPayload
    {
        public int SourceChannelId { get; set; }
        public int TargetChannelId { get; set; }
    }

    public class AssignChannelStationRequest
    {
        public int StationId { get; set; }
    }

    public class HeartbeatPayload
    {
        public int? ChannelId { get; set; }

        [JsonPropertyName("channel_id")]
        public int? ChannelIdSnake { get; set; }

        public string? MacAddress { get; set; }

        [JsonPropertyName("mac_address")]
        public string? MacAddressSnake { get; set; }

        [JsonIgnore]
        public int? EffectiveChannelId => ChannelId ?? ChannelIdSnake;

        [JsonIgnore]
        public string? EffectiveMacAddress => MacAddress ?? MacAddressSnake;
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
