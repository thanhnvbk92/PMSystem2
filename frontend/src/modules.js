import {
  Activity, BarChart3, Search, Gauge, ClipboardCheck, ShieldAlert, Terminal, Database,
  Layers, Cpu, Radio, Box, Tag, FileText, Sliders, HardDrive, Building2, Monitor, List
} from 'lucide-react';

// Modules shown as tiles on the home page. Each module has its own sidebar with its pages.
// Page ids are the URL hash (#dashboard, #master/channels, ...); FCT ids are kept as before
// so existing links and bookmarks still open the same page.
export const MODULES = [
  {
    id: 'fct',
    title: 'FCT Analysis',
    description: 'Giám sát sản lượng, phân tích yield, tra cứu PCB, CPK và cải tiến lỗi từ dữ liệu FCT.',
    icon: Activity,
    gradient: 'from-blue-600 to-indigo-600',
    color: 'text-blue-700',
    groups: [
      {
        label: 'Giám sát & Phân tích',
        items: [
          { id: 'dashboard', label: 'Tổng Quan (Dashboard)', icon: Activity, color: 'text-blue-700', activeBg: 'from-blue-600 to-indigo-600' },
          { id: 'analytics', label: 'Phân Tích Dữ Liệu', icon: BarChart3, color: 'text-purple-700', activeBg: 'from-purple-600 to-indigo-600' },
          { id: 'pcb-search', label: 'Tra Cứu PCB', icon: Search, color: 'text-emerald-700', activeBg: 'from-emerald-600 to-teal-600' },
        ],
      },
      {
        label: 'Chất lượng',
        items: [
          { id: 'cpk', label: 'Theo Dõi CPK', icon: Gauge, color: 'text-fuchsia-700', activeBg: 'from-fuchsia-600 to-purple-600' },
          { id: 'improvements', label: 'Cải Tiến Giảm Lỗi', icon: ClipboardCheck, color: 'text-cyan-700', activeBg: 'from-cyan-600 to-teal-600' },
          { id: 'invalid-results', label: 'Dữ Liệu Không Hợp Lệ', icon: ShieldAlert, color: 'text-rose-700', activeBg: 'from-rose-600 to-orange-600' },
        ],
      },
      {
        label: 'Vận hành',
        items: [
          { id: 'command', label: 'Điều Khiển Máy', icon: Terminal, color: 'text-amber-700', activeBg: 'from-amber-600 to-orange-600' },
        ],
      },
    ],
  },
  {
    id: 'pc',
    title: 'Giám Sát PC',
    description: 'Theo dõi các PC chạy Backup_Log2: online/offline, version, CPU/RAM/ổ đĩa, log type và lần upload gần nhất.',
    icon: Monitor,
    gradient: 'from-teal-600 to-emerald-600',
    color: 'text-teal-700',
    groups: [
      {
        label: 'Giám sát PC',
        items: [
          { id: 'pc-overview', label: 'Tổng Quan PC', icon: Monitor, color: 'text-teal-700', activeBg: 'from-teal-600 to-emerald-600' },
          { id: 'pc-list', label: 'Danh Sách PC', icon: List, color: 'text-teal-700', activeBg: 'from-teal-600 to-emerald-600' },
        ],
      },
    ],
  },
  {
    id: 'master',
    title: 'Master Data',
    description: 'Cài đặt master: dây chuyền, trạm, channel, model, job file, thiết bị và khách hàng.',
    icon: Database,
    gradient: 'from-cyan-600 to-blue-600',
    color: 'text-cyan-700',
    groups: [
      {
        label: 'Sản xuất',
        items: [
          { id: 'master/lines', label: 'Production Lines', icon: Layers, color: 'text-cyan-700', activeBg: 'from-cyan-600 to-blue-600', countKey: 'lines' },
          { id: 'master/stations', label: 'Stations', icon: Cpu, color: 'text-cyan-700', activeBg: 'from-cyan-600 to-blue-600', countKey: 'stations' },
          { id: 'master/channels', label: 'Channels', icon: Radio, color: 'text-cyan-700', activeBg: 'from-cyan-600 to-blue-600', countKey: 'channels' },
        ],
      },
      {
        label: 'Model',
        items: [
          { id: 'master/buyers', label: 'Buyers', icon: Building2, color: 'text-indigo-700', activeBg: 'from-indigo-600 to-blue-600', countKey: 'buyers' },
          { id: 'master/model-groups', label: 'Model Groups', icon: Box, color: 'text-indigo-700', activeBg: 'from-indigo-600 to-blue-600', countKey: 'modelGroups' },
          { id: 'master/models', label: 'Models', icon: Tag, color: 'text-indigo-700', activeBg: 'from-indigo-600 to-blue-600', countKey: 'models' },
          { id: 'master/job-model-mapping', label: 'Job → Model', icon: FileText, color: 'text-indigo-700', activeBg: 'from-indigo-600 to-blue-600' },
        ],
      },
      {
        label: 'Thiết bị',
        items: [
          { id: 'master/station-types', label: 'Station Types', icon: Sliders, color: 'text-teal-700', activeBg: 'from-teal-600 to-cyan-600', countKey: 'stationTypes' },
          { id: 'master/device-types', label: 'Device Types', icon: HardDrive, color: 'text-teal-700', activeBg: 'from-teal-600 to-cyan-600', countKey: 'deviceTypes' },
          { id: 'master/devices', label: 'Devices', icon: Cpu, color: 'text-teal-700', activeBg: 'from-teal-600 to-cyan-600', countKey: 'devices' },
        ],
      },
    ],
  },
];

export const HOME_TAB = 'home';

export const moduleItems = (module) => module.groups.flatMap(group => group.items);

/** Module that owns a page id, or null for the home page / unknown ids. */
export const moduleOfTab = (tab) => MODULES.find(module => moduleItems(module).some(item => item.id === tab)) || null;

/** Page details (label, icon, ...) of a page id. */
export const itemOfTab = (tab) => {
  for (const module of MODULES) {
    const item = moduleItems(module).find(i => i.id === tab);
    if (item) return item;
  }
  return null;
};

/** "#master" (old link) opens the first master page. */
export const normalizeTab = (tab) => {
  if (!tab) return null;
  if (tab === HOME_TAB) return HOME_TAB;
  if (tab === 'master') return 'master/lines';
  return moduleOfTab(tab) ? tab : null;
};
