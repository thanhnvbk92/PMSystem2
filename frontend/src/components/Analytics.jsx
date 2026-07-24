import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, TrendingUp, Layers, AlertTriangle, Cpu, Clock, 
  Sparkles, CheckCircle, ShieldCheck, Filter, RefreshCw
} from 'lucide-react';
import { 
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, Legend, Cell, LineChart, Line, ComposedChart 
} from 'recharts';
import { ProductionApi } from '../services/api';

export default function Analytics({ summary, latestLogs, hourlyStats, lines, stations, onFilterChange }) {
  const [selectedLine, setSelectedLine] = useState('');
  const [selectedStation, setSelectedStation] = useState('');
  const [activeTab, setActiveTab] = useState('hourly'); // 'hourly', 'line_matrix', 'defects', 'station_health'
  
  // Real backend analytics state
  const [lineYieldData, setLineYieldData] = useState([]);
  const [defectParetoData, setDefectParetoData] = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);

  // Fetch full line yield & defect pareto from backend when filters change
  const fetchAnalyticsData = async (lineId, stationId) => {
    setLoadingStats(true);
    try {
      const [yieldStats, paretoStats] = await Promise.all([
        ProductionApi.getLineYieldStats(lineId),
        ProductionApi.getDefectPareto(lineId, stationId)
      ]);
      setLineYieldData(yieldStats || []);
      setDefectParetoData(paretoStats || []);
    } catch (err) {
      console.error('Error loading full analytics data:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    const lineId = selectedLine ? parseInt(selectedLine) : null;
    const stationId = selectedStation ? parseInt(selectedStation) : null;
    fetchAnalyticsData(lineId, stationId);
  }, [selectedLine, selectedStation]);

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
    onFilterChange(null, null);
  };

  const filteredStations = selectedLine 
    ? stations.filter(s => s.lineId === parseInt(selectedLine))
    : stations;

  // Hourly trend data formatting
  const chartData = useMemo(() => {
    return (hourlyStats || []).map(stat => ({
      time: new Date(stat.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      OK: stat.okCount,
      NG: stat.ngCount,
      Yield: parseFloat(stat.yieldRate.toFixed(2))
    }));
  }, [hourlyStats]);

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

  return (
    <div className="space-y-6 w-full animate-in fade-in duration-300">
      
      {/* FILTER & TAB BAR (Cleaned up to avoid double headers) */}
      <div className="glass-panel p-4 w-full flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 bg-slate-950/80 p-1.5 rounded-2xl border border-white/10 overflow-x-auto">
          <button
            onClick={() => setActiveTab('hourly')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'hourly'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Xu Hướng Sản Lượng Theo Giờ (24h)
          </button>

          <button
            onClick={() => setActiveTab('line_matrix')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'line_matrix'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            So Sánh Yield Theo Dây Chuyền
          </button>

          <button
            onClick={() => setActiveTab('defects')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'defects'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            Phân Tích Mã Lỗi (Defect Pareto)
          </button>

          <button
            onClick={() => setActiveTab('station_health')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'station_health'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-4 h-4" />
            Trạng Thái Trạm (Stations)
          </button>
        </div>

        {/* Global Filters */}
        <div className="flex items-center gap-3">
          <select
            value={selectedLine}
            onChange={handleLineChange}
            className="bg-slate-950/90 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
          >
            <option value="">Tất cả Dây Chuyền (Lines)</option>
            {[...lines].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })).map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <select
            value={selectedStation}
            onChange={handleStationChange}
            className="bg-slate-950/90 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
          >
            <option value="">Tất cả Trạm (Stations)</option>
            {filteredStations.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.lineName})</option>
            ))}
          </select>

          {(selectedLine || selectedStation) && (
            <button
              onClick={resetFilters}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              title="Reset bộ lọc"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* TAB CONTENT PANELS */}
      <div className="glass-panel p-6 w-full space-y-6">
        
        {/* TAB 1: HOURLY PRODUCTION TREND */}
        {activeTab === 'hourly' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-purple-400" /> Continuous Aggregates 24-Hour Production Volume & Yield Rate</span>
              <span className="font-mono text-emerald-400 font-semibold">● Live Telemetry Sync</span>
            </div>
            
            <div className="h-96 w-full pt-2">
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
                  <span>Đang nạp dữ liệu phân tích từ CSDL TimescaleDB...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LINE-BY-LINE YIELD MATRIX */}
        {activeTab === 'line_matrix' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>So sánh Tỷ lệ Yield Rate và Tổng Sản Lượng Toàn Bộ CSDL PostgreSQL theo Dây Chuyền</span>
              <span className="font-mono text-purple-400 font-medium">
                {loadingStats ? 'Đang tải...' : `Tổng hợp ${lineYieldData.length} Dây chuyền`}
              </span>
            </div>

            <div className="h-96 w-full pt-2">
              {lineYieldData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={lineYieldData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="lineName" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis domain={[80, 100]} stroke="#94a3b8" fontSize={11} unit="%" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                      formatter={(val, name, props) => [
                        `${val}% (OK: ${props.payload.ok} / Total: ${props.payload.total})`, 
                        'Yield Rate'
                      ]}
                    />
                    <Bar dataKey="yieldRate" radius={[6, 6, 0, 0]} maxBarSize={50}>
                      {lineYieldData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.yieldRate >= 98.5 ? '#10b981' : entry.yieldRate >= 95 ? '#f59e0b' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                  {loadingStats ? 'Đang tải dữ liệu sản xuất từ CSDL...' : 'Chưa ghi nhận đủ dữ liệu theo dây chuyền.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: DEFECT PARETO ANALYSIS */}
        {activeTab === 'defects' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Pareto Chart: Top Mã Lỗi Sản Xuất (NG) Trong CSDL</span>
                <span className="font-mono text-slate-400">PostgreSQL Pareto Query</span>
              </div>
              <div className="h-80 w-full">
                {defectParetoData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={defectParetoData} margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis type="number" stroke="#64748b" fontSize={11} />
                      <YAxis type="category" dataKey="code" stroke="#94a3b8" fontSize={11} width={130} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                        formatter={(val, name, props) => [`${val} lỗi (${props.payload.pct}%)`, 'Số Lỗi Phát Sinh']}
                      />
                      <Bar dataKey="count" fill="#ef4444" radius={[0, 6, 6, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm gap-1">
                    <CheckCircle className="w-8 h-8 text-emerald-500 mb-1" />
                    <span>{loadingStats ? 'Đang truy vấn danh sách lỗi...' : 'Không ghi nhận lỗi sản xuất (NG) nào trong tập dữ liệu!'}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-panel p-5 space-y-3.5 border border-rose-500/20 bg-rose-950/10">
              <h4 className="text-xs font-bold uppercase tracking-wider text-rose-300 flex items-center gap-2 font-display">
                <ShieldCheck className="w-4 h-4 text-rose-400" />
                Gợi Ý Khắc Phục Lỗi SPI / AOI / Xray
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Phân tích <strong>Pareto</strong> tự động tổng hợp từ toàn bộ dữ liệu kiểm tra PostgreSQL để hỗ trợ đội ngũ QC truy vết nhanh các mã lỗi phổ biến.
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
        {activeTab === 'station_health' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Danh sách và trạng thái hoạt động của tất cả các Trạm Kiểm Tra (Inspection Stations)</span>
              <span className="font-mono text-slate-400">Tổng cộng {stations.length} Trạm</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto pr-1">
              {stations.map(st => (
                <div key={st.id} className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between space-y-3 hover:border-purple-500/40 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white font-display truncate max-w-[130px]">{st.name}</span>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50"></span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono space-y-1">
                    <div>Line: <span className="text-slate-200">{st.lineName}</span></div>
                    <div>ID Trạm: <span className="text-purple-400">#{st.id}</span></div>
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
  );
}

