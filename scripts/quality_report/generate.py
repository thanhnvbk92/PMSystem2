"""Generate the monthly NTF / Re-test / RTY report into the Reports folder.

python generate.py --month 2026-11 --out-dir "D:/1. Project/PMSystem2/Reports"
Started by the backend (POST /api/v1/reports/generate); each line printed here is shown on the web.
The connection string comes from PMS_CONNECTION (set by the backend) or backend/appsettings.Local.json.
"""
import argparse, json, os, re, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import qfast, improvements  # noqa: E402
import datetime as dt  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--month", required=True)
ap.add_argument("--out-dir", required=True)
args = ap.parse_args()
if not re.fullmatch(r"\d{4}-\d{2}", args.month):
    raise SystemExit("--month must be YYYY-MM")
os.makedirs(args.out_dir, exist_ok=True)
t0 = time.time()

print("STEP 1/3 Reading statistics tables", flush=True)
cfg = json.load(open(os.path.join(HERE, "report_config.json"), encoding="utf-8"))
data = qfast.collect(args.month, cfg)
lst = os.path.join(args.out_dir, cfg.get("improvement_list", "ImprovementList.xlsx"))
print(f"STEP 1/3 Verifying improvements ({os.path.basename(lst)})", flush=True)
conn = qfast.connect()
data["improvements"] = improvements.analyze(conn, lst, dt.date.fromisoformat(data["meta"]["report_end"][:10]),
                                            cfg.get("excluded_error_codes", ["UNKNOWN", "UNKNOWN_DEFECT"]), cfg.get("not_a_test_regex"))
conn.close()

with tempfile.TemporaryDirectory() as tmp:
    data_path = os.path.join(tmp, "data.json")
    json.dump(data, open(data_path, "w", encoding="utf-8"), ensure_ascii=False)
    print("STEP 2/3 Building PowerPoint", flush=True)
    tmp_pptx = os.path.join(tmp, "report.pptx")
    env = dict(os.environ, DATA_M=data_path, PYTHONIOENCODING="utf-8")
    subprocess.run([sys.executable, os.path.join(HERE, "build_monthly.py"), tmp_pptx], env=env, check=True)
    print("STEP 3/3 Saving report", flush=True)
    final = os.path.join(args.out_dir, f"Monthly_Quality_Report_{args.month}.pptx")
    part = final + ".part"
    with open(tmp_pptx, "rb") as src, open(part, "wb") as dst:
        dst.write(src.read())
    os.replace(part, final)          # atomic: the web never lists a half-written file
print(f"DONE {os.path.basename(final)} in {time.time() - t0:.0f}s", flush=True)
