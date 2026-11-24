import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HardDrive, Plus, Trash2, Save, RefreshCw, Eye, Eraser, X, AlertTriangle, CheckCircle2, Info, Search
} from 'lucide-react';
import { DiskCleanupApi, MachinesApi } from '../services/api';

// ---------------------------------------------------------------- helpers

const newId = () => (crypto?.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(16).slice(2)}`);

/** Command results come through SignalR: accept PascalCase as well as camelCase keys. */
const camel = (value) => {
  if (Array.isArray(value)) return value.map(camel);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), camel(v)]));
  }
  return value;
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};
const pad = (n) => String(n).padStart(2, '0');
const formatTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d)) return '-';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const MODE_LABELS = { OldestFirst: 'Từ cũ đến mới', DeleteAll: 'Xóa toàn bộ', KeepNewest: 'Giữ file mới nhất' };

const STATUS = {
  Cleaned: { label: 'Đã dọn', group: 'applied', cls: 'text-emerald-700' },
  DryRun: { label: 'Chạy thử', group: 'applied', cls: 'text-blue-700' },
  NothingToDelete: { label: 'Không có file', group: 'applied', cls: 'text-slate-600' },
  NotNeeded: { label: 'Chưa cần', group: 'applied', cls: 'text-slate-500' },
  FolderNotFound: { label: 'Không có thư mục (N/A)', group: 'na', cls: 'text-slate-400' },
  Blocked: { label: 'Bị chặn', group: 'blocked', cls: 'text-rose-700' },
  Disabled: { label: 'Đang tắt', group: 'disabled', cls: 'text-slate-400' },
};

const emptyRule = () => ({
  id: newId(), name: '', folder: '', pattern: '*', includeSubfolders: true,
  mode: 'OldestFirst', keepDays: 0, dryRun: true, enabled: true,
});

const sameConfig = (a, b) => JSON.stringify({ ...a, updatedAt: null }) === JSON.stringify({ ...b, updatedAt: null });

/** Every PC known to PC monitoring, joined with its latest clean-up report. */
function usePcs(reports, machines, channels) {
  return useMemo(() => {
    const channelById = new Map(channels.map(c => [c.id, c]));
    const byKey = new Map();
    machines.forEach(m => byKey.set(m.macKey, { macKey: m.macKey, macAddress: m.macAddress, hostname: m.hostname, isOnline: m.isOnline, appVersion: m.appVersion, channelName: channelById.get(m.channelId)?.name || null, disks: m.disks || [] }));
    reports.forEach(r => {
      const row = byKey.get(r.macKey) || { macKey: r.macKey, macAddress: r.macAddress, hostname: r.hostname, isOnline: false, disks: [] };
      byKey.set(r.macKey, { ...row, hostname: row.hostname || r.hostname, entry: r, report: r.report ? camel(r.report) : null });
    });
    return [...byKey.values()].sort((a, b) => (a.channelName || a.hostname || '~').localeCompare(b.channelName || b.hostname || '~', undefined, { numeric: true }));
  }, [reports, machines, channels]);
}

// ---------------------------------------------------------------- page

export default function DiskCleanup({ channels = [] }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reports, setReports] = useState([]);
  const [machines, setMachines] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [command, setCommand] = useState(null); // { pc, kind }
  const [ruleDetail, setRuleDetail] = useState(null);

  const loadReports = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([DiskCleanupApi.getReports(), MachinesApi.getAll().catch(() => ({ machines: [] }))]);
      setReports(r || []);
      setMachines(m?.machines || []);
    } catch { /* settings error is shown below */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const config = await DiskCleanupApi.getConfig();
      setSaved(config);
      setDraft(structuredClone(config));
      setError(null);
    } catch (err) {
      setError(err?.response?.status === 404 ? 'Backend chưa có API dọn ổ cứng (cần khởi động lại backend bản mới).' : 'Không tải được cài đặt dọn ổ cứng.');
    }
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    load();
    const poll = setInterval(loadReports, 60000);
    return () => clearInterval(poll);
  }, [load, loadReports]);

  const pcs = usePcs(reports, machines, channels);
  const dirty = saved && draft && !sameConfig(saved, draft);

  const ruleStats = useMemo(() => {
    const stats = {};
    pcs.forEach(pc => (pc.report?.rules || []).forEach(rr => {
      const group = STATUS[rr.status]?.group || 'applied';
      const s = stats[rr.ruleId] || (stats[rr.ruleId] = { applied: [], na: [], blocked: [], disabled: [], bytes: 0 });
      s[group].push({ pc, rr });
      if (rr.status === 'Cleaned') s.bytes += rr.bytes || 0;
    }));
    return stats;
  }, [pcs]);

  const update = (patch) => setDraft(d => ({ ...d, ...patch }));
  const updateRule = (id, patch) => setDraft(d => ({ ...d, rules: d.rules.map(r => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeRule = (id) => setDraft(d => ({ ...d, rules: d.rules.filter(r => r.id !== id) }));
  const addRule = () => setDraft(d => ({ ...d, rules: [...(d.rules || []), emptyRule()] }));

  const save = async () => {
    const trigger = Number(draft.triggerUsedPercent); const ok = Number(draft.okUsedPercent);
    if (!(trigger > 0 && trigger < 100)) return setNotice({ type: 'error', text: 'Ngưỡng bắt đầu xóa phải từ 1 đến 99%.' });
    if (!(ok > 0 && ok < trigger)) return setNotice({ type: 'error', text: 'Ngưỡng OK phải nhỏ hơn ngưỡng bắt đầu xóa.' });
    const empty = draft.rules.findIndex(r => !r.folder.trim());
    if (empty >= 0) return setNotice({ type: 'error', text: `Quy tắc ${empty + 1}: chưa nhập thư mục.` });
    setSaving(true);
    try {
      const result = await DiskCleanupApi.saveConfig({
        ...draft,
        triggerUsedPercent: trigger, okUsedPercent: ok,
        checkIntervalMinutes: Number(draft.checkIntervalMinutes) || 30,
        rules: draft.rules.map(r => ({ ...r, keepDays: Number(r.keepDays) || 0 })),
      });
      setSaved(result); setDraft(structuredClone(result));
      setNotice({ type: 'ok', text: 'Đã lưu. Các PC đang online sẽ tải cài đặt mới ngay.' });
    } catch (err) {
      setNotice({ type: 'error', text: err?.response?.data?.message || 'Không lưu được cài đặt.' });
    } finally {
      setSaving(false);
    }
  };

  if (error && !draft) {
    return (
      <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-sm flex items-center justify-between">
        <span>{error}</span>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold">Thử lại</button>
      </div>
    );
  }
  if (!draft) return <div className="p-10 text-center text-slate-500 text-sm">Đang tải…</div>;

  return (
    <div className="space-y-6">
      {/* Settings */}
      <div className="glass-panel border border-slate-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <HardDrive className="w-5 h-5 text-teal-700" />
          <h2 className="text-sm font-bold text-slate-800">Tự động dọn ổ cứng</h2>
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none">
            <input type="checkbox" checked={!!draft.enabled} onChange={e => update({ enabled: e.target.checked })} className="w-4 h-4 accent-teal-600" />
            {draft.enabled ? <span className="text-emerald-700">Đang bật</span> : <span className="text-slate-500">Đang tắt</span>}
          </label>
          <span className="text-[11px] text-slate-500 ml-auto">Áp dụng cho toàn bộ PC · Cập nhật: {formatTime(saved?.updatedAt)}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField label="Bắt đầu xóa khi ổ dùng từ" suffix="%" value={draft.triggerUsedPercent} onChange={v => update({ triggerUsedPercent: v })} />
          <NumberField label="Dừng khi ổ dùng còn (ngưỡng OK)" suffix="%" value={draft.okUsedPercent} onChange={v => update({ okUsedPercent: v })} />
          <NumberField label="Chu kỳ kiểm tra" suffix="phút" value={draft.checkIntervalMinutes} onChange={v => update({ checkIntervalMinutes: v })} />
        </div>

        <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 flex gap-2">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <div className="space-y-0.5">
            <div>Khi một ổ dùng từ <b>{draft.triggerUsedPercent}%</b> trở lên: chạy hết các quy tắc <b>Xóa toàn bộ</b> và <b>Giữ file mới nhất</b> (xóa hết, chỉ chừa lại file mới nhất trong thư mục) trước; nếu ổ vẫn trên <b>{draft.okUsedPercent}%</b> thì xóa file của các quy tắc <b>Từ cũ đến mới</b> (file cũ nhất trên ổ trước) đến khi về {draft.okUsedPercent}%.</div>
            <div>PC không có thư mục của quy tắc sẽ bỏ qua quy tắc đó (N/A). Thư mục hỗ trợ <code>{'{LogFolder}'}</code> (thư mục log của từng PC), <code>%TEMP%</code> và <code>*</code> (ví dụ <code>D:\LGE\*\RESULT</code>). Gốc ổ, Windows, Program Files và thư mục Backup_Log2 luôn bị chặn. File ghi trong 10 phút gần nhất không bao giờ bị xóa.</div>
          </div>
        </div>
      </div>

      {/* Rules */}
      <div className="glass-panel border border-slate-200 p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800">Quy tắc xóa ({draft.rules.length})</h3>
          <button onClick={addRule} className="ml-auto px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Thêm quy tắc
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-50/90 text-slate-600 uppercase font-semibold tracking-wider border-b border-slate-200 text-[10px]">
              <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:whitespace-nowrap">
                <th>Bật</th><th>Tên</th><th>Thư mục</th><th>Dạng file</th><th title="Quét cả thư mục con">Thư mục con</th>
                <th>Kiểu xóa</th><th title="Không xóa file mới hơn N ngày">Giữ lại (ngày)</th>
                <th title="Chỉ liệt kê file sẽ xóa, không xóa thật">Chạy thử</th><th>Trên các PC</th><th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {draft.rules.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-slate-500">Chưa có quy tắc. Bấm "Thêm quy tắc".</td></tr>
              )}
              {draft.rules.map(rule => {
                const s = ruleStats[rule.id];
                return (
                  <tr key={rule.id} className={`[&>td]:px-2 [&>td]:py-1.5 align-middle ${rule.enabled ? '' : 'opacity-50'}`}>
                    <td><input type="checkbox" checked={rule.enabled} onChange={e => updateRule(rule.id, { enabled: e.target.checked })} className="w-4 h-4 accent-teal-600" /></td>
                    <td><input value={rule.name} onChange={e => updateRule(rule.id, { name: e.target.value })} placeholder="Ảnh tạm" className={inputCls + ' w-28'} /></td>
                    <td><input value={rule.folder} onChange={e => updateRule(rule.id, { folder: e.target.value })} placeholder="D:\LGE\Temp" className={inputCls + ' w-56 font-mono'} /></td>
                    <td><input value={rule.pattern} onChange={e => updateRule(rule.id, { pattern: e.target.value })} placeholder="*.bmp;*.tmp" className={inputCls + ' w-28 font-mono'} /></td>
                    <td className="text-center"><input type="checkbox" checked={rule.includeSubfolders} onChange={e => updateRule(rule.id, { includeSubfolders: e.target.checked })} className="w-4 h-4 accent-teal-600" /></td>
                    <td>
                      <select value={rule.mode} onChange={e => updateRule(rule.id, { mode: e.target.value })}
                        title={rule.mode === 'KeepNewest' ? 'Xóa mọi file khớp dạng file, chỉ chừa lại 1 file mới nhất trong thư mục (chạy cùng nhóm Xóa toàn bộ)' : undefined}
                        className={`${inputCls} ${rule.mode === 'DeleteAll' ? 'text-rose-700 font-semibold' : rule.mode === 'KeepNewest' ? 'text-amber-700 font-semibold' : ''}`}>
                        <option value="OldestFirst">{MODE_LABELS.OldestFirst}</option>
                        <option value="DeleteAll">{MODE_LABELS.DeleteAll}</option>
                        <option value="KeepNewest">{MODE_LABELS.KeepNewest}</option>
                      </select>
                    </td>
                    <td><input type="number" min={0} value={rule.keepDays} onChange={e => updateRule(rule.id, { keepDays: e.target.value })} className={inputCls + ' w-16 text-right'} /></td>
                    <td className="text-center"><input type="checkbox" checked={rule.dryRun} onChange={e => updateRule(rule.id, { dryRun: e.target.checked })} className="w-4 h-4 accent-blue-600" /></td>
                    <td className="whitespace-nowrap">
                      {s ? (
                        <button onClick={() => setRuleDetail({ rule, stats: s })} className="hover:underline text-left" title="Xem danh sách PC">
                          <span className="text-emerald-700 font-semibold">Áp dụng {s.applied.length}</span>
                          <span className="text-slate-400"> · N/A {s.na.length}</span>
                          {s.blocked.length > 0 && <span className="text-rose-700 font-semibold"> · Chặn {s.blocked.length}</span>}
                          {s.bytes > 0 && <span className="text-slate-500"> · đã xóa {formatBytes(s.bytes)}</span>}
                        </button>
                      ) : <span className="text-slate-400">Chưa có báo cáo</span>}
                    </td>
                    <td>
                      <button onClick={() => removeRule(rule.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600" title="Xóa quy tắc"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={!dirty || saving}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Đang lưu…' : 'Lưu cài đặt'}
          </button>
          {dirty && <button onClick={() => setDraft(structuredClone(saved))} className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold">Hủy thay đổi</button>}
          {dirty && <span className="text-[11px] text-amber-700 font-semibold">Có thay đổi chưa lưu</span>}
          {notice && (
            <span className={`text-[11px] font-semibold flex items-center gap-1 ${notice.type === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {notice.type === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}{notice.text}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-500">Quy tắc mới mặc định bật <b>Chạy thử</b>: PC chỉ liệt kê file sẽ xóa. Kiểm tra bằng "Xem trước" ở bảng PC bên dưới, đúng rồi mới bỏ Chạy thử.</p>
      </div>

      <PcTable pcs={pcs} config={saved} dirty={dirty} onReload={loadReports} onCommand={(pc, kind) => setCommand({ pc, kind })} />

      {command && <CommandModal pc={command.pc} kind={command.kind} rules={saved?.rules || []} onClose={() => { setCommand(null); loadReports(); }} />}
      {ruleDetail && <RuleDetailModal {...ruleDetail} onClose={() => setRuleDetail(null)} />}
    </div>
  );
}

