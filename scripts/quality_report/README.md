# Monthly Quality Report (NTF · Re-test · RTY)

Generated from the web: **Xem báo cáo → choose month → Xuất báo cáo** (`POST /api/v1/reports/generate?month=YYYY-MM`).
The backend runs `generate.py`, which writes `Reports/Monthly_Quality_Report_YYYY-MM.pptx`
(design: `Report Template/23.1.Haengsung Template.pptx`, pre-built frame in `assets/skeleton_monthly.pptx`).

| File | Role |
|---|---|
| `report_config.json` | improvement review settings: focus / control line, model groups, baseline and improvement start |
| `qfast.py` | data from the statistics tables (seconds–minutes) |
| `build_monthly.py`, `pptlib.py` | slides |
| `generate.py` | qfast → build → atomic save into `Reports/` |
| `make_skeleton.py` | rebuilds `assets/skeleton_monthly.pptx` from the template (needs the pptx skill's `add_slide.py`) |

Manual run: `python -I generate.py --month 2026-11 --out-dir ../../Reports`
(connection string from `PMS_CONNECTION` or `backend/appsettings.Local.json`; Python packages: python-pptx, psycopg2-binary, lxml).

## Definitions
- **Re-test** = NG test attempts / test attempts (`pcb_analytics_daily`, factory wall-clock day).
- **NTF** = PID–Station pairs ever NG / pairs, cohort = first test at the station in the period (`pcb_ntf_summaries`).
- **RTY** = PCBs that passed every station first time / PCBs, cohort = first test in the period.
  Plant: all stations (`pcb_rty_summaries`); line: stations of the line; station: that station.
- **Model** = Job File mapping (Master Data), else the model id sent by the PC. Effective model 0 (Unassigned) and
  `DEFECT_UNSPECIFIED` rows are excluded. Tests with an infinite / future start time fall outside every period.
