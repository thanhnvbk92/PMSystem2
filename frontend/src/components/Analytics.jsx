import React, { memo, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  BarChart3, Layers, AlertTriangle, Cpu, Clock, 
  Sparkles, CheckCircle, ShieldCheck, Filter, RefreshCw, FileSpreadsheet, Download,
  Activity, XCircle, FileText, ChevronRight
} from 'lucide-react';
import { 
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, Legend, Cell, LineChart, Line, ComposedChart 
} from 'recharts';
import { ProductionApi } from '../services/api';

function Analytics({ lines, stations, channels = [], startDate, endDate, onFilterChange }) {
  // Global BI Filter States
  const [selectedLine, setSelectedLine] = useState('');
  const [selectedStation, setSelectedStation] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedErrorCode, setSelectedErrorCode] = useState('');
  const [selectedJobFile, setSelectedJobFile] = useState('');
  const [selectedHours, setSelectedHours] = useState(24);
  const [selectedTimeWindow, setSelectedTimeWindow] = useState(null);
  const analyticsRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - selectedHours * 60 * 60 * 1000);
    const format = (value) => value.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return { start, end, label: `${format(start)} → ${format(end)}` };
  }, [selectedHours]);

  // BI Data State from backend API getBiMatrix
  const [biData, setBiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadDurationMs, setLoadDurationMs] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportWarningModal, setExportWarningModal] = useState(null);

  // Fetch unified BI matrix data
  const fetchBiMatrix = async () => {
    setLoading(true);
    const loadStarted = performance.now();
    try {
      const lineId = selectedLine ? parseInt(selectedLine) : null;
      const stationId = selectedStation ? parseInt(selectedStation) : null;
      const channelId = selectedChannel ? parseInt(selectedChannel) : null;
      const errCode = selectedErrorCode || null;
      const job = selectedJobFile || null;

      const data = await ProductionApi.getBiMatrix(
        lineId, stationId, channelId, errCode, job,
        selectedTimeWindow?.start?.toISOString() || null,
        selectedTimeWindow?.end?.toISOString() || null,
        selectedHours
      );
      setBiData(data);
    } catch (err) {
      console.error('Lỗi nạp dữ liệu Power BI Matrix Analytics:', err);
    } finally {
      setLoadDurationMs(performance.now() - loadStarted);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBiMatrix();
  }, [selectedLine, selectedStation, selectedChannel, selectedErrorCode, selectedJobFile, selectedHours, selectedTimeWindow]);

  const handleLineChange = (val) => {
    setSelectedLine(val);
    setSelectedStation('');
    setSelectedChannel('');
    if (onFilterChange) onFilterChange(val ? parseInt(val) : null, null, startDate, endDate);
  };

  const handleStationChange = (val) => {
    setSelectedStation(val);
    setSelectedChannel('');
    if (onFilterChange) onFilterChange(selectedLine ? parseInt(selectedLine) : null, val ? parseInt(val) : null, startDate, endDate);
  };

  const handleChannelChange = (val) => {
    setSelectedChannel(val);
  };

  const handleErrorCodeChange = (val) => {
    setSelectedErrorCode(val);
  };

  const handleJobFileChange = (val) => {
    setSelectedJobFile(val);
  };

  const clearAllFilters = () => {
    setSelectedLine('');
    setSelectedStation('');
    setSelectedChannel('');
    setSelectedErrorCode('');
    setSelectedJobFile('');
    setSelectedHours(24);
    setSelectedTimeWindow(null);
    if (onFilterChange) onFilterChange(null, null, null, null);
  };

  const hasActiveFilters = selectedLine || selectedStation || selectedChannel || selectedErrorCode || selectedJobFile || selectedTimeWindow;

  const filteredStations = useMemo(() => {
    if (!selectedLine) return stations || [];
    return (stations || []).filter(s => s.lineId === parseInt(selectedLine));
  }, [stations, selectedLine]);

  const filteredChannels = useMemo(() => {
    let result = channels || [];
    if (selectedLine) {
      const lineStationIds = (stations || []).filter(s => s.lineId === parseInt(selectedLine)).map(s => s.id);
      result = result.filter(c => lineStationIds.includes(c.stationId));
    }
    if (selectedStation) {
      result = result.filter(c => c.stationId === parseInt(selectedStation));
    }
    return result;
  }, [channels, stations, selectedLine, selectedStation]);

  // Hourly trend data formatting
  const timeTrendChartData = useMemo(() => {
    if (!biData?.timeTrend) return [];
    const rangeEnd = new Date();
    const rangeStart = new Date(rangeEnd.getTime() - selectedHours * 60 * 60 * 1000);
    const scopedTrend = biData.timeTrend.filter(stat => {
      const bucket = new Date(stat.bucket);
      return !Number.isNaN(bucket.getTime()) && bucket >= rangeStart && bucket <= rangeEnd;
    });
    if (selectedHours <= 48) {
      return scopedTrend.map(stat => {
        const date = new Date(stat.bucket);
        return {
          time: selectedHours <= 24
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit' }),
          Total: stat.totalCount || 0, OK: stat.okCount, NG: stat.ngCount,
          DefectRate: stat.totalCount > 0 ? parseFloat((stat.ngCount / stat.totalCount * 100).toFixed(3)) : 0,
          bucketStart: date,
          bucketEnd: new Date(date.getTime() + 60 * 60 * 1000)
        };
      });
    }
    const daily = new Map();
    scopedTrend.forEach(stat => {
      const date = new Date(stat.bucket);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const item = daily.get(key) || { time: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }), Total: 0, OK: 0, NG: 0,
        bucketStart: dayStart, bucketEnd: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) };
      item.Total += stat.totalCount || 0;
      item.OK += stat.okCount || 0;
      item.NG += stat.ngCount || 0;
      daily.set(key, item);
    });
    return [...daily.values()].map(item => ({ ...item,
      DefectRate: item.Total > 0 ? parseFloat((item.NG / item.Total * 100).toFixed(3)) : 0 }));
  }, [biData, selectedHours]);

  const handleTimePointClick = (chartState) => {
    const point = chartState?.activePayload?.[0]?.payload;
    if (!point?.bucketStart || !point?.bucketEnd) return;
    const start = new Date(point.bucketStart);
    const end = new Date(point.bucketEnd);
    setSelectedTimeWindow({ start, end, label: selectedHours <= 48
      ? `${start.toLocaleString('vi-VN')} → ${end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
      : start.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) });
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    const lineId = selectedLine ? parseInt(selectedLine) : null;
    const stationId = selectedStation ? parseInt(selectedStation) : null;
    try {
      const count = await ProductionApi.getExportCount(lineId, stationId, null, null, startDate, endDate);
      if (count > 3000) {
        setExportWarningModal({ count, lineId, stationId });
      } else {
        await ProductionApi.downloadExportCsv(null, lineId, stationId, null, null, startDate, endDate);
      }
    } catch (err) {
      console.error('Lỗi xuất CSV:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const confirmDownloadAll = async () => {
    if (!exportWarningModal) return;
    const { lineId, stationId } = exportWarningModal;
    setExportWarningModal(null);
    setIsExporting(true);
    try {
      await ProductionApi.downloadExportCsv(null, lineId, stationId, null, null, startDate, endDate);
    } catch (err) {
      console.error('Lỗi xuất dữ liệu CSV:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-panel p-3.5 border border-slate-700/80 shadow-2xl text-xs space-y-2 min-w-[170px]">
          <p className="font-mono text-slate-400 border-b border-slate-700/60 pb-1 font-semibold">{label}</p>
          <div className="flex items-center justify-between text-emerald-400 font-semibold">
            <span>Pass (OK):</span>
            <span className="font-mono text-sm">{payload[0]?.value || 0}</span>
          </div>
          <div className="flex items-center justify-between text-rose-400 font-semibold">
            <span>Fail (NG):</span>
            <span className="font-mono text-sm">{payload[1]?.value || 0}</span>
          </div>
          {payload[2] && (
            <div className="flex items-center justify-between text-purple-300 font-semibold pt-1 border-t border-slate-800">
              <span>Tỷ lệ lỗi:</span>
              <span className="font-mono text-sm">{payload[2]?.value}%</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  // Line Chart Data (Sorted ascending by Line Name)
  const lineChartData = useMemo(() => {
    if (!biData?.lineStats) return [];
    return [...biData.lineStats]
      .sort((a, b) => (a.lineName || a.LineName || '').localeCompare(b.lineName || b.LineName || '', undefined, { numeric: true, sensitivity: 'base' }))
      .map(l => {
        const total = l.total ?? l.Total ?? l.totalInspected ?? 0;
        const ok = l.ok ?? l.Ok ?? l.okCount ?? 0;
        const ng = l.ng ?? l.Ng ?? l.ngCount ?? 0;
        const yieldRate = l.yieldRate ?? l.YieldRate ?? 0;
        const lineName = l.lineName ?? l.LineName ?? `Line ${l.lineId || l.LineId}`;
        return {
          lineId: l.lineId ?? l.LineId,
          displayName: lineName,
          Volume: total,
          OK: ok,
          NG: ng,
          Yield: parseFloat((yieldRate || 0).toFixed(2)),
          DefectRate: total > 0 ? parseFloat((ng / total * 100).toFixed(3)) : 0,
          raw: l
        };
      });
  }, [biData]);

  // Station Chart Data (Top 10 Lowest Yield Rate, with Line Name included)
  const stationChartData = useMemo(() => {
    if (!biData?.stationStats) return [];
    return biData.stationStats.map(s => {
      const total = s.total ?? s.Total ?? s.totalInspected ?? 0;
      const ok = s.ok ?? s.Ok ?? s.okCount ?? 0;
      const ng = s.ng ?? s.Ng ?? s.ngCount ?? 0;
      const yieldRate = s.yieldRate ?? s.YieldRate ?? 0;
      const stationName = s.stationName ?? s.StationName ?? `Station ${s.stationId || s.StationId}`;
      const lineName = s.lineName ?? s.LineName ?? `Line ${s.lineId || s.LineId}`;
      return {
        stationId: s.stationId ?? s.StationId,
        displayName: `${stationName} (${lineName})`,
        shortName: `${lineName.replace('Line ', 'L')}-${stationName}`,
        Volume: total,
        OK: ok,
        NG: ng,
        Yield: parseFloat((yieldRate || 0).toFixed(2)),
        DefectRate: total > 0 ? parseFloat((ng / total * 100).toFixed(3)) : 0,
        stationName,
        lineName,
        raw: s
      };
    }).sort((a, b) => b.DefectRate - a.DefectRate).slice(0, 10);
  }, [biData]);

  // Machine Chart Data (Top 10 Lowest Yield Rate, clearly formatted)
  const machineChartData = useMemo(() => {
    if (!biData?.machineStats) return [];
    return biData.machineStats.map(m => {
      const total = m.total ?? m.Total ?? m.totalInspected ?? 0;
      const ok = m.ok ?? m.Ok ?? m.okCount ?? 0;
      const ng = m.ng ?? m.Ng ?? m.ngCount ?? 0;
      const yieldRate = m.yieldRate ?? m.YieldRate ?? 0;
      const channelName = m.channelName ?? m.ChannelName ?? `Ch ${m.channelId || m.ChannelId}`;
      const stationName = m.stationName ?? m.StationName ?? 'Station';
      const lineName = m.lineName ?? m.LineName ?? 'Line';
      return {
        channelId: m.channelId ?? m.ChannelId,
        displayName: `${channelName} (${lineName})`,
        shortName: channelName,
        Volume: total,
        OK: ok,
        NG: ng,
        Yield: parseFloat((yieldRate || 0).toFixed(2)),
        DefectRate: total > 0 ? parseFloat((ng / total * 100).toFixed(3)) : 0,
        channelName,
        stationName,
        lineName,
        raw: m
      };
    }).sort((a, b) => b.DefectRate - a.DefectRate).slice(0, 10);
  }, [biData]);

  // Defect Chart Data (Top 10 Defects only)
  const defectChartData = useMemo(() => {
    if (!biData?.defectStats) return [];
    return biData.defectStats.slice(0, 10).map(d => ({
      code: d.code ?? d.Code ?? 'UNKNOWN',
      count: d.count ?? d.Count ?? 0,
      pct: d.pct ?? d.Pct ?? d.percentage ?? 0
    }));
  }, [biData]);

  const DualAxisTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="glass-panel p-3.5 border border-slate-700/80 shadow-2xl text-xs space-y-2 min-w-[190px]">
          <p className="font-mono text-slate-300 font-bold border-b border-slate-700/60 pb-1">
            {data.displayName || label}
          </p>
          {data.stationName && (
            <div className="text-[11px] text-slate-400">
              Trạm: <span className="text-white font-semibold">{data.stationName}</span> ({data.lineName})
            </div>
          )}
          <div className="flex items-center justify-between text-cyan-300 font-semibold">
            <span>Sản Lượng (Tổng):</span>
            <span className="font-mono text-sm">{data.Volume?.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-emerald-400 font-semibold">
            <span>Pass (OK):</span>
            <span className="font-mono text-sm">{data.OK?.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-rose-400 font-semibold">
            <span>Fail (NG):</span>
            <span className="font-mono text-sm">{data.NG?.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-purple-300 font-bold pt-1.5 border-t border-slate-800">
            <span>Tỷ lệ lỗi:</span>
            <span className="font-mono text-sm">{data.DefectRate}%</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 w-full animate-in fade-in duration-300">

      {document.getElementById('analytics-header-actions') && createPortal(<div className="flex flex-wrap items-center justify-end gap-2">
        <span className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-mono ${loading ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-900/70 text-slate-400'}`}>
          <Clock className={`mr-1 inline h-3 w-3 ${loading ? 'animate-pulse' : ''}`} />
          BI Matrix: {loading ? 'đang tải...' : loadDurationMs == null ? '—' : `${(loadDurationMs / 1000).toFixed(2)}s`}
        </span>
        <button
          onClick={fetchBiMatrix}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Làm mới
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center gap-1.5 transition-all"
          >
            <XCircle className="w-3.5 h-3.5" />
            Xóa Bộ Lọc Chéo
          </button>
        )}
        <button
          onClick={handleExportCsv}
          disabled={isExporting}
          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-md shadow-emerald-900/30 disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" />
          {isExporting ? 'Đang xuất...' : 'Xuất CSV'}
        </button>
      </div>, document.getElementById('analytics-header-actions'))}

      {/* GLOBAL POWER BI FILTER CONTROL PANEL */}
      <div className="glass-panel p-4 w-full space-y-3">
        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
          {/* 1. Line Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Dây Chuyền (Line)</label>
            <select
              value={selectedLine}
              onChange={(e) => handleLineChange(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Lines ({lines.length})</option>
              {[...lines].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* 2. Station Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Trạm (Station)</label>
            <select
              value={selectedStation}
              onChange={(e) => handleStationChange(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Trạm ({filteredStations.length})</option>
              {filteredStations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* 3. Machine / Channel Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Máy (Machine)</label>
            <select
              value={selectedChannel}
              onChange={(e) => handleChannelChange(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Máy ({filteredChannels.length})</option>
              {filteredChannels.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 4. Error Code Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Mã Lỗi (Defect)</label>
            <select
              value={selectedErrorCode}
              onChange={(e) => handleErrorCodeChange(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Mã Lỗi</option>
              {biData?.defectStats?.map(d => (
                <option key={d.code} value={d.code}>{d.code} ({d.count})</option>
              ))}
            </select>
          </div>

          {/* 5. Job File Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Job File</label>
            <select
              value={selectedJobFile}
              onChange={(e) => handleJobFileChange(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Job Files</option>
              {biData?.jobFileStats?.map(j => (
                <option key={j.jobFile} value={j.jobFile}>{j.jobFile}</option>
              ))}
            </select>
            {selectedJobFile && (
              <div className="mt-1 break-all rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[9px] font-mono leading-4 text-amber-300" title={selectedJobFile}>
                {selectedJobFile}
              </div>
            )}
          </div>

          {/* 6. Hours Interval Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Khung Thời Gian</label>
            <select
              value={selectedHours}
              onChange={(e) => {
                setSelectedHours(parseInt(e.target.value));
                setSelectedTimeWindow(null);
                setSelectedErrorCode('');
                setSelectedJobFile('');
              }}
              className="w-full bg-slate-950/90 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
            >
              <option value={12}>12 Giờ Gần Nhất</option>
              <option value={24}>24 Giờ Gần Nhất</option>
              <option value={48}>48 Giờ Gần Nhất</option>
              <option value={168}>7 Ngày Gần Nhất</option>
              <option value={720}>30 Ngày Gần Nhất</option>
            </select>
            <div className="mt-1 truncate text-[9px] font-mono text-cyan-400" title={analyticsRange.label}>
              {analyticsRange.label}
            </div>
          </div>
        </div>

        {/* Active Filter Indicators */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
            <span className="text-slate-400 font-semibold">Bộ lọc hiện tại:</span>
            {selectedLine && (
              <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                Line: {lines.find(l => l.id === parseInt(selectedLine))?.name}
                <button onClick={() => handleLineChange('')} className="hover:text-white">✕</button>
              </span>
            )}
            {selectedStation && (
              <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                Station: {stations.find(s => s.id === parseInt(selectedStation))?.name}
                <button onClick={() => handleStationChange('')} className="hover:text-white">✕</button>
              </span>
            )}
            {selectedChannel && (
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                Machine: {channels.find(c => c.id === parseInt(selectedChannel))?.name}
                <button onClick={() => handleChannelChange('')} className="hover:text-white">✕</button>
              </span>
            )}
            {selectedErrorCode && (
              <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                Code: {selectedErrorCode}
                <button onClick={() => handleErrorCodeChange('')} className="hover:text-white">✕</button>
              </span>
            )}
            {selectedJobFile && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                Job: {selectedJobFile}
                <button onClick={() => handleJobFileChange('')} className="hover:text-white">✕</button>
              </span>
            )}
            {selectedTimeWindow && (
              <span className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1">
                Thời gian: {selectedTimeWindow.label}
                <button onClick={() => setSelectedTimeWindow(null)} className="hover:text-white">✕</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* SECTION 1: TIME TREND (TOP OVERVIEW CHART) */}
      <div className="glass-panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">
              Xu Hướng Sản Lượng Theo Thời Gian ({selectedHours}h)
            </h3>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">TimescaleDB Aggregation</span>
        </div>

        <div className="h-72 w-full">
          {timeTrendChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeTrendChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} onClick={handleTimePointClick} className="cursor-pointer">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#fb7185" fontSize={11} tickLine={false} unit="%" />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Bar yAxisId="left" dataKey="OK" name="Pass (OK)" stackId="production" fill="#10b981" maxBarSize={30} />
                <Bar yAxisId="left" dataKey="NG" name="Fail (NG)" stackId="production" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#fb7185" strokeWidth={2.5} dot={{ r: 3, fill: '#fb7185' }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs">
              {loading ? 'Đang truy vấn dữ liệu sản xuất...' : 'Không có dữ liệu trong khoảng thời gian đã chọn.'}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: 3-COLUMN CORRELATION GRID (LINES, STATIONS, MACHINES) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Chart A: Line Yield Rate (Stacked Volume Bars OK+NG + Yield Rate Line) */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              Sản lượng & tỷ lệ lỗi theo Line
            </h4>
            <span className="text-[10px] text-slate-400 font-mono">Click cột để lọc Line</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className="flex items-center gap-1 text-rose-400"><span className="h-2.5 w-2.5 bg-red-500" /> Sản Lượng Fail (NG)</span>
            <span className="flex items-center gap-1 text-emerald-400"><span className="h-2.5 w-2.5 bg-emerald-500" /> Sản Lượng Pass (OK)</span>
            <span className="flex items-center gap-1 text-rose-400"><span className="h-0.5 w-3 bg-rose-400" /> Tỷ lệ lỗi (%)</span>
          </div>

          <div className="h-64 w-full">
            {lineChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={lineChartData} margin={{ top: 10, right: 15, left: -15, bottom: 42 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="displayName" stroke="#94a3b8" fontSize={10} tickLine={false} interval={0} angle={-15} textAnchor="end" />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#fb7185" fontSize={10} tickLine={false} unit="%" />
                  <Tooltip content={<DualAxisTooltip />} />
                  <Bar yAxisId="left" dataKey="OK" name="Sản Lượng Pass (OK)" stackId="a" fill="#10b981" maxBarSize={28} cursor="pointer" onClick={(item) => handleLineChange(item.payload.lineId.toString())} />
                  <Bar yAxisId="left" dataKey="NG" name="Sản Lượng Fail (NG)" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" onClick={(item) => handleLineChange(item.payload.lineId.toString())} />
                  <Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#fb7185" strokeWidth={2.5} dot={{ r: 3, fill: '#fb7185' }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chưa ghi nhận dữ liệu theo dây chuyền.
              </div>
            )}
          </div>
        </div>

        {/* Chart B: Station Yield Rate (Top 10 Lowest Yield Rate, Stacked Volume Bars OK+NG + Yield Line) */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              Top 10 Station (Tỷ lệ lỗi cao nhất)
            </h4>
            <span className="text-[10px] text-slate-400 font-mono">Click cột để lọc Trạm</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className="flex items-center gap-1 text-rose-400"><span className="h-2.5 w-2.5 bg-red-500" /> Sản Lượng Fail (NG)</span>
            <span className="flex items-center gap-1 text-emerald-400"><span className="h-2.5 w-2.5 bg-emerald-500" /> Sản Lượng Pass (OK)</span>
            <span className="flex items-center gap-1 text-rose-400"><span className="h-0.5 w-3 bg-rose-400" /> Tỷ lệ lỗi (%)</span>
          </div>

          <div className="h-64 w-full">
            {stationChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={stationChartData} margin={{ top: 10, right: 15, left: -15, bottom: 55 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="displayName" stroke="#94a3b8" fontSize={9} tickLine={false} interval={0} angle={-25} textAnchor="end" />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#fb7185" fontSize={10} tickLine={false} unit="%" />
                  <Tooltip content={<DualAxisTooltip />} />
                  <Bar yAxisId="left" dataKey="OK" name="Sản Lượng Pass (OK)" stackId="a" fill="#10b981" maxBarSize={28} cursor="pointer" onClick={(item) => handleStationChange(item.payload.stationId.toString())} />
                  <Bar yAxisId="left" dataKey="NG" name="Sản Lượng Fail (NG)" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" onClick={(item) => handleStationChange(item.payload.stationId.toString())} />
                  <Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#fb7185" strokeWidth={2.5} dot={{ r: 3, fill: '#fb7185' }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chưa ghi nhận dữ liệu theo trạm.
              </div>
            )}
          </div>
        </div>

        {/* Chart C: Machine / Channel Yield Rate (Top 10 Lowest Yield Rate, Stacked Volume Bars OK+NG + Yield Line) */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              Top 10 Máy (Tỷ lệ lỗi cao nhất)
            </h4>
            <span className="text-[10px] text-slate-400 font-mono">Click cột để lọc Máy</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className="flex items-center gap-1 text-rose-400"><span className="h-2.5 w-2.5 bg-red-500" /> Sản Lượng Fail (NG)</span>
            <span className="flex items-center gap-1 text-emerald-400"><span className="h-2.5 w-2.5 bg-emerald-500" /> Sản Lượng Pass (OK)</span>
            <span className="flex items-center gap-1 text-rose-400"><span className="h-0.5 w-3 bg-rose-400" /> Tỷ lệ lỗi (%)</span>
          </div>

          <div className="h-64 w-full">
            {machineChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={machineChartData} margin={{ top: 10, right: 15, left: -15, bottom: 55 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="displayName" stroke="#94a3b8" fontSize={9} tickLine={false} interval={0} angle={-25} textAnchor="end" />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#fb7185" fontSize={10} tickLine={false} unit="%" />
                  <Tooltip content={<DualAxisTooltip />} />
                  <Bar yAxisId="left" dataKey="OK" name="Sản Lượng Pass (OK)" stackId="a" fill="#10b981" maxBarSize={28} cursor="pointer" onClick={(item) => handleChannelChange(item.payload.channelId.toString())} />
                  <Bar yAxisId="left" dataKey="NG" name="Sản Lượng Fail (NG)" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" onClick={(item) => handleChannelChange(item.payload.channelId.toString())} />
                  <Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#fb7185" strokeWidth={2.5} dot={{ r: 3, fill: '#fb7185' }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chưa ghi nhận dữ liệu theo máy.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: 2-COLUMN GRID (DEFECT PARETO & JOB FILE STATISTICS) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left: Defect Code Pareto Chart (Top 10) */}
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h4 className="text-xs font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1.5 font-display">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              Top 10 Mã Lỗi (Defects Pareto)
            </h4>
            <span className="text-[10px] text-slate-400 font-mono">Click thanh lỗi để lọc</span>
          </div>

          <div className="h-72 w-full">
            {defectChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={defectChartData} margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" stroke="#64748b" fontSize={10} />
                  <YAxis type="category" dataKey="code" stroke="#94a3b8" fontSize={10} width={130} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(val, name, props) => [`${val} lượt (${props.payload.pct}%)`, 'Số Lỗi Phát Sinh']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20} cursor="pointer" onClick={(item) => handleErrorCodeChange(item.payload.code)}>
                    {defectChartData.map((entry, index) => (
                      <Cell 
                        key={`def-${index}`} 
                        fill={selectedErrorCode === entry.code ? '#f43f5e' : '#e11d48'} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-1">
                <CheckCircle className="w-7 h-7 text-emerald-500 mb-1" />
                <span>Không phát hiện lỗi sản xuất trong tập dữ liệu ma trận lọc!</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Job File Yield Statistics Table / Bar Chart */}
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5 font-display">
              <FileText className="w-4 h-4 text-amber-400" />
              Thống Kê Sản Lượng Theo Job File (Model)
            </h4>
            <span className="text-[10px] text-slate-400 font-mono">Click dòng để lọc Job</span>
          </div>

          <div className="h-72 w-full overflow-y-auto pr-1">
            {biData?.jobFileStats?.length > 0 ? (
              <div className="space-y-1.5">
                {biData.jobFileStats.map((job) => {
                  const jobFileName = job.jobFile ?? job.JobFile ?? 'Unknown Job';
                  const total = job.total ?? job.Total ?? job.totalInspected ?? 0;
                  const ok = job.ok ?? job.Ok ?? job.okCount ?? 0;
                  const ng = job.ng ?? job.Ng ?? job.ngCount ?? 0;
                  const yieldRate = job.yieldRate ?? job.YieldRate ?? 0;
                  const isSelected = selectedJobFile === jobFileName;

                  return (
                    <div 
                      key={jobFileName}
                      onClick={() => handleJobFileChange(jobFileName)}
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between cursor-pointer transition-all ${
                        isSelected 
                          ? 'bg-amber-500/20 border-amber-500/50 text-white shadow-md shadow-amber-500/10' 
                          : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="mr-3 flex min-w-0 flex-1 items-start gap-2" title={jobFileName}>
                        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-amber-400' : 'text-slate-400'}`} />
                        <span className="break-all font-mono font-semibold leading-4">{jobFileName}</span>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-4 font-mono text-[11px]">
                        <div>Total: <span className="text-white font-bold">{total.toLocaleString()}</span></div>
                        <div>OK: <span className="text-emerald-400">{ok.toLocaleString()}</span></div>
                        <div>NG: <span className="text-rose-400">{ng.toLocaleString()}</span></div>
                        <div className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                          yieldRate >= 98.5 ? 'bg-emerald-500/20 text-emerald-300' : yieldRate >= 95 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {yieldRate.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chưa ghi nhận dữ liệu theo Job File.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Large Data Warning Modal */}
      {exportWarningModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Cảnh Báo Dữ Liệu Lớn</h3>
                <p className="text-xs text-amber-400/90 font-mono">
                  Phát hiện {exportWarningModal.count.toLocaleString('vi-VN')} bản ghi
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              Hệ thống tìm thấy tổng cộng <strong className="text-amber-300 font-mono">{exportWarningModal.count.toLocaleString('vi-VN')}</strong> dòng dữ liệu sản xuất khớp với bộ lọc. 
              Việc tải toàn bộ dữ liệu có thể tốn vài giây xử lý. Bạn có muốn tiếp tục tải hết dữ liệu không?
            </p>

            <div className="bg-slate-950/60 p-3 rounded-xl border border-white/5 text-[11px] text-slate-400 space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span>Tổng số dòng:</span>
                <span className="text-white font-semibold">{exportWarningModal.count.toLocaleString('vi-VN')} dòng</span>
              </div>
              <div className="flex justify-between">
                <span>Dung lượng ước tính:</span>
                <span className="text-emerald-400 font-semibold">~{(exportWarningModal.count * 0.22 / 1024).toFixed(1)} MB</span>
              </div>
              <div className="flex justify-between">
                <span>Chế độ xuất:</span>
                <span className="text-amber-300 font-semibold">Không giới hạn (Export Full)</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setExportWarningModal(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors font-sans"
              >
                Hủy bỏ
              </button>
              <button
                onClick={confirmDownloadAll}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-bold transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 font-sans"
              >
                <Download className="w-4 h-4" />
                Vẫn Tải Tất Cả ({exportWarningModal.count.toLocaleString('vi-VN')} dòng)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(Analytics);
