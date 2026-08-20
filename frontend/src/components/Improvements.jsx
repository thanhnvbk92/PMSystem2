import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, ClipboardCheck, LineChart as LineChartIcon, Pencil, Plus, RefreshCw, Target, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ImprovementApi } from '../services/api';

const isoDay = (date) => new Date(date).toISOString().slice(0, 10);
const today = new Date();
const daysAgo = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return isoDay(d); };
const blank = () => ({ title: '', errorCode: '', lineId: '', stationId: '', problemDescription: '', rootCause: '', owner: '', status: 'ACTIVE', baselineStart: daysAgo(60), baselineEnd: daysAgo(30), trackingStart: daysAgo(30), trackingEnd: isoDay(today), targetReductionPercent: 30 });
const toApi = (x) => ({ ...x, lineId: x.lineId ? Number(x.lineId) : null, stationId: x.stationId ? Number(x.stationId) : null, targetReductionPercent: Number(x.targetReductionPercent), baselineStart: new Date(`${x.baselineStart}T00:00:00`).toISOString(), baselineEnd: new Date(`${x.baselineEnd}T23:59:59`).toISOString(), trackingStart: new Date(`${x.trackingStart}T00:00:00`).toISOString(), trackingEnd: new Date(`${x.trackingEnd}T23:59:59`).toISOString() });
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

