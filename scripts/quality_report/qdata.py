"""Report data straight from pcb_results (read-only), PMSystem2 definitions, factory wall clock.

Periods are cut on the test START time: start_time is timestamptz holding the factory clock with a
UTC marker, so the wall clock is (start_time AT TIME ZONE 'UTC'). Definitions = /production/quality-modes:
  Re-test = NG attempts / attempts       (DEFECT_UNSPECIFIED and unassigned-model rows excluded, as the API)
  NTF     = PID-Station pairs tested in scope that were ever NG at that station (full history,
            DEFECT_UNSPECIFIED and unassigned-model rows excluded, as pcb_ntf_summaries)
  FPY     = plant-wide PIDs tested in period never NG at any station (as pcb_rty_summaries)
'Ever NG' is recomputed from pcb_results because the summaries of ~806k merged PIDs are stale.
Writes data.json (weekly report) and data_m.json (monthly report)."""
import json, os, datetime as dt, time
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(r"D:\1. Project\PMSystem2\backend\appsettings.Local.json", encoding="utf-8"))
cs = dict(p.split("=", 1) for p in cfg["ConnectionStrings"]["DefaultConnection"].split(";") if "=" in p)
conn = psycopg2.connect(host=cs["Host"], port=cs["Port"], dbname=cs["Database"], user=cs["Username"], password=cs["Password"],
                        application_name="quality-report (read-only)")
# Only SELECTs and session-local TEMP tables (dropped on disconnect); no permanent table is written.
conn.autocommit = True
cur = conn.cursor()
t0 = time.time()
def log(m): print(f"[{time.time() - t0:6.1f}s] {m}", flush=True)

WIN_FROM, WIN_TO = dt.date(2026, 6, 1), dt.date(2026, 11, 19)   # wall-clock window, end exclusive

cur.execute("""
CREATE TEMP TABLE w AS
SELECT p.pid, p.station_id, COALESCE(s.line_id, 0) AS line_id, (p.start_time AT TIME ZONE 'UTC') AS t,
       p.result IN ('NG','FAIL') AS ng, COALESCE(p.error_code, 'UNKNOWN_DEFECT') AS error_code
FROM pcb_results p
LEFT JOIN stations s ON s.id = p.station_id
LEFT JOIN job_file_model_mappings m ON m.job_file = p.job_file
WHERE p.start_time >= (%(f)s::timestamp AT TIME ZONE 'UTC') AND p.start_time < (%(t)s::timestamp AT TIME ZONE 'UTC')
  AND p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED'
  AND p.model_id IS DISTINCT FROM 0 AND NOT (p.model_id IS NULL AND COALESCE(m.model_id, -1) = 0);
CREATE INDEX ON w (t);
ANALYZE w;
""", {"f": WIN_FROM, "t": WIN_TO})
cur.execute("SELECT count(*) FROM w"); log(f"window rows {cur.fetchone()[0]:,}")

# Ever-NG flags over the FULL history of the PIDs seen in the window (summary rules).
cur.execute("""
CREATE TEMP TABLE wp AS SELECT DISTINCT pid FROM w;
CREATE UNIQUE INDEX ON wp (pid);
CREATE TEMP TABLE hist AS
SELECT p.pid, p.station_id, bool_or(p.result IN ('NG','FAIL')) AS ever_ng
FROM pcb_results p JOIN wp USING (pid)
LEFT JOIN job_file_model_mappings m ON m.job_file = p.job_file
WHERE p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED'
  AND p.model_id IS DISTINCT FROM 0 AND NOT (p.model_id IS NULL AND COALESCE(m.model_id, -1) = 0)
GROUP BY p.pid, p.station_id;
CREATE UNIQUE INDEX ON hist (pid, station_id);
CREATE TEMP TABLE histp AS SELECT pid, bool_or(ever_ng) AS ever_ng FROM hist GROUP BY pid;
CREATE UNIQUE INDEX ON histp (pid);
ANALYZE hist; ANALYZE histp;
""")
cur.execute("SELECT count(*), count(*) FILTER (WHERE ever_ng) FROM histp"); log(f"PIDs / ever NG {cur.fetchone()}")

def qm(a, b, line=None, station=None):
    """quality-modes equivalent for wall-clock [a, b)."""
    cond, args = "t >= %s AND t < %s", [a, b]
    if line is not None: cond += " AND line_id = %s"; args.append(line)
    if station is not None: cond += " AND station_id = %s"; args.append(station)
    cur.execute(f"""
      WITH s AS (SELECT * FROM w WHERE {cond}),
      pairs AS (SELECT DISTINCT pid, station_id FROM s),
      pids AS (SELECT DISTINCT pid FROM w WHERE t >= %s AND t < %s)
      SELECT (SELECT count(*) FROM s), (SELECT count(*) FILTER (WHERE ng) FROM s),
             (SELECT count(*) FROM pairs),
             (SELECT count(*) FROM pairs JOIN hist h USING (pid, station_id) WHERE h.ever_ng),
             (SELECT count(*) FROM pids),
             (SELECT count(*) FROM pids JOIN histp h USING (pid) WHERE h.ever_ng)""", args + [a, b])
    at, ng, pr, prng, pc, pcng = cur.fetchone()
    r = lambda n, d: round(n * 100.0 / d, 2) if d else 0
    return {"retestAttempts": at, "retestNgAttempts": ng, "retestDefectRate": r(ng, at),
            "ntfPcbStations": pr, "ntfNgPcbStations": prng, "ntfRate": r(prng, pr),
            "rtyPcbs": pc, "rtyStraightThroughPcbs": pc - pcng, "rtyRate": r(pc - pcng, pc)}

