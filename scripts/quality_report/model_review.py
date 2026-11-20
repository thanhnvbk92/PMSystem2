"""Before / after review of one model on one line (English deck, Haengsung template).

  python model_review.py --line "Line 6-1" --model "BMW ICON25 NAD" --action 2026-11-10 [--before-days 28]
                         [--trend-start 2026-09-01] [--out Reports/...pptx]

Before = [action - before_days, action), after = [action, today). Same KPI rules as the monthly report:
Re-test = NG attempts / attempts (rollup), NTF = PID-Station pairs ever NG (first-test cohort),
RTY = PCBs that passed every station of the line first time (PID x line, first-test cohort).
Model = job-file mapping, else the model id sent by the PC. UNKNOWN / UNKNOWN_DEFECT are kept in Re-test
but never named as an error code.
"""
import argparse, datetime as dt, json, math, os, re, sys
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import qfast, improvements
from pptlib import *

ap = argparse.ArgumentParser()
ap.add_argument("--line", default="Line 6-1"); ap.add_argument("--model", default="BMW ICON25 NAD")
ap.add_argument("--action", default="2026-11-10"); ap.add_argument("--before-days", type=int, default=28)
ap.add_argument("--trend-start", default=None); ap.add_argument("--today", default=None)
ap.add_argument("--out", default=None); ap.add_argument("--reports-dir", default=None)
A = ap.parse_args()
ACT = dt.date.fromisoformat(A.action)
TODAY = dt.date.fromisoformat(A.today) if A.today else dt.date.today()            # exclusive end (today is still running)
B0 = ACT - dt.timedelta(days=A.before_days)
TS = dt.date.fromisoformat(A.trend_start) if A.trend_start else ACT - dt.timedelta(weeks=10)
TS -= dt.timedelta(days=TS.weekday())
cfg = json.load(open(os.path.join(HERE, "report_config.json"), encoding="utf-8"))
EXCL = set(cfg.get("excluded_error_codes", ["UNKNOWN", "UNKNOWN_DEFECT"]))
NOT_A_TEST = cfg.get("not_a_test_regex") or "^$NONE"          # e.g. job change: not a test, left out completely
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RD = A.reports_dir or os.path.join(ROOT, "Reports")
OUT = A.out or os.path.join(RD, f"{A.line.replace(' ', '')}_{A.model.replace(' ', '_')}_Review_{TODAY - dt.timedelta(days=1):%Y-%m-%d}.pptx")

# ======================= data =======================
conn = qfast.connect(); cur = conn.cursor()
cur.execute("SELECT id FROM lines WHERE name = %s", (A.line,)); LID = cur.fetchone()[0]
cur.execute("SELECT id FROM models WHERE name = %s", (A.model,)); MID = cur.fetchone()[0]
cur.execute("SELECT job_file, model_id FROM job_file_model_mappings WHERE model_id IS NOT NULL"); job_model = dict(cur.fetchall())
def is_model(job, mid): return job_model.get(job, mid or 0) == MID
cur.execute("SELECT id, name FROM stations WHERE line_id = %s ORDER BY id", (LID,)); STN = dict(cur.fetchall()); SIDS = list(STN)
cur.execute("SELECT id, name, ip_address FROM channels WHERE station_id = ANY(%s)", (SIDS,)); JIG = {i: (n, ip) for i, n, ip in cur.fetchall()}

att = defaultdict(lambda: [0, 0])          # (day, sid) -> [tests, ng]
codes = defaultdict(int)                   # (day, sid, code) -> ng
jig = defaultdict(lambda: [0, 0])          # (day, sid, ch) -> [tests, ng]
jigc = defaultdict(int)                    # (day, sid, ch, code) -> ng
cur.execute("""SELECT bucket_date, station_id, channel_id, job_file, model_id, result, error_code, sum(total_count)::bigint
               FROM pcb_analytics_daily
               WHERE bucket_date >= %s AND bucket_date < %s AND station_id = ANY(%s) AND error_code <> 'DEFECT_UNSPECIFIED' AND error_code !~* %s
               GROUP BY 1, 2, 3, 4, 5, 6, 7""", (min(TS, B0), TODAY, SIDS, NOT_A_TEST))
