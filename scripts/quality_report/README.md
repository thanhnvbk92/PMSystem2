# NTF · Re-test · FPY reports (English)

Weekly and monthly decks on the `Report Template/23.1.Haengsung Template.pptx` design, saved to
`Reports/` so they appear under the **Xem báo cáo** button of the web UI.

1. `python -I qdata.py` – reads `pcb_results` directly (connection from `backend/appsettings.Local.json`),
   writes `data.json` (week) and `data_m.json` (month), ~35 min. Edit the dates at the top first
   (`WIN_FROM/WIN_TO`, weekly `END`, monthly `RM/RE`, `BEFORE/AFTER`, focus/control line).
2. Skeletons from the template: weekly = `fix_sections.py` on an unpacked template keeping slides
   7, 8, 17 (+6 copies via the pptx skill's `add_slide.py`), 12; monthly =
   `python make_skeleton.py <pptx skill dir> <template> skeleton_m.pptx`.
3. `python build_w.py report_w.pptx` / `python build_m.py report_m.pptx`, then copy into `Reports/`.

Definitions = PMSystem2 `/production/quality-modes`:
- Re-test = NG attempts / attempts; NTF = PID–Station pairs ever NG / pairs tested; FPY = plant PIDs never NG / PIDs.
- `DEFECT_UNSPECIFIED` and unassigned-model rows excluded. Periods by **test start time** on the factory clock
  (`start_time AT TIME ZONE 'UTC'`). "Ever NG" comes from the full history in `pcb_results`.
- Line/Station FPY = 100% − NTF. Tests with an infinite or future start time fall outside every period.
