import React, { useState } from 'react';
import { Database, Plus, RefreshCw, Layers, Cpu, Radio, Building2 } from 'lucide-react';
import { MasterDataApi } from '../services/api';

export default function MasterData({ buyers, lines, stations, channels, onRefresh }) {
  const [activeSubTab, setActiveSubTab] = useState('buyers');
  
  // Forms
  const [buyerForm, setBuyerForm] = useState({ name: '', remark: '' });
  const [lineForm, setLineForm] = useState({ name: '', remark: '' });
  const [stationForm, setStationForm] = useState({ lineId: '', name: '', remark: '' });
  const [channelForm, setChannelForm] = useState({ stationId: '', name: '', ipAddress: '' });
  
  const [loading, setLoading] = useState(false);

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

  const handleCreateLine = async (e) => {
    e.preventDefault();
    if (!lineForm.name) return;
    setLoading(true);
    try {
      await MasterDataApi.createLine({
        name: lineForm.name,
        remark: lineForm.remark
      });
      setLineForm({ name: '', remark: '' });
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

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
      setChannelForm({ stationId: '', name: '', ipAddress: '' });
      await onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel p-6 flex flex-wrap items-center justify-between gap-4 border border-white/10">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5 font-display">
            <Database className="w-5 h-5 text-blue-400" />
            Master Data System Architecture
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            SMT Line Architecture: Line → Station → Hardware Channel
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-xs font-semibold text-slate-300 transition-colors flex items-center gap-2 shadow-sm"
        >
          <RefreshCw className="w-4 h-4 text-blue-400" /> Refresh Schema Data
        </button>
      </div>

      {/* Sub Tabs */}
      <div className="flex border-b border-white/10 space-x-2">
        <button
          onClick={() => setActiveSubTab('lines')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 ${
            activeSubTab === 'lines'
              ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Production Lines</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">{lines.length}</span>
        </button>

        <button
          onClick={() => setActiveSubTab('stations')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 ${
            activeSubTab === 'stations'
              ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Cpu className="w-4 h-4 text-blue-400" />
          <span>Stations</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">{stations.length}</span>
        </button>

        <button
          onClick={() => setActiveSubTab('channels')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 ${
            activeSubTab === 'channels'
              ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Radio className="w-4 h-4" />
          <span>Hardware Channels</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">{channels.length}</span>
        </button>

        <button
          onClick={() => setActiveSubTab('buyers')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold font-display rounded-t-xl transition-all border-b-2 ${
            activeSubTab === 'buyers'
              ? 'border-blue-500 text-blue-400 bg-slate-900/80 shadow-inner'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Buyers</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">{buyers.length}</span>
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
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input
                  type="text"
                  placeholder="Optional notes or SLA details"
                  value={buyerForm.remark}
                  onChange={e => setBuyerForm({ ...buyerForm, remark: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {buyers.map(b => (
                    <tr key={b.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-3.5 text-slate-400 font-bold">#{b.id}</td>
                      <td className="p-3.5 font-bold text-white font-sans">{b.name}</td>
                      <td className="p-3.5 text-slate-400 font-sans">{b.remark || '—'}</td>
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
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input
                  type="text"
                  placeholder="Optional remark"
                  value={lineForm.remark}
                  onChange={e => setLineForm({ ...lineForm, remark: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {lines.map(l => (
                    <tr key={l.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-3.5 text-slate-400 font-bold">#{l.id}</td>
                      <td className="p-3.5 font-bold text-white font-sans">{l.name}</td>
                      <td className="p-3.5 text-slate-400 font-sans">{l.remark || '—'}</td>
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
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
                >
                  <option value="">-- Choose Assembly Line --</option>
                  {lines.map(l => (
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
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Remark</label>
                <input
                  type="text"
                  placeholder="Optional remark"
                  value={stationForm.remark}
                  onChange={e => setStationForm({ ...stationForm, remark: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {stations.map(s => (
                    <tr key={s.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-3.5 text-slate-400 font-bold">#{s.id}</td>
                      <td className="p-3.5 font-bold text-white font-sans">{s.name}</td>
                      <td className="p-3.5 text-slate-300 font-sans">{s.lineName}</td>
                      <td className="p-3.5 text-slate-400 font-sans">{s.remark || '—'}</td>
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
              <Plus className="w-4 h-4 text-blue-400" /> Add Hardware Channel
            </h3>
            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Select Station</label>
                <select
                  required
                  value={channelForm.stationId}
                  onChange={e => setChannelForm({ ...channelForm, stationId: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
                >
                  <option value="">-- Choose Inspection Station --</option>
                  {stations.map(s => (
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
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">IP Address</label>
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.120"
                  value={channelForm.ipAddress}
                  onChange={e => setChannelForm({ ...channelForm, ipAddress: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
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
                    <th className="p-3.5">Station</th>
                    <th className="p-3.5">IP Address</th>
                    <th className="p-3.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {channels.map(c => (
                    <tr key={c.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-3.5 text-slate-400 font-bold">#{c.id}</td>
                      <td className="p-3.5 font-bold text-white font-sans">{c.name}</td>
                      <td className="p-3.5 text-slate-300 font-sans">{c.stationName}</td>
                      <td className="p-3.5 text-blue-400 font-mono">{c.ipAddress || '127.0.0.1'}</td>
                      <td className="p-3.5 text-center">
                        <span className="badge badge-ok">ACTIVE</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
