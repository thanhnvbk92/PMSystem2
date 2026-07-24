import React, { useState, useEffect } from 'react';
import { Database, Plus, RefreshCw, Layers, Cpu, Radio, Building2, Pencil, Trash2, X } from 'lucide-react';
import { MasterDataApi } from '../services/api';

export default function MasterData({ buyers = [], lines = [], stations = [], channels = [], onRefresh }) {
  const [activeSubTab, setActiveSubTab] = useState('lines');

  // Synced local state for instant optimistic UI feedback
  const [localBuyers, setLocalBuyers] = useState(buyers);
  const [localLines, setLocalLines] = useState(lines);
  const [localStations, setLocalStations] = useState(stations);
  const [localChannels, setLocalChannels] = useState(channels);

  const sortLinesAsc = (lineList) => {
    return [...(lineList || [])].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
    );
  };

  useEffect(() => { setLocalBuyers(buyers); }, [buyers]);
  useEffect(() => { setLocalLines(sortLinesAsc(lines)); }, [lines]);
  useEffect(() => { setLocalStations(stations); }, [stations]);
  useEffect(() => { setLocalChannels(channels); }, [channels]);

  // Create Forms State
  const [buyerForm, setBuyerForm] = useState({ name: '', remark: '' });
  const [lineForm, setLineForm] = useState({ name: '', remark: '' });
  const [stationForm, setStationForm] = useState({ lineId: '', name: '', remark: '' });
  const [channelForm, setChannelForm] = useState({ lineId: '', stationId: '', name: '', ipAddress: '' });

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
        ipAddress: channelForm.ipAddress
      });
      setChannelForm({ lineId: '', stationId: '', name: '', ipAddress: '' });
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

          <div className="lg:col-span-2 glass-panel p-6 border border-white/10">
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
                  {localBuyers.map(b => (
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
                  ))}
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

          <div className="lg:col-span-2 glass-panel p-6 border border-white/10">
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
                  {localLines.map(l => (
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
                  ))}
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

          <div className="lg:col-span-2 glass-panel p-6 border border-white/10">
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
                  {localStations.map(s => (
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
                  ))}
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
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg shadow-blue-600/30 transition-all"
              >
                {loading ? 'Processing...' : 'Create Channel Entity'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 glass-panel p-6 border border-white/10">
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">ID</th>
                    <th className="p-3.5">Channel Name</th>
                    <th className="p-3.5">Line</th>
                    <th className="p-3.5">Station</th>
                    <th className="p-3.5">IP Address</th>
                    <th className="p-3.5 text-center">Status</th>
                    <th className="p-3.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {localChannels.map(c => (
                    <tr key={c.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-3.5 text-slate-400 font-bold">#{c.id}</td>
                      <td className="p-3.5 font-bold text-white font-sans">{c.name}</td>
                      <td className="p-3.5 text-slate-300 font-sans">{c.lineName || '—'}</td>
                      <td className="p-3.5 text-slate-300 font-sans">{c.stationName}</td>
                      <td className="p-3.5 text-blue-400 font-mono">{c.ipAddress || '127.0.0.1'}</td>
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
                  ))}
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
