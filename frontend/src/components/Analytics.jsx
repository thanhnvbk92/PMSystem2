import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  BarChart3, Layers, AlertTriangle, Cpu, Clock, 
  Sparkles, CheckCircle, ShieldCheck, Filter, RefreshCw, FileSpreadsheet, Download,
  Activity, XCircle, FileText, ChevronRight, Tag
} from 'lucide-react';
import { 
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, Legend, Cell, LineChart, Line, ComposedChart 
} from 'recharts';
import { ProductionApi } from '../services/api';

// High-contrast categorical palette for the 14 production lines. Keep colors
// stable by sorting Lines before assigning them; defect ranking must not change
// a Line's color between filters or time buckets.
const LINE_CONTRIBUTION_COLORS = [
  '#0891B2', // cyan
  '#FF375F', // red-pink
  '#A16207', // yellow
  '#7D5CFF', // violet
  '#15803D', // green
  '#C2410C', // orange
  '#0A84FF', // blue
  '#BE185D', // magenta
  '#4D7C0F', // lime
  '#BF5AF2', // purple
  '#0F766E', // teal
  '#FF453A', // red
  '#92400E', // tan
  '#475569', // neutral slate
];

const LINE_CONTRIBUTION_COLOR_BY_NAME = {
  'line 1-1': '#0891B2', // cyan
  'line 1-2': '#A16207', // yellow
  'line 2-1': '#15803D', // green
  'line 2-2': '#7D5CFF', // violet
  'line 3-1': '#C2410C', // orange
  'line 3-2': '#BE185D', // magenta
  'line 4-1': '#0A84FF', // blue
  'line 4-2': '#4D7C0F', // lime
  'line 5-1': '#0F766E', // teal
  'line 5-2': '#BF5AF2', // purple
  'line 6-1': '#92400E', // tan
  'line 6-2': '#FF375F', // red-pink
  'line off': '#64748B', // neutral slate
  'unassigned line': '#475569', // neutral slate
};

const getLineContributionColor = (lineName, fallbackIndex) =>
  LINE_CONTRIBUTION_COLOR_BY_NAME[String(lineName || '').trim().toLowerCase()]
  || LINE_CONTRIBUTION_COLORS[fallbackIndex % LINE_CONTRIBUTION_COLORS.length];

