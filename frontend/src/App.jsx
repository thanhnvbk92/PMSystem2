import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import Analytics from './components/Analytics';
import PcbSearch from './components/PcbSearch';
import MasterData from './components/MasterData';
import CommandControl from './components/CommandControl';
import Cpk from './components/Cpk';
import Improvements from './components/Improvements';
import InvalidPcbResults from './components/InvalidPcbResults';
import Home from './components/Home';
import PcMonitor from './components/PcMonitor';
import DiskCleanup from './components/DiskCleanup';
import { HOME_TAB, moduleOfTab, itemOfTab, normalizeTab } from './modules';
import { MasterDataApi, ProductionApi } from './services/api';
import { initSignalR } from './services/signalr';
import * as signalR from '@microsoft/signalr';
import { GlobalLanguageTranslator } from './services/language';


// Production timestamps are factory log clock values stored with a UTC marker.
// Preserve the local clock components when creating filter boundaries so the
// API query and SignalR filtering use the same convention as the source log.
const toProductionClockIso = (date) => new Date(Date.UTC(
  date.getFullYear(), date.getMonth(), date.getDate(),
  date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()
)).toISOString();

const getTodayRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { startDate: toProductionClockIso(start), endDate: toProductionClockIso(end) };
};

// Opening the site without a page (#...) shows the home page with the module tiles.
const getInitialTab = () => normalizeTab(window.location.hash.replace('#', '')) || HOME_TAB;

