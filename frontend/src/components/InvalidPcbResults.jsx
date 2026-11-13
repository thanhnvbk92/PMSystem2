import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { InvalidPcbResultsApi } from '../services/api';

const formatTime = (value) => value ? new Date(value).toLocaleString() : '-';

export default function InvalidPcbResults() {
  const [data, setData] = useState({ total: 0, open: 0, items: [] });
  const [status, setStatus] = useState('OPEN');
  const [search, setSearch] = useState('');
  const [rawResult, setRawResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await InvalidPcbResultsApi.list({ status, search: search || undefined, rawResult: rawResult || undefined, pageSize: 100 }));
    } catch (err) {
      setError(err.response?.data?.error || 'Không thể tải dữ liệu không hợp lệ.');
    } finally { setLoading(false); }
  }, [status, search, rawResult]);

  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);

  const resolve = async (item) => {
    const note = window.prompt('Ghi chú xử lý:', item.resolutionNote || 'Đã kiểm tra');
    if (note === null) return;
    await InvalidPcbResultsApi.resolve(item.id, note);
    await load();
  };

  return <div className="space-y-5">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="glass-panel border border-rose-500/20 p-5"><div className="text-xs text-slate-600">Đang chờ xử lý</div><div className="text-3xl font-bold text-rose-700 mt-1">{data.open?.toLocaleString()}</div></div>
      <div className="glass-panel border border-slate-200 p-5"><div className="text-xs text-slate-600">Kết quả theo bộ lọc</div><div className="text-3xl font-bold text-slate-900 mt-1">{data.total?.toLocaleString()}</div></div>
      <div className="glass-panel border border-amber-500/20 p-5 flex items-center gap-3"><AlertTriangle className="text-amber-700"/><div className="text-xs text-slate-700">Các bản ghi này được bảo toàn nhưng không tính vào sản lượng và tỷ lệ lỗi.</div></div>
    </div>

    <div className="glass-panel border border-slate-200 p-4 flex flex-wrap gap-3 items-center">
      <div className="relative flex-1 min-w-64"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm PID hoặc nguyên nhân..." className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-10 pr-3 text-sm"/></div>
      <input value={rawResult} onChange={e => setRawResult(e.target.value.toUpperCase())} placeholder="Result gốc" className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm w-40"/>
      <select value={status} onChange={e => setStatus(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"><option value="OPEN">Chưa xử lý</option><option value="RESOLVED">Đã xử lý</option><option value="ALL">Tất cả</option></select>
      <button onClick={load} className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-100 flex gap-2 items-center text-xs"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}/>Làm mới</button>
    </div>

    {error && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-sm">{error}</div>}
    <div className="glass-panel border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-slate-50/70 text-[11px] uppercase text-slate-600"><tr><th className="p-3 w-10"></th><th className="p-3 text-left">PID</th><th className="p-3 text-left">Result gốc</th><th className="p-3 text-left">Channel</th><th className="p-3 text-left">Start time</th><th className="p-3 text-left">Lần nhận cuối</th><th className="p-3 text-right">Số lần</th><th className="p-3 text-left">Trạng thái</th><th className="p-3"></th></tr></thead>
        <tbody className="divide-y divide-slate-200">{data.items?.map(item => <React.Fragment key={item.id}>
          <tr className="hover:bg-slate-100"><td className="p-3"><button onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? <ChevronDown className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}</button></td><td className="p-3 font-mono text-cyan-700">{item.pid || '-'}</td><td className="p-3"><span className="px-2 py-1 rounded bg-rose-500/15 text-rose-700 font-mono">{item.rawResult || '(rỗng)'}</span></td><td className="p-3">{item.channelId ?? '-'}</td><td className="p-3 text-xs">{formatTime(item.startTime)}</td><td className="p-3 text-xs">{formatTime(item.lastSeenAt)}</td><td className="p-3 text-right font-mono">{item.occurrenceCount}</td><td className="p-3"><span className={item.status === 'OPEN' ? 'text-amber-700' : 'text-emerald-700'}>{item.status}</span></td><td className="p-3">{item.status === 'OPEN' && <button onClick={() => resolve(item)} className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-700 text-xs flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/>Đã xử lý</button>}</td></tr>
          {expanded === item.id && <tr><td colSpan="9" className="p-4 bg-slate-50/60"><div className="text-xs text-amber-700 mb-2">{item.reason}</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600 font-mono">{JSON.stringify(JSON.parse(item.payloadJson || '{}'), null, 2)}</pre>{item.resolutionNote && <div className="mt-3 text-xs text-emerald-700">Ghi chú: {item.resolutionNote}</div>}</td></tr>}
        </React.Fragment>)}</tbody>
      </table></div>
      {!loading && !data.items?.length && <div className="p-12 text-center text-slate-500">Không có dữ liệu không hợp lệ phù hợp.</div>}
    </div>
  </div>;
}
