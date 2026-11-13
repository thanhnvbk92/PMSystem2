import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, ClipboardCheck, Download, LineChart as LineChartIcon, Pencil, Plus, RefreshCw, Target, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ImprovementApi } from '../services/api';

const isoDay = (date) => {
  const local = new Date(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const today = new Date();
const daysAgo = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return isoDay(d); };
const blank = () => ({ title: '', errorCode: '', lineId: '', stationId: '', modelId: '', problemDescription: '', rootCause: '', owner: '', status: 'ACTIVE', baselineStart: daysAgo(60), baselineEnd: daysAgo(30), trackingStart: daysAgo(30), trackingEnd: isoDay(today), targetReductionPercent: 30 });
const localDateBoundary = (date, endOfDay = false) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0).toISOString();
};
const toApi = (x) => ({ ...x, lineId: x.lineId ? Number(x.lineId) : null, stationId: x.stationId ? Number(x.stationId) : null, modelId: x.modelId ? Number(x.modelId) : null, targetReductionPercent: Number(x.targetReductionPercent), baselineStart: localDateBoundary(x.baselineStart), baselineEnd: localDateBoundary(x.baselineEnd, true), trackingStart: localDateBoundary(x.trackingStart), trackingEnd: localDateBoundary(x.trackingEnd, true) });
const pct = (value) => `${Number(value || 0).toFixed(2)}%`;
const trendBucket = (value, level) => {
  const day = isoDay(value);
  if (level === 'day') return day;
  const date = new Date(`${day}T12:00:00`);
  if (level === 'month') date.setDate(1);
  else date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return isoDay(date);
};
const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isoWeekNumber = (value) => {
  const source = new Date(`${value}T12:00:00`);
  const date = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
};
const periodRange = (period) => {
  const end = new Date();
  const start = new Date(end);
  if (period === 'week') {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
  } else {
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

export default function Improvements({ lines, stations, models = [], onAnalyze }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(blank);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorCodes, setErrorCodes] = useState([]);
  const [topDefects, setTopDefects] = useState([]);
  const [defectPeriod, setDefectPeriod] = useState('week');
  const [defectsLoading, setDefectsLoading] = useState(false);
  const [action, setAction] = useState({ description: '', owner: '', dueDate: '', status: 'TODO' });
  const [trendItem, setTrendItem] = useState(null);
  const [trendData, setTrendData] = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendStart, setTrendStart] = useState('');
  const [trendEnd, setTrendEnd] = useState('');
  const [trendGranularity, setTrendGranularity] = useState('day');
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editAction, setEditAction] = useState(null);
  const [editActionForm, setEditActionForm] = useState(null);
  const [reportAction, setReportAction] = useState(null);
  const [zoomImage, setZoomImage] = useState(null);
  const [zoomScale, setZoomScale] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await ImprovementApi.list(); setItems(data); setSelected(s => data.find(x => x.id === s?.id) || data[0] || null); }
    catch (e) { setError(e.response?.data?.error || 'Không tải được dữ liệu cải tiến.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const { start, end } = periodRange(defectPeriod);
    setDefectsLoading(true);
    ImprovementApi.getTopDefects(start.toISOString(), end.toISOString(), 5)
      .then(data => {
        const normalized = (data || []).slice(0, 5).map(x => ({ ...x, code: x.code ?? x.Code ?? 'UNKNOWN', count: x.count ?? x.Count ?? 0, pct: x.pct ?? x.Pct ?? 0 }));
        setTopDefects(normalized);
        setErrorCodes(normalized.map(x => x.code));
      })
      .catch(() => setTopDefects([]))
      .finally(() => setDefectsLoading(false));
  }, [defectPeriod]);
  const scopedStations = useMemo(() => form.lineId ? stations.filter(s => String(s.lineId) === String(form.lineId)) : stations, [form.lineId, stations]);
  const overdue = items.flatMap(x => x.actions || []).filter(a => a.status !== 'DONE' && a.dueDate && new Date(a.dueDate) < new Date()).length;
  const trendMilestones = useMemo(() => {
    if (!trendItem || !trendStart || !trendEnd) return [];
    const milestones = [{ date: trendBucket(trendItem.trackingStart, trendGranularity), label: 'Bắt đầu theo dõi', color: '#f59e0b' }];
    (trendItem.actions || []).forEach((a, index) => {
      const date = a.completedAt || a.dueDate;
      if (date) milestones.push({ date: trendBucket(date, trendGranularity), label: `M${index + 1}: ${a.description}`, color: a.completedAt ? '#10b981' : '#38bdf8' });
    });
    const rangeStart = trendBucket(trendStart, trendGranularity);
    const rangeEnd = trendBucket(trendEnd, trendGranularity);
    return milestones.filter(x => x.date >= rangeStart && x.date <= rangeEnd);
  }, [trendItem, trendStart, trendEnd, trendGranularity]);
  const trendAxisLabels = useMemo(() => new Map(trendData.map((point) => {
    if (trendGranularity === 'week') return [point.date, `W${isoWeekNumber(point.date)}`];
    if (trendGranularity === 'month') return [point.date, monthLabels[new Date(`${point.date}T12:00:00`).getMonth()]];
    const [, month, day] = point.date.split('-');
    return [point.date, `${day}/${month}`];
  })), [trendData, trendGranularity]);

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFormError(''); setSaving(true);
    try { await ImprovementApi.create(toApi(form)); setShowForm(false); setForm(blank()); await load(); }
    catch (e2) {
      const validationErrors = e2.response?.data?.errors
        ? Object.values(e2.response.data.errors).flat().join(' ')
        : '';
      const details = e2.response?.data?.error || validationErrors || e2.response?.data?.title || e2.message;
      setFormError(`Không thể tạo cải tiến${e2.response?.status ? ` (HTTP ${e2.response.status})` : ''}: ${details || 'Lỗi không xác định.'}`);
    } finally { setSaving(false); }
  };
  const addAction = async (e) => {
    e.preventDefault(); if (!selected || !action.description.trim()) return;
    try { await ImprovementApi.addAction(selected.id, { ...action, dueDate: action.dueDate ? new Date(`${action.dueDate}T23:59:59`).toISOString() : null }); setAction({ description: '', owner: '', dueDate: '', status: 'TODO' }); await load(); }
    catch { setError('Không thể thêm hành động.'); }
  };
  const setActionStatus = async (a, status) => { await ImprovementApi.updateAction(a.id, { ...a, status }); await load(); };
  const openActionEdit = (a) => {
    setFormError(''); setEditAction(a);
    setEditActionForm({ description: a.description || '', owner: a.owner || '', status: a.status || 'TODO',
      dueDate: a.dueDate ? isoDay(a.dueDate) : '', beforeReport: a.beforeReport || '', afterReport: a.afterReport || '',
      beforeImageUrl: a.beforeImageUrl || '', afterImageUrl: a.afterImageUrl || '', beforeFile: null, afterFile: null });
  };
  const saveActionEdit = async (e) => {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      let beforeImageUrl = editActionForm.beforeImageUrl;
      let afterImageUrl = editActionForm.afterImageUrl;
      if (editActionForm.beforeFile) beforeImageUrl = (await ImprovementApi.uploadActionImage(editActionForm.beforeFile)).url;
      if (editActionForm.afterFile) afterImageUrl = (await ImprovementApi.uploadActionImage(editActionForm.afterFile)).url;
      await ImprovementApi.updateAction(editAction.id, { ...editAction, ...editActionForm, beforeImageUrl, afterImageUrl,
        dueDate: editActionForm.dueDate ? localDateBoundary(editActionForm.dueDate, true) : null });
      setEditAction(null); setEditActionForm(null); await load();
    } catch (e2) { setFormError(e2.response?.data?.error || 'Không thể cập nhật hành động cải tiến.'); }
    finally { setSaving(false); }
  };
  const assetUrl = (url) => !url || url.startsWith('http') ? url : `http://${window.location.hostname}:5000${url}`;
  const openImageZoom = (url, title) => { setZoomImage({ url: assetUrl(url), title }); setZoomScale(1); };
  const downloadImage = async (url, title) => {
    try {
      const response = await fetch(assetUrl(url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      const extension = url.split('?')[0].split('.').pop() || 'png';
      link.href = blobUrl; link.download = `${title.toLowerCase()}-improvement.${extension}`;
      document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch { setFormError('Không thể tải ảnh về máy.'); }
  };
  const loadTrend = async (item, start, end, granularity = trendGranularity) => {
    setTrendData([]); setTrendLoading(true); setFormError('');
    try { setTrendData((await ImprovementApi.getTrend(item.id, new Date(`${start}T00:00:00`).toISOString(), new Date(`${end}T23:59:59`).toISOString(), granularity)).map(x => ({ ...x, date: isoDay(x.date) }))); }
    catch (e) { setFormError(e.response?.data?.error || 'Không thể tải biểu đồ xu hướng lỗi.'); }
    finally { setTrendLoading(false); }
  };
  const showTrend = async (item) => {
    const start = isoDay(item.baselineStart);
    const end = isoDay(new Date(item.trackingEnd) > new Date() ? new Date() : item.trackingEnd);
    setTrendItem(item); setTrendStart(start); setTrendEnd(end); setTrendGranularity('day');
    await loadTrend(item, start, end, 'day');
  };
  const openEdit = (item) => {
    setFormError(''); setEditItem(item);
    setEditForm({ title: item.title, owner: item.owner || '', status: item.status || 'ACTIVE', modelId: item.modelId ? String(item.modelId) : '',
      baselineStart: isoDay(item.baselineStart), baselineEnd: isoDay(item.baselineEnd),
      trackingStart: isoDay(item.trackingStart), trackingEnd: isoDay(item.trackingEnd),
      targetReductionPercent: item.targetReductionPercent, problemDescription: item.problemDescription || '', rootCause: item.rootCause || '' });
  };
  const saveEdit = async (e) => {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      await ImprovementApi.update(editItem.id, toApi({ ...editForm, errorCode: editItem.errorCode, lineId: editItem.lineId, stationId: editItem.stationId }));
      setEditItem(null); setEditForm(null); await load();
    }
    catch (e2) { setFormError(e2.response?.data?.error || Object.values(e2.response?.data?.errors || {}).flat().join(' ') || 'Không thể cập nhật cải tiến.'); }
    finally { setSaving(false); }
  };
  const deleteImprovement = async (item) => {
    if (!window.confirm(`Xóa cải tiến "${item.title}"? Toàn bộ hành động cải tiến liên quan cũng sẽ bị xóa và không thể hoàn tác.`)) return;
    setSaving(true); setError('');
    try {
      await ImprovementApi.delete(item.id);
      if (trendItem?.id === item.id) setTrendItem(null);
      if (editItem?.id === item.id) { setEditItem(null); setEditForm(null); }
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Không thể xóa cải tiến.');
    } finally { setSaving(false); }
  };
  const chooseDefect = (defect) => {
    const { start, end } = periodRange(defectPeriod);
    const duration = end.getTime() - start.getTime();
    const baselineEnd = new Date(start.getTime() - 1000);
    const baselineStart = new Date(baselineEnd.getTime() - duration);
    setForm({ ...blank(), title: `Giảm lỗi ${defect.code}`, errorCode: defect.code,
      lineId: defect.lineId ? String(defect.lineId) : '', stationId: defect.stationId ? String(defect.stationId) : '', modelId: defect.modelId ? String(defect.modelId) : '',
      baselineStart: isoDay(baselineStart), baselineEnd: isoDay(baselineEnd), trackingStart: isoDay(start), trackingEnd: isoDay(end) });
    setShowForm(true);
  };
  const analyzeDefect = (defect) => {
    const { start, end } = periodRange(defectPeriod);
    onAnalyze?.({
      errorCode: defect.code,
      lineId: defect.lineId ?? null,
      stationId: defect.stationId ?? null,
      modelId: defect.modelId ?? null,
      baselineStart: start,
      trackingEnd: end,
    });
  };

  return <div className="space-y-5">
    {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700">{error}</div>}
    <div className="grid gap-4 md:grid-cols-4">
      <Stat icon={ClipboardCheck} label="Tổng cải tiến" value={items.length} color="text-cyan-700" />
      <Stat icon={Target} label="Đang theo dõi" value={items.filter(x => x.status === 'ACTIVE').length} color="text-blue-700" />
      <Stat icon={CheckCircle2} label="Đạt mục tiêu" value={items.filter(x => x.targetAchieved).length} color="text-emerald-700" />
      <Stat icon={AlertTriangle} label="Hành động quá hạn" value={overdue} color="text-rose-700" />
    </div>

    <div className="glass-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-rose-500/10 p-2"><BarChart3 className="h-5 w-5 text-rose-700" /></div><div><h2 className="font-bold text-slate-900">Top 5 lỗi cần ưu tiên</h2><p className="text-xs text-slate-600">Xếp hạng theo số PCB lỗi trong {defectPeriod === 'week' ? 'tuần này' : 'tháng này'}</p></div></div>
        <div className="flex rounded-xl border border-slate-200 bg-slate-50/60 p-1">{[['week','Theo tuần'],['month','Theo tháng']].map(([id,label]) => <button key={id} onClick={() => setDefectPeriod(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${defectPeriod === id ? 'bg-rose-500 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>)}</div>
      </div>
      <div className="divide-y divide-slate-200">
        {defectsLoading ? <div className="p-8 text-center text-sm text-slate-600">Đang tổng hợp dữ liệu FCT...</div> : topDefects.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Chưa có lỗi trong khoảng thời gian này.</div> : topDefects.map((defect, index) => <div key={`${defect.code}-${defect.modelId ?? 'none'}`} className="grid items-center gap-3 px-5 py-3 sm:grid-cols-[42px_minmax(230px,1.2fr)_minmax(190px,1fr)_minmax(120px,1.5fr)_90px_245px]">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black ${index === 0 ? 'bg-rose-500/20 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>#{index + 1}</div>
          <div className="min-w-0"><div className="truncate font-mono text-sm font-semibold text-slate-900" title={defect.code}>{defect.code}</div><div className="text-xs text-slate-500">{defect.count.toLocaleString('vi-VN')} PCB lỗi</div></div>
          <div className="min-w-0 text-xs"><div className="truncate font-semibold text-cyan-700" title={defect.lineName}>Line: {defect.lineName || 'Chưa xác định'}</div><div className="mt-1 truncate text-slate-600" title={defect.stationName}>Station: {defect.stationName || 'Chưa xác định'}</div><div className="mt-1 truncate text-amber-700" title={defect.modelName}>Model: {defect.modelName || 'Chưa xác định'}</div></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-rose-600 to-amber-400" style={{ width: `${Math.max(3, defect.pct)}%` }} /></div>
          <div className="text-right text-sm font-bold text-rose-700">{pct(defect.pct)}</div>
          <div className="flex items-center justify-end gap-2"><button onClick={() => analyzeDefect(defect)} className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/20"><BarChart3 className="h-3.5 w-3.5"/> Phân tích</button><button onClick={() => chooseDefect(defect)} className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-500/20">Chọn cải tiến</button></div>
        </div>)}
      </div>
    </div>

    <div className="flex justify-between gap-3">
      <p className="text-sm text-slate-600">Hiệu quả được tính tự động từ PCB Results theo mã lỗi và phạm vi đã chọn.</p>
      <div className="flex gap-2"><button onClick={load} className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2"><RefreshCw className="h-4 w-4" /></button><button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-xl bg-cyan-600 text-white px-4 py-2 text-sm font-semibold"><Plus className="h-4 w-4" /> Tạo cải tiến</button></div>
    </div>

    <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
      <div className="glass-panel max-h-[720px] overflow-y-auto p-3">
        {loading ? <div className="p-8 text-center text-slate-600">Đang tải...</div> : items.length === 0 ? <div className="p-8 text-center text-slate-500">Chưa có cải tiến.</div> : items.map(x => <button key={x.id} onClick={() => setSelected(x)} className={`mb-2 w-full rounded-xl border p-4 text-left transition ${selected?.id === x.id ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-200 bg-slate-50/40 hover:border-slate-200'}`}>
          <div className="flex justify-between gap-3"><span className="font-mono text-xs text-cyan-700">{x.code}</span><span className={`text-xs font-bold ${x.targetAchieved ? 'text-emerald-700' : x.trackingStarted ? 'text-amber-700' : 'text-slate-600'}`}>{x.targetAchieved ? 'ĐẠT' : x.trackingStarted ? 'THEO DÕI' : 'CHƯA BẮT ĐẦU'}</span></div>
          <div className="mt-2 font-semibold text-slate-900">{x.title}</div><div className="mt-2 text-xs text-slate-600">Lỗi: {x.errorCode} · Model: {models.find(m => m.id === x.modelId)?.name || 'Tất cả'} · Giảm {x.reductionPercent == null ? '—' : pct(x.reductionPercent)}</div>
        </button>)}
      </div>

      <div className="glass-panel p-5">{selected ? <>
        <div className="flex flex-wrap justify-between gap-3 border-b border-slate-200 pb-4"><div><div className="text-xs font-mono text-cyan-700">{selected.code}</div><h2 className="mt-1 text-xl font-bold">{selected.title}</h2><div className="mt-1 text-xs text-slate-600">{selected.errorCode} · {lines.find(l => l.id === selected.lineId)?.name || 'Tất cả Line'} · {stations.find(s => s.id === selected.stationId)?.name || 'Tất cả Station'}</div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => showTrend(selected)} className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-700"><LineChartIcon className="h-4 w-4" /> Xem biểu đồ</button><button onClick={() => onAnalyze?.(selected)} className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700"><BarChart3 className="h-4 w-4" /> Phân tích issue</button><button onClick={() => openEdit(selected)} className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-700"><Pencil className="h-4 w-4" /> Sửa cải tiến</button><button disabled={saving} onClick={() => deleteImprovement(selected)} className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="h-4 w-4" /> Xóa cải tiến</button></div></div><div className="text-right"><div className="text-xs text-slate-600">Mức giảm lỗi</div><div className={`text-3xl font-bold ${selected.targetAchieved ? 'text-emerald-700' : 'text-amber-700'}`}>{selected.reductionPercent == null ? '—' : pct(selected.reductionPercent)}</div><div className="text-xs text-slate-500">Mục tiêu ≥ {pct(selected.targetReductionPercent)}</div></div></div>
        <div className="my-5 grid gap-3 sm:grid-cols-2"><Metric title="Trước cải tiến" data={selected.baseline} dates={`${isoDay(selected.baselineStart)} → ${isoDay(selected.baselineEnd)}`} /><Metric title="Sau cải tiến" data={selected.tracking} dates={`${isoDay(selected.trackingStart)} → ${isoDay(selected.trackingEnd)}`} /></div>
        {(selected.problemDescription || selected.rootCause) && <div className="mb-5 grid gap-3 sm:grid-cols-2"><TextBlock title="Vấn đề" text={selected.problemDescription} /><TextBlock title="Nguyên nhân gốc" text={selected.rootCause} /></div>}
        <h3 className="mb-3 font-semibold">Hành động cải tiến ({selected.actions?.length || 0})</h3>
        <div className="space-y-2">{selected.actions?.map(a => <div key={a.id} onClick={() => setReportAction(a)} className="flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3 transition hover:border-violet-500/40 hover:bg-violet-500/5"><button title="Đổi trạng thái" onClick={e => { e.stopPropagation(); setActionStatus(a, a.status === 'DONE' ? 'TODO' : 'DONE'); }} className={`h-5 w-5 rounded-full border ${a.status === 'DONE' ? 'border-emerald-400 bg-emerald-500' : 'border-slate-500'}`} /><div className="min-w-[200px] flex-1"><div className={a.status === 'DONE' ? 'text-slate-500 line-through' : 'text-slate-800'}>{a.description}</div><div className="text-xs text-slate-500">{a.owner || 'Chưa giao'} {a.dueDate ? `· Hạn ${isoDay(a.dueDate)}` : ''} · Click để xem Before/After</div></div><button onClick={e => { e.stopPropagation(); openActionEdit(a); }} className="flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-700"><Pencil className="h-3.5 w-3.5"/> Sửa</button></div>)}</div>
        <form onSubmit={addAction} className="mt-3 grid gap-2 md:grid-cols-[1fr_150px_140px_auto]"><input required placeholder="Hành động mới..." value={action.description} onChange={e => setAction({...action, description:e.target.value})} className="field"/><input placeholder="Phụ trách" value={action.owner} onChange={e => setAction({...action, owner:e.target.value})} className="field"/><input type="date" value={action.dueDate} onChange={e => setAction({...action, dueDate:e.target.value})} className="field"/><button className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm font-semibold">Thêm</button></form>
      </> : <div className="p-12 text-center text-slate-500">Chọn một cải tiến để xem chi tiết.</div>}</div>
    </div>

    {reportAction && <div className="fixed inset-0 z-50 bg-white"><div className="flex h-screen w-screen flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/95 px-6 py-4"><div><h2 className="text-xl font-bold">Report Before / After</h2><p className="mt-1 text-sm text-slate-600">{reportAction.description}</p></div><button onClick={() => setReportAction(null)} className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100"><X/></button></div>
      <div className="flex-1 overflow-y-auto p-5 md:p-6"><div className="grid min-h-full gap-5 md:grid-cols-2">
        {[['BEFORE', reportAction.beforeReport, reportAction.beforeImageUrl, 'rose'], ['AFTER', reportAction.afterReport, reportAction.afterImageUrl, 'emerald']].map(([title, text, image, color]) => <div key={title} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><span className={`font-bold ${color === 'rose' ? 'text-rose-700' : 'text-emerald-700'}`}>{title}</span>{image && <div className="flex gap-1"><button type="button" onClick={() => openImageZoom(image, title)} title="Phóng to ảnh" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"><ZoomIn className="h-4 w-4"/></button><button type="button" onClick={() => downloadImage(image, title)} title="Lưu ảnh về máy" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"><Download className="h-4 w-4"/></button></div>}</div>{image ? <button type="button" onClick={() => openImageZoom(image, title)} className="block w-full cursor-zoom-in"><img src={assetUrl(image)} alt={title} className="h-72 w-full bg-slate-100 object-contain"/></button> : <div className="flex h-72 items-center justify-center text-sm text-slate-600">Chưa có hình ảnh</div>}<div className="min-h-24 whitespace-pre-wrap p-4 text-sm text-slate-700">{text || 'Chưa có nội dung báo cáo.'}</div></div>)}
      </div>
      <div className="mt-5 flex justify-end"><button onClick={() => { setReportAction(null); openActionEdit(reportAction); }} className="flex items-center gap-2 rounded-xl bg-cyan-600 text-white px-4 py-2 text-sm font-semibold"><Pencil className="h-4 w-4"/> Sửa report</button></div></div>
    </div></div>}

    {zoomImage && <div className="fixed inset-0 z-[100] flex flex-col bg-slate-50" onMouseDown={event => { if (event.target === event.currentTarget) setZoomImage(null); }}>
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-3">
        <div className="font-semibold text-slate-900">{zoomImage.title} · {Math.round(zoomScale * 100)}%</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setZoomScale(scale => Math.max(0.5, scale - 0.25))} className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100" title="Thu nhỏ"><ZoomOut className="h-4 w-4"/></button>
          <button type="button" onClick={() => setZoomScale(1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100">100%</button>
          <button type="button" onClick={() => setZoomScale(scale => Math.min(4, scale + 0.25))} className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100" title="Phóng to"><ZoomIn className="h-4 w-4"/></button>
          <button type="button" onClick={() => downloadImage(zoomImage.url, zoomImage.title)} className="rounded-lg border border-cyan-500/30 p-2 text-cyan-700 hover:bg-cyan-500/10" title="Lưu ảnh"><Download className="h-4 w-4"/></button>
          <button type="button" onClick={() => setZoomImage(null)} className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100" title="Đóng"><X className="h-4 w-4"/></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <img src={zoomImage.url} alt={zoomImage.title} className="mx-auto block h-auto max-w-none object-contain transition-[width]" style={{ width: `${zoomScale * 100}%` }}/>
      </div>
    </div>}

    {editAction && editActionForm && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"><form onSubmit={saveActionEdit} className="glass-panel max-h-[90vh] w-full max-w-4xl overflow-y-auto p-6">
      <div className="mb-5 flex justify-between"><div><h2 className="text-xl font-bold">Sửa hành động cải tiến</h2><p className="mt-1 text-xs text-slate-600">Cập nhật nội dung và report Before/After</p></div><button type="button" onClick={() => setEditAction(null)}><X/></button></div>
      {formError && <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700">{formError}</div>}
      <div className="grid gap-4 md:grid-cols-2"><Field label="Hành động"><input required className="field" value={editActionForm.description} onChange={e=>setEditActionForm({...editActionForm,description:e.target.value})}/></Field><Field label="Người phụ trách"><input className="field" value={editActionForm.owner} onChange={e=>setEditActionForm({...editActionForm,owner:e.target.value})}/></Field><Field label="Hạn hoàn thành"><input type="date" className="field" value={editActionForm.dueDate} onChange={e=>setEditActionForm({...editActionForm,dueDate:e.target.value})}/></Field><Field label="Trạng thái"><select className="field" value={editActionForm.status} onChange={e=>setEditActionForm({...editActionForm,status:e.target.value})}><option value="TODO">Chưa thực hiện</option><option value="IN_PROGRESS">Đang thực hiện</option><option value="DONE">Hoàn thành</option></select></Field></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4"><h3 className="mb-3 font-bold text-rose-700">BEFORE</h3><textarea className="field min-h-32" placeholder="Mô tả hiện trạng trước cải tiến..." value={editActionForm.beforeReport} onChange={e=>setEditActionForm({...editActionForm,beforeReport:e.target.value})}/><input type="file" accept="image/jpeg,image/png,image/webp" className="mt-3 block w-full text-xs text-slate-600" onChange={e=>setEditActionForm({...editActionForm,beforeFile:e.target.files?.[0] || null})}/>{editActionForm.beforeImageUrl && <img src={assetUrl(editActionForm.beforeImageUrl)} alt="Before" className="mt-3 h-40 w-full rounded-xl bg-slate-100 object-contain"/>}</div><div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"><h3 className="mb-3 font-bold text-emerald-700">AFTER</h3><textarea className="field min-h-32" placeholder="Mô tả kết quả sau cải tiến..." value={editActionForm.afterReport} onChange={e=>setEditActionForm({...editActionForm,afterReport:e.target.value})}/><input type="file" accept="image/jpeg,image/png,image/webp" className="mt-3 block w-full text-xs text-slate-600" onChange={e=>setEditActionForm({...editActionForm,afterFile:e.target.files?.[0] || null})}/>{editActionForm.afterImageUrl && <img src={assetUrl(editActionForm.afterImageUrl)} alt="After" className="mt-3 h-40 w-full rounded-xl bg-slate-100 object-contain"/>}</div></div>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setEditAction(null)} className="rounded-xl border border-slate-200 px-4 py-2">Hủy</button><button disabled={saving} className="rounded-xl bg-cyan-600 text-white px-5 py-2 font-semibold disabled:opacity-50">{saving ? 'Đang lưu...' : 'Lưu hành động'}</button></div>
    </form></div>}

    {trendItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"><div className="glass-panel w-full max-w-5xl p-6">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Trend tỷ lệ lỗi: {trendItem.errorCode}</h2><p className="mt-1 text-xs text-slate-600">{trendItem.title} · Mốc vàng: bắt đầu theo dõi · xanh lá: đã hoàn thành · xanh dương: hạn hành động</p></div><button onClick={() => setTrendItem(null)}><X /></button></div>
      <div className="my-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
        <Field label="Từ ngày"><input type="date" className="field" value={trendStart} onChange={e => setTrendStart(e.target.value)}/></Field>
        <Field label="Đến ngày"><input type="date" className="field" value={trendEnd} onChange={e => setTrendEnd(e.target.value)}/></Field>
        <div><div className="mb-1 text-sm text-slate-700">Hiển thị theo</div><div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1">{[['day','Ngày'],['week','Tuần'],['month','Tháng']].map(([value,label]) => <button key={value} onClick={() => setTrendGranularity(value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${trendGranularity === value ? 'bg-violet-600 text-white' : 'text-slate-600'}`}>{label}</button>)}</div></div>
        <button disabled={trendLoading || !trendStart || !trendEnd} onClick={() => loadTrend(trendItem, trendStart, trendEnd, trendGranularity)} className="rounded-xl bg-violet-600 text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Áp dụng</button>
        <div className="ml-auto text-xs text-slate-600">{trendData.length} điểm dữ liệu · {trendMilestones.length} mốc cải tiến</div>
      </div>
      {formError && <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700">{formError}</div>}
      <div className="h-[420px]">{trendLoading ? <div className="flex h-full items-center justify-center text-slate-600">Đang tổng hợp dữ liệu FCT...</div> : trendData.length === 0 ? <div className="flex h-full items-center justify-center text-slate-500">Không có dữ liệu trong khoảng đã chọn.</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={trendData} margin={{ top: 35, right: 25, left: 0, bottom: 15 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" tickFormatter={value => trendAxisLabels.get(value) || value} stroke="#64748b" fontSize={11}/><YAxis unit="%" stroke="#64748b" fontSize={11} domain={[0, 'auto']}/><Tooltip labelFormatter={value => trendAxisLabels.get(value) || value} formatter={(value, name) => name === 'Tỷ lệ lỗi' ? [`${Number(value).toFixed(3)}%`, name] : [value, name]} contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12 }}/>{trendMilestones.map((m, i) => <ReferenceLine key={`${m.date}-${i}`} x={m.date} stroke={m.color} strokeDasharray="6 5" label={{ value: m.label.length > 24 ? `${m.label.slice(0, 24)}…` : m.label, fill: m.color, fontSize: 10, angle: -20, position: 'top' }}/>) }<Line type="monotone" dataKey="defectRate" name="Tỷ lệ lỗi" stroke="#be123c" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }}/></LineChart></ResponsiveContainer>}</div>
    </div></div>}

    {editItem && editForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"><form onSubmit={saveEdit} className="glass-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6">
      <div className="mb-4 flex justify-between"><div><h2 className="text-xl font-bold">Sửa thông tin cải tiến</h2><p className="mt-1 text-xs text-slate-600">{editItem.code}</p></div><button type="button" onClick={() => setEditItem(null)}><X /></button></div>
      {formError && <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700">{formError}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tên cải tiến"><input required className="field" value={editForm.title} onChange={e => setEditForm({...editForm, title:e.target.value})}/></Field>
        <Field label="Trạng thái"><select className="field" value={editForm.status} onChange={e => setEditForm({...editForm, status:e.target.value})}><option value="ACTIVE">Đang theo dõi</option><option value="DRAFT">Nháp</option><option value="COMPLETED">Hoàn thành</option><option value="CANCELLED">Đã hủy</option></select></Field>
        <Field label="Mã lỗi FCT (không thể sửa)"><input disabled className="field cursor-not-allowed opacity-60" value={editItem.errorCode}/></Field>
        <Field label="Line / Station (không thể sửa)"><input disabled className="field cursor-not-allowed opacity-60" value={`${lines.find(l => l.id === editItem.lineId)?.name || 'Tất cả Line'} / ${stations.find(s => s.id === editItem.stationId)?.name || 'Tất cả Station'}`}/></Field>
        <Field label="Model"><select className="field" value={editForm.modelId} onChange={e => setEditForm({...editForm, modelId:e.target.value})}><option value="">Tất cả Model</option>{models.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Bắt đầu kỳ trước"><input required type="date" className="field" value={editForm.baselineStart} onChange={e => setEditForm({...editForm, baselineStart:e.target.value})}/></Field>
        <Field label="Kết thúc kỳ trước"><input required type="date" className="field" value={editForm.baselineEnd} onChange={e => setEditForm({...editForm, baselineEnd:e.target.value})}/></Field>
        <Field label="Bắt đầu kỳ sau"><input required type="date" className="field" value={editForm.trackingStart} onChange={e => setEditForm({...editForm, trackingStart:e.target.value})}/></Field>
        <Field label="Kết thúc kỳ sau"><input required type="date" className="field" value={editForm.trackingEnd} onChange={e => setEditForm({...editForm, trackingEnd:e.target.value})}/></Field>
        <Field label="Mục tiêu giảm lỗi (%)"><input required min="0" max="100" type="number" className="field" value={editForm.targetReductionPercent} onChange={e => setEditForm({...editForm, targetReductionPercent:e.target.value})}/></Field>
        <Field label="Người phụ trách"><input className="field" value={editForm.owner} onChange={e => setEditForm({...editForm, owner:e.target.value})}/></Field>
        <Field label="Mô tả vấn đề"><textarea className="field min-h-28" value={editForm.problemDescription} onChange={e => setEditForm({...editForm, problemDescription:e.target.value})}/></Field>
        <Field label="Nguyên nhân gốc"><textarea className="field min-h-28" value={editForm.rootCause} onChange={e => setEditForm({...editForm, rootCause:e.target.value})}/></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setEditItem(null)} className="rounded-xl border border-slate-200 px-4 py-2">Hủy</button><button disabled={saving} className="rounded-xl bg-cyan-600 text-white px-5 py-2 font-semibold disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button></div>
    </form></div>}

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"><form onSubmit={submit} className="glass-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6"><div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">Tạo cải tiến giảm lỗi</h2><button type="button" onClick={() => setShowForm(false)}><X /></button></div>{formError && <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700">{formError}</div>}<div className="grid gap-4 md:grid-cols-2">
      <Field label="Tên cải tiến"><input required className="field" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field><Field label="Mã lỗi FCT"><input required list="fct-errors" className="field" value={form.errorCode} onChange={e=>setForm({...form,errorCode:e.target.value})}/><datalist id="fct-errors">{errorCodes.map(x=><option key={x} value={x}/>)}</datalist></Field>
      <Field label="Line"><select className="field" value={form.lineId} onChange={e=>setForm({...form,lineId:e.target.value,stationId:''})}><option value="">Tất cả Line</option>{lines.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Station"><select className="field" value={form.stationId} onChange={e=>setForm({...form,stationId:e.target.value})}><option value="">Tất cả Station</option>{scopedStations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Model"><select className="field" value={form.modelId} onChange={e=>setForm({...form,modelId:e.target.value})}><option value="">Tất cả Model</option>{models.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Bắt đầu kỳ trước"><input required type="date" className="field" value={form.baselineStart} onChange={e=>setForm({...form,baselineStart:e.target.value})}/></Field><Field label="Kết thúc kỳ trước"><input required type="date" className="field" value={form.baselineEnd} onChange={e=>setForm({...form,baselineEnd:e.target.value})}/></Field><Field label="Bắt đầu kỳ sau"><input required type="date" className="field" value={form.trackingStart} onChange={e=>setForm({...form,trackingStart:e.target.value})}/></Field><Field label="Kết thúc kỳ sau"><input required type="date" className="field" value={form.trackingEnd} onChange={e=>setForm({...form,trackingEnd:e.target.value})}/></Field>
      <Field label="Mục tiêu giảm lỗi (%)"><input required min="0" max="100" type="number" className="field" value={form.targetReductionPercent} onChange={e=>setForm({...form,targetReductionPercent:e.target.value})}/></Field><Field label="Người phụ trách"><input className="field" value={form.owner} onChange={e=>setForm({...form,owner:e.target.value})}/></Field><Field label="Mô tả vấn đề"><textarea className="field min-h-24" value={form.problemDescription} onChange={e=>setForm({...form,problemDescription:e.target.value})}/></Field><Field label="Nguyên nhân gốc"><textarea className="field min-h-24" value={form.rootCause} onChange={e=>setForm({...form,rootCause:e.target.value})}/></Field>
    </div><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={()=>setShowForm(false)} className="rounded-xl border border-slate-200 px-4 py-2 disabled:opacity-50">Hủy</button><button disabled={saving} className="rounded-xl bg-cyan-600 text-white px-5 py-2 font-semibold disabled:cursor-wait disabled:opacity-60">{saving ? 'Đang tạo và đo dữ liệu...' : 'Tạo và đo dữ liệu'}</button></div></form></div>}
  </div>;
}

function Stat({icon:Icon,label,value,color}) { return <div className="glass-panel p-4"><div className="flex items-center gap-3"><Icon className={`h-5 w-5 ${color}`}/><div><div className="text-xs text-slate-600">{label}</div><div className="text-2xl font-bold">{value}</div></div></div></div> }
function Metric({title,data,dates}) { return <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"><div className="flex justify-between"><span className="font-semibold">{title}</span><span className="text-xs text-slate-500">{dates}</span></div><div className="mt-3 text-3xl font-bold text-cyan-700">{pct(data?.rate)}</div><div className="mt-1 text-xs text-slate-600">{data?.defects || 0} lỗi / {data?.total || 0} PCB</div></div> }
function TextBlock({title,text}) { return <div className="rounded-xl bg-slate-100/60 p-3"><div className="text-xs font-semibold text-slate-500">{title}</div><div className="mt-1 text-sm text-slate-700">{text || '—'}</div></div> }
function Field({label,children}) { return <label className="space-y-1 text-sm text-slate-700"><span>{label}</span>{children}</label> }
