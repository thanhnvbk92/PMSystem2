import React, { useState, useEffect, useMemo } from 'react';
import { Database, Plus, RefreshCw, Layers, Cpu, Radio, Building2, Pencil, Trash2, X, Search, Filter, AlertTriangle } from 'lucide-react';
import { MasterDataApi } from '../services/api';

export default function MasterData({ buyers = [], lines = [], stations = [], channels = [], onRefresh }) {
  const [activeSubTab, setActiveSubTab] = useState('lines');

  // Synced local state for instant optimistic UI feedback
  const [localBuyers, setLocalBuyers] = useState(buyers);
  const [localLines, setLocalLines] = useState(lines);
  const [localStations, setLocalStations] = useState(stations);
  const [localChannels, setLocalChannels] = useState(channels);

  // Table Filter States
  const [buyerSearch, setBuyerSearch] = useState('');
  const [lineSearch, setLineSearch] = useState('');

  const [stationLineFilter, setStationLineFilter] = useState('');
  const [stationSearch, setStationSearch] = useState('');

  const [channelLineFilter, setChannelLineFilter] = useState('');
  const [channelStationFilter, setChannelStationFilter] = useState('');
  const [channelSearch, setChannelSearch] = useState('');

  const sortLinesAsc = (lineList) => {
    return [...(lineList || [])].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
    );
  };

  useEffect(() => { setLocalBuyers(buyers); }, [buyers]);
  useEffect(() => { setLocalLines(sortLinesAsc(lines)); }, [lines]);
  useEffect(() => { setLocalStations(stations); }, [stations]);
  useEffect(() => { setLocalChannels(channels); }, [channels]);

  // Computed Filtered Data
  const filteredBuyers = localBuyers.filter(b => {
    if (!buyerSearch.trim()) return true;
    const q = buyerSearch.toLowerCase();
    return (
      String(b.id).includes(q) ||
      (b.name && b.name.toLowerCase().includes(q)) ||
      (b.remark && b.remark.toLowerCase().includes(q))
    );
  });

  const filteredLines = localLines.filter(l => {
    if (!lineSearch.trim()) return true;
    const q = lineSearch.toLowerCase();
    return (
      String(l.id).includes(q) ||
      (l.name && l.name.toLowerCase().includes(q)) ||
      (l.remark && l.remark.toLowerCase().includes(q))
    );
  });

  const filteredStations = localStations.filter(s => {
    if (stationLineFilter && String(s.lineId) !== String(stationLineFilter)) return false;
    if (!stationSearch.trim()) return true;
    const q = stationSearch.toLowerCase();
    return (
      String(s.id).includes(q) ||
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.lineName && s.lineName.toLowerCase().includes(q)) ||
      (s.remark && s.remark.toLowerCase().includes(q))
    );
  });

  const filteredChannels = localChannels.filter(c => {
    if (channelLineFilter) {
      const stationObj = localStations.find(st => String(st.id) === String(c.stationId));
      if (!stationObj || String(stationObj.lineId) !== String(channelLineFilter)) return false;
    }
    if (channelStationFilter && String(c.stationId) !== String(channelStationFilter)) return false;

    if (!channelSearch.trim()) return true;
    const q = channelSearch.toLowerCase();
    return (
      String(c.id).includes(q) ||
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.ipAddress && c.ipAddress.toLowerCase().includes(q)) ||
      (c.macAddress && c.macAddress.toLowerCase().includes(q)) ||
      (c.stationName && c.stationName.toLowerCase().includes(q)) ||
      (c.lineName && c.lineName.toLowerCase().includes(q))
    );
  });

  // Create Forms State
  const [buyerForm, setBuyerForm] = useState({ name: '', remark: '' });
  const [lineForm, setLineForm] = useState({ name: '', remark: '' });
  const [stationForm, setStationForm] = useState({ lineId: '', name: '', remark: '' });
  const [channelForm, setChannelForm] = useState({ lineId: '', stationId: '', name: '', ipAddress: '', macAddress: '' });

  // Edit Modal State
  const [editModal, setEditModal] = useState(null);

  const [loading, setLoading] = useState(false);

  // --- BUYERS CRUD ---
  const handleCreateBuyer = async (e) => {
    e.preventDefault();
    if (!buyerForm.name) return;
    setLoading(true);
    try {
      await MasterDataApi.createBuyer(buyerForm);
      setBuyerForm({ name: '', remark: '' });
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBuyer = async (id, data) => {
    setLoading(true);
    try {
      await MasterDataApi.updateBuyer(id, data);
      setEditModal(null);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBuyer = async (id, name) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa Buyer "${name}"?`)) return;
    setLocalBuyers(prev => prev.filter(b => b.id !== id));
    setLoading(true);
    try {
      await MasterDataApi.deleteBuyer(id);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
      await onRefresh();
    } finally {
      setLoading(false);
    }
  };

  // --- LINES CRUD ---
  const handleCreateLine = async (e) => {
    e.preventDefault();
    if (!lineForm.name) return;
    setLoading(true);
    try {
      await MasterDataApi.createLine(lineForm);
      setLineForm({ name: '', remark: '' });
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLine = async (id, data) => {
    setLoading(true);
    try {
      await MasterDataApi.updateLine(id, data);
      setEditModal(null);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLine = async (id, name) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa Line "${name}"?`)) return;
    setLocalLines(prev => prev.filter(l => l.id !== id));
    setLoading(true);
    try {
      await MasterDataApi.deleteLine(id);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
      await onRefresh();
    } finally {
      setLoading(false);
    }
  };

  // --- STATIONS CRUD ---
  const handleCreateStation = async (e) => {
    e.preventDefault();
    if (!stationForm.name || !stationForm.lineId) return;
    setLoading(true);
    try {
      await MasterDataApi.createStation({
        lineId: parseInt(stationForm.lineId),
        name: stationForm.name,
        remark: stationForm.remark
      });
      setStationForm({ lineId: '', name: '', remark: '' });
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStation = async (id, data) => {
    setLoading(true);
    try {
      await MasterDataApi.updateStation(id, {
        lineId: parseInt(data.lineId),
        name: data.name,
        remark: data.remark
      });
      setEditModal(null);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStation = async (id, name) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa Trạm "${name}"?`)) return;
    setLocalStations(prev => prev.filter(s => s.id !== id));
    setLoading(true);
    try {
      await MasterDataApi.deleteStation(id);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
      await onRefresh();
    } finally {
      setLoading(false);
    }
  };

  // --- CHANNELS CRUD ---
  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!channelForm.name || !channelForm.stationId) return;
    setLoading(true);
    try {
      await MasterDataApi.createChannel({
        stationId: parseInt(channelForm.stationId),
        name: channelForm.name,
        ipAddress: channelForm.ipAddress,
        macAddress: channelForm.macAddress
      });
      setChannelForm({ lineId: '', stationId: '', name: '', ipAddress: '', macAddress: '' });
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateChannel = async (id, data) => {
    setLoading(true);
    try {
      await MasterDataApi.updateChannel(id, {
        stationId: parseInt(data.stationId),
        name: data.name,
        ipAddress: data.ipAddress,
        macAddress: data.macAddress,
        status: data.status
      });
      setEditModal(null);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteChannel = async (id, name) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa Channel "${name}"?`)) return;
    setLocalChannels(prev => prev.filter(c => c.id !== id));
    setLoading(true);
    try {
      await MasterDataApi.deleteChannel(id);
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
      await onRefresh();
    } finally {
      setLoading(false);
    }
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
    return Object.entries(ipMap)
      .filter(([ip, list]) => list.length > 1)
      .map(([ip, list]) => ({ ip, channels: list }));
  }, [localChannels]);

  return (
    <div className="space-y-6">
      {/* Header */}

      {/* Sub Tabs */}
      <div className="flex border-b border-white/10 space-x-2">
        <button
          onClick={() => setActiveSubTab('lines')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 ${activeSubTab === 'lines'
            ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
            : 'border-transparent text-slate-400 hover:text-white'
            }`}
        >
          <Layers className="w-4 h-4" />
          <span>Production Lines</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">{localLines.length}</span>
        </button>

        <button
          onClick={() => setActiveSubTab('stations')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 ${activeSubTab === 'stations'
            ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
            : 'border-transparent text-slate-400 hover:text-white'
            }`}
        >
          <Cpu className="w-4 h-4 text-blue-400" />
          <span>Stations</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">{localStations.length}</span>
        </button>

        <button
          onClick={() => setActiveSubTab('channels')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 ${activeSubTab === 'channels'
            ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
            : 'border-transparent text-slate-400 hover:text-white'
            }`}
        >
          <Radio className="w-4 h-4" />
          <span>Channels</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">{localChannels.length}</span>
          {ipConflicts.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold animate-pulse flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {ipConflicts.length} Xung đột IP
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('buyers')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 ${activeSubTab === 'buyers'
            ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
            : 'border-transparent text-slate-400 hover:text-white'
            }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Buyers</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">{localBuyers.length}</span>
        </button>
      </div>

      {/* 1. BUYERS */}
      {activeSubTab === 'buyers' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Add New Customer Buyer
            </h3>
            <form onSubmit={handleCreateBuyer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Buyer Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mercedes-Benz / Bosch"
                  value={buyerForm.name}
                  onChange={e => setBuyerForm({ ...buyerForm, name: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input
                  type="text"
                  placeholder="Optional notes or SLA details"
                  value={buyerForm.remark}
                  onChange={e => setBuyerForm({ ...buyerForm, remark: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all"
              >
                {loading ? 'Processing...' : 'Create Buyer Entity'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-white/5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Lọc Buyer theo tên, remark, ID..."
                  value={buyerSearch}
                  onChange={e => setBuyerSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                {buyerSearch && (
                  <button
                    onClick={() => setBuyerSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-[11px] text-slate-400 font-mono text-right flex items-center justify-end gap-1.5 whitespace-nowrap">
                <Filter className="w-3.5 h-3.5 text-blue-400" />
                Hiển thị <span className="font-bold text-blue-400">{filteredBuyers.length}</span> / {localBuyers.length} Buyers
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">ID</th>
                    <th className="p-3.5">Buyer Name</th>
                    <th className="p-3.5">Remark</th>
                    <th className="p-3.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredBuyers.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="p-6 text-center text-slate-500 font-sans italic">
                        Không tìm thấy Buyer phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredBuyers.map(b => (
                      <tr key={b.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{b.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{b.name}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{b.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditModal({ entityType: 'buyer', item: { ...b } })}
                              className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"
                              title="Sửa"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteBuyer(b.id, b.name)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
                              title="Xóa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

      {/* 2. LINES */}
      {activeSubTab === 'lines' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Add New Assembly Line
            </h3>
            <form onSubmit={handleCreateLine} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Line Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Line 04 SMT High-Speed"
                  value={lineForm.name}
                  onChange={e => setLineForm({ ...lineForm, name: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input
                  type="text"
                  placeholder="Optional remark"
                  value={lineForm.remark}
                  onChange={e => setLineForm({ ...lineForm, remark: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all"
              >
                {loading ? 'Processing...' : 'Create Line Entity'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-white/5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Lọc Line theo tên, remark, ID..."
                  value={lineSearch}
                  onChange={e => setLineSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                {lineSearch && (
                  <button
                    onClick={() => setLineSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-[11px] text-slate-400 font-mono text-right flex items-center justify-end gap-1.5 whitespace-nowrap">
                <Filter className="w-3.5 h-3.5 text-blue-400" />
                Hiển thị <span className="font-bold text-blue-400">{filteredLines.length}</span> / {localLines.length} Lines
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">ID</th>
                    <th className="p-3.5">Line Name</th>
                    <th className="p-3.5">Remark</th>
                    <th className="p-3.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredLines.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="p-6 text-center text-slate-500 font-sans italic">
                        Không tìm thấy Line phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredLines.map(l => (
                      <tr key={l.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{l.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{l.name}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{l.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditModal({ entityType: 'line', item: { ...l } })}
                              className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"
                              title="Sửa"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteLine(l.id, l.name)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
                              title="Xóa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

      {/* 3. STATIONS */}
      {activeSubTab === 'stations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Add Inspection Station
            </h3>
            <form onSubmit={handleCreateStation} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Select Line</label>
                <select
                  required
                  value={stationForm.lineId}
                  onChange={e => setStationForm({ ...stationForm, lineId: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Choose Assembly Line --</option>
                  {localLines.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Station Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Station 03 SPI / AOI"
                  value={stationForm.name}
                  onChange={e => setStationForm({ ...stationForm, name: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input
                  type="text"
                  placeholder="Optional remark"
                  value={stationForm.remark}
                  onChange={e => setStationForm({ ...stationForm, remark: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all"
              >
                {loading ? 'Processing...' : 'Create Station Entity'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-white/5">
              <div className="flex flex-1 flex-col sm:flex-row items-center gap-2">
                <select
                  value={stationLineFilter}
                  onChange={e => setStationLineFilter(e.target.value)}
                  className="w-full sm:w-44 bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Tất cả Line --</option>
                  {localLines.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>

                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Lọc Station theo tên, line, remark, ID..."
                    value={stationSearch}
                    onChange={e => setStationSearch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  {stationSearch && (
                    <button
                      onClick={() => setStationSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="text-[11px] text-slate-400 font-mono text-right flex items-center justify-end gap-1.5 whitespace-nowrap">
                <Filter className="w-3.5 h-3.5 text-blue-400" />
                Hiển thị <span className="font-bold text-blue-400">{filteredStations.length}</span> / {localStations.length} Stations
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">ID</th>
                    <th className="p-3.5">Station Name</th>
                    <th className="p-3.5">Line</th>
                    <th className="p-3.5">Remark</th>
                    <th className="p-3.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredStations.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="p-6 text-center text-slate-500 font-sans italic">
                        Không tìm thấy Station phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredStations.map(s => (
                      <tr key={s.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{s.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{s.name}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{s.lineName}</td>
                        <td className="p-3.5 text-slate-400 font-sans">{s.remark || '—'}</td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditModal({ entityType: 'station', item: { ...s } })}
                              className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"
                              title="Sửa"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteStation(s.id, s.name)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
                              title="Xóa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

      {/* 4. CHANNELS */}
      {activeSubTab === 'channels' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Plus className="w-4 h-4 text-blue-400" /> Add New Channel
            </h3>
            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider flex items-center justify-between">
                  <span>Select Line</span>
                  <span className="text-[10px] text-blue-400 font-normal">Lọc Station theo Line</span>
                </label>
                <select
                  value={channelForm.lineId || ''}
                  onChange={e => {
                    const selectedLineId = e.target.value;
                    setChannelForm(prev => {
                      const currStation = localStations.find(s => String(s.id) === String(prev.stationId));
                      const keepStation = currStation && (!selectedLineId || String(currStation.lineId) === String(selectedLineId));
                      return {
                        ...prev,
                        lineId: selectedLineId,
                        stationId: keepStation ? prev.stationId : ''
                      };
                    });
                  }}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Tất cả Line ({localLines.length}) --</option>
                  {localLines.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Select Station</label>
                <select
                  required
                  value={channelForm.stationId}
                  onChange={e => {
                    const stId = e.target.value;
                    const st = localStations.find(s => String(s.id) === String(stId));
                    setChannelForm(prev => ({
                      ...prev,
                      stationId: stId,
                      lineId: st ? String(st.lineId) : prev.lineId
                    }));
                  }}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Choose Inspection Station --</option>
                  {(channelForm.lineId
                    ? localStations.filter(s => String(s.lineId) === String(channelForm.lineId))
                    : localStations
                  ).map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.lineName})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Channel Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Channel Top Camera #1"
                  value={channelForm.name}
                  onChange={e => setChannelForm({ ...channelForm, name: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">IP Address</label>
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.120"
                  value={channelForm.ipAddress}
                  onChange={e => setChannelForm({ ...channelForm, ipAddress: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">MAC Address</label>
                <input
                  type="text"
                  placeholder="e.g. 00-11-22-33-44-55"
                  value={channelForm.macAddress || ''}
                  onChange={e => setChannelForm({ ...channelForm, macAddress: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all"
              >
                {loading ? 'Processing...' : 'Create Channel Entity'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 glass-panel p-6 border border-white/10 space-y-4">
            {/* Cảnh báo Xung đột IP chi tiết */}
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
                        {conf.channels.map(ch => (
                          <div key={ch.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/60 p-2 rounded border border-slate-800">
                            <div>
                              <span className="font-bold text-amber-400">Channel #{ch.id}:</span>{' '}
                              <span className="text-white font-bold">{ch.name}</span>
                              <div className="text-[10px] text-slate-400">
                                Chuyền: <strong className="text-slate-200">{ch.lineName || '—'}</strong> | Trạm: <strong className="text-slate-200">{ch.stationName}</strong>
                                {ch.macAddress && (
                                  <> | MAC: <strong className="text-amber-300 font-mono font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">{ch.macAddress}</strong></>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => setEditModal({ entityType: 'channel', item: { ...ch } })}
                              className="px-2.5 py-1 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 font-bold text-[11px] transition-colors border border-blue-500/30 shrink-0 flex items-center gap-1"
                            >
                              <Pencil className="w-3 h-3" /> Sửa IP Channel #{ch.id}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-white/5">
              <div className="flex flex-1 flex-col sm:flex-row items-center gap-2">
                <select
                  value={channelLineFilter}
                  onChange={e => {
                    setChannelLineFilter(e.target.value);
                    setChannelStationFilter(''); // Reset station filter if line changes
                  }}
                  className="w-full sm:w-36 bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Tất cả Line --</option>
                  {localLines.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>

                <select
                  value={channelStationFilter}
                  onChange={e => setChannelStationFilter(e.target.value)}
                  className="w-full sm:w-40 bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Tất cả Station --</option>
                  {(channelLineFilter
                    ? localStations.filter(s => String(s.lineId) === String(channelLineFilter))
                    : localStations
                  ).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>

                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Lọc Channel theo tên, IP, station, line, ID..."
                    value={channelSearch}
                    onChange={e => setChannelSearch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  {channelSearch && (
                    <button
                      onClick={() => setChannelSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="text-[11px] text-slate-400 font-mono text-right flex items-center justify-end gap-1.5 whitespace-nowrap">
                <Filter className="w-3.5 h-3.5 text-blue-400" />
                Hiển thị <span className="font-bold text-blue-400">{filteredChannels.length}</span> / {localChannels.length} Channels
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">ID</th>
                    <th className="p-3.5">Channel Name</th>
                    <th className="p-3.5">Line</th>
                    <th className="p-3.5">Station</th>
                    <th className="p-3.5">IP / MAC Address</th>
                    <th className="p-3.5 text-center">Status</th>
                    <th className="p-3.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredChannels.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="p-6 text-center text-slate-500 font-sans italic">
                        Không tìm thấy Channel phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredChannels.map(c => (
                      <tr key={c.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5 text-slate-400 font-bold">#{c.id}</td>
                        <td className="p-3.5 font-bold text-white font-sans">{c.name}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{c.lineName || '—'}</td>
                        <td className="p-3.5 text-slate-300 font-sans">{c.stationName}</td>
                        <td className="p-3.5 text-blue-400 font-mono">
                          <div>{c.ipAddress || '127.0.0.1'}</div>
                          {c.macAddress && <div className="text-[10px] text-amber-300/80 font-mono">MAC: {c.macAddress}</div>}
                        </td>
                        <td className="p-3.5 text-center">
                          <span className="badge badge-ok">{c.status || 'online'}</span>
                        </td>
                        <td className="p-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditModal({ entityType: 'channel', item: { ...c } })}
                              className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"
                              title="Sửa"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteChannel(c.id, c.name)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
                              title="Xóa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
                <Pencil className="w-4 h-4 text-blue-400" />
                Cập nhật {editModal.entityType.toUpperCase()} #{editModal.item.id}
              </h3>
              <button
                onClick={() => setEditModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Buyer Form */}
            {editModal.entityType === 'buyer' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleUpdateBuyer(editModal.item.id, {
                    name: editModal.item.name,
                    remark: editModal.item.remark
                  });
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Tên Buyer</label>
                  <input
                    type="text"
                    required
                    value={editModal.item.name || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, name: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Ghi chú (Remark)</label>
                  <input
                    type="text"
                    value={editModal.item.remark || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, remark: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setEditModal(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30"
                  >
                    Lưu thay đổi
                  </button>
                </div>
              </form>
            )}

            {/* Line Form */}
            {editModal.entityType === 'line' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleUpdateLine(editModal.item.id, {
                    name: editModal.item.name,
                    remark: editModal.item.remark
                  });
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Tên Line</label>
                  <input
                    type="text"
                    required
                    value={editModal.item.name || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, name: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Ghi chú (Remark)</label>
                  <input
                    type="text"
                    value={editModal.item.remark || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, remark: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setEditModal(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30"
                  >
                    Lưu thay đổi
                  </button>
                </div>
              </form>
            )}

            {/* Station Form */}
            {editModal.entityType === 'station' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleUpdateStation(editModal.item.id, editModal.item);
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Chọn Line</label>
                  <select
                    required
                    value={editModal.item.lineId}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, lineId: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {localLines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Tên Station</label>
                  <input
                    type="text"
                    required
                    value={editModal.item.name || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, name: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Ghi chú (Remark)</label>
                  <input
                    type="text"
                    value={editModal.item.remark || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, remark: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setEditModal(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30"
                  >
                    Lưu thay đổi
                  </button>
                </div>
              </form>
            )}

            {/* Channel Form */}
            {editModal.entityType === 'channel' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleUpdateChannel(editModal.item.id, editModal.item);
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider flex items-center justify-between">
                    <span>Chọn Line</span>
                    <span className="text-[10px] text-blue-400 font-normal">Lọc Station theo Line</span>
                  </label>
                  <select
                    value={
                      editModal.item.filterLineId !== undefined
                        ? editModal.item.filterLineId
                        : (localStations.find(s => String(s.id) === String(editModal.item.stationId))?.lineId || '')
                    }
                    onChange={(e) => {
                      const selectedLineId = e.target.value;
                      setEditModal(prev => ({
                        ...prev,
                        item: {
                          ...prev.item,
                          filterLineId: selectedLineId
                        }
                      }));
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- Tất cả Line ({localLines.length}) --</option>
                    {localLines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Chọn Station</label>
                  <select
                    required
                    value={editModal.item.stationId}
                    onChange={(e) => {
                      const stId = e.target.value;
                      const st = localStations.find(s => String(s.id) === String(stId));
                      setEditModal(prev => ({
                        ...prev,
                        item: {
                          ...prev.item,
                          stationId: stId,
                          filterLineId: st ? st.lineId : prev.item.filterLineId
                        }
                      }));
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- Chọn Station --</option>
                    {(
                      (editModal.item.filterLineId !== undefined
                        ? editModal.item.filterLineId
                        : (localStations.find(s => String(s.id) === String(editModal.item.stationId))?.lineId || '')
                      )
                        ? localStations.filter(s => String(s.lineId) === String(
                            editModal.item.filterLineId !== undefined
                              ? editModal.item.filterLineId
                              : (localStations.find(st => String(st.id) === String(editModal.item.stationId))?.lineId || '')
                          ))
                        : localStations
                    ).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.lineName})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Tên Channel</label>
                  <input
                    type="text"
                    required
                    value={editModal.item.name || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, name: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Địa chỉ IP</label>
                  <input
                    type="text"
                    value={editModal.item.ipAddress || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, ipAddress: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">Địa chỉ MAC</label>
                  <input
                    type="text"
                    placeholder="00-11-22-33-44-55"
                    value={editModal.item.macAddress || ''}
                    onChange={(e) => setEditModal({ ...editModal, item: { ...editModal.item, macAddress: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setEditModal(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30"
                  >
                    Lưu thay đổi
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
