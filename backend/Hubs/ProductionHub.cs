using Microsoft.AspNetCore.SignalR;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Hubs
{
    public interface IProductionClient
    {
        Task ReceivePcbResult(PcbResultDto result);
        Task ReceiveStatsUpdate(HourlyStatDto stat);
        Task ReceiveSystemAlert(string message, string level);
        Task ReceiveMachineStatusChanged(object status);
        Task ReceiveMachineAlert(object alert);
    }

    public class ProductionHub : Hub<IProductionClient>
    {
        private readonly ILogger<ProductionHub> _logger;

        public ProductionHub(ILogger<ProductionHub> logger)
        {
            _logger = logger;
        }

        public override async Task OnConnectedAsync()
        {
            _logger.LogInformation("SignalR Client connected: {ConnectionId}", Context.ConnectionId);
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            _logger.LogInformation("SignalR Client disconnected: {ConnectionId}", Context.ConnectionId);
            await base.OnDisconnectedAsync(exception);
        }

        public async Task SubscribeLine(int lineId)
        {
            var groupName = $"Line_{lineId}";
            await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
            _logger.LogInformation("Client {ConnectionId} joined group {GroupName}", Context.ConnectionId, groupName);
        }

        public async Task LeaveLine(int lineId)
        {
            var groupName = $"Line_{lineId}";
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, groupName);
        }

        public async Task SubscribeStation(int stationId)
        {
            var groupName = $"Station_{stationId}";
            await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
            _logger.LogInformation("Client {ConnectionId} joined group {GroupName}", Context.ConnectionId, groupName);
        }

        public async Task LeaveStation(int stationId)
        {
            var groupName = $"Station_{stationId}";
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, groupName);
        }
    }
}
