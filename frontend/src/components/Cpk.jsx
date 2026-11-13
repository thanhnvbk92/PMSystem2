import React, { memo, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import {
  Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { ProductionApi } from '../services/api';
import { onCpkUpdate } from '../services/signalr';
import { downloadCpkRawData, downloadCpkReport } from '../services/cpkExport';

const cpkColor = value => value == null ? '#475569' : value >= 1.33 ? '#047857' : value >= 1 ? '#b45309' : '#be123c';
const fmt = value => value == null ? 'N/A' : Number(value).toFixed(2);
const naturalSort = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi', { numeric: true, sensitivity: 'base' });
const cpkPeriodLabel = value => value ? new Date(value).toLocaleDateString('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok',
}) : '';
// A study whose newest sample is older than the 90-day window came from the
// history fallback (the machine has not produced OK data recently).
const isStale = value => !!value && Date.now() - new Date(value).getTime() > 90 * 24 * 3600 * 1000;
const stationDisplayName = station => station.modelGroupName
  ? `${station.modelGroupName} · ${station.name}`
  : station.name;

const StationChart = memo(function StationChart({ station, channels, results, onSelectChannel }) {
  const data = channels.map(channel => {
    const result = results[channel.id];
    return {
      id: channel.id,
      channel,
      name: channel.name || channel.channelName || `Channel ${channel.id}`,
      cpk: result?.cpk ?? null,
      step: result?.stepName ? `${result.jobFile || 'N/A'} → #${result.stepNumber} - ${result.stepName}` : 'Chưa có step đủ dữ liệu',
      samples: result?.sampleCount ?? 0,
      isHistorical: result?.isHistorical ?? false,
      fromDate: result?.fromDate,
      lastSampleAt: result?.lastSampleAt,
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

  return <section className="glass-panel border border-slate-200 rounded-xl p-3 min-w-0">
    <div className="flex items-start justify-between gap-2 mb-1">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-900 truncate" title={stationDisplayName(station)}>{stationDisplayName(station)}</h3>
        <p className="text-[10px] text-slate-500 truncate" title="Tự chọn step có CPK cao nhất theo từng channel">Tự chọn step CPK tốt nhất theo channel</p>
      </div>
      <span className="shrink-0 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-700 text-[10px] font-bold">{channels.length} CH</span>
    </div>
    <div className="flex items-center gap-2 text-[9px] mb-1.5">
      <span className="text-emerald-700">● {good}</span><span className="text-amber-700">● {warning}</span>
      <span className="text-rose-700">● {failed}</span><span className="text-slate-500">N/A {data.length - good - warning - failed}</span>
    </div>
    {channels.length ? <div className="grid gap-1 mt-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>
      {data.map(item => {
        const color = cpkColor(item.cpk);
        const ip = item.channel.ipAddress || item.channel.ip;
        const tooltip = `#${item.id} ${item.name}\nIP: ${ip || 'N/A'}\nCPK: ${fmt(item.cpk)}\n${statusOf(item)}\nStep: ${item.step}\nSpec: ${item.spec}\nMẫu: ${item.samples}/50${item.fromDate && item.samples > 0 ? `\nDữ liệu: ${cpkPeriodLabel(item.fromDate)} → ${cpkPeriodLabel(item.lastSampleAt || item.fromDate)}` : ''}${isStale(item.lastSampleAt) ? '\n⚠ Không có dữ liệu mới hơn 90 ngày (dùng dữ liệu cũ)' : ''}`;
        return <button
          type="button"
          key={item.id}
          title={tooltip}
          onClick={() => onSelectChannel(item.channel, station, results[item.id])}
          className="h-7 w-full text-left rounded-md border px-1.5 flex items-center justify-between gap-1 hover:shadow-sm hover:ring-1 hover:ring-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400 transition"
          style={{ borderColor: `${color}55`, backgroundColor: `${color}0d` }}
        >
          <span className="text-[10px] leading-none text-slate-700 truncate min-w-0">{item.name}</span>
          <span className="shrink-0 text-[11px] font-extrabold tabular-nums leading-none" style={{ color }}>{fmt(item.cpk)}</span>
        </button>;
      })}
    </div> : <div className="h-16 grid place-items-center text-xs text-slate-500">Station chưa có Channel.</div>}
  </section>;
});

export default function Cpk({ lines = [], stations = [], channels = [] }) {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [exportingReport, setExportingReport] = useState(false);
  const [reportError, setReportError] = useState('');
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
    let retryTimer;
    let retries = 0;
    setLoading(true);
    const loadOverview = async () => {
      try {
        const rows = await ProductionApi.getCpkOverview();
        if (!active) return;
        const overview = {};
        (rows || []).forEach(row => { overview[row.channelId] = row; });
        channels.forEach(channel => { overview[channel.id] ||= null; });
        setResults(overview);
        if (!(rows || []).length && retries < 40) {
          retries += 1;
          retryTimer = setTimeout(loadOverview, 15000);
        }
      } catch {
        if (active) setResults({});
      } finally {
        if (active) setLoading(false);
      }
    };
    loadOverview();
    return () => { active = false; clearTimeout(retryTimer); };
  }, [channels]);

  // Realtime: the backend pushes at most one message per flush (~10 s) with only
  // the Channels whose CPK changed; merge those entries into the current map.
  useEffect(() => onCpkUpdate(items => {
    if (!Array.isArray(items) || items.length === 0) return;
    setResults(previous => {
      const next = { ...previous };
      items.forEach(item => { next[item.channelId] = item; });
      return next;
    });
  }), []);

  const sortedLines = useMemo(() => [...lines].sort(naturalSort), [lines]);

  const exportReport = async () => {
    setExportingReport(true);
    setReportError('');
    try {
      downloadCpkReport(await ProductionApi.getCpkReport());
    } catch {
      setReportError('Không thể xuất báo cáo CPK. Vui lòng thử lại.');
    } finally {
      setExportingReport(false);
    }
  };

  const showChannelDetail = async (channel, station, overview) => {
    setDetail({ channel, station, analysis: overview || null });
    setDetailError('');
    if (!overview?.stepName || overview.stepNumber == null) return;
    setDetailLoading(true);
    try {
      const analysis = await ProductionApi.getCpk(
        channel.id, overview.stepNumber, overview.stepName, overview.jobFile, 50,
      );
      setDetail({ channel, station, analysis });
    } catch (error) {
      setDetailError(error?.response?.data?.error || 'Không thể tải dữ liệu CPK của Channel này.');
    } finally {
      setDetailLoading(false);
    }
  };

  const detailPoints = useMemo(() => (detail?.analysis?.points || []).map(point => ({
    ...point,
    timeLabel: new Date(point.inspectTime).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }),
  })), [detail]);

  const capabilityHistogram = useMemo(() => {
    const values = detailPoints.map(point => Number(point.value)).filter(Number.isFinite);
    if (!values.length) return [];
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    // Build bins from the observed process range. Including distant spec limits
    // here creates many empty bins and makes a 20-bin histogram look like 5-6 bars.
    const dataRange = dataMax - dataMin;
    const padding = Math.max(dataRange * 0.03, Math.abs(dataMax || 1) * 0.0001, 0.000001);
    const min = dataMin - padding;
    const max = dataMax + padding;
    // Use a denser histogram than the square-root rule so a 50-sample
    // capability study remains visually useful (about 20 columns).
    const binCount = Math.min(24, Math.max(10, Math.ceil(Math.sqrt(values.length) * 2.8)));
    const width = (max - min) / binCount || 1;
    const counts = Array(binCount).fill(0);
    values.forEach(value => { counts[Math.min(binCount - 1, Math.max(0, Math.floor((value - min) / width)))] += 1; });
    const mean = Number(detail?.analysis?.mean);
    const sigma = Number(detail?.analysis?.standardDeviation);
    const histogram = counts.map((count, index) => {
      const center = min + (index + 0.5) * width;
      const normal = Number.isFinite(mean) && Number.isFinite(sigma) && sigma > 0
        ? values.length * width * Math.exp(-0.5 * ((center - mean) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI))
        : null;
      return { center, label: Number(center.toPrecision(6)), count, normal };
    });
    if (!Number.isFinite(mean) || !Number.isFinite(sigma) || sigma <= 0) return histogram;

    // Draw the fitted normal distribution independently from the histogram
    // range. Minitab-style capability plots show the tails to about ±4σ.
    const specMin = Number(detail?.analysis?.specMin);
    const specMax = Number(detail?.analysis?.specMax);
    const axisMin = Number.isFinite(specMin) ? Math.min(specMin, min) : min;
    const axisMax = Number.isFinite(specMax) ? Math.max(specMax, max) : max;
    const curveMin = Math.max(axisMin, mean - 4 * sigma);
    const curveMax = Math.min(axisMax, mean + 4 * sigma);
    const curve = Array.from({ length: 81 }, (_, index) => {
      const center = curveMin + (curveMax - curveMin) * index / 80;
      const normal = values.length * width * Math.exp(-0.5 * ((center - mean) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
      return { center, label: Number(center.toPrecision(6)), count: null, normal };
    });
    return [...histogram, ...curve].sort((a, b) => a.center - b.center);
  }, [detail, detailPoints]);

  const detailStatus = detail?.analysis?.cpk == null
    ? 'Chưa đủ dữ liệu'
    : detail.analysis.cpk >= 1.33 ? 'Tốt' : detail.analysis.cpk >= 1 ? 'Cảnh báo' : 'Không đạt';
  const isHistoricalCpk = detail?.analysis?.isHistorical ?? false;
  // Page-wide summary over every Channel shown on this page (same rules as the cards).
  const summary = useMemo(() => {
    const counts = { total: channels.length, good: 0, warning: 0, failed: 0, insufficient: 0, noData: 0 };
    channels.forEach(channel => {
      const result = results[channel.id];
      const cpk = result?.cpk;
      if (cpk == null) {
        if ((result?.sampleCount ?? 0) > 0) counts.insufficient += 1; else counts.noData += 1;
      } else if (cpk >= 1.33) counts.good += 1;
      else if (cpk >= 1) counts.warning += 1;
      else counts.failed += 1;
    });
    return counts;
  }, [channels, results]);
  const summaryItems = [
    { label: 'Tổng Channel', value: summary.total, className: 'text-slate-900 bg-slate-100 border-slate-200', title: 'Tổng số Channel trên trang' },
    { label: 'Đạt ≥1.33', value: summary.good, className: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30', title: 'CPK ≥ 1.33' },
    { label: 'Cảnh báo', value: summary.warning, className: 'text-amber-700 bg-amber-500/10 border-amber-500/30', title: '1.00 ≤ CPK < 1.33' },
    { label: 'Không đạt <1', value: summary.failed, className: 'text-rose-700 bg-rose-500/10 border-rose-500/30', title: 'CPK < 1.00' },
    { label: 'Thiếu mẫu', value: summary.insufficient, className: 'text-slate-600 bg-white border-slate-200', title: 'Có dữ liệu nhưng chưa đủ 30 mẫu để tính CPK' },
    { label: 'Không có dữ liệu', value: summary.noData, className: 'text-slate-500 bg-white border-slate-200', title: 'Chưa có giá trị đo của PCB OK' },
  ];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
      {summaryItems.map(item => <div key={item.label} title={item.title}
        className={`flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 ${item.className}`}>
        <span className="text-base font-extrabold tabular-nums leading-none">{loading ? '…' : item.value}</span>
        <span className="text-[10px] font-semibold leading-none">{item.label}</span>
      </div>)}
      {loading && <span className="flex items-center gap-1 text-[10px] text-blue-700"><Loader2 className="w-3.5 h-3.5 animate-spin"/>Đang tải CPK...</span>}
      <button type="button" onClick={exportReport} disabled={loading || exportingReport || !channels.length}
        title="Excel gồm Dashboard, tổng quan theo Station, Summary và danh sách CPK từng Channel"
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
        {exportingReport ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Download className="h-3.5 w-3.5"/>}
        {exportingReport ? 'Đang xuất...' : 'Xuất báo cáo Excel'}
      </button>
    </div>
    {reportError && <div role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{reportError}</div>}
    {sortedLines.map(line => {
      const lineStations = stations.filter(station => String(station.lineId) === String(line.id)).sort(naturalSort);
      const lineChannelCount = lineStations.reduce((count, station) => count + (channelsByStation.get(String(station.id))?.length || 0), 0);
      return <section key={line.id} className="space-y-2">
        <div className="flex items-center gap-2 sticky top-0 z-10 bg-slate-50/85 backdrop-blur py-1">
          <h2 className="text-base font-bold text-slate-900 whitespace-nowrap">{line.name}</h2>
          <span className="text-[10px] text-slate-500 whitespace-nowrap">{lineStations.length} Station · {lineChannelCount} Channel</span>
          <div className="h-px bg-gradient-to-r from-fuchsia-500/60 to-transparent flex-1"/>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lineStations.map(station => <StationChart key={station.id} station={station} channels={channelsByStation.get(String(station.id)) || []} results={results} onSelectChannel={showChannelDetail}/>) }
        </div>
        {!lineStations.length && <div className="text-xs text-slate-500 p-3">Line chưa có Station.</div>}
      </section>;
    })}

    {detail && <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm p-3 md:p-8 grid place-items-center" onMouseDown={event => { if (event.target === event.currentTarget) setDetail(null); }}>
      <section className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">Chi tiết CPK · {detail.channel.name || detail.channel.channelName || `Channel ${detail.channel.id}`}</h2>
              <span className="rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-700">ID {detail.channel.id}</span>
              <span className="rounded-md bg-slate-500/10 px-2 py-1 text-[10px] font-bold font-mono text-slate-700">IP {detail.channel.ipAddress || detail.channel.ip || 'N/A'}</span>
              <span className="rounded-md px-2 py-1 text-[10px] font-bold" style={{ color: cpkColor(detail.analysis?.cpk), backgroundColor: `${cpkColor(detail.analysis?.cpk)}18` }}>{detailStatus}</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">{stationDisplayName(detail.station)} · {detail.analysis?.jobFile || 'N/A'} · Step #{detail.analysis?.stepNumber ?? 'N/A'} {detail.analysis?.stepName || ''}</p>
            {isHistoricalCpk && <p className="mt-1 text-[11px] font-semibold text-amber-700">Dữ liệu tháng này chưa đủ 50 mẫu · Có sử dụng dữ liệu trước đầu tháng, từ {cpkPeriodLabel(detail.analysis.fromDate)}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={detailLoading || !!detailError || !detailPoints.length}
              onClick={() => downloadCpkRawData({
                ...detail,
                lineName: lines.find(line => String(line.id) === String(detail.station.lineId))?.name || '',
              })}
              title={detailLoading ? 'Đang tải dữ liệu đo' : detailPoints.length ? 'Xuất các mẫu đo đang dùng để tính CPK ra CSV' : 'Chưa có dữ liệu đo để xuất'}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4"/>
              Xuất raw data ({detailLoading || detailError ? 0 : detailPoints.length})
            </button>
            <button type="button" onClick={() => setDetail(null)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900" aria-label="Đóng"><X className="h-4 w-4"/></button>
          </div>
        </header>

        <div className="p-5 space-y-5">
          {detailLoading && <div className="flex h-64 items-center justify-center gap-2 text-sm text-cyan-700"><Loader2 className="h-5 w-5 animate-spin"/>Đang tải dữ liệu đo...</div>}
          {detailError && <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-700">{detailError}</div>}
          {!detailLoading && !detailError && <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {[
                ['CPK', fmt(detail.analysis?.cpk)], ['CPL', fmt(detail.analysis?.cpl)], ['CPU', fmt(detail.analysis?.cpu)],
                ['Số mẫu', `${detail.analysis?.sampleCount || 0}/50`], ['Mean', fmt(detail.analysis?.mean)],
                ['Sigma', fmt(detail.analysis?.standardDeviation)], ['LSL', fmt(detail.analysis?.specMin)], ['USL', fmt(detail.analysis?.specMax)],
              ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-100/55 px-3 py-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 text-base font-extrabold tabular-nums" style={label === 'CPK' ? { color: cpkColor(detail.analysis?.cpk) } : { color: 'var(--text-main)' }}>{value}</div>
              </div>)}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-100/35 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Process Capability — Phân bố giá trị đo</h3>
                  <p className="mt-0.5 text-[10px] text-slate-500">Histogram và đường cong chuẩn của 50 PCB OK gần nhất</p>
                </div>
                <div className="flex items-center gap-3 text-[10px]"><span className="text-cyan-700">■ Tần suất</span><span className="text-amber-700">━ Normal curve</span><span className="text-rose-700">┊ Spec limit</span></div>
              </div>
              {capabilityHistogram.length ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={capabilityHistogram} margin={{ top: 24, right: 30, left: 8, bottom: 32 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false}/>
                      <XAxis dataKey="center" type="number" domain={['dataMin', 'dataMax']} stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={value => Number(value).toPrecision(4)}/>
                      <YAxis stroke="#64748b" tick={{ fontSize: 10 }} allowDecimals={false} label={{ value: 'Frequency', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }}/>
                      <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} labelFormatter={value => `Giá trị: ${Number(value).toPrecision(6)}`} formatter={(value, name) => [name === 'normal' ? Number(value).toFixed(2) : value, name === 'normal' ? 'Normal curve' : 'Tần suất']}/>
                      <Bar dataKey="count" barSize={12} fill="#22d3ee" fillOpacity={0.7} stroke="#67e8f9" strokeWidth={1}/>
                      <Line type="monotone" dataKey="normal" connectNulls stroke="#b45309" strokeWidth={2.5} dot={false}/>
                      {detail.analysis?.specMin != null && <ReferenceLine x={detail.analysis.specMin} ifOverflow="extendDomain" stroke="#be123c" strokeWidth={2} strokeDasharray="6 4" label={{ value: `LSL ${fmt(detail.analysis.specMin)}`, fill: '#be123c', fontSize: 10, position: 'top' }}/>}
                      {detail.analysis?.specMax != null && <ReferenceLine x={detail.analysis.specMax} ifOverflow="extendDomain" stroke="#be123c" strokeWidth={2} strokeDasharray="6 4" label={{ value: `USL ${fmt(detail.analysis.specMax)}`, fill: '#be123c', fontSize: 10, position: 'top' }}/>}
                      {detail.analysis?.mean != null && <ReferenceLine x={detail.analysis.mean} stroke="#a78bfa" strokeDasharray="3 3" label={{ value: 'Mean', fill: '#6d28d9', fontSize: 10, position: 'insideTopRight' }}/>}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <aside className="rounded-lg border border-slate-200 bg-slate-50/40 p-4 text-xs">
                  <h4 className="mb-3 border-b border-slate-200 pb-2 font-bold text-slate-900">Overall Capability</h4>
                  <dl className="space-y-2 text-slate-600">
                    {[
                      ['N', detail.analysis?.sampleCount || 0], ['Mean', fmt(detail.analysis?.mean)], ['StDev', fmt(detail.analysis?.standardDeviation)],
                      ['LSL', fmt(detail.analysis?.specMin)], ['USL', fmt(detail.analysis?.specMax)], ['CPL', fmt(detail.analysis?.cpl)],
                      ['CPU', fmt(detail.analysis?.cpu)], ['Cpk', fmt(detail.analysis?.cpk)],
                    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-bold tabular-nums" style={label === 'Cpk' ? { color: cpkColor(detail.analysis?.cpk) } : { color: 'var(--text-main)' }}>{value}</dd></div>)}
                  </dl>
                  <div className="mt-4 rounded-md px-3 py-2 text-center font-bold" style={{ color: cpkColor(detail.analysis?.cpk), backgroundColor: `${cpkColor(detail.analysis?.cpk)}18` }}>{detailStatus}</div>
                </aside>
              </div> : <div className="grid h-64 place-items-center text-sm text-slate-500">Channel chưa có dữ liệu đo phù hợp.</div>}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-100/35 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">Individual Value Plot</h3>
                <span className="text-[10px] text-slate-500">Di chuột vào điểm để xem PID và thời gian</span>
              </div>
              {detailPoints.length ? <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={detailPoints} margin={{ top: 12, right: 24, left: 8, bottom: 35 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false}/>
                    <XAxis dataKey="timeLabel" stroke="#64748b" tick={{ fontSize: 10 }} angle={-28} textAnchor="end" interval="preserveStartEnd"/>
                    <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']}/>
                    <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#475569' }} formatter={(value, name, props) => [fmt(value), `Giá trị · PID ${props.payload.pid}`]}/>
                    {detail.analysis?.specMin != null && <ReferenceLine y={detail.analysis.specMin} stroke="#f43f5e" strokeDasharray="6 4" label={{ value: `LSL ${fmt(detail.analysis.specMin)}`, fill: '#be123c', fontSize: 10 }}/>}
                    {detail.analysis?.specMax != null && <ReferenceLine y={detail.analysis.specMax} stroke="#f43f5e" strokeDasharray="6 4" label={{ value: `USL ${fmt(detail.analysis.specMax)}`, fill: '#be123c', fontSize: 10 }}/>}
                    {detail.analysis?.mean != null && <ReferenceLine y={detail.analysis.mean} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: `Mean ${fmt(detail.analysis.mean)}`, fill: '#b45309', fontSize: 10 }}/>}
                    <Line type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2} dot={{ r: 2.5, fill: '#22d3ee' }} activeDot={{ r: 5 }}/>
                  </LineChart>
                </ResponsiveContainer>
              </div> : <div className="grid h-64 place-items-center text-sm text-slate-500">Channel chưa có dữ liệu đo phù hợp.</div>}
            </div>
          </>}
        </div>
      </section>
    </div>}
  </div>;
}