for day, sid, ch, job, mid, res, code, n in cur.fetchall():
    if not is_model(job, mid): continue
    ng = res in ("NG", "FAIL")
    a = att[(day, sid)]; a[0] += n; j = jig[(day, sid, ch)]; j[0] += n
    if ng:
        a[1] += n; j[1] += n
        c = code or "UNKNOWN_DEFECT"
        if c not in EXCL: codes[(day, sid, c)] += n; jigc[(day, sid, ch, c)] += n
pairs = defaultdict(lambda: [0, 0])        # (day, sid) -> [pairs, ever NG]
cur.execute("""SELECT (first_test_time AT TIME ZONE 'UTC')::date, station_id, job_file, model_id, count(*), count(*) FILTER (WHERE ever_ng)
               FROM pcb_ntf_summaries
               WHERE first_test_time >= (%s::timestamp AT TIME ZONE 'UTC') AND first_test_time < (%s::timestamp AT TIME ZONE 'UTC')
                 AND station_id = ANY(%s) AND pid <> 'None' GROUP BY 1, 2, 3, 4""", (min(TS, B0), TODAY, SIDS))
for day, sid, job, mid, n, k in cur.fetchall():
    if is_model(job, mid): p = pairs[(day, sid)]; p[0] += n; p[1] += k
lrty = defaultdict(lambda: [0, 0])         # day -> [PCBs, PCBs ever NG on the line]
cur.execute("""WITH x AS (
                 SELECT n.pid, min(n.first_test_time) AS first_t, bool_or(n.ever_ng) AS ng,
                        (array_agg(n.job_file ORDER BY n.first_test_time DESC))[1] AS job_file,
                        (array_agg(n.model_id ORDER BY n.first_test_time DESC))[1] AS model_id
                 FROM pcb_ntf_summaries n
                 WHERE n.station_id = ANY(%s) AND n.pid <> 'None' AND isfinite(n.first_test_time)
                   AND n.pid IN (SELECT pid FROM pcb_ntf_summaries WHERE station_id = ANY(%s)
                                 AND first_test_time >= (%s::timestamp AT TIME ZONE 'UTC') AND first_test_time < (%s::timestamp AT TIME ZONE 'UTC'))
                 GROUP BY n.pid)
               SELECT (first_t AT TIME ZONE 'UTC')::date, job_file, model_id, count(*), count(*) FILTER (WHERE ng)
               FROM x WHERE first_t >= (%s::timestamp AT TIME ZONE 'UTC') AND first_t < (%s::timestamp AT TIME ZONE 'UTC')
               GROUP BY 1, 2, 3""", (SIDS, SIDS, min(TS, B0), TODAY, min(TS, B0), TODAY))
for day, job, mid, n, k in cur.fetchall():
    if is_model(job, mid): r = lrty[day]; r[0] += n; r[1] += k
_ALL = json.loads(json.dumps(improvements.analyze(conn, os.path.join(RD, "ImprovementList.xlsx"), TODAY, sorted(EXCL), NOT_A_TEST), default=str))
NUMS = [i for i, x in enumerate(_ALL, 1) if x["line"] == A.line and x["model"] == A.model]   # numbers as in the monthly report
IMP = [_ALL[i - 1] for i in NUMS]
conn.close()

def kpi(a, b, sid=None):
    t = ng = pr = prng = pc = pcng = 0
    for (d, s), (n, k) in att.items():
        if a <= d < b and (sid is None or s == sid): t += n; ng += k
    for (d, s), (n, k) in pairs.items():
        if a <= d < b and (sid is None or s == sid): pr += n; prng += k
    if sid is None:
        for d, (n, k) in lrty.items():
            if a <= d < b: pc += n; pcng += k
    else: pc, pcng = pr, prng
    f = lambda x, y: x * 100.0 / y if y else None
    return {"tests": t, "ng": ng, "rt": f(ng, t), "pairs": pr, "ntf": f(prng, pr), "pcbs": pc, "rty": f(pc - pcng, pc)}
