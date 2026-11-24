# Tự động dọn ổ cứng theo quy tắc — Thiết kế (v2)

> **Trạng thái triển khai (2026-11-24)** — đã code:
> - Backend: `DiskCleanupController` (`GET/PUT /api/v1/disk-cleanup/config`, `GET/POST /api/v1/disk-cleanup/reports`), cấu hình lưu JSON trong `app_settings` key `diskcleanup.config`, bảng `disk_cleanup_reports` (báo cáo mới nhất mỗi PC + lần dọn gần nhất), SignalR `NotifyDiskCleanupUpdated`, cảnh báo `DiskFull` lên dashboard khi dọn xong vẫn trên ngưỡng OK.
> - Frontend: trang **Giám Sát PC → Dọn Ổ Cứng** (`#pc-disk-cleanup`).
> - Backup_Log2 (branch `disk-cleanup`): `DiskCleanupService`, lệnh `disk.cleanup.preview` / `disk.cleanup.run` / `disk.cleanup.reload`.
> - Khác thiết kế: chưa làm `RequireFtpBackup` (dùng `KeepDays` + `DryRun` thay thế); lịch sử chỉ giữ báo cáo mới nhất mỗi PC.

## 1. Tổng quan
- **Frontend (PMSystem2)**: trang "Dọn ổ cứng" để cài ngưỡng + danh sách quy tắc (thư mục, dạng file, kiểu xóa).
- **Backend**: lưu cấu hình, đẩy xuống máy test qua SignalR (`CommandHub`, nhóm theo MAC/line/station đã có), nhận lịch sử dọn.
- **Backup_Log2 (máy test)**: kiểm tra ổ định kỳ, khi vượt ngưỡng thì thực thi quy tắc, báo kết quả về server.

## 2. Ngưỡng
| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `TriggerUsedPercent` | **80%** | Ổ dùng > 80% → bắt đầu dọn |
| `OkUsedPercent` | **70%** | Dọn tới khi ổ dùng ≤ 70% thì dừng |
| `CheckIntervalMinutes` | 30 | Chu kỳ kiểm tra |

Ngưỡng OK phải < ngưỡng Trigger (validate ở frontend + backend). Khoảng cách 10% để không bị dọn liên tục mỗi chu kỳ.
Ngưỡng tính **theo ổ chứa thư mục của quy tắc** (rule ở D:\ thì xét ổ D:, rule ở C:\ thì xét ổ C:) — mỗi ổ chạy độc lập.

## 3. Quy tắc (mỗi dòng trên trang cài đặt)
| Trường | Ví dụ | Ghi chú |
|---|---|---|
| `Folder` | `D:\LGE\Temp` | Thư mục gốc |
| `Pattern` | `*.bmp;*.tmp` | Nhiều pattern cách nhau `;` |
| `IncludeSubfolders` | ✔ | |
| `Mode` | **OldestFirst** (mặc định) / DeleteAll | |
| `KeepDays` | 0 | Không xóa file mới hơn N ngày (cả 2 mode) |
| `RequireFtpBackup` | ☐ | Chỉ xóa khi file đã có trên FTP (bật cho thư mục log) |
| `DryRun` | ✔ (rule mới) | Chỉ liệt kê, không xóa |
| `Enabled` | ✔ | |

**Phạm vi áp dụng**: một bộ quy tắc chung cho **toàn bộ máy** (không phân cấp line/station/máy).

**Máy không có thư mục / không có ổ**:
- Rule đó được coi là **N/A** trên máy đó → bỏ qua, không phải lỗi; các rule khác chạy bình thường.
- Mỗi máy báo trạng thái từng rule về server: `Cleaned` / `FolderNotFound` / `Blocked` (nằm trong danh sách cấm) / `DryRun`.
- Trang cài đặt hiển thị mỗi rule: "Áp dụng: X máy · N/A: Y máy" (bấm xem danh sách) → phát hiện rule gõ sai đường dẫn (N/A toàn bộ).
- Đường dẫn linh hoạt: biến `{LogFolder}` (thay bằng LogFolder của từng máy), ký tự đại diện `D:\LGE\*\RESULT` (khớp mọi thư mục con tồn tại).

