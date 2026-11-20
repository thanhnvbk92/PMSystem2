import React, { useState } from 'react';
import { Activity, Database, BarChart3, Search, RefreshCw, Radio, Terminal, Gauge, ClipboardCheck, ShieldAlert, Languages, LayoutGrid, ChevronRight, Monitor, FileText } from 'lucide-react';
import ReportsModal from './ReportsModal';

// Page titles = the sidebar labels (short, and already in the VI/EN dictionary).
const TAB_DETAILS = {
  home: { title: 'Trang Chủ', icon: LayoutGrid, color: 'text-slate-700' },
  dashboard: { title: 'Tổng Quan (Dashboard)', icon: Activity, color: 'text-blue-700' },
  analytics: { title: 'Phân Tích Dữ Liệu', icon: BarChart3, color: 'text-purple-700' },
  'pcb-search': { title: 'Tra Cứu PCB', icon: Search, color: 'text-emerald-700' },
  cpk: { title: 'Theo Dõi CPK', icon: Gauge, color: 'text-fuchsia-700' },
  improvements: { title: 'Cải Tiến Giảm Lỗi', icon: ClipboardCheck, color: 'text-cyan-700' },
  'invalid-results': { title: 'Dữ Liệu Không Hợp Lệ', icon: ShieldAlert, color: 'text-rose-700' },
  'pc-overview': { title: 'Tổng Quan PC', icon: Monitor, color: 'text-teal-700' },
  'pc-list': { title: 'Danh Sách PC', icon: Monitor, color: 'text-teal-700' },
  master: { title: 'Master Data', icon: Database, color: 'text-cyan-700' },
  command: { title: 'Điều Khiển Máy', icon: Terminal, color: 'text-amber-700' },
};

export default function Header({ activeTab, sectionLabel, moduleTitle, onRefresh, summaryData, language = 'vi', onLanguageChange }) {
  const [reportsOpen, setReportsOpen] = useState(false);
  // "master/channels" -> "master"
  const details = TAB_DETAILS[(activeTab || '').split('/')[0]] || TAB_DETAILS.dashboard;
  const { icon: Icon, color } = details;
  const title = details.title;

  return (
    <header className="glass-panel px-4 py-2 mb-4 flex flex-wrap items-center justify-between gap-3 border border-slate-200">
      {/* Module › page on one line */}
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon className={`h-5 w-5 shrink-0 ${color}`} />
        {activeTab !== 'home' && moduleTitle && (
          <>
            <span className="hidden text-xs font-semibold text-slate-500 md:inline">{moduleTitle}</span>
            <ChevronRight className="hidden h-3.5 w-3.5 text-slate-400 md:inline" />
          </>
        )}
        <h1 className="truncate text-base font-bold text-slate-900 font-display tracking-tight">{title}</h1>
        {sectionLabel && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <span className="truncate text-sm font-semibold text-slate-700">{sectionLabel}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div id="analytics-header-actions" className="flex items-center gap-2" />
        {summaryData && (
          <span className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1 font-mono text-[11px] text-slate-700" title="Active Channels">
            <Radio className="h-3 w-3 text-blue-700 animate-pulse" />
            <strong className="text-blue-700">{summaryData.activeChannels}</strong> online
          </span>
        )}
        <div data-no-translate className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50/70 p-0.5" title="Language / Ngôn ngữ">
          <Languages className="ml-1 h-3 w-3 text-cyan-700" />
          {['vi', 'en'].map(value => <button key={value} type="button" onClick={() => onLanguageChange?.(value)} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold transition ${language === value ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{value.toUpperCase()}</button>)}
        </div>
        <button
          type="button"
          onClick={() => setReportsOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
          title="Báo cáo tháng NTF · Re-test · RTY"
        >
          <FileText className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Xem báo cáo</span>
        </button>
        <button
          onClick={onRefresh}
          className="rounded-lg border border-slate-200 bg-slate-100/80 p-1.5 text-slate-700 transition-colors hover:bg-slate-200"
          title="Tải lại dữ liệu"
        >
          <RefreshCw className="h-3.5 w-3.5 text-blue-700" />
        </button>
      </div>
      <ReportsModal open={reportsOpen} onClose={() => setReportsOpen(false)} />
    </header>
  );
}
