# 03. Tiến Độ Chi Tiết & Bàn Giao (Progress & Handover Log)

> **Tài liệu**: Báo cáo Tiến độ Chi tiết & Hướng dẫn Bàn giao AI  
> **Cập nhật ngày**: 26/07/2026

---

## 📊 1. Tóm Tắt Tiến Độ (Executive Summary)

| Hạng mục | Trạng thái | Ghi chú |
| :--- | :---: | :--- |
| **Chuyển đổi Backend sang .NET 8** | **100%** | Web API, Entity Framework Core, SignalR Hubs đã sẵn sàng |
| **PostgreSQL + TimescaleDB DB Schema** | **100%** | Đã tạo các bảng Master Data, PCB Results & Test Steps |
| **Script Migration ClickHouse -> Postgres** | **100%** | Đã hoàn thiện script Python batching 10k bản ghi/lần |
| **Quản lý Master Data (Buyers/Lines/Stations/Channels)** | **100%** | Full CRUD, sửa lỗi xóa mồ côi, sắp xếp tên Line A-Z |
| **Đồng bộ Địa chỉ MAC & Hoán đổi phần cứng** | **100%** | Tự động đồng bộ MAC khi Heartbeat/Register, phát SignalR thông báo UI |
| **Chống trùng lặp Dữ liệu PCB (Deduplication)** | **100%** | Ràng buộc DB Unique Index + Service level pre-check thời gian kiểm tra |
| **Tích hợp Station Yield API** | **100%** | Endpoint `/api/v1/production/stats/station-yield` |
| **Loại bỏ Hardcoded Fallback UI** | **100%** | Biểu đồ & KPI Card trên `Dashboard.jsx` lấy 100% dữ liệu DB |
| **Trang Điều Khiển Máy Từ Xa (Command Center)** | **100%** | Gửi lệnh tập trung theo Tree View Line/Station, tích hợp thông tin IP/MAC |
| **Hiển thị Chi tiết Step NG / FAIL & Dual Case JSON** | **100%** | Hỗ trợ camelCase/snake_case, hiển thị đúng stepName, Min/Max và highlight màu đỏ |
| **Xuất CSV Dữ Liệu Sản Xuất Không Giới Hạn** | **100%** | Bỏ giới hạn 2,000 dòng, cảnh báo Modal xác nhận khi xuất >3,000 bản ghi |

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

### 2.5 Tự động đồng bộ MAC Address & Cảnh báo hoán đổi phần cứng
* **Yêu cầu người dùng**: Hiển thị MAC Address trên Master Data UI và tự động phát hiện/cập nhật khi MAC của máy collector thay đổi.
* **Cách đã xử lý**:
  * Cập nhật `MasterData.jsx`: Bổ sung cột **MAC Address** vào bảng hiển thị Channels.
  * Cập nhật `LogApiService.cs` trong `Backup_Log2`: Tự động trích xuất địa chỉ MAC card mạng chính và gửi kèm trong Heartbeat / Register Channel API.
  * Cập nhật `MasterDataController.cs`: Tự động đối soát và cập nhật MAC address mới nếu phát hiện hoán đổi phần cứng, phát SignalR `NotifyMasterDataUpdated("channels")` thông báo cho Web UI cập nhật.

### 2.6 Chống trùng lặp dữ liệu kết quả kiểm tra PCB (Deduplication)
* **Yêu cầu người dùng**: Ngăn chặn tình trạng 1 log file bị đẩy 2 lần gây nhân đôi dữ liệu kiểm tra bo mạch.
* **Cách đã xử lý**:
  * **Database Unique Constraint**: Thêm Unique Index `UX_pcb_results_station_pid_time_result` trên 4 trường `(StationId, Pid, InspectTime, Result)` trong `AppDbContext.cs`.
  * **Ingestion Timestamp Mapping**: Cập nhật DTO `SubmitPcbRequest` tiếp nhận chính xác mốc thời gian kiểm tra thực tế (`inspect_time` / `start_time`) từ log file.
  * **Service Level Validation**: Trong `PcbService.SubmitResultAsync`, ứng dụng kiểm tra trước xem bộ kết quả với mốc thời gian tương ứng đã có trong DB chưa. Nếu đã có, hệ thống tự động ghi log cảnh báo và bỏ qua bản ghi trùng mà không chèn vào DB.

