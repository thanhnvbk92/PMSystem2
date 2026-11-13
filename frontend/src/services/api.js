import axios from 'axios';

const API_HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const API_BASE_URL = `http://${API_HOST}:5000/api/v1`;

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const MasterDataApi = {
  getBuyers: () => api.get('/master/buyers').then(res => res.data),
  createBuyer: (data) => api.post('/master/buyers', data).then(res => res.data),
  updateBuyer: (id, data) => api.put(`/master/buyers/${id}`, data).then(res => res.data),
  deleteBuyer: (id) => api.delete(`/master/buyers/${id}`).then(res => res.data),

  getModelGroups: () => api.get('/master/model-groups').then(res => res.data),
  createModelGroup: (data) => api.post('/master/model-groups', data).then(res => res.data),
  updateModelGroup: (id, data) => api.put(`/master/model-groups/${id}`, data).then(res => res.data),
  deleteModelGroup: (id) => api.delete(`/master/model-groups/${id}`).then(res => res.data),

  getModels: () => api.get('/master/models').then(res => res.data),
  createModel: (data) => api.post('/master/models', data).then(res => res.data),
  updateModel: (id, data) => api.put(`/master/models/${id}`, data).then(res => res.data),
  deleteModel: (id) => api.delete(`/master/models/${id}`).then(res => res.data),
  getJobFileModelMappings: (params = {}) => api.get('/master/job-file-model-mappings', { params }).then(res => res.data),
  saveJobFileModelMapping: (data) => api.post('/master/job-file-model-mappings', data).then(res => res.data),
  bulkSaveJobFileModelMappings: (data) => api.post('/master/job-file-model-mappings/bulk', data).then(res => res.data),
  deleteJobFileModelMapping: (id) => api.delete(`/master/job-file-model-mappings/${id}`).then(res => res.data),

  getStationTypes: () => api.get('/master/station-types').then(res => res.data),
  createStationType: (data) => api.post('/master/station-types', data).then(res => res.data),
  updateStationType: (id, data) => api.put(`/master/station-types/${id}`, data).then(res => res.data),
  deleteStationType: (id) => api.delete(`/master/station-types/${id}`).then(res => res.data),

  getLines: () => api.get('/master/lines').then(res => res.data),
  createLine: (data) => api.post('/master/lines', data).then(res => res.data),
  updateLine: (id, data) => api.put(`/master/lines/${id}`, data).then(res => res.data),
  deleteLine: (id) => api.delete(`/master/lines/${id}`).then(res => res.data),

  getStations: () => api.get('/master/stations').then(res => res.data),
  createStation: (data) => api.post('/master/stations', data).then(res => res.data),
  updateStation: (id, data) => api.put(`/master/stations/${id}`, data).then(res => res.data),
  deleteStation: (id) => api.delete(`/master/stations/${id}`).then(res => res.data),

  getChannels: () => api.get('/master/channels').then(res => res.data),
  createChannel: (data) => api.post('/master/channels', data).then(res => res.data),
  updateChannel: (id, data) => api.put(`/master/channels/${id}`, data).then(res => res.data),
  deleteChannel: (id) => api.delete(`/master/channels/${id}`).then(res => res.data),
  mergeChannels: (sourceChannelId, targetChannelId) => api.post('/master/channels/merge', { sourceChannelId, targetChannelId }).then(res => res.data),

  getDeviceTypes: () => api.get('/master/device-types').then(res => res.data),
  createDeviceType: (data) => api.post('/master/device-types', data).then(res => res.data),
  updateDeviceType: (id, data) => api.put(`/master/device-types/${id}`, data).then(res => res.data),
  deleteDeviceType: (id) => api.delete(`/master/device-types/${id}`).then(res => res.data),

  getDevices: () => api.get('/master/devices').then(res => res.data),
  createDevice: (data) => api.post('/master/devices', data).then(res => res.data),
  updateDevice: (id, data) => api.put(`/master/devices/${id}`, data).then(res => res.data),
  deleteDevice: (id) => api.delete(`/master/devices/${id}`).then(res => res.data),
};

