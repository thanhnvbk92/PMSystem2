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
  FolderTree,
  Search,
  Check,
  X,
  CheckSquare,
  Square,
  MinusSquare,
  CheckCheck,
  XSquare
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

  // Checked Node IDs State (Default: 'root-all' checked)
  const [checkedNodeIds, setCheckedNodeIds] = useState({ 'root-all': true });

  // Execution status map per node (e.g. 'channel-12': { status: 'success' | 'error' | 'sending', timestamp: string, message: string })
  const [executionStatuses, setExecutionStatuses] = useState({});

  // Get all descendant IDs of a node
  const getDescendantNodeIds = (node) => {
    if (!node) return [];
    let ids = [node.id];
    if (node.children && node.children.length > 0) {
      node.children.forEach((child) => {
        ids = ids.concat(getDescendantNodeIds(child));
      });
    }
    return ids;
  };

  // Get leaf channel nodes under a node
  const getLeafChannelNodes = (node) => {
    if (!node) return [];
    if (node.type === 'channel') return [node];
    let list = [];
    if (node.children) {
      node.children.forEach((c) => {
        list = list.concat(getLeafChannelNodes(c));
      });
    }
    return list;
  };

  // Determine node check status ('checked' | 'indeterminate' | 'unchecked')
  const getNodeCheckStatus = (node) => {
    if (!node) return 'unchecked';
    if (checkedNodeIds['root-all']) return 'checked';
    if (checkedNodeIds[node.id]) return 'checked';

    if (node.children && node.children.length > 0) {
      const leafChannels = getLeafChannelNodes(node);
      if (leafChannels.length === 0) return 'unchecked';

      const checkedCount = leafChannels.filter(
        (c) =>
          checkedNodeIds[c.id] ||
          checkedNodeIds[`line-${c.lineId}`] ||
          checkedNodeIds[`station-${c.stationId}`] ||
          checkedNodeIds['root-all']
      ).length;

      if (checkedCount === leafChannels.length) return 'checked';
      if (checkedCount > 0) return 'indeterminate';
    }

    return 'unchecked';
  };

  // Toggle check/uncheck for a node and its children
  const handleToggleNodeCheck = (node, e) => {
    if (e) e.stopPropagation();

    const currentStatus = getNodeCheckStatus(node);
    const descendantIds = getDescendantNodeIds(node);

    setCheckedNodeIds((prev) => {
      const next = { ...prev };

      if (currentStatus === 'checked') {
        descendantIds.forEach((id) => { delete next[id]; });
        delete next['root-all'];
        if (node.lineId) delete next[`line-${node.lineId}`];
        if (node.stationId) delete next[`station-${node.stationId}`];
      } else {
        descendantIds.forEach((id) => { next[id] = true; });
        if (node.type === 'all') next['root-all'] = true;

        const safeChannels = channels || [];
        const allChecked = safeChannels.length > 0 && safeChannels.every(
          (c) => next[`channel-${c.id}`] || next[`station-${c.stationId}`] || next[`line-${c.lineId}`]
        );
        if (allChecked) {
          next['root-all'] = true;
        }
      }

      return next;
    });
  };

  // Quick Action Toolbar Handlers
  const handleCheckAll = () => {
    const allIds = getDescendantNodeIds(treeData);
    const next = {};
    allIds.forEach((id) => { next[id] = true; });
    setCheckedNodeIds(next);
    setTargetMode('all');
  };

  const handleUncheckAll = () => {
    setCheckedNodeIds({});
    setTargetMode('all');
    setSelectedLineId('');
    setSelectedStationId('');
    setSelectedChannelId('');
  };

  const handleExpandAll = () => {
    const safeLines = lines || [];
    const safeStations = stations || [];
    const allExpanded = { 'root-all': true };
    safeLines.forEach((l) => {
      allExpanded[`line-${l.id}`] = true;
      safeStations
        .filter((s) => String(s.lineId) === String(l.id))
        .forEach((st) => {
          allExpanded[`station-${st.id}`] = true;
        });
    });
    setExpandedNodes(allExpanded);
  };

  const handleCollapseAll = () => {
    setExpandedNodes({ 'root-all': true });
  };

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

  // Calculate Targeted Channels based on checkedNodeIds or targetMode
  const targetedChannels = useMemo(() => {
    if (checkedNodeIds['root-all']) return channels || [];
    const safeChannels = channels || [];
    return safeChannels.filter((c) => {
      return (
        checkedNodeIds[`channel-${c.id}`] ||
        checkedNodeIds[`station-${c.stationId}`] ||
        checkedNodeIds[`line-${c.lineId}`] ||
        checkedNodeIds['root-all']
      );
    });
  }, [channels, checkedNodeIds]);

  // Get Target Payload Parameters for API
  const getTargetPayload = () => {
    if (checkedNodeIds['root-all']) return {};
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
    if (checkedNodeIds['root-all']) return '🌐 Tất cả thiết bị (Broadcast All)';
    const count = targetedChannels.length;
    if (count === 0) return '❌ Chưa chọn thiết bị nào';

    if (count === (channels || []).length && count > 0) {
      return '🌐 Tất cả thiết bị (Broadcast All)';
    }

    if (count === 1) {
      const chObj = targetedChannels[0];
      return `🔌 Kênh #${chObj.channelNo || chObj.id} (${chObj.channelName || chObj.macAddress || 'Channel'})`;
    }

    return `🎯 Đã tích chọn ${count} thiết bị (${count} channels)`;
  };

  // Helper: Get Trigger Bar Selected Node Label
  const getSelectedNodeLabel = () => {
    if (checkedNodeIds['root-all']) return 'Tất Cả Các Máy (Broadcast All)';
    const count = targetedChannels.length;
    if (count === 0) return 'Chưa chọn thiết bị nào (Nhấp vào đây để chọn...)';
    
    if (count === (channels || []).length && count > 0) {
      return 'Tất Cả Các Máy (Broadcast All)';
    }

    if (count === 1) {
      const ch = targetedChannels[0];
      return `Kênh #${ch.channelNo || ch.id} (${ch.channelName || ch.macAddress || 'Kênh'})`;
    }

    return `Đã tích chọn ${count} thiết bị (${count} kênh)`;
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
    const targeted = targetedChannels || [];
    const nowTime = new Date().toLocaleTimeString();

    // Mark targeted channels as sending in tree view
    setExecutionStatuses((prev) => {
      const next = { ...prev };
      targeted.forEach((c) => {
        next[`channel-${c.id}`] = {
          status: 'sending',
          timestamp: nowTime,
          message: 'Đang gửi lệnh...',
        };
      });
      return next;
    });

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

      // Mark targeted channels as success
      setExecutionStatuses((prev) => {
        const next = { ...prev };
        targeted.forEach((c) => {
          next[`channel-${c.id}`] = {
            status: 'success',
            timestamp: nowTime,
            message: res?.message || 'Đã nhận lệnh thành công',
          };
        });
        return next;
      });

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

      // Mark targeted channels as error
      setExecutionStatuses((prev) => {
        const next = { ...prev };
        targeted.forEach((c) => {
          next[`channel-${c.id}`] = {
            status: 'error',
            timestamp: nowTime,
            message: errMessage,
          };
        });
        return next;
      });

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
    const safeLines = lines || [];
    const safeStations = stations || [];
    const safeChannels = channels || [];

    const buildLineNode = (line) => {
      const lineStations = safeStations.filter((s) => String(s.lineId) === String(line.id));
      const lineChannels = safeChannels.filter((c) => String(c.lineId) === String(line.id));

      const stationNodes = lineStations.map((station) => {
        const stationChannels = safeChannels.filter((c) => String(c.stationId) === String(station.id));

        const channelNodes = stationChannels.map((ch) => {
          const name = ch.channelName || ch.name || `Kênh #${ch.channelNo || ch.id}`;
          const ip = ch.ipAddress || ch.ip;
          const ipText = ip ? `IP: ${ip}` : (ch.macAddress ? `MAC: ${ch.macAddress}` : 'IP: N/A');

          return {
            id: `channel-${ch.id}`,
            type: 'channel',
            lineId: line.id,
            stationId: station.id,
            channelId: ch.id,
            label: name,
            sublabel: ipText,
            macAddress: ch.macAddress,
            ipAddress: ip,
            isOnline: ch.status === 'Active' || ch.status === 'online' || ch.isOnline === true || Boolean(ch.macAddress),
            children: [],
          };
        });

        const onlineCount = channelNodes.filter((c) => c.isOnline).length;

        return {
          id: `station-${station.id}`,
          type: 'station',
          lineId: line.id,
          stationId: station.id,
          label: station.name,
          sublabel: `${channelNodes.length} kênh (${onlineCount} online)`,
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
    };

    // Root at selected Station if selected
    if (selectedStationId) {
      const targetStation = safeStations.find((s) => String(s.id) === String(selectedStationId));
      if (targetStation) {
        const lineId = targetStation.lineId;
        const stationChannels = safeChannels.filter((c) => String(c.stationId) === String(targetStation.id));
        const channelNodes = stationChannels.map((ch) => {
          const name = ch.channelName || ch.name || `Kênh #${ch.channelNo || ch.id}`;
          const ip = ch.ipAddress || ch.ip;
          const ipText = ip ? `IP: ${ip}` : (ch.macAddress ? `MAC: ${ch.macAddress}` : 'IP: N/A');

          return {
            id: `channel-${ch.id}`,
            type: 'channel',
            lineId: lineId,
            stationId: targetStation.id,
            channelId: ch.id,
            label: name,
            sublabel: ipText,
            macAddress: ch.macAddress,
            ipAddress: ip,
            isOnline: ch.status === 'Active' || ch.status === 'online' || ch.isOnline === true || Boolean(ch.macAddress),
            children: [],
          };
        });

        const onlineCount = channelNodes.filter((c) => c.isOnline).length;

        return {
          id: `station-${targetStation.id}`,
          type: 'station',
          lineId: lineId,
          stationId: targetStation.id,
          label: `Trạm: ${targetStation.name}`,
          sublabel: `${channelNodes.length} kênh (${onlineCount} online)`,
          children: channelNodes,
        };
      }
    }

    // Root at selected Line if selected
    if (selectedLineId) {
      const targetLine = safeLines.find((l) => String(l.id) === String(selectedLineId));
      if (targetLine) {
        return buildLineNode(targetLine);
      }
    }

    // Default: Full tree root
    const lineNodes = safeLines.map(buildLineNode);

    return {
      id: 'root-all',
      type: 'all',
      label: 'Tất Cả Các Máy (Broadcast All)',
      sublabel: `${safeChannels.length} thiết bị`,
      children: lineNodes,
    };
  }, [lines, stations, channels, selectedLineId, selectedStationId]);

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
    if (node.ipAddress?.toLowerCase().includes(q)) return true;
    if (node.children && node.children.some((c) => nodeMatchesSearch(c, q))) return true;
    return false;
  };

  // Recursive Tree Node Renderer
  const renderTreeNode = (node, depth = 0) => {
    if (!nodeMatchesSearch(node, treeSearch)) return null;

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes[node.id] || treeSearch.trim().length > 0;
    const checkStatus = getNodeCheckStatus(node);
    const selected = checkStatus === 'checked';
    const execStatus = executionStatuses[node.id];

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
          onClick={(e) => {
            handleToggleNodeCheck(node, e);
            handleSelectTreeNode(node);
          }}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          className={`flex items-center justify-between py-2 px-2.5 my-0.5 rounded-lg text-xs cursor-pointer transition-all ${
            checkStatus === 'checked'
              ? 'bg-amber-500/15 border border-amber-500/40 text-white font-medium shadow-sm'
              : checkStatus === 'indeterminate'
              ? 'bg-amber-500/5 border border-amber-500/20 text-amber-200'
              : 'hover:bg-slate-800/60 text-slate-300 hover:text-slate-100 border border-transparent'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleExpandNode(node.id, e)}
                className="w-4 h-4 rounded hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors flex-shrink-0"
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

            {/* Checkbox Icon Button */}
            <button
              type="button"
              onClick={(e) => handleToggleNodeCheck(node, e)}
              className="w-4 h-4 flex items-center justify-center flex-shrink-0 transition-transform active:scale-90"
              title={checkStatus === 'checked' ? 'Bỏ chọn' : 'Chọn nút này'}
            >
              {checkStatus === 'checked' ? (
                <CheckSquare className="w-4 h-4 text-amber-400 flex-shrink-0" />
              ) : checkStatus === 'indeterminate' ? (
                <MinusSquare className="w-4 h-4 text-amber-400/80 flex-shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-slate-500 hover:text-slate-300 flex-shrink-0" />
              )}
            </button>

            {/* Icon & Online Status Indicator for Channel */}
            <div className="relative flex items-center flex-shrink-0">
              <IconComponent className={`w-4 h-4 ${selected ? 'text-amber-400' : 'text-slate-400'}`} />
              {node.type === 'channel' && (
                <span
                  className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-slate-900 ${
                    node.isOnline
                      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse'
                      : 'bg-slate-600'
                  }`}
                  title={node.isOnline ? 'Thiết bị Online' : 'Thiết bị Offline'}
                />
              )}
            </div>

            <div className="truncate min-w-0 flex items-center gap-1.5">
              <span className="truncate">{node.label}</span>
              {node.sublabel && (
                <span className="text-[10px] text-slate-500 font-mono truncate">
                  [{node.sublabel}]
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            {/* Execution Result Status Badge */}
            {execStatus && (
              <>
                {execStatus.status === 'sending' && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded flex items-center gap-1 font-mono animate-pulse">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-400" />
                    Đang gửi
                  </span>
                )}
                {execStatus.status === 'success' && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded flex items-center gap-1 font-mono" title={execStatus.message}>
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                    Đã nhận ({execStatus.timestamp})
                  </span>
                )}
                {execStatus.status === 'error' && (
                  <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded flex items-center gap-1 font-mono" title={execStatus.message}>
                    <XCircle className="w-2.5 h-2.5 text-rose-400" />
                    Thất bại
                  </span>
                )}
              </>
            )}

            {/* Online/Offline Badge for Channel */}
            {node.type === 'channel' && !execStatus && (
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase ${
                  node.isOnline
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-slate-800 text-slate-500 border-slate-700'
                }`}
              >
                {node.isOnline ? 'Online' : 'Offline'}
              </span>
            )}

            {/* Node Type Badge */}
            {node.type !== 'channel' && (
              <span className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border ${badgeColor}`}>
                {node.type}
              </span>
            )}

            {selected && <Check className="w-3.5 h-3.5 text-amber-400" />}
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

      {/* Grid Section: Targeting Scope & Command Payload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (5 Cols): Scope / Target Selection with Embedded TreeView */}
        <div className="lg:col-span-5 space-y-6">
          <div className="glass-card p-5 rounded-2xl border border-white/10 relative flex flex-col">
            <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2.5">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                1. Chọn Phạm Vi Nhận Lệnh (TreeView)
              </h2>
              <span className="text-[11px] text-slate-400 font-mono">
                {targetedChannels.length} / {channels.length} máy đã chọn
              </span>
            </div>

            {/* Combobox Selectors for Line and Station */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  Chọn Line
                </label>
                <select
                  value={selectedLineId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedLineId(val);
                    setSelectedStationId('');
                    setSelectedChannelId('');
                    if (val) {
                      setTargetMode('line');
                      setCheckedNodeIds({ [`line-${val}`]: true });
                    } else {
                      setTargetMode('all');
                      setCheckedNodeIds({ 'root-all': true });
                    }
                  }}
                  className="w-full bg-slate-900/90 border border-white/10 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none transition-all"
                >
                  <option value="">-- Tất cả Line (Broadcast All) --</option>
                  {(lines || []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} {l.buyerName ? `(${l.buyerName})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-amber-400" />
                  Chọn Station
                </label>
                <select
                  value={selectedStationId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedStationId(val);
                    setSelectedChannelId('');
                    if (val) {
                      setTargetMode('station');
                      setCheckedNodeIds({ [`station-${val}`]: true });
                      const st = (stations || []).find((s) => String(s.id) === String(val));
                      if (st) setSelectedLineId(String(st.lineId));
                    } else if (selectedLineId) {
                      setTargetMode('line');
                      setCheckedNodeIds({ [`line-${selectedLineId}`]: true });
                    } else {
                      setTargetMode('all');
                      setCheckedNodeIds({ 'root-all': true });
                    }
                  }}
                  className="w-full bg-slate-900/90 border border-white/10 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none transition-all"
                >
                  <option value="">-- Tất cả Station --</option>
                  {filteredStations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Permanent Inline TreeView Container */}
            <div className="bg-slate-950/80 border border-white/10 rounded-xl p-3 flex flex-col space-y-2">
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

              {/* Expand / Collapse & Check / Uncheck Actions Toolbar */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 py-1.5 border-b border-white/5 bg-slate-900/40 rounded-lg">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCheckAll}
                    className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>Chọn tất cả</span>
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={handleUncheckAll}
                    className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                  >
                    <XSquare className="w-3.5 h-3.5 text-rose-400" />
                    <span>Bỏ chọn</span>
                  </button>
                </div>
                <div className="flex gap-2 font-medium">
                  <button
                    type="button"
                    onClick={handleExpandAll}
                    className="hover:text-amber-400 transition-colors"
                  >
                    Mở rộng
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={handleCollapseAll}
                    className="hover:text-amber-400 transition-colors"
                  >
                    Thu gọn
                  </button>
                </div>
              </div>

              {/* Extended Tall Scrollable Tree Container */}
              <div className="h-[520px] overflow-y-auto pr-1 custom-scrollbar space-y-0.5 pt-1">
                {renderTreeNode(treeData)}
              </div>
            </div>

            {/* Target Description Summary */}
            <div className="mt-3 p-3 bg-slate-900/50 border border-white/5 rounded-xl flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Phạm vi đã chọn:</span>
              <span className="text-amber-300 font-semibold">{getTargetDescription()}</span>
            </div>

            {/* Broadcast Alert when Target Mode is 'all' */}
            {targetMode === 'all' && (
              <div className="mt-2.5 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Chế độ Broadcast Toàn Mạng</span>
                  Lệnh sẽ được phát tới tất cả <strong className="text-white">{channels.length} máy collector</strong> hiện có trong cây thiết bị.
                </div>
              </div>
            )}
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
