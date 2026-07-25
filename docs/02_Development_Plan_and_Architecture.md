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

## 🛠️ 2. Quyết Định Thiết Kế Kiến Trúc (Architectural Decisions)

### 2.1 Bộ nhớ đệm MasterData (MasterDataService Cache Pattern)
* **Vấn đề**: Các bảng Master Data (`buyers`, `lines`, `stations`, `channels`) có số lượng thao tác đọc (Read) cực kỳ lớn (mỗi khi ghi 1 PCB result đều phải kiểm tra FK).
* **Giải pháp**: Xây dựng `MasterDataService` dạng **Singleton Service**. Tất cả danh mục được nạp sẵn vào bộ nhớ RAM khi Backend khởi động (`SeedDefaultDataIfEmptyAsync` & `RefreshCacheAsync`). Khi người dùng tạo/sửa/xóa Master Data qua API, dịch vụ sẽ cập nhật DB đồng thời làm mới bộ nhớ đệm lập tức.

### 2.2 Đẩy dữ liệu thời gian thực (Real-time SignalR Integration)
* Khi có kết quả kiểm tra PCB mới được gửi về qua API `POST /api/v1/production/telemetry`, `PcbService` sẽ phát tín hiệu qua `ProductionHub` tới tất cả các client React đang mở Dashboard để tự động cập nhật biểu đồ mà không cần F5 trang.

### 2.3 Quản lý dữ liệu thời gian (TimescaleDB Integration)
* Bảng `pcb_results` được thiết kế dưới dạng Hypertable (Time-series data) trên TimescaleDB, cho phép truy vấn aggregate tổng sản lượng theo giờ/ngày/tuần với tốc độ xử lý hàng triệu bản ghi sub-second.

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
