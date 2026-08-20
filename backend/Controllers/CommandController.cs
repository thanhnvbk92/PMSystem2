using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using PMSystem2.Api.Hubs;

namespace PMSystem2.Api.Controllers
{
    public class SendCommandRequest
    {
        public List<int>? ChannelIds { get; set; }
        public string? MacAddress { get; set; }
        public int? ChannelId { get; set; }
        public int? StationId { get; set; }
        public int? LineId { get; set; }
        public string Command { get; set; } = string.Empty;
        public object? Data { get; set; }
    }

    public class ChangeModelCommandRequest
    {
        public string? MacAddress { get; set; }
        public int? ChannelId { get; set; }
        public int? StationId { get; set; }
        public int? LineId { get; set; }
        public string ModelName { get; set; } = string.Empty;
    }

    public class RestartCommandRequest
    {
        public string? MacAddress { get; set; }
        public int? ChannelId { get; set; }
        public int? StationId { get; set; }
        public int? LineId { get; set; }
        public int DelayMs { get; set; } = 1500;
    }

    public class UpdateAppCommandRequest
    {
        public List<int>? ChannelIds { get; set; }
        public string? MacAddress { get; set; }
        public int? ChannelId { get; set; }
        public int? StationId { get; set; }
        public int? LineId { get; set; }
        public bool Force { get; set; } = true;
        public string? UpdateXmlPath { get; set; }
    }

    [ApiController]
    [Route("api/v1/commands")]
    [Route("api/commands")]
    [Route("api/client/commands")]
    public class CommandController : ControllerBase
    {
        private readonly IHubContext<CommandHub, ICommandClient> _hubContext;
        private readonly IHubContext<ProductionHub, IProductionClient> _productionHubContext;
        private readonly ILogger<CommandController> _logger;

        public CommandController(
            IHubContext<CommandHub, ICommandClient> hubContext,
            IHubContext<ProductionHub, IProductionClient> productionHubContext,
            ILogger<CommandController> logger)
        {
            _hubContext = hubContext;
            _productionHubContext = productionHubContext;
            _logger = logger;
        }

        [HttpPost("send")]
        public async Task<IActionResult> SendCommand([FromBody] SendCommandRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Command))
            {
                return BadRequest(new { error = "Command is required." });
            }

            var envelope = new CommandEnvelope
            {
                Command = req.Command,
                Data = req.Data
            };

            ICommandClient target;
            try
            {
                target = GetTargetClient(req.MacAddress, req.ChannelId, req.StationId, req.LineId, req.ChannelIds);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning("[CommandAPI] Command '{Command}' not dispatched: {Reason}", req.Command, ex.Message);
                return Conflict(new { error = ex.Message });
            }
            await target.ReceiveCommand(envelope);

            _logger.LogInformation("[CommandAPI] Command '{Command}' dispatched via SignalR. CommandId={CommandId}, ChannelIds={ChannelIds}",
                req.Command, envelope.CommandId, req.ChannelIds == null ? "(selector)" : string.Join(",", req.ChannelIds));
            return Ok(new { status = "success", command_id = envelope.CommandId, message = $"Command '{req.Command}' dispatched." });
        }

        [HttpGet("connections")]
        public IActionResult GetConnections()
        {
            return Ok(CommandHub.GetConnectedClients());
        }

        [HttpGet("status/{commandId}")]
        public IActionResult GetCommandStatus(string commandId)
        {
            var report = CommandHub.GetCommandReport(commandId);
            return report == null ? NotFound(new { error = "Client has not reported this command." }) : Ok(report);
        }

        [HttpPost("change-model")]
        public async Task<IActionResult> ChangeModel([FromBody] ChangeModelCommandRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.ModelName))
            {
                return BadRequest(new { error = "ModelName is required." });
            }

            var target = GetTargetClient(req.MacAddress, req.ChannelId, req.StationId, req.LineId);
            await target.ChangeModel(req.ModelName);

            _logger.LogInformation("[CommandAPI] ChangeModel '{ModelName}' dispatched via SignalR", req.ModelName);
            return Ok(new { status = "success", message = $"ChangeModel '{req.ModelName}' dispatched." });
        }

        [HttpPost("restart")]
        public async Task<IActionResult> RestartApp([FromBody] RestartCommandRequest req)
        {
            var target = GetTargetClient(req.MacAddress, req.ChannelId, req.StationId, req.LineId);
            await target.RestartApp(req.DelayMs);

            _logger.LogInformation("[CommandAPI] RestartApp dispatched via SignalR");
            return Ok(new { status = "success", message = "RestartApp dispatched." });
        }

        [HttpPost("update")]
        public async Task<IActionResult> UpdateApp([FromBody] UpdateAppCommandRequest req)
        {
            ICommandClient target;
            try
            {
                target = GetTargetClient(req.MacAddress, req.ChannelId, req.StationId, req.LineId, req.ChannelIds);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning("[CommandAPI] Update not dispatched: {Reason}", ex.Message);
                return Conflict(new { error = ex.Message });
            }
            var envelope = new CommandEnvelope
            {
                Command = "update",
                // Current Backup Log versions deserialize command data as a
                // Newtonsoft JObject while SignalR uses System.Text.Json.
                // Update does not consume this payload, so null keeps the
                // envelope compatible with already-deployed clients.
                Data = null
            };
            await target.ReceiveCommand(envelope);

            _logger.LogInformation("[CommandAPI] UpdateApp dispatched via SignalR (Force={Force}, UpdateXmlPath={UpdateXmlPath})",
                req.Force, req.UpdateXmlPath);
            return Ok(new { status = "success", command_id = envelope.CommandId, message = "UpdateApp dispatched." });
        }

        [HttpPost("status")]
        public async Task<IActionResult> ReceiveStatusReport([FromBody] CommandReport report)
        {
            _logger.LogInformation("[CommandAPI] Received command status for CommandId={CommandId}: Status={Status}", report.CommandId, report.Status);
            await _productionHubContext.Clients.All.ReceiveCommandStatus(report);
            return Ok(new { status = "acknowledged" });
        }

        private ICommandClient GetTargetClient(string? macAddress, int? channelId, int? stationId, int? lineId, List<int>? channelIds = null)
        {
            var validChannelIds = channelIds?.Where(id => id > 0).Distinct().ToList();
            if (validChannelIds?.Count > 0)
            {
                var connectionIds = CommandHub.GetConnectionIds(validChannelIds);
                if (connectionIds.Count == 0)
                {
                    throw new InvalidOperationException($"Không có Backup Log client nào đang kết nối CommandHub cho Channel: {string.Join(", ", validChannelIds)}");
                }
                return _hubContext.Clients.Clients(connectionIds);
            }

            if (!string.IsNullOrWhiteSpace(macAddress))
            {
                var macGroup = $"MAC_{macAddress.Replace(":", "").Replace("-", "").ToUpperInvariant()}";
                return _hubContext.Clients.Group(macGroup);
            }

            if (channelId.HasValue && channelId.Value > 0)
            {
                return _hubContext.Clients.Group($"Channel_{channelId.Value}");
            }

            if (stationId.HasValue && stationId.Value > 0)
            {
                return _hubContext.Clients.Group($"Station_{stationId.Value}");
            }

            if (lineId.HasValue && lineId.Value > 0)
            {
                return _hubContext.Clients.Group($"Line_{lineId.Value}");
            }

            return _hubContext.Clients.Group("AllCommandClients");
        }
    }
}