export const ProductionApi = {
  getCpkSteps: (channelId) => api.get('/production/cpk/steps', { params: { channelId } }).then(res => res.data),
  getStationCpkSteps: (stationId) => api.get('/production/cpk/station-steps', { params: { stationId } }).then(res => res.data),
  getCpk: (channelId, stepNumber, stepName, jobFile = null, limit = 50) => api.get('/production/cpk', { params: { channelId, stepNumber, stepName, jobFile, limit } }).then(res => res.data),
  getCpkOverview: () => api.get('/production/cpk/overview').then(res => res.data),
  getCpkReport: () => api.get('/production/cpk/report', { responseType: 'blob', timeout: 120000 }).then(res => res.data),
  getSummary: (lineId = null, stationId = null, startDate = null, endDate = null) => 
    api.get('/production/summary', { params: { lineId, stationId, startDate, endDate } }).then(res => res.data),
  getCounters: (lineId = null, stationId = null, startDate = null, endDate = null) =>
    api.get('/production/counters', { params: { lineId, stationId, startDate, endDate } }).then(res => res.data),
  getQualityModes: (lineId = null, stationId = null, startDate = null, endDate = null) =>
    api.get('/production/quality-modes', { params: { lineId, stationId, startDate, endDate } }).then(res => res.data),
  getLatest: (limit = 100, lineId = null, stationId = null, searchPid = null, searchFid = null, searchError = null, resultFilter = null, startDate = null, endDate = null, lineIds = null, stationIds = null, channelIds = null) =>
    api.get('/production/latest', { params: { limit, lineId, stationId, searchPid, searchFid, searchError, resultFilter, startDate, endDate, lineIds: lineIds?.join?.(','), stationIds: stationIds?.join?.(','), channelIds: channelIds?.join?.(',') } }).then(res => res.data),
  getHourlyStats: (hours = 24, lineId = null, stationId = null, startDate = null, endDate = null) => 
    api.get('/production/stats/hourly', { params: { hours, lineId, stationId, startDate, endDate } }).then(res => res.data),
  getLineYieldStats: (lineId = null, startDate = null, endDate = null) =>
    api.get('/production/stats/line-yield', { params: { lineId, startDate, endDate } }).then(res => res.data),
  getStationYieldStats: (lineId = null, startDate = null, endDate = null) =>
    api.get('/production/stats/station-yield', { params: { lineId, startDate, endDate } }).then(res => res.data),
  getDefectPareto: (lineId = null, stationId = null, startDate = null, endDate = null) =>
    api.get('/production/stats/defect-pareto', { params: { lineId, stationId, startDate, endDate } }).then(res => res.data),
  getBiMatrix: (lineId = null, stationId = null, channelId = null, modelId = null, errorCode = null, jobFile = null, startDate = null, endDate = null, hours = 24) =>
    api.get('/production/stats/bi-matrix', { params: { lineId, stationId, channelId, modelId, errorCode, jobFile, startDate, endDate, hours } }).then(res => res.data),
  submitPcb: (data) => api.post('/production/submit', data).then(res => res.data),
  getExportCount: (lineId = null, stationId = null, searchPid = null, searchFid = null, searchError = null, resultFilter = null, startDate = null, endDate = null, lineIds = null, stationIds = null, channelIds = null) =>
    api.get('/production/export-count', { params: { lineId, stationId, searchPid, searchFid, searchError, resultFilter, startDate, endDate, lineIds: lineIds?.join?.(','), stationIds: stationIds?.join?.(','), channelIds: channelIds?.join?.(',') } }).then(res => res.data),
  getExportCsvUrl: (limit = null, lineId = null, stationId = null, searchPid = null, searchFid = null, searchError = null, resultFilter = null, startDate = null, endDate = null) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    if (lineId) params.append('lineId', lineId);
    if (stationId) params.append('stationId', stationId);
    if (searchPid) params.append('searchPid', searchPid);
    if (searchFid) params.append('searchFid', searchFid);
    if (searchError) params.append('searchError', searchError);
    if (resultFilter) params.append('resultFilter', resultFilter);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    return `${API_BASE_URL}/production/export-csv?${params.toString()}`;
  },
  downloadExportCsv: (limit = null, lineId = null, stationId = null, searchPid = null, searchFid = null, searchError = null, resultFilter = null, startDate = null, endDate = null, lineIds = null, stationIds = null, channelIds = null) => {
    const params = {};
    if (limit) params.limit = limit;
    if (lineId) params.lineId = lineId;
    if (stationId) params.stationId = stationId;
    if (searchPid) params.searchPid = searchPid;
    if (searchFid) params.searchFid = searchFid;
    if (searchError) params.searchError = searchError;
    if (resultFilter) params.resultFilter = resultFilter;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (lineIds?.length) params.lineIds = lineIds.join(',');
    if (stationIds?.length) params.stationIds = stationIds.join(',');
    if (channelIds?.length) params.channelIds = channelIds.join(',');

    return api.get('/production/export-csv', {
      params,
      responseType: 'blob'
    }).then(res => {
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.setAttribute('download', `PMSystem_Production_Report_${timestamp}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  },
};

export const CommandApi = {
  sendCommand: (data) => api.post('/commands/send', data).then(res => res.data),
  changeModel: (data) => api.post('/commands/change-model', data).then(res => res.data),
  restartApp: (data) => api.post('/commands/restart', data).then(res => res.data),
  updateApp: async (data) => {
    try {
      return (await api.post('/commands/update', data)).data;
    } catch (error) {
      // Rolling-upgrade fallback: older API versions do not expose /commands/update yet.
      if (error.response?.status !== 404) throw error;
      return (await api.post('/commands/send', {
        channelIds: data.channelIds,
        macAddress: data.macAddress,
        channelId: data.channelId,
        stationId: data.stationId,
        lineId: data.lineId,
        command: 'update',
        data: {
          force: data.force,
          update_xml_path: data.updateXmlPath || null,
        },
      })).data;
    }
  },
};

export const ImprovementApi = {
  getTopDefects: (startDate, endDate, limit = 5) => api.get('/improvements/top-defects', { params: { startDate, endDate, limit } }).then(res => res.data),
  list: (status = null) => api.get('/improvements', { params: { status } }).then(res => res.data),
  get: (id) => api.get(`/improvements/${id}`).then(res => res.data),
  getTrend: (id, startDate, endDate, granularity = 'day') => api.get(`/improvements/${id}/trend`, { params: { startDate, endDate, granularity } }).then(res => res.data),
  create: (data) => api.post('/improvements', data).then(res => res.data),
  update: (id, data) => api.put(`/improvements/${id}`, data).then(res => res.data),
  delete: (id) => api.delete(`/improvements/${id}`),
  updateRootCause: (id, rootCause) => api.patch(`/improvements/${id}/root-cause`, { rootCause }).then(res => res.data),
  addAction: (id, data) => api.post(`/improvements/${id}/actions`, data).then(res => res.data),
  updateAction: (id, data) => api.put(`/improvements/actions/${id}`, data).then(res => res.data),
  uploadActionImage: (file) => { const form = new FormData(); form.append('file', file); return api.post('/improvements/actions/images', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(res => res.data); },
  deleteAction: (id) => api.delete(`/improvements/actions/${id}`),
};

export const InvalidPcbResultsApi = {
  list: (params = {}) => api.get('/invalid-pcb-results', { params }).then(res => res.data),
  resolve: (id, note = '') => api.patch(`/invalid-pcb-results/${id}/resolve`, { note }),
};

// PC monitoring: state of every Backup_Log2 PC and the standard Backup_Log2 version.
export const MachinesApi = {
  getAll: () => api.get('/machines').then(res => res.data),
  setStandardVersion: (version) => api.put('/machines/standard-version', { version }).then(res => res.data),
  remove: (mac) => api.delete(`/machines/${encodeURIComponent(mac)}`).then(res => res.data),
};
