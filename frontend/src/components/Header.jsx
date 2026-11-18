import React, { useState } from 'react';
import { Activity, Database, BarChart3, Search, RefreshCw, Radio, Terminal, Gauge, ClipboardCheck, ShieldAlert, Languages, LayoutGrid, ChevronRight, Monitor, FileText } from 'lucide-react';
import ReportsModal from './ReportsModal';

export default function Header({ activeTab, sectionLabel, moduleTitle, onRefresh, summaryData, language = 'vi', onLanguageChange }) {
  const [reportsOpen, setReportsOpen] = useState(false);
  const getTabDetails = () => {
    // "master/channels" -> "master"
    switch ((activeTab || '').split('/')[0]) {
      case 'home':
        return {
          title: 'Trang Chủ',
          subtitle: 'Chọn module để làm việc: FCT Analysis, Master Data, ...',
          icon: LayoutGrid,
          color: 'text-slate-700',
        };
      case 'analytics':
        return {
          title: 'Trung Tâm Phân Tích Dữ Liệu (Analytics)',
          subtitle: 'Phân tích xu hướng sản lượng, ma trận tỷ lệ Yield theo dây chuyền & biểu đồ Pareto mã lỗi',
          icon: BarChart3,
          color: 'text-purple-700',
        };
      case 'pcb-search':
        return {
          title: 'Tra Cứu & Tìm Kiếm Bản Ghi PCB',
          subtitle: 'Tìm kiếm theo mã vạch PID Barcode, lọc trạng thái OK/NG và tra cứu chi tiết từng bước kiểm tra',
          icon: Search,
          color: 'text-emerald-700',
        };
      case 'cpk':
        return {
          title: 'Theo Dõi Năng Lực Quá Trình (CPK)',
          subtitle: 'CPK theo Channel và Step từ 50 PCB OK gần nhất (tối thiểu 30 mẫu), cập nhật realtime',
          icon: Gauge,
          color: 'text-fuchsia-700',
        };
      case 'improvements':
        return {
          title: 'Cải Tiến Giảm Lỗi',
          subtitle: 'Theo dõi hành động và đo hiệu quả trực tiếp từ tỷ lệ lỗi trong dữ liệu FCT',
          icon: ClipboardCheck,
          color: 'text-cyan-700',
        };
      case 'invalid-results':
        return {
          title: 'Theo Dõi Dữ Liệu Không Hợp Lệ',
          subtitle: 'Kiểm tra các PCB result được bảo toàn nhưng không tính vào sản lượng do trạng thái không thể chuẩn hóa',
          icon: ShieldAlert,
          color: 'text-rose-700',
        };
      case 'pc-overview':
      case 'pc-list':
        return {
          title: activeTab === 'pc-list' ? 'Danh Sách PC' : 'Tổng Quan PC',
          subtitle: 'Online/offline, version Backup_Log2 và tài nguyên các PC thu thập log',
          icon: Monitor,
          color: 'text-teal-700',
        };
      case 'master':
        return {
          title: sectionLabel ? `Master Data · ${sectionLabel}` : 'Master Data',
          subtitle: 'Quản lý Dây chuyền sản xuất SMT, Trạm kiểm tra & Các Channels',
          icon: Database,
          color: 'text-cyan-700',
        };
      case 'command':
        return {
          title: 'Điều Khiển & Lệnh Hệ Thống (Command Center)',
          subtitle: 'Gửi lệnh từ xa (Đổi Model, Khởi Động Lại, Custom Command) đến các thiết bị thu thập log SMT',
          icon: Terminal,
          color: 'text-amber-700',
        };
      case 'dashboard':
      default:
        return {
          title: 'Dashboard Overview',
          subtitle: 'Thống kê sản lượng tổng thể, tỷ lệ Yield toàn nhà máy & Luồng dữ liệu kiểm tra real-time',
          icon: Activity,
          color: 'text-blue-700',
        };
    }
  };

  const { title, subtitle, icon: Icon, color } = getTabDetails();

  return (
    <header className="glass-panel px-6 py-4 mb-6 flex flex-wrap items-center justify-between gap-4 border border-slate-200 relative overflow-hidden">
      {/* Background ambient light */}
      <div className="absolute top-0 right-1/3 w-80 h-20 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Active Tab Title & Subtitle */}
      <div className="flex items-center gap-3.5 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shadow-inner">
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          {activeTab !== 'home' && moduleTitle && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 mb-0.5">
              <span>Trang chủ</span>
              <ChevronRight className="w-3 h-3" />
              <span className="text-slate-700">{moduleTitle}</span>
            </div>
          )}
          <h1 className="text-xl font-bold text-slate-900 font-display tracking-tight flex items-center gap-2">
            {title}
          </h1>
          <p className="text-xs text-slate-600 font-medium">{subtitle}</p>
        </div>
      </div>

      {/* Top Header Actions & Badges */}
      <div className="flex items-center gap-3 relative z-10">
        <div id="analytics-header-actions" className="flex items-center gap-2" />
        <div data-no-translate className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/70 p-1" title="Language / Ngôn ngữ">
          <Languages className="ml-1 h-3.5 w-3.5 text-cyan-700" />
          {['vi', 'en'].map(value => <button key={value} type="button" onClick={() => onLanguageChange?.(value)} className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${language === value ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{value.toUpperCase()}</button>)}
        </div>
        {summaryData && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50/70 border border-slate-200 text-xs font-mono text-slate-700">
            <Radio className="w-3.5 h-3.5 text-blue-700 animate-pulse" />
            <span>Active Channels:</span>
            <strong className="text-blue-700">{summaryData.activeChannels}</strong>
          </div>
        )}

        <button
          type="button"
          onClick={() => setReportsOpen(true)}
          className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white transition-colors flex items-center gap-2 shadow-sm"
          title="Xem báo cáo họp NTF · Re-test · FPY"
        >
          <FileText className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Xem báo cáo</span>
        </button>

        <button
          onClick={onRefresh}
          className="px-3.5 py-2 rounded-xl bg-slate-100/80 hover:bg-slate-200 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors flex items-center gap-2 shadow-sm"
          title="Tải lại dữ liệu"
        >
          <RefreshCw className="w-3.5 h-3.5 text-blue-700" />
          <span className="hidden sm:inline">Refresh Data</span>
        </button>
      </div>
      <ReportsModal open={reportsOpen} onClose={() => setReportsOpen(false)} />
    </header>
  );
}
