# Dashboard: nguồn dữ liệu, tốc độ và panel Worst

Ngày kiểm tra: 2026-11-20, chạy trên DB local `pmsystem2` (`pcb_results` khoảng 31 triệu dòng, khoảng 3,5 triệu dòng mỗi tháng).

## 1. Data của Dashboard lấy từ đâu

| Phần trên trang | API | Trước khi sửa | Sau khi sửa (tuần / tháng / năm) |
|---|---|---|---|
| 5 thẻ KPI (Tổng, OK, NG, FPY, donut) | `/production/summary` và `/production/counters` (counters gọi mỗi 5 s) | quét `pcb_results` | `pcb_analytics_daily` (rollup theo ngày, do trigger cập nhật) |
| Biểu đồ Sản lượng & Pass theo thời gian | `/production/stats/hourly` | quét `pcb_results`, nhóm theo giờ | rollup, mỗi ngày một bucket |
| Biểu đồ theo Line / Top 10 Station | `/production/stats/station-yield` | quét `pcb_results` | rollup |
| Thẻ Retest | `/production/quality-modes` | quét `pcb_results` | rollup |
| Thẻ NTF / RTY | `/production/quality-modes` | DISTINCT PID trên `pcb_results` rồi JOIN với summary (26 triệu dòng) | `pcb_ntf_summaries` / `pcb_rty_summaries` theo cohort, 2 query chạy song song |
| **Panel Worst (mới)** | `/production/dashboard/worst` | — | rollup |

Với "Hôm nay" (khoảng 48 h trở xuống) trang vẫn đọc bảng thô `pcb_results` để biểu đồ chia được theo giờ (đã nhanh, dưới 0,5 s).

## 2. Vì sao tháng load lâu: số đo trước và sau khi sửa (tháng 11, 1,44 triệu bản ghi)

| API | Trước | Sau |
|---|---|---|
| quality-modes | 61,9 s | 4,6 s, sau đó cache 5 phút |
| summary | 16,1 s | 0,01 s |
| stats/hourly | 8,8 s | 0,11 s |
| stats/station-yield | 7,5 s | 0,09 s |
| counters (mỗi 5 s) | 7,5 s | 0,18 s |
| dashboard/worst | — | 0,7 s |

Nguyên nhân:
1. Mọi thẻ đều quét lại toàn bộ bản ghi thô của cả tháng, mỗi thẻ một lần. Dữ liệu tổng hợp theo ngày (`pcb_analytics_daily`) đã có sẵn và trang BI đang dùng, nhưng Dashboard thì không.
2. `counters` được gọi mỗi 5 s nhưng mỗi lần chạy mất 7,5 s, nên DB lúc nào cũng có query tháng đang chạy.
3. `summary` tự tính thêm hourly (frontend không dùng phần này), nên tốn gấp đôi.
4. Cache của quality-modes dùng `_productionVersion` làm key. Giá trị này tăng mỗi khi có PCB mới, nên cache gần như không bao giờ trúng.
5. Ở frontend, biểu đồ station phải chờ NTF/RTY trả về (cùng một `Promise.all`). Giờ mỗi phần hiển thị ngay khi request của nó xong.

## 3. Quy ước thời gian (đính chính, 2026-11-20 tối)

Bản đầu của tài liệu này kết luận rằng "Hôm nay" bị lệch 7 tiếng và đã đổi bộ lọc sang `ToDbFilterTime`. **Kết luận đó sai** và đã được hoàn nguyên.