const inputCls = 'bg-slate-50/80 border border-slate-300 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-blue-500';

function NumberField({ label, suffix, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-600">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="number" min={1} value={value} onChange={e => onChange(e.target.value)}
          className="w-24 bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-sm text-right focus:outline-none focus:border-blue-500" />
        <span className="text-xs text-slate-500">{suffix}</span>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------- PCs

function DriveUsage({ pc, trigger, ok }) {
  const drives = pc.report?.drives?.length
    ? pc.report.drives.map(d => ({ drive: d.drive, used: d.usedPercentAfter ?? d.usedPercentBefore }))
    : (pc.disks || []).map(d => ({ drive: d.drive, used: d.total_gb ? Math.round((1 - d.free_gb / d.total_gb) * 1000) / 10 : null }));
  if (!drives.length) return <span className="text-slate-400">-</span>;
  return (
    <div className="space-y-0.5">
      {drives.map(d => (
        <div key={d.drive} className={`font-mono whitespace-nowrap ${d.used >= trigger ? 'text-rose-700 font-bold' : d.used > ok ? 'text-amber-700' : ''}`}>
          {d.drive} {d.used != null ? `${d.used}%` : '?'}
        </div>
      ))}
    </div>
  );
}

function PcTable({ pcs, config, dirty, onReload, onCommand }) {
  const [query, setQuery] = useState('');
  const trigger = config?.triggerUsedPercent ?? 80;
  const ok = config?.okUsedPercent ?? 70;
  const filtered = pcs.filter(pc => !query || [pc.hostname, pc.channelName, pc.macAddress].some(v => (v || '').toLowerCase().includes(query.toLowerCase())));

  return (
    <div className="glass-panel border border-slate-200 p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-800">Kết quả trên các PC</h3>
        <div className="relative ml-auto min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm PC, channel, MAC…"
            className="w-full bg-slate-50/80 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-blue-500" />
        </div>
        <button onClick={onReload} className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 text-blue-700" /> Tải lại
        </button>
      </div>
      {dirty && <div className="text-[11px] text-amber-700">Lưu cài đặt trước khi Xem trước / Dọn ngay: PC dùng cài đặt đã lưu.</div>}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-slate-50/90 text-slate-600 uppercase font-semibold tracking-wider border-b border-slate-200 text-[10px]">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:whitespace-nowrap">
              <th>Channel</th><th>PC</th><th>Trạng thái</th><th>Ổ dùng</th><th>Kiểm tra gần nhất</th>
              <th>Lần dọn gần nhất</th><th>Cảnh báo</th><th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-500">Không có PC.</td></tr>}
            {filtered.map(pc => (
              <tr key={pc.macKey} className="[&>td]:px-2 [&>td]:py-2 align-top">
                <td className="whitespace-nowrap font-semibold">{pc.channelName || '-'}</td>
                <td className="font-mono" title={pc.macAddress || ''}>{pc.hostname || pc.macAddress || '-'}</td>
                <td>{pc.isOnline ? <span className="font-semibold text-emerald-700">Online</span> : <span className="font-semibold text-rose-700">Offline</span>}</td>
                <td><DriveUsage pc={pc} trigger={trigger} ok={ok} /></td>
                <td className="whitespace-nowrap">
                  {pc.entry ? formatTime(pc.entry.receivedAt)
                    : <span className="text-slate-400" title="Backup_Log2 trên PC này chưa có tính năng dọn ổ cứng (cần update)">Chưa có báo cáo</span>}
                </td>
                <td className="whitespace-nowrap">
                  {pc.entry?.lastCleanupAt
                    ? <>{formatTime(pc.entry.lastCleanupAt)} · {pc.entry.lastCleanupFiles} file · {formatBytes(pc.entry.lastCleanupBytes)}</>
                    : <span className="text-slate-400">-</span>}
                </td>
                <td className="max-w-[260px]">{pc.entry?.warning ? <span className="text-rose-700 font-semibold">{pc.entry.warning}</span> : <span className="text-slate-400">-</span>}</td>
                <td className="whitespace-nowrap text-right">
                  <button disabled={!pc.isOnline || dirty} onClick={() => onCommand(pc, 'preview')}
                    className="px-2 py-1 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 text-[10px] font-semibold inline-flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Xem trước
                  </button>
                  <button disabled={!pc.isOnline || dirty} onClick={() => onCommand(pc, 'run')}
                    className="ml-1.5 px-2 py-1 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-40 text-[10px] font-semibold inline-flex items-center gap-1">
                    <Eraser className="w-3 h-3" /> Dọn ngay
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modals

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} max-h-[90vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto text-xs space-y-4">{children}</div>
      </div>
    </div>
  );
}

/** Sends disk.cleanup.preview / disk.cleanup.run to one PC and waits for its report. */
function CommandModal({ pc, kind, rules, onClose }) {
  const isRun = kind === 'run';
  const [state, setState] = useState(isRun ? 'confirm' : 'sending');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const start = useCallback(async () => {
    setState('sending'); setError(null);
    try {
      const sent = await DiskCleanupApi.sendCommand(pc.macAddress, isRun ? 'disk.cleanup.run' : 'disk.cleanup.preview');
      const id = sent?.command_id;
      setState('waiting');
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await DiskCleanupApi.commandStatus(id).catch(() => null);
        if (!status || status.status === 'running') continue;
        if (status.status === 'success') { setResult(camel(status.result)); setState('done'); }
        else { setError(status.error || status.message || 'PC báo lỗi.'); setState('error'); }
        return;
      }
      setError('Quá 10 phút chưa có kết quả.'); setState('error');
    } catch (err) {
      setError(err?.response?.data?.error || 'Không gửi được lệnh (PC offline?).'); setState('error');
    }
  }, [pc.macAddress, isRun]);

  useEffect(() => { if (!isRun) start(); }, [isRun, start]);

  const ruleName = (id) => rules.find(r => r.id === id)?.name || id;
  return (
    <Modal title={`${isRun ? 'Dọn ngay' : 'Xem trước'} · ${pc.hostname || pc.macAddress}`} onClose={onClose} wide>
      {state === 'confirm' && (
        <div className="space-y-3">
          <p>PC sẽ chạy ngay các quy tắc đã lưu trên <b>mọi ổ</b> (không chờ vượt ngưỡng): xóa hết file của các quy tắc <b>Xóa toàn bộ</b> (quy tắc <b>Giữ file mới nhất</b> chừa lại file mới nhất), rồi xóa file cũ nhất của các quy tắc <b>Từ cũ đến mới</b> đến khi ổ về ngưỡng OK. Quy tắc đang bật Chạy thử chỉ được liệt kê.</p>
          <button onClick={start} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold">Xác nhận dọn</button>
        </div>
      )}
      {(state === 'sending' || state === 'waiting') && <p className="text-slate-600">{state === 'sending' ? 'Đang gửi lệnh…' : 'PC đang quét thư mục…'}</p>}
      {state === 'error' && <p className="text-rose-700 font-semibold">{error}</p>}
      {state === 'done' && result && <ReportView report={result} ruleName={ruleName} />}
    </Modal>
  );
}

function ReportView({ report, ruleName }) {
  const preview = report.kind === 'preview';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <Stat label={preview ? 'Sẽ xóa' : 'Đã xóa'} value={preview ? `${report.dryRunFiles} file · ${formatBytes(report.dryRunBytes)}` : `${report.totalFiles} file · ${formatBytes(report.totalBytes)}`} />
        {!preview && report.dryRunFiles > 0 && <Stat label="Chạy thử (không xóa)" value={`${report.dryRunFiles} file · ${formatBytes(report.dryRunBytes)}`} />}
        {report.errors > 0 && <Stat label="Lỗi" value={report.errors} danger />}
      </div>
      {report.warning && <div className="text-rose-700 font-semibold">{report.warning}</div>}

      <table className="w-full text-left text-[11px] border border-slate-200 rounded-xl">
        <thead className="bg-slate-50 text-[10px] uppercase text-slate-600"><tr className="[&>th]:px-2 [&>th]:py-1.5"><th>Ổ</th><th>Dung lượng</th><th>Dùng trước</th><th>Dùng sau{preview ? ' (dự kiến)' : ''}</th></tr></thead>
        <tbody className="divide-y divide-slate-200">
          {(report.drives || []).map(d => (
            <tr key={d.drive} className="[&>td]:px-2 [&>td]:py-1.5 font-mono"><td>{d.drive}</td><td>{d.totalGb} GB</td><td>{d.usedPercentBefore}%</td><td className={d.stillAboveOk ? 'text-rose-700 font-bold' : ''}>{d.usedPercentAfter}%</td></tr>
          ))}
          {!(report.drives || []).length && <tr><td colSpan={4} className="px-2 py-2 text-slate-500">Không có ổ nào có thư mục của quy tắc.</td></tr>}
        </tbody>
      </table>

      <table className="w-full text-left text-[11px] border border-slate-200 rounded-xl">
        <thead className="bg-slate-50 text-[10px] uppercase text-slate-600"><tr className="[&>th]:px-2 [&>th]:py-1.5"><th>Quy tắc</th><th>Kết quả</th><th>Thư mục trên PC</th><th className="text-right">File</th><th className="text-right">Dung lượng</th></tr></thead>
        <tbody className="divide-y divide-slate-200">
          {(report.rules || []).map(rr => (
            <tr key={rr.ruleId} className="[&>td]:px-2 [&>td]:py-1.5 align-top">
              <td className="font-semibold">{rr.name || ruleName(rr.ruleId)}</td>
              <td className={STATUS[rr.status]?.cls}>{STATUS[rr.status]?.label || rr.status}{rr.message && <div className="text-slate-500">{rr.message}</div>}</td>
              <td className="font-mono">{(rr.folders || []).join(', ') || '-'}</td>
              <td className="text-right">{rr.files}</td>
              <td className="text-right">{formatBytes(rr.bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(report.files || []).length > 0 && (
        <div>
          <div className="font-semibold text-slate-700 mb-1">{preview ? 'File sẽ xóa' : 'File đã xử lý'} ({report.files.length}{report.filesTruncated ? '+, chỉ hiện 200 file đầu' : ''})</div>
          <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-[11px]">
              <tbody className="divide-y divide-slate-100">
                {report.files.map(f => (
                  <tr key={f.path} className="[&>td]:px-2 [&>td]:py-1">
                    <td className="font-mono break-all">{f.path}</td>
                    <td className="whitespace-nowrap text-slate-500">{formatTime(f.lastWrite)}</td>
                    <td className="whitespace-nowrap text-right">{formatBytes(f.size)}</td>
                    <td className="whitespace-nowrap text-slate-500">Pha {f.phase}{f.dryRun && !preview ? ' · chạy thử' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${danger ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-[10px] uppercase text-slate-500 font-semibold">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}

function RuleDetailModal({ rule, stats, onClose }) {
  const groups = [
    ['applied', 'Áp dụng'], ['na', 'Không có thư mục (N/A)'], ['blocked', 'Bị chặn'], ['disabled', 'Đang tắt'],
  ].filter(([key]) => stats[key].length);
  return (
    <Modal title={`Quy tắc: ${rule.name || rule.folder}`} onClose={onClose}>
      <div className="font-mono text-slate-600">{rule.folder} · {rule.pattern}</div>
      {groups.map(([key, label]) => (
        <div key={key}>
          <div className="font-semibold text-slate-700 mb-1">{label} ({stats[key].length})</div>
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
            {stats[key].map(({ pc, rr }) => (
              <div key={pc.macKey} className="px-3 py-1.5 flex gap-3">
                <span className="font-semibold w-24 shrink-0">{pc.channelName || '-'}</span>
                <span className="font-mono w-32 shrink-0 truncate">{pc.hostname || pc.macAddress}</span>
                <span className={STATUS[rr.status]?.cls}>{STATUS[rr.status]?.label || rr.status}</span>
                {rr.files > 0 && <span className="text-slate-500">{rr.files} file · {formatBytes(rr.bytes)}</span>}
                {rr.message && <span className="text-slate-500 truncate" title={rr.message}>{rr.message}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
