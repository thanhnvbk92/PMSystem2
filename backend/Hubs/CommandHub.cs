using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;
using System.Text.Json.Serialization;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Hubs
{
    public record CommandClientConnection(string ConnectionId, string? MacAddress, int? ChannelId, DateTime ConnectedAt);

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

        // Telemetry version 2+ (Backup_Log2 sending every minute with the real version and PC info).
        [JsonPropertyName("telemetry_version")] public int TelemetryVersion { get; set; }
        [JsonPropertyName("hostname")] public string? Hostname { get; set; }
        [JsonPropertyName("ip_address")] public string? IpAddress { get; set; }
        [JsonPropertyName("os_version")] public string? OsVersion { get; set; }
        [JsonPropertyName("cpu_percent")] public double? CpuPercent { get; set; }
        [JsonPropertyName("ram_total_mb")] public int? RamTotalMb { get; set; }
        [JsonPropertyName("ram_used_mb")] public int? RamUsedMb { get; set; }
        [JsonPropertyName("disk_drive")] public string? DiskDrive { get; set; }
        [JsonPropertyName("disk_total_gb")] public double? DiskTotalGb { get; set; }
        [JsonPropertyName("disk_free_gb")] public double? DiskFreeGb { get; set; }
        [JsonPropertyName("app_started_at")] public DateTime? AppStartedAt { get; set; }
        [JsonPropertyName("last_upload_at")] public DateTime? LastUploadAt { get; set; }
        [JsonPropertyName("log_type")] public string? LogType { get; set; }
        [JsonPropertyName("log_folders")] public string? LogFolders { get; set; }
    }

    public interface ICommandClient
    {
        Task ReceiveCommand(CommandEnvelope command);
        Task ChangeModel(string modelName);
        Task UpdateApp(bool force, string? updateXmlPath);
        Task RestartApp(int delayMs);
        Task ExecuteCommandAction(string action, object? data);
        Task NotifyMasterDataUpdated(string entityType);
    }

    public class CommandHub : Hub<ICommandClient>
    {
        private static readonly ConcurrentDictionary<string, CommandClientConnection> Connections = new();
        private static readonly ConcurrentDictionary<string, CommandReport> CommandReports = new();

        public static IReadOnlyList<CommandClientConnection> GetConnectedClients() => Connections.Values.ToList();
        public static CommandReport? GetCommandReport(string commandId) =>
            CommandReports.TryGetValue(commandId, out var report) ? report : null;

        public static List<string> GetConnectionIds(IEnumerable<int> channelIds)
        {
            var ids = channelIds.Where(id => id > 0).ToHashSet();
            return Connections.Values
                .Where(client => client.ChannelId.HasValue && ids.Contains(client.ChannelId.Value))
                .Select(client => client.ConnectionId)
                .Distinct()
                .ToList();
        }

        private readonly IHubContext<ProductionHub, IProductionClient> _productionHubContext;
        private readonly ILogger<CommandHub> _logger;
        private readonly MachineStatusService _machineStatus;

        public CommandHub(IHubContext<ProductionHub, IProductionClient> productionHubContext, ILogger<CommandHub> logger,
            MachineStatusService machineStatus)
        {
            _productionHubContext = productionHubContext;
            _logger = logger;
            _machineStatus = machineStatus;
        }

        /// <summary>Pushes the event to the web pages, with the saved PC state (PC monitoring) when there is one.</summary>
        private async Task BroadcastMachineAsync(object legacyPayload, MachineStatusDto? saved)
        {
            await _productionHubContext.Clients.All.ReceiveMachineStatusChanged(saved == null
                ? legacyPayload
                : new { legacy = legacyPayload, machine = saved });
        }

        private static bool HasOtherConnection(string? mac, string connectionId)
        {
            var key = MachineStatusService.MacKey(mac);
            return key != null && Connections.Values.Any(c => c.ConnectionId != connectionId && MachineStatusService.MacKey(c.MacAddress) == key);
        }

        public override async Task OnConnectedAsync()
        {
            var httpContext = Context.GetHttpContext();
            var macAddress = httpContext?.Request.Query["mac_address"].ToString();
            var channelIdStr = httpContext?.Request.Query["channel_id"].ToString();
            var stationIdStr = httpContext?.Request.Query["station_id"].ToString();
            var lineIdStr = httpContext?.Request.Query["line_id"].ToString();

            int? connectedChannelId = int.TryParse(channelIdStr, out var parsedChannelId) && parsedChannelId > 0
                ? parsedChannelId
                : null;
            Connections[Context.ConnectionId] = new CommandClientConnection(
                Context.ConnectionId,
                string.IsNullOrWhiteSpace(macAddress) ? null : macAddress,
                connectedChannelId,
                DateTime.UtcNow);

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
            var connected = await _machineStatus.MarkConnectedAsync(macAddress, connectedChannelId);
            await BroadcastMachineAsync(new
            {
                mac_address = macAddress,
                channel_id = channelIdStr,
                is_online = true,
                timestamp = DateTime.UtcNow
            }, connected);

            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            Connections.TryRemove(Context.ConnectionId, out _);
            var httpContext = Context.GetHttpContext();
            var macAddress = httpContext?.Request.Query["mac_address"].ToString();
            var channelIdStr = httpContext?.Request.Query["channel_id"].ToString();

            _logger.LogInformation("[CommandHub] Client disconnected: ConnectionId={ConnectionId}", Context.ConnectionId);

            // Broadcast Machine Disconnected status to Web Dashboard via ProductionHub
            var stillConnected = HasOtherConnection(macAddress, Context.ConnectionId);
            var disconnected = await _machineStatus.MarkDisconnectedAsync(macAddress, stillConnected);
            await BroadcastMachineAsync(new
            {
                mac_address = macAddress,
                channel_id = channelIdStr,
                is_online = stillConnected,
                timestamp = DateTime.UtcNow
            }, disconnected);

            await base.OnDisconnectedAsync(exception);
        }

        public async Task RegisterMachineGroup(string macAddress, int? channelId = null, int? lineId = null, int? stationId = null)
        {
            Connections[Context.ConnectionId] = new CommandClientConnection(
                Context.ConnectionId,
                string.IsNullOrWhiteSpace(macAddress) ? null : macAddress,
                channelId is > 0 ? channelId : null,
                DateTime.UtcNow);
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

        public async Task ReportCommandStatus(CommandReport report)
        {
            if (!string.IsNullOrWhiteSpace(report.CommandId))
            {
                CommandReports[report.CommandId] = report;
            }
            _logger.LogInformation("[CommandHub] Status report received for Command={CommandId}: Status={Status}, Progress={Progress}%, Error={Error}",
                report.CommandId, report.Status, report.Progress, report.Error);

            // Forward command status report to Web Dashboard via ProductionHub
            await _productionHubContext.Clients.All.ReceiveCommandStatus(report);
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

            var saved = await _machineStatus.SaveTelemetryAsync(new MachineTelemetryInput
            {
                MacAddress = telemetry.MacAddress,
                ChannelId = telemetry.ChannelId,
                CurrentModel = telemetry.CurrentModel,
                AppVersion = telemetry.AppVersion,
                Status = telemetry.Status,
                TelemetryVersion = telemetry.TelemetryVersion,
                Hostname = telemetry.Hostname,
                IpAddress = telemetry.IpAddress,
                OsVersion = telemetry.OsVersion,
                CpuPercent = telemetry.CpuPercent,
                RamTotalMb = telemetry.RamTotalMb,
                RamUsedMb = telemetry.RamUsedMb,
                DiskDrive = telemetry.DiskDrive,
                DiskTotalGb = telemetry.DiskTotalGb,
                DiskFreeGb = telemetry.DiskFreeGb,
                AppStartedAt = telemetry.AppStartedAt,
                LastUploadAt = telemetry.LastUploadAt,
                LogType = telemetry.LogType,
                LogFolders = telemetry.LogFolders
            });
            await BroadcastMachineAsync(new
            {
                mac_address = telemetry.MacAddress,
                channel_id = telemetry.ChannelId,
                current_model = telemetry.CurrentModel,
                app_version = telemetry.AppVersion,
                status = telemetry.Status,
                is_online = true,
                timestamp = telemetry.Timestamp
            }, saved);
        }
    }
}
