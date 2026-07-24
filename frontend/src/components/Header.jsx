import React from 'react';
import { Activity, Database, BarChart3, Search, RefreshCw, Radio } from 'lucide-react';

export default function Header({ activeTab, onRefresh, summaryData }) {
  const getTabDetails = () => {
    switch (activeTab) {
      case 'analytics':
        return {
          title: 'Trung Tâm Phân Tích Dữ Liệu (Analytics)',
          subtitle: 'Phân tích xu hướng sản lượng, ma trận tỷ lệ Yield theo dây chuyền & biểu đồ Pareto mã lỗi',
          icon: BarChart3,
          color: 'text-purple-400',
        };
      case 'pcb-search':
        return {
          title: 'Tra Cứu & Tìm Kiếm Bản Ghi PCB',
          subtitle: 'Tìm kiếm theo mã vạch PID Barcode, lọc trạng thái OK/NG và tra cứu chi tiết từng bước kiểm tra',
          icon: Search,
          color: 'text-emerald-400',
        };
      case 'master':
        return {
          title: 'Master Data',
          subtitle: 'Quản lý Dây chuyền sản xuất SMT, Trạm kiểm tra & Các Channels',
          icon: Database,
          color: 'text-cyan-400',
        };
      case 'dashboard':
      default:
        return {
          title: 'Dashboard Overview',
          subtitle: 'Thống kê sản lượng tổng thể, tỷ lệ Yield toàn nhà máy & Luồng dữ liệu kiểm tra real-time',
          icon: Activity,
          color: 'text-blue-400',
        };
    }
  };

  const { title, subtitle, icon: Icon, color } = getTabDetails();

  return (
    <header className="glass-panel px-6 py-4 mb-6 flex flex-wrap items-center justify-between gap-4 border border-white/10 relative overflow-hidden">
      {/* Background ambient light */}
      <div className="absolute top-0 right-1/3 w-80 h-20 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Active Tab Title & Subtitle */}
      <div className="flex items-center gap-3.5 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center shadow-inner">
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white font-display tracking-tight flex items-center gap-2">
            {title}
          </h1>
          <p className="text-xs text-slate-400 font-medium">{subtitle}</p>
        </div>
      </div>

      {/* Top Header Actions & Badges */}
      <div className="flex items-center gap-3 relative z-10">
        {summaryData && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-300">
            <Radio className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span>Active Channels:</span>
            <strong className="text-blue-300">{summaryData.activeChannels}</strong>
          </div>
        )}

        <button
          onClick={onRefresh}
          className="px-3.5 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-white/10 text-xs font-semibold text-slate-300 transition-colors flex items-center gap-2 shadow-sm"
          title="Tải lại dữ liệu"
        >
          <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
          <span className="hidden sm:inline">Refresh Data</span>
        </button>
      </div>
    </header>
  );
}
