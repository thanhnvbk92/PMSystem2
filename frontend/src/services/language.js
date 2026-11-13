import { useEffect } from 'react';

const exact = {
  'Chức Năng Chính': 'Main Functions',
  'Tổng Quan (Dashboard)': 'Overview (Dashboard)',
  'Phân Tích Dữ Liệu': 'Data Analytics',
  'Tra Cứu PCB': 'PCB Search',
  'Theo Dõi CPK': 'CPK Monitoring',
  'Cải Tiến Giảm Lỗi': 'Defect Reduction',
  'Dữ Liệu Không Hợp Lệ': 'Invalid Data',
  'Điều Khiển Máy': 'Machine Control',
  'Trung Tâm Phân Tích Dữ Liệu (Analytics)': 'Data Analytics Center',
  'Tra Cứu & Tìm Kiếm Bản Ghi PCB': 'PCB Record Search',
  'Theo Dõi Năng Lực Quá Trình (CPK)': 'Process Capability Monitoring (CPK)',
  'Theo Dõi Dữ Liệu Không Hợp Lệ': 'Invalid Data Monitoring',
  'Điều Khiển & Lệnh Hệ Thống (Command Center)': 'System Command Center',
  'Tổng cải tiến': 'Total improvements',
  'Đang theo dõi': 'In progress',
  'Đạt mục tiêu': 'Target achieved',
  'Hành động quá hạn': 'Overdue actions',
  'Top 5 lỗi cần ưu tiên': 'Top 5 priority defects',
  'Theo tuần': 'Weekly', 'Theo tháng': 'Monthly',
  'Chọn cải tiến': 'Create improvement', 'Phân tích': 'Analyze',
  'Phân tích issue': 'Analyze issue', 'Xem biểu đồ': 'View chart',
  'Sửa cải tiến': 'Edit improvement', 'Xóa cải tiến': 'Delete improvement',
  'Tạo cải tiến': 'Create improvement', 'Hủy': 'Cancel', 'Lưu': 'Save',
  'Tìm kiếm': 'Search', 'Làm mới': 'Refresh', 'Tải lại dữ liệu': 'Reload data',
  'Tất cả': 'All', 'Chỉ OK': 'OK only', 'Chỉ NG': 'NG only',
  'Tất cả thời gian': 'All time', 'Hôm nay': 'Today', 'Tuần này': 'This week',
  'Tháng này': 'This month', 'Năm nay': 'This year', 'Tùy chỉnh': 'Custom',
  'Từ:': 'From:', 'Đến:': 'To:', 'Khoảng thời gian:': 'Time range:',
  'Kết quả': 'Result', 'Thời gian kiểm tra': 'Inspection time',
  'Dây chuyền': 'Line', 'Trạm / Channel': 'Station / Channel', 'IP Máy': 'Machine IP',
  'Chi tiết Test Steps': 'Test step details', 'Xem Steps': 'View steps',
  'Xuất CSV': 'Export CSV', 'Tải CSV Server': 'Download server CSV',
  'Đang xuất...': 'Exporting...', 'Đang tải...': 'Loading...',
  'Đang tìm kiếm...': 'Searching...', 'Đang tổng hợp dữ liệu FCT...': 'Aggregating FCT data...',
  'Không có dữ liệu': 'No data', 'Chưa có dữ liệu': 'No data yet',
  'Chưa xác định': 'Unspecified', 'Chưa giao': 'Unassigned',
  'Tất cả Line': 'All lines', 'Tất cả Station': 'All stations', 'Tất cả Model': 'All models',
  'Mã lỗi FCT': 'FCT defect code', 'Tên cải tiến': 'Improvement title',
  'Người phụ trách': 'Owner', 'Trạng thái': 'Status', 'Mô tả vấn đề': 'Problem description',
  'Nguyên nhân gốc': 'Root cause', 'Mục tiêu giảm lỗi (%)': 'Defect reduction target (%)',
  'Bắt đầu kỳ trước': 'Baseline start', 'Kết thúc kỳ trước': 'Baseline end',
  'Bắt đầu kỳ sau': 'Tracking start', 'Kết thúc kỳ sau': 'Tracking end',
  'Trước cải tiến': 'Before improvement', 'Sau cải tiến': 'After improvement',
  'Hành động cải tiến': 'Improvement actions', 'Hành động mới...': 'New action...',
  'Thêm': 'Add', 'Sửa': 'Edit', 'Xóa': 'Delete', 'Đóng': 'Close',
  'Chưa thực hiện': 'Not started', 'Đang thực hiện': 'In progress', 'Hoàn thành': 'Completed',
  'Đang lưu...': 'Saving...', 'Lưu hành động': 'Save action',
  'Phóng to ảnh': 'Zoom image', 'Thu nhỏ': 'Zoom out', 'Phóng to': 'Zoom in',
  'Lưu ảnh': 'Download image', 'Lưu ảnh về máy': 'Download image',
  'Chưa có hình ảnh': 'No image', 'Chưa có nội dung báo cáo.': 'No report content.',
  'Bộ lọc hiện tại:': 'Active filters:', 'Xóa tất cả bộ lọc': 'Clear all filters',
  'DÂY CHUYỀN (LINE)': 'LINE', 'TRẠM (STATION)': 'STATION', 'MÁY (MACHINE)': 'MACHINE',
  'MÃ LỖI (DEFECT)': 'DEFECT', 'KHUNG THỜI GIAN': 'TIME RANGE',
  'SẢN LƯỢNG & TỶ LỆ LỖI THEO LINE': 'PRODUCTION & DEFECT RATE BY LINE',
  'TỶ LỆ LỖI THEO MODEL': 'DEFECT RATE BY MODEL',
  'Đóng Góp Tỷ Lệ Lỗi Theo Line': 'Defect Rate Contribution by Line',
  'ĐÓNG GÓP TỶ LỆ LỖI THEO LINE': 'DEFECT RATE CONTRIBUTION BY LINE',
  'Sản lượng & tỷ lệ lỗi theo Line': 'Production & Defect Rate by Line',
  'Tỷ lệ lỗi theo Model': 'Defect Rate by Model',
  'Top 10 Station (Tỷ lệ lỗi cao nhất)': 'Top 10 Stations (Highest Defect Rate)',
  'Top 10 Máy (Tỷ lệ lỗi cao nhất)': 'Top 10 Machines (Highest Defect Rate)',
  'Top 10 Trạm (Tỷ lệ lỗi cao nhất)': 'Top 10 Stations (Highest Defect Rate)',
  'Biểu đồ Pareto mã lỗi': 'Defect Pareto Chart',
  'Thống Kê Sản Lượng Theo Job File (Model)': 'Production Statistics by Job File (Model)',
  'SẢN LƯỢNG & TỈ LỆ PASS THEO THỜI GIAN': 'PRODUCTION & PASS RATE OVER TIME',
  'SẢN LƯỢNG & TỈ LỆ PASS THEO LINE': 'PRODUCTION & PASS RATE BY LINE',
  'SẢN LƯỢNG & TỈ LỆ PASS THEO STATION (TOP 10 THẤP NHẤT)': 'PRODUCTION & PASS RATE BY STATION (BOTTOM 10)',
  'SẢN LƯỢNG & TỶ LỆ PASS THEO THỜI GIAN': 'PRODUCTION & PASS RATE OVER TIME',
  'SẢN LƯỢNG & TỶ LỆ PASS THEO LINE': 'PRODUCTION & PASS RATE BY LINE',
  'SẢN LƯỢNG & TỶ LỆ PASS THEO STATION (TOP 10 THẤP NHẤT)': 'PRODUCTION & PASS RATE BY STATION (BOTTOM 10)',
  'PRODUCTION OVERVIEW': 'PRODUCTION OVERVIEW',
  'INCIDENTS AND QUALITY OVERVIEW': 'INCIDENTS AND QUALITY OVERVIEW',
  'Xu hướng giá trị đo — 50 PCB OK gần nhất': 'Measurement Trend — Latest 50 OK PCBs',
  'Process Capability — Phân bố giá trị đo': 'Process Capability — Measurement Distribution',
  'Histogram và đường cong chuẩn của 50 PCB OK gần nhất': 'Histogram and normal curve of the latest 50 OK PCBs',
  'Individual Value Plot': 'Individual Value Plot',
  'Di chuột vào điểm để xem PID và thời gian': 'Hover over a point to view PID and time',
  'Tổng tỷ lệ lỗi:': 'Total defect rate:',
  'Sản Lượng (Tổng):': 'Production (Total):',
  'Pass (OK):': 'Pass (OK):', 'Fail (NG):': 'Fail (NG):', 'Tỷ lệ lỗi:': 'Defect rate:',
  'Số Lỗi Phát Sinh': 'Defect Count', 'Số lỗi': 'Defect count',
  'Click cột để lọc Line': 'Click a column to filter Line',
  'Click cột để lọc Trạm': 'Click a column to filter Station',
  'Click cột để lọc Máy': 'Click a column to filter Machine',
  'Chưa có dữ liệu Model.': 'No model data.',
  'Hãy mapping Job File trong Master Data.': 'Please map Job Files in Master Data.',
  'Chưa ghi nhận dữ liệu theo Job File.': 'No Job File data recorded.',
  'Tỷ lệ lỗi (%)': 'Defect rate (%)', 'Sản Lượng Pass (OK)': 'Pass quantity (OK)',
  'Sản Lượng Fail (NG)': 'Fail quantity (NG)',
  'Tốt': 'Good', 'Cảnh báo': 'Warning', 'Không đạt': 'Failed', 'Chưa đủ dữ liệu': 'Insufficient data',
  'Số mẫu': 'Samples', 'Giá trị': 'Value', 'Tần suất': 'Frequency',
  'Chi tiết CPK': 'CPK details', 'Đang tải dữ liệu đo...': 'Loading measurement data...',
  'Tổng Sản Lượng Kiểm Tra': 'Total inspected', 'Sản Phẩm Đạt Chuẩn (OK)': 'Passed products (OK)',
  'Sản Phẩm Lỗi (NG)': 'Failed products (NG)', 'Tỷ Lệ Yield Thật (FPY)': 'First Pass Yield (FPY)',
  'Tỷ lệ Pass tổng thể': 'Overall pass rate',
  'Tỷ Lệ Lỗi Tổng Thể': 'Overall Defect Rate',
  'Mỗi lần test được tính là một lượt': 'Every test attempt is counted',
  'PID từng NG tại cùng Station': 'PID ever failed at the same Station',
  'PID không NG lần nào trên toàn hệ thống': 'PID never failed anywhere in the system',
  'Đang tính lịch sử PCB...': 'Calculating PCB history...',
  'Mở rộng Sidebar': 'Expand sidebar', 'Thu gọn Sidebar': 'Collapse sidebar',
  'Bỏ qua': 'Ignored', 'Chưa có event': 'No event yet',
};

