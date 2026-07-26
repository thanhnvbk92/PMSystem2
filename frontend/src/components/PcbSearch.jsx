import React, { useState, useEffect } from 'react';
import { 
  Search, RefreshCw, Eye, ShieldCheck, 
  X, FileSpreadsheet, Download, AlertTriangle
} from 'lucide-react';
import { ProductionApi } from '../services/api';

export default function PcbSearch({ lines, stations, channels = [], onFilterChange }) {
  const [selectedLine, setSelectedLine] = useState('');
  const [selectedStation, setSelectedStation] = useState('');
  const [resultFilter, setResultFilter] = useState('ALL'); // ALL, OK, NG
  const [searchPid, setSearchPid] = useState('');
  const [activeModalItem, setActiveModalItem] = useState(null);
  const [isExportingServer, setIsExportingServer] = useState(false);
  const [exportWarningModal, setExportWarningModal] = useState(null);

  // Server-side search results state
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Execute server-side search across full PostgreSQL database
  const executeSearch = async (lineId, stationId, pid, filter) => {
    setIsSearching(true);
    try {
      const data = await ProductionApi.getLatest(500, lineId, stationId, pid, filter);
      setSearchResults(data || []);
    } catch (err) {
      console.error('Error executing PCB search:', err);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const lineId = selectedLine ? parseInt(selectedLine) : null;
    const stationId = selectedStation ? parseInt(selectedStation) : null;
    executeSearch(lineId, stationId, searchPid, resultFilter);
  }, [selectedLine, selectedStation, searchPid, resultFilter]);

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
    setResultFilter('ALL');
    setSearchPid('');
    onFilterChange(null, null);
  };

  const filteredStations = selectedLine 
    ? stations.filter(s => s.lineId === parseInt(selectedLine))
    : stations;

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
      "Ngày Test",
      "Giờ Test",
      "Kết quả (Result)",
      "JobFile / Model",
      "Chi tiết Steps Lỗi (Failed Steps)"
    ];

    const rows = searchResults.map(l => {
      const dateObj = new Date(l.inspectTime);
      const dateStr = !isNaN(dateObj) 
        ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`
        : '';
      const timeStr = !isNaN(dateObj)
        ? `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}:${String(dateObj.getSeconds()).padStart(2, '0')}`
        : '';

      // Extract JobFile / Model name
      let jobFile = "DEFAULT_JOB";
      if (l.pid) {
        const parts = l.pid.split(/[-_/]/).filter(Boolean);
        if (parts.length > 1) jobFile = parts[0];
        else jobFile = l.pid;
      }

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
    const lineId = selectedLine ? parseInt(selectedLine) : null;
    const stationId = selectedStation ? parseInt(selectedStation) : null;
    try {
      // 1. Get total record count for current filter
      const count = await ProductionApi.getExportCount(lineId, stationId, searchPid, resultFilter);
      
      // 2. Warn if large dataset (> 3000 rows)
      if (count > 3000) {
        setExportWarningModal({
          count,
          lineId,
          stationId,
          searchPid,
          resultFilter
        });
      } else {
        // Download all matching rows directly
        await ProductionApi.downloadExportCsv(null, lineId, stationId, searchPid, resultFilter);
      }
    } catch (err) {
      console.error('Lỗi xuất CSV từ server:', err);
    } finally {
      setIsExportingServer(false);
    }
  };

  const confirmDownloadAll = async () => {
    if (!exportWarningModal) return;
    const { lineId, stationId, searchPid, resultFilter } = exportWarningModal;
    setExportWarningModal(null);
    setIsExportingServer(true);
    try {
      await ProductionApi.downloadExportCsv(null, lineId, stationId, searchPid, resultFilter);
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
      <div className="glass-panel p-6 w-full space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          
          {/* PID Barcode Search Input */}
          <div className="relative flex-1 min-w-[280px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Nhập mã vạch PCB (PID Barcode, ví dụ: PCB-9020...)..."
              value={searchPid}
              onChange={(e) => setSearchPid(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono shadow-inner"
            />
            {searchPid && (
              <button 
                onClick={() => setSearchPid('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            
            {/* Line Filter */}
            <select
              value={selectedLine}
              onChange={handleLineChange}
              className="bg-slate-950/90 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 font-sans"
            >
              <option value="">Tất cả Dây Chuyền (Lines)</option>
              {[...lines].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>

            {/* Station Filter */}
            <select
              value={selectedStation}
              onChange={handleStationChange}
              className="bg-slate-950/90 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 font-sans"
            >
              <option value="">Tất cả Trạm (Stations)</option>
              {filteredStations.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.lineName})</option>
              ))}
            </select>

            {/* Result Filter Toggle Buttons */}
            <div className="flex items-center bg-slate-950/90 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setResultFilter('ALL')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all font-sans ${
                  resultFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Tất cả
              </button>
              <button
                onClick={() => setResultFilter('OK')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all font-sans ${
                  resultFilter === 'OK' ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:text-emerald-400'
                }`}
              >
                Chỉ OK
              </button>
              <button
                onClick={() => setResultFilter('NG')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all font-sans ${
                  resultFilter === 'NG' ? 'bg-rose-600/30 text-rose-300 border border-rose-500/40' : 'text-slate-400 hover:text-rose-400'
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
                className="px-3.5 py-2.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/60 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-sans shadow-sm"
                title="Xuất nhanh dữ liệu đang hiển thị ra file CSV (Bao gồm ID, Tên lỗi, IP, Máy, JobFile, Giờ test...)"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                Xuất CSV ({searchResults.length})
              </button>

              <button
                onClick={handleServerExportCsv}
                disabled={isExportingServer}
                className="px-3.5 py-2.5 rounded-xl bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border border-blue-700/60 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-sans shadow-sm"
                title="Tải file báo cáo CSV đầy đủ từ Server PostgreSQL theo bộ lọc (tối đa 2.000 dòng)"
              >
                <Download className="w-4 h-4 text-blue-400" />
                {isExportingServer ? 'Đang xuất...' : 'Tải CSV Server'}
              </button>
            </div>

            {/* Reset Filters */}
            {(selectedLine || selectedStation || resultFilter !== 'ALL' || searchPid) && (
              <button
                onClick={resetFilters}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 transition-colors"
                title="Reset tất cả bộ lọc"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Result Summary Badges */}
        <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-4">
            <span className="text-slate-400 font-sans">
              Kết quả từ CSDL PostgreSQL: <strong className="text-white font-mono">{searchResults.length}</strong> bản ghi {isSearching && <span className="text-blue-400 animate-pulse font-sans">(Đang truy vấn...)</span>}
            </span>
            <span className="text-emerald-400 font-semibold font-sans">● OK: {okCount}</span>
            <span className="text-rose-400 font-semibold font-sans">● NG: {ngCount}</span>
          </div>
        </div>
      </div>

      {/* RESULTS TABLE */}
      <div className="glass-panel p-6 w-full space-y-4">
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/90 text-slate-400 uppercase font-semibold font-display tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3.5">Thời gian kiểm tra</th>
                <th className="p-3.5">Mã PCB (PID Barcode)</th>
                <th className="p-3.5">Dây chuyền</th>
                <th className="p-3.5">Trạm / Channel</th>
                <th className="p-3.5 text-center">Kết quả</th>
                <th className="p-3.5 text-right">Chi tiết Test Steps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {searchResults && searchResults.length > 0 ? (
                searchResults.map((log) => {
                  const isOk = log.result === 'OK' || log.result === 'PASS';
                  return (
                    <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-3.5 text-slate-400 whitespace-nowrap">
                        {new Date(log.inspectTime).toLocaleString('vi-VN')}
                      </td>
                      <td className="p-3.5 text-white font-bold tracking-wide">{log.pid}</td>
                      <td className="p-3.5 text-slate-300 font-sans">{log.lineName}</td>
                      <td className="p-3.5 text-slate-300 font-sans">
                        {log.stationName} <span className="text-slate-500 font-mono text-[11px]">({log.channelName})</span>
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
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 text-xs font-sans transition-colors inline-flex items-center gap-1.5 font-medium"
                        >
                          <Eye className="w-3.5 h-3.5" /> Xem Steps
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-500 font-sans space-y-2">
                    <Search className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                    <p className="text-sm font-semibold text-slate-400">Không tìm thấy bản ghi PCB phù hợp</p>
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass-panel max-w-3xl w-full p-6 space-y-5 border border-white/20 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2 font-display">
                  Chi Tiết Bước Kiểm Tra PCB: <span className="text-blue-400 font-mono">{activeModalItem.pid}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1 font-sans">Trạm: {activeModalItem.stationName} ({activeModalItem.lineName}) - Channel: {activeModalItem.channelName}</p>
              </div>
              <button
                onClick={() => setActiveModalItem(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-sans">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-slate-400 block mb-0.5">Kết quả Tổng thể:</span>
                <span className={activeModalItem.result === 'OK' || activeModalItem.result === 'PASS' ? 'text-emerald-400 font-bold text-sm' : 'text-rose-400 font-bold text-sm'}>
                  {activeModalItem.result} {activeModalItem.errorCode ? `(${activeModalItem.errorCode})` : ''}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-slate-400 block mb-0.5">Thời gian kiểm tra:</span>
                <span className="text-slate-200 font-mono font-medium text-xs">
                  {new Date(activeModalItem.inspectTime).toLocaleString('vi-VN')}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 font-display">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                Danh Sách Tham Số Đo Đạc ({activeModalItem.steps ? activeModalItem.steps.length : 0} Steps)
              </h4>
              <div className="max-h-64 overflow-y-auto border border-slate-800/80 rounded-xl bg-slate-950/80">
                {activeModalItem.steps && activeModalItem.steps.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/90 text-slate-400 uppercase font-semibold text-[11px] border-b border-slate-800 sticky top-0 font-display">
                      <tr>
                        <th className="p-2.5 text-center w-10">#</th>
                        <th className="p-2.5">Tên bước / Linh kiện</th>
                        <th className="p-2.5">Phân loại</th>
                        <th className="p-2.5 text-right">Giá trị đo</th>
                        <th className="p-2.5 text-center">Tiêu chuẩn (Min~Max)</th>
                        <th className="p-2.5 text-center">Kết quả</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {activeModalItem.steps.map((step, idx) => {
                        const isStepNg = step.result !== 'OK' && step.result !== 'PASS';
                        const name = step.stepName ?? step.step_name ?? '';
                        
                        const stepType = step.stepType || step.step_type;
                        const minVal = step.specMin ?? step.spec_min;
                        const maxVal = step.specMax ?? step.spec_max;
                        const hasSpec = (minVal !== null && minVal !== undefined && minVal !== '') || (maxVal !== null && maxVal !== undefined && maxVal !== '');
                        
                        return (
                          <tr key={idx} className={`transition-colors ${isStepNg ? 'bg-rose-950/40 hover:bg-rose-900/50' : 'hover:bg-slate-900/50'}`}>
                            <td className="p-2.5 text-center text-slate-500">{step.stepNumber || step.step_number || idx + 1}</td>
                            <td className={`p-2.5 font-sans font-medium ${isStepNg ? 'text-rose-300 font-semibold flex items-center gap-1.5' : 'text-slate-200'}`}>
                              {isStepNg && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>}
                              {name}
                            </td>
                            <td className="p-2.5 text-slate-400 font-sans text-[11px]">
                              {stepType ? <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{stepType}</span> : '-'}
                            </td>
                            <td className={`p-2.5 text-right font-bold ${isStepNg ? 'text-rose-400' : 'text-blue-400'}`}>
                              {step.value ?? step.val ?? '-'}
                            </td>
                            <td className="p-2.5 text-center text-slate-400 text-[11px]">
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
                  <div className="p-6 text-center text-slate-500 text-xs space-y-1 font-sans">
                    <p>Đã kiểm tra quy chuẩn thành công.</p>
                    <p className="text-[11px] text-slate-600">Dữ liệu tham số chi tiết đã được ghi nhận trong CSDL TimescaleDB.</p>
                  </div>
                )}
              </div>
            </div>

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
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Cảnh Báo Dữ Liệu Lớn</h3>
                <p className="text-xs text-amber-400/90 font-mono">
                  Phát hiện {exportWarningModal.count.toLocaleString('vi-VN')} bản ghi
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              Bộ lọc tìm kiếm hiện tại chứa tổng cộng <strong className="text-amber-300 font-mono">{exportWarningModal.count.toLocaleString('vi-VN')}</strong> dòng dữ liệu kiểm tra sản xuất. 
              Việc tải toàn bộ dữ liệu có thể tốn vài giây xử lý và khởi tạo tập tin CSV lớn.
            </p>

            <div className="bg-slate-950/60 p-3 rounded-xl border border-white/5 text-[11px] text-slate-400 space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span>Tổng số bản ghi:</span>
                <span className="text-white font-semibold">{exportWarningModal.count.toLocaleString('vi-VN')} dòng</span>
              </div>
              <div className="flex justify-between">
                <span>Kích thước file ước tính:</span>
                <span className="text-emerald-400 font-semibold">~{(exportWarningModal.count * 0.22 / 1024).toFixed(1)} MB</span>
              </div>
              <div className="flex justify-between">
                <span>Giới hạn tải xuống:</span>
                <span className="text-amber-300 font-semibold">Không giới hạn (Tải hết)</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setExportWarningModal(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors font-sans"
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