def code_rates(a, b, sid=None):
    t = kpi(a, b, sid)["tests"] or 1; out = defaultdict(int); st_ = defaultdict(lambda: defaultdict(int))
    for (d, s, c), n in codes.items():
        if a <= d < b and (sid is None or s == sid): out[c] += n; st_[c][s] += n
    return {c: n * 100.0 / t for c, n in out.items()}, {c: n for c, n in out.items()}, st_
BEF, AFT = (B0, ACT), (ACT, TODAY)
KB, KA = kpi(*BEF), kpi(*AFT)
if not KB["tests"] or not KA["tests"]: raise SystemExit("No tests before or after the action for this model / line.")
DAYS_A = (TODAY - ACT).days
def ptest(nb, tb, na, ta):
    """two-proportion z test, p value"""
    if not tb or not ta: return 1.0
    p = (nb + na) / (tb + ta)
    if p in (0, 1): return 1.0
    z = (nb / tb - na / ta) / math.sqrt(p * (1 - p) * (1 / tb + 1 / ta))
    return math.erfc(abs(z) / math.sqrt(2))

# ======================= deck =======================
prs = Presentation(os.path.join(HERE, "assets", "skeleton_monthly.pptx")); S = list(prs.slides)
SHORTM = A.model.replace("BMW ", "")
def dd(d): return dm(d)
def wk(d): return f"W{d.isocalendar()[1]}"
PB = f"{dd(B0)} to {dd(ACT - dt.timedelta(days=1))}"; PA = f"{dd(ACT)} to {dd(TODAY - dt.timedelta(days=1))}"
def pc_(v, d=2): return "–" if v is None else f"{v:.{d}f}%"
def dlt(b, a, hb=False):
    if b is None or a is None: return "–", G3
    v = a - b
    return (f"{'▲' if v > 0 else '▼'} {abs(v):.2f}%", (GREEN if (v > 0) == hb else RED) if abs(v) >= 0.005 else G3)

# ---- 1. cover ----
c = S[0]; strip_annotations(c)
set_runs(by_name(c, "Title 1"), [f"{A.line} {SHORTM}", "Improvement Review"])
sub = by_name(c, "내용 개체 틀 2")
set_runs(sub, [f"Before {PB} ({wk(B0)}–{wk(ACT - dt.timedelta(days=1))}) vs after {PA} ({wk(ACT)}–{wk(TODAY - dt.timedelta(days=1))}) · PMSystem2 data"]); sub.width = Inches(10)
gt = by_name(c, "Group 46").table
for r in range(len(gt.rows)):
    if gt.cell(r, 0).text_frame.text.strip().startswith("Document"):
        runs = gt.cell(r, 1).text_frame.paragraphs[0].runs; runs[0].text = f"QA-{TODAY:%y%m}-{SHORTM.split()[0]}"
        for extra in runs[1:]: extra._r.getparent().remove(extra._r)

