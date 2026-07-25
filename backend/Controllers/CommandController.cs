using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using PMSystem2.Api.Hubs;

namespace PMSystem2.Api.Controllers
{
    public class SendCommandRequest
    {
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

    [ApiController]
    [Route("api/v1/commands")]
    [Route("api/commands")]
    [Route("api/client/commands")]
    public class CommandController : ControllerBase
    {
        private readonly IHubContext<CommandHub, ICommandClient> _hubContext;
        private readonly ILogger<CommandController> _logger;

        public CommandController(IHubContext<CommandHub, ICommandClient> hubContext, ILogger<CommandController> logger)
        {
            _hubContext = hubContext;
            _logger = logger;
        }

        [HttpPost("send")]
        public async Task<IActionResult> SendCommand([FromBody] SendCommandRequest req)
        {
            var envelope = new CommandEnvelope
            {
                Command = req.Command,
                Data = req.Data
            };

            var target = GetTargetClient(req.MacAddress, req.ChannelId, req.StationId, req.LineId);
            await target.ReceiveCommand(envelope);

            _logger.LogInformation("[CommandAPI] Command '{Command}' dispatched via SignalR", req.Command);
            return Ok(new { status = "success", command_id = envelope.CommandId, message = $"Command '{req.Command}' dispatched." });
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

        [HttpPost("status")]
        public IActionResult ReceiveStatusReport([FromBody] CommandReport report)
        {
            _logger.LogInformation("[CommandAPI] Received command status for CommandId={CommandId}: Status={Status}", report.CommandId, report.Status);
            return Ok(new { status = "acknowledged" });
        }

        private ICommandClient GetTargetClient(string? macAddress, int? channelId, int? stationId, int? lineId)
        {
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
