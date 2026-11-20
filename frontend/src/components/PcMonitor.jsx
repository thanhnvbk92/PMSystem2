import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Monitor, Wifi, WifiOff, AlertTriangle, HardDrive, Cpu, Search, RefreshCw, X, Trash2, CheckCircle2, HelpCircle, ArrowUpCircle, Clock
} from 'lucide-react';
import { MachinesApi, CommandApi } from '../services/api';
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
// A drive is shown red when used above 80 % (free below 20 %) or free below 5 GB.
const LOW_DISK_RATIO = 0.2;
const isLowDrive = (free, total) => free != null && (free < LOW_DISK_GB || (total && free / total < LOW_DISK_RATIO));
/** Drives of a PC: every fixed drive (new builds) or the log drive only (older builds). */
const drivesOf = (m) => (m.disks && m.disks.length)
  ? m.disks.map(d => ({ drive: d.drive, total: d.total_gb, free: d.free_gb }))
  : (m.diskFreeGb != null ? [{ drive: m.diskDrive, total: m.diskTotalGb, free: m.diskFreeGb }] : []);
const lowDrives = (m) => drivesOf(m).filter(d => isLowDrive(d.free, d.total));
export const isLowDisk = (m) => lowDrives(m).length > 0;

// PC clock: wall clock shown on the PC minus the server's (time zones are not used). Above this the
// row is red and offers "Sync giờ" (Backup_Log2 then sets the PC clock to the server wall clock).
const CLOCK_DRIFT_LIMIT_SECONDS = 60;
const isClockOff = (m) => m.clockOffsetSeconds != null && Math.abs(m.clockOffsetSeconds) > CLOCK_DRIFT_LIMIT_SECONDS;
const canUpdate = (m, standard) => m.isOnline && versionState(m.appVersion, standard) === 'old';
const canSyncTime = (m) => m.isOnline && isClockOff(m);
const formatOffset = (seconds) => {
  const sign = seconds < 0 ? '-' : '+';
  let rest = Math.round(Math.abs(seconds));
  const d = Math.floor(rest / 86400); rest %= 86400;
  const h = Math.floor(rest / 3600); rest %= 3600;
  const m = Math.floor(rest / 60); const sec = rest % 60;
  const parts = d ? [`${d} ngày`, `${h} h`] : h ? [`${h} h`, `${m} m`] : m ? [`${m} m`, `${sec} s`] : [`${sec} s`];
  return sign + parts.join(' ');
};

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

/** Wall clock shown on the PC now (server time + measured drift) and the drift. */
function PcClock({ pc, now, serverSkewMs = 0 }) {
  if (pc.clockOffsetSeconds == null) {
    return <span className="text-slate-400" title="Cần Backup_Log2 bản mới (gửi giờ của PC trong telemetry)">—</span>;
  }
  const off = isClockOff(pc);
  const d = new Date(now + serverSkewMs + pc.clockOffsetSeconds * 1000);
  const server = new Date(now + serverSkewMs);
  // The date only when the PC is on another day than the server (keeps the column narrow).
  const otherDay = d.toDateString() !== server.toDateString();
  return (
    <span className={`font-mono whitespace-nowrap ${off ? 'text-rose-700 font-bold' : 'text-slate-700'}`}
      title={`Giờ đang hiển thị trên PC: ${formatTime(d)} (đo lúc nhận telemetry gần nhất). Lệch so với server: ${formatOffset(pc.clockOffsetSeconds)}`}>
      {otherDay && `${pad(d.getDate())}/${pad(d.getMonth() + 1)} `}{pad(d.getHours())}:{pad(d.getMinutes())}
      <span className={`ml-1.5 text-[10px] ${off ? '' : 'text-slate-400'}`}>({formatOffset(pc.clockOffsetSeconds)})</span>
    </span>
  );
}

