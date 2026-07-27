import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import Analytics from './components/Analytics';
import PcbSearch from './components/PcbSearch';
import MasterData from './components/MasterData';
import CommandControl from './components/CommandControl';
import { MasterDataApi, ProductionApi } from './services/api';
import { initSignalR } from './services/signalr';
import * as signalR from '@microsoft/signalr';

const VALID_TABS = ['dashboard', 'analytics', 'pcb-search', 'command', 'master'];

const getInitialTab = () => {
  const hash = window.location.hash.replace('#', '');
  if (VALID_TABS.includes(hash)) {
    return hash;
  }
  const savedTab = localStorage.getItem('pmsystem_active_tab');
  if (savedTab && VALID_TABS.includes(savedTab)) {
    return savedTab;
  }
  return 'dashboard';
};

export default function App() {
  const [activeTab, setActiveTabState] = useState(getInitialTab);

  const setActiveTab = useCallback((tab) => {
    if (VALID_TABS.includes(tab)) {
      setActiveTabState(tab);
      window.location.hash = tab;
      localStorage.setItem('pmsystem_active_tab', tab);
    }
  }, []);

  useEffect(() => {
    const currentTab = getInitialTab();
    if (window.location.hash !== `#${currentTab}`) {
      window.location.hash = currentTab;
    }
    localStorage.setItem('pmsystem_active_tab', currentTab);

    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (VALID_TABS.includes(hash)) {
        setActiveTabState(hash);
        localStorage.setItem('pmsystem_active_tab', hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const [signalRState, setSignalRState] = useState(signalR.HubConnectionState.Disconnected);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Master Data State
  const [buyers, setBuyers] = useState([]);
  const [modelGroups, setModelGroups] = useState([]);
  const [models, setModels] = useState([]);
  const [stationTypes, setStationTypes] = useState([]);
  const [lines, setLines] = useState([]);
  const [stations, setStations] = useState([]);
  const [channels, setChannels] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [devices, setDevices] = useState([]);

  // Production State
  const [summary, setSummary] = useState(null);
  const [latestLogs, setLatestLogs] = useState([]);
  const [hourlyStats, setHourlyStats] = useState([]);
  const [newRecordIds, setNewRecordIds] = useState(new Set());

  // Active filters
  const [activeLineId, setActiveLineId] = useState(null);
  const [activeStationId, setActiveStationId] = useState(null);

  // Error state
  const [dbError, setDbError] = useState(null);

  // Load Master Data
  const loadMasterData = async () => {
    try {
      const [b, mg, m, st, l, s, c, dt, d] = await Promise.all([
        MasterDataApi.getBuyers(),
        MasterDataApi.getModelGroups(),
        MasterDataApi.getModels(),
        MasterDataApi.getStationTypes(),
        MasterDataApi.getLines(),
        MasterDataApi.getStations(),
        MasterDataApi.getChannels(),
        MasterDataApi.getDeviceTypes(),
        MasterDataApi.getDevices(),
      ]);
      const sortedLines = [...(l || [])].sort((a, b) => 
        (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
      );
      setBuyers(b || []);
      setModelGroups(mg || []);
      setModels(m || []);
      setStationTypes(st || []);
      setLines(sortedLines);
      setStations(s || []);
      setChannels(c || []);
      setDeviceTypes(dt || []);
      setDevices(d || []);
      setDbError(null);
    } catch (err) {
      console.error('Failed to load Master Data:', err);
      setDbError('Không thể kết nối tới Backend / PostgreSQL Database. Vui lòng kiểm tra lại cấu hình database.');
    }
  };

  // Load Production Summary & Logs
  const loadProductionData = useCallback(async () => {
    try {
      const [sum, latest, hourly] = await Promise.all([
        ProductionApi.getSummary(),
        ProductionApi.getLatest(100, activeLineId, activeStationId),
        ProductionApi.getHourlyStats(24, activeLineId, activeStationId),
      ]);
      setSummary(sum);
      setLatestLogs(latest || []);
      setHourlyStats(hourly || []);
    } catch (err) {
      console.error('Failed to load Production Data:', err);
    }
  }, [activeLineId, activeStationId]);

  // Handle incoming real-time PCB Result via SignalR Hub
  const handlePcbResultReceived = useCallback((newResult) => {
    setLatestLogs((prev) => {
      const exists = prev.some((item) => item.id === newResult.id);
      if (exists) return prev;
      return [newResult, ...prev.slice(0, 99)];
    });

    // Dynamic metrics update
    setSummary((prev) => {
      if (!prev) return prev;
      const isOk = newResult.result === 'OK' || newResult.result === 'PASS';
      const isNg = newResult.result === 'NG' || newResult.result === 'FAIL';
      const total = prev.totalInspected + 1;
      const ok = prev.totalOk + (isOk ? 1 : 0);
      const ng = prev.totalNg + (isNg ? 1 : 0);
      return {
        ...prev,
        totalInspected: total,
        totalOk: ok,
        totalNg: ng,
        overallYieldRate: total > 0 ? (ok / total) * 100 : 100,
      };
    });

    // Row flash animation tracking
    setNewRecordIds((prev) => new Set(prev).add(newResult.id));
    setTimeout(() => {
      setNewRecordIds((prev) => {
        const copy = new Set(prev);
        copy.delete(newResult.id);
        return copy;
      });
    }, 1500);
  }, []);

  // Handle incoming hourly stats broadcast
  const handleStatsReceived = useCallback((stat) => {
    setHourlyStats((prev) => {
      const idx = prev.findIndex((s) => s.bucket === stat.bucket);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = stat;
        return copy;
      }
      return [...prev, stat];
    });
  }, []);

  useEffect(() => {
    loadMasterData();
    loadProductionData();

    // Initialize SignalR Connection
    initSignalR(
      handlePcbResultReceived,
      handleStatsReceived,
      (state) => setSignalRState(state)
    );
  }, [loadProductionData, handlePcbResultReceived, handleStatsReceived]);

  const handleFilterChange = (lineId, stationId) => {
    setActiveLineId(lineId);
    setActiveStationId(stationId);
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex relative overflow-x-hidden">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        signalRState={signalRState}
        summaryData={summary}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 transition-all duration-300 ease-in-out flex flex-col min-w-0 min-h-screen p-4 sm:p-6 ${
          isCollapsed ? 'ml-20' : 'ml-64'
        }`}
      >
        {/* Top Header */}
        <Header
          activeTab={activeTab}
          onRefresh={() => {
            loadMasterData();
            loadProductionData();
          }}
          signalRState={signalRState}
          summaryData={summary}
        />

        {/* Database Connection Alert */}
        {dbError && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <strong className="block text-white font-semibold">Cảnh báo kết nối CSDL:</strong>
                <span>{dbError}</span>
              </div>
            </div>
            <button
              onClick={() => {
                loadMasterData();
                loadProductionData();
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold whitespace-nowrap shadow-lg shadow-rose-600/30 transition-all"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* Main Tab Content */}
        <main className="flex-1 w-full max-w-[1920px]">
          {activeTab === 'dashboard' && (
            <Dashboard
              summary={summary}
              latestLogs={latestLogs}
              hourlyStats={hourlyStats}
              lines={lines}
              stations={stations}
              onFilterChange={handleFilterChange}
              newRecordIds={newRecordIds}
            />
          )}

          {activeTab === 'analytics' && (
            <Analytics
              summary={summary}
              latestLogs={latestLogs}
              hourlyStats={hourlyStats}
              lines={lines}
              stations={stations}
              onFilterChange={handleFilterChange}
            />
          )}

          {activeTab === 'pcb-search' && (
            <PcbSearch
              latestLogs={latestLogs}
              lines={lines}
              stations={stations}
              channels={channels}
              onFilterChange={handleFilterChange}
            />
          )}

          {activeTab === 'command' && (
            <CommandControl
              lines={lines}
              stations={stations}
              channels={channels}
              onRefreshMasterData={loadMasterData}
            />
          )}

          {activeTab === 'master' && (
            <MasterData
              buyers={buyers}
              modelGroups={modelGroups}
              models={models}
              stationTypes={stationTypes}
              lines={lines}
              stations={stations}
              channels={channels}
              deviceTypes={deviceTypes}
              devices={devices}
              onRefresh={loadMasterData}
            />
          )}
        </main>

        {/* Footer */}
        <footer className="mt-12 py-6 border-t border-white/5 text-center text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono">
          <div>
            FCT System Industrial SMT Telemetry System &copy; 2026. Built with .NET 8, SignalR, & TimescaleDB.
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span> PG16 + TimescaleDB
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span> SignalR Engine
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
