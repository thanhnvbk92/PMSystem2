import React, { useState, useEffect } from 'react';
import { Zap, Play, Square, Send, Cpu, Radio, Sparkles, Activity } from 'lucide-react';
import { ProductionApi } from '../services/api';

export default function Simulator({ channels, onPcbSubmitted }) {
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [pidPrefix, setPidPrefix] = useState('PCB-8899');
  const [resultType, setResultType] = useState('OK');
  const [errorCode, setErrorCode] = useState('ERR_SOLDER_BRIDGE');
  
  // Continuous Auto Stream Generator
  const [isAutoStreaming, setIsAutoStreaming] = useState(false);
  const [streamSpeedMs, setStreamSpeedMs] = useState(1500);
  const [simulatedCount, setSimulatedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (channels.length > 0 && !selectedChannelId) {
      setSelectedChannelId(channels[0].id.toString());
    }
  }, [channels]);

  useEffect(() => {
    let interval = null;
    if (isAutoStreaming && selectedChannelId) {
      interval = setInterval(() => {
        triggerSimulatedPcb();
      }, streamSpeedMs);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAutoStreaming, selectedChannelId, streamSpeedMs, pidPrefix, resultType]);

  const triggerSimulatedPcb = async () => {
    if (!selectedChannelId) return;
    setLoading(true);
    try {
      const isRandomResult = Math.random() > 0.15; // 85% OK, 15% NG
      const actualResult = isAutoStreaming ? (isRandomResult ? 'OK' : 'NG') : resultType;
      const actualErrorCode = actualResult === 'NG' ? (isAutoStreaming ? (Math.random() > 0.5 ? 'ERR_SOLDER_BRIDGE' : 'ERR_COMPONENT_MISSING') : errorCode) : null;
      
      const randomPid = `${pidPrefix}-${Math.floor(1000 + Math.random() * 9000)}`;

      const pcbPayload = {
        channelId: parseInt(selectedChannelId),
        pid: randomPid,
        result: actualResult,
        errorCode: actualErrorCode,
        inspectTime: new Date().toISOString(),
        steps: [
          { stepName: 'Solder Paste Height Inspection', result: 'OK', value: '120 µm', minValue: '90 µm', maxValue: '150 µm' },
          { stepName: 'Component Polarity Verification', result: actualResult === 'OK' ? 'OK' : 'NG', value: actualResult === 'OK' ? 'PASS' : 'FAIL', minValue: 'PASS', maxValue: 'PASS' },
          { stepName: 'Optical Alignment Test', result: 'OK', value: '0.02 mm', minValue: '0.00 mm', maxValue: '0.05 mm' },
        ]
      };

      const res = await ProductionApi.submitPcb(pcbPayload);
      setSimulatedCount(prev => prev + 1);
      if (onPcbSubmitted) onPcbSubmitted(res);
    } catch (err) {
      console.error('Simulator Ingestion Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 w-full">
      {/* Title */}
      <div className="glass-panel p-6 flex flex-wrap items-center justify-between gap-4 border border-white/10">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5 font-display">
            <Zap className="w-5 h-5 text-amber-400 fill-amber-400/20" />
            High-Throughput PCB Inspection Telemetry Simulator
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Simulate real SMT inspection camera hardware pushing telemetry to <code>POST /api/v1/production/submit</code>
          </p>
        </div>

        <div className="flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono shadow-lg shadow-amber-500/10">
          <Activity className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="text-xs">Generated Telemetry:</span>
          <strong className="text-sm font-bold text-amber-200">{simulatedCount} PCBs</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Manual Single Injection */}
        <div className="glass-panel p-6 space-y-4 border border-white/10">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3 font-display">
            <Send className="w-4 h-4 text-blue-400" /> Manual Telemetry Injection
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Target Hardware Channel</label>
            <select
              value={selectedChannelId}
              onChange={e => setSelectedChannelId(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
            >
              {channels.map(c => (
                <option key={c.id} value={c.id}>
                  #{c.id} {c.name} ({c.stationName} - {c.lineName})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">PID Prefix (Barcode Format)</label>
            <input
              type="text"
              value={pidPrefix}
              onChange={e => setPidPrefix(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Inspection Result</label>
              <select
                value={resultType}
                onChange={e => setResultType(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-semibold"
              >
                <option value="OK">OK (Pass)</option>
                <option value="NG">NG (Fail)</option>
              </select>
            </div>

            {resultType === 'NG' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Defect Code</label>
                <select
                  value={errorCode}
                  onChange={e => setErrorCode(e.target.value)}
                  className="w-full bg-slate-950/80 border border-rose-500/50 rounded-xl px-3.5 py-2.5 text-xs text-rose-300 font-mono font-semibold"
                >
                  <option value="ERR_SOLDER_BRIDGE">ERR_SOLDER_BRIDGE</option>
                  <option value="ERR_COMPONENT_MISSING">ERR_COMPONENT_MISSING</option>
                  <option value="ERR_POLARITY_REVERSED">ERR_POLARITY_REVERSED</option>
                </select>
              </div>
            )}
          </div>

          <button
            onClick={triggerSimulatedPcb}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 mt-2"
          >
            <Send className="w-4 h-4" /> Trigger Single Inspection Event
          </button>
        </div>

        {/* Continuous Automated Stream Generator */}
        <div className="glass-panel p-6 space-y-4 border border-amber-500/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>

          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3 font-display">
            <Cpu className="w-4 h-4 text-amber-400" /> Automated Production Stream
          </h3>

          <p className="text-xs text-slate-400 leading-relaxed">
            Generates high-speed continuous PCB telemetry (~85% Pass / 15% Defect) to test real-time SignalR WebSocket latency & dynamic charts.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Stream Telemetry Interval</label>
            <select
              value={streamSpeedMs}
              onChange={e => setStreamSpeedMs(parseInt(e.target.value))}
              disabled={isAutoStreaming}
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white"
            >
              <option value="800">High-Speed (800ms / PCB)</option>
              <option value="1500">Standard Production (1.5s / PCB)</option>
              <option value="3000">Relaxed Stream (3.0s / PCB)</option>
            </select>
          </div>

          <div className="pt-3">
            {!isAutoStreaming ? (
              <button
                onClick={() => setIsAutoStreaming(true)}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 shadow-xl shadow-emerald-600/35"
              >
                <Play className="w-4 h-4 fill-current" /> Start Continuous Telemetry Stream
              </button>
            ) : (
              <button
                onClick={() => setIsAutoStreaming(false)}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-extrabold text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 shadow-xl shadow-rose-600/35 animate-pulse"
              >
                <Square className="w-4 h-4 fill-current" /> Stop Automated Telemetry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
