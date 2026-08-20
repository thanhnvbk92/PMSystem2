import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import {
  Activity, CheckCircle, XCircle, TrendingUp, Radio,
  Sparkles, ShieldCheck, Clock, BarChart3,
  Search, Cpu, Target, ChevronRight, Eye, Layers, AlertTriangle,
  Factory, RefreshCw, Zap, Gauge, Filter, PieChart as PieIcon,
  TrendingDown, DollarSign, Calendar
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Bar, Line, PieChart, Pie, Cell, ComposedChart
} from 'recharts';
import { ProductionApi } from '../services/api';

const FrozenChart = memo(
  function FrozenChart({ children }) { return children; },
  (previous, next) => previous.version === next.version
);

const compactNumberFormatter = new Intl.NumberFormat('vi-VN', {
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
  const [selectedTimeRange, setSelectedTimeRange] = useState('today');
  const [selectedLineId, setSelectedLineId] = useState('');
  const [lineYieldData, setLineYieldData] = useState([]);
  const [stationYieldData, setStationYieldData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chartLoadInfo, setChartLoadInfo] = useState({ durationMs: null, requests: {} });
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
    let sDate;
    if (timeRangeKey === 'today') {
      sDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (timeRangeKey === 'week') {
      const daysSinceMonday = (now.getDay() + 6) % 7;
      sDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
    } else if (timeRangeKey === 'month') {
      sDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (timeRangeKey === 'year') {
      sDate = new Date(now.getFullYear(), 0, 1);
    } else {
      return { sDate: null, eDate: null };
    }
    return { sDate: sDate.toISOString(), eDate: now.toISOString() };
  };

  // Load backend stats used by the remaining line and station charts.
  const fetchBackendData = async (lineId, sDate, eDate) => {
    setIsLoading(true);
    const loadStarted = performance.now();
    try {
      const timed = async (name, request) => { const started = performance.now(); const data = await request(); return { name, data, durationMs: performance.now() - started }; };
      const results = await Promise.all([
        timed('station', () => ProductionApi.getStationYieldStats(lineId || null, sDate || startDate, eDate || endDate))
      ]);
      const byName = Object.fromEntries(results.map(x => [x.name, x]));
      const stationYields = byName.station.data;
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
      setLineYieldData(lineYields || []);
      setStationYieldData(stationYields || []);
      setChartLoadInfo({ durationMs: performance.now() - loadStarted,
        requests: Object.fromEntries(results.map(x => [x.name, x.durationMs])) });
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
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

  // KPI Metrics
  const totalInspected = summary?.totalInspected || 0;
  const totalOk = summary?.totalOk || 0;
  const totalNg = summary?.totalNg || 0;
  const yieldRate = summary?.overallYieldRate !== undefined 
    ? summary.overallYieldRate 
    : (totalInspected > 0 ? (totalOk / totalInspected) * 100 : 0);
  const passPct = totalInspected > 0 ? ((totalOk / totalInspected) * 100).toFixed(1) : '0.0';
  const defectPct = totalInspected > 0 ? ((totalNg / totalInspected) * 100).toFixed(1) : '0.0';
  const chartYieldRate = chartSummary?.overallYieldRate ?? yieldRate;

  // 1. Time-series data formatted automatically per selectedTimeRange
  const getTimeSeriesData = () => {
    if (!chartHourlyStats || chartHourlyStats.length === 0) return [];

    const periodMap = new Map();
    chartHourlyStats.forEach(stat => {
      const date = new Date(stat.bucket);
      if (Number.isNaN(date.getTime())) return;
      if (selectedTimeRange === 'today') {
        const now = new Date();
        if (date.getFullYear() !== now.getFullYear()
          || date.getMonth() !== now.getMonth()
          || date.getDate() !== now.getDate()) return;
      }
      let key;
      let label;
      if (selectedTimeRange === 'today') {
        key = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime();
        label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (selectedTimeRange === 'year') {
        key = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
        label = `T${date.getMonth() + 1}`;
      } else {
        key = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        label = date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
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

  // 3. Quality Compliance Score Donut Data
  const donutData = useMemo(() => [
    { name: 'Đạt Chuẩn (Pass)', value: parseFloat(chartYieldRate.toFixed(1)), color: '#8b5cf6' },
    { name: 'Phát Sinh Lỗi (Defect)', value: parseFloat((100 - chartYieldRate).toFixed(1)), color: '#334155' }
  ], [chartYieldRate]);

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
    <div className="space-y-7 w-full animate-in fade-in duration-300 font-sans pb-8">

      {/* TOOLBAR / HEADER CONTROL ROW */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-300 gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Thời gian:</span>
            <select
              value={selectedTimeRange}
              onChange={(e) => handleTimeRangeChange(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              <option value="today" className="bg-slate-900">Hôm nay</option>
              <option value="week" className="bg-slate-900">Tuần này</option>
              <option value="month" className="bg-slate-900">Tháng này</option>
              <option value="year" className="bg-slate-900">Năm nay</option>
            </select>
          </div>

          {/* Line Selector */}
          <select
            value={selectedLineId}
            onChange={handleLineSelect}
            className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-sans"
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
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Tải lại dữ liệu"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
          <LoadTimeBadge loading={productionLoadInfo?.loading} label="Tổng quan" value={productionLoadInfo?.durationMs} details={productionLoadInfo?.requests} />
          <LoadTimeBadge loading={isLoading} label="Line/Station" value={chartLoadInfo.durationMs} details={chartLoadInfo.requests} />
        </div>
      </div>

      {/* SECTION 1: INCIDENTS & PRODUCTION OVERVIEW (4 KPI CARDS + FUNNEL CHART) */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-display">
          Production Overview
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">

          {/* Card 1: Total Incident Costs / Inspected Volume */}
          <div className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-400 font-display">Tổng Sản Lượng Kiểm Tra</span>
            <div className="mt-3">
              <span className="text-3xl font-extrabold text-white font-mono tracking-tight">
                {compactNumberFormatter.format(totalInspected)}
              </span>
              <div className="flex items-center gap-2 mt-2 text-[11px] font-mono">
                <span className="text-emerald-400 font-semibold">Tự động</span>
                <span className="text-slate-400">cập nhật DB</span>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500"></div>
          </div>

          {/* Card 2: Passed OK Volume */}
          <div className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-400 font-display">Sản Phẩm Đạt Chuẩn (OK)</span>
            <div className="mt-3">
              <span className="text-3xl font-extrabold text-emerald-400 font-mono tracking-tight">
                {totalOk.toLocaleString()}
              </span>
              <div className="flex items-center gap-2 mt-2 text-[11px] font-mono">
                <span className="text-emerald-400 font-semibold">{passPct}%</span>
                <span className="text-slate-400">Pass Rate</span>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500"></div>
          </div>

          {/* Card 3: Defects Count */}
          <div className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-400 font-display">Sản Phẩm Lỗi (NG)</span>
            <div className="mt-3">
              <span className="text-3xl font-extrabold text-rose-400 font-mono tracking-tight">
                {totalNg.toLocaleString()}
              </span>
              <div className="flex items-center gap-2 mt-2 text-[11px] font-mono">
                <span className="text-rose-400 font-semibold">-{defectPct}%</span>
                <span className="text-slate-400">Defect Ratio</span>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-rose-500"></div>
          </div>

          {/* Card 4: First Pass Yield Rate */}
          <div className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-400 font-display">Tỷ Lệ Yield Thật (FPY)</span>
            <div className="mt-3">
              <span className="text-3xl font-extrabold text-purple-300 font-mono tracking-tight">
                {yieldRate.toFixed(1)}%
              </span>
              <div className="flex items-center gap-2 mt-2 text-[11px] font-mono">
                <span className="text-purple-400 font-semibold">{passPct}%</span>
                <span className="text-slate-400">Tỷ lệ Đạt</span>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-500"></div>
          </div>

          {/* Card 5: Quality Compliance Score */}
          <div className="glass-panel p-4 flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-400 font-display text-center">
              Chỉ Số Tuân Thủ Chất Lượng
            </span>
            <div className="h-24 w-full relative flex items-center justify-center">
              <FrozenChart version={chartSummary}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={28}
                      outerRadius={40}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </FrozenChart>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-extrabold text-purple-300 font-mono tracking-tight">
                  {chartYieldRate.toFixed(0)}%
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* SECTION 2: INCIDENTS AND INJURIES OVERVIEW (3 CHARTS ROW) */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-display">
          Incidents and Quality Overview
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Chart 1: Pass Rate & Output Volume Trend over time */}
          <div className="glass-panel p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-display">
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="time"
                    stroke="#94a3b8"
                    fontSize={9}
                    tickLine={false}
                    angle={-35}
                    textAnchor="end"
                    height={35}
                    interval={selectedTimeRange === 'today' ? 1 : 0}
                  />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#34d399" fontSize={10} tickLine={false} unit="%" domain={[80, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }}
                    formatter={(value, name) => {
                      if (name === "Tỉ lệ Pass (%)") return [`${value}%`, name];
                      return [value.toLocaleString(), name];
                    }}
                  />
                  <Bar yAxisId="left" dataKey="Total" name="Sản lượng" fill="#8b5cf6" opacity={0.85} radius={[4, 4, 0, 0]} barSize={18} />
                  <Line yAxisId="right" type="monotone" dataKey="Yield" name="Tỉ lệ Pass (%)" stroke="#34d399" strokeWidth={2.5} dot={{ r: 3, fill: '#34d399' }} />
                </ComposedChart>
              </ResponsiveContainer>
              </FrozenChart>
            </div>
          </div>

          {/* Chart 2: Production Volume & Pass Rate by Line Chart */}
          <div className="glass-panel p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-display">
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="lineName"
                    stroke="#94a3b8"
                    fontSize={9}
                    tickLine={false}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={35}
                  />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#c084fc" fontSize={10} tickLine={false} unit="%" domain={[85, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }}
                    formatter={(value, name) => {
                      if (name === "Tỉ lệ Pass (%)") return [`${value}%`, name];
                      return [typeof value === 'number' ? value.toLocaleString() : value, name];
                    }}
                  />
                  <Bar yAxisId="left" dataKey="Total" name="Sản lượng" fill="#06b6d4" opacity={0.85} radius={[4, 4, 0, 0]} barSize={22} />
                  <Line yAxisId="right" type="monotone" dataKey="Yield" name="Tỉ lệ Pass (%)" stroke="#c084fc" strokeWidth={2.5} dot={{ r: 4, fill: '#c084fc' }} />
                </ComposedChart>
              </ResponsiveContainer>
              </FrozenChart>
            </div>
          </div>

          {/* Chart 3: Top 10 Stations with Lowest Pass Rate */}
          <div className="glass-panel p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-display">
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="stationName"
                    stroke="#94a3b8"
                    fontSize={9}
                    tickLine={false}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={45}
                  />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#fb7185" fontSize={10} tickLine={false} unit="%" domain={[80, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }}
                    formatter={(value, name) => {
                      if (name === "Tỉ lệ Pass (%)") return [`${value}%`, name];
                      return [typeof value === 'number' ? value.toLocaleString() : value, name];
                    }}
                  />
                  <Bar yAxisId="left" dataKey="Total" name="Sản lượng" fill="#f59e0b" opacity={0.85} radius={[4, 4, 0, 0]} barSize={18} />
                  <Line yAxisId="right" type="monotone" dataKey="Yield" name="Tỉ lệ Pass (%)" stroke="#fb7185" strokeWidth={2.5} dot={{ r: 4, fill: '#fb7185' }} />
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

function LoadTimeBadge({ loading, label, value, details = {} }) {
  const detailText = Object.entries(details).map(([key, ms]) => `${key}: ${(ms / 1000).toFixed(2)}s`).join(' · ');
  return <span title={detailText || undefined} className={`rounded-lg border px-2.5 py-1.5 ${loading ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-900/70 text-slate-400'}`}>
    <Clock className={`mr-1 inline h-3 w-3 ${loading ? 'animate-pulse' : ''}`} />
    {label}: {loading ? 'đang tải...' : value == null ? '—' : `${(value / 1000).toFixed(2)}s`}
  </span>;
}

export default memo(Dashboard);
