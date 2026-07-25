using Microsoft.AspNetCore.SignalR;
using System.Text.Json.Serialization;

namespace PMSystem2.Api.Hubs
{
    public class CommandEnvelope
    {
        [JsonPropertyName("command_id")]
        public string CommandId { get; set; } = Guid.NewGuid().ToString("N");

        [JsonPropertyName("command")]
        public string Command { get; set; } = string.Empty;

        [JsonPropertyName("action")]
        public string? Action { get; set; }

        [JsonPropertyName("data")]
        public object? Data { get; set; }
    }

    public class CommandReport
    {
        [JsonPropertyName("command_id")]
        public string CommandId { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = "running"; // running, success, failed

        [JsonPropertyName("progress")]
        public int Progress { get; set; }

        [JsonPropertyName("result")]
        public object? Result { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("message")]
        public string? Message { get; set; }

        [JsonPropertyName("mac_address")]
        public string? MacAddress { get; set; }

        [JsonPropertyName("channel_id")]
        public int? ChannelId { get; set; }
    }

    public class MachineAlertDto
    {
        [JsonPropertyName("mac_address")]
        public string MacAddress { get; set; } = string.Empty;

        [JsonPropertyName("channel_id")]
        public int? ChannelId { get; set; }

        [JsonPropertyName("alert_type")]
        public string AlertType { get; set; } = string.Empty; // DiskFull, ScannerError, FctDisconnect, BackupFailed

        [JsonPropertyName("severity")]
        public string Severity { get; set; } = "Error"; // Info, Warning, Error, Critical

        [JsonPropertyName("message")]
        public string Message { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    }

    public class MachineTelemetryDto
    {
        [JsonPropertyName("mac_address")]
        public string MacAddress { get; set; } = string.Empty;

        [JsonPropertyName("channel_id")]
        public int? ChannelId { get; set; }

        [JsonPropertyName("current_model")]
        public string? CurrentModel { get; set; }

        [JsonPropertyName("app_version")]
        public string? AppVersion { get; set; }

        [JsonPropertyName("status")]
        public string Status { get; set; } = "Running";

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    }

    public interface ICommandClient
    {
        Task ReceiveCommand(CommandEnvelope command);
        Task ChangeModel(string modelName);
        Task RestartApp(int delayMs);
        Task ExecuteCommandAction(string action, object? data);
        Task NotifyMasterDataUpdated(string entityType);
    }

    public class CommandHub : Hub<ICommandClient>
    {
        private readonly IHubContext<ProductionHub, IProductionClient> _productionHubContext;
        private readonly ILogger<CommandHub> _logger;

        public CommandHub(IHubContext<ProductionHub, IProductionClient> productionHubContext, ILogger<CommandHub> logger)
        {
            _productionHubContext = productionHubContext;
            _logger = logger;
        }

        public override async Task OnConnectedAsync()
        {
            var httpContext = Context.GetHttpContext();
            var macAddress = httpContext?.Request.Query["mac_address"].ToString();
            var channelIdStr = httpContext?.Request.Query["channel_id"].ToString();
            var stationIdStr = httpContext?.Request.Query["station_id"].ToString();
            var lineIdStr = httpContext?.Request.Query["line_id"].ToString();

            _logger.LogInformation("[CommandHub] Client connected: ConnectionId={ConnectionId}, MAC={Mac}, ChannelId={ChannelId}",
                Context.ConnectionId, macAddress, channelIdStr);

            if (!string.IsNullOrWhiteSpace(macAddress))
            {
                var macGroup = $"MAC_{macAddress.Replace(":", "").Replace("-", "").ToUpperInvariant()}";
                await Groups.AddToGroupAsync(Context.ConnectionId, macGroup);
            }

            if (int.TryParse(channelIdStr, out int channelId) && channelId > 0)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"Channel_{channelId}");
            }

            if (int.TryParse(stationIdStr, out int stationId) && stationId > 0)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"Station_{stationId}");
            }

            if (int.TryParse(lineIdStr, out int lineId) && lineId > 0)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"Line_{lineId}");
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, "AllCommandClients");

            // Broadcast Machine Connected status to Web Dashboard via ProductionHub
            await _productionHubContext.Clients.All.ReceiveMachineStatusChanged(new
            {
                mac_address = macAddress,
                channel_id = channelIdStr,
                is_online = true,
                timestamp = DateTime.UtcNow
            });

            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var httpContext = Context.GetHttpContext();
            var macAddress = httpContext?.Request.Query["mac_address"].ToString();
            var channelIdStr = httpContext?.Request.Query["channel_id"].ToString();

            _logger.LogInformation("[CommandHub] Client disconnected: ConnectionId={ConnectionId}", Context.ConnectionId);

            // Broadcast Machine Disconnected status to Web Dashboard via ProductionHub
            await _productionHubContext.Clients.All.ReceiveMachineStatusChanged(new
            {
                mac_address = macAddress,
                channel_id = channelIdStr,
                is_online = false,
                timestamp = DateTime.UtcNow
            });

            await base.OnDisconnectedAsync(exception);
        }

        public async Task RegisterMachineGroup(string macAddress, int? channelId, int? lineId, int? stationId = null)
        {
            if (!string.IsNullOrWhiteSpace(macAddress))
            {
                var macGroup = $"MAC_{macAddress.Replace(":", "").Replace("-", "").ToUpperInvariant()}";
                await Groups.AddToGroupAsync(Context.ConnectionId, macGroup);
            }

            if (channelId.HasValue && channelId.Value > 0)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"Channel_{channelId.Value}");
            }

            if (stationId.HasValue && stationId.Value > 0)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"Station_{stationId.Value}");
            }

            if (lineId.HasValue && lineId.Value > 0)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"Line_{lineId.Value}");
            }

            _logger.LogInformation("[CommandHub] Machine registered groups for ConnectionId={ConnectionId}", Context.ConnectionId);
        }

        public Task ReportCommandStatus(CommandReport report)
        {
            _logger.LogInformation("[CommandHub] Status report received for Command={CommandId}: Status={Status}, Progress={Progress}%, Error={Error}",
                report.CommandId, report.Status, report.Progress, report.Error);
            return Task.CompletedTask;
        }

        public async Task SendMachineAlert(MachineAlertDto alert)
        {
            _logger.LogWarning("[CommandHub] Machine Alert received from MAC={Mac}: Type={Type}, Message={Message}",
                alert.MacAddress, alert.AlertType, alert.Message);

            // Forward Alert to Web Dashboard via ProductionHub
            await _productionHubContext.Clients.All.ReceiveMachineAlert(alert);
        }

        public async Task ReportMachineTelemetry(MachineTelemetryDto telemetry)
        {
            _logger.LogInformation("[CommandHub] Telemetry received from MAC={Mac}: Model={Model}, AppVersion={Version}",
                telemetry.MacAddress, telemetry.CurrentModel, telemetry.AppVersion);

            await _productionHubContext.Clients.All.ReceiveMachineStatusChanged(new
            {
                mac_address = telemetry.MacAddress,
                channel_id = telemetry.ChannelId,
                current_model = telemetry.CurrentModel,
                app_version = telemetry.AppVersion,
                status = telemetry.Status,
                is_online = true,
                timestamp = telemetry.Timestamp
            });
        }
    }
}
