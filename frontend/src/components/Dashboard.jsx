import React, { memo, useState, useEffect, useRef } from 'react';
import {
  Activity, CheckCircle, XCircle, TrendingUp, Radio,
  Sparkles, ShieldCheck, Clock, BarChart3,
  Search, Cpu, Target, ChevronRight, Eye, Layers, AlertTriangle,
  Factory, RefreshCw, Zap, Gauge, Filter, PieChart as PieIcon,
  TrendingDown, DollarSign, Calendar
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Bar, Line, ComposedChart
} from 'recharts';
import { ProductionApi } from '../services/api';

const FrozenChart = memo(
  function FrozenChart({ children }) { return children; },
  (previous, next) => previous.version === next.version
);

// Use internationally recognizable compact suffixes (K/M/B). The vi-VN
// formatter emits "N" for "nghìn", which is ambiguous on a bilingual UI.
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function Dashboard({
  summary,
  hourlyStats = [],
  lines = [],
  stations = [],
  startDate,
  endDate,
  onFilterChange,
  productionLoadInfo
}) {
  const toProductionClockIso = (date) => new Date(Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()
  )).toISOString();
  const [selectedTimeRange, setSelectedTimeRange] = useState('today');
  const [selectedLineId, setSelectedLineId] = useState('');
  const [lineYieldData, setLineYieldData] = useState([]);
  const [stationYieldData, setStationYieldData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chartLoadInfo, setChartLoadInfo] = useState({ durationMs: null, requests: {} });
  const [qualityModes, setQualityModes] = useState(null);
  const [worstData, setWorstData] = useState(null);
  const latestHourlyStatsRef = useRef(hourlyStats);
  const latestSummaryRef = useRef(summary);
  const forceNextChartUpdateRef = useRef(true);
  const [chartHourlyStats, setChartHourlyStats] = useState(hourlyStats);
  const [chartSummary, setChartSummary] = useState(summary);

  useEffect(() => {
    latestSummaryRef.current = summary;
  }, [summary]);

  useEffect(() => {
    latestHourlyStatsRef.current = hourlyStats;
    if (forceNextChartUpdateRef.current && hourlyStats !== chartHourlyStats) {
      setChartHourlyStats(hourlyStats);
      setChartSummary(latestSummaryRef.current);
      forceNextChartUpdateRef.current = false;
    }
  }, [hourlyStats, chartHourlyStats]);

  // Helper to get ISO date range based on quick range string
  const calculateDateRange = (timeRangeKey) => {
    if (!timeRangeKey || timeRangeKey === 'all') return { sDate: null, eDate: null };
    const now = new Date();
    let eDate = now;
    let sDate;
    if (timeRangeKey === 'today') {
      sDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      eDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (timeRangeKey === 'week') {
      const daysSinceMonday = (now.getDay() + 6) % 7;
      sDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
      eDate = new Date(
        sDate.getFullYear(), sDate.getMonth(), sDate.getDate() + 6,
        23, 59, 59, 999
      );
    } else if (timeRangeKey === 'month') {
      sDate = new Date(now.getFullYear(), now.getMonth(), 1);
      eDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (timeRangeKey === 'year') {
      sDate = new Date(now.getFullYear(), 0, 1);
      eDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else {
      return { sDate: null, eDate: null };
    }
    return { sDate: toProductionClockIso(sDate), eDate: toProductionClockIso(eDate) };
  };

  const applyStationYields = (stationYields) => {
    const lineMap = new Map();
    (stationYields || []).forEach(station => {
      const key = station.lineId || 0;
      const current = lineMap.get(key) || { lineId: key, lineName: station.lineName || `Line ${key}`, total: 0, ok: 0, ng: 0 };
      current.total += station.total || 0;
      current.ok += station.ok || 0;
      current.ng += station.ng || 0;
      lineMap.set(key, current);
    });
    const lineYields = [...lineMap.values()].map(line => ({ ...line,
      yieldRate: line.total > 0 ? line.ok / line.total * 100 : 0 }));
    setLineYieldData(lineYields);
    setStationYieldData(stationYields || []);
  };

  // Load the line / station charts, the NTF-RTY cards and the Worst panel. Each one is shown as
  // soon as its own request returns: NTF / RTY over a month takes a few seconds and must not
  // hold back the charts. Responses of an older filter are dropped.
  const backendRequestRef = useRef(0);
  const fetchBackendData = async (lineId, sDate, eDate) => {
    const requestId = ++backendRequestRef.current;
    const from = sDate || startDate;
    const to = eDate || endDate;
    setIsLoading(true);
    const loadStarted = performance.now();
    const requests = {};
    const timed = async (name, request, apply) => {
      const started = performance.now();
      try {
        const data = await request();
        if (requestId === backendRequestRef.current) apply(data);
      } catch (err) {
        console.error(`Failed to fetch dashboard ${name}:`, err);
      } finally {
        requests[name] = performance.now() - started;
      }
    };
    await Promise.all([
      timed('station', () => ProductionApi.getStationYieldStats(lineId || null, from, to), applyStationYields),
      timed('worst', () => ProductionApi.getDashboardWorst(lineId || null, from, to), setWorstData),
      timed('qualityModes', () => ProductionApi.getQualityModes(lineId || null, null, from, to), setQualityModes),
    ]);
    if (requestId !== backendRequestRef.current) return;
    setChartLoadInfo({ durationMs: performance.now() - loadStarted, requests: { ...requests } });
    setIsLoading(false);
  };

  useEffect(() => {
    const lId = selectedLineId ? parseInt(selectedLineId) : null;
    fetchBackendData(lId, startDate, endDate);
  }, [selectedLineId, startDate, endDate]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setChartHourlyStats(latestHourlyStatsRef.current);
      setChartSummary(latestSummaryRef.current);
      fetchBackendData(selectedLineId ? parseInt(selectedLineId) : null, startDate, endDate);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [selectedLineId, startDate, endDate]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const requestId = backendRequestRef.current;
      try {
        const data = await ProductionApi.getQualityModes(selectedLineId ? parseInt(selectedLineId) : null, null, startDate, endDate);
        if (requestId === backendRequestRef.current) setQualityModes(data);
      } catch (err) {
        console.warn('NTF / RTY refresh failed:', err);
      }
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [selectedLineId, startDate, endDate]);


  const handleTimeRangeChange = (rangeKey) => {
    forceNextChartUpdateRef.current = true;
    setSelectedTimeRange(rangeKey);
    const { sDate, eDate } = calculateDateRange(rangeKey);
    const lId = selectedLineId ? parseInt(selectedLineId) : null;
    if (onFilterChange) {
      onFilterChange(lId, null, sDate, eDate);
    }
  };

  useEffect(() => {
    if (startDate || endDate || !onFilterChange) return;
    const { sDate, eDate } = calculateDateRange('today');
    const lId = selectedLineId ? parseInt(selectedLineId) : null;
    onFilterChange(lId, null, sDate, eDate);
  }, []);

  const handleLineSelect = (e) => {
    forceNextChartUpdateRef.current = true;
    const val = e.target.value;
    setSelectedLineId(val);
    if (onFilterChange) {
      onFilterChange(val ? parseInt(val) : null, null, startDate, endDate);
    }
  };

  // Retest card: live counters (summary is refreshed every 5 s and by SignalR).
  const totalInspected = summary?.totalInspected || 0;
  const totalOk = summary?.totalOk || 0;
  const totalNg = summary?.totalNg || 0;
  const passPct = totalInspected > 0 ? ((totalOk / totalInspected) * 100).toFixed(2) : '0.00';
  const retestDefectPct = totalInspected > 0 ? ((totalNg / totalInspected) * 100).toFixed(2) : '0.00';

  // 1. Time-series data formatted automatically per selectedTimeRange
  const getTimeSeriesData = () => {
    if (!chartHourlyStats || chartHourlyStats.length === 0) return [];

    const periodMap = new Map();
    const currentProductionClock = new Date(toProductionClockIso(new Date())).getTime();
    chartHourlyStats.forEach(stat => {
      const date = new Date(stat.bucket);
      if (Number.isNaN(date.getTime())) return;
      // Counters cover the complete selected calendar period, but the trend
      // must stop at the current clock time and never draw future buckets.
      if (date.getTime() > currentProductionClock) return;
      if (selectedTimeRange === 'today') {
        const now = new Date();
        if (date.getUTCFullYear() !== now.getFullYear()
          || date.getUTCMonth() !== now.getMonth()
          || date.getUTCDate() !== now.getDate()) return;
      }
      let key;
      let label;
      if (selectedTimeRange === 'today') {
        key = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
        label = `${String(date.getUTCHours()).padStart(2, '0')}:00`;
      } else if (selectedTimeRange === 'year') {
        key = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
        label = `T${date.getUTCMonth() + 1}`;
      } else {
        key = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
        label = `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      }
      if (!periodMap.has(key)) periodMap.set(key, { label, ok: 0, ng: 0, total: 0 });
      const bucket = periodMap.get(key);
      bucket.ok += stat.okCount || 0;
      bucket.ng += stat.ngCount || 0;
      bucket.total += stat.totalCount || stat.total || ((stat.okCount || 0) + (stat.ngCount || 0));
    });

    const formatted = [...periodMap.entries()].sort((a, b) => a[0] - b[0]).map(([, period]) => {
      const ok = period.ok;
      const ng = period.ng;
      const total = period.total;
      const yieldRate = total > 0 ? parseFloat(((ok / total) * 100).toFixed(1)) : 0;
      const defectRate = total > 0 ? parseFloat(((ng / total) * 100).toFixed(2)) : 0;
      return {
        time: period.label,
        OK: ok,
        NG: ng,
        Total: total,
        Yield: yieldRate,
        DefectRate: defectRate
      };
    });

    return formatted;
  };

  const timeSeriesData = getTimeSeriesData();


  // 4b. Line Production Volume & Pass Rate Data (Sorted Ascending)
  const lineVolumePassData = (() => {
    const raw = (lineYieldData && lineYieldData.length > 0) ? lineYieldData.map(l => {
      const total = l.total || (l.okCount || 0) + (l.ngCount || 0) || (l.ok || 0) + (l.ng || 0);
      const ok = l.okCount !== undefined ? l.okCount : (l.ok !== undefined ? l.ok : 0);
      const ng = l.ngCount !== undefined ? l.ngCount : (l.ng !== undefined ? l.ng : 0);
      const passRate = l.yieldRate !== undefined ? parseFloat(l.yieldRate.toFixed(1)) : (total > 0 ? parseFloat(((ok / total) * 100).toFixed(1)) : 0);
      return {
        lineName: l.lineName || `Line ${l.lineId}`,
        Total: total,
        OK: ok,
        NG: ng,
        Yield: passRate
      };
    }) : [];

    return [...raw].sort((a, b) =>
      a.lineName.localeCompare(b.lineName, undefined, { numeric: true, sensitivity: 'base' })
    );
  })();

  // 4c. Top 10 Stations with Lowest Pass Rate Data (Real Data)
  const stationVolumePassData = (() => {
    const raw = (stationYieldData && stationYieldData.length > 0) ? stationYieldData.map(s => {
      const total = s.total;
      const passRate = parseFloat(s.yieldRate.toFixed(1));
      const stName = s.stationName || `Station ${s.stationId}`;
      const lineName = s.lineName || (s.lineId ? `Line ${s.lineId}` : '');
      const displayName = lineName ? `${stName} (${lineName})` : stName;
      return {
        stationName: displayName,
        rawStationName: stName,
        lineName: lineName,
        Total: total,
        OK: s.ok,
        NG: s.ng,
        Yield: passRate
      };
    }) : [];

    return [...raw].sort((a, b) => a.Yield - b.Yield).slice(0, 10);
  })();

  return (
    <div className="space-y-4 w-full animate-in fade-in duration-300 font-sans pb-8">

      {/* TOOLBAR / HEADER CONTROL ROW */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex items-center bg-slate-100 border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-700 gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-600" />
            <span className="text-slate-600">Thời gian:</span>
            <select
              value={selectedTimeRange}
              onChange={(e) => handleTimeRangeChange(e.target.value)}
              className="bg-transparent text-slate-900 font-medium focus:outline-none cursor-pointer"
            >
              <option value="today" className="bg-slate-100">Hôm nay</option>
              <option value="week" className="bg-slate-100">Tuần này</option>
              <option value="month" className="bg-slate-100">Tháng này</option>
              <option value="year" className="bg-slate-100">Năm nay</option>
            </select>
          </div>

          {/* Line Selector */}
          <select
            value={selectedLineId}
            onChange={handleLineSelect}
            className="bg-slate-100 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-purple-500 font-sans"
          >
            <option value="">Tất cả chuyền ({lines.length})</option>
            {[...lines].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })).map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <button
            onClick={() => {
              setChartHourlyStats(latestHourlyStatsRef.current);
              setChartSummary(latestSummaryRef.current);
              fetchBackendData(selectedLineId ? parseInt(selectedLineId) : null, startDate, endDate);
            }}
            className="p-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
            title={`Tải lại dữ liệu\n${loadTimeText('Tổng quan', productionLoadInfo?.loading, productionLoadInfo?.durationMs, productionLoadInfo?.requests)}\n${loadTimeText('Line/Station', isLoading, chartLoadInfo.durationMs, chartLoadInfo.requests)}`}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading || productionLoadInfo?.loading ? 'animate-spin text-purple-700' : ''}`} />
          </button>
        </div>
      </div>

      {/* Retest = every test attempt (live, refreshed every 5 s with the production counters);
          NTF / RTY over the PID summaries (refreshed every 60 s). They replace the Production Overview cards. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="glass-panel border border-violet-500/20 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-700">
                Retest <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>LIVE</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">Mỗi lần test được tính là một lượt</div>
            </div>
            <RefreshCw className="h-5 w-5 text-violet-700"/>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-black text-violet-700">{retestDefectPct}%</span>
            <span className="text-xs text-slate-500">NG</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div><div className="text-[10px] text-slate-500">Lượt test</div><div className="font-mono font-bold text-slate-900" title={totalInspected.toLocaleString()}>{totalInspected.toLocaleString()}</div></div>
            <div><div className="text-[10px] text-slate-500">OK · {passPct}%</div><div className="font-mono font-bold text-emerald-700">{totalOk.toLocaleString()}</div></div>
            <div><div className="text-[10px] text-slate-500">NG</div><div className="font-mono font-bold text-rose-700">{totalNg.toLocaleString()}</div></div>
          </div>
        </div>
        <div className="glass-panel border border-rose-500/20 p-4">
          <div className="flex items-start justify-between"><div><div className="text-xs font-bold uppercase tracking-wider text-rose-700">NTF</div><div className="mt-1 text-[11px] text-slate-500">PID-Station test lần đầu trong kỳ, từng NG tại Station đó</div></div><AlertTriangle className="h-5 w-5 text-rose-700"/></div>
          <div className="mt-3 text-3xl font-black text-rose-700">{qualityModes ? `${Number(qualityModes.ntfRate).toFixed(2)}%` : '—'}</div>
          <div className="mt-2 text-xs text-slate-600">{qualityModes ? `${Number(qualityModes.ntfNgPcbStations).toLocaleString()} NG / ${Number(qualityModes.ntfPcbStations).toLocaleString()} PID-Station` : 'Đang tính lịch sử PCB...'}</div>
          <div className="mt-1 text-[10px] text-slate-400">Cập nhật mỗi 60 giây</div>
        </div>
        <div className="glass-panel border border-emerald-500/20 p-4">
          <div className="flex items-start justify-between"><div><div className="text-xs font-bold uppercase tracking-wider text-emerald-700">RTY</div><div className="mt-1 text-[11px] text-slate-500">{selectedLineId ? 'PID test lần đầu trên line trong kỳ, không NG ở station nào của line' : 'PID test lần đầu trong kỳ, không NG lần nào trên toàn hệ thống'}</div></div><Zap className="h-5 w-5 text-emerald-700"/></div>
          <div className="mt-3 text-3xl font-black text-emerald-700">{qualityModes ? `${Number(qualityModes.rtyRate).toFixed(2)}%` : '—'}</div>
          <div className="mt-2 text-xs text-slate-600">{qualityModes ? `${Number(qualityModes.rtyStraightThroughPcbs).toLocaleString()} chạy thẳng / ${Number(qualityModes.rtyPcbs).toLocaleString()} PCB` : 'Đang tính lịch sử PCB...'}</div>
          <div className="mt-1 text-[10px] text-slate-400">Cập nhật mỗi 60 giây</div>
        </div>
      </div>

      <WorstPanel worst={worstData} loading={isLoading} />

      {/* SECTION 2: INCIDENTS AND INJURIES OVERVIEW (3 CHARTS ROW) */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 font-display">
          Sản Lượng &amp; Tỉ Lệ Pass
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Chart 1: Pass Rate & Output Volume Trend over time */}
          <div className="glass-panel p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-display">
                Sản Lượng &amp; Tỉ Lệ Pass Theo Thời Gian
              </h4>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Sản Lượng</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> Tỉ Lệ Pass %</span>
              </div>
            </div>

            <div className="h-56 w-full pt-2">
              <FrozenChart version={chartHourlyStats}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={timeSeriesData} margin={{ top: 10, right: 10, left: -20, bottom: 15 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="time"
                    stroke="#475569"
                    fontSize={9}
                    tickLine={false}
                    angle={-35}
                    textAnchor="end"
                    height={35}
                    interval={selectedTimeRange === 'today' ? 1 : 0}
                  />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#047857" fontSize={10} tickLine={false} unit="%" domain={[80, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '12px', fontSize: '11px' }}
                    formatter={(value, name) => {
                      if (name === "Tỉ lệ Pass (%)") return [`${value}%`, name];
                      return [value.toLocaleString(), name];
                    }}
                  />
                  <Bar yAxisId="left" dataKey="Total" name="Sản lượng" fill="#8b5cf6" opacity={0.85} radius={[4, 4, 0, 0]} barSize={18} />
                  <Line yAxisId="right" type="monotone" dataKey="Yield" name="Tỉ lệ Pass (%)" stroke="#047857" strokeWidth={2.5} dot={{ r: 3, fill: '#047857' }} />
                </ComposedChart>
              </ResponsiveContainer>
              </FrozenChart>
            </div>
          </div>

          {/* Chart 2: Production Volume & Pass Rate by Line Chart */}
          <div className="glass-panel p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-display">
                Sản Lượng &amp; Tỉ Lệ Pass Theo Line
              </h4>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-500"></span> Sản Lượng</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400"></span> Tỉ Lệ Pass %</span>
              </div>
            </div>

            <div className="h-56 w-full pt-2">
              <FrozenChart version={lineYieldData}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={lineVolumePassData} margin={{ top: 10, right: 10, left: -15, bottom: 15 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="lineName"
                    stroke="#475569"
                    fontSize={9}
                    tickLine={false}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={35}
                  />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#7e22ce" fontSize={10} tickLine={false} unit="%" domain={[85, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '12px', fontSize: '11px' }}
                    formatter={(value, name) => {
                      if (name === "Tỉ lệ Pass (%)") return [`${value}%`, name];
                      return [typeof value === 'number' ? value.toLocaleString() : value, name];
                    }}
                  />
                  <Bar yAxisId="left" dataKey="Total" name="Sản lượng" fill="#06b6d4" opacity={0.85} radius={[4, 4, 0, 0]} barSize={22} />
                  <Line yAxisId="right" type="monotone" dataKey="Yield" name="Tỉ lệ Pass (%)" stroke="#7e22ce" strokeWidth={2.5} dot={{ r: 4, fill: '#7e22ce' }} />
                </ComposedChart>
              </ResponsiveContainer>
              </FrozenChart>
            </div>
          </div>

          {/* Chart 3: Top 10 Stations with Lowest Pass Rate */}
          <div className="glass-panel p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-display">
                Sản Lượng &amp; Tỉ Lệ Pass Theo Station (Top 10 Thấp Nhất)
              </h4>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Sản Lượng</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400"></span> Tỉ Lệ Pass %</span>
              </div>
            </div>

            <div className="h-56 w-full pt-2">
              <FrozenChart version={stationYieldData}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={stationVolumePassData} margin={{ top: 10, right: 10, left: -15, bottom: 15 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="stationName"
                    stroke="#475569"
                    fontSize={9}
                    tickLine={false}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={45}
                  />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#be123c" fontSize={10} tickLine={false} unit="%" domain={[80, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '12px', fontSize: '11px' }}
                    formatter={(value, name) => {
                      if (name === "Tỉ lệ Pass (%)") return [`${value}%`, name];
                      return [typeof value === 'number' ? value.toLocaleString() : value, name];
                    }}
                  />
                  <Bar yAxisId="left" dataKey="Total" name="Sản lượng" fill="#f59e0b" opacity={0.85} radius={[4, 4, 0, 0]} barSize={18} />
                  <Line yAxisId="right" type="monotone" dataKey="Yield" name="Tỉ lệ Pass (%)" stroke="#be123c" strokeWidth={2.5} dot={{ r: 4, fill: '#be123c' }} />
                </ComposedChart>
              </ResponsiveContainer>
              </FrozenChart>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}

const formatPct = (value, digits = 2) => `${Number(value || 0).toFixed(digits)}%`;
const formatDay = (isoDay) => {
  if (!isoDay) return '';
  const [y, m, d] = isoDay.split('-');
  return `${d}/${m}/${y}`;
};

// Worst panel: the 5 channels (jigs) with the most NG above the average NG rate of the period.
function WorstPanel({ worst, loading }) {
  const todayIso = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();
  const recentLabel = worst?.recentDay === todayIso ? 'Hôm nay' : formatDay(worst?.recentDay);
  const items = worst?.jigs || [];
  const maxRate = Math.max(1, ...items.map(x => x.ngRate));

  return (
    <div className="glass-panel p-5 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-rose-700" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 font-display">Top 5 Channel tệ nhất</h4>
        </div>
        <span className="text-[10px] text-slate-500">
          {worst ? `NG trung bình kỳ: ${formatPct(worst.ngRate)} · Xếp theo số NG vượt mức trung bình` : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="py-4 text-center text-[11px] text-slate-500">
          {loading && !worst ? 'Đang tải...' : 'Không có channel nào xấu hơn trung bình'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="w-6 py-2 font-semibold">#</th>
                <th className="py-2 pr-3 font-semibold">Channel</th>
                <th className="py-2 pr-3 font-semibold">IP</th>
                <th className="py-2 pr-3 font-semibold">Station</th>
                <th className="py-2 pr-3 font-semibold">Line</th>
                <th className="py-2 pr-3 font-semibold">Lỗi chính (NG · % NG của channel)</th>
                <th className="py-2 text-right font-semibold">NG / Tổng</th>
                <th className="w-40 py-2 pl-4 font-semibold">Tỉ lệ NG</th>
                <th className="py-2 text-right font-semibold">{recentLabel} / 7 ngày trước</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((item, index) => (
                <tr key={item.key}>
                  <td className="py-1.5 font-mono font-bold text-slate-400">{index + 1}</td>
                  <td className="py-1.5 pr-3 font-semibold text-slate-900">{item.name}</td>
                  <td className="py-1.5 pr-3 font-mono text-slate-600">{item.ip || '—'}</td>
                  <td className="py-1.5 pr-3 text-slate-700">{item.stationName || '—'}</td>
                  <td className="py-1.5 pr-3 text-slate-700">{item.lineName || '—'}</td>
                  <td className="py-1.5 pr-3">
                    {/* One line to keep the page on one screen; every top error is in the tooltip. */}
                    {(item.topErrors || []).length === 0 ? '—' : (
                      <div className="flex items-baseline gap-2"
                        title={item.topErrors.map(err => `${err.errorCode}: ${err.ng.toLocaleString()} NG (${formatPct(err.shareOfItemNg, 1)})`).join('\n')}>
                        <span className="max-w-[260px] truncate font-semibold text-rose-700">{item.topErrors[0].errorCode}</span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">{item.topErrors[0].ng.toLocaleString()} · {formatPct(item.topErrors[0].shareOfItemNg, 1)}</span>
                        {item.topErrors.length > 1 && <span className="shrink-0 rounded bg-slate-200 px-1 text-[9px] text-slate-600">+{item.topErrors.length - 1}</span>}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono text-slate-700">
                    {item.ng.toLocaleString()} / {item.total.toLocaleString()}
                  </td>
                  <td className="py-1.5 pl-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded bg-slate-200">
                        <div className="h-1.5 rounded bg-rose-500" style={{ width: `${Math.min(100, item.ngRate / maxRate * 100)}%` }} />
                      </div>
                      <span className="w-12 text-right font-mono font-bold text-rose-700">{formatPct(item.ngRate)}</span>
                    </div>
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    <span className={item.spike ? 'font-bold text-rose-700' : 'text-slate-700'}>{formatPct(item.recentNgRate)}</span>
                    <span className="text-slate-400"> / {formatPct(item.baselineNgRate)}</span>
                    {item.spike && <span className="ml-1.5 rounded bg-rose-600 px-1 text-[9px] font-bold text-white">↑ TĂNG</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Load times are technical details: shown in the refresh button tooltip instead of on the page.
function loadTimeText(label, loading, value, details = {}) {
  const detailText = Object.entries(details || {}).map(([key, ms]) => `${key} ${(ms / 1000).toFixed(2)}s`).join(', ');
  const total = loading ? 'đang tải...' : value == null ? '—' : `${(value / 1000).toFixed(2)}s`;
  return `${label}: ${total}${detailText ? ` (${detailText})` : ''}`;
}

export default memo(Dashboard);
