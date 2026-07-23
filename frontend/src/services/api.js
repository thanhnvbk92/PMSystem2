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
  createLine: (data) => api.post('/master/lines', data).then(res => res.data),
  createStation: (data) => api.post('/master/stations', data).then(res => res.data),
  createChannel: (data) => api.post('/master/channels', data).then(res => res.data),
};

export const ProductionApi = {
  getSummary: () => api.get('/production/summary').then(res => res.data),
  getLatest: (limit = 50, lineId = null, stationId = null) => 
    api.get('/production/latest', { params: { limit, lineId, stationId } }).then(res => res.data),
  getHourlyStats: (hours = 24, lineId = null, stationId = null) => 
    api.get('/production/stats/hourly', { params: { hours, lineId, stationId } }).then(res => res.data),
  submitPcb: (data) => api.post('/production/submit', data).then(res => res.data),
};
