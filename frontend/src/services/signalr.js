import * as signalR from '@microsoft/signalr';

const HUB_URL = 'http://localhost:5000/hubs/production';

let connection = null;

export const initSignalR = (onPcbResultReceived, onStatsReceived, onStateChange) => {
  if (connection) return connection;

  connection = new signalR.HubConnectionBuilder()
    .withUrl(HUB_URL, {
      skipNegotiation: false,
      transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling,
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  connection.onreconnecting(() => {
    if (onStateChange) onStateChange(signalR.HubConnectionState.Reconnecting);
  });

  connection.onreconnected(() => {
    if (onStateChange) onStateChange(signalR.HubConnectionState.Connected);
  });

  connection.onclose(() => {
    if (onStateChange) onStateChange(signalR.HubConnectionState.Disconnected);
  });

  connection.on('ReceivePcbResult', (result) => {
    if (onPcbResultReceived) onPcbResultReceived(result);
  });

  connection.on('ReceiveStatsUpdate', (stat) => {
    if (onStatsReceived) onStatsReceived(stat);
  });

  connection
    .start()
    .then(() => {
      console.log('SignalR Hub Connected successfully.');
      if (onStateChange) onStateChange(signalR.HubConnectionState.Connected);
    })
    .catch((err) => {
      console.error('SignalR Connection Error:', err);
      if (onStateChange) onStateChange(signalR.HubConnectionState.Disconnected);
    });

  return connection;
};

export const subscribeLine = async (lineId) => {
  if (connection && connection.state === signalR.HubConnectionState.Connected) {
    await connection.invoke('SubscribeLine', lineId);
  }
};

export const subscribeStation = async (stationId) => {
  if (connection && connection.state === signalR.HubConnectionState.Connected) {
    await connection.invoke('SubscribeStation', stationId);
  }
};
