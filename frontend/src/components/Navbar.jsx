import React from 'react';
import { Activity, Cpu, Database, Server, Zap, AlertCircle, Radio } from 'lucide-react';
import * as signalR from '@microsoft/signalr';

export default function Navbar({ activeTab, setActiveTab, signalRState, summaryData }) {
  const getStatusBadge = () => {
    switch (signalRState) {
      case signalR.HubConnectionState.Connected:
        return (
          <div className="badge badge-ok shadow-lg shadow-emerald-500/20">
            <span className="pulse-dot pulse-dot-green"></span>
            <span>SignalR Live</span>
          </div>
        );
      case signalR.HubConnectionState.Connecting:
      case signalR.HubConnectionState.Reconnecting:
        return (
          <div className="badge badge-live">
            <Activity className="w-3.5 h-3.5 animate-spin text-blue-400" />
            <span>Connecting...</span>
          </div>
        );
      default:
        return (
          <div className="badge badge-ng">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>Offline</span>
          </div>
        );
    }
  };

  return (
    <header className="glass-panel mb-8 px-6 py-4 flex flex-wrap items-center justify-between gap-4 border border-white/10 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/4 w-96 h-24 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Brand Logo & Title */}
      <div className="flex items-center gap-3.5 relative z-10">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 p-0.5 shadow-xl shadow-blue-500/25 flex items-center justify-center">
          <div className="w-full h-full bg-slate-950/80 rounded-[14px] flex items-center justify-center backdrop-blur-md">
            <Cpu className="w-6 h-6 text-blue-400 animate-pulse" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight font-display bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-blue-200">
              PMSystem2
            </h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono font-bold tracking-wider uppercase">
              .NET 8 + TimescaleDB
            </span>
          </div>
          <p className="text-xs text-slate-400 font-medium">Smart SMT Assembly Line Telemetry & Analytics Platform</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center bg-slate-950/70 p-1.5 rounded-2xl border border-white/10 shadow-inner relative z-10">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
            activeTab === 'dashboard'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/35 border border-blue-400/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Activity className={`w-4 h-4 ${activeTab === 'dashboard' ? 'text-white' : 'text-blue-400'}`} />
          Realtime Dashboard
        </button>

        <button
          onClick={() => setActiveTab('master')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
            activeTab === 'master'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/35 border border-blue-400/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Database className={`w-4 h-4 ${activeTab === 'master' ? 'text-white' : 'text-emerald-400'}`} />
          Master Data
        </button>

        <button
          onClick={() => setActiveTab('simulator')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
            activeTab === 'simulator'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/35 border border-blue-400/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Zap className={`w-4 h-4 ${activeTab === 'simulator' ? 'text-white' : 'text-amber-400'}`} />
          PCB Simulator
        </button>
      </div>

      {/* System Status Indicators */}
      <div className="flex items-center gap-4 relative z-10">
        {summaryData && (
          <div className="hidden lg:flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-slate-950/60 border border-white/10 text-xs text-slate-300 font-mono shadow-sm">
            <Radio className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span>Active Channels:</span>
            <strong className="text-blue-300 font-bold">{summaryData.activeChannels}</strong>
          </div>
        )}

        <div>{getStatusBadge()}</div>
      </div>
    </header>
  );
}