# ---- 2. summary ----
f = Frame(S[2], "Summary", f"{A.line} · {A.model} · before {PB} vs after {PA} (action start {dd(ACT)}, {wk(ACT)})")
yy = f.section("Key indicators – before vs after", unit="(Unit: %)")
cw = 3.92
for i, (nm, sub_, k, hb, det) in enumerate([
        ("Re-test", "NG test attempts", "rt", False, lambda K: f"{num(K['ng'])} NG / {num(K['tests'])} tests"),
        ("NTF", "PID–Station ever NG", "ntf", False, lambda K: f"{num(K['pairs'])} PID–Stations"),
        ("RTY", "line, first pass", "rty", True, lambda K: f"{num(K['pcbs'])} PCBs")]):
    x = 0.53 + i * (cw + 0.24)
    rect(f.s, x, yy, cw, 1.9, G2, name=f"KPI card {nm}")
    textbox(f.s, x + 0.25, yy + 0.15, cw - 0.5, 0.3, [[(nm, {"size": 14, "bold": True}), (f"  {sub_}", {"size": 10, "color": G3})]])
    tx, col = dlt(KB[k], KA[k], hb)
    textbox(f.s, x + 0.25, yy + 0.5, cw - 0.5, 0.6, [[(pc_(KB[k]), {"color": G3, "size": 16}), (" → ", {"color": G3, "size": 16}),
                                                      (pc_(KA[k]), {"color": GREEN if col == GREEN else (RED if col == RED else DARK), "size": 26, "bold": True})]])
    textbox(f.s, x + 0.25, yy + 1.15, cw - 0.5, 0.25, [[(tx, {"color": col, "bold": True}), ("  after vs before", {"color": G3})]], size=11)
    textbox(f.s, x + 0.25, yy + 1.48, cw - 0.5, 0.25, [f"before {det(KB)} · after {det(KA)}"], size=8.5, color=G3)
rb, nb, _ = code_rates(*BEF); ra, na, _ = code_rates(*AFT)
chg = sorted(((ra.get(c_, 0) - rb.get(c_, 0), c_) for c_ in set(rb) | set(ra)))
downs = [x for x in chg if x[0] < 0][:3]; ups = [x for x in chg[::-1] if x[0] > 0][:2]
STV = {sid: (kpi(*BEF, sid), kpi(*AFT, sid)) for sid in SIDS}
best_st = min((sid for sid in SIDS if STV[sid][0]["rt"] is not None and STV[sid][1]["rt"] is not None),
              key=lambda s: STV[s][1]["rt"] - STV[s][0]["rt"], default=None)
y2 = f.section("Key messages", y=yy + 2.2)
msgs = [[("Re-test ", {}), (f"{pc_(KB['rt'])} → {pc_(KA['rt'])}", {"bold": True, "color": GREEN if KA["rt"] < KB["rt"] else RED}),
         (f" and line RTY {pc_(KB['rty'])} → {pc_(KA['rty'])} after the actions from {dd(ACT)}.", {})]]
if best_st: msgs.append([("Largest gain at ", {}), (STN[best_st], {"bold": True}),
                         (f": Re-test {pc_(STV[best_st][0]['rt'])} → {pc_(STV[best_st][1]['rt'])}.", {})])
if downs: msgs.append([("NG steps reduced most: ", {}), (", ".join(f"{c_} {d_:+.2f}%" for d_, c_ in downs), {"bold": True, "color": GREEN})])
if ups: msgs.append([("NG steps increased (to watch): ", {}), (", ".join(f"{c_} +{d_:.2f}%" for d_, c_ in ups), {"bold": True, "color": RED})])
msgs.append([(f"After period = {DAYS_A} days ({num(KA['tests'])} tests vs {num(KB['tests'])} before); "
              + ("confirm with 4 weeks of data." if DAYS_A < 28 else "enough data for a verdict."), {"color": G3})])
textbox(f.s, 0.53, y2, 12.24, 2.2, [[("• " + m[0][0], m[0][1])] + m[1:] for m in msgs], size=11, space_after=4, name="Key messages")
textbox(f.s, 0.53, 6.75, 12.24, 0.2, ["* NG step changes in % of test attempts. UNKNOWN (NG without an NG step in the log) is not used as an NG step; "
                                      "job changes (CHANGE_JOB) are not counted as tests. "
                                      "Model = job-file mapping."], size=8, color=G3)

# ---- 3. weekly trend ----
f = Frame(S[3], "Weekly Trend", f"{A.model} on {A.line} · by ISO week · green = week with / after the action ({dd(ACT)}, {wk(ACT)})")
weeks = []
w = TS
while w < TODAY:
    e = min(w + dt.timedelta(days=7), TODAY); weeks.append((w, e, kpi(w, e))); w += dt.timedelta(days=7)
