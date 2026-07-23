import React, { useState, useMemo } from 'react';
import { 
  Activity, CheckCircle, XCircle, TrendingUp, Filter, Layers, Eye, Radio, 
  Sparkles, X, ShieldCheck, Clock, BarChart3, PieChart, AlertTriangle, 
  Search, RefreshCw, Cpu, CheckCircle2, AlertOctagon, Target, SlidersHorizontal, ChevronRight
} from 'lucide-react';
import { 
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, Legend, Cell, LineChart, Line, ComposedChart 
} from 'recharts';

export default function Dashboard({ summary, latestLogs, hourlyStats, lines, stations, onFilterChange, newRecordIds }) {
  const [selectedLine, setSelectedLine] = useState('');
  const [selectedStation, setSelectedStation] = useState('');
  const [resultFilter, setResultFilter] = useState('ALL'); // ALL, OK, NG
  const [searchPid, setSearchPid] = useState('');
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState('hourly'); // 'hourly', 'line_matrix', 'defects', 'station_health'
  const [activeModalItem, setActiveModalItem] = useState(null);

  const handleLineChange = (e) => {
    const val = e.target.value;
    setSelectedLine(val);
    setSelectedStation('');
    onFilterChange(val ? parseInt(val) : null, null);
  };

  const handleStationChange = (e) => {
    const val = e.target.value;
    setSelectedStation(val);
    onFilterChange(selectedLine ? parseInt(selectedLine) : null, val ? parseInt(val) : null);
  };

  const resetFilters = () => {
    setSelectedLine('');
    setSelectedStation('');
    setResultFilter('ALL');
    setSearchPid('');
    onFilterChange(null, null);
  };

  const filteredStations = selectedLine 
    ? stations.filter(s => s.lineId === parseInt(selectedLine))
    : stations;

  // Filter telemetry stream table locally by result status and PID search
  const filteredLogs = useMemo(() => {
    return (latestLogs || []).filter(log => {
      if (resultFilter === 'OK' && log.result !== 'OK') return false;
      if (resultFilter === 'NG' && log.result !== 'NG') return false;
      if (searchPid.trim() && !log.pid.toLowerCase().includes(searchPid.toLowerCase().trim())) return false;
      return true;
    });
  }, [latestLogs, resultFilter, searchPid]);

  // Hourly trend data formatting
  const chartData = useMemo(() => {
    return (hourlyStats || []).map(stat => ({
      time: new Date(stat.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      OK: stat.okCount,
      NG: stat.ngCount,
      Yield: parseFloat(stat.yieldRate.toFixed(2))
    }));
  }, [hourlyStats]);

  // Line Yield Matrix Data calculation
  const lineYieldMatrix = useMemo(() => {
    if (!latestLogs || latestLogs.length === 0) return [];
    
    const lineStats = {};
    latestLogs.forEach(log => {
      const lineName = log.lineName || `Line ${log.lineId}`;
      if (!lineStats[lineName]) {
        lineStats[lineName] = { lineName, total: 0, ok: 0, ng: 0 };
      }
      lineStats[lineName].total += 1;
      if (log.result === 'OK') lineStats[lineName].ok += 1;
      else lineStats[lineName].ng += 1;
    });

    return Object.values(lineStats).map(l => ({
      ...l,
      yieldRate: parseFloat(((l.ok / l.total) * 100).toFixed(1))
    })).sort((a, b) => b.total - a.total);
  }, [latestLogs]);

  // Defect Pareto Code calculation
  const defectBreakdown = useMemo(() => {
    if (!latestLogs) return [];
    const counts = {};
    latestLogs.filter(l => l.result === 'NG').forEach(l => {
      const code = l.errorCode || 'UNKNOWN_DEFECT';
      counts[code] = (counts[code] || 0) + 1;
    });

    if (Object.keys(counts).length === 0) {
      return [];
    }

    const totalNg = Object.values(counts).reduce((a, b) => a + b, 0);
    return Object.entries(counts)
      .map(([code, count]) => ({
        code,
        count,
        pct: parseFloat(((count / totalNg) * 100).toFixed(1))
      }))
      .sort((a, b) => b.count - a.count);
  }, [latestLogs]);

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
              <span>Yield Rate:</span>
              <span className="font-mono text-sm">{payload[2]?.value}%</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const totalInspected = summary?.totalInspected || 0;
  const totalOk = summary?.totalOk || 0;
  const totalNg = summary?.totalNg || 0;
  const yieldRate = summary?.overallYieldRate !== undefined ? summary.overallYieldRate : 100.0;
  const passPct = totalInspected > 0 ? ((totalOk / totalInspected) * 100).toFixed(1) : '100';
  const defectPct = totalInspected > 0 ? ((totalNg / totalInspected) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-8 w-full">
      
      {/* 1. EXECUTIVE KPI SUMMARY CARDS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        
        {/* Card 1: Total Inspected */}
        <div className="glass-panel p-6 card-glow-blue flex flex-col justify-between group hover:scale-[1.01] transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-display">Total Inspected</span>
            <div className="w-11 h-11 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-lg shadow-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight font-display">
              {totalInspected.toLocaleString()}
            </h3>
            <div className="text-xs text-blue-400 mt-2 flex items-center justify-between font-medium">
              <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 animate-pulse text-blue-400" /> High-Throughput Stream</span>
              <span className="font-mono text-[11px] text-slate-400">100% Ingested</span>
            </div>
          </div>
        </div>

        {/* Card 2: Passed (OK) */}
        <div className="glass-panel p-6 card-glow-emerald flex flex-col justify-between group hover:scale-[1.01] transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-display">Passed (OK)</span>
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors">
              <CheckCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-3xl lg:text-4xl font-extrabold text-emerald-400 tracking-tight font-display">
              {totalOk.toLocaleString()}
            </h3>
            <div className="text-xs text-emerald-400/90 mt-2 flex items-center justify-between font-medium">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Pass Share: {passPct}%</span>
              <span className="font-mono text-[11px] text-slate-400">ISO 9001</span>
            </div>
          </div>
        </div>

        {/* Card 3: Defects (NG) */}
        <div className="glass-panel p-6 card-glow-rose flex flex-col justify-between group hover:scale-[1.01] transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-display">Defects (NG)</span>
            <div className="w-11 h-11 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-lg shadow-rose-500/10 group-hover:bg-rose-500/20 transition-colors">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-3xl lg:text-4xl font-extrabold text-rose-400 tracking-tight font-display">
              {totalNg.toLocaleString()}
            </h3>
            <div className="text-xs text-rose-400/90 mt-2 flex items-center justify-between font-medium">
              <span className="flex items-center gap-1.5"><AlertOctagon className="w-3.5 h-3.5" /> Defect Share: {defectPct}%</span>
              <span className="font-mono text-[11px] text-slate-400">Requires AOI/Xray</span>
            </div>
          </div>
        </div>

        {/* Card 4: Overall Yield Efficiency */}
        <div className="glass-panel p-6 card-glow-purple flex flex-col justify-between group hover:scale-[1.01] transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-display">Overall Yield Efficiency</span>
            <div className="w-11 h-11 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-lg shadow-purple-500/10 group-hover:bg-purple-500/20 transition-colors">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-3xl lg:text-4xl font-extrabold text-purple-300 tracking-tight font-display">
                {yieldRate.toFixed(2)}%
              </h3>
              <span className="text-xs font-mono text-slate-400">Target: 98.5%</span>
            </div>
            <div className="w-full bg-slate-900 h-2 rounded-full mt-3 overflow-hidden border border-slate-800">
              <div 
                className="bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 h-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, yieldRate))}%` }}
              ></div>
            </div>
          </div>
        </div>

      </div>

      {/* 2. MULTI-TAB DEEP ANALYTICS SUITE */}
      <div className="glass-panel p-6 w-full space-y-6">
        
        {/* Analytics Section Header & Tab Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2 font-display">
              <BarChart3 className="w-6 h-6 text-blue-400" />
              Chẩn Đoán & Phân Tích Chuyên Sâu Production Analytics
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">TimescaleDB Aggregated Insights & Real-time Inspection Intelligence</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-slate-950/80 p-1.5 rounded-2xl border border-white/10">
            <button
              onClick={() => setActiveAnalyticsTab('hourly')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeAnalyticsTab === 'hourly'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Xu hướng Theo Giờ (24h)
            </button>

            <button
              onClick={() => setActiveAnalyticsTab('line_matrix')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeAnalyticsTab === 'line_matrix'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Yield Theo Dây Chuyền
            </button>

            <button
              onClick={() => setActiveAnalyticsTab('defects')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeAnalyticsTab === 'defects'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              Phân Tích Mã Lỗi (Defect Pareto)
            </button>

            <button
              onClick={() => setActiveAnalyticsTab('station_health')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeAnalyticsTab === 'station_health'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              Trạm Kiềm Tra (Stations)
            </button>
          </div>
        </div>

        {/* Tab Content Display */}
        <div className="w-full">
          
          {/* TAB 1: HOURLY PRODUCTION TREND */}
          {activeAnalyticsTab === 'hourly' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-blue-400" /> Continuous Aggregates 24-Hour Production Volume & Yield Rate</span>
                <span className="font-mono text-emerald-400 font-semibold">● Real-time Stream Active</span>
              </div>
              
              <div className="h-80 w-full pt-2">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorOk" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorNg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                      <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} />
                      <YAxis yAxisId="right" orientation="right" domain={[80, 100]} stroke="#8b5cf6" fontSize={11} tickLine={false} unit="%" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                      <Bar yAxisId="left" dataKey="OK" name="Pass (OK)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Bar yAxisId="left" dataKey="NG" name="Fail (NG)" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Line yAxisId="right" type="monotone" dataKey="Yield" name="Yield Rate (%)" stroke="#a78bfa" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
                    <Sparkles className="w-8 h-8 text-slate-600 animate-bounce" />
                    <span>Đang nạp dữ liệu phân tích từ TimescaleDB. Nếu dữ liệu trống, hãy chuyển qua tab <strong>PCB Simulator</strong> để kích hoạt luồng dữ liệu!</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: LINE-BY-LINE YIELD MATRIX */}
          {activeAnalyticsTab === 'line_matrix' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>So sánh Tỷ lệ Yield Rate giữa các Dây chuyền Sản xuất (Production Lines)</span>
                <span className="font-mono text-slate-400 font-medium">Hiển thị {lineYieldMatrix.length} Dây chuyền active</span>
              </div>

              <div className="h-80 w-full pt-2">
                {lineYieldMatrix.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={lineYieldMatrix} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="lineName" stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <YAxis domain={[80, 100]} stroke="#94a3b8" fontSize={11} unit="%" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                        formatter={(val) => [`${val}%`, 'Yield Rate']}
                      />
                      <Bar dataKey="yieldRate" radius={[6, 6, 0, 0]} maxBarSize={50}>
                        {lineYieldMatrix.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.yieldRate >= 98.5 ? '#10b981' : entry.yieldRate >= 95 ? '#f59e0b' : '#ef4444'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                    Chưa ghi nhận đủ dữ liệu theo dây chuyền.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: DEFECT PARETO ANALYSIS */}
          {activeAnalyticsTab === 'defects' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Pareto Chart: Top Loại Lỗi Phát Sinh Nhiều Nhất</span>
                  <span className="font-mono text-slate-400">Quality Control Audit</span>
                </div>
                <div className="h-72 w-full">
                  {defectBreakdown.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={defectBreakdown} margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis type="number" stroke="#64748b" fontSize={11} />
                        <YAxis type="category" dataKey="code" stroke="#94a3b8" fontSize={11} width={130} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }} />
                        <Bar dataKey="count" fill="#ef4444" radius={[0, 6, 6, 0]} maxBarSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm gap-1">
                      <CheckCircle className="w-8 h-8 text-emerald-500 mb-1" />
                      <span>Không ghi nhận lỗi sản xuất (NG) nào trong tập dữ liệu hiện tại!</span>
                      <span className="text-xs text-slate-600">Tất cả các sản phẩm đã kiểm tra đều Đạt (OK).</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-panel p-5 space-y-3.5 border border-rose-500/20 bg-rose-950/10">
                <h4 className="text-xs font-bold uppercase tracking-wider text-rose-300 flex items-center gap-2 font-display">
                  <ShieldCheck className="w-4 h-4 text-rose-400" />
                  Gợi Ý Khắc Phục Lỗi AOI / SPI
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Phân tích <strong>Pareto</strong> tự động tổng hợp từ dữ liệu kiểm tra PostgreSQL để hỗ trợ đội ngũ QC truy vết nhanh các mã lỗi phổ biến.
                </p>
                <div className="space-y-2 text-[11px] text-slate-400">
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-2">
                    <span className="text-rose-400 font-bold">1.</span>
                    <span>Kiểm tra lại độ dày stencil nhôm và lực gạt kem hàn tại máy in SPI.</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-2">
                    <span className="text-amber-400 font-bold">2.</span>
                    <span>Hiệu chỉnh lại tọa độ gắp linh kiện Feeder tại các máy gắp chip (Pick & Place).</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: STATION HEALTH GRID */}
          {activeAnalyticsTab === 'station_health' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Danh sách và trạng thái hoạt động của tất cả các Trạm Kiểm Tra (Inspection Stations)</span>
                <span className="font-mono text-slate-400">Tổng cộng {stations.length} Trạm</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-80 overflow-y-auto pr-1">
                {stations.map(st => (
                  <div key={st.id} className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between space-y-3 hover:border-blue-500/40 transition-all">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white font-display truncate max-w-[130px]">{st.name}</span>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50"></span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono space-y-1">
                      <div>Line: <span className="text-slate-200">{st.lineName}</span></div>
                      <div>ID Trạm: <span className="text-blue-400">#{st.id}</span></div>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-emerald-400 font-semibold uppercase">
                      <span>Status: Online</span>
                      <span className="text-slate-400">Telemetry Active</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* 3. CONTROLS, SEARCH & REAL-TIME PCB TELEMETRY STREAM TABLE */}
      <div className="glass-panel p-6 w-full space-y-6">
        
        {/* Table Top Controls & Search Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2 font-display">
              <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
              Luồng Dữ Liệu Kiểm Tra Thời Gian Thực (Live Telemetry Stream Feed)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Tự động nhận sự kiện qua giao thức SignalR WebSocket kết nối PostgreSQL TimescaleDB</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            
            {/* PID Search Input */}
            <div className="relative min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm mã PCB (PID)..."
                value={searchPid}
                onChange={(e) => setSearchPid(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Line Filter */}
            <select
              value={selectedLine}
              onChange={handleLineChange}
              className="bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Tất cả Dây Chuyền (Lines)</option>
              {lines.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>

            {/* Station Filter */}
            <select
              value={selectedStation}
              onChange={handleStationChange}
              className="bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Tất cả Trạm (Stations)</option>
              {filteredStations.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.lineName})</option>
              ))}
            </select>

            {/* Result Filter Buttons */}
            <div className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setResultFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  resultFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Tất cả
              </button>
              <button
                onClick={() => setResultFilter('OK')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  resultFilter === 'OK' ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:text-emerald-400'
                }`}
              >
                Chỉ OK
              </button>
              <button
                onClick={() => setResultFilter('NG')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  resultFilter === 'NG' ? 'bg-rose-600/30 text-rose-300 border border-rose-500/40' : 'text-slate-400 hover:text-rose-400'
                }`}
              >
                Chỉ NG
              </button>
            </div>

            {/* Reset Button */}
            {(selectedLine || selectedStation || resultFilter !== 'ALL' || searchPid) && (
              <button
                onClick={resetFilters}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 transition-colors"
                title="Reset tất cả bộ lọc"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Telemetry Stream Table */}
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3.5">Thời gian</th>
                <th className="p-3.5">Mã PCB (PID Barcode)</th>
                <th className="p-3.5">Dây chuyền</th>
                <th className="p-3.5">Trạm / Channel</th>
                <th className="p-3.5 text-center">Kết quả</th>
                <th className="p-3.5 text-right">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredLogs && filteredLogs.length > 0 ? (
                filteredLogs.map((log) => {
                  const isNew = newRecordIds.has(log.id);
                  return (
                    <tr key={log.id} className={`hover:bg-slate-800/50 transition-colors ${isNew ? 'row-new' : ''}`}>
                      <td className="p-3.5 text-slate-400 whitespace-nowrap">
                        {new Date(log.inspectTime).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="p-3.5 text-white font-bold tracking-wide">{log.pid}</td>
                      <td className="p-3.5 text-slate-300 font-sans">{log.lineName}</td>
                      <td className="p-3.5 text-slate-300 font-sans">
                        {log.stationName} <span className="text-slate-500 font-mono text-[11px]">({log.channelName})</span>
                      </td>
                      <td className="p-3.5 text-center">
                        {log.result === 'OK' ? (
                          <span className="badge badge-ok">PASS (OK)</span>
                        ) : (
                          <span className="badge badge-ng">FAIL {log.errorCode ? `(${log.errorCode})` : ''}</span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => setActiveModalItem(log)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 text-xs font-sans transition-colors inline-flex items-center gap-1.5 font-medium"
                        >
                          <Eye className="w-3.5 h-3.5" /> Steps
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-500 font-sans space-y-2">
                    <p className="text-sm">Không tìm thấy kết quả kiểm tra phù hợp với bộ lọc hiện tại.</p>
                    <p className="text-xs text-slate-600">Thử xóa từ khóa tìm kiếm hoặc chuyển sang tab <strong>PCB Simulator</strong> để giả lập thêm bản ghi!</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. MODAL FOR INSPECTION TEST STEPS DETAILED BREAKDOWN */}
      {activeModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass-panel max-w-3xl w-full p-6 space-y-5 border border-white/20 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2 font-display">
                  Inspection Steps: <span className="text-blue-400 font-mono">{activeModalItem.pid}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">Trạm: {activeModalItem.stationName} ({activeModalItem.lineName})</p>
              </div>
              <button
                onClick={() => setActiveModalItem(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-slate-400 block mb-0.5">Kết quả Tổng thể:</span>
                <span className={activeModalItem.result === 'OK' ? 'text-emerald-400 font-bold text-sm' : 'text-rose-400 font-bold text-sm'}>
                  {activeModalItem.result} {activeModalItem.errorCode ? `(${activeModalItem.errorCode})` : ''}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-slate-400 block mb-0.5">Thời gian kiểm tra:</span>
                <span className="text-slate-200 font-mono font-medium text-xs">
                  {new Date(activeModalItem.inspectTime).toLocaleString('vi-VN')}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 font-display">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                Các Bước Kiểm Tra Chi Tiết ({activeModalItem.steps ? activeModalItem.steps.length : 0} Steps)
              </h4>
              <div className="max-h-64 overflow-y-auto border border-slate-800/80 rounded-xl bg-slate-950/80">
                {activeModalItem.steps && activeModalItem.steps.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/90 text-slate-400 uppercase font-semibold text-[11px] border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="p-2.5 text-center w-10">#</th>
                        <th className="p-2.5">Tên bước / Linh kiện</th>
                        <th className="p-2.5">Phân loại</th>
                        <th className="p-2.5 text-right">Giá trị</th>
                        <th className="p-2.5 text-center">Tiêu chuẩn (Min~Max)</th>
                        <th className="p-2.5 text-center">Kết quả</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {activeModalItem.steps.map((step, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/50">
                          <td className="p-2.5 text-center text-slate-500">{step.stepNumber || idx + 1}</td>
                          <td className="p-2.5 text-slate-200 font-sans font-medium">{step.stepName}</td>
                          <td className="p-2.5 text-slate-400 font-sans text-[11px]">
                            {step.stepType ? <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{step.stepType}</span> : '-'}
                          </td>
                          <td className="p-2.5 text-right text-blue-400 font-bold">{step.value ?? '-'}</td>
                          <td className="p-2.5 text-center text-slate-400 text-[11px]">
                            {step.specMin || step.specMax ? `${step.specMin ?? '-'} ~ ${step.specMax ?? '-'}` : '-'}
                          </td>
                          <td className="p-2.5 text-center">
                            <span className={step.result === 'OK' ? 'badge badge-ok' : 'badge badge-ng'}>
                              {step.result}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-6 text-center text-slate-500 text-xs space-y-1">
                    <p>Đã hoàn thành kiểm tra quy chuẩn thành công.</p>
                    <p className="text-[11px] text-slate-600">Dữ liệu tham số chi tiết đã được lưu trữ trong CSDL TimescaleDB.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setActiveModalItem(null)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all"
              >
                Đóng cửa sổ
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
