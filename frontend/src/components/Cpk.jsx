import React, { memo, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ProductionApi } from '../services/api';

const cpkColor = value => value == null ? '#475569' : value >= 1.33 ? '#10b981' : value >= 1 ? '#f59e0b' : '#f43f5e';
const fmt = value => value == null ? 'N/A' : Number(value).toFixed(2);
const naturalSort = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi', { numeric: true, sensitivity: 'base' });
const cpkKey = (channelId, stepNumber, stepName, jobFile) => `${channelId}|${stepNumber}|${stepName || ''}|${jobFile || ''}`;

const StationChart = memo(function StationChart({ station, channels, results }) {
  const data = channels.map(channel => {
    const result = results[channel.id];
    return {
      id: channel.id,
      name: channel.name || channel.channelName || `Channel ${channel.id}`,
      cpk: result?.cpk ?? null,
      step: station.cpkStepName ? `${station.cpkJobFile || 'N/A'} → #${station.cpkStepNumber} - ${station.cpkStepName}` : 'Chưa cấu hình',
      samples: result?.sampleCount ?? 0,
      spec: result ? `${fmt(result.specMin)} / ${fmt(result.specMax)}` : 'N/A',
    };
  }).sort(naturalSort);
  const good = data.filter(item => item.cpk >= 1.33).length;
  const warning = data.filter(item => item.cpk != null && item.cpk >= 1 && item.cpk < 1.33).length;
  const failed = data.filter(item => item.cpk != null && item.cpk < 1).length;
  const statusOf = item => {
    if (item.cpk == null) return item.samples > 0 ? 'Thiếu mẫu' : 'N/A';
    if (item.cpk >= 1.33) return 'Tốt';
    if (item.cpk >= 1) return 'Cảnh báo';
    return 'Không đạt';
  };

  return <section className="glass-panel border border-white/10 rounded-xl p-3 min-w-0">
    <div className="flex items-start justify-between gap-2 mb-1">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-white truncate" title={station.name}>{station.name}</h3>
        <p className="text-[10px] text-slate-500 truncate" title={station.cpkStepName}>50 PCB OK · {station.cpkStepName || 'Chưa cấu hình Step'}</p>
      </div>
      <span className="shrink-0 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-300 text-[10px] font-bold">{channels.length} CH</span>
    </div>
    <div className="flex items-center gap-2 text-[9px] mb-1.5">
      <span className="text-emerald-400">● {good}</span><span className="text-amber-400">● {warning}</span>
      <span className="text-rose-400">● {failed}</span><span className="text-slate-500">N/A {data.length - good - warning - failed}</span>
    </div>
    {channels.length ? <div className="grid gap-1.5 mt-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
      {data.map(item => {
        const color = cpkColor(item.cpk);
        const tooltip = `#${item.id} ${item.name}\nCPK: ${fmt(item.cpk)}\n${statusOf(item)}\nStep: ${item.step}\nSpec: ${item.spec}\nMẫu: ${item.samples}/50`;
        return <div
          key={item.id}
          title={tooltip}
          className="min-h-9 rounded-lg border px-2 py-1.5 flex items-center justify-between gap-2 hover:brightness-125 transition-[filter]"
          style={{ borderColor: `${color}55`, backgroundColor: `${color}0d` }}
        >
          <span className="text-[9px] leading-tight text-slate-300 break-words min-w-0">{item.name}</span>
          <span className="shrink-0 text-xs font-extrabold tabular-nums" style={{ color }}>{fmt(item.cpk)}</span>
        </div>;
      })}
    </div> : <div className="h-16 grid place-items-center text-xs text-slate-500">Station chưa có Channel.</div>}
  </section>;
});

export default function Cpk({ lines = [], stations = [], channels = [] }) {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(true);
  const stationById = useMemo(() => Object.fromEntries(stations.map(station => [station.id, station])), [stations]);
  const configuredChannels = useMemo(() => channels.filter(channel => {
    const station = stationById[channel.stationId];
    return station?.cpkStepName && station?.cpkStepNumber != null;
  }), [channels, stationById]);
  const channelsByStation = useMemo(() => {
    const grouped = new Map();
    channels.forEach(channel => {
      const key = String(channel.stationId);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(channel);
    });
    return grouped;
  }, [channels]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    ProductionApi.getCpkOverview().then(rows => {
      if (!active) return;
      const rowIndex = new Map((rows || []).map(row => [cpkKey(row.channelId, row.stepNumber, row.stepName, row.jobFile), row]));
      const overview = {};
      configuredChannels.forEach(channel => {
        const station = stationById[channel.stationId];
        overview[channel.id] = rowIndex.get(cpkKey(channel.id, station.cpkStepNumber, station.cpkStepName, station.cpkJobFile)) || null;
      });
      setResults(overview);
    }).catch(() => { if (active) setResults({}); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [configuredChannels, stationById]);

  const sortedLines = useMemo(() => [...lines].sort(naturalSort), [lines]);
  const unconfigured = channels.length - configuredChannels.length;

  return <div className="space-y-4">
    {loading && <div className="flex items-center justify-end gap-1 text-[10px] text-blue-300"><Loader2 className="w-3.5 h-3.5 animate-spin"/>Đang tải cache CPK...</div>}
    {!loading && unconfigured > 0 && <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200 flex gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0"/>{unconfigured} Channel thuộc Station chưa cấu hình Step CPK và sẽ hiển thị N/A.</div>}
    {sortedLines.map(line => {
      const lineStations = stations.filter(station => String(station.lineId) === String(line.id)).sort(naturalSort);
      const lineChannelCount = lineStations.reduce((count, station) => count + (channelsByStation.get(String(station.id))?.length || 0), 0);
      return <section key={line.id} className="space-y-2">
        <div className="flex items-center gap-2 sticky top-0 z-10 bg-slate-950/85 backdrop-blur py-1">
          <h2 className="text-base font-bold text-white whitespace-nowrap">{line.name}</h2>
          <span className="text-[10px] text-slate-500 whitespace-nowrap">{lineStations.length} Station · {lineChannelCount} Channel</span>
          <div className="h-px bg-gradient-to-r from-fuchsia-500/60 to-transparent flex-1"/>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lineStations.map(station => <StationChart key={station.id} station={station} channels={channelsByStation.get(String(station.id)) || []} results={results}/>) }
        </div>
        {!lineStations.length && <div className="text-xs text-slate-500 p-3">Line chưa có Station.</div>}
      </section>;
    })}
  </div>;
}