weeks = [x for x in weeks if x[2]["tests"]]
cats = [wk(w) for w, _, _ in weeks]
def colored_chart(x, y, w_, h, vals, fmt, nm, title):
    ch = column_chart(f.s, x, y, w_, h, cats, [(title, vals)], ["BFBFBF"], fmt=fmt, lo=0, name=nm)
    ser = ch.plots[0].series[0]
    for i_, (ws, we, _) in enumerate(weeks):
        if we > ACT:
            pt = ser.points[i_]; pt.format.fill.solid(); pt.format.fill.fore_color.rgb = rgb(GREEN)
    return ch
yy = f.section("Re-test by week", w=6.0, unit="(Unit: %)")
colored_chart(0.53, yy, 6.0, 2.75, [round(x[2]["rt"] or 0, 2) for x in weeks], '0.0', "Weekly Re-test", "Re-test %")
f.section("Line RTY by week", x=6.77, w=6.0, unit="(Unit: %)")
colored_chart(6.77, yy, 6.0, 2.75, [round(x[2]["rty"] or 0, 2) for x in weeks], '0.0', "Weekly RTY", "RTY %")
y3 = f.section("Figures by week", y=yy + 2.95)
rows = [["Week"] + cats, ["Tests"] + [num(x[2]["tests"]) for x in weeks], ["Re-test (%)"] + [f"{x[2]['rt']:.2f}" for x in weeks],
        ["NTF (%)"] + [pc_(x[2]["ntf"]).rstrip("%") for x in weeks], ["RTY (%)"] + [pc_(x[2]["rty"]).rstrip("%") for x in weeks]]
def wfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j and weeks[j - 1][1] > ACT: o["fill"] = LGREEN
    return o
table(f.s, 0.53, y3, 12.24, rows, [1.1] + [1] * len(cats), row_h=0.26, size=8, cell_fmt=wfmt, name="Weekly figures")
low = [cats[i] for i, x in enumerate(weeks) if x[2]["tests"] < 0.3 * max(y_[2]["tests"] for y_ in weeks)]
textbox(f.s, 0.53, y3 + 0.26 * 5 + 0.06, 12.24, 0.2, [f"* Actions in {A.line} for {SHORTM}: " +
        "; ".join(f"{dd(x['date'] if isinstance(x['date'], dt.date) else dt.date.fromisoformat(x['date']))} {x['station']} {x['action'][:50]}" for x in IMP)[:330]
        + (f". Low volume: {', '.join(low)}." if low else "")], size=8, color=G3)

# ---- 4. by station ----
f = Frame(S[4], "Results by Station", f"{A.model} · before {PB} vs after {PA}")
yy = f.section("Re-test by station – before vs after", w=4.6, unit="(Unit: %)")
sts = [s for s in SIDS if STV[s][0]["tests"] or STV[s][1]["tests"]]
column_chart(f.s, 0.53, yy, 4.6, min(4.5, 1.2 + 0.9 * len(sts)), [STN[s] for s in sts], [("Before", [round(STV[s][0]["rt"] or 0, 2) for s in sts]),
             ("After", [round(STV[s][1]["rt"] or 0, 2) for s in sts])], ["BFBFBF", GREEN], fmt='0.0', gap=60, overlap=-10, lo=0, name="Station Re-test")
f.section("Station figures and main changes", x=5.43, w=7.34, unit="(Unit: %, tests)")
srows = [["Station", "Tests B / A", "Re-test B", "Re-test A", "Δ", "NTF B → A", "Most reduced", "Most increased"]]
for s in sts:
    b, a = STV[s]
    rbs, _, _ = code_rates(*BEF, s); ras, _, _ = code_rates(*AFT, s)
    ch_ = sorted(((ras.get(c_, 0) - rbs.get(c_, 0), c_) for c_ in set(rbs) | set(ras)))
    fall = f"{ch_[0][1]} {ch_[0][0]:+.2f}%" if ch_ and ch_[0][0] < -0.05 else "–"
    rise = f"{ch_[-1][1]} +{ch_[-1][0]:.2f}%" if ch_ and ch_[-1][0] > 0.05 else "–"
    srows.append([STN[s], f"{num(b['tests'])} / {num(a['tests'])}", pc_(b["rt"]).rstrip("%"), pc_(a["rt"]).rstrip("%"),
                  dlt(b["rt"], a["rt"])[0], f"{pc_(b['ntf'], 1)} → {pc_(a['ntf'], 1)}", fall, rise])
def sfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j == 4 and v != "–": o["color"] = RED if v.startswith("▲") else GREEN
    if j == 6 and v != "–": o.update({"color": GREEN, "align": PP_ALIGN.LEFT})
    if j == 7 and v != "–": o.update({"color": RED, "align": PP_ALIGN.LEFT})
    return o
table(f.s, 5.43, yy, 7.34, srows, [0.8, 1.2, 0.7, 0.7, 0.75, 1.05, 2.0, 2.0], row_h=0.62, size=8, header_h=0.32, cell_fmt=sfmt, name="Station table")
textbox(f.s, 5.43, yy + 0.32 + 0.62 * len(sts) + 0.06, 7.34, 0.4, ["* Most reduced / increased = NG step with the largest change in % of the station's tests. "
                                                                    "B = before, A = after."], size=8, color=G3)

# ---- 5. error codes ----
f = Frame(S[6], "NG Steps – Before vs After", f"{A.model} · NG step rate in % of all {SHORTM} test attempts on {A.line}")
_, _, stb = code_rates(*BEF); _, _, sta = code_rates(*AFT)
top = sorted(set(rb) | set(ra), key=lambda c_: -max(rb.get(c_, 0), ra.get(c_, 0)))[:10]
yy = f.section("Top 10 NG steps", w=5.6, unit="(Unit: % of tests)")
rv = top                                             # bar axis is reversed: first category on top
column_chart(f.s, 0.53, yy, 5.6, 4.6, rv, [("Before", [round(rb.get(c_, 0), 2) for c_ in rv]), ("After", [round(ra.get(c_, 0), 2) for c_ in rv])],
             ["BFBFBF", GREEN], fmt='0.00', bar=True, gap=50, overlap=-10, lo=0, name="Top codes")
f.section("Detail", x=6.43, w=6.34, unit="(Unit: %)")
crows = [["NG step", "Station", "Before", "After", "Change", "NG B / A"]]
for c_ in top:
    stn = max(list(stb.get(c_, {}).items()) + list(sta.get(c_, {}).items()), key=lambda kv: kv[1])[0]
    b_, a_ = rb.get(c_, 0), ra.get(c_, 0)
    crows.append([c_, STN[stn], f"{b_:.2f}", f"{a_:.2f}", f"{(a_ - b_) * 100 / b_:+.0f}%" if b_ else "new", f"{num(nb.get(c_, 0))} / {num(na.get(c_, 0))}"])
def cfmt(i, j, v):
    o = {"align": PP_ALIGN.LEFT, "bold": True} if j == 0 else {}
    if j == 4: o["color"] = RED if (v == "new" or v.startswith("+")) else GREEN
    return o
table(f.s, 6.43, yy, 6.34, crows, [2.4, 0.8, 0.7, 0.7, 0.8, 1.0], row_h=0.38, size=8, cell_fmt=cfmt, name="Code table")
textbox(f.s, 6.43, yy + 0.38 * len(crows) + 0.06, 6.34, 0.3, ["* Station = where the NG step has most NG. Change = relative change of the rate."], size=8, color=G3)

