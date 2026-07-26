import React, { useState, useEffect, useMemo } from 'react';
import {
  Database, Plus, RefreshCw, Layers, Cpu, Radio, Building2, Pencil, Trash2, X, Search, Filter,
  AlertTriangle, GitMerge, Box, Tag, Sliders, HardDrive, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import { MasterDataApi } from '../services/api';

// --- Custom Hook for Multi-column Sort & Filtering ---
function useTableSortAndFilter(data, initialSortKey = 'id', initialSortDir = 'asc') {
  const [sortKey, setSortKey] = useState(initialSortKey);
  const [sortDir, setSortDir] = useState(initialSortDir);
  const [columnFilters, setColumnFilters] = useState({});
  const [globalSearch, setGlobalSearch] = useState('');

  const handleSort = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else if (sortDir === 'desc') {
        setSortKey(null);
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const setColumnFilter = (key, value) => {
    setColumnFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const clearAllFilters = () => {
    setColumnFilters({});
    setGlobalSearch('');
    setSortKey(initialSortKey);
    setSortDir(initialSortDir);
  };

  const processedData = useMemo(() => {
    let result = [...(data || [])];

    // Global Search Across All Values
    if (globalSearch.trim()) {
      const q = globalSearch.toLowerCase().trim();
      result = result.filter(item =>
        Object.values(item).some(val =>
          val !== null && val !== undefined && String(val).toLowerCase().includes(q)
        )
      );
    }

    // Column Level Specific Filters
    Object.entries(columnFilters).forEach(([colKey, filterVal]) => {
      if (filterVal && String(filterVal).trim() !== '') {
        const fq = String(filterVal).toLowerCase().trim();
        result = result.filter(item => {
          const val = item[colKey];
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(fq);
        });
      }
    });

    // Sorting Logic
    if (sortKey) {
      result.sort((a, b) => {
        let valA = a[sortKey];
        let valB = b[sortKey];

        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDir === 'asc' ? valA - valB : valB - valA;
        }

        const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [data, sortKey, sortDir, columnFilters, globalSearch]);

  const activeFilterCount = Object.values(columnFilters).filter(v => v && String(v).trim() !== '').length + (globalSearch.trim() ? 1 : 0);

  return {
    sortKey,
    sortDir,
    handleSort,
    columnFilters,
    setColumnFilter,
    globalSearch,
    setGlobalSearch,
    clearAllFilters,
    activeFilterCount,
    processedData
  };
}

// --- Header Sort Button Component ---
function ThSort({ label, colKey, tableState, className = '' }) {
  const isSorted = tableState.sortKey === colKey;
  return (
    <th
      onClick={() => tableState.handleSort(colKey)}
      className={`p-3 cursor-pointer hover:bg-slate-800/80 hover:text-white select-none transition-colors ${className}`}
      title={`Click để sắp xếp theo ${label}`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span>{label}</span>
        {isSorted ? (
          tableState.sortDir === 'asc' ? (
            <ArrowUp className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 text-slate-600 shrink-0 opacity-40 hover:opacity-100" />
        )}
      </div>
    </th>
  );
}

// --- Table Filter Toolbar Component ---
function TableToolbar({ tableState, totalCount, title }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-white/10 mb-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder={`Tìm kiếm ${title}...`}
          value={tableState.globalSearch}
          onChange={e => tableState.setGlobalSearch(e.target.value)}
          className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
        />
        {tableState.globalSearch && (
          <button onClick={() => tableState.setGlobalSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400 font-mono">
          Hiển thị: <strong className="text-blue-400">{tableState.processedData.length}</strong> / {totalCount}
        </span>
        {tableState.activeFilterCount > 0 && (
          <button
            onClick={tableState.clearAllFilters}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all shadow-sm"
          >
            <X className="w-3 h-3" />
            <span>Xóa lọc ({tableState.activeFilterCount})</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function MasterData({
  buyers = [],
  modelGroups = [],
  models = [],
  stationTypes = [],
  lines = [],
  stations = [],
  channels = [],
  deviceTypes = [],
  devices = [],
  onRefresh
}) {
  const [activeSubTab, setActiveSubTab] = useState('lines');

  // Synced local state for instant optimistic UI feedback
  const [localBuyers, setLocalBuyers] = useState(buyers);
  const [localModelGroups, setLocalModelGroups] = useState(modelGroups);
  const [localModels, setLocalModels] = useState(models);
  const [localStationTypes, setLocalStationTypes] = useState(stationTypes);
  const [localLines, setLocalLines] = useState(lines);
  const [localStations, setLocalStations] = useState(stations);
  const [localChannels, setLocalChannels] = useState(channels);
  const [localDeviceTypes, setLocalDeviceTypes] = useState(deviceTypes);
  const [localDevices, setLocalDevices] = useState(devices);

  const sortLinesAsc = (lineList) => {
    return [...(lineList || [])].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
    );
  };

  useEffect(() => { setLocalBuyers(buyers); }, [buyers]);
  useEffect(() => { setLocalModelGroups(modelGroups); }, [modelGroups]);
  useEffect(() => { setLocalModels(models); }, [models]);
  useEffect(() => { setLocalStationTypes(stationTypes); }, [stationTypes]);
  useEffect(() => { setLocalLines(sortLinesAsc(lines)); }, [lines]);
  useEffect(() => { setLocalStations(stations); }, [stations]);
  useEffect(() => { setLocalChannels(channels); }, [channels]);
  useEffect(() => { setLocalDeviceTypes(deviceTypes); }, [deviceTypes]);
  useEffect(() => { setLocalDevices(devices); }, [devices]);

  // Table State Hooks for Sorting & Filtering
  const linesTable = useTableSortAndFilter(localLines, 'name', 'asc');
  const stationsTable = useTableSortAndFilter(localStations, 'id', 'asc');
  const channelsTable = useTableSortAndFilter(localChannels, 'id', 'asc');
  const modelGroupsTable = useTableSortAndFilter(localModelGroups, 'id', 'asc');
  const modelsTable = useTableSortAndFilter(localModels, 'id', 'asc');
  const stationTypesTable = useTableSortAndFilter(localStationTypes, 'id', 'asc');
  const deviceTypesTable = useTableSortAndFilter(localDeviceTypes, 'id', 'asc');
  const devicesTable = useTableSortAndFilter(localDevices, 'id', 'asc');
  const buyersTable = useTableSortAndFilter(localBuyers, 'id', 'asc');

  // Create Forms State
  const [buyerForm, setBuyerForm] = useState({ name: '', remark: '' });
  const [modelGroupForm, setModelGroupForm] = useState({ buyerId: '', name: '', remark: '' });
  const [modelForm, setModelForm] = useState({ modelGroupId: '', name: '', remark: '' });
  const [stationTypeForm, setStationTypeForm] = useState({ name: '', remark: '' });
  const [lineForm, setLineForm] = useState({ name: '', remark: '' });
  const [stationForm, setStationForm] = useState({ lineId: '', modelGroupId: '', stationTypeId: '', name: '', remark: '' });
  const [channelForm, setChannelForm] = useState({ lineId: '', stationId: '', name: '', machinePartNo: '', gmesName: '', ipAddress: '', macAddress: '' });
  const [deviceTypeForm, setDeviceTypeForm] = useState({ name: '', remark: '' });
  const [deviceForm, setDeviceForm] = useState({ channelId: '', deviceTypeId: '', name: '', modelPartNo: '', serialNumber: '', status: 'online', remark: '' });

  // Edit Modal State
  const [editModal, setEditModal] = useState(null);
  const [loading, setLoading] = useState(false);

  // --- HANDLERS ---
  const handleAction = async (actionFn) => {
    setLoading(true);
    try {
      await actionFn();
      setEditModal(null);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  // BUYER
  const handleCreateBuyer = (e) => { e.preventDefault(); if (!buyerForm.name) return; handleAction(async () => { await MasterDataApi.createBuyer(buyerForm); setBuyerForm({ name: '', remark: '' }); }); };
  const handleUpdateBuyer = (id, data) => handleAction(async () => { await MasterDataApi.updateBuyer(id, data); });
  const handleDeleteBuyer = (id, name) => { if (window.confirm(`Xóa Buyer "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteBuyer(id); }); };

  // MODEL GROUP
  const handleCreateModelGroup = (e) => { e.preventDefault(); if (!modelGroupForm.name) return; handleAction(async () => { await MasterDataApi.createModelGroup({ ...modelGroupForm, buyerId: modelGroupForm.buyerId ? parseInt(modelGroupForm.buyerId) : null }); setModelGroupForm({ buyerId: '', name: '', remark: '' }); }); };
  const handleUpdateModelGroup = (id, data) => handleAction(async () => { await MasterDataApi.updateModelGroup(id, { ...data, buyerId: data.buyerId ? parseInt(data.buyerId) : null }); });
  const handleDeleteModelGroup = (id, name) => { if (window.confirm(`Xóa Model Group "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteModelGroup(id); }); };

  // MODEL ITEM
  const handleCreateModel = (e) => { e.preventDefault(); if (!modelForm.name) return; handleAction(async () => { await MasterDataApi.createModel({ ...modelForm, modelGroupId: modelForm.modelGroupId ? parseInt(modelForm.modelGroupId) : null }); setModelForm({ modelGroupId: '', name: '', remark: '' }); }); };
  const handleUpdateModel = (id, data) => handleAction(async () => { await MasterDataApi.updateModel(id, { ...data, modelGroupId: data.modelGroupId ? parseInt(data.modelGroupId) : null }); });
  const handleDeleteModel = (id, name) => { if (window.confirm(`Xóa Model "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteModel(id); }); };

  // STATION TYPE
  const handleCreateStationType = (e) => { e.preventDefault(); if (!stationTypeForm.name) return; handleAction(async () => { await MasterDataApi.createStationType(stationTypeForm); setStationTypeForm({ name: '', remark: '' }); }); };
  const handleUpdateStationType = (id, data) => handleAction(async () => { await MasterDataApi.updateStationType(id, data); });
  const handleDeleteStationType = (id, name) => { if (window.confirm(`Xóa Loại Trạm "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteStationType(id); }); };

  // LINE
  const handleCreateLine = (e) => { e.preventDefault(); if (!lineForm.name) return; handleAction(async () => { await MasterDataApi.createLine(lineForm); setLineForm({ name: '', remark: '' }); }); };
  const handleUpdateLine = (id, data) => handleAction(async () => { await MasterDataApi.updateLine(id, data); });
  const handleDeleteLine = (id, name) => { if (window.confirm(`Xóa Line "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteLine(id); }); };

  // STATION
  const handleCreateStation = (e) => { e.preventDefault(); if (!stationForm.name || !stationForm.lineId) return; handleAction(async () => { await MasterDataApi.createStation({ lineId: parseInt(stationForm.lineId), modelGroupId: stationForm.modelGroupId ? parseInt(stationForm.modelGroupId) : null, stationTypeId: stationForm.stationTypeId ? parseInt(stationForm.stationTypeId) : null, name: stationForm.name, remark: stationForm.remark }); setStationForm({ lineId: '', modelGroupId: '', stationTypeId: '', name: '', remark: '' }); }); };
  const handleUpdateStation = (id, data) => handleAction(async () => { await MasterDataApi.updateStation(id, { lineId: parseInt(data.lineId), modelGroupId: data.modelGroupId ? parseInt(data.modelGroupId) : null, stationTypeId: data.stationTypeId ? parseInt(data.stationTypeId) : null, name: data.name, remark: data.remark }); });
  const handleDeleteStation = (id, name) => { if (window.confirm(`Xóa Station "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteStation(id); }); };

  // CHANNEL
  const handleCreateChannel = (e) => { e.preventDefault(); if (!channelForm.name || !channelForm.stationId) return; handleAction(async () => { await MasterDataApi.createChannel({ stationId: parseInt(channelForm.stationId), name: channelForm.name, machinePartNo: channelForm.machinePartNo, gmesName: channelForm.gmesName, ipAddress: channelForm.ipAddress, macAddress: channelForm.macAddress }); setChannelForm({ lineId: '', stationId: '', name: '', machinePartNo: '', gmesName: '', ipAddress: '', macAddress: '' }); }); };
  const handleUpdateChannel = (id, data) => handleAction(async () => { await MasterDataApi.updateChannel(id, { stationId: parseInt(data.stationId), name: data.name, machinePartNo: data.machinePartNo, gmesName: data.gmesName, ipAddress: data.ipAddress, macAddress: data.macAddress, status: data.status }); });
  const handleDeleteChannel = (id, name) => { if (window.confirm(`Xóa Channel "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteChannel(id); }); };

  // DEVICE TYPE
  const handleCreateDeviceType = (e) => { e.preventDefault(); if (!deviceTypeForm.name) return; handleAction(async () => { await MasterDataApi.createDeviceType(deviceTypeForm); setDeviceTypeForm({ name: '', remark: '' }); }); };
  const handleUpdateDeviceType = (id, data) => handleAction(async () => { await MasterDataApi.updateDeviceType(id, data); });
  const handleDeleteDeviceType = (id, name) => { if (window.confirm(`Xóa Device Type "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteDeviceType(id); }); };

  // DEVICE
  const handleCreateDevice = (e) => { e.preventDefault(); if (!deviceForm.name || !deviceForm.channelId) return; handleAction(async () => { await MasterDataApi.createDevice({ ...deviceForm, channelId: parseInt(deviceForm.channelId), deviceTypeId: deviceForm.deviceTypeId ? parseInt(deviceForm.deviceTypeId) : null }); setDeviceForm({ channelId: '', deviceTypeId: '', name: '', modelPartNo: '', serialNumber: '', status: 'online', remark: '' }); }); };
  const handleUpdateDevice = (id, data) => handleAction(async () => { await MasterDataApi.updateDevice(id, { ...data, channelId: parseInt(data.channelId), deviceTypeId: deviceForm.deviceTypeId ? parseInt(deviceForm.deviceTypeId) : null }); });
  const handleDeleteDevice = (id, name) => { if (window.confirm(`Xóa Device "${name}"?`)) handleAction(async () => { await MasterDataApi.deleteDevice(id); }); };

  const handleMergeChannels = async (sourceChannel, targetChannel) => {
    const confirmMsg = `XÁC NHẬN GỘP CHANNEL:\n\n` +
      `• Channel NGUỒN: #${sourceChannel.id} - ${sourceChannel.name}\n` +
      `• Channel ĐÍCH: #${targetChannel.id} - ${targetChannel.name}\n\n` +
      `Lịch sử dữ liệu sẽ gộp về Channel #${targetChannel.id} và xóa Channel NGUỒN.`;
    if (!window.confirm(confirmMsg)) return;
    handleAction(async () => { await MasterDataApi.mergeChannels(sourceChannel.id, targetChannel.id); });
  };

  const ipConflicts = useMemo(() => {
    const ipMap = {};
    localChannels.forEach(c => {
      const ip = (c.ipAddress || '').trim();
      if (ip && ip !== '127.0.0.1') {
        if (!ipMap[ip]) ipMap[ip] = [];
        ipMap[ip].push(c);
      }
    });
    return Object.entries(ipMap).filter(([ip, list]) => list.length > 1).map(([ip, list]) => ({ ip, channels: list }));
  }, [localChannels]);

  return (
    <div className="space-y-6">
      {/* Sub Tabs Bar */}
      <div className="flex border-b border-white/10 space-x-1 overflow-x-auto pb-1">
        {[
          { id: 'lines', label: 'Production Lines', icon: Layers, count: localLines.length },
          { id: 'stations', label: 'Stations', icon: Cpu, count: localStations.length },
          { id: 'channels', label: 'Channels', icon: Radio, count: localChannels.length, conflict: ipConflicts.length },
          { id: 'model-groups', label: 'Model Groups', icon: Box, count: localModelGroups.length },
          { id: 'models', label: 'Models', icon: Tag, count: localModels.length },
          { id: 'station-types', label: 'Station Types', icon: Sliders, count: localStationTypes.length },
          { id: 'device-types', label: 'Device Types', icon: HardDrive, count: localDeviceTypes.length },
          { id: 'devices', label: 'Devices', icon: Cpu, count: localDevices.length },
          { id: 'buyers', label: 'Buyers', icon: Building2, count: localBuyers.length },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 whitespace-nowrap ${
                isActive
                  ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${isActive ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-800 text-slate-400'}`}>
                {tab.count}
              </span>
              {tab.conflict > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold animate-pulse flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {tab.conflict} Xung đột IP
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 1. LINES */}
      {activeSubTab === 'lines' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Thêm Line Sản Xuất
            </h3>
            <form onSubmit={handleCreateLine} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Line</label>
                <input type="text" required placeholder="e.g. Line 01 SMT" value={lineForm.name} onChange={e => setLineForm({ ...lineForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Ghi chú (Remark)</label>
                <input type="text" placeholder="Ghi chú thêm" value={lineForm.remark} onChange={e => setLineForm({ ...lineForm, remark: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                {loading ? 'Đang xử lý...' : 'Tạo Line'}
              </button>
            </form>
          </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={linesTable} totalCount={localLines.length} title="Production Line" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={linesTable} className="w-24" />
                    <ThSort label="Tên Line" colKey="name" tableState={linesTable} />
                    <ThSort label="Remark" colKey="remark" tableState={linesTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc ID..." value={linesTable.columnFilters.id || ''} onChange={e => linesTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc Tên Line..." value={linesTable.columnFilters.name || ''} onChange={e => linesTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc Remark..." value={linesTable.columnFilters.remark || ''} onChange={e => linesTable.setColumnFilter('remark', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {linesTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Line sản xuất phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    linesTable.processedData.map(l => (
                      <tr key={l.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{l.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{l.name}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{l.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'line', item: { ...l } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteLine(l.id, l.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. STATIONS */}
      {activeSubTab === 'stations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Thêm Trạm Kiểm Tra (Station)
            </h3>
            <form onSubmit={handleCreateStation} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Chọn Line *</label>
                <select required value={stationForm.lineId} onChange={e => setStationForm({ ...stationForm, lineId: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                  <option value="">-- Chọn Line --</option>
                  {localLines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Station *</label>
                <input type="text" required placeholder="e.g. SPI Inspection #1" value={stationForm.name} onChange={e => setStationForm({ ...stationForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Model Group</label>
                <select value={stationForm.modelGroupId} onChange={e => setStationForm({ ...stationForm, modelGroupId: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                  <option value="">-- Tùy chọn Model Group --</option>
                  {localModelGroups.map(mg => <option key={mg.id} value={mg.id}>{mg.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Station Type</label>
                <select value={stationForm.stationTypeId} onChange={e => setStationForm({ ...stationForm, stationTypeId: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                  <option value="">-- Tùy chọn Loại Trạm --</option>
                  {localStationTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input type="text" placeholder="Ghi chú" value={stationForm.remark} onChange={e => setStationForm({ ...stationForm, remark: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                {loading ? 'Đang xử lý...' : 'Tạo Station'}
              </button>
            </form>
          </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={stationsTable} totalCount={localStations.length} title="Station" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={stationsTable} className="w-20" />
                    <ThSort label="Station Name" colKey="name" tableState={stationsTable} />
                    <ThSort label="Line" colKey="lineName" tableState={stationsTable} />
                    <ThSort label="Model Group" colKey="modelGroupName" tableState={stationsTable} />
                    <ThSort label="Type" colKey="stationTypeName" tableState={stationsTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="ID..." value={stationsTable.columnFilters.id || ''} onChange={e => stationsTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Tên Station..." value={stationsTable.columnFilters.name || ''} onChange={e => stationsTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <select value={stationsTable.columnFilters.lineName || ''} onChange={e => stationsTable.setColumnFilter('lineName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Line</option>
                        {localLines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <select value={stationsTable.columnFilters.modelGroupName || ''} onChange={e => stationsTable.setColumnFilter('modelGroupName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Group</option>
                        {localModelGroups.map(mg => <option key={mg.id} value={mg.name}>{mg.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <select value={stationsTable.columnFilters.stationTypeName || ''} onChange={e => stationsTable.setColumnFilter('stationTypeName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Type</option>
                        {localStationTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {stationsTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Station phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    stationsTable.processedData.map(s => (
                      <tr key={s.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{s.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{s.name}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{s.lineName}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{s.modelGroupName || '—'}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{s.stationTypeName || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'station', item: { ...s } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteStation(s.id, s.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. CHANNELS */}
      {activeSubTab === 'channels' && (
        <div className="space-y-6">
          {/* Cảnh báo Xung đột IP chi tiết & Gộp Channel */}
          {ipConflicts.length > 0 && (
            <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-4 space-y-3 animate-fade-in">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Phát hiện {ipConflicts.length} địa chỉ IP trùng lặp giữa các Channel!</span>
              </div>
              <div className="space-y-2 text-xs">
                {ipConflicts.map(conf => (
                  <div key={conf.ip} className="bg-slate-950/80 p-3 rounded-lg border border-amber-500/30 space-y-2">
                    <div className="flex items-center justify-between text-amber-300 font-bold font-mono">
                      <span>🌐 IP TRÙNG: <span className="text-white underline">{conf.ip}</span></span>
                      <span className="text-[11px] text-amber-400/90 font-sans italic bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        Trùng giữa {conf.channels.length} Channels
                      </span>
                    </div>
                    <div className="pl-3 border-l-2 border-amber-500/50 space-y-1.5 font-sans text-slate-300 text-[11px]">
                      {conf.channels.map(ch => {
                        const targetCandidates = conf.channels.filter(c => c.id !== ch.id);
                        return (
                          <div key={ch.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/60 p-2 rounded border border-slate-800">
                            <div>
                              <span className="font-bold text-amber-400">Channel #{ch.id}:</span>{' '}
                              <span className="text-white font-bold">{ch.name}</span>
                              <div className="text-[10px] text-slate-400">
                                Chuyền: <strong className="text-slate-200">{ch.lineName || '—'}</strong> | Trạm: <strong className="text-slate-200">{ch.stationName}</strong>
                                {' | '}MAC: {ch.macAddress ? <strong className="text-amber-300 font-mono font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">{ch.macAddress}</strong> : <span className="text-slate-500 italic">Chưa đăng ký MAC</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                              {targetCandidates.map(targetCh => (
                                <button
                                  key={targetCh.id}
                                  onClick={() => handleMergeChannels(ch, targetCh)}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 font-bold text-[11px] transition-colors border border-indigo-500/30 flex items-center gap-1"
                                  title={`Gộp dữ liệu từ Channel #${ch.id} (${ch.name}) sang Channel chính #${targetCh.id} (${targetCh.name}) và xóa Channel #${ch.id}`}
                                >
                                  <GitMerge className="w-3 h-3 text-indigo-400" /> Gộp vào #{targetCh.id}
                                </button>
                              ))}
                              <button
                                onClick={() => setEditModal({ entityType: 'channel', item: { ...ch } })}
                                className="px-2.5 py-1 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 font-bold text-[11px] transition-colors border border-blue-500/30 flex items-center gap-1"
                              >
                                <Pencil className="w-3 h-3" /> Sửa IP
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="glass-panel p-6 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
                <Plus className="w-4 h-4 text-blue-400" /> Thêm Channel
              </h3>
              <form onSubmit={handleCreateChannel} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Chọn Station *</label>
                  <select required value={channelForm.stationId} onChange={e => setChannelForm({ ...channelForm, stationId: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                    <option value="">-- Chọn Station --</option>
                    {localStations.map(s => <option key={s.id} value={s.id}>{s.name} ({s.lineName})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Channel *</label>
                  <input type="text" required placeholder="e.g. Optical Sensor #1" value={channelForm.name} onChange={e => setChannelForm({ ...channelForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">GMES Name</label>
                  <input type="text" placeholder="Tên kết nối GMES" value={channelForm.gmesName} onChange={e => setChannelForm({ ...channelForm, gmesName: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">IP Address</label>
                  <input type="text" placeholder="192.168.1.100" value={channelForm.ipAddress} onChange={e => setChannelForm({ ...channelForm, ipAddress: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" />
                  {(() => {
                    const ip = (channelForm.ipAddress || '').trim();
                    if (ip && ip !== '127.0.0.1') {
                      const dup = localChannels.filter(c => (c.ipAddress || '').trim() === ip);
                      if (dup.length > 0) {
                        return (
                          <p className="mt-1 text-[11px] text-amber-400 flex items-center gap-1 font-sans">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            IP này đã được sử dụng bởi Channel: {dup.map(c => `#${c.id} (${c.name})`).join(', ')}
                          </p>
                        );
                      }
                    }
                    return null;
                  })()}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">MAC Address</label>
                  <input type="text" placeholder="00-11-22-33-44-55" value={channelForm.macAddress} onChange={e => setChannelForm({ ...channelForm, macAddress: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" />
                </div>
                <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                  {loading ? 'Đang xử lý...' : 'Tạo Channel'}
                </button>
              </form>
            </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={channelsTable} totalCount={localChannels.length} title="Channel" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={channelsTable} className="w-20" />
                    <ThSort label="Line" colKey="lineName" tableState={channelsTable} />
                    <ThSort label="Channel Name" colKey="name" tableState={channelsTable} />
                    <ThSort label="Station" colKey="stationName" tableState={channelsTable} />
                    <ThSort label="GMES Name" colKey="gmesName" tableState={channelsTable} />
                    <ThSort label="IP / MAC" colKey="ipAddress" tableState={channelsTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="ID..." value={channelsTable.columnFilters.id || ''} onChange={e => channelsTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <select value={channelsTable.columnFilters.lineName || ''} onChange={e => channelsTable.setColumnFilter('lineName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Line</option>
                        {localLines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Tên Channel..." value={channelsTable.columnFilters.name || ''} onChange={e => channelsTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <select value={channelsTable.columnFilters.stationName || ''} onChange={e => channelsTable.setColumnFilter('stationName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Station</option>
                        {localStations.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc GMES..." value={channelsTable.columnFilters.gmesName || ''} onChange={e => channelsTable.setColumnFilter('gmesName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="IP/MAC..." value={channelsTable.columnFilters.ipAddress || ''} onChange={e => channelsTable.setColumnFilter('ipAddress', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {channelsTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Channel phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    channelsTable.processedData.map(c => (
                      <tr key={c.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{c.id}</td>
                        <td className="p-3.5 font-bold text-cyan-400 font-sans">{c.lineName || 'Unassigned Line'}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{c.name}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{c.stationName}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{c.gmesName || '—'}</td>
                        <td className="p-3.5">
                          <div className="text-blue-400 font-bold">{c.ipAddress || '127.0.0.1'}</div>
                          <div className="text-[10px] text-slate-400">{c.macAddress || '—'}</div>
                        </td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'channel', item: { ...c } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteChannel(c.id, c.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* 4. MODEL GROUPS */}
      {activeSubTab === 'model-groups' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Thêm Model Group
            </h3>
            <form onSubmit={handleCreateModelGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Chọn Buyer</label>
                <select value={modelGroupForm.buyerId} onChange={e => setModelGroupForm({ ...modelGroupForm, buyerId: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                  <option value="">-- Tùy chọn Buyer --</option>
                  {localBuyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Model Group *</label>
                <input type="text" required placeholder="e.g. M-Class Powertrain" value={modelGroupForm.name} onChange={e => setModelGroupForm({ ...modelGroupForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input type="text" placeholder="Ghi chú" value={modelGroupForm.remark} onChange={e => setModelGroupForm({ ...modelGroupForm, remark: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                {loading ? 'Đang xử lý...' : 'Tạo Model Group'}
              </button>
            </form>
          </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={modelGroupsTable} totalCount={localModelGroups.length} title="Model Group" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={modelGroupsTable} className="w-20" />
                    <ThSort label="Model Group Name" colKey="name" tableState={modelGroupsTable} />
                    <ThSort label="Buyer" colKey="buyerName" tableState={modelGroupsTable} />
                    <ThSort label="Remark" colKey="remark" tableState={modelGroupsTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="ID..." value={modelGroupsTable.columnFilters.id || ''} onChange={e => modelGroupsTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Group Name..." value={modelGroupsTable.columnFilters.name || ''} onChange={e => modelGroupsTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <select value={modelGroupsTable.columnFilters.buyerName || ''} onChange={e => modelGroupsTable.setColumnFilter('buyerName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Buyer</option>
                        {localBuyers.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc Remark..." value={modelGroupsTable.columnFilters.remark || ''} onChange={e => modelGroupsTable.setColumnFilter('remark', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {modelGroupsTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Model Group phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    modelGroupsTable.processedData.map(mg => (
                      <tr key={mg.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{mg.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{mg.name}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{mg.buyerName || '—'}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{mg.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'model-group', item: { ...mg } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteModelGroup(mg.id, mg.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODELS */}
      {activeSubTab === 'models' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Thêm Model (Sản phẩm)
            </h3>
            <form onSubmit={handleCreateModel} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Chọn Model Group</label>
                <select value={modelForm.modelGroupId} onChange={e => setModelForm({ ...modelForm, modelGroupId: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                  <option value="">-- Chọn Model Group --</option>
                  {localModelGroups.map(mg => <option key={mg.id} value={mg.id}>{mg.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Model *</label>
                <input type="text" required placeholder="e.g. Model W206 Controller" value={modelForm.name} onChange={e => setModelForm({ ...modelForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input type="text" placeholder="Ghi chú" value={modelForm.remark} onChange={e => setModelForm({ ...modelForm, remark: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                {loading ? 'Đang xử lý...' : 'Tạo Model'}
              </button>
            </form>
          </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={modelsTable} totalCount={localModels.length} title="Model" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={modelsTable} className="w-20" />
                    <ThSort label="Model Name" colKey="name" tableState={modelsTable} />
                    <ThSort label="Model Group" colKey="modelGroupName" tableState={modelsTable} />
                    <ThSort label="Remark" colKey="remark" tableState={modelsTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="ID..." value={modelsTable.columnFilters.id || ''} onChange={e => modelsTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Tên Model..." value={modelsTable.columnFilters.name || ''} onChange={e => modelsTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <select value={modelsTable.columnFilters.modelGroupName || ''} onChange={e => modelsTable.setColumnFilter('modelGroupName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Group</option>
                        {localModelGroups.map(mg => <option key={mg.id} value={mg.name}>{mg.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc Remark..." value={modelsTable.columnFilters.remark || ''} onChange={e => modelsTable.setColumnFilter('remark', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {modelsTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Model sản phẩm phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    modelsTable.processedData.map(m => (
                      <tr key={m.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{m.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{m.name}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{m.modelGroupName || '—'}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{m.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'model', item: { ...m } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteModel(m.id, m.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 6. STATION TYPES */}
      {activeSubTab === 'station-types' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Thêm Loại Trạm (Station Type)
            </h3>
            <form onSubmit={handleCreateStationType} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Station Type *</label>
                <input type="text" required placeholder="e.g. SPI / AOI / ICT / FCT" value={stationTypeForm.name} onChange={e => setStationTypeForm({ ...stationTypeForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input type="text" placeholder="Ghi chú" value={stationTypeForm.remark} onChange={e => setStationTypeForm({ ...stationTypeForm, remark: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                {loading ? 'Đang xử lý...' : 'Tạo Station Type'}
              </button>
            </form>
          </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={stationTypesTable} totalCount={localStationTypes.length} title="Station Type" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={stationTypesTable} className="w-20" />
                    <ThSort label="Type Name" colKey="name" tableState={stationTypesTable} />
                    <ThSort label="Remark" colKey="remark" tableState={stationTypesTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="ID..." value={stationTypesTable.columnFilters.id || ''} onChange={e => stationTypesTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Type Name..." value={stationTypesTable.columnFilters.name || ''} onChange={e => stationTypesTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc Remark..." value={stationTypesTable.columnFilters.remark || ''} onChange={e => stationTypesTable.setColumnFilter('remark', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {stationTypesTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Loại Trạm phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    stationTypesTable.processedData.map(st => (
                      <tr key={st.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{st.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{st.name}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{st.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'station-type', item: { ...st } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteStationType(st.id, st.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 7. DEVICE TYPES */}
      {activeSubTab === 'device-types' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Thêm Loại Thiết Bị (Device Type)
            </h3>
            <form onSubmit={handleCreateDeviceType} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Device Type *</label>
                <input type="text" required placeholder="e.g. Camera 3D / Sensor / Scanner" value={deviceTypeForm.name} onChange={e => setDeviceTypeForm({ ...deviceTypeForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input type="text" placeholder="Ghi chú" value={deviceTypeForm.remark} onChange={e => setDeviceTypeForm({ ...deviceTypeForm, remark: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                {loading ? 'Đang xử lý...' : 'Tạo Device Type'}
              </button>
            </form>
          </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={deviceTypesTable} totalCount={localDeviceTypes.length} title="Device Type" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={deviceTypesTable} className="w-20" />
                    <ThSort label="Device Type Name" colKey="name" tableState={deviceTypesTable} />
                    <ThSort label="Remark" colKey="remark" tableState={deviceTypesTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="ID..." value={deviceTypesTable.columnFilters.id || ''} onChange={e => deviceTypesTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Device Type Name..." value={deviceTypesTable.columnFilters.name || ''} onChange={e => deviceTypesTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc Remark..." value={deviceTypesTable.columnFilters.remark || ''} onChange={e => deviceTypesTable.setColumnFilter('remark', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {deviceTypesTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Loại Thiết Bị phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    deviceTypesTable.processedData.map(dt => (
                      <tr key={dt.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{dt.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{dt.name}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{dt.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'device-type', item: { ...dt } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteDeviceType(dt.id, dt.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 8. DEVICES */}
      {activeSubTab === 'devices' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Thêm Thiết Bị (Device)
            </h3>
            <form onSubmit={handleCreateDevice} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Chọn Channel *</label>
                <select required value={deviceForm.channelId} onChange={e => setDeviceForm({ ...deviceForm, channelId: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                  <option value="">-- Chọn Channel --</option>
                  {localChannels.map(c => <option key={c.id} value={c.id}>{c.name} ({c.stationName})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Device *</label>
                <input type="text" required placeholder="e.g. Laser Meter 01" value={deviceForm.name} onChange={e => setDeviceForm({ ...deviceForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Device Type</label>
                <select value={deviceForm.deviceTypeId} onChange={e => setDeviceForm({ ...deviceForm, deviceTypeId: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                  <option value="">-- Chọn Device Type --</option>
                  {localDeviceTypes.map(dt => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Serial Number</label>
                <input type="text" placeholder="S/N 123456" value={deviceForm.serialNumber} onChange={e => setDeviceForm({ ...deviceForm, serialNumber: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                {loading ? 'Đang xử lý...' : 'Tạo Device'}
              </button>
            </form>
          </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={devicesTable} totalCount={localDevices.length} title="Device" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={devicesTable} className="w-20" />
                    <ThSort label="Device Name" colKey="name" tableState={devicesTable} />
                    <ThSort label="Channel" colKey="channelName" tableState={devicesTable} />
                    <ThSort label="Type" colKey="deviceTypeName" tableState={devicesTable} />
                    <ThSort label="Serial No" colKey="serialNumber" tableState={devicesTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="ID..." value={devicesTable.columnFilters.id || ''} onChange={e => devicesTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Device Name..." value={devicesTable.columnFilters.name || ''} onChange={e => devicesTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <select value={devicesTable.columnFilters.channelName || ''} onChange={e => devicesTable.setColumnFilter('channelName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Channel</option>
                        {localChannels.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <select value={devicesTable.columnFilters.deviceTypeName || ''} onChange={e => devicesTable.setColumnFilter('deviceTypeName', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">Tất cả Type</option>
                        {localDeviceTypes.map(dt => <option key={dt.id} value={dt.name}>{dt.name}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Serial No..." value={devicesTable.columnFilters.serialNumber || ''} onChange={e => devicesTable.setColumnFilter('serialNumber', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {devicesTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Thiết Bị phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    devicesTable.processedData.map(d => (
                      <tr key={d.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{d.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{d.name}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{d.channelName}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{d.deviceTypeName || '—'}</td>
                        <td className="p-3.5 text-slate-400 font-mono">{d.serialNumber || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'device', item: { ...d } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteDevice(d.id, d.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 9. BUYERS */}
      {activeSubTab === 'buyers' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Thêm Khách Hàng (Buyer)
            </h3>
            <form onSubmit={handleCreateBuyer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Tên Buyer *</label>
                <input type="text" required placeholder="e.g. Mercedes-Benz / Bosch" value={buyerForm.name} onChange={e => setBuyerForm({ ...buyerForm, name: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input type="text" placeholder="Ghi chú thêm" value={buyerForm.remark} onChange={e => setBuyerForm({ ...buyerForm, remark: e.target.value })} className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all">
                {loading ? 'Đang xử lý...' : 'Tạo Buyer'}
              </button>
            </form>
          </div>
          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            <TableToolbar tableState={buyersTable} totalCount={localBuyers.length} title="Buyer" />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <ThSort label="ID" colKey="id" tableState={buyersTable} className="w-20" />
                    <ThSort label="Buyer Name" colKey="name" tableState={buyersTable} />
                    <ThSort label="Remark" colKey="remark" tableState={buyersTable} />
                    <th className="p-3.5 text-right w-24">Thao tác</th>
                  </tr>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <td className="p-1.5">
                      <input type="text" placeholder="ID..." value={buyersTable.columnFilters.id || ''} onChange={e => buyersTable.setColumnFilter('id', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Buyer Name..." value={buyersTable.columnFilters.name || ''} onChange={e => buyersTable.setColumnFilter('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5">
                      <input type="text" placeholder="Lọc Remark..." value={buyersTable.columnFilters.remark || ''} onChange={e => buyersTable.setColumnFilter('remark', e.target.value)} className="w-full bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="p-1.5"></td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {buyersTable.processedData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500 font-sans">
                        Không tìm thấy Khách Hàng phù hợp với bộ lọc
                      </td>
                    </tr>
                  ) : (
                    buyersTable.processedData.map(b => (
                      <tr key={b.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{b.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{b.name}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{b.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ entityType: 'buyer', item: { ...b } })} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteBuyer(b.id, b.name)} className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md p-6 border border-white/20 rounded-2xl shadow-2xl space-y-5 bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2 font-display">
                <Pencil className="w-4 h-4 text-blue-400" /> Cập nhật {editModal.entityType.toUpperCase()} #{editModal.item.id}
              </h3>
              <button onClick={() => setEditModal(null)} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Tên Entity</label>
                <input type="text" required value={editModal.item.name || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, name: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>

              {editModal.entityType === 'model-group' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Chọn Buyer</label>
                  <select value={editModal.item.buyerId || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, buyerId: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                    <option value="">-- Tùy chọn Buyer --</option>
                    {localBuyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}

              {editModal.entityType === 'model' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Chọn Model Group</label>
                  <select value={editModal.item.modelGroupId || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, modelGroupId: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                    <option value="">-- Tùy chọn Model Group --</option>
                    {localModelGroups.map(mg => <option key={mg.id} value={mg.id}>{mg.name}</option>)}
                  </select>
                </div>
              )}

              {editModal.entityType === 'station' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Chọn Line</label>
                    <select required value={editModal.item.lineId || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, lineId: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                      {localLines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Chọn Model Group</label>
                    <select value={editModal.item.modelGroupId || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, modelGroupId: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                      <option value="">-- Tùy chọn Model Group --</option>
                      {localModelGroups.map(mg => <option key={mg.id} value={mg.id}>{mg.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Chọn Station Type</label>
                    <select value={editModal.item.stationTypeId || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, stationTypeId: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                      <option value="">-- Tùy chọn Station Type --</option>
                      {localStationTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              {editModal.entityType === 'channel' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Chọn Trạm (Station)</label>
                    <select required value={editModal.item.stationId || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, stationId: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500">
                      {localStations.map(s => <option key={s.id} value={s.id}>{s.name} ({s.lineName})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">IP Address</label>
                    <input type="text" value={editModal.item.ipAddress || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, ipAddress: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">MAC Address</label>
                    <input type="text" value={editModal.item.macAddress || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, macAddress: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">GMES Name</label>
                    <input type="text" value={editModal.item.gmesName || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, gmesName: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Ghi chú (Remark)</label>
                <input type="text" value={editModal.item.remark || ''} onChange={e => setEditModal({ ...editModal, item: { ...editModal.item, remark: e.target.value } })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button type="button" onClick={() => setEditModal(null)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700">Hủy</button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    const type = editModal.entityType;
                    const id = editModal.item.id;
                    const item = editModal.item;
                    if (type === 'buyer') handleUpdateBuyer(id, item);
                    else if (type === 'model-group') handleUpdateModelGroup(id, item);
                    else if (type === 'model') handleUpdateModel(id, item);
                    else if (type === 'station-type') handleUpdateStationType(id, item);
                    else if (type === 'line') handleUpdateLine(id, item);
                    else if (type === 'station') handleUpdateStation(id, item);
                    else if (type === 'channel') handleUpdateChannel(id, item);
                    else if (type === 'device-type') handleUpdateDeviceType(id, item);
                    else if (type === 'device') handleUpdateDevice(id, item);
                  }}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30"
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