const phrases = [
  [/Tất cả các chuyền/gi, 'All lines'], [/Tất cả chuyền/gi, 'All lines'],
  [/Tất cả Lines?/gi, 'All lines'], [/Tất cả Trạm/gi, 'All stations'],
  [/Tất cả Máy/gi, 'All machines'], [/Tất cả Mã Lỗi/gi, 'All defects'],
  [/Tất cả Job Files?/gi, 'All job files'], [/Đã chọn (\d+)/gi, 'Selected $1'],
  [/PCB lỗi/gi, 'failed PCBs'], [/bản ghi/gi, 'records'], [/Thời gian tìm kiếm/gi, 'Search time'],
  [/Không tìm thấy/gi, 'Not found'], [/Không thể tải/gi, 'Unable to load'],
  [/Chưa có/gi, 'No'], [/Đang tải/gi, 'Loading'], [/Đang xử lý/gi, 'Processing'],
  [/Click để/gi, 'Click to'], [/Mục tiêu/gi, 'Target'], [/Mức giảm lỗi/gi, 'Defect reduction'],
  [/Tỷ lệ lỗi/gi, 'Defect rate'], [/Sản lượng/gi, 'Production'],
  [/Sản Lượng/gi, 'Production'], [/Tỉ lệ Pass/gi, 'Pass rate'], [/Tỷ Lệ Pass/gi, 'Pass rate'],
  [/Đóng Góp/gi, 'Contribution'], [/Đóng góp/gi, 'Contribution'],
  [/Phát Sinh Lỗi/gi, 'Defect'], [/Đạt Chuẩn/gi, 'Pass'],
  [/Số Lỗi Phát Sinh/gi, 'Defect Count'], [/Số Lỗi/gi, 'Defect Count'],
  [/Giá trị đo/gi, 'measurement'], [/đường cong chuẩn/gi, 'normal curve'],
  [/Mẫu/gi, 'Samples'], [/Máy/gi, 'Machine'], [/Trạm/gi, 'Station'],
  [/Dây Chuyền/gi, 'Line'], [/mã lỗi/gi, 'defect code'],
  [/cao nhất/gi, 'highest'], [/thấp nhất/gi, 'lowest'],
  [/gần nhất/gi, 'latest'], [/theo thời gian/gi, 'over time'],
  [/Theo Line/gi, 'by Line'], [/Theo Model/gi, 'by Model'], [/Theo Station/gi, 'by Station'],
  [/Dữ liệu/gi, 'Data'], [/Phân tích/gi, 'Analyze'], [/Cải tiến/gi, 'Improvement'],
];