# ---- jig statistics (used by the next steps; no slide) ----
jt = []
for s in sts:
    sa = STV[s][1]["rt"] or 0
    for ch in {c_ for (_, s2, c_) in jig if s2 == s}:
        tb = sum(v[0] for (d, s2, c2), v in jig.items() if s2 == s and c2 == ch and B0 <= d < ACT)
        nbj = sum(v[1] for (d, s2, c2), v in jig.items() if s2 == s and c2 == ch and B0 <= d < ACT)
        ta = sum(v[0] for (d, s2, c2), v in jig.items() if s2 == s and c2 == ch and ACT <= d < TODAY)
        naj = sum(v[1] for (d, s2, c2), v in jig.items() if s2 == s and c2 == ch and ACT <= d < TODAY)
        if ta < 30: continue
        cc = defaultdict(int)
        for (d, s2, c2, cd), n in jigc.items():
            if s2 == s and c2 == ch and ACT <= d < TODAY: cc[cd] += n
        topc = max(cc.items(), key=lambda kv: kv[1]) if cc else ("–", 0)
        jt.append((s, ch, tb, nbj, ta, naj, sa, topc))
jt.sort(key=lambda x: -(x[5] / x[4]))

# ---- 7. improvement actions ----
f = Frame(S[8], "Improvement Actions", f"From ImprovementList.xlsx · {A.line} · {A.model}")
yy = f.section("Actions and verification", unit="(Unit: % of tests)")
VC = {"Effective": GREEN, "Small improvement": "C9A000", "No clear effect": G3, "Worse": RED, "Insufficient data": G3}
irows = [["Date", "Station", "NG step", "Action", "NG step before", "NG step after", "Change", "Station Re-test", "Verdict"]]
for x in IMP:
    d_ = x["date"] if isinstance(x["date"], dt.date) else dt.date.fromisoformat(x["date"])
    irows.append([f"{dd(d_)} ({wk(d_)})", x["station"], [c_.strip() for c_ in x["code"].split(";") if c_.strip()], x["action"] or "–",
                  pc_(x["rate_before"]), pc_(x["rate_after"]), f"{x['change_pct']:+.0f}%" if x["change_pct"] is not None else "–",
                  f"{pc_(x['retest_before'], 1)} → {pc_(x['retest_after'], 1)}", x["verdict"]])
def ifmt(i, j, v):
    o = {"align": PP_ALIGN.LEFT} if j in (2, 3) else {}
    if j == 8 and i: o.update({"bold": True, "color": VC.get(v.replace(" (early)", ""), DARK)})
    if j == 6 and v != "–": o["color"] = GREEN if v.startswith("-") else RED
    return o
irh = min(0.75, 4.5 / max(1, len(IMP)))
table(f.s, 0.53, yy, 12.24, irows, [0.95, 0.65, 2.1, 3.6, 0.8, 0.8, 0.7, 1.2, 1.2], row_h=irh, size=8, header_h=0.3, cell_fmt=ifmt, name="Action table")
notes = [f"{x['station']} {x['code'][:30]}: {n_}" for x in IMP for n_ in x["notes"] if " increased to " in n_ or "watch:" in n_][:3]
textbox(f.s, 0.53, yy + 0.3 + irh * len(IMP) + 0.06, 12.24, 0.6,
        ["* Each action is checked on its own NG step at its station: 28 days before vs after (action day excluded). Effective = −30% or more and p < 0.05; (early) = fewer than 7 days."]
        + [f"* {n_}" for n_ in notes], size=8, color=G3)

# ---- 7b. one 'Verify Corrective Action' page per action (same page as in the monthly report) ----
from pca import pca_page
PCA_SLOTS = S[12:36]
PCA = [(n_, x) for n_, x in zip(NUMS, IMP) if x["verdict"] != "Insufficient data"][:len(PCA_SLOTS)]
for sl, (n_, x) in zip(PCA_SLOTS, PCA): pca_page(sl, n_, x)

# ---- 8. remaining issues and next steps ----
f = Frame(S[9], "Remaining Issues & Next Steps", f"{A.model} on {A.line} · after {PA}")
yy = f.section("Top NG steps after the action", w=5.9, unit="(Unit: % of tests)")
topa = sorted(ra.items(), key=lambda kv: -kv[1])[:6]
rrows = [["#", "NG step", "Station", "After", "vs before"]]
for i, (c_, v) in enumerate(topa, 1):
    stn = max(sta.get(c_, {}).items(), key=lambda kv: kv[1])[0]
    rrows.append([str(i), c_, STN[stn], f"{v:.2f}", f"{v - rb.get(c_, 0):+.2f}"])
