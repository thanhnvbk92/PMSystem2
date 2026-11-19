"""Verify the effect of each improvement in Reports/ImprovementList.xlsx.

Per improvement (line, station, error code, model, date):
  KPI   = NG attempts with that error code (family) per 1,000 test attempts, at that line + station + model
  before = 28 days before the date, after = up to 28 days after the date (the action day itself excluded)
  test  = two-proportion z-test (after vs before)
  control = same station name + model + code on lines without an action on that station within +-28 days
Source: pcb_analytics_daily (factory wall-clock days), model = Job File mapping, else model id."""
import datetime as dt, json, math, os, sys
from collections import defaultdict
import openpyxl, psycopg2
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SRC = r"D:\1. Project\PMSystem2\Reports\ImprovementList.xlsx"
OUT = sys.argv[1]
TODAY = dt.date(2026, 11, 19)          # exclusive: data until 18 Nov
WIN = 28

wb = openpyxl.load_workbook(SRC, data_only=True)
items = []
for r in wb.worksheets[0].iter_rows(values_only=True):
    if not r or r[0] is None: continue
    line, station, code, model, action, date = (list(r) + [None] * 6)[:6]
    d = date.date() if isinstance(date, dt.datetime) else dt.date.fromisoformat(str(date)[:10])
    items.append(dict(line=str(line).strip(), station=str(station).strip(), code=str(code).strip(),
                      model=str(model).strip(), action=(action or "").strip(), date=d))

cfg = json.load(open(r"D:\1. Project\PMSystem2\backend\appsettings.Local.json", encoding="utf-8"))
kv = {k.strip().lower(): v for k, v in (p.split("=", 1) for p in cfg["ConnectionStrings"]["DefaultConnection"].split(";") if "=" in p)}
conn = psycopg2.connect(host=kv["host"], port=kv["port"], dbname=kv["database"], user=kv["username"], password=kv["password"],
                        application_name="improvement verification (read-only)")
conn.set_session(readonly=True, autocommit=True)
cur = conn.cursor()
cur.execute("SELECT id, name FROM models"); model_name = dict(cur.fetchall())
cur.execute("SELECT job_file, model_id FROM job_file_model_mappings WHERE model_id IS NOT NULL"); job_model = dict(cur.fetchall())
cur.execute("SELECT s.id, l.name, s.name FROM stations s JOIN lines l ON l.id = s.line_id")
st = {i: (ln, sn) for i, ln, sn in cur.fetchall()}
names = {it["station"] for it in items}
sids = [i for i, (ln, sn) in st.items() if sn in names]
start = min(it["date"] for it in items) - dt.timedelta(days=WIN + 7)
cur.execute("""SELECT bucket_date, station_id, job_file, model_id, result, error_code, sum(total_count)::bigint
               FROM pcb_analytics_daily
               WHERE bucket_date >= %s AND bucket_date < %s AND station_id = ANY(%s) AND error_code <> 'DEFECT_UNSPECIFIED'
               GROUP BY 1, 2, 3, 4, 5, 6""", (start, TODAY, sids))
tests = defaultdict(int)                 # (day, line, station, model) -> attempts
ngc = defaultdict(int)                   # (day, line, station, model, code) -> NG attempts
for day, sid, job, mid, res, code, n in cur.fetchall():
    m = job_model.get(job) or mid or 0
    if m == 0: continue
    ln, sn = st[sid]; mn = model_name.get(m, f"model {m}")
    tests[(day, ln, sn, mn)] += n
    if res in ("NG", "FAIL"): ngc[(day, ln, sn, mn, code or "")] += n
conn.close()

def in_family(code, fam):
    return code == fam or code.startswith(fam + "|") or code.endswith("] " + fam) or code.endswith(" " + fam)

def agg(ln, sn, mn, fam, a, b):
    t = sum(v for (d, l, s, m), v in tests.items() if l == ln and s == sn and m == mn and a <= d < b)
    k = sum(v for (d, l, s, m, c), v in ngc.items() if l == ln and s == sn and m == mn and a <= d < b and in_family(c, fam))
    allng = sum(v for (d, l, s, m, c), v in ngc.items() if l == ln and s == sn and m == mn and a <= d < b)
    return t, k, allng

def ztest(k1, n1, k2, n2):
    if not n1 or not n2: return None
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) if 0 < p < 1 else 0
    if se == 0: return None
    z = (k2 / n2 - k1 / n1) / se
    return math.erfc(abs(z) / math.sqrt(2))