- Dữ liệu ghi vào theo thời gian thực có `inspect_time` / `start_time` là **thời điểm thật (UTC)**. Kiểm chứng: `inspect_time` luôn trùng `created_at` (UTC) trong suốt tháng 11. Ví dụ: test lúc 21:30 giờ nhà máy được lưu là 14:30Z.
- Code cũ (`EnsureUtc` + Npgsql legacy timestamp) cắt ngày tại 00:00 +07 và đặt nhãn giờ theo giờ nhà máy, tức là đúng. Bản "sửa" khiến biểu đồ "Hôm nay" dừng ở khoảng 16h, vì test lúc 21h bị đếm vào cột 14h.
- Mốc thời gian của NTF/RTY cũng được hiểu là giờ nhà máy (+07).
- **Còn tồn tại (chưa sửa, cần quyết định):** trigger `pcb_analytics_daily` và `QualityReportDataService` coi `inspect_time` là "giờ nhà máy gắn nhãn UTC". Hậu quả là một "ngày" trong rollup thực ra chạy từ 07:00 đến 07:00 giờ nhà máy. Điều này ảnh hưởng tới khung tuần/tháng/năm của Dashboard (lệch 7 h ở hai đầu kỳ), trang BI và báo cáo tháng. Muốn sửa thì phải đổi trigger để chia ngày theo `Asia/Bangkok`, rồi dựng lại bảng rollup.

## 4. Thay đổi định nghĩa NTF / RTY (cần anh/chị xác nhận)

NTF / RTY giờ tính trên **cohort PCB test lần đầu trong kỳ**, giống báo cáo NTF (`QualityReportDataService`). Trước đây thì tính trên "PCB có test trong kỳ". Ví dụ hôm nay: NTF 2,12% (trước là 2,66%, nhưng con số đó còn bị lệch 7 h), RTY 95,7%. Nếu muốn giữ định nghĩa cũ thì báo lại, tôi sẽ đổi lại (nhưng sẽ chậm hơn).

## 5. Panel "Worst & Cảnh báo sớm" (mới, ngay dưới 3 thẻ Retest/NTF/RTY)

- **Dải cảnh báo**: các Station / Jig / Mã lỗi / Model tăng NG đột biến vào ngày cuối của kỳ (với kỳ hiện tại là hôm nay), so với 7 ngày trước đó. Điều kiện: ít nhất 5 NG, ít nhất 30 test, và tỉ lệ NG ≥ max(1,5 lần, cộng thêm 1 điểm %) so với 7 ngày trước. Ví dụ thật hôm nay: *Jig 2 RF5G Line 1-2: 65,6% hôm nay so với 3,2% bảy ngày trước*.
- **4 danh sách Top 5**: Worst Station, Worst Jig, Top Mã lỗi (Pareto, kèm station lỗi nhiều nhất), Worst Model.
  - Thứ tự xếp theo **số NG vượt mức trung bình**, tức NG − Tổng × tỉ lệ NG trung bình. Nhờ vậy một station sản lượng lớn có tỉ lệ bình thường không đè lên một jig nhỏ nhưng hỏng nặng. Mục có dưới 30 test bị bỏ qua.
  - Badge "↑ x%" cho mục đang tăng đột biến. Di chuột lên một dòng để xem NG/Tổng, % tổng NG và hôm nay so với 7 ngày trước.

## 6. Kiểm tra

`tests/DashboardChecks` là bộ kiểm tra chỉ đọc, so mọi số liệu với SQL độc lập trên DB local, cho cả "hôm nay" và "tháng này". Kết quả: **30/30 PASS**.

```
dotnet run --project tests/DashboardChecks -- "D:/1. Project/PMSystem2/backend/appsettings.Local.json"
```

Chưa làm: chưa xem giao diện panel mới trên trình duyệt, vì backend đang chạy (port 5000) là bản cũ. Cần build lại backend và frontend rồi mở trang Dashboard.

## 7. Gợi ý thêm (chưa làm, vì cần tạo index trên DB production)

NTF/RTY cho tháng vẫn mất khoảng 4,6 s, do phải seq scan 5 GB `pcb_ntf_summaries`. Có thể tạo index covering, dự kiến dưới 0,5 s:

```sql
CREATE INDEX CONCURRENTLY ix_pcb_ntf_summaries_first_test_cover
  ON pcb_ntf_summaries (first_test_time) INCLUDE (station_id, ever_ng) WHERE pid <> 'None';
CREATE INDEX CONCURRENTLY ix_pcb_rty_summaries_first_test_cover
  ON pcb_rty_summaries (first_test_time) INCLUDE (ever_ng) WHERE pid <> 'None';
```
