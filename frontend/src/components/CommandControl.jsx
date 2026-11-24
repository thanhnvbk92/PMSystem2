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
import { onCommandStatus, onMachineStatusChanged, onMachineAlert } from '../services/signalr';

// The console keeps the latest entries only (the page stays open for days).
const MAX_HISTORY = 200;
// Master data is reloaded at most this often when PCs go online / offline.
const MASTER_REFRESH_MS = 30000;
const macKeyOf = (mac) => (mac || '').replace(/[^0-9a-z]/gi, '').toUpperCase();

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

  // Active Command Tab: 'change-model' | 'update' | 'restart' | 'time-sync' | 'custom' | 'cmd-exec'
  const [activeCommandTab, setActiveCommandTab] = useState('change-model');

  // Command Form State
  const [modelName, setModelName] = useState('');
  const [updateForce, setUpdateForce] = useState(true);
  const [updateXmlPath, setUpdateXmlPath] = useState('');
  const [delayMs, setDelayMs] = useState(1500);
  const [customCommand, setCustomCommand] = useState('sync.config');
  const [customJsonData, setCustomJsonData] = useState('{\n  "version": "1.0",\n  "force_update": true\n}');

  // CMD System Command State
  const [cmdCommandLine, setCmdCommandLine] = useState('ipconfig /all');
  const [cmdTimeoutSec, setCmdTimeoutSec] = useState(30);
  const [cmdRunAsAdmin, setCmdRunAsAdmin] = useState(true);
  const [cmdShowWindow, setCmdShowWindow] = useState(true);

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

  // Latest props for the SignalR handlers, which are subscribed once.
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const refreshMasterDataRef = useRef(onRefreshMasterData);
  refreshMasterDataRef.current = onRefreshMasterData;

  // Real-time SignalR Event Listeners for Command Reports & Telemetry
  useEffect(() => {
    // Every PC sends telemetry each minute (hundreds of events per minute). Reloading the whole
    // master data on each of them made this page grow until the browser ran out of memory: reload
    // only when a PC goes online / offline, at most every MASTER_REFRESH_MS, and not while hidden.
    const onlineByMac = new Map();
    let refreshTimer = null;
    let lastRefresh = 0;
    let pending = false;
    const runRefresh = () => {
      refreshTimer = null;
      if (document.hidden) { pending = true; return; }
      pending = false;
      lastRefresh = Date.now();
      refreshMasterDataRef.current?.();
    };
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(runRefresh, Math.max(0, MASTER_REFRESH_MS - (Date.now() - lastRefresh)));
    };
    const onVisible = () => { if (!document.hidden && pending) scheduleRefresh(); };
    document.addEventListener('visibilitychange', onVisible);

    const unsubCommandStatus = onCommandStatus((report) => {
      const channels = channelsRef.current;
      console.log('Realtime CommandStatus report received:', report);
      if (!report) return;

      const { command_id, status, progress, result, error, message, mac_address, channel_id } = report;
      const nowTime = new Date().toLocaleTimeString();

      // Find affected channel in state
      let matchedChannel = null;
      if (channel_id) {
        matchedChannel = (channels || []).find((c) => String(c.id) === String(channel_id));
      } else if (mac_address) {
        matchedChannel = (channels || []).find(
          (c) => c.macAddress && c.macAddress.toLowerCase() === mac_address.toLowerCase()
        );
      }

      const channelKey = matchedChannel ? `channel-${matchedChannel.id}` : null;
      const channelLabel = matchedChannel
        ? `Kênh #${matchedChannel.channelNo || matchedChannel.id} (${matchedChannel.macAddress || 'Device'})`
        : mac_address || (channel_id ? `Channel #${channel_id}` : 'Thiết bị');

      const isSuccess = status === 'success' || status === 'completed' || status === 'OK';
      const isRunning = status === 'running' || status === 'pending';
      const statusState = isRunning ? 'sending' : isSuccess ? 'success' : 'error';

      const displayMsg =
        message ||
        error ||
        (result ? (typeof result === 'object' ? JSON.stringify(result) : String(result)) : null) ||
        (isSuccess ? 'Thực thi lệnh thành công' : isRunning ? 'Đang thực thi lệnh...' : 'Lỗi thực thi lệnh');

      // Update treeview channel execution status
      if (channelKey) {
        setExecutionStatuses((prev) => ({
          ...prev,
          [channelKey]: {
            status: statusState,
            timestamp: nowTime,
            message: `${displayMsg} ${progress !== undefined && progress > 0 ? `(${progress}%)` : ''}`,
            progress: progress || 0,
          },
        }));
      }

      // Update or append log entry in Execution Console History
      setCommandHistory((prev) => {
        const existingIdx = prev.findIndex(
          (h) => (command_id && h.commandId === command_id) || (h.channelId && channel_id && h.channelId === channel_id)
        );
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            status: statusState,
            progress: progress || updated[existingIdx].progress,
            response: `${displayMsg} ${progress !== undefined && progress > 0 ? `[${progress}%]` : ''}`,
            timestamp: nowTime,
          };
          return updated;
        }

        return [
          {
            id: `cmd-rt-${Date.now().toString().slice(-6)}`,
            commandId: command_id,
            channelId: channel_id,
            command: 'SignalR Status Report',
            detail: `Progress: ${progress || 0}%`,
            targetText: `🎯 ${channelLabel}`,
            timestamp: nowTime,
            status: statusState,
            progress: progress || 0,
            response: displayMsg,
          },
          ...prev,
        ].slice(0, MAX_HISTORY);
      });
    });

    const unsubAlert = onMachineAlert((alert) => {
      if (!alert) return;
      showToast('error', `⚠️ Cảnh báo thiết bị [${alert.mac_address || alert.channel_id}]: ${alert.alert_type || ''} - ${alert.message || ''}`);
    });

    const unsubStatusChanged = onMachineStatusChanged((payload) => {
      const machine = payload?.machine;
      const key = machine?.macKey || macKeyOf(payload?.legacy?.mac_address || payload?.mac_address);
      if (!key) return;
      const online = machine ? !!machine.isOnline : String(payload?.status || payload?.legacy?.status || '');
      if (onlineByMac.get(key) === online) return; // telemetry of a PC that stays online
      const known = onlineByMac.has(key);
      onlineByMac.set(key, online);
      if (known || online === false) scheduleRefresh();
    });

    return () => {
      unsubCommandStatus();
      unsubAlert();
      unsubStatusChanged();
      document.removeEventListener('visibilitychange', onVisible);
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, []);

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
      } else if (activeCommandTab === 'update') {
        cmdName = 'update';
        payloadDetail = updateXmlPath.trim()
          ? `Update XML: ${updateXmlPath.trim()}${updateForce ? ' (force)' : ''}`
          : `Update theo cấu hình mặc định${updateForce ? ' (force)' : ''}`;
        res = await CommandApi.updateApp({
          ...targetPayload,
          channelIds: targeted.map((channel) => channel.id),
          force: updateForce,
          updateXmlPath: updateXmlPath.trim() || null,
        });
      } else if (activeCommandTab === 'restart') {
        cmdName = 'app.restart';
        payloadDetail = `Delay: ${delayMs}ms`;
        res = await CommandApi.restartApp({
          ...targetPayload,
          delayMs: parseInt(delayMs, 10) || 1500,
        });
      } else if (activeCommandTab === 'time-sync') {
        cmdName = 'time.sync';
        payloadDetail = 'PC clock = server time (time zone unchanged)';
        res = await CommandApi.sendCommand({
          ...targetPayload,
          channelIds: targeted.map((channel) => channel.id),
          command: cmdName,
          data: null,
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
          channelIds: targeted.map((channel) => channel.id),
          command: cmdName,
          data: parsedData,
        });
      } else if (activeCommandTab === 'cmd-exec') {
        if (!cmdCommandLine.trim()) {
          showToast('error', 'Vui lòng nhập câu lệnh CMD!');
          setIsSending(false);
          return;
        }
        cmdName = 'system.cmd';
        payloadDetail = `CMD: ${cmdCommandLine.trim()}`;
        res = await CommandApi.sendCommand({
          ...targetPayload,
          channelIds: targeted.map((channel) => channel.id),
          command: 'system.cmd',
          data: {
            command_line: cmdCommandLine.trim(),
            timeout_seconds: parseInt(cmdTimeoutSec, 10) || 30,
            run_as_admin: cmdRunAsAdmin,
            show_window: cmdShowWindow,
          },
        });
      }

      showToast('success', `Đã chuyển lệnh '${cmdName}' đến backend cho ${targetDesc}. Đang chờ client xác nhận...`);

      const cmdId = res?.command_id;

      // Update targeted channels to dispatched state (awaiting client execution status)
      setExecutionStatuses((prev) => {
        const next = { ...prev };
        targeted.forEach((c) => {
          next[`channel-${c.id}`] = {
            status: 'sending',
            timestamp: nowTime,
            message: res?.message || 'Đã phát lệnh qua SignalR. Đang chờ máy thực thi...',
          };
        });
        return next;
      });

      // Add entry to execution history console
      setCommandHistory((prev) => {
        // A very fast client can report before the HTTP dispatch response returns.
        // Keep that real report instead of adding a duplicate PENDING entry.
        if (cmdId && prev.some((item) => item.commandId === cmdId)) return prev;
        return [
          {
            id: `cmd-${Date.now().toString().slice(-6)}`,
            commandId: cmdId,
            command: cmdName,
            detail: payloadDetail,
            targetText: targetDesc,
            timestamp: new Date().toLocaleTimeString(),
            status: 'sending',
            response: res?.message || 'Lệnh đã phát thành công. Đang chờ phản hồi tiến độ từ máy...',
          },
          ...prev,
        ].slice(0, MAX_HISTORY);
      });

      // A successful HTTP response only confirms dispatch. Mark it failed only
      // when no SignalR status report is received from the client within 30s.
      setTimeout(() => {
        setCommandHistory((prev) => prev.map((item) =>
          item.commandId === cmdId && item.status === 'sending'
            ? { ...item, status: 'error', response: 'Không nhận được phản hồi từ Backup Log client sau 30 giây.' }
            : item
        ));
        setExecutionStatuses((prev) => {
          const next = { ...prev };
          targeted.forEach((channel) => {
            const key = `channel-${channel.id}`;
            if (next[key]?.status === 'sending') {
              next[key] = {
                ...next[key],
                status: 'error',
                message: 'Không nhận được phản hồi từ Backup Log client sau 30 giây.',
              };
            }
          });
          return next;
        });
      }, 30000);
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
      ].slice(0, MAX_HISTORY));
    } finally {
      setIsSending(false);
    }
  };

  // Build Tree Data Hierarchy (Root -> Line -> Station -> Channel)
  const treeData = useMemo(() => {
    const safeLines = lines || [];
    const safeStations = stations || [];
    const safeChannels = channels || [];
    const getChannelSortName = (channel) =>
      channel.channelName || channel.name || `Kênh #${channel.channelNo || channel.id}`;
    const sortChannelsByName = (left, right) => {
      const byName = getChannelSortName(left).localeCompare(
        getChannelSortName(right),
        'vi',
        { numeric: true, sensitivity: 'base' }
      );
      return byName || Number(left.id || 0) - Number(right.id || 0);
    };

    const buildLineNode = (line) => {
      const lineStations = safeStations.filter((s) => String(s.lineId) === String(line.id));
      const lineChannels = safeChannels.filter((c) => String(c.lineId) === String(line.id));

      const stationNodes = lineStations.map((station) => {
        const stationChannels = safeChannels
          .filter((c) => String(c.stationId) === String(station.id))
          .sort(sortChannelsByName);

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
        const stationChannels = safeChannels
          .filter((c) => String(c.stationId) === String(targetStation.id))
          .sort(sortChannelsByName);
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
    let badgeColor = 'bg-blue-500/10 text-blue-700 border-blue-500/20';

    if (node.type === 'line') {
      IconComponent = Layers;
      badgeColor = 'bg-purple-500/10 text-purple-700 border-purple-500/20';
    } else if (node.type === 'station') {
      IconComponent = Server;
      badgeColor = 'bg-amber-500/10 text-amber-700 border-amber-500/20';
    } else if (node.type === 'channel') {
      IconComponent = Cpu;
      badgeColor = 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
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
              ? 'bg-amber-500/15 border border-amber-500/40 text-slate-900 font-medium shadow-sm'
              : checkStatus === 'indeterminate'
              ? 'bg-amber-500/5 border border-amber-500/20 text-amber-700'
              : 'hover:bg-slate-200/60 text-slate-700 hover:text-slate-900 border border-transparent'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleExpandNode(node.id, e)}
                className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center text-slate-600 hover:text-slate-900 transition-colors flex-shrink-0"
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
                <CheckSquare className="w-4 h-4 text-amber-700 flex-shrink-0" />
              ) : checkStatus === 'indeterminate' ? (
                <MinusSquare className="w-4 h-4 text-amber-700/80 flex-shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-slate-500 hover:text-slate-700 flex-shrink-0" />
              )}
            </button>

            {/* Icon & Online Status Indicator for Channel */}
            <div className="relative flex items-center flex-shrink-0">
              <IconComponent className={`w-4 h-4 ${selected ? 'text-amber-700' : 'text-slate-600'}`} />
              {node.type === 'channel' && (
                <span
                  className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-slate-200 ${
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
                  <span className="text-[10px] bg-amber-500/20 text-amber-700 border border-amber-500/30 px-2 py-0.5 rounded flex items-center gap-1 font-mono animate-pulse">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-700" />
                    Đang gửi
                  </span>
                )}
                {execStatus.status === 'success' && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-700 border border-emerald-500/30 px-2 py-0.5 rounded flex items-center gap-1 font-mono" title={execStatus.message}>
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-700" />
                    Đã nhận ({execStatus.timestamp})
                  </span>
                )}
                {execStatus.status === 'error' && (
                  <span className="text-[10px] bg-rose-500/20 text-rose-700 border border-rose-500/30 px-2 py-0.5 rounded flex items-center gap-1 font-mono" title={execStatus.message}>
                    <XCircle className="w-2.5 h-2.5 text-rose-700" />
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
                    ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                    : 'bg-slate-200 text-slate-500 border-slate-300'
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

            {selected && <Check className="w-3.5 h-3.5 text-amber-700" />}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="border-l border-slate-200 ml-3">
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
              ? 'bg-emerald-50/90 border-emerald-500/40 text-emerald-700'
              : 'bg-rose-50/90 border-rose-500/40 text-rose-700'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-700 flex-shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-rose-700 flex-shrink-0" />
          )}
          <span className="text-sm font-medium">{notification.text}</span>
        </div>
      )}

      {/* Grid Section: Targeting Scope & Command Payload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (5 Cols): Scope / Target Selection with Embedded TreeView */}
        <div className="lg:col-span-5 space-y-6">
          <div className="glass-card p-5 rounded-2xl border border-slate-200 relative flex flex-col">
            <div className="flex items-center justify-between mb-3 border-b border-slate-200 pb-2.5">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-700" />
                1. Chọn Phạm Vi Nhận Lệnh (TreeView)
              </h2>
              <span className="text-[11px] text-slate-600 font-mono">
                {targetedChannels.length} / {channels.length} máy đã chọn
              </span>
            </div>

            {/* Combobox Selectors for Line and Station */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-700" />
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
                  className="w-full bg-slate-100/90 border border-slate-200 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none transition-all"
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
                <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-amber-700" />
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
                  className="w-full bg-slate-100/90 border border-slate-200 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none transition-all"
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
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-3 flex flex-col space-y-2">
              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={treeSearch}
                  onChange={(e) => setTreeSearch(e.target.value)}
                  placeholder="Tìm Line, Station, Channel hoặc MAC..."
                  className="w-full bg-slate-100/90 border border-slate-200 focus:border-amber-500 text-xs text-slate-800 pl-8 pr-8 py-2 rounded-xl focus:outline-none"
                />
                {treeSearch && (
                  <button
                    type="button"
                    onClick={() => setTreeSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-900"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Expand / Collapse & Check / Uncheck Actions Toolbar */}
              <div className="flex items-center justify-between text-[11px] text-slate-600 px-2 py-1.5 border-b border-slate-200 bg-slate-100/40 rounded-lg">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCheckAll}
                    className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-amber-500/10 hover:text-amber-700 transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-amber-700" />
                    <span>Chọn tất cả</span>
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={handleUncheckAll}
                    className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-rose-500/10 hover:text-rose-700 transition-colors"
                  >
                    <XSquare className="w-3.5 h-3.5 text-rose-700" />
                    <span>Bỏ chọn</span>
                  </button>
                </div>
                <div className="flex gap-2 font-medium">
                  <button
                    type="button"
                    onClick={handleExpandAll}
                    className="hover:text-amber-700 transition-colors"
                  >
                    Mở rộng
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={handleCollapseAll}
                    className="hover:text-amber-700 transition-colors"
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
            <div className="mt-3 p-3 bg-slate-100/50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
              <span className="text-slate-600 font-medium">Phạm vi đã chọn:</span>
              <span className="text-amber-700 font-semibold">{getTargetDescription()}</span>
            </div>

            {/* Broadcast Alert when Target Mode is 'all' */}
            {targetMode === 'all' && (
              <div className="mt-2.5 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-700 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Chế độ Broadcast Toàn Mạng</span>
                  Lệnh sẽ được phát tới tất cả <strong className="text-slate-900">{channels.length} máy collector</strong> hiện có trong cây thiết bị.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (7 Cols): Command Form & Execution Console */}
        <div className="lg:col-span-7 space-y-6">
          <div className="glass-card p-6 rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-700" />
                2. Soạn Lệnh & Nội Dung Lệnh
              </h2>
              <div className="text-xs text-amber-700 font-mono flex items-center gap-1.5 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                {getTargetDescription()}
              </div>
            </div>

            {/* Action Command Tabs */}
            <div className="flex flex-wrap border-b border-slate-200 mb-5 gap-x-4 gap-y-2">
              <button
                onClick={() => setActiveCommandTab('change-model')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'change-model'
                    ? 'text-amber-700 border-b-2 border-amber-400'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Đổi Model Sản Xuất</span>
              </button>

              <button
                onClick={() => setActiveCommandTab('update')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'update'
                    ? 'text-amber-700 border-b-2 border-amber-400'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Cập Nhật App</span>
              </button>

              <button
                onClick={() => setActiveCommandTab('restart')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'restart'
                    ? 'text-amber-700 border-b-2 border-amber-400'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Khởi Động Lại App</span>
              </button>

              <button
                onClick={() => setActiveCommandTab('time-sync')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'time-sync'
                    ? 'text-amber-700 border-b-2 border-amber-400'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Đồng Bộ Giờ</span>
              </button>

              <button
                onClick={() => setActiveCommandTab('custom')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'custom'
                    ? 'text-amber-700 border-b-2 border-amber-400'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Lệnh Tùy Chỉnh (JSON)</span>
              </button>

              <button
                onClick={() => setActiveCommandTab('cmd-exec')}
                className={`pb-3 text-xs font-medium transition-all relative flex items-center gap-2 ${
                  activeCommandTab === 'cmd-exec'
                    ? 'text-amber-700 border-b-2 border-amber-400'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <Terminal className="w-3.5 h-3.5 text-rose-700" />
                <span className="text-amber-700 font-semibold">Chạy CMD Admin</span>
              </button>
            </div>

            {/* Form Content per Tab */}
            <div className="space-y-4">
              {/* TAB 1: CHANGE MODEL */}
              {activeCommandTab === 'change-model' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tên Model Mới (New Model Name) <span className="text-amber-700">*</span>
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
                    <div className="text-[11px] text-slate-600 mb-1.5">Gợi ý Model phổ biến:</div>
                    <div className="flex flex-wrap gap-2">
                      {modelPresets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setModelName(preset)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-mono text-slate-700 hover:border-amber-500/50 hover:text-amber-700 transition-colors"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-100/60 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
                    <p className="flex items-center gap-1.5 text-slate-700 font-semibold">
                      <Info className="w-3.5 h-3.5 text-blue-700" />
                      Ghi chú thao tác Đổi Model:
                    </p>
                    <p>
                      Khi gửi lệnh này, ứng dụng Backup Log client sẽ ngay lập tức chuyển đổi cấu hình model hiện tại sang model mới để đồng bộ hóa quy tắc ghi log.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 2: UPDATE APP */}
              {activeCommandTab === 'update' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Đường dẫn Update XML (không bắt buộc)
                    </label>
                    <input
                      type="text"
                      value={updateXmlPath}
                      onChange={(e) => setUpdateXmlPath(e.target.value)}
                      placeholder="Để trống để dùng cấu hình update mặc định của client"
                      className="input-field text-sm w-full font-mono"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={updateForce}
                      onChange={(e) => setUpdateForce(e.target.checked)}
                      className="w-4 h-4 rounded bg-slate-100 border-slate-200 text-amber-500 focus:ring-amber-400"
                    />
                    <span>Ép kiểm tra và thực hiện cập nhật</span>
                  </label>

                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-700 space-y-1">
                    <p className="flex items-center gap-1.5 font-semibold text-amber-700">
                      <ShieldAlert className="w-4 h-4 text-amber-700" />
                      Cảnh báo cập nhật:
                    </p>
                    <p>Client sẽ kiểm tra phiên bản, tải bản cập nhật nếu có và có thể tự đóng ứng dụng để hoàn tất cài đặt.</p>
                  </div>
                </div>
              )}

              {/* TAB 3: RESTART APP */}
              {activeCommandTab === 'restart' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
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
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-700'
                            : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-800'
                        }`}
                      >
                        {d}ms ({d / 1000}s)
                      </button>
                    ))}
                  </div>

                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-700 space-y-1">
                    <p className="flex items-center gap-1.5 font-semibold text-amber-700">
                      <ShieldAlert className="w-4 h-4 text-amber-700" />
                      Cảnh báo thực thi:
                    </p>
                    <p>
                      Lệnh này sẽ ra lệnh cho tiến trình Backup Log trên các máy collector tự đóng và khởi động lại. SignalR connection sẽ tạm ngắt trong giây lát.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB: TIME SYNC */}
              {activeCommandTab === 'time-sync' && (
                <div className="space-y-3 text-xs text-slate-700">
                  <p>
                    Đặt giờ của PC theo giờ server, <strong>giữ nguyên múi giờ của PC</strong>: server 07:00 (+07) thì PC thành 07:00,
                    dù PC đang đặt múi giờ nào. Backup Log cũng tự đồng bộ một lần mỗi khi chương trình khởi động.
                  </p>
                  <p className="text-slate-500">
                    Kết quả trả về: giờ PC sau khi đồng bộ, số giây đã chỉnh, múi giờ của PC. Backup Log cần chạy với quyền Administrator để đổi được giờ.
                  </p>
                </div>
              )}

              {/* TAB 4: CUSTOM JSON COMMAND */}
              {activeCommandTab === 'custom' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tên Lệnh (Command Action String) <span className="text-amber-700">*</span>
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
                    <label className="block text-xs font-medium text-slate-700 mb-1">
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

              {/* TAB 5: CMD EXECUTION (ADMIN) */}
              {activeCommandTab === 'cmd-exec' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Câu lệnh CMD (Command Line) <span className="text-rose-700">*</span>
                    </label>
                    <input
                      type="text"
                      value={cmdCommandLine}
                      onChange={(e) => setCmdCommandLine(e.target.value)}
                      placeholder="Ví dụ: ipconfig /all, systeminfo, tasklist..."
                      className="input-field text-sm w-full font-mono text-emerald-700 bg-slate-50 border-amber-500/30"
                    />
                  </div>

                  {/* Preset CMD Quick Buttons */}
                  <div>
                    <span className="text-[11px] text-slate-600 block mb-1.5 font-medium">Gợi ý lệnh CMD phổ biến:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: 'Kiểm tra IP (ipconfig)', cmd: 'ipconfig /all' },
                        { label: 'Thông tin hệ thống', cmd: 'systeminfo' },
                        { label: 'Danh sách tiến trình', cmd: 'tasklist' },
                        { label: 'Kiểm tra kết nối mạng', cmd: 'ping -n 4 8.8.8.8' },
                        { label: 'Tên máy trạm (hostname)', cmd: 'hostname' },
                        { label: 'Group Policy Update', cmd: 'gpupdate /force' }
                      ].map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setCmdCommandLine(preset.cmd)}
                          className="px-2.5 py-1 text-[11px] font-mono bg-slate-200/80 hover:bg-amber-500/20 hover:text-amber-700 text-slate-700 rounded-lg border border-slate-200 transition-all"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Timeout (giây)
                      </label>
                      <input
                        type="number"
                        min={5}
                        max={300}
                        value={cmdTimeoutSec}
                        onChange={(e) => setCmdTimeoutSec(e.target.value)}
                        className="input-field text-xs w-full font-mono"
                      />
                    </div>
                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={cmdRunAsAdmin}
                          onChange={(e) => setCmdRunAsAdmin(e.target.checked)}
                          className="w-4 h-4 rounded bg-slate-100 border-slate-200 text-amber-500 focus:ring-amber-400"
                        />
                        <span>Quyền Administrator</span>
                      </label>
                    </div>
                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={cmdShowWindow}
                          onChange={(e) => setCmdShowWindow(e.target.checked)}
                          className="w-4 h-4 rounded bg-slate-100 border-slate-200 text-amber-500 focus:ring-amber-400"
                        />
                        <span>Hiển thị cửa sổ CMD</span>
                      </label>
                    </div>
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
          <div className="glass-card p-6 rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-700" />
                3. Nhật Ký Phát Lệnh (Command Console Log)
              </h2>
              <button
                onClick={() => setCommandHistory([])}
                className="text-[11px] text-slate-600 hover:text-rose-700 flex items-center gap-1 transition-colors"
                title="Xóa nhật ký"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Log</span>
              </button>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 font-mono text-xs max-h-60 overflow-y-auto space-y-2.5 custom-scrollbar">
              {commandHistory.length === 0 ? (
                <div className="text-slate-600 text-center py-4 italic">
                  Chưa có lịch sử phát lệnh nào trong phiên làm việc này.
                </div>
              ) : (
                commandHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-lg bg-slate-100/80 border border-slate-200 flex flex-col gap-1 text-[11px]"
                  >
                    <div className="flex items-center justify-between text-slate-600 border-b border-slate-200 pb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-700 font-bold">{item.command}</span>
                        <span className="text-slate-500">[{item.id}]</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">{item.timestamp}</span>
                        {item.status === 'success' ? (
                          <span className="badge badge-ok text-[10px]">SUCCESS</span>
                        ) : item.status === 'sending' ? (
                          <span className="px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 text-[10px]">PENDING</span>
                        ) : (
                          <span className="badge badge-ng text-[10px]">FAILED</span>
                        )}
                      </div>
                    </div>
                    <div className="text-slate-700 mt-0.5">
                      <span className="text-slate-500">Target: </span>
                      <span className="text-cyan-700 font-semibold">{item.targetText}</span>
                    </div>
                    {item.detail && (
                      <div className="text-slate-600">
                        <span className="text-slate-500">Payload: </span>
                        <span className="text-slate-700">{item.detail}</span>
                      </div>
                    )}
                    <div className="text-slate-600 italic bg-slate-50/60 p-1.5 rounded mt-0.5 border border-slate-200">
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