rows = []
for it in items:
    d = it["date"]
    b0, b1 = d - dt.timedelta(days=WIN), d
    a0, a1 = d + dt.timedelta(days=1), min(d + dt.timedelta(days=WIN + 1), TODAY)
    tb, kb, ngb = agg(it["line"], it["station"], it["model"], it["code"], b0, b1)
    ta, ka, nga = agg(it["line"], it["station"], it["model"], it["code"], a0, a1)
    rb = kb * 1000 / tb if tb else None; ra = ka * 1000 / ta if ta else None
    rel = (ra - rb) / rb * 100 if rb else None
    pval = ztest(kb, tb, ka, ta)
    rtb = ngb * 100 / tb if tb else None; rta = nga * 100 / ta if ta else None
    # controls: same station name + model on other lines without an action on that station within the window
    acted = {x["line"] for x in items if x["station"] == it["station"] and abs((x["date"] - d).days) <= WIN}
    ctl_lines = sorted({l for (_, l, s, m) in tests if s == it["station"] and m == it["model"] and l not in acted})
    ctb = cka = ctta = ckb = 0
    for l in ctl_lines:
        t1, k1, _ = agg(l, it["station"], it["model"], it["code"], b0, b1); t2, k2, _ = agg(l, it["station"], it["model"], it["code"], a0, a1)
        ctb += t1; ckb += k1; ctta += t2; cka += k2
    crb = ckb * 1000 / ctb if ctb > 2000 else None; cra = cka * 1000 / ctta if ctta > 2000 else None
    crel = (cra - crb) / crb * 100 if crb and cra is not None else None
    after_days = (a1 - a0).days
    if ta < 2000 or after_days < 7:
        verdict = "Chưa đủ dữ liệu"
    elif rb is None or tb < 2000:
        verdict = "Không có dữ liệu trước"
    elif rb == 0 and ra == 0:
        verdict = "Mã lỗi không xuất hiện"
    elif rel is not None and rel <= -30 and pval is not None and pval < 0.05:
        verdict = "Hiệu quả"
    elif rel is not None and rel < -10:
        verdict = "Có cải thiện, chưa chắc chắn" if (pval is None or pval >= 0.05) else "Giảm nhẹ (có ý nghĩa)"
    elif rel is not None and rel > 0 and pval is not None and pval < 0.05:
        verdict = "Xấu đi"
    else:
        verdict = "Chưa thấy hiệu quả"
    note = []
    if crel is not None and rel is not None and rel < 0 and crel <= rel * 0.6:
        note.append(f"đối chứng cũng giảm {crel:+.0f}% → khó quy cho cải tiến")
    if after_days < WIN: note.append(f"sau mới có {after_days} ngày")
    if it["station"] in ("RF4G", "RF5G") and "QUTS" in it["action"]:
        note.append("đổi chương trình: tên mã lỗi có thể thay đổi, xem cả Re-test Station")
    key = (it["line"], it["station"], it["code"], str(it["date"]))
    EXTRA = {
        ("Line 3-2", "RF4G", "SUB6 - RunAllSequences", "2026-10-30"): ("Không kiểm chứng được",
            "sau 30/10 các job Wave High Main của RF4G/RF5G Line 3-2 gần như không còn trong PMSystem2 (log chương trình QUTS chưa được upload)"),
        ("Line 3-2", "RF5G", "SUB6 - RunAllSequences", "2026-10-30"): ("Không kiểm chứng được",
            "sau 30/10 các job Wave High Main của RF4G/RF5G Line 3-2 gần như không còn trong PMSystem2 (log chương trình QUTS chưa được upload)"),
        ("Line 6-1", "FID", "READ_NORMAL_CURRENT(mA)", "2026-10-21"): ("Hiệu quả một phần",
            "cùng lúc đổi job FID_CURRENT_Ver1.4_261020; mã mới [34465A] READ_BOOT_CURRENT(mA) tăng 1.25 → 48.6/1k (lỗi chuyển mã); Re-test Station vẫn giảm 18.6% → 6.1%"),
        ("Line 6-1", "RF5G", "[34465A] READ_CURRENT(mA)", "2026-10-13"): ("Mã lỗi không xuất hiện",
            "mã này chỉ có ở FID (ICON25 NAD); dòng này có thể nhập nhầm Station và chưa ghi hành động"),
    }
    if key in EXTRA:
        verdict, extra_note = EXTRA[key]; note.insert(0, extra_note)
    rows.append(dict(it, before=f"{b0:%d/%m}–{(b1 - dt.timedelta(days=1)):%d/%m}", after=f"{a0:%d/%m}–{(a1 - dt.timedelta(days=1)):%d/%m}",
                     tb=tb, kb=kb, rb=rb, ta=ta, ka=ka, ra=ra, rel=rel, p=pval, rtb=rtb, rta=rta,
                     ctl=", ".join(ctl_lines) or "—", crb=crb, cra=cra, crel=crel, verdict=verdict, note="; ".join(note)))
    print(f"{it['line']:8} {it['station']:9} {it['code'][:28]:28} {it['date']} rate {rb if rb is None else round(rb,2)} -> "
          f"{ra if ra is None else round(ra,2)} ({'' if rel is None else f'{rel:+.0f}%'}) p={'' if pval is None else f'{pval:.3g}'} "
          f"| RT {rtb and round(rtb,2)} -> {rta and round(rta,2)} | ctl {crel and round(crel)} | {verdict}")

