# Báo cáo họp tuần NTF · Re-test · FPY

Sinh file PowerPoint theo template `Report Template/23.1.Haengsung Template.pptx`
từ API PMSystem2 (`/api/v1/production/quality-modes`, `stats/defect-pareto`).

1. Sửa `END` (thứ Hai đầu tuần sau tuần báo cáo, giờ VN) trong `fetch.py` và `build.py`;
   các nhãn `W46`/`W45` trong `build.py` cũng đổi theo tuần mới.
2. `python -I fetch.py` → `data.json` (~1 giờ; chỉ 2 truy vấn song song để không tải nặng DB).
3. Tạo `skeleton.pptx` từ template: giữ slide 7 (bìa), 8 (mục lục), 17 (nhân 7 bản bằng
   `add_slide.py` của skill pptx), 12 (trang cuối), rồi `python fix_sections.py build skeleton.pptx`.
4. `python build.py report.pptx`, copy vào thư mục `Reports/` → hiện trong nút **Xem báo cáo** trên web.

FPY toàn hệ thống = RTY của API. FPY cấp Line/Station = 100% − NTF (API không lọc RTY theo Line/Station).
