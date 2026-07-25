import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Terminal,
  Send,
  RotateCcw,
  Cpu,
  Layers,
  Radio,
  CheckCircle2,
  XCircle,
  Clock,
  Sliders,
  ShieldAlert,
  Play,
  Trash2,
  Filter,
  Sparkles,
  Server,
  Zap,
  Globe,
  RefreshCw,
  Info,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Search,
  Check,
  X
} from 'lucide-react';
import { CommandApi } from '../services/api';

export default function CommandControl({ lines = [], stations = [], channels = [], onRefreshMasterData }) {
  // Targeting Scope State: 'all' | 'line' | 'station' | 'channel'
  const [targetMode, setTargetMode] = useState('all');
  const [selectedLineId, setSelectedLineId] = useState('');
  const [selectedStationId, setSelectedStationId] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');

  // Combobox & TreeView UI State
  const [isTreeOpen, setIsTreeOpen] = useState(false);
  const [treeSearch, setTreeSearch] = useState('');
  const [expandedNodes, setExpandedNodes] = useState({ 'root-all': true });
  const treeDropdownRef = useRef(null);

  // Close Tree Combobox when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (treeDropdownRef.current && !treeDropdownRef.current.contains(e.target)) {
        setIsTreeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Toggle Node Expand / Collapse
  const toggleExpandNode = (nodeId, e) => {
    if (e) e.stopPropagation();
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  // Select Node in TreeView
  const handleSelectTreeNode = (node) => {
    if (node.type === 'all') {
      setTargetMode('all');
      setSelectedLineId('');
      setSelectedStationId('');
      setSelectedChannelId('');
    } else if (node.type === 'line') {
      setTargetMode('line');
      setSelectedLineId(String(node.lineId));
      setSelectedStationId('');
      setSelectedChannelId('');
    } else if (node.type === 'station') {
      setTargetMode('station');
      setSelectedLineId(String(node.lineId));
      setSelectedStationId(String(node.stationId));
      setSelectedChannelId('');
    } else if (node.type === 'channel') {
      setTargetMode('channel');
      setSelectedLineId(String(node.lineId));
      setSelectedStationId(String(node.stationId));
      setSelectedChannelId(String(node.channelId));
    }
    setIsTreeOpen(false);
  };

  // Active Command Tab: 'change-model' | 'restart' | 'custom'
  const [activeCommandTab, setActiveCommandTab] = useState('change-model');

  // Command Form State
  const [modelName, setModelName] = useState('');
  const [delayMs, setDelayMs] = useState(1500);
  const [customCommand, setCustomCommand] = useState('sync.config');
  const [customJsonData, setCustomJsonData] = useState('{\n  "version": "1.0",\n  "force_update": true\n}');

  // Dispatch Status & Console History
  const [isSending, setIsSending] = useState(false);
  const [notification, setNotification] = useState(null); // { type: 'success' | 'error', text: '' }
  const [commandHistory, setCommandHistory] = useState([
    {
      id: 'cmd-init-001',
      command: 'system.welcome',
      targetText: 'Hệ thống sẵn sàng',
      timestamp: new Date().toLocaleTimeString(),
      status: 'success',
      response: 'Command Console đã sẵn sàng tiếp nhận lệnh.',
    }
  ]);

  // Quick Model Presets
  const modelPresets = [
    'MODEL_A_SMT_REV1',
    'MODEL_B_MAIN_V2',
    'IPHONE_16_BOARD_X',
    'XRAY_9020_DUAL_CHANNEL',
    'DEFAULT_RUN'
  ];

  // Helper: Filter Stations based on Selected Line
  const filteredStations = useMemo(() => {
    if (!selectedLineId) return stations;
    return stations.filter((s) => String(s.lineId) === String(selectedLineId));
  }, [stations, selectedLineId]);

  // Helper: Filter Channels based on Selected Line & Station
  const filteredChannelsForSelect = useMemo(() => {
    let list = channels;
    if (selectedLineId) {
      list = list.filter((c) => String(c.lineId) === String(selectedLineId));
    }
    if (selectedStationId) {
      list = list.filter((c) => String(c.stationId) === String(selectedStationId));
    }
    return list;
  }, [channels, selectedLineId, selectedStationId]);

  // Calculate Targeted Channels based on targetMode
  const targetedChannels = useMemo(() => {
    if (targetMode === 'all') return channels;
    if (targetMode === 'line') {
      if (!selectedLineId) return [];
      return channels.filter((c) => String(c.lineId) === String(selectedLineId));
    }
    if (targetMode === 'station') {
      if (!selectedStationId) return [];
      return channels.filter((c) => String(c.stationId) === String(selectedStationId));
    }
    if (targetMode === 'channel') {
      if (!selectedChannelId) return [];
      return channels.filter((c) => String(c.id) === String(selectedChannelId));
    }
    return [];
  }, [channels, targetMode, selectedLineId, selectedStationId, selectedChannelId]);

  // Get Target Payload Parameters for API
  const getTargetPayload = () => {
    const payload = {};
    if (targetMode === 'line' && selectedLineId) {
      payload.lineId = parseInt(selectedLineId, 10);
    } else if (targetMode === 'station' && selectedStationId) {
      payload.stationId = parseInt(selectedStationId, 10);
    } else if (targetMode === 'channel' && selectedChannelId) {
      const ch = channels.find((c) => String(c.id) === String(selectedChannelId));
      if (ch) {
        payload.channelId = ch.id;
        if (ch.macAddress) {
          payload.macAddress = ch.macAddress;
        }
      }
    }
    return payload;
  };

  // Get Target Summary String for Console Display
  const getTargetDescription = () => {
    if (targetMode === 'all') return '🌐 Tất cả thiết bị (Broadcast All)';
    if (targetMode === 'line') {
      const lineObj = lines.find((l) => String(l.id) === String(selectedLineId));
      return `🏭 Dây chuyền: ${lineObj ? lineObj.name : 'Chưa chọn Line'}`;
    }
    if (targetMode === 'station') {
      const stObj = stations.find((s) => String(s.id) === String(selectedStationId));
      return `🚉 Trạm kiểm tra: ${stObj ? stObj.name : 'Chưa chọn Station'}`;
    }
    if (targetMode === 'channel') {
      const chObj = channels.find((c) => String(c.id) === String(selectedChannelId));
      return `🔌 Kênh #${selectedChannelId} (${chObj ? chObj.channelName || chObj.macAddress || 'Channel' : 'Chưa chọn Channel'})`;
    }
    return 'Chưa xác định';
  };

  // Show Temporary Notification Banner
  const showToast = (type, text) => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 4000);
  };

  // Handle Command Execution
  const handleExecuteCommand = async () => {
    // Validation
    if (targetMode === 'line' && !selectedLineId) {
      showToast('error', 'Vui lòng chọn Dây truyền sản xuất!');
      return;
    }
    if (targetMode === 'station' && !selectedStationId) {
      showToast('error', 'Vui lòng chọn Trạm kiểm tra!');
      return;
    }
    if (targetMode === 'channel' && !selectedChannelId) {
      showToast('error', 'Vui lòng chọn Kênh thiết bị riêng lẻ!');
      return;
    }

    const targetPayload = getTargetPayload();
    const targetDesc = getTargetDescription();
    setIsSending(true);

    try {
      let res;
      let cmdName = '';
      let payloadDetail = '';

      if (activeCommandTab === 'change-model') {
        if (!modelName.trim()) {
          showToast('error', 'Vui lòng nhập tên Model mới!');
          setIsSending(false);
          return;
        }
        cmdName = 'model.change';
        payloadDetail = `Model: ${modelName.trim()}`;
        res = await CommandApi.changeModel({
          ...targetPayload,
          modelName: modelName.trim(),
        });
      } else if (activeCommandTab === 'restart') {
        cmdName = 'app.restart';
        payloadDetail = `Delay: ${delayMs}ms`;
        res = await CommandApi.restartApp({
          ...targetPayload,
          delayMs: parseInt(delayMs, 10) || 1500,
        });
      } else if (activeCommandTab === 'custom') {
        if (!customCommand.trim()) {
          showToast('error', 'Vui lòng nhập lệnh tùy chỉnh!');
          setIsSending(false);
          return;
        }
        let parsedData = null;
        if (customJsonData.trim()) {
          try {
            parsedData = JSON.parse(customJsonData);
          } catch (e) {
            showToast('error', 'Cấu trúc JSON dữ liệu không hợp lệ!');
            setIsSending(false);
            return;
          }
        }
        cmdName = customCommand.trim();
        payloadDetail = customJsonData.trim() ? 'JSON Data attached' : 'No payload';
        res = await CommandApi.sendCommand({
          ...targetPayload,
          command: cmdName,
          data: parsedData,
        });
      }

      showToast('success', `Đã phát lệnh '${cmdName}' thành công đến ${targetDesc}!`);

      // Add entry to execution history console
      setCommandHistory((prev) => [
        {
          id: `cmd-${Date.now().toString().slice(-6)}`,
          command: cmdName,
          detail: payloadDetail,
          targetText: targetDesc,
          timestamp: new Date().toLocaleTimeString(),
          status: 'success',
          response: res?.message || 'Lệnh đã gửi thành công qua SignalR CommandHub.',
        },
        ...prev,
      ]);
    } catch (err) {
      console.error('Failed to send command:', err);
      const errMessage = err.response?.data?.error || err.message || 'Không thể kết nối đến máy chủ.';
      showToast('error', `Lỗi khi phát lệnh: ${errMessage}`);

      setCommandHistory((prev) => [
        {
          id: `cmd-${Date.now().toString().slice(-6)}`,
          command: activeCommandTab,
          targetText: targetDesc,
          timestamp: new Date().toLocaleTimeString(),
          status: 'error',
          response: `Thất bại: ${errMessage}`,
        },
        ...prev,
      ]);
    } finally {
      setIsSending(false);
    }
  };

  // Build Tree Data Hierarchy (Root -> Line -> Station -> Channel)
  const treeData = useMemo(() => {
    const lineNodes = lines.map((line) => {
      const lineStations = stations.filter((s) => String(s.lineId) === String(line.id));
      const lineChannels = channels.filter((c) => String(c.lineId) === String(line.id));

      const stationNodes = lineStations.map((station) => {
        const stationChannels = channels.filter((c) => String(c.stationId) === String(station.id));

        const channelNodes = stationChannels.map((ch) => ({
          id: `channel-${ch.id}`,
          type: 'channel',
          lineId: line.id,
          stationId: station.id,
          channelId: ch.id,
          label: `Channel #${ch.channelNo || ch.id} (${ch.channelName || 'Kênh'})`,
          sublabel: ch.macAddress || ch.ipAddress || 'MAC-N/A',
          macAddress: ch.macAddress,
          children: [],
        }));

        return {
          id: `station-${station.id}`,
          type: 'station',
          lineId: line.id,
          stationId: station.id,
          label: station.name,
          sublabel: `${channelNodes.length} kênh`,
          children: channelNodes,
        };
      });

      return {
        id: `line-${line.id}`,
        type: 'line',
        lineId: line.id,
        label: `${line.name} ${line.buyerName ? `(${line.buyerName})` : ''}`,
        sublabel: `${lineChannels.length} kênh / ${stationNodes.length} trạm`,
        children: stationNodes,
      };
    });

    return {
      id: 'root-all',
      type: 'all',
      label: 'Tất Cả Các Máy (Broadcast All)',
      sublabel: `${channels.length} thiết bị`,
      children: lineNodes,
    };
  }, [lines, stations, channels]);

  // Check if a node is currently selected
  const isNodeSelected = (node) => {
    if (node.type === 'all') return targetMode === 'all';
    if (node.type === 'line') return targetMode === 'line' && String(selectedLineId) === String(node.lineId);
    if (node.type === 'station') return targetMode === 'station' && String(selectedStationId) === String(node.stationId);
    if (node.type === 'channel') return targetMode === 'channel' && String(selectedChannelId) === String(node.channelId);
    return false;
  };

  // Helper: Search filter matching
  const nodeMatchesSearch = (node, query) => {
    if (!query) return true;
    const q = query.toLowerCase();
    if (node.label?.toLowerCase().includes(q)) return true;
    if (node.sublabel?.toLowerCase().includes(q)) return true;
    if (node.macAddress?.toLowerCase().includes(q)) return true;
    if (node.children && node.children.some((c) => nodeMatchesSearch(c, q))) return true;
    return false;
  };

  // Recursive Tree Node Renderer
  const renderTreeNode = (node, depth = 0) => {
    if (!nodeMatchesSearch(node, treeSearch)) return null;

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes[node.id] || treeSearch.trim().length > 0;
    const selected = isNodeSelected(node);

    let IconComponent = Globe;
    let badgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/20';

    if (node.type === 'line') {
      IconComponent = Layers;
      badgeColor = 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    } else if (node.type === 'station') {
      IconComponent = Server;
      badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    } else if (node.type === 'channel') {
      IconComponent = Cpu;
      badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }

    return (
      <div key={node.id} className="select-none">
        <div
          onClick={() => handleSelectTreeNode(node)}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          className={`flex items-center justify-between py-2 px-2.5 my-0.5 rounded-lg text-xs cursor-pointer transition-all ${
            selected
              ? 'bg-gradient-to-r from-amber-500/20 to-orange-600/10 border border-amber-500/50 text-white font-medium shadow-sm'
              : 'hover:bg-slate-800/60 text-slate-300 hover:text-slate-100 border border-transparent'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleExpandNode(node.id, e)}
                className="w-4 h-4 rounded hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-4 h-4 flex-shrink-0"></span>
            )}

            <IconComponent className={`w-4 h-4 flex-shrink-0 ${selected ? 'text-amber-400' : 'text-slate-400'}`} />
            
            <div className="truncate min-w-0">
              <span className="truncate">{node.label}</span>
              {node.sublabel && (
                <span className="text-[10px] text-slate-500 ml-2 font-mono truncate">
                  [{node.sublabel}]
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border ${badgeColor}`}>
              {node.type}
            </span>
            {selected && <Check className="w-4 h-4 text-amber-400" />}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="border-l border-white/5 ml-3">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification Banner */}
      {notification && (
        <div
          className={`fixed bottom-6 right-6 z-50 p-4 rounded-xl shadow-2xl backdrop-blur-xl border flex items-center gap-3 transition-all animate-bounce ${
            notification.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          )}
          <span className="text-sm font-medium">{notification.text}</span>
        </div>
      )}

      {/* Page Title & Action Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-card p-6 rounded-2xl border border-white/10 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 via-orange-600 to-red-600 p-0.5 shadow-lg shadow-amber-500/20 flex items-center justify-center">
            <div className="w-full h-full bg-slate-950/80 rounded-[10px] flex items-center justify-center backdrop-blur-md">
              <Terminal className="w-6 h-6 text-amber-400 animate-pulse" />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              Điều Khiển & Lệnh Hệ Thống
              <span className="badge badge-warning text-[10px] uppercase font-mono px-2 py-0.5">
                Command Center
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Gửi lệnh từ xa (Đổi Model, Khởi Động Lại, Custom Command) đến thiết bị thu thập log SMT qua SignalR Realtime.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onRefreshMasterData}
            className="btn btn-secondary text-xs flex items-center gap-2 py-2 px-3.5"
            title="Làm mới thông tin Master Data & Channels"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span>Làm mới danh sách máy</span>
          </button>
        </div>
      </div>

      {/* Grid Section: Targeting Scope & Command Payload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (5 Cols): Scope / Target Selection */}
        <div className="lg:col-span-5 space-y-6">
          <div className="glass-card p-6 rounded-2xl border border-white/10 relative">
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                1. Chọn Phạm Vi Nhận Lệnh
              </h2>
              <span className="text-[11px] text-slate-400 font-mono">
                {targetedChannels.length} thiết bị phù hợp
              </span>
            </div>

            {/* Target Mode Quick Tabs */}
            <div className="grid grid-cols-4 gap-1.5 mb-4 p-1 bg-slate-900/60 rounded-xl border border-white/5">
              <button
                type="button"
                onClick={() => handleSelectTreeNode({ type: 'all' })}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  targetMode === 'all'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Tất cả</span>
              </button>
              <button
                type="button"
                onClick={() => setTargetMode('line')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  targetMode === 'line'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Line</span>
              </button>
              <button
                type="button"
                onClick={() => setTargetMode('station')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  targetMode === 'station'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>Station</span>
              </button>
              <button
                type="button"
                onClick={() => setTargetMode('channel')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  targetMode === 'channel'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Channel</span>
              </button>
            </div>

            {/* TreeView Combobox Selector */}
            <div className="relative" ref={treeDropdownRef}>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Cây Cấu Trúc Máy (Line → Station → Channel)
              </label>

              {/* Trigger Input Bar */}
              <div
                onClick={() => setIsTreeOpen(!isTreeOpen)}
                className="w-full bg-slate-900/80 border border-white/10 hover:border-amber-500/50 rounded-xl px-3.5 py-2.5 flex items-center justify-between cursor-pointer transition-all shadow-inner"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderTree className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-xs text-slate-200 font-medium truncate">
                    {getSelectedNodeLabel()}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-mono uppercase bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20">
                    {targetMode}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isTreeOpen ? 'rotate-180 text-amber-400' : ''}`} />
                </div>
              </div>

              {/* TreeView Dropdown Menu */}
              {isTreeOpen && (
                <div className="absolute z-40 top-full left-0 right-0 mt-2 bg-slate-950/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl p-3 max-h-96 flex flex-col space-y-2">
                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={treeSearch}
                      onChange={(e) => setTreeSearch(e.target.value)}
                      placeholder="Tìm Line, Station, Channel hoặc MAC..."
                      className="w-full bg-slate-900/90 border border-white/10 focus:border-amber-500 text-xs text-slate-200 pl-8 pr-8 py-2 rounded-xl focus:outline-none"
                    />
                    {treeSearch && (
                      <button
                        type="button"
                        onClick={() => setTreeSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Expand / Collapse Actions */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 py-0.5 border-b border-white/5">
                    <span>Cấu trúc phân cấp</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const allExpanded = {};
                          allExpanded['root-all'] = true;
                          lines.forEach(l => {
                            allExpanded[`line-${l.id}`] = true;
                            stations.filter(s => String(s.lineId) === String(l.id)).forEach(st => {
                              allExpanded[`station-${st.id}`] = true;
                            });
                          });
                          setExpandedNodes(allExpanded);
                        }}
                        className="hover:text-amber-400 transition-colors"
                      >
                        Mở tất cả
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => setExpandedNodes({ 'root-all': true })}
                        className="hover:text-amber-400 transition-colors"
                      >
                        Thu gọn
                      </button>
                    </div>
                  </div>

                  {/* Scrollable Tree Container */}
                  <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-0.5">
                    {renderTreeNode(treeData)}
                  </div>
                </div>
              )}
            </div>

            {/* Target Description Summary */}
            <div className="mt-4 p-3 bg-slate-900/50 border border-white/5 rounded-xl flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Phạm vi đã chọn:</span>
              <span className="text-amber-300 font-semibold">{getTargetDescription()}</span>
            </div>

            {/* Broadcast Alert when Target Mode is 'all' */}
            {targetMode === 'all' && (
              <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Chế độ Broadcast Toàn Mạng</span>
                  Lệnh sẽ được gửi tới tất cả <strong className="text-white">{channels.length} máy collector</strong> hiện đang hoạt động trên hệ thống.
                </div>
              </div>
            )}

            {/* Targeted Channels Preview */}
            <div className="mt-5">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                <span>Danh Sách Máy Sẽ Nhận Lệnh ({targetedChannels.length})</span>
                <span className="text-slate-500 font-mono text-[10px]">
                  {targetedChannels.filter((c) => c.status === 'Active' || c.macAddress).length} Sẵn Sàng
                </span>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                {targetedChannels.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-white/5 rounded-xl">
                    Chưa có thiết bị nào phù hợp với phạm vi đã chọn.
                  </div>
                ) : (
                  targetedChannels.map((c) => (
                    <div
                      key={c.id}
                      className="p-2.5 bg-slate-900/40 border border-white/5 rounded-lg flex items-center justify-between text-xs hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"></div>
                        <div className="truncate">
                          <span className="font-semibold text-slate-200">
                            Channel #{c.channelNo || c.id}
                          </span>
                          <span className="text-[11px] text-slate-400 ml-2 truncate">
                            {c.stationName || 'Station'} ({c.lineName || 'Line'})
                          </span>
                        </div>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400 bg-slate-950/60 px-2 py-0.5 rounded border border-white/5 flex-shrink-0">
                        {c.macAddress || c.ipAddress || 'MAC-N/A'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (7 Cols): Command Form & Execution Console */}
        <div className="lg:col-span-7 space-y-6">
          <div className="glass-card p-6 rounded-2xl border border-white/10">
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                2. Soạn Lệnh & Nội Dung Lệnh
              </h2>
              <div className="text-xs text-amber-400 font-mono flex items-center gap-1.5 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                {getTargetDescription()}
              </div>
            </div>

            {/* Action Command Tabs */}
            <div className="flex border-b border-white/10 mb-5 gap-4">
              <button
                onClick={() => setActiveCommandTab('change-model')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'change-model'
                    ? 'text-amber-400 border-b-2 border-amber-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Đổi Model Sản Xuất</span>
              </button>

              <button
                onClick={() => setActiveCommandTab('restart')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'restart'
                    ? 'text-amber-400 border-b-2 border-amber-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Khởi Động Lại App</span>
              </button>

              <button
                onClick={() => setActiveCommandTab('custom')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'custom'
                    ? 'text-amber-400 border-b-2 border-amber-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Lệnh Tùy Chỉnh (JSON)</span>
              </button>
            </div>

            {/* Form Content per Tab */}
            <div className="space-y-4">
              {/* TAB 1: CHANGE MODEL */}
              {activeCommandTab === 'change-model' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Tên Model Mới (New Model Name) <span className="text-amber-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                      placeholder="Nhập tên Model (VD: MODEL_A_REV2, IPHONE_16_PRO...)"
                      className="input-field text-sm w-full font-mono"
                    />
                  </div>

                  {/* Model Quick Chips */}
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1.5">Gợi ý Model phổ biến:</div>
                    <div className="flex flex-wrap gap-2">
                      {modelPresets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setModelName(preset)}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/10 text-xs font-mono text-slate-300 hover:border-amber-500/50 hover:text-amber-300 transition-colors"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-900/60 rounded-xl border border-white/5 text-xs text-slate-400 space-y-1">
                    <p className="flex items-center gap-1.5 text-slate-300 font-semibold">
                      <Info className="w-3.5 h-3.5 text-blue-400" />
                      Ghi chú thao tác Đổi Model:
                    </p>
                    <p>
                      Khi gửi lệnh này, ứng dụng Backup Log client sẽ ngay lập tức chuyển đổi cấu hình model hiện tại sang model mới để đồng bộ hóa quy tắc ghi log.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 2: RESTART APP */}
              {activeCommandTab === 'restart' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Thời Gian Chờ Khởi Động Lại (Delay in milliseconds)
                    </label>
                    <input
                      type="number"
                      value={delayMs}
                      onChange={(e) => setDelayMs(e.target.value)}
                      placeholder="1500"
                      className="input-field text-sm w-full font-mono"
                    />
                  </div>

                  <div className="flex gap-2">
                    {[1000, 1500, 3000, 5000].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDelayMs(d)}
                        className={`px-3 py-1 rounded-lg text-xs font-mono border transition-colors ${
                          Number(delayMs) === d
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                            : 'bg-slate-900 border-white/10 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {d}ms ({d / 1000}s)
                      </button>
                    ))}
                  </div>

                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200 space-y-1">
                    <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                      <ShieldAlert className="w-4 h-4 text-amber-400" />
                      Cảnh báo thực thi:
                    </p>
                    <p>
                      Lệnh này sẽ ra lệnh cho tiến trình Backup Log trên các máy collector tự đóng và khởi động lại. SignalR connection sẽ tạm ngắt trong giây lát.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 3: CUSTOM JSON COMMAND */}
              {activeCommandTab === 'custom' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Tên Lệnh (Command Action String) <span className="text-amber-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={customCommand}
                      onChange={(e) => setCustomCommand(e.target.value)}
                      placeholder="Ví dụ: sync.config, files.cleanup, system.ping..."
                      className="input-field text-sm w-full font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Dữ Liệu JSON (Payload Data - JSON format)
                    </label>
                    <textarea
                      rows={5}
                      value={customJsonData}
                      onChange={(e) => setCustomJsonData(e.target.value)}
                      className="input-field text-xs w-full font-mono custom-scrollbar"
                      placeholder="{\n  'param': 'value'\n}"
                    />
                  </div>
                </div>
              )}

              {/* Execute Action Button */}
              <div className="pt-2">
                <button
                  onClick={handleExecuteCommand}
                  disabled={isSending || targetedChannels.length === 0}
                  className="btn btn-primary w-full py-3 text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
                >
                  {isSending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang phát lệnh qua SignalR...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Phát Lệnh Ngay ({targetedChannels.length} máy)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Real-time Command Execution Log Console */}
          <div className="glass-card p-6 rounded-2xl border border-white/10">
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                3. Nhật Ký Phát Lệnh (Command Console Log)
              </h2>
              <button
                onClick={() => setCommandHistory([])}
                className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
                title="Xóa nhật ký"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Log</span>
              </button>
            </div>

            <div className="bg-slate-950 rounded-xl p-4 border border-white/10 font-mono text-xs max-h-60 overflow-y-auto space-y-2.5 custom-scrollbar">
              {commandHistory.length === 0 ? (
                <div className="text-slate-600 text-center py-4 italic">
                  Chưa có lịch sử phát lệnh nào trong phiên làm việc này.
                </div>
              ) : (
                commandHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-lg bg-slate-900/80 border border-white/5 flex flex-col gap-1 text-[11px]"
                  >
                    <div className="flex items-center justify-between text-slate-400 border-b border-white/5 pb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 font-bold">{item.command}</span>
                        <span className="text-slate-500">[{item.id}]</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">{item.timestamp}</span>
                        {item.status === 'success' ? (
                          <span className="badge badge-ok text-[10px]">SUCCESS</span>
                        ) : (
                          <span className="badge badge-ng text-[10px]">FAILED</span>
                        )}
                      </div>
                    </div>
                    <div className="text-slate-300 mt-0.5">
                      <span className="text-slate-500">Target: </span>
                      <span className="text-cyan-300 font-semibold">{item.targetText}</span>
                    </div>
                    {item.detail && (
                      <div className="text-slate-400">
                        <span className="text-slate-500">Payload: </span>
                        <span className="text-slate-300">{item.detail}</span>
                      </div>
                    )}
                    <div className="text-slate-400 italic bg-slate-950/60 p-1.5 rounded mt-0.5 border border-white/5">
                      {item.response}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
