import * as signalR from '@microsoft/signalr';

const SIGNALR_HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const HUB_URL = `http://${SIGNALR_HOST}:5000/hubs/production`;

let connection = null;
let retryTimer = null;
let startPromise = null;
const callbacks = { pcb: null, stats: null, delta: null, state: null, sync: null };

const listeners = {
  ReceiveCommandStatus: new Set(),
  ReceiveMachineStatusChanged: new Set(),
  ReceiveMachineAlert: new Set(),
  ReceiveCpkUpdate: new Set(),
};

// Automatic CPK rows that changed in the last backend engine flush.
export const onCpkUpdate = (callback) => {
  listeners.ReceiveCpkUpdate.add(callback);
  return () => listeners.ReceiveCpkUpdate.delete(callback);
};

export const onCommandStatus = (callback) => {
  listeners.ReceiveCommandStatus.add(callback);
  return () => listeners.ReceiveCommandStatus.delete(callback);
};

export const onMachineStatusChanged = (callback) => {
  listeners.ReceiveMachineStatusChanged.add(callback);
  return () => listeners.ReceiveMachineStatusChanged.delete(callback);
};

export const onMachineAlert = (callback) => {
  listeners.ReceiveMachineAlert.add(callback);
  return () => listeners.ReceiveMachineAlert.delete(callback);
};

const scheduleStart = () => {
  if (retryTimer) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    startConnection();
  }, 3000);
};

const startConnection = () => {
  if (!connection || connection.state !== signalR.HubConnectionState.Disconnected || startPromise) return startPromise;
  callbacks.state?.(signalR.HubConnectionState.Connecting);
  startPromise = connection.start()
    .then(() => {
      console.log('SignalR Hub Connected successfully.');
      callbacks.state?.(signalR.HubConnectionState.Connected);
      // Always synchronize once after the connection is established. This
      // closes the race where API loading and initial SignalR events overlap.
      callbacks.sync?.();
    })
    .catch((err) => {
      console.error('SignalR Connection Error:', err);
      callbacks.state?.(signalR.HubConnectionState.Disconnected);
      scheduleStart();
    })
    .finally(() => { startPromise = null; });
  return startPromise;
};

export const initSignalR = (onPcbResultReceived, onStatsReceived, onStateChange, onProductionDelta, onReconnectSync) => {
  callbacks.pcb = onPcbResultReceived;
  callbacks.stats = onStatsReceived;
  callbacks.state = onStateChange;
  callbacks.delta = onProductionDelta;
  callbacks.sync = onReconnectSync;
  if (connection) {
    startConnection();
    return connection;
  }

  connection = new signalR.HubConnectionBuilder()
    .withUrl(HUB_URL, {
      skipNegotiation: false,
      transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling,
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  connection.onreconnecting(() => {
    callbacks.state?.(signalR.HubConnectionState.Reconnecting);
  });

  connection.onreconnected(() => {
    callbacks.state?.(signalR.HubConnectionState.Connected);
    callbacks.sync?.();
  });

  connection.onclose(() => {
    callbacks.state?.(signalR.HubConnectionState.Disconnected);
    scheduleStart();
  });

  connection.on('ReceivePcbResult', (result) => {
    callbacks.pcb?.(result);
  });

  connection.on('ReceiveStatsUpdate', (stat) => {
    callbacks.stats?.(stat);
  });

  connection.on('ReceiveProductionDelta', (delta) => callbacks.delta?.(delta));

  connection.on('ReceiveCommandStatus', (report) => {
    listeners.ReceiveCommandStatus.forEach((cb) => cb(report));
  });

  connection.on('ReceiveMachineStatusChanged', (status) => {
    listeners.ReceiveMachineStatusChanged.forEach((cb) => cb(status));
  });

  connection.on('ReceiveMachineAlert', (alert) => {
    listeners.ReceiveMachineAlert.forEach((cb) => cb(alert));
  });

  connection.on('ReceiveCpkUpdate', (items) => {
    listeners.ReceiveCpkUpdate.forEach((cb) => cb(items));
  });

  startConnection();

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