table(f.s, 0.53, yy, 5.9, rrows, [0.3, 2.9, 0.9, 0.8, 0.9], row_h=0.36, size=8.5,
      cell_fmt=lambda i, j, v: ({"align": PP_ALIGN.LEFT, "bold": True} if j == 1 else {}) | ({"color": RED if v.startswith("+") else GREEN} if j == 4 and i else {}),
      name="Remaining codes")
f.section("Next steps", x=6.73, w=6.04, unit="(PIC to be assigned)")
nxt = TODAY + dt.timedelta(days=(4 - TODAY.weekday()) % 7 + 7)
steps = []
bad = [x for x in jt if x[5] / x[4] * 100 >= 1.5 * x[6] and x[5] >= 5][:3]
if bad: steps.append(("Jig", "Check pins / contact of " + ", ".join(f"{STN[x[0]]} {JIG.get(x[1], ('?', ''))[0]} ({x[5] * 100 / x[4]:.1f}%)" for x in bad), nxt))
if topa: steps.append(("NG step", f"Analyse NG logs of {topa[0][0]} ({topa[0][1]:.2f}% of tests) and define a corrective action", nxt + dt.timedelta(days=7)))
if ups: steps.append(("Watch", f"{ups[0][1]} increased +{ups[0][0]:.2f}% after the actions: check if related to the pin / pad changes", nxt + dt.timedelta(days=7)))
steps.append(("Verify", f"Re-check this review with 4 weeks of data after {dd(ACT)} (until {dd(ACT + dt.timedelta(days=28))})", ACT + dt.timedelta(days=30)))
srows2 = [["#", "Type", "Action", "Due"]] + [[str(i), t_, a_, f"{dd(d_)} ({wk(d_)})"] for i, (t_, a_, d_) in enumerate(steps, 1)]
table(f.s, 6.73, yy, 6.04, srows2, [0.3, 0.8, 3.9, 1.04], row_h=0.62, size=8.5, header_h=0.32,
      cell_fmt=lambda i, j, v: {"align": PP_ALIGN.LEFT} if j == 2 else ({"bold": True} if j == 1 else None), name="Next steps")

# ---- end, drop unused slides, page numbers ----
strip_annotations(S[39])
KEEP = {0, 2, 3, 4, 6, 8, 9, 39} | set(range(12, 12 + len(PCA)))
def drop_slide(slide):
    lst = prs.slides._sldIdLst
    for sldId in list(lst):
        if prs.part.related_part(sldId.rId) is slide.part:
            prs.part.drop_rel(sldId.rId); lst.remove(sldId); return
for i_, sl in enumerate(S):
    if i_ not in KEEP: drop_slide(sl)
lst_ = prs.slides._sldIdLst; ids_ = {prs.part.related_part(e.rId): e for e in lst_}
ref_ = ids_[S[8].part]
for sl, _ in zip(PCA_SLOTS, PCA):                    # verification pages right after the action summary
    el_ = ids_[sl.part]; lst_.remove(el_); ref_.addnext(el_); ref_ = el_
for el in list(prs.part._element.iter("{http://schemas.microsoft.com/office/powerpoint/2010/main}sectionLst")):
    ext = el.getparent(); ext.getparent().remove(ext)
for idx, sl in enumerate(list(prs.slides), 1):
    for sh in sl.shapes:
        if sh.name.startswith("슬라이드 번호") and sh.has_text_frame and not sh._element.findall(".//" + qn("a:fld")) and sh.text_frame.paragraphs[0].runs:
            set_runs(sh, [str(idx)])
tmp = OUT + ".part"
prs.save(tmp); os.replace(tmp, OUT)
print("saved", OUT)
print(json.dumps({"before": KB, "after": KA}, default=str))