## 4. Thuật toán (mỗi ổ)
```
used = (Total - Free) / Total
nếu used <= Trigger → thoát

PHA 1 — DeleteAll (ưu tiên):
  với mỗi rule Mode=DeleteAll (trên ổ này):
      xóa toàn bộ file khớp Pattern (trừ KeepDays / file bị khóa / chưa backup FTP nếu bật)
  (pha 1 luôn chạy hết, không dừng giữa chừng)
  tính lại used; nếu used <= Ok → xong

PHA 2 — OldestFirst:
  gộp file của TẤT CẢ rule OldestFirst trên ổ này thành 1 danh sách
  sắp xếp LastWriteTime tăng dần (cũ nhất trước)
  for file: xóa; trừ dần dung lượng; nếu used <= Ok → dừng

Nếu hết file mà vẫn > Ok → gửi CẢNH BÁO về server (PC monitor tô đỏ).
Cuối cùng: xóa thư mục con rỗng (không xóa thư mục gốc của rule).
```
Pha 2 gộp chung toàn bộ rule để file cũ nhất trên ổ luôn bị xóa trước, bất kể thuộc rule nào. (Nếu muốn ưu tiên theo thứ tự rule thì thêm trường `Priority` — có thể bổ sung sau.)

## 5. An toàn (bắt buộc ở phía Backup_Log2, không tin hoàn toàn cấu hình từ server)
1. **Danh sách cấm cứng**: gốc ổ (`C:\`, `D:\`), `C:\Windows`, `Program Files*`, `ProgramData`, `C:\Users\*` (trừ thư mục con được chỉ định rõ), thư mục cài Backup_Log2. Rule trỏ vào đây → bỏ qua + báo lỗi.
2. **Không xóa file đang mở / mới ghi** (< 10 phút).
3. **DryRun** theo từng rule: chỉ liệt kê file sẽ xóa + tổng dung lượng. Rule mới tạo mặc định bật DryRun.
4. **Nút "Xem trước"** trên frontend: gửi lệnh xuống 1 máy, trả về số file + GB sẽ bị xóa theo rule đó.
5. Ghi log từng file đã xóa (đường dẫn, size, rule, pha) trên máy; gửi bản tổng kết về server.
6. Mất kết nối server → dùng cấu hình đã cache local lần gần nhất.

## 6. Các phần cần làm
### Backend (`backend/`)
- Model + bảng: `disk_cleanup_settings` (1 dòng: trigger, ok, interval), `disk_cleanup_rules` (folder, pattern, include_sub, mode, keep_days, require_ftp, dry_run, enabled), `disk_cleanup_history` (mac, drive, time, used_before, used_after, files_phase1, files_phase2, bytes_freed, warning), `disk_cleanup_rule_status` (mac, rule_id, status, last_time, bytes_freed).
- `DiskCleanupController`: GET/PUT settings theo scope; GET rules (`/api/disk-cleanup/rules`); POST/GET history.
- `CommandHub`: sau khi lưu → gửi `NotifyDiskCleanupUpdated` tới nhóm liên quan (giống `NotifyMasterDataUpdated`).

### Frontend (`frontend/src/components/DiskCleanup.jsx` + Sidebar)
- 2 ô ngưỡng (Trigger %, OK %) + chu kỳ.
- Bảng rule: thêm/sửa/xóa/bật-tắt, chọn Mode (mặc định "Từ cũ đến mới"), nút Xem trước.
- Tab lịch sử: lần dọn gần nhất mỗi máy, GB giải phóng, cảnh báo.
- PC monitor: cột % dùng ổ (telemetry đã có), đỏ khi > Trigger, nút "Dọn ngay".

### Backup_Log2
- `Services/Business/DiskCleanupService.cs`: thuật toán mục 4 + an toàn mục 5.
- `DiskCleanupJob` (Quartz) chạy theo `CheckIntervalMinutes`; chạy thêm sau mỗi lần backup xong.
- `CommandSignalRClientService`: handler `NotifyDiskCleanupUpdated` → tải lại cấu hình; lệnh `disk.cleanup.preview` / `disk.cleanup.run`.
- Kiểm tra FTP (khi `RequireFtpBackup`): tái dùng logic so tên+size của `FileTransferService`.

## 7. Lộ trình
1. Backend model/API + trang frontend cấu hình (chưa ảnh hưởng máy test).
2. Backup_Log2: service chỉ chạy DryRun + gửi kết quả xem trước.
3. Thử 2–3 máy, đối chiếu danh sách file sẽ xóa.
4. Tắt DryRun theo từng rule/line.