export function translateText(value) {
  if (!value) return value;
  const leading = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  const core = value.trim();
  if (!core) return value;
  let translated = exact[core] || core;
  if (translated === core && /[À-ỹĐđ]/.test(core)) {
    for (const [pattern, replacement] of phrases) translated = translated.replace(pattern, replacement);
  }
  return `${leading}${translated}${trailing}`;
}

const textRecords = new WeakMap();
const attributeRecords = new WeakMap();
const attributes = ['placeholder', 'title', 'aria-label'];

function shouldSkip(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !!element?.closest?.('[data-no-translate], script, style, code');
}

// Each record keeps the source text (`original`, as rendered by React) and the
// value this translator last wrote (`written`). A current value different from
// `written` was set by React (e.g. a renamed Channel), so it becomes the new
// source. Without this, Vietnamese mode restored the stale first-seen text.
function nextValue(record, current, language) {
  if (record.written === undefined || current !== record.written) record.original = current;
  const next = language === 'en' ? translateText(record.original) : record.original;
  record.written = next;
  return next;
}

function applyNode(node, language) {
  if (shouldSkip(node)) return;
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.nodeValue?.trim()) return;
    const record = textRecords.get(node) || {};
    const next = nextValue(record, node.nodeValue, language);
    textRecords.set(node, record);
    if (node.nodeValue !== next) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  let records = attributeRecords.get(node) || {};
  attributes.forEach(name => {
    if (!node.hasAttribute(name)) return;
    const current = node.getAttribute(name);
    const record = records[name] || {};
    const next = nextValue(record, current, language);
    records[name] = record;
    if (current !== next) node.setAttribute(name, next);
  });
  attributeRecords.set(node, records);
  node.childNodes.forEach(child => applyNode(child, language));
}

export function GlobalLanguageTranslator({ language }) {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    applyNode(root, language);
    const observer = new MutationObserver(mutations => mutations.forEach(mutation => {
      if (mutation.type === 'characterData') applyNode(mutation.target, language);
      else if (mutation.type === 'attributes') applyNode(mutation.target, language);
      else mutation.addedNodes.forEach(node => applyNode(node, language));
    }));
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: attributes });
    return () => observer.disconnect();
  }, [language]);
  return null;
}
