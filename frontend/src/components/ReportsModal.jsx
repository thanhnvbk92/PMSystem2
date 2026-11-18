import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X, Download, ExternalLink, RefreshCw, Presentation, Play, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ReportsApi } from '../services/api';

const formatSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

// Browsers can show these inline; PowerPoint/Excel/Word files are downloaded and opened in Office.
const VIEWABLE = new Set(['.pdf', '.html']);

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function ReportsModal({ open, onClose }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState(currentMonth);
  const [job, setJob] = useState(null);
  const [jobError, setJobError] = useState(null);
  const running = job?.status === 'running';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await ReportsApi.list());
    } catch (err) {
      console.error('Failed to load reports:', err);
      setError('Không tải được danh sách báo cáo từ server.');
    } finally {
      setLoading(false);
    }
  };

  const refreshJob = async () => {
    try {
      const status = await ReportsApi.generateStatus();
      setJob(prev => {
        // A finished job adds a file: reload the list once.
        if (prev?.status === 'running' && status.status !== 'running') load();
        return status;
      });
    } catch { /* status is optional; ignore */ }
  };

  const startJob = async () => {
    setJobError(null);
    try {
      setJob(await ReportsApi.generate(month));
    } catch (err) {
      setJobError(err.response?.data?.error || 'Không bắt đầu được việc tạo báo cáo.');
      refreshJob();
    }
  };

  // Poll the job while it runs (and once when the dialog opens).
  useEffect(() => {
    if (!open) return undefined;
    refreshJob();
    if (!running) return undefined;
    const timer = window.setInterval(refreshJob, 3000);
    return () => window.clearInterval(timer);
  }, [open, running]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    load();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // Portal: the header's glass panel would otherwise trap the fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reports-modal-title"
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-violet-700" />
            <div>
              <h2 id="reports-modal-title" className="text-base font-bold text-slate-900">Báo cáo tháng</h2>
              <p className="text-[11px] text-slate-500">Monthly Quality Report · NTF · Re-test · RTY</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={load} title="Tải lại danh sách" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} title="Đóng" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="border-b border-slate-100 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="report-month" className="text-xs font-semibold text-slate-600">Tháng</label>
            <input id="report-month" type="month" value={month} max={currentMonth()} onChange={(e) => setMonth(e.target.value)}
                   disabled={running} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800" />
            <button type="button" onClick={startJob} disabled={running || !month}
                    className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {running ? 'Đang tạo…' : 'Xuất báo cáo'}
            </button>
          </div>
          {jobError && <div className="mt-2 text-xs text-rose-700">{jobError}</div>}
          {job && job.status !== 'idle' && (
            <div className={`mt-2 flex items-start gap-1.5 text-xs ${job.status === 'failed' ? 'text-rose-700' : job.status === 'succeeded' ? 'text-emerald-700' : 'text-slate-600'}`}>
              {job.status === 'running' && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
              {job.status === 'succeeded' && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              {job.status === 'failed' && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>
                {job.status === 'running' && `Tháng ${job.month}: ${job.step || 'đang chạy'}…`}
                {job.status === 'succeeded' && `Đã tạo ${job.fileName} (${job.month}).`}
                {job.status === 'failed' && `Tạo báo cáo ${job.month} lỗi: ${job.error || 'không rõ nguyên nhân'}`}
              </span>
            </div>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {error && <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
          {!error && !loading && reports.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-500">Chưa có báo cáo nào trong thư mục Reports.</div>
          )}
          <ul className="divide-y divide-slate-100">
            {reports.map((r) => (
              <li key={r.name} className="flex items-center justify-between gap-3 px-2 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Presentation className="h-5 w-5 shrink-0 text-violet-600" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800" title={r.name}>{r.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {new Date(r.modifiedAt).toLocaleString('vi-VN')} · {formatSize(r.sizeBytes)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {VIEWABLE.has(r.extension) && (
                    <a href={ReportsApi.fileUrl(r.name, false)} target="_blank" rel="noreferrer"
                       className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      <ExternalLink className="h-3.5 w-3.5" /> Xem
                    </a>
                  )}
                  <a href={ReportsApi.fileUrl(r.name, true)}
                     className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500">
                    <Download className="h-3.5 w-3.5" /> {VIEWABLE.has(r.extension) ? 'Tải về' : 'Mở / Tải về'}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body
  );
}