function Analytics({ lines, stations, channels = [], startDate, endDate, onFilterChange, initialFilters = null }) {
  const biRequestRef = useRef(0);
  // Global BI Filter States
  const [selectedLine, setSelectedLine] = useState(initialFilters?.lineId ? String(initialFilters.lineId) : '');
  const [selectedStation, setSelectedStation] = useState(initialFilters?.stationId ? String(initialFilters.stationId) : '');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedModel, setSelectedModel] = useState(initialFilters?.modelId ? String(initialFilters.modelId) : '');
  const [selectedModelName, setSelectedModelName] = useState(initialFilters?.modelName || '');
  const [selectedErrorCode, setSelectedErrorCode] = useState(initialFilters?.errorCode || '');
  const [selectedJobFile, setSelectedJobFile] = useState('');
  const [selectedHours, setSelectedHours] = useState(24);
  const [selectedTimePreset, setSelectedTimePreset] = useState('24h');
  const [selectedTimeWindow, setSelectedTimeWindow] = useState(initialFilters?.start && initialFilters?.end ? {
    start: new Date(initialFilters.start),
    end: new Date(initialFilters.end),
    label: `Cải tiến: ${new Date(initialFilters.start).toLocaleDateString('vi-VN')} → ${new Date(initialFilters.end).toLocaleDateString('vi-VN')}`,
  } : null);
  useEffect(() => {
    if (!initialFilters) return;
    const nextLine = initialFilters.lineId ? String(initialFilters.lineId) : '';
    const nextStation = initialFilters.stationId ? String(initialFilters.stationId) : '';
    setSelectedLine(nextLine);
    setSelectedStation(nextStation);
    setSelectedChannel('');
    setSelectedModel(initialFilters.modelId ? String(initialFilters.modelId) : '');
    setSelectedModelName(initialFilters.modelName || '');
    setSelectedErrorCode(initialFilters.errorCode || '');
    setSelectedJobFile('');
    if (initialFilters.start && initialFilters.end) {
      const rangeStart = new Date(initialFilters.start);
      const rangeEnd = new Date(initialFilters.end);
      setSelectedTimeWindow({
        start: rangeStart,
        end: rangeEnd,
        label: `Cải tiến: ${rangeStart.toLocaleDateString('vi-VN')} → ${rangeEnd.toLocaleDateString('vi-VN')}`,
      });
      setSelectedHours(Math.max(1, Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 3600000)));
    }
    onFilterChange?.(
      nextLine ? Number(nextLine) : null,
      nextStation ? Number(nextStation) : null,
      initialFilters.start ? new Date(initialFilters.start).toISOString() : null,
      initialFilters.end ? new Date(initialFilters.end).toISOString() : null,
    );
  }, [initialFilters, onFilterChange]);
  const analyticsRange = useMemo(() => {
    const end = new Date();
    let start;
    switch (selectedTimePreset) {
      case 'today': start = new Date(end.getFullYear(), end.getMonth(), end.getDate()); break;
      case 'this-month': start = new Date(end.getFullYear(), end.getMonth(), 1); break;
      case 'this-year': start = new Date(end.getFullYear(), 0, 1); break;
      case 'last-12-months':
        start = new Date(end); start.setMonth(start.getMonth() - 12); break;
      case 'last-5-years':
        start = new Date(end); start.setFullYear(start.getFullYear() - 5); break;
      default: start = new Date(end.getTime() - selectedHours * 60 * 60 * 1000); break;
    }
    const format = (value) => value.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return { start, end, label: `${format(start)} → ${format(end)}` };
  }, [selectedHours, selectedTimePreset]);
  const selectedTimePresetLabel = ({
    '12h': '12 giờ gần nhất', '24h': '24 giờ gần nhất', '48h': '48 giờ gần nhất',
    today: 'Hôm nay', 'this-month': 'Tháng này', 'this-year': 'Năm nay',
    'last-12-months': '12 tháng gần nhất', 'last-5-years': '5 năm gần nhất'
  })[selectedTimePreset] || `${selectedHours} giờ`;

  // BI Data State from backend API getBiMatrix
  const [biData, setBiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadDurationMs, setLoadDurationMs] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportWarningModal, setExportWarningModal] = useState(null);

  // Fetch unified BI matrix data
  const fetchBiMatrix = async () => {
    const requestId = ++biRequestRef.current;
    setLoading(true);
    const loadStarted = performance.now();
    try {
      const lineId = selectedLine ? parseInt(selectedLine) : null;
      const stationId = selectedStation ? parseInt(selectedStation) : null;
      const channelId = selectedChannel ? parseInt(selectedChannel) : null;
      const modelId = selectedModel ? parseInt(selectedModel) : null;
      const errCode = selectedErrorCode || null;
      const job = selectedJobFile || null;

      const data = await ProductionApi.getBiMatrix(
        lineId, stationId, channelId, modelId, errCode, job,
        (selectedTimeWindow?.start || analyticsRange.start).toISOString(),
        (selectedTimeWindow?.end || analyticsRange.end).toISOString(),
        selectedHours
      );
      if (requestId === biRequestRef.current) setBiData(data);
    } catch (err) {
      console.error('Lỗi nạp dữ liệu Power BI Matrix Analytics:', err);
    } finally {
      if (requestId === biRequestRef.current) {
        setLoadDurationMs(performance.now() - loadStarted);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchBiMatrix();
  }, [selectedLine, selectedStation, selectedChannel, selectedModel, selectedErrorCode, selectedJobFile, selectedHours, selectedTimePreset, selectedTimeWindow, analyticsRange]);

  const handleLineChange = (val) => {
    const nextValue = val && String(val) === String(selectedLine) ? '' : val;
    setSelectedLine(nextValue);
    setSelectedStation('');
    setSelectedChannel('');
    if (onFilterChange) onFilterChange(nextValue ? parseInt(nextValue) : null, null, startDate, endDate);
  };

  const handleStationChange = (val) => {
    const nextValue = val && String(val) === String(selectedStation) ? '' : val;
    setSelectedStation(nextValue);
    setSelectedChannel('');
    if (onFilterChange) onFilterChange(selectedLine ? parseInt(selectedLine) : null, nextValue ? parseInt(nextValue) : null, startDate, endDate);
  };

  const handleChannelChange = (val) => {
    setSelectedChannel(val && String(val) === String(selectedChannel) ? '' : val);
  };

  const handleModelChange = (modelId, modelName = '') => {
    const nextValue = modelId && String(modelId) === String(selectedModel) ? '' : String(modelId || '');
    setSelectedModel(nextValue);
    setSelectedModelName(nextValue ? modelName : '');
  };

  const handleModelChartClick = (eventData) => {
    // Recharts sends different shapes for a chart-area click and a direct
    // Bar/Line click. Resolve both so Model filtering is reliable.
    const model = eventData?.activePayload?.[0]?.payload
      ?? eventData?.payload
      ?? eventData;
    if (model?.modelId != null) handleModelChange(model.modelId, model.displayName);
  };

  const handleErrorCodeChange = (val) => {
    setSelectedErrorCode(val && val === selectedErrorCode ? '' : val);
  };

  const handleJobFileChange = (val) => {
    setSelectedJobFile(val && val === selectedJobFile ? '' : val);
  };

  const handleTimePresetChange = (preset) => {
    const now = new Date();
    let start;
    switch (preset) {
      case 'today': start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
      case 'this-month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'this-year': start = new Date(now.getFullYear(), 0, 1); break;
      case 'last-12-months': start = new Date(now); start.setMonth(start.getMonth() - 12); break;
      case 'last-5-years': start = new Date(now); start.setFullYear(start.getFullYear() - 5); break;
      default: {
        const hours = Number.parseInt(preset, 10) || 24;
        start = new Date(now.getTime() - hours * 60 * 60 * 1000);
      }
    }
    setSelectedTimePreset(preset);
    setSelectedHours(Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (60 * 60 * 1000))));
    setSelectedTimeWindow(null);
    setSelectedErrorCode('');
    setSelectedJobFile('');
  };

  const clearAllFilters = () => {
    setSelectedLine('');
    setSelectedStation('');
    setSelectedChannel('');
    setSelectedModel('');
    setSelectedModelName('');
    setSelectedErrorCode('');
    setSelectedJobFile('');
    setSelectedHours(24);
    setSelectedTimePreset('24h');
    setSelectedTimeWindow(null);
    if (onFilterChange) onFilterChange(null, null, null, null);
  };

  const hasActiveFilters = selectedLine || selectedStation || selectedChannel || selectedModel || selectedErrorCode || selectedJobFile || selectedTimeWindow;

  const filteredStations = useMemo(() => {
    if (!selectedLine) return stations || [];
    return (stations || []).filter(s => s.lineId === parseInt(selectedLine));
  }, [stations, selectedLine]);

  const filteredChannels = useMemo(() => {
    let result = channels || [];
    if (selectedLine) {
      const lineStationIds = (stations || []).filter(s => s.lineId === parseInt(selectedLine)).map(s => s.id);
      result = result.filter(c => lineStationIds.includes(c.stationId));
    }
    if (selectedStation) {
      result = result.filter(c => c.stationId === parseInt(selectedStation));
    }
    return result;
  }, [channels, stations, selectedLine, selectedStation]);

  // Hourly trend data formatting
  const timeTrendChartData = useMemo(() => {
    if (!biData?.timeTrend) return [];
    const rangeEnd = analyticsRange.end;
    const rangeStart = analyticsRange.start;
    const scopedTrend = biData.timeTrend.filter(stat => {
      const bucket = new Date(stat.bucket);
      return !Number.isNaN(bucket.getTime()) && bucket >= rangeStart && bucket <= rangeEnd;
    });
    if (selectedHours <= 48) {
      return scopedTrend.map(stat => {
        const date = new Date(stat.bucket);
        const contributionFields = Object.fromEntries((stat.lineContributions || []).map(line => [`line_${line.lineId}`, line.contributionRate || 0]));
        return {
          time: selectedHours <= 24
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit' }),
          Total: stat.totalCount || 0, OK: stat.okCount, NG: stat.ngCount,
          DefectRate: stat.totalCount > 0 ? parseFloat((stat.ngCount / stat.totalCount * 100).toFixed(3)) : 0,
          ...contributionFields, lineContributions: stat.lineContributions || [],
          bucketStart: date,
          bucketEnd: new Date(date.getTime() + 60 * 60 * 1000)
        };
      });
    }
    const daily = new Map();
    scopedTrend.forEach(stat => {
      const date = new Date(stat.bucket);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const useMonthlyLabel = selectedTimePreset === 'this-year'
        || selectedTimePreset === 'last-12-months'
        || selectedTimePreset === 'last-5-years';
      const item = daily.get(key) || { time: useMonthlyLabel
          ? date.toLocaleDateString('vi-VN', { month: 'short', year: 'numeric' })
          : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }), Total: 0, OK: 0, NG: 0,
        bucketStart: dayStart, bucketEnd: useMonthlyLabel
          ? new Date(date.getFullYear(), date.getMonth() + 1, 1)
          : new Date(dayStart.getTime() + 24 * 60 * 60 * 1000), lineContributionMap: new Map() };
      item.Total += stat.totalCount || 0;
      item.OK += stat.okCount || 0;
      item.NG += stat.ngCount || 0;
      (stat.lineContributions || []).forEach(line => {
        const current = item.lineContributionMap.get(line.lineId) || { lineId: line.lineId, lineName: line.lineName, totalCount: 0, ngCount: 0 };
        current.totalCount += line.totalCount || 0; current.ngCount += line.ngCount || 0;
        item.lineContributionMap.set(line.lineId, current);
      });
      daily.set(key, item);
    });
    return [...daily.values()].map(item => {
      const contributions = [...item.lineContributionMap.values()].map(line => ({ ...line,
        defectRate: line.totalCount > 0 ? line.ngCount * 100 / line.totalCount : 0,
        contributionRate: item.Total > 0 ? line.ngCount * 100 / item.Total : 0 }));
      const fields = Object.fromEntries(contributions.map(line => [`line_${line.lineId}`, line.contributionRate]));
      const { lineContributionMap, ...chartItem } = item;
      return { ...chartItem, ...fields, lineContributions: contributions,
        DefectRate: item.Total > 0 ? parseFloat((item.NG / item.Total * 100).toFixed(3)) : 0 };
    });
  }, [biData, selectedHours, selectedTimePreset, analyticsRange]);

  const lineContributionSeries = useMemo(() => {
    const found = new Map();
    (biData?.timeTrend || []).forEach(point => (point.lineContributions || []).forEach(line => {
      if (!found.has(line.lineId)) found.set(line.lineId, line.lineName);
    }));
    return [...found.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { numeric: true, sensitivity: 'base' }))
      .map(([lineId, lineName], index) => ({ lineId, lineName,
      dataKey: `line_${lineId}`, color: getLineContributionColor(lineName, index) }));
  }, [biData]);

  const handleTimePointClick = (chartState) => {
    // Recharts uses activePayload for a chart-area click and payload for a
    // direct column click. In both cases drill into the full local day.
    const point = chartState?.activePayload?.[0]?.payload
      ?? chartState?.payload
      ?? chartState;
    if (!point?.bucketStart) return;
    const clickedAt = new Date(point.bucketStart);
    if (Number.isNaN(clickedAt.getTime())) return;
    const start = new Date(clickedAt.getFullYear(), clickedAt.getMonth(), clickedAt.getDate());
    const end = new Date(clickedAt.getFullYear(), clickedAt.getMonth(), clickedAt.getDate() + 1);
    if (selectedTimeWindow
      && new Date(selectedTimeWindow.start).getTime() === start.getTime()
      && new Date(selectedTimeWindow.end).getTime() === end.getTime()) {
      setSelectedTimeWindow(null);
      return;
    }
    setSelectedTimeWindow({ start, end, label: selectedHours <= 48
      ? `${start.toLocaleString('vi-VN')} → ${end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
      : start.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) });
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    const lineId = selectedLine ? parseInt(selectedLine) : null;
    const stationId = selectedStation ? parseInt(selectedStation) : null;
    try {
      const count = await ProductionApi.getExportCount(lineId, stationId, null, null, null, startDate, endDate);
      if (count > 3000) {
        setExportWarningModal({ count, lineId, stationId });
      } else {
        await ProductionApi.downloadExportCsv(null, lineId, stationId, null, null, null, startDate, endDate);
      }
    } catch (err) {
      console.error('Lỗi xuất CSV:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const confirmDownloadAll = async () => {
    if (!exportWarningModal) return;
    const { lineId, stationId } = exportWarningModal;
    setExportWarningModal(null);
    setIsExporting(true);
    try {
      await ProductionApi.downloadExportCsv(null, lineId, stationId, null, null, null, startDate, endDate);
    } catch (err) {
      console.error('Lỗi xuất dữ liệu CSV:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const point = payload[0]?.payload || {};
      const contributions = [...(point.lineContributions || [])].sort((a, b) => b.contributionRate - a.contributionRate);
      return (
        <div className="glass-panel p-3.5 border border-slate-300 shadow-2xl text-xs space-y-2 min-w-[250px]">
          <p className="font-mono text-slate-600 border-b border-slate-300 pb-1 font-semibold">{label}</p>
          <div className="flex items-center justify-between text-rose-700 font-semibold">
            <span>Tổng tỷ lệ lỗi:</span>
            <span className="font-mono text-sm">{Number(point.DefectRate || 0).toFixed(3)}%</span>
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto border-t border-slate-200 pt-2">{contributions.map(line => { const series = lineContributionSeries.find(x => x.lineId === line.lineId); return <div key={line.lineId} className="grid grid-cols-[10px_1fr_auto] items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{backgroundColor: series?.color || getLineContributionColor(line.lineName, 0)}}/><span className="truncate text-slate-700">{line.lineName}<span className="ml-1 text-slate-500">({line.ngCount} NG)</span></span><span className="font-mono font-semibold text-slate-900">{Number(line.contributionRate || 0).toFixed(3)}%</span></div>; })}</div>
          <div className="border-t border-slate-200 pt-1 text-[10px] text-slate-500">Đóng góp = NG của Line / tổng sản lượng tại mốc</div>
        </div>
      );
    }
    return null;
  };

  // Line Chart Data (Sorted ascending by Line Name)
  const lineChartData = useMemo(() => {
    if (!biData?.lineStats) return [];
    return [...biData.lineStats]
      .sort((a, b) => (a.lineName || a.LineName || '').localeCompare(b.lineName || b.LineName || '', undefined, { numeric: true, sensitivity: 'base' }))
      .map(l => {
        const total = l.total ?? l.Total ?? l.totalInspected ?? 0;
        const ok = l.ok ?? l.Ok ?? l.okCount ?? 0;
        const ng = l.ng ?? l.Ng ?? l.ngCount ?? 0;
        const yieldRate = l.yieldRate ?? l.YieldRate ?? 0;
        const lineName = l.lineName ?? l.LineName ?? `Line ${l.lineId || l.LineId}`;
        return {
          lineId: l.lineId ?? l.LineId,
          displayName: lineName,
          Volume: total,
          OK: ok,
          NG: ng,
          Yield: parseFloat((yieldRate || 0).toFixed(2)),
          DefectRate: total > 0 ? parseFloat((ng / total * 100).toFixed(3)) : 0,
          raw: l
        };
      });
  }, [biData]);

  const modelChartData = useMemo(() => {
    if (!biData?.modelStats) return [];
    return biData.modelStats.map(m => {
      const total = m.total ?? m.Total ?? 0;
      const ok = m.ok ?? m.Ok ?? 0;
      const ng = m.ng ?? m.Ng ?? 0;
      return { modelId: m.modelId ?? m.ModelId, displayName: m.modelName ?? m.ModelName,
        Volume: total, OK: ok, NG: ng, DefectRate: total > 0 ? parseFloat((ng * 100 / total).toFixed(3)) : 0 };
    })
      .filter(m => m.Volume >= 10)
      .sort((a, b) => b.DefectRate - a.DefectRate || b.NG - a.NG);
  }, [biData]);

  // Station Chart Data (Top 10 Lowest Yield Rate, with Line Name included)
  const stationChartData = useMemo(() => {
    if (!biData?.stationStats) return [];
    return biData.stationStats.map(s => {
      const total = s.total ?? s.Total ?? s.totalInspected ?? 0;
      const ok = s.ok ?? s.Ok ?? s.okCount ?? 0;
      const ng = s.ng ?? s.Ng ?? s.ngCount ?? 0;
      const yieldRate = s.yieldRate ?? s.YieldRate ?? 0;
      const stationName = s.stationName ?? s.StationName ?? `Station ${s.stationId || s.StationId}`;
      const lineName = s.lineName ?? s.LineName ?? `Line ${s.lineId || s.LineId}`;
      return {
        stationId: s.stationId ?? s.StationId,
        displayName: `${stationName} (${lineName})`,
        shortName: `${lineName.replace('Line ', 'L')}-${stationName}`,
        Volume: total,
        OK: ok,
        NG: ng,
        Yield: parseFloat((yieldRate || 0).toFixed(2)),
        DefectRate: total > 0 ? parseFloat((ng / total * 100).toFixed(3)) : 0,
        stationName,
        lineName,
        raw: s
      };
    }).sort((a, b) => b.DefectRate - a.DefectRate).slice(0, 10);
  }, [biData]);

  // Machine Chart Data (Top 10 Lowest Yield Rate, clearly formatted)
  const machineChartData = useMemo(() => {
    if (!biData?.machineStats) return [];
    return biData.machineStats.map(m => {
      const total = m.total ?? m.Total ?? m.totalInspected ?? 0;
      const ok = m.ok ?? m.Ok ?? m.okCount ?? 0;
      const ng = m.ng ?? m.Ng ?? m.ngCount ?? 0;
      const yieldRate = m.yieldRate ?? m.YieldRate ?? 0;
      const channelName = m.channelName ?? m.ChannelName ?? `Ch ${m.channelId || m.ChannelId}`;
      const stationName = m.stationName ?? m.StationName ?? 'Station';
      const lineName = m.lineName ?? m.LineName ?? 'Line';
      return {
        channelId: m.channelId ?? m.ChannelId,
        displayName: `${channelName} (${lineName})`,
        shortName: channelName,
        Volume: total,
        OK: ok,
        NG: ng,
        Yield: parseFloat((yieldRate || 0).toFixed(2)),
        DefectRate: total > 0 ? parseFloat((ng / total * 100).toFixed(3)) : 0,
        channelName,
        stationName,
        lineName,
        raw: m
      };
    }).sort((a, b) => b.DefectRate - a.DefectRate).slice(0, 10);
  }, [biData]);

  // Defect Chart Data (Top 10 Defects only)
  const defectChartData = useMemo(() => {
    if (!biData?.defectStats) return [];
    return biData.defectStats.slice(0, 10).map(d => ({
      code: d.code ?? d.Code ?? 'UNKNOWN',
      count: d.count ?? d.Count ?? 0,
      pct: d.pct ?? d.Pct ?? d.percentage ?? 0
    }));
  }, [biData]);

  const DualAxisTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="glass-panel p-3.5 border border-slate-300 shadow-2xl text-xs space-y-2 min-w-[190px]">
          <p className="font-mono text-slate-700 font-bold border-b border-slate-300 pb-1">
            {data.displayName || label}
          </p>
          {data.stationName && (
            <div className="text-[11px] text-slate-600">
              Trạm: <span className="text-slate-900 font-semibold">{data.stationName}</span> ({data.lineName})
            </div>
          )}
          <div className="flex items-center justify-between text-cyan-700 font-semibold">
            <span>Sản Lượng (Tổng):</span>
            <span className="font-mono text-sm">{data.Volume?.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-emerald-700 font-semibold">
            <span>Pass (OK):</span>
            <span className="font-mono text-sm">{data.OK?.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-rose-700 font-semibold">
            <span>Fail (NG):</span>
            <span className="font-mono text-sm">{data.NG?.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-purple-700 font-bold pt-1.5 border-t border-slate-200">
            <span>Tỷ lệ lỗi:</span>
            <span className="font-mono text-sm">{data.DefectRate}%</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 w-full animate-in fade-in duration-300">

      {document.getElementById('analytics-header-actions') && createPortal(<div className="flex flex-wrap items-center justify-end gap-2">
        <span className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-mono ${loading ? 'border-amber-500/30 bg-amber-500/10 text-amber-700' : 'border-slate-300 bg-slate-100/70 text-slate-600'}`}>
          <Clock className={`mr-1 inline h-3 w-3 ${loading ? 'animate-pulse' : ''}`} />
          BI Matrix: {loading ? 'đang tải...' : loadDurationMs == null ? '—' : `${(loadDurationMs / 1000).toFixed(2)}s`}
        </span>
        <button
          onClick={fetchBiMatrix}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 border border-slate-300 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Làm mới
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 border border-rose-500/30 text-xs font-medium flex items-center gap-1.5 transition-all"
          >
            <XCircle className="w-3.5 h-3.5" />
            Xóa Bộ Lọc Chéo
          </button>
        )}
        <button
          onClick={handleExportCsv}
          disabled={isExporting}
          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-md shadow-emerald-900/30 disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" />
          {isExporting ? 'Đang xuất...' : 'Xuất CSV'}
        </button>
      </div>, document.getElementById('analytics-header-actions'))}

      {/* GLOBAL POWER BI FILTER CONTROL PANEL */}
      <div className="glass-panel p-4 w-full space-y-3">
        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
          {/* 1. Line Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1">Dây Chuyền (Line)</label>
            <select
              value={selectedLine}
              onChange={(e) => handleLineChange(e.target.value)}
              className="w-full bg-slate-50/90 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Lines ({lines.length})</option>
              {[...lines].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* 2. Station Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1">Trạm (Station)</label>
            <select
              value={selectedStation}
              onChange={(e) => handleStationChange(e.target.value)}
              className="w-full bg-slate-50/90 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Trạm ({filteredStations.length})</option>
              {filteredStations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* 3. Machine / Channel Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1">Máy (Machine)</label>
            <select
              value={selectedChannel}
              onChange={(e) => handleChannelChange(e.target.value)}
              className="w-full bg-slate-50/90 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Máy ({filteredChannels.length})</option>
              {filteredChannels.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 4. Error Code Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1">Mã Lỗi (Defect)</label>
            <select
              value={selectedErrorCode}
              onChange={(e) => handleErrorCodeChange(e.target.value)}
              className="w-full bg-slate-50/90 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Mã Lỗi</option>
              {biData?.defectStats?.map(d => (
                <option key={d.code} value={d.code}>{d.code} ({d.count})</option>
              ))}
            </select>
          </div>

          {/* 5. Job File Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1">Job File</label>
            <select
              value={selectedJobFile}
              onChange={(e) => handleJobFileChange(e.target.value)}
              className="w-full bg-slate-50/90 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500"
            >
              <option value="">Tất cả Job Files</option>
              {biData?.jobFileStats?.map(j => (
                <option key={j.jobFile} value={j.jobFile}>{j.jobFile}</option>
              ))}
            </select>
            {selectedJobFile && (
              <div className="mt-1 break-all rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[9px] font-mono leading-4 text-amber-700" title={selectedJobFile}>
                {selectedJobFile}
              </div>
            )}
          </div>

          {/* 6. Hours Interval Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1">Khung Thời Gian</label>
            <select
              value={selectedTimePreset}
              onChange={(e) => handleTimePresetChange(e.target.value)}
              className="w-full bg-slate-50/90 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500 font-mono"
            >
              <optgroup label="Theo lịch">
                <option value="today">Hôm Nay</option>
                <option value="this-month">Tháng Này</option>
                <option value="this-year">Năm Nay</option>
              </optgroup>
              <optgroup label="Khoảng gần nhất">
                <option value="12h">12 Giờ Gần Nhất</option>
                <option value="24h">24 Giờ Gần Nhất</option>
                <option value="48h">48 Giờ Gần Nhất</option>
                <option value="last-12-months">12 Tháng Gần Nhất</option>
                <option value="last-5-years">5 Năm Gần Nhất</option>
              </optgroup>
            </select>
            <div className="mt-1 truncate text-[9px] font-mono text-cyan-700" title={analyticsRange.label}>
              {analyticsRange.label}
            </div>
          </div>
        </div>

        {/* Active Filter Indicators */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
            <span className="text-slate-600 font-semibold">Bộ lọc hiện tại:</span>
            {selectedLine && (
              <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-700 border border-purple-500/30 flex items-center gap-1">
                Line: {lines.find(l => l.id === parseInt(selectedLine))?.name}
                <button onClick={() => handleLineChange('')} className="hover:text-slate-900">✕</button>
              </span>
            )}
            {selectedStation && (
              <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-700 border border-indigo-500/30 flex items-center gap-1">
                Station: {stations.find(s => s.id === parseInt(selectedStation))?.name}
                <button onClick={() => handleStationChange('')} className="hover:text-slate-900">✕</button>
              </span>
            )}
            {selectedChannel && (
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-700 border border-cyan-500/30 flex items-center gap-1">
                Machine: {channels.find(c => c.id === parseInt(selectedChannel))?.name}
                <button onClick={() => handleChannelChange('')} className="hover:text-slate-900">✕</button>
              </span>
            )}
            {selectedModel && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 border border-amber-500/30 flex items-center gap-1">
                Model: {selectedModelName || `#${selectedModel}`}
                <button onClick={() => handleModelChange('')} className="hover:text-slate-900">✕</button>
              </span>
            )}
            {selectedErrorCode && (
              <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-700 border border-rose-500/30 flex items-center gap-1">
                Code: {selectedErrorCode}
                <button onClick={() => handleErrorCodeChange('')} className="hover:text-slate-900">✕</button>
              </span>
            )}
            {selectedJobFile && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 border border-amber-500/30 flex items-center gap-1">
                Job: {selectedJobFile}
                <button onClick={() => handleJobFileChange('')} className="hover:text-slate-900">✕</button>
              </span>
            )}
            {selectedTimeWindow && (
              <span className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-700 border border-sky-500/30 flex items-center gap-1">
                Thời gian: {selectedTimeWindow.label}
                <button onClick={() => setSelectedTimeWindow(null)} className="hover:text-slate-900">✕</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* SECTION 1: TIME TREND (TOP OVERVIEW CHART) */}
      <div className="glass-panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-700" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-display">
              Đóng Góp Tỷ Lệ Lỗi Theo Line ({selectedTimePresetLabel})
            </h3>
          </div>
          <span className="text-[11px] text-slate-600 font-mono">TimescaleDB Aggregation</span>
        </div>

        <div className="h-72 w-full">
          {timeTrendChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeTrendChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} onClick={handleTimePointClick} className="cursor-pointer">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#be123c" fontSize={11} tickLine={false} unit="%" />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                {lineContributionSeries.map(series => <Bar key={series.lineId} yAxisId="right" dataKey={series.dataKey} name={series.lineName} stackId="lineContribution" fill={series.color} stroke="#ffffff" strokeWidth={1} maxBarSize={34} cursor="pointer" onClick={handleTimePointClick} />)}
                <Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#be123c" strokeWidth={2.5} dot={{ r: 3, fill: '#be123c' }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs">
              {loading ? 'Đang truy vấn dữ liệu sản xuất...' : 'Không có dữ liệu trong khoảng thời gian đã chọn.'}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: 3-COLUMN CORRELATION GRID (LINES, STATIONS, MACHINES) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Chart A: Line Yield Rate (Stacked Volume Bars OK+NG + Yield Rate Line) */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-purple-700" />
              Sản lượng & tỷ lệ lỗi theo Line
            </h4>
            <span className="text-[10px] text-slate-600 font-mono">Click cột để lọc Line</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className="flex items-center gap-1 text-rose-700"><span className="h-2.5 w-2.5 bg-red-500" /> Sản Lượng Fail (NG)</span>
            <span className="flex items-center gap-1 text-emerald-700"><span className="h-2.5 w-2.5 bg-emerald-500" /> Sản Lượng Pass (OK)</span>
            <span className="flex items-center gap-1 text-rose-700"><span className="h-0.5 w-3 bg-rose-400" /> Tỷ lệ lỗi (%)</span>
          </div>

          <div className="h-64 w-full">
            {lineChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={lineChartData} margin={{ top: 10, right: 15, left: -15, bottom: 42 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="displayName" stroke="#475569" fontSize={10} tickLine={false} interval={0} angle={-15} textAnchor="end" />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#be123c" fontSize={10} tickLine={false} unit="%" />
                  <Tooltip content={<DualAxisTooltip />} />
                  <Bar yAxisId="left" dataKey="OK" name="Sản Lượng Pass (OK)" stackId="a" fill="#10b981" maxBarSize={28} cursor="pointer" onClick={(item) => handleLineChange(item.payload.lineId.toString())} />
                  <Bar yAxisId="left" dataKey="NG" name="Sản Lượng Fail (NG)" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" onClick={(item) => handleLineChange(item.payload.lineId.toString())} />
                  <Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#be123c" strokeWidth={2.5} dot={{ r: 3, fill: '#be123c' }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chưa ghi nhận dữ liệu theo dây chuyền.
              </div>
            )}
          </div>
        </div>

        {/* Chart B: Model statistics derived from manual Job File mapping */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2"><h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-amber-700"/>Tỷ lệ lỗi theo Model</h4><span className="text-[10px] text-slate-600 font-mono">Job File mapping</span></div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] font-mono"><span className="text-rose-700">■ Fail (NG)</span><span className="text-emerald-700">■ Pass (OK)</span><span className="text-rose-700">— Tỷ lệ lỗi (%)</span></div>
          <div className="h-64 w-full">{modelChartData.length > 0 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={modelChartData} margin={{top:10,right:15,left:-15,bottom:55}} onClick={handleModelChartClick} className="cursor-pointer"><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="displayName" stroke="#475569" fontSize={9} interval={0} angle={-25} textAnchor="end"/><YAxis yAxisId="left" stroke="#64748b" fontSize={10}/><YAxis yAxisId="right" orientation="right" domain={[0,'auto']} stroke="#be123c" fontSize={10} unit="%"/><Tooltip content={<DualAxisTooltip/>}/><Bar yAxisId="left" dataKey="OK" name="Pass (OK)" stackId="a" fill="#10b981" maxBarSize={28} cursor="pointer" onClick={handleModelChartClick}/><Bar yAxisId="left" dataKey="NG" name="Fail (NG)" stackId="a" fill="#ef4444" radius={[4,4,0,0]} maxBarSize={28} cursor="pointer" onClick={handleModelChartClick}/><Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#be123c" strokeWidth={2.5} cursor="pointer" dot={{r:3,fill:'#be123c',cursor:'pointer'}} onClick={handleModelChartClick}/></ComposedChart></ResponsiveContainer> : <div className="h-full flex items-center justify-center text-center text-slate-500 text-xs">Chưa có dữ liệu Model.<br/>Hãy mapping Job File trong Master Data.</div>}</div>
        </div>

        {/* Chart B: Station Yield Rate (Top 10 Lowest Yield Rate, Stacked Volume Bars OK+NG + Yield Line) */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-700" />
              Top 10 Station (Tỷ lệ lỗi cao nhất)
            </h4>
            <span className="text-[10px] text-slate-600 font-mono">Click cột để lọc Trạm</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className="flex items-center gap-1 text-rose-700"><span className="h-2.5 w-2.5 bg-red-500" /> Sản Lượng Fail (NG)</span>
            <span className="flex items-center gap-1 text-emerald-700"><span className="h-2.5 w-2.5 bg-emerald-500" /> Sản Lượng Pass (OK)</span>
            <span className="flex items-center gap-1 text-rose-700"><span className="h-0.5 w-3 bg-rose-400" /> Tỷ lệ lỗi (%)</span>
          </div>

          <div className="h-64 w-full">
            {stationChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={stationChartData} margin={{ top: 10, right: 15, left: -15, bottom: 55 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="displayName" stroke="#475569" fontSize={9} tickLine={false} interval={0} angle={-25} textAnchor="end" />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#be123c" fontSize={10} tickLine={false} unit="%" />
                  <Tooltip content={<DualAxisTooltip />} />
                  <Bar yAxisId="left" dataKey="OK" name="Sản Lượng Pass (OK)" stackId="a" fill="#10b981" maxBarSize={28} cursor="pointer" onClick={(item) => handleStationChange(item.payload.stationId.toString())} />
                  <Bar yAxisId="left" dataKey="NG" name="Sản Lượng Fail (NG)" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" onClick={(item) => handleStationChange(item.payload.stationId.toString())} />
                  <Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#be123c" strokeWidth={2.5} dot={{ r: 3, fill: '#be123c' }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chưa ghi nhận dữ liệu theo trạm.
              </div>
            )}
          </div>
        </div>

        {/* Chart C: Machine / Channel Yield Rate (Top 10 Lowest Yield Rate, Stacked Volume Bars OK+NG + Yield Line) */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-700" />
              Top 10 Máy (Tỷ lệ lỗi cao nhất)
            </h4>
            <span className="text-[10px] text-slate-600 font-mono">Click cột để lọc Máy</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className="flex items-center gap-1 text-rose-700"><span className="h-2.5 w-2.5 bg-red-500" /> Sản Lượng Fail (NG)</span>
            <span className="flex items-center gap-1 text-emerald-700"><span className="h-2.5 w-2.5 bg-emerald-500" /> Sản Lượng Pass (OK)</span>
            <span className="flex items-center gap-1 text-rose-700"><span className="h-0.5 w-3 bg-rose-400" /> Tỷ lệ lỗi (%)</span>
          </div>

          <div className="h-64 w-full">
            {machineChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={machineChartData} margin={{ top: 10, right: 15, left: -15, bottom: 55 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="displayName" stroke="#475569" fontSize={9} tickLine={false} interval={0} angle={-25} textAnchor="end" />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#be123c" fontSize={10} tickLine={false} unit="%" />
                  <Tooltip content={<DualAxisTooltip />} />
                  <Bar yAxisId="left" dataKey="OK" name="Sản Lượng Pass (OK)" stackId="a" fill="#10b981" maxBarSize={28} cursor="pointer" onClick={(item) => handleChannelChange(item.payload.channelId.toString())} />
                  <Bar yAxisId="left" dataKey="NG" name="Sản Lượng Fail (NG)" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" onClick={(item) => handleChannelChange(item.payload.channelId.toString())} />
                  <Line yAxisId="right" type="monotone" dataKey="DefectRate" name="Tỷ lệ lỗi (%)" stroke="#be123c" strokeWidth={2.5} dot={{ r: 3, fill: '#be123c' }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chưa ghi nhận dữ liệu theo máy.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: 2-COLUMN GRID (DEFECT PARETO & JOB FILE STATISTICS) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left: Defect Code Pareto Chart (Top 10) */}
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1.5 font-display">
              <AlertTriangle className="w-4 h-4 text-rose-700" />
              Top 10 Step NG (Defects Pareto)
            </h4>
            <span className="text-[10px] text-slate-600 font-mono">Click thanh lỗi để lọc</span>
          </div>

          <div className="h-72 w-full">
            {defectChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={defectChartData} margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" stroke="#64748b" fontSize={10} />
                  <YAxis type="category" dataKey="code" stroke="#475569" fontSize={10} width={130} />
                  <Tooltip 
                    cursor={{ fill: 'rgba(244, 63, 94, 0.08)' }}
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      boxShadow: '0 10px 25px rgba(15, 23, 42, 0.12)',
                      fontSize: '11px',
                    }}
                    labelStyle={{ color: 'var(--text-main)', fontWeight: 700, marginBottom: '4px' }}
                    itemStyle={{ color: '#be123c', fontWeight: 600 }}
                    formatter={(val, name, props) => [`${val} lượt (${props.payload.pct}%)`, 'Số Lỗi Phát Sinh']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20} cursor="pointer" onClick={(item) => handleErrorCodeChange(item.payload.code)}>
                    {defectChartData.map((entry, index) => (
                      <Cell 
                        key={`def-${index}`} 
                        fill={selectedErrorCode === entry.code ? '#f43f5e' : '#e11d48'} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-1">
                <CheckCircle className="w-7 h-7 text-emerald-500 mb-1" />
                <span>Không phát hiện lỗi sản xuất trong tập dữ liệu ma trận lọc!</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Job File Yield Statistics Table / Bar Chart */}
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1.5 font-display">
              <FileText className="w-4 h-4 text-amber-700" />
              Thống Kê Sản Lượng Theo Job File (Model)
            </h4>
            <span className="text-[10px] text-slate-600 font-mono">Click dòng để lọc Job</span>
          </div>

          <div className="h-72 w-full overflow-y-auto pr-1">
            {biData?.jobFileStats?.some(job => (job.total ?? job.Total ?? job.totalInspected ?? 0) >= 10) ? (
              <div className="space-y-1.5">
                {biData.jobFileStats.filter(job => (job.total ?? job.Total ?? job.totalInspected ?? 0) >= 10).map((job) => {
                  const jobFileName = job.jobFile ?? job.JobFile ?? 'Unknown Job';
                  const total = job.total ?? job.Total ?? job.totalInspected ?? 0;
                  const ok = job.ok ?? job.Ok ?? job.okCount ?? 0;
                  const ng = job.ng ?? job.Ng ?? job.ngCount ?? 0;
                  const yieldRate = job.yieldRate ?? job.YieldRate ?? 0;
                  const defectRate = job.defectRate ?? job.DefectRate ?? (total > 0 ? ng * 100 / total : 0);
                  const isSelected = selectedJobFile === jobFileName;

                  return (
                    <div 
                      key={jobFileName}
                      onClick={() => handleJobFileChange(jobFileName)}
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between cursor-pointer transition-all ${
                        isSelected 
                          ? 'bg-amber-500/20 border-amber-500/50 text-slate-900 shadow-md shadow-amber-500/10' 
                          : 'bg-slate-50/60 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100/60'
                      }`}
                    >
                      <div className="mr-3 flex min-w-0 flex-1 items-start gap-2" title={jobFileName}>
                        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-amber-700' : 'text-slate-600'}`} />
                        <span className="break-all font-mono font-semibold leading-4">{jobFileName}</span>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-4 font-mono text-[11px]">
                        <div>Total: <span className="text-slate-900 font-bold">{total.toLocaleString()}</span></div>
                        <div>OK: <span className="text-emerald-700">{ok.toLocaleString()}</span></div>
                        <div>NG: <span className="text-rose-700">{ng.toLocaleString()}</span></div>
                        <div title={`Yield: ${yieldRate.toFixed(1)}%`} className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                          defectRate >= 5 ? 'bg-rose-500/20 text-rose-700' : defectRate >= 1.5 ? 'bg-amber-500/20 text-amber-700' : 'bg-emerald-500/20 text-emerald-700'
                        }`}>
                          Lỗi {defectRate.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chưa ghi nhận dữ liệu theo Job File.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Large Data Warning Modal */}
      {exportWarningModal && (
        <div className="fixed inset-0 bg-slate-50/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-100 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-700">
              <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Cảnh Báo Dữ Liệu Lớn</h3>
                <p className="text-xs text-amber-700/90 font-mono">
                  Phát hiện {exportWarningModal.count.toLocaleString('vi-VN')} bản ghi
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed font-sans">
              Hệ thống tìm thấy tổng cộng <strong className="text-amber-700 font-mono">{exportWarningModal.count.toLocaleString('vi-VN')}</strong> dòng dữ liệu sản xuất khớp với bộ lọc. 
              Việc tải toàn bộ dữ liệu có thể tốn vài giây xử lý. Bạn có muốn tiếp tục tải hết dữ liệu không?
            </p>

            <div className="bg-slate-50/60 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span>Tổng số dòng:</span>
                <span className="text-slate-900 font-semibold">{exportWarningModal.count.toLocaleString('vi-VN')} dòng</span>
              </div>
              <div className="flex justify-between">
                <span>Dung lượng ước tính:</span>
                <span className="text-emerald-700 font-semibold">~{(exportWarningModal.count * 0.22 / 1024).toFixed(1)} MB</span>
              </div>
              <div className="flex justify-between">
                <span>Chế độ xuất:</span>
                <span className="text-amber-700 font-semibold">Không giới hạn (Export Full)</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setExportWarningModal(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold transition-colors font-sans"
              >
                Hủy bỏ
              </button>
              <button
                onClick={confirmDownloadAll}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-bold transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 font-sans"
              >
                <Download className="w-4 h-4" />
                Vẫn Tải Tất Cả ({exportWarningModal.count.toLocaleString('vi-VN')} dòng)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(Analytics);
