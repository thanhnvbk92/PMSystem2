import React from 'react';
import {
  Activity,
  Database,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Search,
  LayoutGrid,
  AlertTriangle
} from 'lucide-react';
import * as signalR from '@microsoft/signalr';
import { HOME_TAB } from '../modules';

export default function Sidebar({
  activeTab,
  setActiveTab,
  signalRState,
  lastSignalREvent,
  summaryData,
  isCollapsed,
  setIsCollapsed,
  module,
  counts = {},
  ipConflicts = 0
}) {
  const lastEventTime = lastSignalREvent?.receivedAt
    ? new Date(lastSignalREvent.receivedAt).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      })
    : '--:--:--';
  const lastEventResult = lastSignalREvent
    ? lastSignalREvent.applied
      ? `+${lastSignalREvent.count || 1}`
      : lastSignalREvent.reason || 'Bỏ qua'
    : 'Chưa có event';
  const getStatusBadge = () => {
    switch (signalRState) {
      case signalR.HubConnectionState.Connected:
        return (
          <div className={`badge badge-ok shadow-lg shadow-emerald-500/20 ${isCollapsed ? 'p-2 justify-center' : ''}`}>
            <span className="pulse-dot pulse-dot-green"></span>
            {!isCollapsed && <span>SignalR Live</span>}
          </div>
        );
      case signalR.HubConnectionState.Connecting:
      case signalR.HubConnectionState.Reconnecting:
        return (
          <div className={`badge badge-live ${isCollapsed ? 'p-2 justify-center' : ''}`}>
            <Activity className="w-3.5 h-3.5 animate-spin text-blue-700" />
            {!isCollapsed && <span>Connecting...</span>}
          </div>
        );
      default:
        return (
          <div className={`badge badge-ng ${isCollapsed ? 'p-2 justify-center' : ''}`}>
            <AlertCircle className="w-3.5 h-3.5 text-rose-700" />
            {!isCollapsed && <span>Offline</span>}
          </div>
        );
    }
  };


  return (
    <aside
      className={`fixed top-0 left-0 z-40 h-screen transition-all duration-300 ease-in-out flex flex-col glass-panel border-r border-slate-200 ${isCollapsed ? 'w-20' : 'w-64'
        }`}
    >
      {/* Sidebar Header / Brand Logo */}
      <div className="p-4 border-b border-slate-200 flex items-center relative">
        <a
          href={`#${HOME_TAB}`}
          onClick={(event) => {
            if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              setActiveTab(HOME_TAB);
            }
          }}
          title="Về trang chủ"
          className="flex flex-1 min-w-0 items-center gap-3 overflow-hidden"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 p-0.5 shadow-lg shadow-blue-500/25 flex-shrink-0 flex items-center justify-center">
            <div className="w-full h-full bg-slate-50/80 rounded-[10px] flex items-center justify-center backdrop-blur-md">
              {module?.icon ? (
                <module.icon className={`w-5 h-5 ${module.color || 'text-blue-700'}`} aria-hidden="true" />
              ) : (
                <span className="text-[11px] font-black tracking-tight text-blue-700 font-display" aria-hidden="true">
                  FCT
                </span>
              )}
            </div>
          </div>

          {!isCollapsed && (
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-w-0">
                <span className="block whitespace-nowrap font-extrabold tracking-wide font-display text-base bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-blue-800 to-blue-600">
                  {module?.title || 'FCT System'}
                </span>
              </div>
              <div className="flex min-w-0 items-center">
                <span className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-700 font-mono font-bold">
                  v2.0
                </span>
              </div>
            </div>
          )}
        </a>

        {/* Collapse Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="ml-2 shrink-0 p-1.5 rounded-lg bg-slate-100/80 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors"
          title={isCollapsed ? 'Mở rộng Sidebar' : 'Thu gọn Sidebar'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 py-4 px-3 space-y-5 overflow-y-auto custom-scrollbar">
        <a
          href={`#${HOME_TAB}`}
          onClick={(event) => {
            if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              setActiveTab(HOME_TAB);
            }
          }}
          title="Trang chủ: chọn module"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 border border-slate-200 transition-all"
        >
          <LayoutGrid className="w-5 h-5 flex-shrink-0 text-slate-600" />
          {!isCollapsed && <span className="truncate">Trang chủ</span>}
        </a>

        {(module?.groups || []).map((group) => (
          <div key={group.label}>
            {!isCollapsed && (
              <div className="px-3 mb-2 text-[10px] font-bold text-slate-500 tracking-wider uppercase font-mono">
                {group.label}
              </div>
            )}
            <nav className="space-y-1.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                const count = item.countKey ? counts[item.countKey] : undefined;
                const conflict = item.countKey === 'channels' ? ipConflicts : 0;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(event) => {
                      // Keep modified/middle clicks as real links so pages can be
                      // opened side-by-side in separate tabs.
                      if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                        event.preventDefault();
                        setActiveTab(item.id);
                      }
                    }}
                    title={isCollapsed ? item.label : `${item.label} (Ctrl+click để mở tab mới)`}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all group relative ${isActive
                        ? `bg-gradient-to-r ${item.activeBg} text-white shadow-lg border border-slate-200`
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                  >
                    <Icon
                      className={`w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'text-white' : item.color
                        }`}
                    />
                    {!isCollapsed && <span className="truncate flex-1">{item.label}</span>}
                    {!isCollapsed && conflict > 0 && (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-700 text-[10px] font-bold" title={`${conflict} xung đột IP`}>
                        <AlertTriangle className="w-3 h-3" />{conflict}
                      </span>
                    )}
                    {!isCollapsed && count !== undefined && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${isActive ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-600'}`}>
                        {count}
                      </span>
                    )}
                  </a>
                );
              })}
            </nav>
          </div>
        ))}

        {/* Quick Summary Widget in Sidebar */}
        {!isCollapsed && summaryData && module?.id === 'fct' && (
          <div className="p-3.5 rounded-2xl bg-slate-50/60 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-[11px] text-slate-600 font-mono">
              <span className="flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-blue-700" /> Live Metrics
              </span>
              <span className="text-emerald-700 font-bold">{summaryData.overallYieldRate?.toFixed(1)}% Yield</span>
            </div>

            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-1 font-mono">
                  <span>Inspected:</span>
                  <strong className="text-slate-900">{summaryData.totalInspected?.toLocaleString()}</strong>
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden flex">
                  <div
                    className="bg-emerald-500 h-full"
                    style={{ width: `${summaryData.overallYieldRate || 0}%` }}
                  ></div>
                  <div
                    className="bg-rose-500 h-full"
                    style={{ width: `${100 - (summaryData.overallYieldRate || 0)}%` }}
                  ></div>
                </div>
              </div>

              <div className="flex justify-between text-[10px] text-slate-600 pt-1 font-mono border-t border-slate-200">
                <span>Active Channels:</span>
                <span className="text-blue-700 font-bold">{summaryData.activeChannels}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Footer / Connection Status */}
      <div className="p-3.5 border-t border-slate-200 bg-slate-50/40">
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-start'} gap-2`}>
          {getStatusBadge()}
        </div>
        {!isCollapsed && (
          <div
            className="mt-1.5 flex items-center gap-1 min-w-0 text-[9px] leading-none font-mono tabular-nums text-slate-500"
            title={lastSignalREvent
              ? `${lastSignalREvent.type} · ${lastEventTime} · ${lastEventResult}${lastSignalREvent.inspectTime ? ` · Inspect: ${lastSignalREvent.inspectTime}` : ''}`
              : 'Chưa nhận event production từ SignalR'}
          >
            <span className="shrink-0">Last:</span>
            <span className="shrink-0 text-slate-700">{lastEventTime}</span>
            <span className={`truncate ${lastSignalREvent?.applied ? 'text-emerald-700' : 'text-amber-700'}`}>
              · {lastEventResult}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