export default function Improvements({ lines, stations }) {
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
  const trendAxisLabels = useMemo(() => new Map(trendData.map((point, index) => {
    if (trendGranularity === 'week') return [point.date, `W${index + 1}`];
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
    setEditForm({ title: item.title, owner: item.owner || '', status: item.status || 'ACTIVE',
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
  const chooseDefect = (defect) => {
    const { start, end } = periodRange(defectPeriod);
    const duration = end.getTime() - start.getTime();
    const baselineEnd = new Date(start.getTime() - 1000);
    const baselineStart = new Date(baselineEnd.getTime() - duration);
    setForm({ ...blank(), title: `Giảm lỗi ${defect.code}`, errorCode: defect.code,
      lineId: defect.lineId ? String(defect.lineId) : '', stationId: defect.stationId ? String(defect.stationId) : '',
      baselineStart: isoDay(baselineStart), baselineEnd: isoDay(baselineEnd), trackingStart: isoDay(start), trackingEnd: isoDay(end) });
    setShowForm(true);
  };

  return <div className="space-y-5">
    {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
    <div className="grid gap-4 md:grid-cols-4">
      <Stat icon={ClipboardCheck} label="Tổng cải tiến" value={items.length} color="text-cyan-400" />
      <Stat icon={Target} label="Đang theo dõi" value={items.filter(x => x.status === 'ACTIVE').length} color="text-blue-400" />
      <Stat icon={CheckCircle2} label="Đạt mục tiêu" value={items.filter(x => x.targetAchieved).length} color="text-emerald-400" />
      <Stat icon={AlertTriangle} label="Hành động quá hạn" value={overdue} color="text-rose-400" />
    </div>

    <div className="glass-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-rose-500/10 p-2"><BarChart3 className="h-5 w-5 text-rose-400" /></div><div><h2 className="font-bold text-white">Top 5 lỗi cần ưu tiên</h2><p className="text-xs text-slate-400">Xếp hạng theo số PCB lỗi trong {defectPeriod === 'week' ? 'tuần này' : 'tháng này'}</p></div></div>
        <div className="flex rounded-xl border border-white/10 bg-slate-950/60 p-1">{[['week','Theo tuần'],['month','Theo tháng']].map(([id,label]) => <button key={id} onClick={() => setDefectPeriod(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${defectPeriod === id ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-white'}`}>{label}</button>)}</div>
      </div>
      <div className="divide-y divide-white/5">
        {defectsLoading ? <div className="p-8 text-center text-sm text-slate-400">Đang tổng hợp dữ liệu FCT...</div> : topDefects.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Chưa có lỗi trong khoảng thời gian này.</div> : topDefects.map((defect, index) => <div key={defect.code} className="grid items-center gap-3 px-5 py-3 sm:grid-cols-[42px_minmax(230px,1.2fr)_minmax(190px,1fr)_minmax(120px,1.5fr)_90px_145px]">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black ${index === 0 ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-800 text-slate-400'}`}>#{index + 1}</div>
          <div className="min-w-0"><div className="truncate font-mono text-sm font-semibold text-white" title={defect.code}>{defect.code}</div><div className="text-xs text-slate-500">{defect.count.toLocaleString('vi-VN')} PCB lỗi</div></div>
          <div className="min-w-0 text-xs"><div className="truncate font-semibold text-cyan-300" title={defect.lineName}>Line: {defect.lineName || 'Chưa xác định'}</div><div className="mt-1 truncate text-slate-400" title={defect.stationName}>Station: {defect.stationName || 'Chưa xác định'}</div></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-rose-600 to-amber-400" style={{ width: `${Math.max(3, defect.pct)}%` }} /></div>
          <div className="text-right text-sm font-bold text-rose-300">{pct(defect.pct)}</div>
          <button onClick={() => chooseDefect(defect)} className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20">Chọn cải tiến</button>
        </div>)}
      </div>
    </div>

    <div className="flex justify-between gap-3">
      <p className="text-sm text-slate-400">Hiệu quả được tính tự động từ PCB Results theo mã lỗi và phạm vi đã chọn.</p>
      <div className="flex gap-2"><button onClick={load} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2"><RefreshCw className="h-4 w-4" /></button><button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold"><Plus className="h-4 w-4" /> Tạo cải tiến</button></div>
    </div>

    <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
      <div className="glass-panel max-h-[720px] overflow-y-auto p-3">
        {loading ? <div className="p-8 text-center text-slate-400">Đang tải...</div> : items.length === 0 ? <div className="p-8 text-center text-slate-500">Chưa có cải tiến.</div> : items.map(x => <button key={x.id} onClick={() => setSelected(x)} className={`mb-2 w-full rounded-xl border p-4 text-left transition ${selected?.id === x.id ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/5 bg-slate-950/40 hover:border-white/20'}`}>
          <div className="flex justify-between gap-3"><span className="font-mono text-xs text-cyan-400">{x.code}</span><span className={`text-xs font-bold ${x.targetAchieved ? 'text-emerald-400' : 'text-amber-400'}`}>{x.targetAchieved ? 'ĐẠT' : 'THEO DÕI'}</span></div>
          <div className="mt-2 font-semibold text-white">{x.title}</div><div className="mt-2 text-xs text-slate-400">Lỗi: {x.errorCode} · Giảm {x.reductionPercent == null ? '—' : pct(x.reductionPercent)}</div>
        </button>)}
      </div>

      <div className="glass-panel p-5">{selected ? <>
        <div className="flex flex-wrap justify-between gap-3 border-b border-white/10 pb-4"><div><div className="text-xs font-mono text-cyan-400">{selected.code}</div><h2 className="mt-1 text-xl font-bold">{selected.title}</h2><div className="mt-1 text-xs text-slate-400">{selected.errorCode} · {lines.find(l => l.id === selected.lineId)?.name || 'Tất cả Line'} · {stations.find(s => s.id === selected.stationId)?.name || 'Tất cả Station'}</div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => showTrend(selected)} className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-300"><LineChartIcon className="h-4 w-4" /> Xem biểu đồ</button><button onClick={() => openEdit(selected)} className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300"><Pencil className="h-4 w-4" /> Sửa cải tiến</button></div></div><div className="text-right"><div className="text-xs text-slate-400">Mức giảm lỗi</div><div className={`text-3xl font-bold ${selected.targetAchieved ? 'text-emerald-400' : 'text-amber-400'}`}>{selected.reductionPercent == null ? '—' : pct(selected.reductionPercent)}</div><div className="text-xs text-slate-500">Mục tiêu ≥ {pct(selected.targetReductionPercent)}</div></div></div>
        <div className="my-5 grid gap-3 sm:grid-cols-2"><Metric title="Trước cải tiến" data={selected.baseline} dates={`${isoDay(selected.baselineStart)} → ${isoDay(selected.baselineEnd)}`} /><Metric title="Sau cải tiến" data={selected.tracking} dates={`${isoDay(selected.trackingStart)} → ${isoDay(selected.trackingEnd)}`} /></div>
        {(selected.problemDescription || selected.rootCause) && <div className="mb-5 grid gap-3 sm:grid-cols-2"><TextBlock title="Vấn đề" text={selected.problemDescription} /><TextBlock title="Nguyên nhân gốc" text={selected.rootCause} /></div>}
        <h3 className="mb-3 font-semibold">Hành động cải tiến ({selected.actions?.length || 0})</h3>
        <div className="space-y-2">{selected.actions?.map(a => <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3"><button onClick={() => setActionStatus(a, a.status === 'DONE' ? 'TODO' : 'DONE')} className={`h-5 w-5 rounded-full border ${a.status === 'DONE' ? 'border-emerald-400 bg-emerald-500' : 'border-slate-500'}`} /><div className="min-w-[200px] flex-1"><div className={a.status === 'DONE' ? 'text-slate-500 line-through' : 'text-slate-200'}>{a.description}</div><div className="text-xs text-slate-500">{a.owner || 'Chưa giao'} {a.dueDate ? `· Hạn ${isoDay(a.dueDate)}` : ''}</div></div></div>)}</div>
        <form onSubmit={addAction} className="mt-3 grid gap-2 md:grid-cols-[1fr_150px_140px_auto]"><input required placeholder="Hành động mới..." value={action.description} onChange={e => setAction({...action, description:e.target.value})} className="field"/><input placeholder="Phụ trách" value={action.owner} onChange={e => setAction({...action, owner:e.target.value})} className="field"/><input type="date" value={action.dueDate} onChange={e => setAction({...action, dueDate:e.target.value})} className="field"/><button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold">Thêm</button></form>
      </> : <div className="p-12 text-center text-slate-500">Chọn một cải tiến để xem chi tiết.</div>}</div>
    </div>

    {trendItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="glass-panel w-full max-w-5xl p-6">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Trend tỷ lệ lỗi: {trendItem.errorCode}</h2><p className="mt-1 text-xs text-slate-400">{trendItem.title} · Mốc vàng: bắt đầu theo dõi · xanh lá: đã hoàn thành · xanh dương: hạn hành động</p></div><button onClick={() => setTrendItem(null)}><X /></button></div>
      <div className="my-4 flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
        <Field label="Từ ngày"><input type="date" className="field" value={trendStart} onChange={e => setTrendStart(e.target.value)}/></Field>
        <Field label="Đến ngày"><input type="date" className="field" value={trendEnd} onChange={e => setTrendEnd(e.target.value)}/></Field>
        <div><div className="mb-1 text-sm text-slate-300">Hiển thị theo</div><div className="flex rounded-xl border border-white/10 bg-slate-900 p-1">{[['day','Ngày'],['week','Tuần'],['month','Tháng']].map(([value,label]) => <button key={value} onClick={() => setTrendGranularity(value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${trendGranularity === value ? 'bg-violet-600 text-white' : 'text-slate-400'}`}>{label}</button>)}</div></div>
        <button disabled={trendLoading || !trendStart || !trendEnd} onClick={() => loadTrend(trendItem, trendStart, trendEnd, trendGranularity)} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Áp dụng</button>
        <div className="ml-auto text-xs text-slate-400">{trendData.length} điểm dữ liệu · {trendMilestones.length} mốc cải tiến</div>
      </div>
      {formError && <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{formError}</div>}
      <div className="h-[420px]">{trendLoading ? <div className="flex h-full items-center justify-center text-slate-400">Đang tổng hợp dữ liệu FCT...</div> : trendData.length === 0 ? <div className="flex h-full items-center justify-center text-slate-500">Không có dữ liệu trong khoảng đã chọn.</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={trendData} margin={{ top: 35, right: 25, left: 0, bottom: 15 }}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="date" tickFormatter={value => trendAxisLabels.get(value) || value} stroke="#64748b" fontSize={11}/><YAxis unit="%" stroke="#64748b" fontSize={11} domain={[0, 'auto']}/><Tooltip labelFormatter={value => trendAxisLabels.get(value) || value} formatter={(value, name) => name === 'Tỷ lệ lỗi' ? [`${Number(value).toFixed(3)}%`, name] : [value, name]} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12 }}/>{trendMilestones.map((m, i) => <ReferenceLine key={`${m.date}-${i}`} x={m.date} stroke={m.color} strokeDasharray="6 5" label={{ value: m.label.length > 24 ? `${m.label.slice(0, 24)}…` : m.label, fill: m.color, fontSize: 10, angle: -20, position: 'top' }}/>) }<Line type="monotone" dataKey="defectRate" name="Tỷ lệ lỗi" stroke="#fb7185" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }}/></LineChart></ResponsiveContainer>}</div>
    </div></div>}

    {editItem && editForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><form onSubmit={saveEdit} className="glass-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6">
      <div className="mb-4 flex justify-between"><div><h2 className="text-xl font-bold">Sửa thông tin cải tiến</h2><p className="mt-1 text-xs text-slate-400">{editItem.code}</p></div><button type="button" onClick={() => setEditItem(null)}><X /></button></div>
      {formError && <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{formError}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tên cải tiến"><input required className="field" value={editForm.title} onChange={e => setEditForm({...editForm, title:e.target.value})}/></Field>
        <Field label="Trạng thái"><select className="field" value={editForm.status} onChange={e => setEditForm({...editForm, status:e.target.value})}><option value="ACTIVE">Đang theo dõi</option><option value="DRAFT">Nháp</option><option value="COMPLETED">Hoàn thành</option><option value="CANCELLED">Đã hủy</option></select></Field>
        <Field label="Mã lỗi FCT (không thể sửa)"><input disabled className="field cursor-not-allowed opacity-60" value={editItem.errorCode}/></Field>
        <Field label="Line / Station (không thể sửa)"><input disabled className="field cursor-not-allowed opacity-60" value={`${lines.find(l => l.id === editItem.lineId)?.name || 'Tất cả Line'} / ${stations.find(s => s.id === editItem.stationId)?.name || 'Tất cả Station'}`}/></Field>
        <Field label="Bắt đầu kỳ trước"><input required type="date" className="field" value={editForm.baselineStart} onChange={e => setEditForm({...editForm, baselineStart:e.target.value})}/></Field>
        <Field label="Kết thúc kỳ trước"><input required type="date" className="field" value={editForm.baselineEnd} onChange={e => setEditForm({...editForm, baselineEnd:e.target.value})}/></Field>
        <Field label="Bắt đầu kỳ sau"><input required type="date" className="field" value={editForm.trackingStart} onChange={e => setEditForm({...editForm, trackingStart:e.target.value})}/></Field>
        <Field label="Kết thúc kỳ sau"><input required type="date" className="field" value={editForm.trackingEnd} onChange={e => setEditForm({...editForm, trackingEnd:e.target.value})}/></Field>
        <Field label="Mục tiêu giảm lỗi (%)"><input required min="0" max="100" type="number" className="field" value={editForm.targetReductionPercent} onChange={e => setEditForm({...editForm, targetReductionPercent:e.target.value})}/></Field>
        <Field label="Người phụ trách"><input className="field" value={editForm.owner} onChange={e => setEditForm({...editForm, owner:e.target.value})}/></Field>
        <Field label="Mô tả vấn đề"><textarea className="field min-h-28" value={editForm.problemDescription} onChange={e => setEditForm({...editForm, problemDescription:e.target.value})}/></Field>
        <Field label="Nguyên nhân gốc"><textarea className="field min-h-28" value={editForm.rootCause} onChange={e => setEditForm({...editForm, rootCause:e.target.value})}/></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setEditItem(null)} className="rounded-xl border border-white/10 px-4 py-2">Hủy</button><button disabled={saving} className="rounded-xl bg-cyan-600 px-5 py-2 font-semibold disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button></div>
    </form></div>}

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><form onSubmit={submit} className="glass-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6"><div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">Tạo cải tiến giảm lỗi</h2><button type="button" onClick={() => setShowForm(false)}><X /></button></div>{formError && <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{formError}</div>}<div className="grid gap-4 md:grid-cols-2">
      <Field label="Tên cải tiến"><input required className="field" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field><Field label="Mã lỗi FCT"><input required list="fct-errors" className="field" value={form.errorCode} onChange={e=>setForm({...form,errorCode:e.target.value})}/><datalist id="fct-errors">{errorCodes.map(x=><option key={x} value={x}/>)}</datalist></Field>
      <Field label="Line"><select className="field" value={form.lineId} onChange={e=>setForm({...form,lineId:e.target.value,stationId:''})}><option value="">Tất cả Line</option>{lines.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Station"><select className="field" value={form.stationId} onChange={e=>setForm({...form,stationId:e.target.value})}><option value="">Tất cả Station</option>{scopedStations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Bắt đầu kỳ trước"><input required type="date" className="field" value={form.baselineStart} onChange={e=>setForm({...form,baselineStart:e.target.value})}/></Field><Field label="Kết thúc kỳ trước"><input required type="date" className="field" value={form.baselineEnd} onChange={e=>setForm({...form,baselineEnd:e.target.value})}/></Field><Field label="Bắt đầu kỳ sau"><input required type="date" className="field" value={form.trackingStart} onChange={e=>setForm({...form,trackingStart:e.target.value})}/></Field><Field label="Kết thúc kỳ sau"><input required type="date" className="field" value={form.trackingEnd} onChange={e=>setForm({...form,trackingEnd:e.target.value})}/></Field>
      <Field label="Mục tiêu giảm lỗi (%)"><input required min="0" max="100" type="number" className="field" value={form.targetReductionPercent} onChange={e=>setForm({...form,targetReductionPercent:e.target.value})}/></Field><Field label="Người phụ trách"><input className="field" value={form.owner} onChange={e=>setForm({...form,owner:e.target.value})}/></Field><Field label="Mô tả vấn đề"><textarea className="field min-h-24" value={form.problemDescription} onChange={e=>setForm({...form,problemDescription:e.target.value})}/></Field><Field label="Nguyên nhân gốc"><textarea className="field min-h-24" value={form.rootCause} onChange={e=>setForm({...form,rootCause:e.target.value})}/></Field>
    </div><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={()=>setShowForm(false)} className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-50">Hủy</button><button disabled={saving} className="rounded-xl bg-cyan-600 px-5 py-2 font-semibold disabled:cursor-wait disabled:opacity-60">{saving ? 'Đang tạo và đo dữ liệu...' : 'Tạo và đo dữ liệu'}</button></div></form></div>}
  </div>;
}

function Stat({icon:Icon,label,value,color}) { return <div className="glass-panel p-4"><div className="flex items-center gap-3"><Icon className={`h-5 w-5 ${color}`}/><div><div className="text-xs text-slate-400">{label}</div><div className="text-2xl font-bold">{value}</div></div></div></div> }
function Metric({title,data,dates}) { return <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4"><div className="flex justify-between"><span className="font-semibold">{title}</span><span className="text-xs text-slate-500">{dates}</span></div><div className="mt-3 text-3xl font-bold text-cyan-300">{pct(data?.rate)}</div><div className="mt-1 text-xs text-slate-400">{data?.defects || 0} lỗi / {data?.total || 0} PCB</div></div> }
function TextBlock({title,text}) { return <div className="rounded-xl bg-slate-900/60 p-3"><div className="text-xs font-semibold text-slate-500">{title}</div><div className="mt-1 text-sm text-slate-300">{text || '—'}</div></div> }
function Field({label,children}) { return <label className="space-y-1 text-sm text-slate-300"><span>{label}</span>{children}</label> }
