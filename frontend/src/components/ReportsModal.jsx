import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X, Download, ExternalLink, RefreshCw, Presentation } from 'lucide-react';
import { ReportsApi } from '../services/api';

const formatSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

// Browsers can show these inline; PowerPoint/Excel/Word files are downloaded and opened in Office.
const VIEWABLE = new Set(['.pdf', '.html']);

export default function ReportsModal({ open, onClose }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
              <h2 id="reports-modal-title" className="text-base font-bold text-slate-900">Báo cáo họp</h2>
              <p className="text-[11px] text-slate-500">Báo cáo NTF · Re-test · FPY và các báo cáo khác trên server</p>
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
