# 03. Tiến Độ Chi Tiết & Bàn Giao (Progress & Handover Log)

> **Tài liệu**: Báo cáo Tiến độ Chi tiết & Hướng dẫn Bàn giao AI  
> **Cập nhật ngày**: 25/07/2026

---

## 📊 1. Tóm Tắt Tiến Độ (Executive Summary)

| Hạng mục | Trạng thái | Ghi chú |
| :--- | :---: | :--- |
| **Chuyển đổi Backend sang .NET 8** | **100%** | Web API, Entity Framework Core, SignalR Hubs đã sẵn sàng |
| **PostgreSQL + TimescaleDB DB Schema** | **100%** | Đã tạo các bảng Master Data, PCB Results & Test Steps |
| **Script Migration ClickHouse -> Postgres** | **100%** | Đã hoàn thiện script Python batching 10k bản ghi/lần |
| **Quản lý Master Data (Buyers/Lines/Stations/Channels)** | **100%** | Full CRUD, sửa lỗi xóa mồ côi, sắp xếp tên Line A-Z |
| **Tích hợp Station Yield API** | **100%** | Endpoint `/api/v1/production/stats/station-yield` |
| **Loại bỏ Hardcoded Fallback UI** | **100%** | Biểu đồ & KPI Card trên `Dashboard.jsx` lấy 100% dữ liệu DB |
| **Nạp dữ liệu sản xuất quy mô lớn** | **Chờ chạy lệnh** | Cần chạy script migrate từ server ClickHouse cũ (`192.168.100.10`) |

---

## 🔍 2. Chi Tiết Các Thay Đổi & Sửa Lỗi Gần Đây (Recent Changes Log)

### 2.1 Xử lý Master Data CRUD & Phản hồi UI ngay lập tức
* **Vấn đề cũ**: Khi xóa hoặc sửa Buyer/Line/Station/Channel, UI không biến mất ngay mà phải chuyển tab hoặc click lại mới thấy cập nhật.
* **Nguyên nhân**: State local không được làm mới và `MasterDataService` ở backend bị lệch bộ nhớ đệm cache.
* **Cách đã xử lý**: 
  * Cập nhật `MasterData.jsx`: Thêm cập nhật state phản hồi ngay (`setLocalBuyers`, `setLocalLines`, `setLocalStations`, `setLocalChannels`) kết hợp gọi `onRefresh()`.
  * Cập nhật `MasterDataService.cs`: Gọi `RefreshCacheAsync()` sau mỗi thao tác CUD.

### 2.2 Nâng cấp UX tab Channels
* **Yêu cầu người dùng**: Thêm phần chọn Line để chọn Station cho nhanh khi thao tác ở tab Channels.
* **Cách đã xử lý**:
  * Thêm ô `<select>` lọc Dây chuyền (Line) ngay trong Form tạo/sửa Channel tại `MasterData.jsx`.
  * Thêm cột hiển thị tên **Dây Chuyền** trong bảng danh sách Channels.
  * Chuẩn hóa tên tab từ "Hardware Channels" thành **"Channels"**.

### 2.3 Sắp xếp tên Line tăng dần
* **Yêu cầu người dùng**: Sắp xếp tên Line theo thứ tự tăng dần ở tất cả ô chọn.
* **Cách đã xử lý**:
  * Sử dụng hàm `.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))` tại các component `MasterData.jsx`, `Dashboard.jsx`, `Analytics.jsx`.
  * Cập nhật query backend `PcbService.cs` sắp xếp kết quả thống kê Line Yield theo thứ tự tên Line.

### 2.4 Loại bỏ Fallback Data trên Dashboard
* **Vấn đề cũ**: Người dùng nhận thấy Dashboard hiển thị dữ liệu nhiều hơn con số 473 bản ghi thực có trong bảng `pcb_results` do có các mảng dữ liệu mẫu fallback (ví dụ `defaultStations`, `8.5M`, `8,151,200`).
* **Cách đã xử lý**:
  * Bổ sung endpoint backend `GET /api/v1/production/stats/station-yield`.
  * Thêm hàm `ProductionApi.getStationYieldStats()` trong `frontend/src/services/api.js`.
  * Xóa sạch mảng tĩnh fallback trên `Dashboard.jsx` (`defectCategories`, `linePerformanceData`, `lineVolumePassData`, `stationVolumePassData`, `stationRiskData`).
  * Toàn bộ KPI Card và biểu đồ giờ đây phản ánh trung thực dữ liệu thời gian thực từ Database.

---

## 📝 3. Nhiệm Vụ Cho AI Tiếp Theo (Next Action Items For Next AI Agent)

Khi AI tiếp theo bắt đầu làm việc, hãy thực hiện các bước sau theo thứ tự ưu tiên:

1. **Chạy Migration dữ liệu thực tế (nếu được người dùng yêu cầu)**:
   * Nếu người dùng muốn đưa dữ liệu lịch sử từ máy chủ ClickHouse cũ về PostgreSQL, chạy lệnh:
     ```powershell
     .\scripts\run_migration.ps1 -ChHost "192.168.100.10" -PgPass "Anduongb67"
     ```
2. **Kiểm tra hiển thị dữ liệu sau khi Migrate**:
   * Kiểm tra giao diện Dashboard & Analytics để xác nhận biểu đồ sản lượng và FPY hiển thị đầy đủ chuỗi thời gian sau khi dữ liệu lịch sử được đổ vào DB.
3. **Tiếp nhận phản hồi thêm/sửa/xóa từ người dùng**:
   * Nếu người dùng yêu cầu chỉnh sửa thêm về giao diện Master Data hoặc lọc kết quả tìm kiếm PCB (trang `PcbSearch.jsx`), tham chiếu các API tương ứng trong `01_SRS_Software_Requirements_Specification.md`.

---

## 📂 4. Cấu Trúc Thư Mục Tài Liệu (`docs/`)

```
docs/
├── README.md                                    # File định hướng & Quick Start cho Developer/AI
├── 01_SRS_Software_Requirements_Specification.md # Đặc tả Yêu cầu phần mềm, ERD & API specs
├── 02_Development_Plan_and_Architecture.md       # Kiến trúc bộ nhớ đệm, SignalR & Roadmap
└── 03_Detailed_Progress_and_Handover.md         # Báo cáo tiến độ chi tiết & Bàn giao AI
```
