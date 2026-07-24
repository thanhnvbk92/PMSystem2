import React from 'react';
import {
  Activity,
  Cpu,
  Database,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Search,
  Layers
} from 'lucide-react';
import * as signalR from '@microsoft/signalr';

export default function Sidebar({
  activeTab,
  setActiveTab,
  signalRState,
  summaryData,
  isCollapsed,
  setIsCollapsed
}) {
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
            <Activity className="w-3.5 h-3.5 animate-spin text-blue-400" />
            {!isCollapsed && <span>Connecting...</span>}
          </div>
        );
      default:
        return (
          <div className={`badge badge-ng ${isCollapsed ? 'p-2 justify-center' : ''}`}>
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            {!isCollapsed && <span>Offline</span>}
          </div>
        );
    }
  };

  const navItems = [
    {
      id: 'dashboard',
      label: 'Tổng Quan (Dashboard)',
      category: 'MONITORING',
      icon: Activity,
      color: 'text-blue-400',
      activeBg: 'from-blue-600 to-indigo-600',
    },
    {
      id: 'analytics',
      label: 'Phân Tích Dữ Liệu',
      category: 'ANALYTICS',
      icon: BarChart3,
      color: 'text-purple-400',
      activeBg: 'from-purple-600 to-indigo-600',
    },
    {
      id: 'pcb-search',
      label: 'Tra Cứu PCB',
      category: 'SEARCH & INSPECT',
      icon: Search,
      color: 'text-emerald-400',
      activeBg: 'from-emerald-600 to-teal-600',
    },
    {
      id: 'master',
      label: 'Master Data',
      category: 'MANAGEMENT',
      icon: Database,
      color: 'text-cyan-400',
      activeBg: 'from-cyan-600 to-blue-600',
    },
  ];

  return (
    <aside
      className={`fixed top-0 left-0 z-40 h-screen transition-all duration-300 ease-in-out flex flex-col glass-panel border-r border-white/10 ${isCollapsed ? 'w-20' : 'w-64'
        }`}
    >
      {/* Sidebar Header / Brand Logo */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between relative">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 p-0.5 shadow-lg shadow-blue-500/25 flex-shrink-0 flex items-center justify-center">
            <div className="w-full h-full bg-slate-950/80 rounded-[10px] flex items-center justify-center backdrop-blur-md">
              <Cpu className="w-5 h-5 text-blue-400 animate-pulse" />
            </div>
          </div>

          {!isCollapsed && (
            <div className="flex flex-col truncate">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold tracking-wider font-display text-lg bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-blue-200">
                  PMSystem2
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono font-bold">
                  v2.0
                </span>
              </div>
              <span className="text-[10px] text-slate-400 truncate">SMT Assembly Telemetry</span>
            </div>
          )}
        </div>

        {/* Collapse Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white border border-white/10 transition-colors"
          title={isCollapsed ? 'Mở rộng Sidebar' : 'Thu gọn Sidebar'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 py-4 px-3 space-y-6 overflow-y-auto custom-scrollbar">
        <div>
          {!isCollapsed && (
            <div className="px-3 mb-2 text-[10px] font-bold text-slate-500 tracking-wider uppercase font-mono">
              Chức Năng Chính
            </div>
          )}
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all group relative ${isActive
                      ? `bg-gradient-to-r ${item.activeBg} text-white shadow-lg border border-white/20`
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                >
                  <Icon
                    className={`w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'text-white' : item.color
                      }`}
                  />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}

                  {isActive && (
                    <span className="absolute right-2 w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Quick Summary Widget in Sidebar */}
        {!isCollapsed && summaryData && (
          <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-white/10 space-y-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span className="flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-blue-400" /> Live Metrics
              </span>
              <span className="text-emerald-400 font-bold">{summaryData.overallYieldRate?.toFixed(1)}% Yield</span>
            </div>

            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-slate-400 mb-1 font-mono">
                  <span>Inspected:</span>
                  <strong className="text-white">{summaryData.totalInspected?.toLocaleString()}</strong>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
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

              <div className="flex justify-between text-[10px] text-slate-400 pt-1 font-mono border-t border-white/5">
                <span>Active Channels:</span>
                <span className="text-blue-300 font-bold">{summaryData.activeChannels}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Footer / Connection Status */}
      <div className="p-3.5 border-t border-white/10 bg-slate-950/40">
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} gap-2`}>
          {getStatusBadge()}
          {!isCollapsed && (
            <span className="text-[10px] font-mono text-slate-500 truncate">
              .NET 8 + Timescale
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