export default function App() {
  const appInitializedRef = useRef(false);
  const lastProductionFilterRef = useRef(null);
  const productionRequestRef = useRef(0);
  const lastProductionVersionRef = useRef(null);
  const realtimeResultIdsRef = useRef(new Set());
  const counterSyncInFlightRef = useRef(false);
  const [activeTab, setActiveTabState] = useState(getInitialTab);
  const [language, setLanguage] = useState(() => localStorage.getItem('pmsystem_language') || 'vi');
  const [analyticsInitialFilters, setAnalyticsInitialFilters] = useState(null);
  const changeLanguage = useCallback((value) => {
    const next = value === 'en' ? 'en' : 'vi';
    setLanguage(next);
    localStorage.setItem('pmsystem_language', next);
    document.documentElement.lang = next;
  }, []);

  const setActiveTab = useCallback((requested) => {
    const tab = normalizeTab(requested);
    if (tab) {
      if (tab !== 'analytics') setAnalyticsInitialFilters(null);
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
      const raw = window.location.hash.replace('#', '');
      const hash = normalizeTab(raw) || (raw === '' ? HOME_TAB : null);
      if (hash) {
        if (raw !== hash) window.history.replaceState(null, '', `#${hash}`);
        setActiveTabState(hash);
        localStorage.setItem('pmsystem_active_tab', hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const [signalRState, setSignalRState] = useState(signalR.HubConnectionState.Disconnected);
  const [lastSignalREvent, setLastSignalREvent] = useState(null);
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

  const openImprovementAnalytics = useCallback((improvement) => {
    const now = new Date();
    const requestedEnd = improvement.trackingEnd ? new Date(improvement.trackingEnd) : now;
    setAnalyticsInitialFilters({
      lineId: improvement.lineId ?? null,
      stationId: improvement.stationId ?? null,
      modelId: improvement.modelId ?? null,
      modelName: models.find(model => model.id === improvement.modelId)?.name || '',
      errorCode: improvement.errorCode || '',
      start: improvement.baselineStart ? new Date(improvement.baselineStart) : null,
      end: requestedEnd > now ? now : requestedEnd,
    });
    setActiveTab('analytics');
  }, [models, setActiveTab]);

  // Production State
  const [summary, setSummary] = useState(null);
  const [latestLogs, setLatestLogs] = useState([]);
  const [hourlyStats, setHourlyStats] = useState([]);
  const [productionLoadInfo, setProductionLoadInfo] = useState({ loading: false, durationMs: null, requests: {} });

  // Active filters
  const [activeLineId, setActiveLineId] = useState(null);
  const [activeStationId, setActiveStationId] = useState(null);
  const initialTodayRangeRef = useRef(getTodayRange());
  const [activeStartDate, setActiveStartDate] = useState(initialTodayRangeRef.current.startDate);
  const [activeEndDate, setActiveEndDate] = useState(initialTodayRangeRef.current.endDate);
  const productionFilterRef = useRef({});
  productionFilterRef.current = { activeLineId, activeStationId, activeStartDate, activeEndDate };

  const getProductionFilterMismatch = useCallback((item) => {
    const filter = productionFilterRef.current;
    if (filter.activeLineId != null && Number(item?.lineId) !== Number(filter.activeLineId)) return 'Khác Line';
    if (filter.activeStationId != null && Number(item?.stationId) !== Number(filter.activeStationId)) return 'Khác Station';
    const timestamp = new Date(item?.inspectTime).getTime();
    if (!Number.isFinite(timestamp)) return 'Inspect time không hợp lệ';
    const start = filter.activeStartDate ? new Date(filter.activeStartDate).getTime() : -Infinity;
    let end = filter.activeEndDate ? new Date(filter.activeEndDate).getTime() : Infinity;
    const selectedEnd = filter.activeEndDate ? new Date(filter.activeEndDate) : null;
    if (timestamp < start) return 'Inspect time trước khoảng lọc';
    if (timestamp > end) return 'Inspect time sau khoảng lọc';
    return null;
  }, []);

  const matchesActiveProductionFilter = useCallback((item) => {
    return getProductionFilterMismatch(item) == null;
  }, [getProductionFilterMismatch]);

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
    const requestId = ++productionRequestRef.current;
    const loadStarted = performance.now();
    setProductionLoadInfo(prev => ({ ...prev, loading: true }));
    try {
      const timed = async (name, request) => {
        const started = performance.now();
        const data = await request();
        return { name, data, durationMs: performance.now() - started };
      };
      const results = await Promise.all([
        timed('summary', () => ProductionApi.getSummary(activeLineId, activeStationId, activeStartDate, activeEndDate)),
        timed('latest', () => ProductionApi.getLatest(100, activeLineId, activeStationId, null, null, null, activeStartDate, activeEndDate)),
        timed('hourly', () => ProductionApi.getHourlyStats(24, activeLineId, activeStationId, activeStartDate, activeEndDate)),
      ]);
      if (requestId !== productionRequestRef.current) return;
      const byName = Object.fromEntries(results.map(x => [x.name, x]));
      const sum = byName.summary.data;
      const latest = byName.latest.data;
      const hourly = byName.hourly.data;
      setSummary(sum);
      setLatestLogs(latest || []);
      setHourlyStats(hourly || []);
      setProductionLoadInfo({ loading: false, durationMs: performance.now() - loadStarted,
        requests: Object.fromEntries(results.map(x => [x.name, x.durationMs])) });
    } catch (err) {
      if (requestId !== productionRequestRef.current) return;
      console.error('Failed to load Production Data:', err);
      setProductionLoadInfo(prev => ({ ...prev, loading: false, durationMs: performance.now() - loadStarted }));
    }
  }, [activeLineId, activeStationId, activeStartDate, activeEndDate]);

  const refreshProductionCounters = useCallback(async () => {
    if (counterSyncInFlightRef.current) return;
    counterSyncInFlightRef.current = true;
    try {
      const counters = await ProductionApi.getCounters(
        activeLineId, activeStationId, activeStartDate, activeEndDate);
      setSummary(prev => prev ? { ...prev, ...counters } : prev);
    } catch (err) {
      console.warn('Counter synchronization failed:', err);
    } finally {
      counterSyncInFlightRef.current = false;
    }
  }, [activeLineId, activeStationId, activeStartDate, activeEndDate]);

  useEffect(() => {
    const timer = window.setInterval(refreshProductionCounters, 5000);
    return () => window.clearInterval(timer);
  }, [refreshProductionCounters]);

  // Handle incoming real-time PCB Result via SignalR Hub
  const handlePcbResultReceived = useCallback((newResult) => {
    const receivedAt = new Date();
    if (!matchesActiveProductionFilter(newResult)) {
      setLastSignalREvent({ receivedAt, type: 'PCB Result', applied: false,
        reason: getProductionFilterMismatch(newResult) || 'Ngoài bộ lọc', inspectTime: newResult?.inspectTime });
      return;
    }
    if (newResult?.id != null) {
      if (realtimeResultIdsRef.current.has(newResult.id)) {
        setLastSignalREvent({ receivedAt, type: 'PCB Result', applied: false,
          reason: 'Event trùng', inspectTime: newResult?.inspectTime });
        return;
      }
      if (realtimeResultIdsRef.current.size > 2000) realtimeResultIdsRef.current.clear();
      realtimeResultIdsRef.current.add(newResult.id);
    }
    setLastSignalREvent({ receivedAt, type: 'PCB Result', applied: true,
      count: 1, inspectTime: newResult?.inspectTime });
    setLatestLogs((prev) => {
      const exists = prev.some((item) => item.id === newResult.id);
      if (exists) return prev;
      return [newResult, ...prev.slice(0, 99)];
    });

    setSummary((prev) => {
      if (!prev) return prev;
      const isOk = newResult.result === 'OK' || newResult.result === 'PASS';
      const isNg = newResult.result === 'NG' || newResult.result === 'FAIL';
      const total = prev.totalInspected + 1;
      const ok = prev.totalOk + (isOk ? 1 : 0);
      const ng = prev.totalNg + (isNg ? 1 : 0);
      return { ...prev, totalInspected: total, totalOk: ok, totalNg: ng,
        overallYieldRate: total > 0 ? (ok / total) * 100 : 100 };
    });

  }, [matchesActiveProductionFilter, getProductionFilterMismatch]);

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

  const handleProductionDelta = useCallback((delta) => {
    const receivedAt = new Date();
    const version = Number(delta?.version);
    const previousVersion = lastProductionVersionRef.current;
    if (Number.isFinite(version)) {
      lastProductionVersionRef.current = version;
      if (previousVersion != null && version !== previousVersion + 1) {
        setLastSignalREvent({ receivedAt, type: 'Production Delta', applied: false,
          reason: 'Thiếu phiên bản, đang đồng bộ lại' });
        loadProductionData();
        return;
      }
    }
    const applicable = Array.isArray(delta?.items)
      ? delta.items.filter(matchesActiveProductionFilter)
      : [];
    if (applicable.length === 0) {
      const firstItem = Array.isArray(delta?.items) ? delta.items[0] : null;
      setLastSignalREvent({ receivedAt, type: 'Production Delta', applied: false,
        reason: getProductionFilterMismatch(firstItem) || 'Ngoài bộ lọc', inspectTime: firstItem?.inspectTime });
      return;
    }
    const totals = applicable.reduce((sum, item) => ({
      total: sum.total + Number(item?.total || 0),
      ok: sum.ok + Number(item?.ok || 0),
      ng: sum.ng + Number(item?.ng || 0),
    }), { total: 0, ok: 0, ng: 0 });
    setLastSignalREvent({ receivedAt, type: 'Production Delta', applied: true,
      count: totals.total, inspectTime: applicable[applicable.length - 1]?.inspectTime });
    setSummary((prev) => {
      if (!prev) return prev;
      const total = prev.totalInspected + totals.total;
      const ok = prev.totalOk + totals.ok;
      const ng = prev.totalNg + totals.ng;
      return { ...prev, totalInspected: total, totalOk: ok, totalNg: ng,
        overallYieldRate: total > 0 ? (ok / total) * 100 : 100 };
    });
  }, [matchesActiveProductionFilter, getProductionFilterMismatch, loadProductionData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (signalRState === signalR.HubConnectionState.Connected) loadProductionData();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [signalRState, loadProductionData]);

  useEffect(() => {
    if (!appInitializedRef.current) {
      appInitializedRef.current = true;
      loadMasterData();
    }

    // Initialize once and keep callbacks current when filters change.
    initSignalR(
      handlePcbResultReceived,
      handleStatsReceived,
      (state) => setSignalRState(state),
      handleProductionDelta,
      loadProductionData
    );
  }, [handlePcbResultReceived, handleStatsReceived, handleProductionDelta, loadProductionData]);

  useEffect(() => {
    const filterKey = JSON.stringify([activeLineId, activeStationId, activeStartDate, activeEndDate]);
    if (lastProductionFilterRef.current === filterKey) return;
    lastProductionFilterRef.current = filterKey;
    loadProductionData();
  }, [loadProductionData, activeLineId, activeStationId, activeStartDate, activeEndDate]);

  const masterCounts = useMemo(() => ({
    lines: lines.length,
    stations: stations.length,
    channels: channels.length,
    buyers: buyers.length,
    modelGroups: modelGroups.length,
    models: models.length,
    stationTypes: stationTypes.length,
    deviceTypes: deviceTypes.length,
    devices: devices.length,
  }), [lines, stations, channels, buyers, modelGroups, models, stationTypes, deviceTypes, devices]);

  // Same rule as the Channels page: an IP address used by more than one channel.
  const channelIpConflicts = useMemo(() => {
    const byIp = {};
    channels.forEach(c => {
      const ip = (c.ipAddress || '').trim();
      if (ip && ip !== '127.0.0.1') byIp[ip] = (byIp[ip] || 0) + 1;
    });
    return Object.values(byIp).filter(n => n > 1).length;
  }, [channels]);

  const handleFilterChange = useCallback((lineId, stationId, startDate = null, endDate = null) => {
    setActiveLineId(lineId);
    setActiveStationId(stationId);
    if (startDate !== undefined) setActiveStartDate(startDate);
    if (endDate !== undefined) setActiveEndDate(endDate);
  }, []);

  const isHome = activeTab === HOME_TAB;
  const activeModule = moduleOfTab(activeTab);
  const masterSubTab = activeTab.startsWith('master/') ? activeTab.slice('master/'.length) : null;

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 flex relative overflow-x-hidden">
      <GlobalLanguageTranslator language={language} />
      {/* Sidebar Navigation: pages of the open module (none on the home page) */}
      {!isHome && (
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          signalRState={signalRState}
          lastSignalREvent={lastSignalREvent}
          summaryData={summary}
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
          module={activeModule}
          counts={masterCounts}
          ipConflicts={channelIpConflicts}
        />
      )}

      {/* Main Content Area */}
      <div
        className={`flex-1 transition-all duration-300 ease-in-out flex flex-col min-w-0 min-h-screen p-4 sm:p-6 ${
          isHome ? '' : isCollapsed ? 'ml-20' : 'ml-64'
        }`}
      >
        {/* Top Header */}
        <Header
          activeTab={activeTab}
          sectionLabel={masterSubTab ? itemOfTab(activeTab)?.label : null}
          moduleTitle={activeModule?.title}
          onRefresh={() => {
            loadMasterData();
            loadProductionData();
          }}
          summaryData={summary}
          language={language}
          onLanguageChange={changeLanguage}
        />

        {/* Database Connection Alert */}
        {dbError && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-sm flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <strong className="block text-slate-900 font-semibold">Cảnh báo kết nối CSDL:</strong>
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
          {isHome && <Home setActiveTab={setActiveTab} summaryData={summary} counts={masterCounts} />}

          {activeTab === 'dashboard' && (
            <Dashboard
              summary={summary}
              hourlyStats={hourlyStats}
              lines={lines}
              stations={stations}
              startDate={activeStartDate}
              endDate={activeEndDate}
              onFilterChange={handleFilterChange}
              initialFilters={analyticsInitialFilters}
              productionLoadInfo={productionLoadInfo}
            />
          )}

          {activeTab === 'analytics' && (
            <Analytics
              lines={lines}
              stations={stations}
              channels={channels}
              startDate={activeStartDate}
              endDate={activeEndDate}
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

          {activeTab === 'cpk' && <Cpk lines={lines} stations={stations} channels={channels} />}

          {activeTab === 'improvements' && <Improvements lines={lines} stations={stations} models={models} onAnalyze={openImprovementAnalytics} />}

          {activeTab === 'invalid-results' && <InvalidPcbResults />}

          {(activeTab === 'pc-overview' || activeTab === 'pc-list') && (
            <PcMonitor view={activeTab === 'pc-list' ? 'list' : 'overview'} channels={channels} stations={stations} lines={lines} onMasterDataChanged={loadMasterData} />
          )}

          {activeTab === 'pc-disk-cleanup' && <DiskCleanup channels={channels} />}

          {activeTab === 'command' && (
            <CommandControl
              lines={lines}
              stations={stations}
              channels={channels}
              onRefreshMasterData={loadMasterData}
            />
          )}

          {masterSubTab && (
            <MasterData
              subTab={masterSubTab}
              onSubTabChange={(subTab) => setActiveTab(`master/${subTab}`)}
              hideTabBar
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
        <footer className="mt-12 py-6 border-t border-slate-200 text-center text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono">
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
