import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Monitor, Wifi, WifiOff, AlertTriangle, HardDrive, Cpu, Search, RefreshCw, Save, X, Trash2, CheckCircle2, HelpCircle, ArrowUpCircle
} from 'lucide-react';
import { MachinesApi } from '../services/api';
import { onMachineStatusChanged } from '../services/signalr';

// ---------------------------------------------------------------- helpers

const macKey = (mac) => (mac || '').replace(/[^0-9a-z]/gi, '').toUpperCase();

/** -1 / 0 / 1; null when one side is not a dotted number version. */
export const compareVersions = (a, b) => {
  const pa = String(a || '').trim().split('.').map(Number);
  const pb = String(b || '').trim().split('.').map(Number);
  if (!a || !b || pa.some(isNaN) || pb.some(isNaN)) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

/** 'standard' | 'old' | 'newer' | 'unknown' | 'nostandard' */
export const versionState = (version, standard) => {
  if (!version) return 'unknown';
  if (!standard) return 'nostandard';
  const c = compareVersions(version, standard);
  if (c === null) return 'unknown';
  return c === 0 ? 'standard' : c < 0 ? 'old' : 'newer';
};

const LOW_DISK_GB = 5;
const LOW_DISK_RATIO = 0.1;
export const isLowDisk = (m) => m.diskFreeGb != null && (m.diskFreeGb < LOW_DISK_GB || (m.diskTotalGb && m.diskFreeGb / m.diskTotalGb < LOW_DISK_RATIO));

const pad = (n) => String(n).padStart(2, '0');
const formatTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d)) return '-';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const formatAgo = (value, now) => {
  if (!value) return '-';
  const seconds = Math.max(0, Math.round((now - new Date(value)) / 1000));
  if (seconds < 60) return `${seconds}s trước`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  return `${Math.floor(seconds / 86400)} ngày trước`;
};
const formatUptime = (value, now) => {
  if (!value) return '-';
  const minutes = Math.max(0, Math.floor((now - new Date(value)) / 60000));
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function VersionBadge({ version, standard }) {
  const state = versionState(version, standard);
  const styles = {
    standard: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    old: 'bg-amber-50 text-amber-700 border-amber-300',
    newer: 'bg-blue-50 text-blue-700 border-blue-300',
    unknown: 'bg-slate-100 text-slate-500 border-slate-300',
    nostandard: 'bg-slate-50 text-slate-700 border-slate-300',
  };
  const titles = {
    standard: 'Đúng version chuẩn',
    old: `Cũ hơn version chuẩn ${standard}`,
    newer: `Mới hơn version chuẩn ${standard}`,
    unknown: 'Chưa rõ version (Backup_Log2 bản cũ chưa gửi version)',
    nostandard: 'Chưa đặt version chuẩn',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold whitespace-nowrap ${styles[state]}`} title={titles[state]}>
      {state === 'old' && <AlertTriangle className="w-3 h-3" />}
      {state === 'standard' && <CheckCircle2 className="w-3 h-3" />}
      {state === 'newer' && <ArrowUpCircle className="w-3 h-3" />}
      {version || 'chưa rõ'}
    </span>
  );
}

function StatusBadge({ online, neverConnected }) {
  if (neverConnected) return <span className="badge badge-ng font-sans opacity-70 whitespace-nowrap" title="Channel đã đăng ký nhưng PC chưa từng kết nối từ khi có module này">Chưa kết nối</span>;
  return online
    ? <span className="badge badge-ok font-sans whitespace-nowrap"><span className="pulse-dot pulse-dot-green"></span>Online</span>
    : <span className="badge badge-ng font-sans whitespace-nowrap">Offline</span>;
}

// ---------------------------------------------------------------- data

/** PCs from the server, plus channels with a MAC that never connected; names from master data. */
function usePcData(channels, stations, lines) {
  const [data, setData] = useState({ machines: [], standardVersion: null, offlineAfterSeconds: 180 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await MachinesApi.getAll();
      setData({ machines: result.machines || [], standardVersion: result.standardVersion || null, offlineAfterSeconds: result.offlineAfterSeconds || 180 });
      setError(null);
    } catch (err) {
      setError(err?.response?.status === 404 ? 'Backend chưa có API giám sát PC (cần khởi động lại backend bản mới).' : 'Không tải được dữ liệu PC.');
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    load();
    // Online also depends on time (no telemetry for 3 min): refresh regularly.
    const poll = setInterval(load, 30000);
    const tick = setInterval(() => setNow(Date.now()), 10000);
    // Connect / disconnect / telemetry events: reload shortly after (events come in bursts).
    const unsubscribe = onMachineStatusChanged(() => {
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 1500);
    });
    return () => { clearInterval(poll); clearInterval(tick); clearTimeout(timer.current); unsubscribe?.(); };
  }, [load]);

  const rows = useMemo(() => {
    const stationById = new Map(stations.map(s => [s.id, s]));
    const lineById = new Map(lines.map(l => [l.id, l]));
    const channelById = new Map(channels.map(c => [c.id, c]));
    const channelByMac = new Map(channels.filter(c => c.macAddress).map(c => [macKey(c.macAddress), c]));
    const describe = (channel) => {
      const station = channel ? stationById.get(channel.stationId) : null;
      const line = station ? lineById.get(station.lineId) : (channel?.lineId ? lineById.get(channel.lineId) : null);
      return {
        channelName: channel?.name || null,
        stationName: station?.name || channel?.stationName || null,
        lineName: line?.name || channel?.lineName || null,
        lineId: line?.id ?? station?.lineId ?? channel?.lineId ?? null,
        channelIp: channel?.ipAddress || null,
      };
    };
    const seen = new Set();
    const result = data.machines.map(m => {
      const channel = (m.channelId && channelById.get(m.channelId)) || channelByMac.get(m.macKey) || null;
      if (channel) seen.add(channel.id);
      return { ...m, ...describe(channel), channelId: m.channelId ?? channel?.id ?? null, neverConnected: false };
    });
    channels.filter(c => c.macAddress && !seen.has(c.id) && !data.machines.some(m => m.macKey === macKey(c.macAddress)))
      .forEach(c => result.push({
        macKey: macKey(c.macAddress), macAddress: c.macAddress, channelId: c.id, isOnline: false, neverConnected: true,
        ...describe(c),
      }));
    return result.sort((a, b) =>
      (a.lineName || '~').localeCompare(b.lineName || '~', undefined, { numeric: true }) ||
      (a.stationName || '~').localeCompare(b.stationName || '~', undefined, { numeric: true }) ||
      (a.channelName || '~').localeCompare(b.channelName || '~', undefined, { numeric: true }));
  }, [data.machines, channels, stations, lines]);

  return { rows, standardVersion: data.standardVersion, offlineAfterSeconds: data.offlineAfterSeconds, loading, error, now, reload: load, setStandardVersion: (v) => setData(d => ({ ...d, standardVersion: v })) };
}

// ---------------------------------------------------------------- detail

function PcDetail({ pc, standardVersion, now, onClose, onDelete }) {
  const items = [
    ['Trạng thái', <StatusBadge key="s" online={pc.isOnline} neverConnected={pc.neverConnected} />],
    ['Dây chuyền / Trạm / Channel', `${pc.lineName || '-'} / ${pc.stationName || '-'} / ${pc.channelName || '-'} (#${pc.channelId ?? '-'})`],
    ['Hostname', pc.hostname || '-'],
    ['IP', pc.ipAddress || pc.channelIp || '-'],
    ['MAC', pc.macAddress || pc.macKey],
    ['Hệ điều hành', pc.osVersion || '-'],
    ['Version Backup_Log2', <VersionBadge key="v" version={pc.appVersion} standard={standardVersion} />],
    ['Log type', pc.logType || '-'],
    ['Thư mục log', pc.logFolders || '-'],
    ['Model hiện tại', pc.currentModel || '-'],
    ['CPU', pc.cpuPercent != null ? `${pc.cpuPercent}%` : '-'],
    ['RAM', pc.ramTotalMb ? `${(pc.ramUsedMb / 1024).toFixed(1)} / ${(pc.ramTotalMb / 1024).toFixed(1)} GB` : '-'],
    ['Ổ đĩa log', pc.diskTotalGb ? `${pc.diskDrive || ''} trống ${pc.diskFreeGb} / ${pc.diskTotalGb} GB` : '-'],
    ['App chạy được', pc.appStartedAt ? `${formatUptime(pc.appStartedAt, now)} (từ ${formatTime(pc.appStartedAt)})` : '-'],
    ['Upload thành công gần nhất', pc.lastUploadAt ? `${formatTime(pc.lastUploadAt)} (${formatAgo(pc.lastUploadAt, now)})` : '-'],
    ['Lần cuối thấy', pc.lastSeenAt ? `${formatTime(pc.lastSeenAt)} (${formatAgo(pc.lastSeenAt, now)})` : '-'],
    ['Kết nối lúc', formatTime(pc.connectedAt)],
    ['Mất kết nối lúc', formatTime(pc.disconnectedAt)],
  ];
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel max-w-2xl w-full p-6 space-y-4 border border-slate-200 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start border-b border-slate-200 pb-3">
          <h3 className="text-lg font-bold text-slate-900 font-display flex items-center gap-2">
            <Monitor className="w-5 h-5 text-teal-700" /> {pc.hostname || pc.channelName || pc.macAddress}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-600 hover:bg-slate-200"><X className="w-5 h-5" /></button>
        </div>
        {pc.isLegacy && !pc.neverConnected && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-xs">
            PC đang chạy Backup_Log2 bản cũ: chưa gửi version thật và thông tin PC. Cập nhật Backup_Log2 để có đủ dữ liệu.
          </div>
        )}
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
          {items.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-slate-500 font-semibold">{label}</dt>
              <dd className="sm:col-span-2 text-slate-900 font-mono break-all">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
        {!pc.neverConnected && !pc.isOnline && (
          <div className="flex justify-end pt-2 border-t border-slate-200">
            <button onClick={() => onDelete(pc)} className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 text-xs font-semibold flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" /> Xóa PC khỏi danh sách (PC không dùng nữa)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pages

export default function PcMonitor({ view = 'overview', channels = [], stations = [], lines = [] }) {
  const { rows, standardVersion, offlineAfterSeconds, loading, error, now, reload, setStandardVersion } = usePcData(channels, stations, lines);
  const [selected, setSelected] = useState(null);

  const handleDelete = async (pc) => {
    if (!window.confirm(`Xóa PC ${pc.hostname || pc.macAddress} khỏi danh sách giám sát? Nếu PC kết nối lại nó sẽ tự xuất hiện.`)) return;
    try { await MachinesApi.remove(pc.macKey); setSelected(null); reload(); } catch { window.alert('Không xóa được PC.'); }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={reload} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold">Thử lại</button>
        </div>
      )}
      {view === 'overview'
        ? <Overview rows={rows} standardVersion={standardVersion} offlineAfterSeconds={offlineAfterSeconds} loading={loading} now={now} onSelect={setSelected} onStandardSaved={setStandardVersion} />
        : <PcList rows={rows} lines={lines} standardVersion={standardVersion} loading={loading} now={now} onSelect={setSelected} onReload={reload} />}
      {selected && <PcDetail pc={selected} standardVersion={standardVersion} now={now} onClose={() => setSelected(null)} onDelete={handleDelete} />}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone, hint }) {
  return (
    <div className="glass-panel border border-slate-200 p-4 flex items-center gap-3" title={hint}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}><Icon className="w-5 h-5" /></div>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className="text-2xl font-bold text-slate-900 font-mono">{value}</div>
      </div>
    </div>
  );
}

function Overview({ rows, standardVersion, offlineAfterSeconds, loading, now, onSelect, onStandardSaved }) {
  const [draft, setDraft] = useState(standardVersion || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  useEffect(() => setDraft(standardVersion || ''), [standardVersion]);

  const online = rows.filter(r => r.isOnline).length;
  const offline = rows.length - online;
  const versions = useMemo(() => {
    const map = new Map();
    rows.filter(r => !r.neverConnected).forEach(r => {
      const key = r.appVersion || '';
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => (compareVersions(b[0], a[0]) ?? (a[0] ? -1 : 1)));
  }, [rows]);
  const oldCount = rows.filter(r => versionState(r.appVersion, standardVersion) === 'old').length;
  const unknownCount = rows.filter(r => !r.neverConnected && !r.appVersion).length;
  const lowDisk = rows.filter(isLowDisk);
  const offlineRows = rows.filter(r => !r.isOnline && !r.neverConnected)
    .sort((a, b) => new Date(b.disconnectedAt || b.lastSeenAt || 0) - new Date(a.disconnectedAt || a.lastSeenAt || 0));

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const result = await MachinesApi.setStandardVersion(draft.trim() || null);
      onStandardSaved(result.version || null);
      setMessage({ ok: true, text: result.version ? `Đã đặt version chuẩn ${result.version}` : 'Đã bỏ version chuẩn' });
    } catch (err) {
      setMessage({ ok: false, text: err?.response?.data?.message || 'Không lưu được version chuẩn.' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi icon={Monitor} label="Tổng PC" value={loading ? '…' : rows.length} tone="bg-slate-100 text-slate-700" />
        <Kpi icon={Wifi} label="Online" value={online} tone="bg-emerald-100 text-emerald-700" />
        <Kpi icon={WifiOff} label="Offline" value={offline} tone="bg-rose-100 text-rose-700" hint={`Mất kết nối, hoặc không gửi tín hiệu quá ${Math.round(offlineAfterSeconds / 60)} phút`} />
        <Kpi icon={AlertTriangle} label="Version cũ" value={standardVersion ? oldCount : '-'} tone="bg-amber-100 text-amber-700" hint="Cũ hơn version chuẩn" />
        <Kpi icon={HelpCircle} label="Chưa rõ version" value={unknownCount} tone="bg-slate-100 text-slate-600" hint="Backup_Log2 bản cũ, chưa gửi version thật" />
        <Kpi icon={HardDrive} label="Ổ đĩa sắp đầy" value={lowDisk.length} tone="bg-orange-100 text-orange-700" hint={`Còn dưới ${LOW_DISK_GB} GB hoặc dưới ${LOW_DISK_RATIO * 100}%`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="glass-panel border border-slate-200 p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 font-display">Version chuẩn Backup_Log2</h3>
          <div className="flex gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="vd. 2.0.6.144"
              className="flex-1 bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
            <button onClick={save} disabled={saving} className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-4 h-4" /> Lưu
            </button>
          </div>
          {message && <p className={`text-xs ${message.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p>}
          <p className="text-[11px] text-slate-500">PC chạy version thấp hơn version chuẩn được đánh dấu màu vàng. Để trống để bỏ so sánh.</p>
          <div className="space-y-1.5 pt-3 border-t border-slate-200">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Phân bố version</div>
            {versions.length === 0 && <p className="text-xs text-slate-500">Chưa có dữ liệu.</p>}
            {versions.map(([version, count]) => (
              <div key={version || 'unknown'} className="flex items-center justify-between gap-2">
                <VersionBadge version={version || null} standard={standardVersion} />
                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500" style={{ width: `${(count / Math.max(1, rows.length)) * 100}%` }} />
                </div>
                <span className="text-xs font-mono font-bold text-slate-700 w-10 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel border border-slate-200 p-5 space-y-3 xl:col-span-2">
          <h3 className="text-sm font-bold text-slate-900 font-display flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-rose-700" /> PC đang offline ({offlineRows.length})
          </h3>
          <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] sticky top-0">
                <tr><th className="p-2 text-left">Line / Trạm / Channel</th><th className="p-2 text-left">Hostname</th><th className="p-2 text-left">Version</th><th className="p-2 text-left">Mất kết nối</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {offlineRows.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">Không có PC nào offline.</td></tr>}
                {offlineRows.map(r => (
                  <tr key={r.macKey} className="hover:bg-slate-100 cursor-pointer" onClick={() => onSelect(r)}>
                    <td className="p-2">{r.lineName || '-'} / {r.stationName || '-'} / <b>{r.channelName || '-'}</b></td>
                    <td className="p-2 font-mono">{r.hostname || '-'}</td>
                    <td className="p-2"><VersionBadge version={r.appVersion} standard={standardVersion} /></td>
                    <td className="p-2 text-slate-600">{formatAgo(r.disconnectedAt || r.lastSeenAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lowDisk.length > 0 && (
            <div className="text-xs text-orange-800 bg-orange-50 border border-orange-300 rounded-xl p-3">
              <b>Ổ đĩa sắp đầy:</b> {lowDisk.map(r => `${r.channelName || r.hostname || r.macAddress} (${r.diskDrive} còn ${r.diskFreeGb} GB)`).join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PcList({ rows, lines, standardVersion, loading, now, onSelect, onReload }) {
  const [search, setSearch] = useState('');
  const [lineId, setLineId] = useState('');
  const [status, setStatus] = useState('all');
  const [version, setVersion] = useState('all');

  const filtered = rows.filter(r => {
    if (status === 'online' && !r.isOnline) return false;
    if (status === 'offline' && r.isOnline) return false;
    if (lineId && String(r.lineId) !== lineId) return false;
    const vs = versionState(r.appVersion, standardVersion);
    if (version === 'standard' && vs !== 'standard') return false;
    if (version === 'old' && vs !== 'old') return false;
    if (version === 'unknown' && r.appVersion) return false;
    if (search) {
      const text = `${r.hostname} ${r.ipAddress} ${r.channelIp} ${r.macAddress} ${r.channelName} ${r.stationName} ${r.lineName} ${r.logType} ${r.appVersion}`.toLowerCase();
      if (!text.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const select = 'bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-blue-500';
  return (
    <div className="glass-panel border border-slate-200 p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm hostname, IP, MAC, channel, log type…"
            className="w-full bg-slate-50/80 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-blue-500" />
        </div>
        <select value={lineId} onChange={e => setLineId(e.target.value)} className={select}>
          <option value="">Tất cả dây chuyền</option>
          {lines.map(l => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className={select}>
          <option value="all">Online + Offline</option>
          <option value="online">Chỉ Online</option>
          <option value="offline">Chỉ Offline</option>
        </select>
        <select value={version} onChange={e => setVersion(e.target.value)} className={select}>
          <option value="all">Mọi version</option>
          <option value="standard">Đúng version chuẩn</option>
          <option value="old">Cũ hơn chuẩn</option>
          <option value="unknown">Chưa rõ version</option>
        </select>
        <button onClick={onReload} className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 text-blue-700" /> Tải lại
        </button>
        <span className="text-xs text-slate-600 font-mono">Hiển thị {filtered.length} / {rows.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/90 text-slate-600 uppercase font-semibold tracking-wider border-b border-slate-200 text-[10px]">
            <tr>
              <th className="p-3">Trạng thái</th>
              <th className="p-3">Line / Trạm / Channel</th>
              <th className="p-3">Hostname</th>
              <th className="p-3">IP</th>
              <th className="p-3">Version</th>
              <th className="p-3">Log type</th>
              <th className="p-3 text-right">CPU</th>
              <th className="p-3 text-right">RAM</th>
              <th className="p-3 text-right">Ổ trống</th>
              <th className="p-3">Upload gần nhất</th>
              <th className="p-3">Lần cuối thấy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.length === 0 && (
              <tr><td colSpan={11} className="p-10 text-center text-slate-500">{loading ? 'Đang tải…' : 'Không có PC phù hợp bộ lọc.'}</td></tr>
            )}
            {filtered.map(r => (
              <tr key={r.macKey} className="hover:bg-slate-100/70 cursor-pointer" onClick={() => onSelect(r)}>
                <td className="p-3"><StatusBadge online={r.isOnline} neverConnected={r.neverConnected} /></td>
                <td className="p-3 whitespace-nowrap">{r.lineName || '-'} / {r.stationName || '-'} / <b>{r.channelName || '-'}</b></td>
                <td className="p-3 font-mono">{r.hostname || '-'}</td>
                <td className="p-3 font-mono text-blue-700 max-w-[160px] truncate" title={r.ipAddress || r.channelIp || ''}>{r.ipAddress || r.channelIp || '-'}</td>
                <td className="p-3"><VersionBadge version={r.appVersion} standard={standardVersion} /></td>
                <td className="p-3 max-w-[160px] truncate" title={r.logType || ''}>{r.logType || '-'}</td>
                <td className="p-3 text-right font-mono">{r.cpuPercent != null ? `${r.cpuPercent}%` : '-'}</td>
                <td className="p-3 text-right font-mono">{r.ramTotalMb ? `${Math.round((r.ramUsedMb / r.ramTotalMb) * 100)}%` : '-'}</td>
                <td className={`p-3 text-right font-mono ${isLowDisk(r) ? 'text-orange-700 font-bold' : ''}`}>{r.diskFreeGb != null ? `${r.diskFreeGb} GB` : '-'}</td>
                <td className="p-3 text-slate-600 whitespace-nowrap">{formatAgo(r.lastUploadAt, now)}</td>
                <td className="p-3 text-slate-600 whitespace-nowrap">{formatAgo(r.lastSeenAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> Bấm vào một dòng để xem chi tiết PC. CPU/RAM/ổ đĩa cập nhật mỗi phút từ Backup_Log2 bản mới.</p>
    </div>
  );
}
