import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { MODULES, moduleItems } from '../modules';
import { MachinesApi } from '../services/api';

// Plain left clicks switch page in place; Ctrl/middle clicks keep the real link (new tab).
const isPlainClick = (event) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

export default function Home({ setActiveTab, summaryData, counts = {} }) {
  const [pcs, setPcs] = useState(null);
  useEffect(() => {
    MachinesApi.getAll().then(r => setPcs(r.machines || [])).catch(() => setPcs(null));
  }, []);

  const highlights = {
    pc: pcs
      ? [
          { label: 'Online', value: pcs.filter(p => p.isOnline).length },
          { label: 'Offline', value: pcs.filter(p => !p.isOnline).length },
          { label: 'Đã báo version', value: pcs.filter(p => p.appVersion).length },
        ]
      : [],
    fct: summaryData
      ? [
          { label: 'Yield', value: `${(summaryData.overallYieldRate ?? 0).toFixed(1)}%` },
          { label: 'Đã kiểm tra', value: (summaryData.totalInspected ?? 0).toLocaleString() },
          { label: 'Channel hoạt động', value: summaryData.activeChannels ?? 0 },
        ]
      : [],
    master: [
      { label: 'Lines', value: counts.lines ?? 0 },
      { label: 'Stations', value: counts.stations ?? 0 },
      { label: 'Channels', value: counts.channels ?? 0 },
    ],
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {MODULES.map(module => {
          const Icon = module.icon;
          const items = moduleItems(module);
          const first = items[0];
          return (
            <div key={module.id} className="glass-panel border border-slate-200 p-5 flex flex-col gap-4 hover:shadow-xl hover:border-slate-300 transition-all group">
              <a
                href={`#${first.id}`}
                onClick={(event) => { if (isPlainClick(event)) { event.preventDefault(); setActiveTab(first.id); } }}
                className="flex items-start gap-4"
                title={`Mở ${module.title} (Ctrl+click để mở tab mới)`}
              >
                <div className={`w-14 h-14 shrink-0 rounded-2xl bg-gradient-to-br ${module.gradient} flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
                  <Icon className="w-7 h-7 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-slate-900 font-display flex items-center gap-2">
                    {module.title}
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all" />
                  </h2>
                  <p className="text-xs text-slate-600 mt-1">{module.description}</p>
                </div>
              </a>

              {highlights[module.id]?.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {highlights[module.id].map(h => (
                    <div key={h.label} className="rounded-xl bg-slate-50/80 border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold truncate">{h.label}</div>
                      <div className={`text-sm font-bold font-mono ${module.color}`}>{h.value}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5 mt-auto pt-3 border-t border-slate-200">
                {items.map(item => {
                  const ItemIcon = item.icon;
                  return (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      onClick={(event) => { if (isPlainClick(event)) { event.preventDefault(); setActiveTab(item.id); } }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100/80 hover:bg-slate-200 text-[11px] font-medium text-slate-700 transition-colors"
                    >
                      <ItemIcon className={`w-3 h-3 ${item.color}`} />
                      {item.label}
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