### 2.7 Trang Điều Khiển & Gửi Lệnh Từ Xa (Command Center UI & Hub)
* **Yêu cầu người dùng**: Thêm 1 trang Command mới để điều khiển từ xa tập trung hàng loạt máy collector. Hỗ trợ 3 cấp độ phạm vi điều khiển: theo **Dây Chuyền (Line)**, theo **Trạm Kiểm Tra (Station)**, hoặc **Kênh Riêng Lẻ (Channel/MAC)**.
* **Cách đã xử lý**:
  * **Backend (`CommandController.cs` & `CommandHub.cs`)**:
    * Bổ sung thuộc tính `StationId` vào DTOs lệnh (`SendCommandRequest`, `ChangeModelCommandRequest`, `RestartCommandRequest`).
    * Mở rộng nhóm SignalR Hub (`Line_{id}`, `Station_{id}`, `Channel_{id}`, `MAC_{mac}`, `AllCommandClients`). Client tự động đăng ký vào nhóm tương ứng khi kết nối.
  * **Frontend (`CommandControl.jsx`)**:
    * Xây dựng giao diện chọn phạm vi nhận lệnh trực quan (4 chế độ: Tất cả máy, Dây chuyền, Trạm kiểm tra, Kênh riêng lẻ) với xem trước danh sách máy sẽ nhận lệnh real-time.
    * Hỗ trợ 3 mẫu lệnh chính: **Đổi Model sản xuất** (kèm các Preset chip chọn nhanh), **Khởi động lại App Backup Log** (chỉnh Delay Ms), và **Lệnh Tùy Chỉnh (JSON Payload)**.
    * Tích hợp nhật ký thực thi phát lệnh (Command Execution Log Console) hiển thị thời gian, lệnh, thiết bị đích và phản hồi thời gian thực từ SignalR.
  * **Sidebar Navigation**: Thêm mục menu **"Điều Khiển Máy"** (Command Center) với icon `Terminal` phân lớp `REMOTE CONTROL`.

### 2.8 Tối ưu hóa Xuất CSV Dữ liệu Sản xuất Không Giới Hạn (Unlimited CSV Export & Large Data Warning)
* **Yêu cầu người dùng**: Bỏ giới hạn tối đa 2,000 dòng khi xuất dữ liệu CSV, tải hết toàn bộ bản ghi tìm kiếm được để phục vụ phân tích lỗi. Nếu dữ liệu quá lớn, hiển thị cảnh báo cho người dùng quyết định.
* **Cách đã xử lý**:
  * **Backend (`PcbController.cs` & `PcbService.cs`)**:
    * Bổ sung API `GET /api/production/export-count` đếm số lượng bản ghi thỏa mãn điều kiện lọc.
    * Cập nhật `GetExportCsvAsync` cho phép truyền `limit = null` để tải 100% dữ liệu phù hợp.
  * **Frontend (`PcbSearch.jsx` & `Analytics.jsx`)**:
    * Thêm Modal cảnh báo dữ liệu lớn (`Large Data Export Warning Modal`) khi tổng số bản ghi vượt mốc 3,000 dòng.
    * Hiển thị số lượng dòng thực tế và cho phép người dùng xác nhận **"Vẫn Tải Xuống"** hoặc **"Hủy Bỏ"**.

### 2.9 Khắc phục hiển thị Tên Bước NG / FAIL & Dual Case JSON (`step_name` / `stepName`)
* **Vấn đề cũ**: Khi xem chi tiết bo mạch lỗi (`NG`), một số bước không hiển thị Tên bước (`stepName`) và giới hạn Min/Max do lệch chuẩn đặt tên thuộc tính giữa Collector (`snake_case`) và Frontend (`camelCase`).
* **Cách đã xử lý**:
  * **Backend (`ProductionData.cs`)**: Thêm kép thuộc tính `[JsonPropertyName]` cho `TestStepInputDto` hỗ trợ tự động deserialize cả `step_name` / `stepName`, `spec_min` / `specMin`, `spec_max` / `specMax`.
  * **Frontend (`PcbSearch.jsx`)**:
    * Cập nhật Modal đọc song song cả `stepName` và `step_name`, `specMin` và `spec_min`, `specMax` và `spec_max`.
    * Giữ nguyên giá trị tên bước nguyên bản từ CSDL mà không tự chèn tên giả lập.
    * Nổi bật các bước bị lỗi (`NG`/`FAIL`) bằng màu nền đỏ nhạt (`bg-rose-950/40`), chữ đỏ (`text-rose-300`) và dấu chấm nhấp nháy đỏ để dễ dàng nhận biết.
  * **File Báo cáo CSV**: Cập nhật hàm format xuất bước lỗi dạng `TênBước: GiáTrị [Min: X, Max: Y]`.

### 2.10 Tối ưu Tree View Command Center & Điều hướng Trang (Route Persistence)
* **Cách đã xử lý**:
  * Bổ sung Combobox lọc Dây chuyền / Trạm kiểm tra để giới hạn gốc hiển thị Tree View thiết bị.
  * Nhúng thông tin Tên Channel, Địa chỉ IP, Trạng thái Kết nối và Trạng thái Nhận lệnh trực tiếp trong Tree View mà không bị ẩn panel.
  * Cập nhật `Sidebar.jsx` & `App.jsx` giữ nguyên tab trang hiện tại khi người dùng nhấn Refresh trình duyệt (tránh bị nhảy về Dashboard).

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