# weekly NG/1k for each improvement (for the trend sheet)
def week_rows(it):
    out = []
    w = it["date"] - dt.timedelta(days=it["date"].weekday()) - dt.timedelta(weeks=6)
    while w < TODAY:
        e = min(w + dt.timedelta(days=7), TODAY)
        t, k, _ = agg(it["line"], it["station"], it["model"], it["code"], w, e)
        out.append((w, t, k))
        w += dt.timedelta(days=7)
    return out

# ---------- Excel ----------
ow = openpyxl.Workbook(); ws = ow.active; ws.title = "Verification"
hdr = ["#", "Line", "Station", "Error code", "Model", "Action", "Date", "Before", "Tests before", "NG before", "NG/1k before",
       "After", "Tests after", "NG after", "NG/1k after", "Change %", "p-value", "Station Re-test % before", "Station Re-test % after",
       "Control lines", "Control NG/1k before", "Control NG/1k after", "Control change %", "Verdict", "Note"]
ws.append(hdr)
fills = {"Hiệu quả": "C6EFCE", "Xấu đi": "FFC7CE", "Có cải thiện, chưa chắc chắn": "FFEB9C", "Giảm nhẹ (có ý nghĩa)": "E2EFDA",
         "Chưa đủ dữ liệu": "EDEDED", "Chưa thấy hiệu quả": "FCE4D6"}
for i, r in enumerate(rows, 1):
    ws.append([i, r["line"], r["station"], r["code"], r["model"], r["action"], r["date"], r["before"], r["tb"], r["kb"],
               None if r["rb"] is None else round(r["rb"], 2), r["after"], r["ta"], r["ka"], None if r["ra"] is None else round(r["ra"], 2),
               None if r["rel"] is None else round(r["rel"], 1), None if r["p"] is None else float(f"{r['p']:.3g}"),
               None if r["rtb"] is None else round(r["rtb"], 2), None if r["rta"] is None else round(r["rta"], 2),
               r["ctl"], None if r["crb"] is None else round(r["crb"], 2), None if r["cra"] is None else round(r["cra"], 2),
               None if r["crel"] is None else round(r["crel"], 1), r["verdict"], r["note"]])
    ws.cell(i + 1, 24).fill = PatternFill("solid", fgColor=fills.get(r["verdict"], "FFFFFF"))
    ws.cell(i + 1, 7).number_format = "yyyy-mm-dd"
thin = Side(style="thin", color="BFBFBF")
for c in ws[1]:
    c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="000000")
    c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
    for c in row:
        c.border = Border(top=thin, bottom=thin, left=thin, right=thin)
        if c.row > 1: c.alignment = Alignment(wrap_text=True, vertical="top")
widths = [4, 9, 10, 26, 18, 40, 11, 12, 10, 9, 10, 12, 10, 9, 10, 9, 9, 11, 11, 16, 11, 11, 10, 22, 40]
for j, w_ in enumerate(widths, 1): ws.column_dimensions[get_column_letter(j)].width = w_
ws.row_dimensions[1].height = 45; ws.freeze_panes = "E2"

wt = ow.create_sheet("Weekly trend")
wt.append(["#", "Line", "Station", "Error code", "Model", "Week (Mon)", "Tests", "NG (code)", "NG/1k", "After action?"])
for i, it in enumerate(items, 1):
    for w, t, k in week_rows(it):
        wt.append([i, it["line"], it["station"], it["code"], it["model"], w, t, k, round(k * 1000 / t, 2) if t else None,
                   "after" if w + dt.timedelta(days=3) > it["date"] else "before"])
        wt.cell(wt.max_row, 6).number_format = "yyyy-mm-dd"
for c in wt[1]: c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="000000")
for j, w_ in enumerate([4, 9, 10, 28, 18, 12, 9, 9, 9, 12], 1): wt.column_dimensions[get_column_letter(j)].width = w_

nt = ow.create_sheet("Method")
for line in ["KPI: NG attempts with the improvement's error code (incl. sub-codes 'CODE|...' and instrument prefixes '[...] CODE') per 1,000 test attempts,",
             "     at the improvement's line + station + model (model = Job File mapping, else model id). Source: pcb_analytics_daily (factory wall-clock days).",
             f"Before = {WIN} days before the action date; After = up to {WIN} days after (action day excluded); data until {TODAY - dt.timedelta(days=1)}.",
             "p-value: two-proportion z-test after vs before. 'Hiệu quả' = NG/1k down >= 30% and p < 0.05.",
             "Control: same station name + model + code on lines with no action on that station within +-28 days (difference-in-differences check).",
             "Station Re-test % = all NG attempts / test attempts of that station + model (all error codes)."]:
    nt.append([line])
nt.column_dimensions["A"].width = 150
ow.save(OUT)
print("saved", OUT)
