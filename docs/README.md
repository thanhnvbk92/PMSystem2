# PMSystem2 - Tài Liệu Bàn Giao & Hướng Dẫn Dành Cho AI / Developer

> **Dự án**: PMSystem2 - System Monitoring & PCB Quality Control System  
> **Phiên bản hiện tại**: 2.0 (Chuyển đổi từ Python/ClickHouse sang .NET 8 / PostgreSQL + TimescaleDB)  
> **Cập nhật gần nhất**: 25/07/2026

---

## 📌 1. Bối Cảnh & Mục Tiêu Dự Án

**PMSystem2** là hệ thống giám sát sản lượng và kiểm soát chất lượng bo mạch điện tử (PCB) theo thời gian thực tại nhà máy sản xuất. Hệ thống thu thập dữ liệu kiểm tra từ các trạm tự động (AOI, SPI, X-Ray, ICT, FCT), phân tích tỷ lệ Pass/NG, thống kê YieldRate (FPY), cảnh báo lỗi và quản lý Master Data.

Dự án vừa trải qua đợt tái cấu trúc hệ thống lớn:
* **Hệ thống cũ**: Python (Flask) + ClickHouse.
* **Hệ thống mới**: **.NET 8 Web API + SignalR + PostgreSQL (TimescaleDB) + React (Vite)**.

---

## 🚀 2. Khởi Động Nhanh (Quick Start)

### a. Khởi chạy Database (PostgreSQL / TimescaleDB)
```bash
docker-compose up -d
```
* DB Port: `5432` | User: `postgres` | Pass: `Anduongb67` | Database: `pmsystem2`

### b. Chuyển Đổi Dữ Liệu từ ClickHouse sang PostgreSQL (Migration)
```powershell
# Chạy script tự động migrate dữ liệu cũ từ ClickHouse (192.168.100.10)
.\scripts\run_migration.ps1 -ChHost "192.168.100.10" -PgPass "Anduongb67"
```

### c. Khởi chạy Backend (.NET 8 Web API)
```bash
cd backend
dotnet run
```
* API Endpoint: `http://localhost:5000` (hoặc `http://localhost:5246`)
* Swagger Document: `http://localhost:5000/swagger`

### d. Khởi chạy Frontend (React Vite)
```bash
cd frontend
npm install
npm run dev
```
* Frontend URL: `http://localhost:5173`

---

## 📑 3. Danh Mục Tài Liệu Chi Tiết

Tất cả tài liệu chi tiết của dự án được lưu trong thư mục `docs/`:

1. [`01_SRS_Software_Requirements_Specification.md`](./01_SRS_Software_Requirements_Specification.md): Đặc tả yêu cầu phần mềm, nghiệp vụ, ERD và API specs.
2. [`02_Development_Plan_and_Architecture.md`](./02_Development_Plan_and_Architecture.md): Kiến trúc hệ thống tổng thể, thiết kế bộ nhớ đệm, SignalR và Roadmap phát triển.
3. [`03_Detailed_Progress_and_Handover.md`](./03_Detailed_Progress_and_Handover.md): Báo cáo tiến độ chi tiết, danh sách các công việc đã hoàn thành, các vấn đề đã giải quyết và **nhiệm vụ kế tiếp cho AI tiếp theo**.

---

## ⚡ 4. Hướng Dẫn Nhanh Cho AI Tiếp Theo (AI Quick-Context)

Nếu bạn là AI Coding Assistant bắt đầu phiên làm việc mới, hãy nắm vững các điểm cốt lõi sau:

1. **Cơ chế Cấu hình Master Data**:
   * `MasterDataService.cs` hoạt động dưới dạng **Singleton In-Memory Cache** kết hợp EF Core DB để phục vụ tra cứu linh kiện/trạm kiểm tra tức thì với độ trễ cực thấp.
   * Mỗi khi thay đổi Master Data (Buyer, Line, Station, Channel), gọi `RefreshCacheAsync()` để đồng bộ bộ nhớ đệm.

2. **Dữ liệu Sản xuất & Fallback Data**:
   * **Toàn bộ dữ liệu mẫu (Hardcoded / Demo Fallback) trên Dashboard.jsx đã bị LOẠI BỎ**.
   * Hệ thống hiển thị 100% dữ liệu thật từ bảng `pcb_results` và `test_steps`.
   * Endpoint `GET /api/v1/production/stats/station-yield` được dùng để hiển thị Top 10 trạm có tỷ lệ đạt thấp nhất.

3. **Sắp xếp & Hiển thị UI**:
   * Danh sách Dây chuyền (Line) tại tất cả các ô Select được **sắp xếp theo thứ tự tăng dần (A-Z, 1-9)**.
   * Trang Master Data tab **Channels** cho phép lọc chọn Line trước để thu hẹp danh sách Station, giúp thao tác chọn trạm nhanh chóng.

4. **Kế hoạch tiếp theo**: Xem file [`03_Detailed_Progress_and_Handover.md`](./03_Detailed_Progress_and_Handover.md) để biết các công việc cần làm tiếp.
