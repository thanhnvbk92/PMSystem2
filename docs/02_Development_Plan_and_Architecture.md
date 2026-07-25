# 02. Development Plan & System Architecture - PMSystem2

> **Tài liệu**: Kế hoạch Phát triển & Sơ đồ Kiến trúc Hệ thống  
> **Áp dụng cho**: Team Kỹ thuật & AI Agent tiếp quản dự án

---

## 🏗️ 1. Kiến Trúc Hệ Thống Tổng Thể (System Architecture)

Sơ đồ luồng dữ liệu và thành phần trong kiến trúc mới của PMSystem2:

```mermaid
graph TD
    subgraph Client Layer (Frontend)
        UI[React 18 + Vite]
        RC[Recharts Data Viz]
        SG[SignalR Client WebSocket]
    end

    subgraph Server Layer (.NET 8 Web API)
        CTRL[Production & MasterData Controllers]
        HUB[ProductionHub Realtime SignalR]
        MDS[MasterDataService - In-Memory Singleton Cache]
        PCBS[PcbService - EF Core 8 Service]
    end

    subgraph Data Layer (Database & Infrastructure)
        PG[(PostgreSQL + TimescaleDB Extension)]
        CH[(ClickHouse Migration Source)]
    end

    subgraph Scripts & Tooling
        MIG[scripts/migrate_clickhouse_to_postgres.py]
    end

    UI -->|REST API Requests| CTRL
    UI <-->|WebSocket Realtime Updates| HUB
    CTRL --> MDS
    CTRL --> PCBS
    PCBS -->|EF Core Queries| PG
    MDS -->|Memory Caching| PG
    CH -.->|Automated Data Migration| MIG
    MIG -->|Batch Insert 10k| PG
```

---

### 2.4 Tự động đồng bộ Địa chỉ MAC & Phát hiện hoán đổi phần cứng (MAC Address Auto-Sync & Hardware Swap)
* **Vấn đề**: Khi máy tính/phần cứng thu thập dữ liệu (Backup Log) bị thay đổi card mạng hoặc thay máy mới, địa chỉ MAC cũ trên Master Data Server không còn đúng.
* **Giải pháp**:
  * Khi client `Backup_Log2` gửi thông điệp Đăng ký channel hoặc gửi Heartbeat lên Server, hệ thống gửi kèm địa chỉ MAC local thực tế.
  * Backend (`MasterDataController.cs`) đối soát MAC address nhận được với MAC trong DB. Nếu khác nhau, tự động cập nhật MAC mới, ghi log sự kiện và phát thông điệp SignalR `NotifyMasterDataUpdated("channels")` để thông báo cho Web UI cập nhật danh sách Channel thời gian thực.

### 2.5 Cơ chế Chống trùng lặp dữ liệu nhiều tầng (Multi-Layered Data Deduplication)
* **Vấn đề**: Người dùng có thể vô tình nạp 1 log file kiểm tra bo mạch 2 lần hoặc client đẩy lại log file khi mất kết nối mạng.
* **Giải pháp**:
  * **Tầng DB**: Bổ sung `Unique Index` `UX_pcb_results_station_pid_time_result` trong EF Core `AppDbContext.cs` trên 4 cột `(StationId, Pid, InspectTime, Result)`.
  * **Tầng Application Service**: Trong `PcbService.SubmitResultAsync`, hệ thống trích xuất mốc thời gian kiểm tra chuẩn từ log file (`inspect_time` / `start_time`), kiểm tra trước bản ghi trùng lặp trong DB. Nếu đã tồn tại, ứng dụng ghi log `[DEDUPLICATION] Duplicate PCB result ignored...` và trả về kết quả thành công hiện có mà không insert lặp.

---

## 📅 3. Kế Hoạch Phát Triển (Development Roadmap)

### Giai Đoạn 1: Tái Cấu Trúc Backend & Database (ĐÃ HOÀN THÀNH ✅)
- [x] Khởi tạo dự án .NET 8 Web API và cấu hình Entity Framework Core 8 với PostgreSQL/TimescaleDB (`AppDbContext`).
- [x] Định nghĩa DTOs & Models cho Master Data và Production Data (`ProductionData.cs`).
- [x] Xây dựng tool migrate dữ liệu tự động từ ClickHouse sang PostgreSQL (`migrate_clickhouse_to_postgres.py`).
- [x] Tạo Docker Compose khởi chạy PostgreSQL/TimescaleDB container.

### Giai Đoạn 2: Chuẩn Hóa Frontend & Xóa Bỏ Hardcoded Data (ĐÃ HOÀN THÀNH ✅)
- [x] Phát triển giao diện quản lý Master Data (Buyer, Line, Station, Channel) hỗ trợ CRUD đầy đủ.
- [x] Sắp xếp tên Line theo thứ tự tăng dần trên toàn bộ các dropdown chọn.
- [x] Thêm bộ lọc Line để chọn nhanh Station khi tạo/sửa Channel.
- [x] Xây dựng API `GET /api/v1/production/stats/station-yield` lấy thống kê sản lượng theo trạm.
- [x] **Xóa bỏ 100% dữ liệu giả / hardcoded fallback data trên Dashboard.jsx**, hiển thị trực tiếp từ DB.

### Giai Đoạn 3: Tối Ưu Hiệu Năng & SignalR Hardware Collectors (ĐANG THỰC HIỆN ⏳)
- [ ] Chạy lệnh Migration chính thức đưa toàn bộ 8.6M+ bản ghi từ ClickHouse của nhà máy vào PostgreSQL.
- [ ] Kết nối các phần mềm Collector phần cứng tự động đẩy dữ liệu telemetry về API `.NET 8`.
- [ ] Kiểm thử chịu tải (Stress Testing) đường truyền SignalR khi có 50+ máy AOI/X-Ray gửi dữ liệu đồng thời.

### Giai Đoạn 4: Báo Cáo Nâng Cao & Cảnh Báo Thông Minh (KẾ HOẠCH TƯƠNG LAI 🔮)
- [ ] Thêm tính năng xuất báo cáo Excel/PDF tự động theo ca làm việc (Shift Report).
- [ ] Thêm tính năng cảnh báo tỷ lệ lỗi vượt ngưỡng qua Telegram/Email Bot.