def pareto(a, b, line=None, top=20):
    cond, args = "ng AND t >= %s AND t < %s", [a, b]
    if line is not None: cond += " AND line_id = %s"; args.append(line)
    cur.execute(f"SELECT error_code, count(*) FROM w WHERE {cond} GROUP BY 1 ORDER BY 2 DESC", args)
    rows = cur.fetchall(); tot = sum(n for _, n in rows)
    return [{"code": c, "count": n, "pct": round(n * 100.0 / tot, 2)} for c, n in rows[:top]]

def station_ng(a, b):
    cur.execute("SELECT station_id, count(*) FROM w WHERE ng AND t >= %s AND t < %s GROUP BY 1 ORDER BY 2 DESC", [a, b])
    return cur.fetchall()

cur.execute("SELECT id, name, remark FROM lines ORDER BY id")
lines = [{"id": i, "name": n, "remark": r} for i, n, r in cur.fetchall()]
cur.execute("""SELECT s.id, s.line_id, l.name, s.name, mg.name FROM stations s
               LEFT JOIN lines l ON l.id = s.line_id LEFT JOIN model_groups mg ON mg.id = s.model_group_id ORDER BY s.id""")
stations = [{"id": i, "lineId": li, "lineName": ln, "name": n, "modelGroupName": mg} for i, li, ln, n, mg in cur.fetchall()]
D = lambda *x: dt.datetime(*x)

# ---------------- weekly report (ISO W46 = 09/11 - 15/11) ----------------
END = D(2026, 11, 16); W0 = END - dt.timedelta(days=7)
wk = {"lines": lines, "stations": stations}
for i in range(6):
    e = END - dt.timedelta(days=7 * i); wk[f"week{i}"] = qm(e - dt.timedelta(days=7), e)
wk["weekcur"] = qm(END, END + dt.timedelta(days=2))
for d in range(9):
    s = W0 + dt.timedelta(days=d); wk[f"day{d}"] = qm(s, s + dt.timedelta(days=1))
for l in lines:
    if l["id"] == 0: continue
    wk[f"line{l['id']}"] = qm(W0, END, line=l["id"]); wk[f"lineprev{l['id']}"] = qm(W0 - dt.timedelta(days=7), W0, line=l["id"])
for s in stations:
    if s["id"] == 0: continue
    wk[f"st{s['id']}"] = qm(W0, END, station=s["id"])
wk["pareto"] = pareto(W0, END)
json.dump(wk, open(os.path.join(HERE, "data.json"), "w", encoding="utf-8"), ensure_ascii=False)
log("weekly data written")

# ---------------- monthly report (November MTD) ----------------
RM, RE = D(2026, 11, 1), D(2026, 11, 19)
BEFORE, AFTER = (D(2026, 8, 1), D(2026, 10, 1)), (D(2026, 10, 1), RE)
FOCUS, CONTROL = 11, 12
def mstart(i):
    y, m = RM.year, RM.month - i
    while m <= 0: m += 12; y -= 1
    return D(y, m, 1)
def mrange(i): return mstart(i), (RE if i == 0 else mstart(i - 1))
mo = {"lines": lines, "stations": stations,
      "meta": {"report_month": RM.isoformat(), "report_end": RE.isoformat(), "before": [x.isoformat() for x in BEFORE],
               "after": [x.isoformat() for x in AFTER], "focus": FOCUS, "control": CONTROL}}
for i in range(6):
    a, b = mrange(i); mo[f"m{i}"] = qm(a, b)
    for lid in (FOCUS, CONTROL): mo[f"m{i}_line{lid}"] = qm(a, b, line=lid)
for l in lines:
    if l["id"] in (0, FOCUS, CONTROL): continue
    for i in (0, 1):
        a, b = mrange(i); mo[f"m{i}_line{l['id']}"] = qm(a, b, line=l["id"])
w_ = D(2026, 8, 3)
while w_ < RE:
    e = min(w_ + dt.timedelta(days=7), RE); k = w_.isocalendar()[1]
    for lid in (FOCUS, CONTROL): mo[f"wk{k}_line{lid}"] = qm(w_, e, line=lid)
    w_ += dt.timedelta(days=7)
for s in stations:
    if s["lineId"] in (FOCUS, CONTROL):
        for tag, (a, b) in (("before", BEFORE), ("after", AFTER)): mo[f"st{s['id']}_{tag}"] = qm(a, b, station=s["id"])
for tag, (a, b) in (("before", BEFORE), ("after", AFTER)):
    mo[f"pareto_line{FOCUS}_{tag}"] = pareto(a, b, line=FOCUS, top=40)
    for lid in (FOCUS, CONTROL): mo[f"line{lid}_{tag}"] = qm(a, b, line=lid)
for i in (0, 1):
    a, b = mrange(i); mo[f"pareto_m{i}"] = pareto(a, b)
a, b = mrange(0)
for sid, _ in station_ng(a, b)[:12]: mo[f"m0_st{sid}"] = qm(a, b, station=sid)
json.dump(mo, open(os.path.join(HERE, "data_m.json"), "w", encoding="utf-8"), ensure_ascii=False)
log("monthly data written")
conn.close()
