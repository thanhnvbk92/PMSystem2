import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, RefreshCw, Eye, ShieldCheck, 
  X, FileSpreadsheet, Download, AlertTriangle, Calendar, Clock
} from 'lucide-react';
import { ProductionApi } from '../services/api';

function MultiCheckboxSelect({ label, options, selectedIds, onChange }) {
  const ref = useRef(null);
  const selected = new Set(selectedIds);
  const summary = selectedIds.length === 0 ? `Tất cả ${label} (${options.length})` : selectedIds.length === 1
    ? options.find(item => item.id === selectedIds[0])?.label || `1 ${label}`
    : `Đã chọn ${selectedIds.length} ${label}`;

  useEffect(() => {
    const close = event => { if (ref.current?.open && !ref.current.contains(event.target)) ref.current.removeAttribute('open'); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  return (
    <details ref={ref} className="relative z-[60] min-w-52">
      <summary className="list-none cursor-pointer select-none bg-slate-50/90 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 hover:border-blue-500 flex items-center justify-between gap-3">
        <span className="truncate">{summary}</span><span className="text-slate-500 text-[10px]">▼</span>
      </summary>
      <div className="absolute left-0 top-full mt-1 z-[70] w-full min-w-64 max-h-72 overflow-y-auto rounded-xl border border-slate-300 bg-slate-50 p-2 shadow-2xl custom-scrollbar">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-800 hover:bg-slate-200">
          <input type="checkbox" checked={selectedIds.length === 0} onChange={() => onChange([])} className="h-4 w-4 accent-blue-500" />
          <span>Tất cả {label} ({options.length})</span>
        </label>
        <div className="my-1 border-t border-slate-200" />
        {options.map(option => <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-700 hover:bg-slate-200 hover:text-slate-900">
          <input type="checkbox" checked={selected.has(option.id)} onChange={() => onChange(selected.has(option.id) ? selectedIds.filter(id => id !== option.id) : [...selectedIds, option.id])} className="h-4 w-4 accent-blue-500" />
          <span className="truncate" title={option.label}>{option.label}</span>
        </label>)}
      </div>
    </details>
  );
}

export default function PcbSearch({ lines, stations, channels = [], onFilterChange }) {
  const [selectedLines, setSelectedLines] = useState([]);
  const [selectedStations, setSelectedStations] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [resultFilter, setResultFilter] = useState('ALL'); // ALL, OK, NG
  const [searchPid, setSearchPid] = useState('');
  const [searchFid, setSearchFid] = useState('');
  const [searchError, setSearchError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeModalItem, setActiveModalItem] = useState(null);
  const [isExportingServer, setIsExportingServer] = useState(false);
  const [exportWarningModal, setExportWarningModal] = useState(null);

  // Server-side search results state & search duration timer
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchExecutionTime, setSearchExecutionTime] = useState(null);

  // Execute server-side search across full PostgreSQL database with execution timer
  const executeSearch = async (lineIds, stationIds, channelIds, pid, fid, error, filter, start, end) => {
    setIsSearching(true);
    const startTime = performance.now();
    try {
      const formattedStart = start ? new Date(start).toISOString() : null;
      const formattedEnd = end ? new Date(end).toISOString() : null;
      const data = await ProductionApi.getLatest(500, null, null, pid, fid, error, filter, formattedStart, formattedEnd, lineIds, stationIds, channelIds);
      const endTime = performance.now();
      setSearchExecutionTime((endTime - startTime).toFixed(1));
      setSearchResults(data || []);
    } catch (err) {
      console.error('Error executing PCB search:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleManualSearch = () => {
    executeSearch(selectedLines, selectedStations, selectedChannels, searchPid, searchFid, searchError, resultFilter, startDate, endDate);
  };

  // Run search on initial component mount
  useEffect(() => {
    handleManualSearch();
  }, []);

  const handleLineChange = values => {
    setSelectedLines(values);
    const validStations = new Set(stations.filter(station => values.length === 0 || values.includes(station.lineId)).map(station => station.id));
    setSelectedStations(current => current.filter(id => validStations.has(id)));
    setSelectedChannels(current => current.filter(id => channels.some(channel => channel.id === id && (values.length === 0 || values.includes(channel.lineId)))));
    onFilterChange(null, null);
  };

  const handleStationChange = values => {
    setSelectedStations(values);
    setSelectedChannels(current => current.filter(id => channels.some(channel => channel.id === id && (values.length === 0 || values.includes(channel.stationId)))));
    onFilterChange(null, null);
  };

  const resetFilters = () => {
    setSelectedLines([]);
    setSelectedStations([]);
    setSelectedChannels([]);
    setResultFilter('ALL');
    setSearchPid('');
    setSearchFid('');
    setSearchError('');
    setStartDate('');
    setEndDate('');
    onFilterChange(null, null);
  };

  const setPresetToday = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    // Format to YYYY-MM-DDTHH:mm for datetime-local input
    const toLocalIso = (d) => {
      const tzOffset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    };

    setStartDate(toLocalIso(start));
    setEndDate(toLocalIso(end));
  };

  const setPresetLast24h = () => {
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const toLocalIso = (d) => {
      const tzOffset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    };
    setStartDate(toLocalIso(start));
    setEndDate(toLocalIso(now));
  };

  const setPresetLast7Days = () => {
    const now = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const toLocalIso = (d) => {
      const tzOffset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    };
    setStartDate(toLocalIso(start));
    setEndDate(toLocalIso(now));
  };

  const filteredStations = selectedLines.length > 0 ? stations.filter(station => selectedLines.includes(station.lineId)) : stations;
  const filteredChannels = channels.filter(channel =>
    (selectedLines.length === 0 || selectedLines.includes(channel.lineId)) &&
    (selectedStations.length === 0 || selectedStations.includes(channel.stationId)));

  // Download test steps (value + spec) as CSV: one row per step, for the given PCB records
  const downloadStepsCsv = (logs, fileTag) => {
    if (!logs || logs.length === 0) return;
    const escape = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const pad = (n) => String(n).padStart(2, '0');
    const formatTime = (value) => {
      const d = new Date(value);
      return isNaN(d) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const headers = [
      "Thời gian kiểm tra", "Mã PCB (PID)", "FID", "Dây chuyền", "Trạm", "Channel", "IP Máy", "JobFile",
      "Kết quả PCB", "Step #", "Tên step", "Phân loại", "Giá trị đo", "Spec Min", "Spec Max", "Kết quả step"
    ];
    const rows = [];
    logs.forEach(l => {
      const channelIp = l.channelIp || (channels && channels.find(c => c.id === l.channelId)?.ipAddress) || '';
      const base = [formatTime(l.inspectTime), l.pid, l.fid, l.lineName, l.stationName, l.channelName, channelIp, l.jobFile, l.result];
      (l.steps || []).forEach((s, idx) => {
        rows.push([
          ...base,
          s.stepNumber ?? s.step_number ?? idx + 1,
          s.stepName ?? s.step_name,
          s.stepType ?? s.step_type,
          s.value ?? s.val,
          s.specMin ?? s.spec_min,
          s.specMax ?? s.spec_max,
          s.result
        ].map(escape).join(","));
      });
    });
    const csvContent = "﻿" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.setAttribute("download", `PMSystem_Steps_${fileTag}_${timestamp}.csv`.replace(/[\\/:*?"<>|]/g, '_'));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export filtered search results to CSV (Local Client Export)
  const exportToCsv = () => {
    if (!searchResults || searchResults.length === 0) return;
    
    const headers = [
      "ID",
      "Mã PCB (PID)",
      "Tên Lỗi (Defect Name)",
      "Tên Channel (Máy)",
      "Địa chỉ IP Channel",
      "Dây Chuyền (Line)",
      "Trạm Kiểm Tra (Station)",
      "Thời Gian Kiểm Tra (Full Timestamp)",
      "Ngày Test",
      "Giờ Test",
      "Kết quả (Result)",
      "JobFile / Model",
      "Chi tiết Steps Lỗi (Failed Steps)"
    ];

    const rows = searchResults.map(l => {
      const dateObj = new Date(l.inspectTime);
      const fullTimeStr = !isNaN(dateObj) ? dateObj.toLocaleString('vi-VN') : '';
      const dateStr = !isNaN(dateObj) 
        ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`
        : '';
      const timeStr = !isNaN(dateObj)
        ? `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}:${String(dateObj.getSeconds()).padStart(2, '0')}`
        : '';

      // Extract JobFile / Model name
      let jobFile = l.jobFile || l.job_file || "";
      if (!jobFile && l.pid) {
        const parts = l.pid.split(/[-_/]/).filter(Boolean);
        if (parts.length > 1) jobFile = parts[0];
        else jobFile = l.pid;
      }
      if (!jobFile) jobFile = "DEFAULT_JOB";

      // Lookup channel IP
      let channelIp = l.channelIp || '';
      if (!channelIp && channels && channels.length > 0) {
        const ch = channels.find(c => c.id === l.channelId || c.name === l.channelName);
        if (ch) channelIp = ch.ipAddress || '';
      }

      // Error code
      const errorCode = l.errorCode || (l.result === 'NG' || l.result === 'FAIL' ? 'DEFECT_UNSPECIFIED' : 'OK');

      // Failed steps detail
      let failedStepsStr = 'N/A';
      if (l.steps && Array.isArray(l.steps)) {
        const failed = l.steps.filter(s => s.result !== 'OK' && s.result !== 'PASS');
        if (failed.length > 0) {
          failedStepsStr = failed.map(s => {
            const sName = s.stepName ?? s.step_name ?? '';
            const sVal = s.value ?? s.val ?? 'NG';
            const sMin = s.specMin ?? s.spec_min;
            const sMax = s.specMax ?? s.spec_max;
            const specStr = (sMin || sMax) ? ` [Min: ${sMin ?? '-'}, Max: ${sMax ?? '-'}]` : '';
            return `${sName}${sName ? ': ' : ''}${sVal}${specStr}`;
          }).join('; ');
        } else if (l.result === 'NG' || l.result === 'FAIL') {
          failedStepsStr = l.errorCode ? `Lỗi hệ thống (${l.errorCode})` : 'Lỗi tổng hợp';
        }
      }

      const escape = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;

      return [
        escape(l.id),
        escape(l.pid),
        escape(errorCode),
        escape(l.channelName),
        escape(channelIp),
        escape(l.lineName),
        escape(l.stationName),
        escape(fullTimeStr),
        escape(dateStr),
        escape(timeStr),
        escape(l.result),
        escape(jobFile),
        escape(failedStepsStr)
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.setAttribute("download", `PMSystem_Production_Export_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export full filtered dataset directly from PostgreSQL backend (Unlimited with warning for > 3000 rows)
  const handleServerExportCsv = async () => {
    setIsExportingServer(true);
    const formattedStart = startDate ? new Date(startDate).toISOString() : null;
    const formattedEnd = endDate ? new Date(endDate).toISOString() : null;

    try {
      // 1. Get total record count for current filter
      const count = await ProductionApi.getExportCount(
        null, null, searchPid, searchFid, searchError, resultFilter,
        formattedStart, formattedEnd, selectedLines, selectedStations, selectedChannels
      );
      
      // 2. Warn if large dataset (> 3000 rows)
      if (count > 3000) {
        setExportWarningModal({
          count,
          lineIds: selectedLines,
          stationIds: selectedStations,
          channelIds: selectedChannels,
          searchPid,
          searchFid,
          searchError,
          resultFilter,
          startDate: formattedStart,
          endDate: formattedEnd
        });
      } else {
        // Download all matching rows directly
        await ProductionApi.downloadExportCsv(
          null, null, null, searchPid, searchFid, searchError, resultFilter,
          formattedStart, formattedEnd, selectedLines, selectedStations, selectedChannels
        );
      }
    } catch (err) {
      console.error('Lỗi xuất CSV từ server:', err);
    } finally {
      setIsExportingServer(false);
    }
  };

  const confirmDownloadAll = async () => {
    if (!exportWarningModal) return;
    const { lineIds, stationIds, channelIds, searchPid, searchFid, searchError, resultFilter, startDate: start, endDate: end } = exportWarningModal;
    setExportWarningModal(null);
    setIsExportingServer(true);
    try {
      await ProductionApi.downloadExportCsv(
        null, null, null, searchPid, searchFid, searchError, resultFilter,
        start, end, lineIds, stationIds, channelIds
      );
    } catch (err) {
      console.error('Lỗi xuất dữ liệu lớn CSV:', err);
    } finally {
      setIsExportingServer(false);
    }
  };

  const okCount = searchResults.filter(l => l.result === 'OK' || l.result === 'PASS').length;
  const ngCount = searchResults.filter(l => l.result === 'NG' || l.result === 'FAIL').length;

  return (
    <div className="space-y-6 w-full animate-in fade-in duration-300">
      
      {/* FILTER & SEARCH CONTROL BAR */}
      <div className="glass-panel relative z-20 p-6 w-full space-y-4">
        <div className="flex flex-col gap-4">
          
          {/* PID Barcode Search Input & Search Button: own full-width row so PID stays readable */}
          <div className="flex flex-col md:flex-row md:items-center gap-2 w-full">
            <div className="relative md:flex-[2] min-w-0">
              <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                type="text"
                placeholder="Nhập PID (mã vạch PCB), nhấn Enter để tìm..."
                title="Nhập mã vạch PCB (PID Barcode), nhấn Enter hoặc bấm Tìm kiếm"
                value={searchPid}
                onChange={(e) => setSearchPid(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                className="w-full bg-slate-50/90 border border-slate-300 rounded-xl pl-11 pr-9 py-3 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono shadow-inner"
              />
              {searchPid && (
                <button 
                  onClick={() => setSearchPid('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="relative md:flex-1 min-w-0">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-violet-700" />
              <input type="text" placeholder="Nhập FID..." value={searchFid} onChange={(e) => setSearchFid(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()} className="w-full bg-slate-50/90 border border-slate-300 rounded-xl pl-10 pr-9 py-3 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-violet-500 font-mono shadow-inner" />
              {searchFid && <button onClick={() => setSearchFid('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"><X className="w-4 h-4" /></button>}
            </div>

            <div className="relative md:flex-1 min-w-0">
              <AlertTriangle className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-rose-700" />
              <input
                type="text"
                placeholder="Tên hoặc mã lỗi (ví dụ READ_FID)..."
                value={searchError}
                onChange={(e) => setSearchError(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                className="w-full bg-slate-50/90 border border-slate-300 rounded-xl pl-10 pr-9 py-3 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono shadow-inner"
              />
              {searchError && (
                <button onClick={() => setSearchError('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Dedicated Search Action Button */}
            <button
              onClick={handleManualSearch}
              disabled={isSearching}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold justify-center flex items-center gap-2 transition-all shadow-lg shadow-blue-600/30 font-sans disabled:opacity-50 whitespace-nowrap active:scale-95"
              title="Bấm để kích hoạt tìm kiếm PCB trong cơ sở dữ liệu"
            >
              {isSearching ? <RefreshCw className="w-4 h-4 animate-spin text-slate-900" /> : <Search className="w-4 h-4 text-slate-900" />}
              <span>Tìm kiếm</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            
            <MultiCheckboxSelect
              label="Dây chuyền"
              options={[...lines].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })).map(line => ({ id: line.id, label: line.name }))}
              selectedIds={selectedLines}
              onChange={handleLineChange}
            />

            <MultiCheckboxSelect
              label="Trạm"
              options={filteredStations.map(station => ({ id: station.id, label: `${station.name} (${station.lineName || ''})` }))}
              selectedIds={selectedStations}
              onChange={handleStationChange}
            />

            <MultiCheckboxSelect
              label="Channel"
              options={filteredChannels.map(channel => ({ id: channel.id, label: channel.name || `Channel #${channel.id}` }))}
              selectedIds={selectedChannels}
              onChange={setSelectedChannels}
            />

            {/* Result Filter Toggle Buttons */}
            <div className="flex items-center bg-slate-50/90 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setResultFilter('ALL')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all font-sans ${
                  resultFilter === 'ALL' ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tất cả
              </button>
              <button
                onClick={() => setResultFilter('OK')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all font-sans ${
                  resultFilter === 'OK' ? 'bg-emerald-600/30 text-emerald-700 border border-emerald-500/40' : 'text-slate-600 hover:text-emerald-700'
                }`}
              >
                Chỉ OK
              </button>
              <button
                onClick={() => setResultFilter('NG')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all font-sans ${
                  resultFilter === 'NG' ? 'bg-rose-600/30 text-rose-700 border border-rose-500/40' : 'text-slate-600 hover:text-rose-700'
                }`}
              >
                Chỉ NG
              </button>
            </div>

            {/* Export CSV Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={exportToCsv}
                disabled={searchResults.length === 0}
                className="px-3.5 py-2.5 rounded-xl bg-emerald-50/60 hover:bg-emerald-100/80 text-emerald-700 border border-emerald-700/60 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-sans shadow-sm"
                title="Xuất nhanh dữ liệu đang hiển thị ra file CSV"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                Xuất CSV ({searchResults.length})
              </button>

              <button
                onClick={() => downloadStepsCsv(searchResults, `${searchResults.length}PCB`)}
                disabled={searchResults.length === 0}
                className="px-3.5 py-2.5 rounded-xl bg-violet-50/60 hover:bg-violet-100/80 text-violet-700 border border-violet-700/60 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-sans shadow-sm"
                title="Tải giá trị đo và spec của từng step của các PCB đang hiển thị (mỗi step 1 dòng)"
              >
                <Download className="w-4 h-4 text-violet-700" />
                Tải Steps ({searchResults.length})
              </button>

              <button
                onClick={handleServerExportCsv}
                disabled={isExportingServer}
                className="px-3.5 py-2.5 rounded-xl bg-blue-50/60 hover:bg-blue-100/80 text-blue-700 border border-blue-700/60 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-sans shadow-sm"
                title="Tải file báo cáo CSV đầy đủ từ Server PostgreSQL"
              >
                <Download className="w-4 h-4 text-blue-700" />
                {isExportingServer ? 'Đang xuất...' : 'Tải CSV Server'}
              </button>
            </div>

            {/* Reset Filters */}
            {(selectedLines.length > 0 || selectedStations.length > 0 || selectedChannels.length > 0 || resultFilter !== 'ALL' || searchPid || searchFid || searchError || startDate || endDate) && (
              <button
                onClick={resetFilters}
                className="p-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                title="Reset tất cả bộ lọc"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* DATE & TIME RANGE FILTER ROW WITH POPUP PICKER */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 font-sans font-medium">
              <Calendar className="w-4 h-4 text-blue-700" />
              <span>Khoảng thời gian:</span>
            </div>

            {/* Date and time are separate so operators can type the hour directly. */}
            <div className="flex items-center gap-2 bg-slate-50/90 border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-900">
              <span className="text-slate-600 text-[11px] font-sans">Từ:</span>
              <input
                type="date"
                value={startDate.slice(0, 10)}
                onChange={(e) => setStartDate(e.target.value ? `${e.target.value}T${startDate.slice(11, 16) || '00:00'}` : '')}
                className="bg-transparent text-xs text-slate-900 focus:outline-none font-mono [color-scheme:light]"
              />
              <div className="flex items-center gap-1 font-mono">
                <select
                  aria-label="Giờ bắt đầu (24 giờ)"
                  disabled={!startDate}
                  value={startDate.slice(11, 13)}
                  onChange={(e) => setStartDate(`${startDate.slice(0, 10)}T${e.target.value}:${startDate.slice(14, 16) || '00'}`)}
                  className="bg-slate-100 rounded px-1 py-0.5 text-xs text-slate-900 disabled:opacity-40"
                >
                  {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')).map(hour => <option key={hour} value={hour}>{hour}</option>)}
                </select>
                <span>:</span>
                <select
                  aria-label="Phút bắt đầu"
                  disabled={!startDate}
                  value={startDate.slice(14, 16)}
                  onChange={(e) => setStartDate(`${startDate.slice(0, 10)}T${startDate.slice(11, 13) || '00'}:${e.target.value}`)}
                  className="bg-slate-100 rounded px-1 py-0.5 text-xs text-slate-900 disabled:opacity-40"
                >
                  {Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0')).map(minute => <option key={minute} value={minute}>{minute}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-slate-50/90 border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-900">
              <span className="text-slate-600 text-[11px] font-sans">Đến:</span>
              <input
                type="date"
                value={endDate.slice(0, 10)}
                onChange={(e) => setEndDate(e.target.value ? `${e.target.value}T${endDate.slice(11, 16) || '23:59'}` : '')}
                className="bg-transparent text-xs text-slate-900 focus:outline-none font-mono [color-scheme:light]"
              />
              <div className="flex items-center gap-1 font-mono">
                <select
                  aria-label="Giờ kết thúc (24 giờ)"
                  disabled={!endDate}
                  value={endDate.slice(11, 13)}
                  onChange={(e) => setEndDate(`${endDate.slice(0, 10)}T${e.target.value}:${endDate.slice(14, 16) || '59'}`)}
                  className="bg-slate-100 rounded px-1 py-0.5 text-xs text-slate-900 disabled:opacity-40"
                >
                  {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')).map(hour => <option key={hour} value={hour}>{hour}</option>)}
                </select>
                <span>:</span>
                <select
                  aria-label="Phút kết thúc"
                  disabled={!endDate}
                  value={endDate.slice(14, 16)}
                  onChange={(e) => setEndDate(`${endDate.slice(0, 10)}T${endDate.slice(11, 13) || '23'}:${e.target.value}`)}
                  className="bg-slate-100 rounded px-1 py-0.5 text-xs text-slate-900 disabled:opacity-40"
                >
                  {Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0')).map(minute => <option key={minute} value={minute}>{minute}</option>)}
                </select>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={setPresetToday}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-sans transition-colors"
                title="Lọc dữ liệu kiểm tra trong ngày hôm nay"
              >
                Hôm nay
              </button>
              <button
                onClick={setPresetLast24h}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-sans transition-colors"
                title="Lọc dữ liệu 24 giờ vừa qua"
              >
                24h qua
              </button>
              <button
                onClick={setPresetLast7Days}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-sans transition-colors"
                title="Lọc dữ liệu 7 ngày vừa qua"
              >
                7 ngày qua
              </button>
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-50/50 hover:bg-rose-100/60 text-rose-700 border border-rose-800/50 text-xs font-sans transition-colors"
                  title="Xóa bộ lọc ngày giờ"
                >
                  Xóa ngày giờ
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick Result Summary Badges & Search Duration Counter */}
        <div className="flex flex-wrap items-center justify-between text-xs font-mono pt-2 border-t border-slate-200 gap-3">
          <div className="flex items-center gap-4">
            <span className="text-slate-600 font-sans">
              Kết quả từ CSDL PostgreSQL: <strong className="text-slate-900 font-mono">{searchResults.length}</strong> bản ghi {isSearching && <span className="text-blue-700 animate-pulse font-sans">(Đang truy vấn...)</span>}
            </span>
            <span className="text-emerald-700 font-semibold font-sans">● OK: {okCount}</span>
            <span className="text-rose-700 font-semibold font-sans">● NG: {ngCount}</span>
          </div>

          {/* Search Timer Badge */}
          {searchExecutionTime !== null && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-blue-50/60 border border-blue-800/60 text-blue-700 text-xs font-mono shadow-sm" title="Thời gian xử lý truy vấn dữ liệu từ PostgreSQL Server">
              <Clock className="w-3.5 h-3.5 text-blue-700" />
              <span className="font-sans text-slate-600">Thời gian tìm kiếm:</span>
              <strong className="text-slate-900 font-mono">{searchExecutionTime} ms</strong>
            </div>
          )}
        </div>
      </div>

      {/* RESULTS TABLE */}
      <div className="glass-panel p-6 w-full space-y-4">
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/90 text-slate-600 uppercase font-semibold font-display tracking-wider border-b border-slate-200">
              <tr>
                <th className="p-3.5">Thời gian kiểm tra</th>
                <th className="p-3.5">Mã PCB (PID Barcode)</th>
                <th className="p-3.5">FID</th>
                <th className="p-3.5">Dây chuyền</th>
                <th className="p-3.5">Trạm / Channel</th>
                <th className="p-3.5">Jobfile</th>
                <th className="p-3.5">IP Máy</th>
                <th className="p-3.5 text-center">Kết quả</th>
                <th className="p-3.5 text-right">Chi tiết Test Steps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {searchResults && searchResults.length > 0 ? (
                searchResults.map((log) => {
                  const isOk = log.result === 'OK' || log.result === 'PASS';
                  const machineIp = log.channelIp || (channels && channels.find(c => c.id === log.channelId)?.ipAddress) || '-';
                  return (
                    <tr key={log.id} className="hover:bg-slate-200/50 transition-colors">
                      <td className="p-3.5 text-slate-600 whitespace-nowrap">
                        {new Date(log.inspectTime).toLocaleString('vi-VN')}
                      </td>
                      <td className="p-3.5 text-slate-900 font-bold tracking-wide">{log.pid}</td>
                      <td className="p-3.5 text-violet-700 font-mono text-xs">{log.fid || '-'}</td>
                      <td className="p-3.5 text-slate-700 font-sans">{log.lineName}</td>
                      <td className="p-3.5 text-slate-700 font-sans">
                        {log.stationName} <span className="text-slate-500 font-mono text-[11px]">({log.channelName})</span>
                      </td>
                      <td className="p-3.5 text-slate-700 font-mono text-[11px] max-w-[220px] truncate" title={log.jobFile || ''}>
                        {log.jobFile || '-'}
                      </td>
                      <td className="p-3.5 text-slate-700 font-mono text-xs">
                        <span className="px-2 py-1 rounded bg-slate-100 border border-slate-200 text-blue-700">{machineIp}</span>
                      </td>
                      <td className="p-3.5 text-center">
                        {isOk ? (
                          <span className="badge badge-ok font-sans">PASS (OK)</span>
                        ) : (
                          <span className="badge badge-ng font-sans">FAIL {log.errorCode ? `(${log.errorCode})` : ''}</span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => setActiveModalItem(log)}
                          className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-blue-700 hover:text-blue-700 text-xs font-sans transition-colors inline-flex items-center gap-1.5 font-medium"
                        >
                          <Eye className="w-3.5 h-3.5" /> Xem Steps
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-slate-500 font-sans space-y-2">
                    <Search className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                    <p className="text-sm font-semibold text-slate-600">Không tìm thấy bản ghi PCB phù hợp</p>
                    <p className="text-xs text-slate-600">Thử thay đổi từ khóa PID hoặc điều chỉnh lại các bộ lọc Dây chuyền / Trạm kiểm tra.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* INSPECTION TEST STEPS DETAILED MODAL */}
      {activeModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass-panel max-w-3xl w-full p-6 space-y-5 border border-slate-200 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2 font-display">
                  Chi Tiết Bước Kiểm Tra PCB: <span className="text-blue-700 font-mono">{activeModalItem.pid}</span>
                </h3>
                <p className="text-xs text-slate-600 mt-1 font-sans">
                  Trạm: {activeModalItem.stationName} ({activeModalItem.lineName}) - Channel: {activeModalItem.channelName}
                  {(activeModalItem.channelIp || (channels && channels.find(c => c.id === activeModalItem.channelId)?.ipAddress)) && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[11px] border border-blue-800/50">
                      IP: {activeModalItem.channelIp || channels.find(c => c.id === activeModalItem.channelId)?.ipAddress}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setActiveModalItem(null)}
                className="p-1 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-sans">
              <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200">
                <span className="text-slate-600 block mb-0.5">Kết quả Tổng thể:</span>
                <span className={activeModalItem.result === 'OK' || activeModalItem.result === 'PASS' ? 'text-emerald-700 font-bold text-sm' : 'text-rose-700 font-bold text-sm'}>
                  {activeModalItem.result} {activeModalItem.errorCode ? `(${activeModalItem.errorCode})` : ''}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200">
                <span className="text-slate-600 block mb-0.5">Thời gian kiểm tra:</span>
                <span className="text-slate-800 font-mono font-medium text-xs">
                  {new Date(activeModalItem.inspectTime).toLocaleString('vi-VN')}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200">
                <span className="text-slate-600 block mb-0.5">Jobfile:</span>
                <span className="text-slate-800 font-mono font-medium text-xs break-all">
                  {activeModalItem.jobFile || '-'}
                </span>
              </div>
            </div>

            {(() => {
              const modalSteps = (activeModalItem.steps && activeModalItem.steps.length > 0)
                ? activeModalItem.steps
                : ((activeModalItem.result === 'NG' || activeModalItem.result === 'FAIL') ? [{
                    stepNumber: 1,
                    stepName: activeModalItem.errorCode || 'DEFECT_UNSPECIFIED',
                    stepType: 'Mã lỗi tổng hợp',
                    result: 'NG',
                    value: '-',
                    specMin: '-',
                    specMax: '-'
                  }] : []);

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 font-display">
                      <ShieldCheck className="w-4 h-4 text-blue-700" />
                      Danh Sách Tham Số Đo Đạc ({modalSteps.length} Steps)
                    </h4>
                    {activeModalItem.steps && activeModalItem.steps.length > 0 && (
                      <button
                        onClick={() => downloadStepsCsv([activeModalItem], activeModalItem.pid || 'PCB')}
                        className="px-2.5 py-1.5 rounded-lg bg-violet-50/60 hover:bg-violet-100/80 text-violet-700 border border-violet-700/60 text-[11px] font-semibold flex items-center gap-1.5 transition-colors font-sans"
                        title="Tải giá trị đo và spec của các step của PCB này"
                      >
                        <Download className="w-3.5 h-3.5" /> Tải Steps
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl bg-slate-50/80">
                    {modalSteps.length > 0 ? (
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100/90 text-slate-600 uppercase font-semibold text-[11px] border-b border-slate-200 sticky top-0 font-display">
                          <tr>
                            <th className="p-2.5 text-center w-10">#</th>
                            <th className="p-2.5">Tên bước / Linh kiện</th>
                            <th className="p-2.5">Phân loại</th>
                            <th className="p-2.5 text-right">Giá trị đo</th>
                            <th className="p-2.5 text-center">Tiêu chuẩn (Min~Max)</th>
                            <th className="p-2.5 text-center">Kết quả</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 font-mono">
                          {modalSteps.map((step, idx) => {
                            const isStepNg = step.result !== 'OK' && step.result !== 'PASS';
                            const name = step.stepName ?? step.step_name ?? '';
                            
                            const rawStepType = step.stepType || step.step_type;
                            const displayStepType = (rawStepType && rawStepType !== name) ? rawStepType : (isStepNg ? 'Mã lỗi' : 'Bước kiểm tra');
                            const minVal = step.specMin ?? step.spec_min;
                            const maxVal = step.specMax ?? step.spec_max;
                            const hasSpec = (minVal !== null && minVal !== undefined && String(minVal).trim() !== '' && String(minVal).trim() !== '-') || (maxVal !== null && maxVal !== undefined && String(maxVal).trim() !== '' && String(maxVal).trim() !== '-');
                            
                            const rawVal = step.value ?? step.val;
                            const displayVal = (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '' && String(rawVal).trim() !== '-') ? rawVal : '-';

                            return (
                              <tr key={idx} className={`transition-colors ${isStepNg ? 'bg-rose-50/40 hover:bg-rose-100/50' : 'hover:bg-slate-100/50'}`}>
                                <td className="p-2.5 text-center text-slate-500">{step.stepNumber || step.step_number || idx + 1}</td>
                                <td className={`p-2.5 font-sans font-medium ${isStepNg ? 'text-rose-700 font-semibold flex items-center gap-1.5' : 'text-slate-800'}`}>
                                  {isStepNg && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>}
                                  {name}
                                </td>
                                <td className="p-2.5 text-slate-600 font-sans text-[11px]">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">{displayStepType}</span>
                                </td>
                                <td className={`p-2.5 text-right font-bold ${isStepNg ? 'text-rose-700' : 'text-blue-700'}`}>
                                  {displayVal}
                                </td>
                                <td className="p-2.5 text-center text-slate-600 text-[11px]">
                                  {hasSpec ? `${minVal ?? '-'} ~ ${maxVal ?? '-'}` : '-'}
                                </td>
                                <td className="p-2.5 text-center">
                                  <span className={!isStepNg ? 'badge badge-ok font-sans' : 'badge badge-ng font-sans'}>
                                    {step.result}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-6 text-center text-slate-600 text-xs space-y-1 font-sans">
                        <p className="text-emerald-700 font-semibold text-sm">Bo mạch kiểm tra ĐẠT (PASS/OK)</p>
                        <p className="text-xs text-slate-600">Tất cả các bước kiểm tra quy chuẩn đều đạt yêu cầu.</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setActiveModalItem(null)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all font-sans"
              >
                Đóng cửa sổ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Large Data Warning Modal */}
      {exportWarningModal && (
        <div className="fixed inset-0 bg-slate-50/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-100 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-700">
              <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Cảnh Báo Dữ Liệu Lớn</h3>
                <p className="text-xs text-amber-700/90 font-mono">
                  Phát hiện {exportWarningModal.count.toLocaleString('vi-VN')} bản ghi
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed font-sans">
              Bộ lọc tìm kiếm hiện tại chứa tổng cộng <strong className="text-amber-700 font-mono">{exportWarningModal.count.toLocaleString('vi-VN')}</strong> dòng dữ liệu kiểm tra sản xuất. 
              Việc tải toàn bộ dữ liệu có thể tốn vài giây xử lý và khởi tạo tập tin CSV lớn.
            </p>

            <div className="bg-slate-50/60 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span>Tổng số bản ghi:</span>
                <span className="text-slate-900 font-semibold">{exportWarningModal.count.toLocaleString('vi-VN')} dòng</span>
              </div>
              <div className="flex justify-between">
                <span>Kích thước file ước tính:</span>
                <span className="text-emerald-700 font-semibold">~{(exportWarningModal.count * 0.22 / 1024).toFixed(1)} MB</span>
              </div>
              <div className="flex justify-between">
                <span>Giới hạn tải xuống:</span>
                <span className="text-amber-700 font-semibold">Không giới hạn (Tải hết)</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setExportWarningModal(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold transition-colors font-sans"
              >
                Hủy bỏ
              </button>
              <button
                onClick={confirmDownloadAll}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-bold transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 font-sans"
              >
                <Download className="w-4 h-4" />
                Vẫn Tải Tất Cả ({exportWarningModal.count.toLocaleString('vi-VN')} dòng)
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