/** Sends update / time.sync to PCs by MAC and keeps a short status per PC. */
function useMachineCommands() {
  const [sent, setSent] = useState({});
  const send = useCallback(async (pcs, kind) => {
    const mark = (pc, value) => setSent(prev => ({ ...prev, [`${kind}:${pc.macKey}`]: value }));
    await Promise.all(pcs.map(async (pc) => {
      mark(pc, 'sending');
      try {
        if (kind === 'update') {
          await CommandApi.updateApp({ macAddress: pc.macAddress, force: false, updateXmlPath: null });
        } else {
          await CommandApi.sendCommand({ macAddress: pc.macAddress, command: 'time.sync', data: null });
        }
        mark(pc, 'sent');
      } catch {
        mark(pc, 'error');
      }
    }));
  }, []);
  return { sent, send };
}

function CommandButton({ pc, kind, commands }) {
  const state = commands.sent[`${kind}:${pc.macKey}`];
  const isUpdate = kind === 'update';
  const Icon = isUpdate ? ArrowUpCircle : Clock;
  const label = state === 'sending' ? 'Đang gửi…' : state === 'sent' ? 'Đã gửi' : state === 'error' ? 'Lỗi, gửi lại' : isUpdate ? 'Update' : 'Sync giờ';
  return (
    <button type="button" disabled={state === 'sending'}
      onClick={(e) => { e.stopPropagation(); commands.send([pc], kind); }}
      title={isUpdate ? 'Gửi lệnh update Backup_Log2 tới PC này' : 'Gửi lệnh time.sync: PC đặt giờ theo giờ server (giữ múi giờ của PC)'}
      className={`ml-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap disabled:opacity-50 ${
        state === 'error' ? 'border-rose-300 bg-rose-50 text-rose-700'
          : state === 'sent' ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : isUpdate ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

/** % free of each drive on one line ("C 82% · D 15%"), red when low; free / total GB on hover. */
function DriveList({ pc, detailed = false }) {
  const drives = drivesOf(pc);
  if (drives.length === 0) return <span className="text-slate-400">-</span>;
  const tip = drives.map(d => `${d.drive || '?'} trống ${d.free} GB / tổng ${d.total ?? '?'} GB` +
    (d.total ? ` (${Math.round((d.free / d.total) * 100)}% trống)` : '')).join('\n');
  return (
    <span className="inline-flex flex-wrap gap-x-2 font-mono whitespace-nowrap" title={tip}>
      {drives.map(d => {
        const pct = d.total ? Math.round((d.free / d.total) * 100) : null;
        const low = isLowDrive(d.free, d.total);
        return (
          <span key={d.drive || 'drive'} className={low ? 'text-rose-700 font-bold' : 'text-slate-700'}>
            {(d.drive || '?').replace(':', '')} {pct != null ? `${pct}%` : `${d.free} GB`}
            {detailed && <span className="font-normal text-slate-500"> ({d.free} / {d.total ?? '?'} GB)</span>}
          </span>
        );
      })}
    </span>
  );
}

/** Status as coloured text (PC list). */
function StatusText({ online, neverConnected }) {
  if (neverConnected) return <span className="text-slate-400 whitespace-nowrap" title="Channel đã đăng ký nhưng PC chưa từng kết nối từ khi có module này">Chưa kết nối</span>;
  return online
    ? <span className="font-semibold text-emerald-700 whitespace-nowrap">Online</span>
    : <span className="font-semibold text-rose-700 whitespace-nowrap">Offline</span>;
}

// ---------------------------------------------------------------- data

/** PCs from the server, plus channels with a MAC that never connected; names from master data. */
function usePcData(channels, stations, lines) {
  const [data, setData] = useState({ machines: [], standardVersion: null, offlineAfterSeconds: 180, serverSkewMs: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await MachinesApi.getAll();
      // The PC clock column is server time + PC drift, so a wrong clock on this browser does not matter.
      const serverMs = result.serverTime ? new Date(result.serverTime).getTime() : NaN;
      setData({ machines: result.machines || [], standardVersion: result.standardVersion || null,
        offlineAfterSeconds: result.offlineAfterSeconds || 180,
        serverSkewMs: Number.isFinite(serverMs) ? serverMs - Date.now() : 0 });
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

  return { rows, standardVersion: data.standardVersion,
    offlineAfterSeconds: data.offlineAfterSeconds, serverSkewMs: data.serverSkewMs, loading, error, now, reload: load };
}

// ---------------------------------------------------------------- detail

function PcDetail({ pc, standardVersion, now, serverSkewMs, onClose, onDelete }) {
  const items = [
    ['Trạng thái', <StatusBadge key="s" online={pc.isOnline} neverConnected={pc.neverConnected} />],
    ['Dây chuyền / Trạm / Channel', `${pc.lineName || '-'} / ${pc.stationName || '-'} / ${pc.channelName || '-'} (#${pc.channelId ?? '-'})`],
    ['Hostname', pc.hostname || '-'],
    ['IP kết nối tới server', pc.connectedIp || '-'],
    ['IP các card mạng', pc.ipAddress || '-'],
    ['MAC', pc.macAddress || pc.macKey],
    ['Hệ điều hành', pc.osVersion || '-'],
    ['Version Backup_Log2', <VersionBadge key="v" version={pc.appVersion} standard={standardVersion} />],
    ['Giờ PC', <PcClock key="c" pc={pc} now={now} serverSkewMs={serverSkewMs} />],
    ['Log type', pc.logType || '-'],
    ['Thư mục log', pc.logFolders || '-'],
    ['Model hiện tại', pc.currentModel || '-'],
    ['CPU', pc.cpuPercent != null ? `${pc.cpuPercent}%` : '-'],
    ['RAM', pc.ramTotalMb ? `${(pc.ramUsedMb / 1024).toFixed(1)} / ${(pc.ramTotalMb / 1024).toFixed(1)} GB` : '-'],
    ['Ổ đĩa (% trống)', <DriveList key="d" pc={pc} detailed />],
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
  const { rows, standardVersion, offlineAfterSeconds, serverSkewMs, loading, error, now, reload } = usePcData(channels, stations, lines);
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
        ? <Overview rows={rows} standardVersion={standardVersion} offlineAfterSeconds={offlineAfterSeconds} loading={loading} now={now} onSelect={setSelected} />
        : <PcList rows={rows} lines={lines} standardVersion={standardVersion} loading={loading} now={now} serverSkewMs={serverSkewMs} onSelect={setSelected} onReload={reload} />}
      {selected && <PcDetail pc={selected} standardVersion={standardVersion} now={now} serverSkewMs={serverSkewMs} onClose={() => setSelected(null)} onDelete={handleDelete} />}
    </div>
  );
}

const sharePct = (count, total) => (total > 0 && typeof count === 'number' ? `${((count / total) * 100).toFixed(count && count < total / 100 ? 1 : 0)}%` : null);

function Kpi({ icon: Icon, label, value, total, tone, hint }) {
  const pct = total != null ? sharePct(value, total) : null;
  return (
    <div className="glass-panel border border-slate-200 px-3 py-2.5 flex items-center gap-3" title={hint}>
      <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${tone}`}><Icon className="w-4 h-4" /></div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-slate-900 font-mono">{value}</span>
          {pct && <span className="text-xs font-semibold text-slate-500 font-mono" title="Tỉ lệ trên tổng số PC">{pct}</span>}
        </div>
      </div>
    </div>
  );
}

function Overview({ rows, standardVersion, offlineAfterSeconds, loading, now, onSelect }) {

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
  const clockOff = rows.filter(isClockOff);
  // One row per low drive (PC + drive), least free space first.
  const lowDriveRows = useMemo(() => rows.flatMap(r => lowDrives(r).map(d => ({
    pc: r, ...d, pct: d.total ? Math.round((d.free / d.total) * 100) : null,
  }))).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || (a.free ?? 0) - (b.free ?? 0)), [rows]);
  const offlineRows = rows.filter(r => !r.isOnline && !r.neverConnected)
    .sort((a, b) => new Date(b.disconnectedAt || b.lastSeenAt || 0) - new Date(a.disconnectedAt || a.lastSeenAt || 0));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi icon={Monitor} label="Tổng PC" value={loading ? '…' : rows.length} tone="bg-slate-100 text-slate-700" />
        <Kpi icon={Wifi} label="Online" value={online} total={rows.length} tone="bg-emerald-100 text-emerald-700" />
        <Kpi icon={WifiOff} label="Offline" value={offline} total={rows.length} tone="bg-rose-100 text-rose-700" hint={`Mất kết nối, hoặc không gửi tín hiệu quá ${Math.round(offlineAfterSeconds / 60)} phút`} />
        <Kpi icon={AlertTriangle} label="Version cũ" value={standardVersion ? oldCount : '-'} total={rows.length} tone="bg-amber-100 text-amber-700" hint="Cũ hơn version chuẩn" />
        <Kpi icon={HelpCircle} label="Chưa rõ version" value={unknownCount} total={rows.length} tone="bg-slate-100 text-slate-600" hint="Backup_Log2 bản cũ, chưa gửi version thật" />
        <Kpi icon={Clock} label="Lệch giờ" value={clockOff.length} total={rows.length} tone="bg-blue-100 text-blue-700" hint={`Giờ PC lệch giờ server quá ${CLOCK_DRIFT_LIMIT_SECONDS} giây`} />
        <Kpi icon={HardDrive} label="Ổ đĩa sắp đầy" value={lowDisk.length} total={rows.length} tone="bg-rose-100 text-rose-700" hint={`Số PC có ổ đã dùng trên ${100 - LOW_DISK_RATIO * 100}% hoặc còn dưới ${LOW_DISK_GB} GB`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="glass-panel border border-slate-200 p-4 space-y-2">
          <h3 className="text-sm font-bold text-slate-900 font-display"
            title="Xanh = version mới nhất các PC đang chạy; vàng = cũ hơn (có nút Update trong Danh sách PC)">Phân bố version Backup_Log2</h3>
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {versions.length === 0 && <p className="text-xs text-slate-500">Chưa có dữ liệu.</p>}
            {versions.map(([version, count]) => (
              <div key={version || 'unknown'} className="flex items-center justify-between gap-2">
                <VersionBadge version={version || null} standard={standardVersion} />
                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500" style={{ width: `${(count / Math.max(1, rows.length)) * 100}%` }} />
                </div>
                <span className="text-xs font-mono font-bold text-slate-700 w-10 text-right">{count}</span>
                <span className="text-[11px] font-mono text-slate-500 w-10 text-right">{sharePct(count, rows.length)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel border border-slate-200 p-4 space-y-2 xl:col-span-2">
          <h3 className="text-sm font-bold text-slate-900 font-display flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-rose-700" /> PC đang offline ({offlineRows.length})
          </h3>
          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] sticky top-0">
                <tr><th className="px-2 py-1 text-left">Line</th><th className="px-2 py-1 text-left">Trạm</th><th className="px-2 py-1 text-left">Channel</th><th className="px-2 py-1 text-left">Hostname</th><th className="px-2 py-1 text-left">Version</th><th className="px-2 py-1 text-left">Mất kết nối</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {offlineRows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">Không có PC nào offline.</td></tr>}
                {offlineRows.map(r => (
                  <tr key={r.macKey} className="hover:bg-slate-100 cursor-pointer" onClick={() => onSelect(r)}>
                    <td className="px-2 py-1 whitespace-nowrap">{r.lineName || '-'}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.stationName || '-'}</td>
                    <td className="px-2 py-1 max-w-[80px] truncate font-semibold" title={r.channelName || ''}>{r.channelName || '-'}</td>
                    <td className="px-2 py-1 font-mono">{r.hostname || '-'}</td>
                    <td className="px-2 py-1"><VersionBadge version={r.appVersion} standard={standardVersion} /></td>
                    <td className="px-2 py-1 text-slate-600">{formatAgo(r.disconnectedAt || r.lastSeenAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Low drives: one row per drive, least free first. */}
      <div className="glass-panel border border-slate-200 p-4 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 font-display flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-rose-700" /> Ổ đĩa sắp đầy ({lowDriveRows.length} ổ / {lowDisk.length} PC)
          </h3>
          <span className="text-[11px] text-slate-500">Ổ đã dùng trên {100 - LOW_DISK_RATIO * 100}% hoặc còn dưới {LOW_DISK_GB} GB · bấm một dòng để xem chi tiết PC</span>
        </div>
        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] sticky top-0">
              <tr className="text-left [&>th]:px-2 [&>th]:py-1 [&>th]:whitespace-nowrap">
                <th>Line</th><th>Trạm</th><th>Channel</th><th>IP</th><th>Ổ</th>
                <th className="w-48">% trống</th><th className="text-right">Trống / Tổng</th><th>Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {lowDriveRows.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-500">Không có ổ đĩa nào sắp đầy.</td></tr>}
              {lowDriveRows.map(d => (
                <tr key={`${d.pc.macKey}-${d.drive}`} className="hover:bg-slate-100 cursor-pointer [&>td]:px-2 [&>td]:py-1" onClick={() => onSelect(d.pc)}>
                  <td className="whitespace-nowrap">{d.pc.lineName || '-'}</td>
                  <td className="whitespace-nowrap">{d.pc.stationName || '-'}</td>
                  <td className="max-w-[80px] truncate font-semibold" title={d.pc.channelName || ''}>{d.pc.channelName || '-'}</td>
                  <td className="font-mono text-blue-700 whitespace-nowrap">{d.pc.connectedIp || '-'}</td>
                  <td className="font-mono font-bold">{d.drive || '?'}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full bg-rose-500" style={{ width: `${100 - (d.pct ?? 0)}%` }} title={`Đã dùng ${100 - (d.pct ?? 0)}%`} />
                      </div>
                      <span className="w-10 text-right font-mono font-bold text-rose-700">{d.pct != null ? `${d.pct}%` : '-'}</span>
                    </div>
                  </td>
                  <td className="text-right font-mono whitespace-nowrap">{d.free} / {d.total ?? '?'} GB</td>
                  <td><StatusText online={d.pc.isOnline} neverConnected={d.pc.neverConnected} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PcList({ rows, lines, standardVersion, loading, now, serverSkewMs, onSelect, onReload }) {
  const commands = useMachineCommands();
  const [search, setSearch] = useState('');
  const [lineId, setLineId] = useState('');
  const [status, setStatus] = useState('all');
  const [version, setVersion] = useState('all');

  const filtered = rows.filter(r => {
    if (status === 'online' && !r.isOnline) return false;
    if (status === 'offline' && r.isOnline) return false;
    if (status === 'clock' && !isClockOff(r)) return false;
    if (lineId && String(r.lineId) !== lineId) return false;
    const vs = versionState(r.appVersion, standardVersion);
    if (version === 'standard' && vs !== 'standard') return false;
    if (version === 'old' && vs !== 'old') return false;
    if (version === 'unknown' && r.appVersion) return false;
    if (search) {
      const text = `${r.hostname} ${r.connectedIp} ${r.ipAddress} ${r.channelIp} ${r.macAddress} ${r.channelName} ${r.stationName} ${r.lineName} ${r.logType} ${r.appVersion}`.toLowerCase();
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
          <option value="clock">Lệch giờ &gt; {CLOCK_DRIFT_LIMIT_SECONDS}s</option>
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
        <BulkButton rows={filtered.filter(r => canUpdate(r, standardVersion))} kind="update" commands={commands}
          label="Update PC version cũ" confirmText={(n) => `Gửi lệnh update Backup_Log2 tới ${n} PC đang online có version thấp hơn ${standardVersion}?`} />
        <BulkButton rows={filtered.filter(canSyncTime)} kind="sync" commands={commands}
          label="Sync giờ PC lệch" confirmText={(n) => `Gửi lệnh sync giờ tới ${n} PC đang online lệch giờ quá ${CLOCK_DRIFT_LIMIT_SECONDS} giây?`} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-slate-50/90 text-slate-600 uppercase font-semibold tracking-wider border-b border-slate-200 text-[10px]">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:whitespace-nowrap">
              <th>Line</th>
              <th>Trạm</th>
              <th>Channel</th>
              <th>Hostname</th>
              <th title="IP mà PC dùng để kết nối tới server">IP</th>
              <th>Version</th>
              <th>Giờ PC</th>
              <th>Log type</th>
              <th className="text-right">CPU</th>
              <th className="text-right">RAM</th>
              <th title="% trống của từng ổ; di chuột vào ô để xem GB">Ổ đĩa (% trống)</th>
              <th>Upload gần nhất</th>
              <th>Trạng thái</th>
              <th>Lần cuối thấy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.length === 0 && (
              <tr><td colSpan={14} className="p-10 text-center text-slate-500">{loading ? 'Đang tải…' : 'Không có PC phù hợp bộ lọc.'}</td></tr>
            )}
            {filtered.map(r => (
              <tr key={r.macKey} className="hover:bg-slate-100/70 cursor-pointer [&>td]:px-2 [&>td]:py-2" onClick={() => onSelect(r)}>
                <td className="whitespace-nowrap">{r.lineName || '-'}</td>
                <td className="whitespace-nowrap">{r.stationName || '-'}</td>
                <td className="max-w-[80px] truncate font-semibold" title={r.channelName || ''}>{r.channelName || '-'}</td>
                <td className="font-mono max-w-[100px] truncate" title={r.hostname || ''}>{r.hostname || '-'}</td>
                <td className="font-mono text-blue-700 whitespace-nowrap" title="IP PC dùng để kết nối tới server">{r.connectedIp || '-'}</td>
                <td className="whitespace-nowrap">
                  <VersionBadge version={r.appVersion} standard={standardVersion} />
                  {canUpdate(r, standardVersion) && <CommandButton pc={r} kind="update" commands={commands} />}
                </td>
                <td className="whitespace-nowrap">
                  <PcClock pc={r} now={now} serverSkewMs={serverSkewMs} />
                  {canSyncTime(r) && <CommandButton pc={r} kind="sync" commands={commands} />}
                </td>
                <td className="max-w-[80px] truncate" title={r.logType || ''}>{r.logType || '-'}</td>
                <td className="text-right font-mono whitespace-nowrap">{r.cpuPercent != null ? `${r.cpuPercent}%` : '-'}</td>
                <td className="text-right font-mono whitespace-nowrap">{r.ramTotalMb ? `${Math.round((r.ramUsedMb / r.ramTotalMb) * 100)}%` : '-'}</td>
                <td><DriveList pc={r} /></td>
                <td className="text-slate-600 whitespace-nowrap" title={formatTime(r.lastUploadAt)}>{formatAgo(r.lastUploadAt, now)}</td>
                <td><StatusText online={r.isOnline} neverConnected={r.neverConnected} /></td>
                <td className="text-slate-600 whitespace-nowrap" title={formatTime(r.lastSeenAt)}>{formatAgo(r.lastSeenAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> Bấm vào một dòng để xem chi tiết PC. CPU/RAM/ổ đĩa cập nhật mỗi phút từ Backup_Log2 bản mới.</p>
    </div>
  );
}

/** Sends one command to every PC of the list (online PCs that need it) after a confirmation. */
function BulkButton({ rows, kind, commands, label, confirmText }) {
  if (rows.length === 0) return null;
  const Icon = kind === 'update' ? ArrowUpCircle : Clock;
  return (
    <button type="button" onClick={() => { if (window.confirm(confirmText(rows.length))) commands.send(rows, kind); }}
      className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${
        kind === 'update' ? 'bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-800' : 'bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-700'}`}>
      <Icon className="w-3.5 h-3.5" /> {label} ({rows.length})
    </button>
  );
}
