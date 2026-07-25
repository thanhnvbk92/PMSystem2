import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const MasterDataApi = {
  getBuyers: () => api.get('/master/buyers').then(res => res.data),
  getLines: () => api.get('/master/lines').then(res => res.data),
  getStations: () => api.get('/master/stations').then(res => res.data),
  getChannels: () => api.get('/master/channels').then(res => res.data),
  
  createBuyer: (data) => api.post('/master/buyers', data).then(res => res.data),
  updateBuyer: (id, data) => api.put(`/master/buyers/${id}`, data).then(res => res.data),
  deleteBuyer: (id) => api.delete(`/master/buyers/${id}`).then(res => res.data),

  createLine: (data) => api.post('/master/lines', data).then(res => res.data),
  updateLine: (id, data) => api.put(`/master/lines/${id}`, data).then(res => res.data),
  deleteLine: (id) => api.delete(`/master/lines/${id}`).then(res => res.data),

  createStation: (data) => api.post('/master/stations', data).then(res => res.data),
  updateStation: (id, data) => api.put(`/master/stations/${id}`, data).then(res => res.data),
  deleteStation: (id) => api.delete(`/master/stations/${id}`).then(res => res.data),

  createChannel: (data) => api.post('/master/channels', data).then(res => res.data),
  updateChannel: (id, data) => api.put(`/master/channels/${id}`, data).then(res => res.data),
  deleteChannel: (id) => api.delete(`/master/channels/${id}`).then(res => res.data),
  mergeChannels: (sourceChannelId, targetChannelId) => api.post('/master/channels/merge', { sourceChannelId, targetChannelId }).then(res => res.data),
};

export const ProductionApi = {
  getSummary: () => api.get('/production/summary').then(res => res.data),
  getLatest: (limit = 100, lineId = null, stationId = null, searchPid = null, resultFilter = null) => 
    api.get('/production/latest', { params: { limit, lineId, stationId, searchPid, resultFilter } }).then(res => res.data),
  getHourlyStats: (hours = 24, lineId = null, stationId = null) => 
    api.get('/production/stats/hourly', { params: { hours, lineId, stationId } }).then(res => res.data),
  getLineYieldStats: (lineId = null) =>
    api.get('/production/stats/line-yield', { params: { lineId } }).then(res => res.data),
  getStationYieldStats: (lineId = null) =>
    api.get('/production/stats/station-yield', { params: { lineId } }).then(res => res.data),
  getDefectPareto: (lineId = null, stationId = null) =>
    api.get('/production/stats/defect-pareto', { params: { lineId, stationId } }).then(res => res.data),
  submitPcb: (data) => api.post('/production/submit', data).then(res => res.data),
};

