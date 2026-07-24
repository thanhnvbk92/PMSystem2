import React, { useState, useEffect } from 'react';
import {
  Activity, CheckCircle, XCircle, TrendingUp, Radio,
  Sparkles, ShieldCheck, Clock, BarChart3,
  Search, Cpu, Target, ChevronRight, Eye, Layers, AlertTriangle,
  Factory, RefreshCw, Zap, Gauge, Filter, PieChart as PieIcon,
  TrendingDown, DollarSign, Calendar
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  Legend, ScatterChart, Scatter, ZAxis, ComposedChart
} from 'recharts';
import { ProductionApi } from '../services/api';

export default function Dashboard({
  summary,
  latestLogs,
  hourlyStats = [],
  lines = [],
  stations = [],
  onFilterChange
}) {
  const [selectedTimeRange, setSelectedTimeRange] = useState('24h');
  const [selectedLineId, setSelectedLineId] = useState('');
  const [defectParetoData, setDefectParetoData] = useState([]);
  const [lineYieldData, setLineYieldData] = useState([]);
  const [stationYieldData, setStationYieldData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load backend stats for Pareto, Line Yields & Station Yields
  const fetchBackendData = async (lineId) => {
    setIsLoading(true);
    try {
      const [pareto, lineYields, stationYields] = await Promise.all([
        ProductionApi.getDefectPareto(lineId || null, null),
        ProductionApi.getLineYieldStats(lineId || null),
        ProductionApi.getStationYieldStats(lineId || null)
      ]);
      setDefectParetoData(pareto || []);
      setLineYieldData(lineYields || []);
      setStationYieldData(stationYields || []);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const lId = selectedLineId ? parseInt(selectedLineId) : null;
    fetchBackendData(lId);
  }, [selectedLineId]);

  const handleLineSelect = (e) => {
    const val = e.target.value;
    setSelectedLineId(val);
    if (onFilterChange) {
      onFilterChange(val ? parseInt(val) : null, null);
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

  // 1. Time-series data formatted automatically per selectedTimeRange
  const getTimeSeriesData = () => {
    if (!hourlyStats || hourlyStats.length === 0) return [];

    const hourlyMap = {};
    hourlyStats.forEach(stat => {
      let timeLabel = '';
      if (typeof stat.bucket === 'string' && stat.bucket.length > 5) {
        const d = new Date(stat.bucket);
        if (!isNaN(d.getTime())) {
          timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      } else if (stat.bucket) {
        timeLabel = stat.bucket.toString();
      }

      if (timeLabel) {
        if (!hourlyMap[timeLabel]) {
          hourlyMap[timeLabel] = { ok: 0, ng: 0, total: 0 };
        }
        hourlyMap[timeLabel].ok += (stat.okCount || 0);
        hourlyMap[timeLabel].ng += (stat.ngCount || 0);
        hourlyMap[timeLabel].total += (stat.total || ((stat.okCount || 0) + (stat.ngCount || 0)));
      }
    });

    const formatted = Object.keys(hourlyMap).map(timeKey => {
      const ok = hourlyMap[timeKey].ok;
      const ng = hourlyMap[timeKey].ng;
      const total = hourlyMap[timeKey].total;
      const yieldRate = total > 0 ? parseFloat(((ok / total) * 100).toFixed(1)) : 0;
      const defectRate = total > 0 ? parseFloat(((ng / total) * 100).toFixed(2)) : 0;
      return {
        time: timeKey,
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

  // 2. Defect Category / Cost Breakdown Data
  const defectCategories = (defectParetoData && defectParetoData.length > 0) ? defectParetoData.map(d => ({
    name: d.code || 'Lỗi chưa xác định',
    count: d.count,
    cost: `$${(d.count * 12).toLocaleString()}`
  })) : [];

  // 3. Quality Compliance Score Donut Data
  const donutData = [
    { name: 'Đạt Chuẩn (Pass)', value: parseFloat(yieldRate.toFixed(1)), color: '#8b5cf6' },
    { name: 'Phát Sinh Lỗi (Defect)', value: parseFloat((100 - yieldRate).toFixed(1)), color: '#334155' }
  ];

  // 4. Line Performance Breakdown Data
  const linePerformanceData = (lineYieldData && lineYieldData.length > 0) ? lineYieldData.map(l => ({
    lineName: l.lineName,
    Pass: parseFloat(l.yieldRate.toFixed(1)),
    Defect: parseFloat((100 - l.yieldRate).toFixed(1))
  })) : [];

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
      return {
        stationName: s.stationName || `Station ${s.stationId}`,
        Total: total,
        OK: s.ok,
        NG: s.ng,
        Yield: passRate
      };
    }) : [];

    return [...raw].sort((a, b) => a.Yield - b.Yield).slice(0, 10);
  })();

  // 5. Workplace / Station Risk Areas Matrix (Real Data)
  const stationRiskData = (stationYieldData && stationYieldData.length > 0) ? stationYieldData.map(s => {
    const risk = s.yieldRate >= 95 ? 'Low Risk' : (s.yieldRate >= 90 ? 'Medium Risk' : 'High Risk');
    const color = s.yieldRate >= 95 ? '#10b981' : (s.yieldRate >= 90 ? '#f59e0b' : '#3b82f6');
    return {
      name: s.stationName,
      x: s.total,
      y: s.ng,
      z: s.total,
      risk: risk,
      color: color
    };
  }) : [];

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
              onChange={(e) => setSelectedTimeRange(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              <option value="24h" className="bg-slate-900">24 giờ qua</option>
              <option value="7d" className="bg-slate-900">7 ngày qua</option>
              <option value="30d" className="bg-slate-900">Tháng này</option>
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
            onClick={() => fetchBackendData(selectedLineId ? parseInt(selectedLineId) : null)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Tải lại dữ liệu"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
          </button>
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
                {totalInspected >= 1000 ? (totalInspected / 1000).toFixed(1) + 'k' : totalInspected.toLocaleString()}
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

          {/* Card 5: Quality Inspection Funnel (Incident Types Pyramid representation) */}
          <div className="glass-panel p-4 flex flex-col justify-between space-y-2">
            <span className="text-xs font-semibold text-slate-400 font-display text-center">Inspection Hierarchy</span>

            <div className="space-y-1.5 pt-1">
              <div className="w-full bg-purple-500/90 py-1 text-center rounded text-[10px] font-bold text-white shadow">
                Pass OK ({passPct}%)
              </div>
              <div className="w-[85%] mx-auto bg-indigo-500/80 py-1 text-center rounded text-[10px] font-bold text-white shadow">
                Fail NG ({defectPct}%)
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
                    interval={selectedTimeRange === '24h' ? 1 : 0}
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
                    height={35}
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
            </div>
          </div>

        </div>
      </div>

      {/* SECTION 3: SAFETY TRAININGS AND COMPLIANCE (3 CHARTS ROW) */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-display">
          Safety Trainings, Quality &amp; Compliance
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Chart 1: Compliance Score Donut Chart */}
          <div className="glass-panel p-5 space-y-3 flex flex-col justify-between">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider font-display text-center">
              Chỉ Số Tuân Thủ Chất Lượng (Compliance Score)
            </h4>

            <div className="h-52 w-full relative flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
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

              {/* Centered Donut Percentage */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-extrabold text-purple-300 font-mono tracking-tight">
                  {yieldRate.toFixed(0)}%
                </span>
                <span className="text-[10px] text-slate-400 font-sans uppercase">Score</span>
              </div>
            </div>
          </div>

          {/* Chart 2: Safety Training Participation / Line-by-Line Quality Performance */}
          <div className="glass-panel p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-display">
                Hiệu Suất Chất Lượng Theo Dây Chuyền
              </h4>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> Pass</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-600"></span> Defect</span>
              </div>
            </div>

            <div className="h-52 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={linePerformanceData} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" stroke="#64748b" fontSize={10} tickLine={false} domain={[80, 100]} />
                  <YAxis type="category" dataKey="lineName" stroke="#64748b" fontSize={10} tickLine={false} width={60} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }} />
                  <Bar dataKey="Pass" fill="#34d399" stackId="a" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Defect" fill="#475569" stackId="a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 3: Workplace Risk Areas Matrix (Scatter plot) */}
          <div className="glass-panel p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-display">
                Bản Đồ Rủi Ro Các Trạm (Workplace Risk Areas)
              </h4>
              <div className="flex items-center gap-2 text-[9px] font-mono">
                <span className="text-emerald-400">Low</span>
                <span className="text-amber-400">Medium</span>
                <span className="text-blue-400">High Risk</span>
              </div>
            </div>

            <div className="h-52 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" dataKey="x" name="Tần suất Lỗi" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis type="number" dataKey="y" name="Mức Độ Rủi Ro" stroke="#64748b" fontSize={10} tickLine={false} />
                  <ZAxis type="number" dataKey="z" range={[60, 300]} name="Sản lượng ảnh hưởng" />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }}
                  />
                  <Scatter data={stationRiskData} fill="#8884d8">
                    {stationRiskData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
