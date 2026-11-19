"""Monthly Quality Report (English): NTF / Re-test / RTY + Line 6-1 improvement review by model."""
import json, os, re, sys, datetime as dt
from pptlib import *

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.environ["DATA_M"], encoding="utf-8"))
OUT = sys.argv[1]
META = D["meta"]; MODELS = D["models"]
RM = dt.datetime.fromisoformat(META["report_month"]); RE = dt.datetime.fromisoformat(META["report_end"])
MI = D["model_info"]                                         # per model: before / after periods
for m_ in MI:
    m_["B"] = [dt.datetime.fromisoformat(x) for x in m_["before"]]; m_["A"] = [dt.datetime.fromisoformat(x) for x in m_["after"]]
SHORT = {m_["name"]: m_["short"] for m_ in MI}
FOCUS, CONTROL = META["focus"], META["control"]
LN = {l["id"]: l["name"] for l in D["lines"]}; FN, CN = LN[FOCUS], LN[CONTROL]
LAST = RE - dt.timedelta(days=1); MTD = LAST.month == RM.month and RE.day != 1

def q(k):
    v = D.get(k)
    return v if isinstance(v, dict) and v.get("retestAttempts") else None
def rty(m): return m["rtyRate"]
def rt(m): return m["retestDefectRate"]
def ntf(m): return m["ntfRate"]
def mstart(i):
    y, mo = RM.year, RM.month - i
    while mo <= 0: mo += 12; y -= 1
    return dt.date(y, mo, 1)
def mname(i, short=True):
    return mstart(i).strftime("%b" if short else "%B %Y") + ("*" if i == 0 and MTD and short else "")
def d2(d): return d.strftime("%d %b")
MONTH_TITLE = mname(0, False) + (f" (MTD 01–{LAST.strftime('%d %b')})" if MTD else "")
def rng(p): return f"{d2(p[0])} – {d2(p[1] - dt.timedelta(days=1))}"
def ptxt(m_): return f"before {rng(m_['B'])} · after {rng(m_['A'])}"
STARTS = " · ".join(f"{m_['short']} from {d2(m_['A'][0])}" for m_ in MI)
def chg(a, b): return (b - a) * 100 / a if a else 0
def signed(v, unit="%"): return f"{v:+.2f}{unit}"
def dcol(v, higher_better=False):
    if abs(v) < 0.005: return G3
    return GREEN if (v > 0) == higher_better else RED
cur, prev = q("m0"), q("m1")
st_meta = {s["id"]: s for s in D["stations"]}
DQ = ("* Model = current job-file mapping (pcb_results.model_id is outdated for ICON25 and August data). "
      "Not counted: Unassigned Line and tests with an invalid start time (infinity / future clock).")

prs = Presentation(os.environ.get("SKELETON", os.path.join(HERE, "assets", "skeleton_monthly.pptx"))); S = list(prs.slides)

# ---------- 1. Cover ----------
c = S[0]; strip_annotations(c)
set_runs(by_name(c, "Title 1"), ["Monthly Report", "NTF · Re-test · RTY"])
sub = by_name(c, "내용 개체 틀 2"); set_runs(sub, [f"{MONTH_TITLE} · {FN} improvement review · PMSystem2 data"]); sub.width = Inches(9)
gt = by_name(c, "Group 46").table
for r in range(len(gt.rows)):
    if gt.cell(r, 0).text_frame.text.strip().startswith("Document"):
        runs = gt.cell(r, 1).text_frame.paragraphs[0].runs; runs[0].text = f"QA-{RM.strftime('%Y-%m')}"
        for extra in runs[1:]: extra._r.getparent().remove(extra._r)

# ---------- 2. Contents ----------
_imp = D.get("improvements") or []
_ntp = min(23, sum(1 for x in _imp if x["verdict"] != "Insufficient data"))
TOC = [("Monthly KPI Summary", "3"), (f"{FN} Improvement Review", "7"), ("Improvement Verification", "12"),
       ("Key Positive Changes", str(14 + _ntp)), ("Remaining Issues", str(15 + _ntp)), ("Action Plan", str(16 + _ntp))]
t = S[1]; strip_annotations(t); rows = {}
for sh in list(t.shapes):
    if sh.has_text_frame and sh.name == "Content Placeholder 2": rows.setdefault(round(sh.top / 914400 / 0.555), []).append(sh)
for i, k in enumerate(sorted(rows)):
    if i >= len(TOC):
        for sh in rows[k]: remove(sh)
        continue
    for sh in rows[k]:
        x = sh.left / 914400
        if x < 5: set_runs(sh, [f"{i + 1:02d}"])
        elif x < 10.5: set_runs(sh, [TOC[i][0]]); sh.width = Inches(3.0)
        else: set_runs(sh, [TOC[i][1]])
for sh in list(t.shapes):
    if sh.shape_type == 9 and sh.top / 914400 > 0.56 + 0.555 * (len(TOC) - 1) + 0.4: remove(sh)

# ---------- 3. Monthly KPI summary ----------
f = Frame(S[2], "Monthly KPI Summary", f"{MONTH_TITLE} · vs {mname(1, False)}")
yy = f.section(f"Key indicators – {mname(0, False)}", unit="(Unit: %)")
cards = [("RTY", "plant-wide", rty, True, f"{num(cur['rtyStraightThroughPcbs'])} straight-through PCBs / {num(cur['rtyPcbs'])} PCBs", GREEN),
         ("Re-test", "NG test attempts", rt, False, f"{num(cur['retestNgAttempts'])} NG / {num(cur['retestAttempts'])} test attempts", VIOLET),
         ("NTF", "PID–Station ever NG", ntf, False, f"{num(cur['ntfNgPcbStations'])} NG / {num(cur['ntfPcbStations'])} PID–Stations", DARK)]
cw = 3.92
for i, (nm, sub_, fn, hb, det, col) in enumerate(cards):
    x = 0.53 + i * (cw + 0.24)
    rect(f.s, x, yy, cw, 2.05, G2, name=f"KPI card {nm}")
    textbox(f.s, x + 0.25, yy + 0.2, cw - 0.5, 0.3, [[(nm, {"size": 14, "bold": True}), (f"  {sub_}", {"size": 10, "color": G3})]])
    textbox(f.s, x + 0.25, yy + 0.55, cw - 0.5, 0.75, [pct(fn(cur))], size=40, color=col, bold=True)
    dtx, dc = delta(fn(cur), fn(prev), hb)
    textbox(f.s, x + 0.25, yy + 1.33, cw - 0.5, 0.25, [[(dtx, {"color": dc, "bold": True}), (f"  vs {mname(1)} ({pct(fn(prev))})", {"color": G3})]], size=11)
    textbox(f.s, x + 0.25, yy + 1.65, cw - 0.5, 0.25, [det], size=9, color=G3)
y2 = f.section("Definitions & figures", y=yy + 2.35)
m2 = q("m2")
defs = [["KPI", "Definition", mname(2), mname(1), mname(0), f"vs {mname(1)}"]]
for nm, formula, fn, hb in [("RTY", "Rolled throughput yield: PCBs that passed every Station first time / all PCBs tested (plant: all stations; line: stations of the line)", rty, True),
                            ("Re-test", "NG test attempts / all test attempts (each test run = 1 attempt)", rt, False),
                            ("NTF", "PID–Station pairs that were ever NG / all PID–Station pairs tested", ntf, False)]:
    defs.append([nm, formula, pct(fn(m2)) if m2 else "–", pct(fn(prev)), pct(fn(cur)), delta(fn(cur), fn(prev), hb)[0]])
def dfmt(i, j, v):
    if j == 0: return {"bold": True}
    if j == 4: return {"bold": True, "fill": LVIOLET}
    if j == 5: return {"bold": True, "color": delta(float(defs[i][4][:-1]), float(defs[i][3][:-1]), defs[i][0] == "RTY")[1]}
table(f.s, 0.53, y2, 12.24, defs, [1.0, 5.6, 1.1, 1.1, 1.1, 1.3], row_h=0.4,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 4, cell_fmt=dfmt, name="KPI definitions")
textbox(f.s, 0.53, y2 + 0.4 * 4 + 0.08, 12.24, 0.4,
        [("* " + (f"{mname(0, False)} is month-to-date until {LAST.strftime('%d %b')}. " if MTD else "") + "Periods by test start time (factory clock)."), DQ], size=8, color=G3)

# ---------- 4. 6-month trend ----------
f = Frame(S[3], "6-Month Trend", f"{mname(5, False)} – {mname(0, False)}")
ms = [i for i in range(5, -1, -1) if q(f"m{i}")]
cats = [mname(i) for i in ms]; mm = [q(f"m{i}") for i in ms]
fv, rv, nv = [rty(m) for m in mm], [rt(m) for m in mm], [ntf(m) for m in mm]
yy = f.section("RTY by month", w=5.84, unit="(Unit: %)")
column_chart(f.s, 0.53, yy, 5.84, 2.6, cats, [("RTY", fv)], [GREEN], lo=max(0, int(min(fv)) - 3), hi=100, name="RTY by month")
f.section("Re-test & NTF by month", x=6.93, w=5.84, unit="(Unit: %)")
line_chart(f.s, 6.93, yy, 5.84, 2.6, cats, [("Re-test", rv), ("NTF", nv)], [VIOLET, DARK], lo=0, hi=round(max(rv) * 1.35 + 0.5), name="Re-test NTF by month")
y2 = f.section("Monthly figures", y=yy + 2.75)
trows = [["KPI"] + cats, ["RTY (%)"] + [f"{v:.2f}" for v in fv], ["Re-test (%)"] + [f"{v:.2f}" for v in rv],
         ["NTF (%)"] + [f"{v:.2f}" for v in nv], ["Test attempts"] + [num(m["retestAttempts"]) for m in mm], ["PCBs (PID)"] + [num(m["rtyPcbs"]) for m in mm]]
table(f.s, 0.53, y2, 12.24, trows, [1.6] + [1] * len(cats), row_h=0.27,
      cell_fmt=lambda i, j, v: ({"bold": True} if j == 0 else {}) | ({"fill": LVIOLET, "bold": True} if j == len(cats) else {}), name="Monthly figures")
textbox(f.s, 0.53, y2 + 0.27 * len(trows) + 0.06, 12.24, 0.2, [f"* {mname(0)} = month-to-date until {LAST.strftime('%d %b')}." if MTD else "* Full calendar months."], size=8, color=G3)

# ---------- 5. KPI by line ----------
f = Frame(S[4], "KPI by Line", f"{MONTH_TITLE} · vs {mname(1, False)}")
lines = [(l["name"], q(f"m0_line{l['id']}"), q(f"m1_line{l['id']}")) for l in D["lines"] if q(f"m0_line{l['id']}")]
lines.sort(key=lambda x: -rt(x[1]))
line_id = {l["name"]: l["id"] for l in D["lines"]}
def top_rise(lid, m, pm):
    """Error code with the largest increase (% of tests) on a line, report month vs previous month."""
    rb_ = {p["code"]: p["count"] * 100 / pm["retestAttempts"] for p in D.get(f"pareto_m1_line{lid}", [])}
    ra_ = {p["code"]: p["count"] * 100 / m["retestAttempts"] for p in D.get(f"pareto_m0_line{lid}", [])}
    best = max(((ra_.get(c, 0) - rb_.get(c, 0), c) for c in set(rb_) | set(ra_)), default=None)
    return f"{best[1]} +{best[0]:.2f}%" if best and best[0] > 0 else "–"
yy = f.section(f"Re-test by line – {mname(1)} vs {mname(0)}", w=4.3, unit="(Unit: %)")
column_chart(f.s, 0.53, yy, 4.3, 4.6, [n for n, *_ in lines], [(mname(1), [rt(pm) if pm else 0 for _, _, pm in lines]), (mname(0), [rt(m) for _, m, _ in lines])],
             ["BFBFBF", VIOLET], bar=True, gap=60, overlap=-10, lo=0, name="Re-test by line")
f.section("KPI table by line (sorted by Re-test)", x=5.13, w=7.64, unit="(Unit: %)")
lrows = [["Line", "Tests", "Re-test", f"Δ {mname(1)}", "NTF", "RTY", "Δ RTY", f"Main cause of the Re-test rise vs {mname(1)}"]]
for n, m, pm in lines:
    rose = pm and rt(m) > rt(pm)
    lrows.append([n, num(m["retestAttempts"]), f"{rt(m):.2f}", delta(rt(m), rt(pm), False)[0] if pm else "–",
                  f"{ntf(m):.2f}", f"{rty(m):.2f}", delta(rty(m), rty(pm), True)[0] if pm else "–",
                  top_rise(line_id[n], m, pm) if rose else "–"])
def lfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j == 3 and v != "–": o["color"] = RED if v.startswith("▲") else (GREEN if v.startswith("▼") else G3)
    if j == 6 and v != "–": o["color"] = GREEN if v.startswith("▲") else (RED if v.startswith("▼") else G3)
    if j == 7 and v != "–": o.update({"color": RED, "align": PP_ALIGN.LEFT})
    if lrows[i][0] == FN: o["fill"] = LGREEN
    return o
rh = min(0.3, 4.6 / len(lrows))
table(f.s, 5.13, yy, 7.64, lrows, [1.0, 0.85, 0.7, 0.9, 0.6, 0.65, 0.9, 2.6], row_h=rh, size=8, cell_fmt=lfmt, name="KPI by line")
improved = sum(1 for _, m, pm in lines if pm and rt(m) < rt(pm))
textbox(f.s, 5.13, yy + rh * len(lrows) + 0.06, 7.64, 0.4,
        [f"* {improved} of {len(lines)} lines reduced Re-test vs {mname(1)}. Main cause = error code with the largest increase in % of tests on that line "
         f"(UNKNOWN = NG without an error in the log, not used as a cause). "
         f"Line RTY = PCBs that passed every station of the line first time. Green row = {FN}."], size=8, color=G3)

# ---------- 5b. Why plant Re-test fell: production volume by line ----------
MIX = S[35]
mx = [(n, m, pm) for n, m, pm in lines if pm]
T0 = sum(m["retestAttempts"] for _, m, _ in mx); T1 = sum(pm["retestAttempts"] for _, _, pm in mx)
vol = [(n, pm["retestAttempts"] * 100 / T1, m["retestAttempts"] * 100 / T0, rt(pm), rt(m), pm["retestAttempts"], m["retestAttempts"]) for n, m, pm in mx]
# name, share prev, share cur (used to pick the lines), Re-test prev, cur, tests prev, cur
vol.sort(key=lambda x: -x[4])
R1, R0 = rt(prev), rt(cur)
R_fix = sum(x[1] * x[4] for x in vol) / 100          # this month's line Re-test with last month's volumes
hi = max(vol, key=lambda x: x[4])
low_more = [x for x in vol if x[4] < R0 and x[2] - x[1] >= 1.0]
hi_less = [x for x in vol if x[4] > R0 and x[1] - x[2] >= 1.0]
n_up = sum(1 for x in vol if x[4] > x[3])
went = "fell" if R0 < R1 else "rose"
f = Frame(MIX, f"Why Plant Re-test {went.capitalize()}: Production Volume by Line",
          "Plant Re-test = all NG attempts / all test attempts, so a line that tests more weighs more")
yy = f.section(f"Test attempts by line – {mname(1)} vs {mname(0)}", w=5.9, unit="(Unit: tests)")
rv_ = vol[::-1]                                         # bar charts draw the first category at the bottom
column_chart(f.s, 0.53, yy, 5.9, 4.95, [x[0] for x in rv_], [(mname(1), [x[5] for x in rv_]), (mname(0), [x[6] for x in rv_])],
             ["BFBFBF", VIOLET], fmt='#,##0', bar=True, gap=50, overlap=-10, lo=0, name="Test share by line")
yk = f.section("Key points", x=6.73, w=6.04)
pts = [[("Plant Re-test ", {}), (f"{R1:.2f}% → {R0:.2f}%", {"bold": True, "color": GREEN if R0 < R1 else RED}),
        (f" although {n_up} of {len(vol)} lines rose.", {})],
       [(f"{hi[0]} ", {"bold": True}), (f"has the highest Re-test ({hi[4]:.2f}%, {hi[3]:.2f}% in {mname(1)}), but it ran far fewer tests: "
                                         f"{num(hi[5])} → {num(hi[6])}.", {})]]
if low_more:
    pts.append([("Lines with low Re-test (", {}), (", ".join(x[0] for x in low_more), {"bold": True}),
                (f") dropped less in volume, so they weigh more in {mname(0)}.", {})])
pts.append([(f"With the {mname(1)} volume per line, plant Re-test in {mname(0)} would be ", {}),
            (f"{R_fix:.2f}%", {"bold": True, "color": RED if R_fix > R1 else GREEN}),
            (f" ({R_fix - R1:+.2f}% vs {mname(1)}): the fall comes mainly from the volume change, not from better lines.", {})])
if MTD: pts.append([(f"{mname(0)} = {RM:%d}–{LAST:%d %b} only ({LAST.day} days), so its test counts are lower for every line.", {"color": G3})])
textbox(f.s, 6.73, yk, 6.04, 1.75, [[("• " + r[0][0], r[0][1])] + r[1:] for r in pts], size=9, name="Key points")
yt = f.section("Re-test and test attempts by line", x=6.73, y=yk + 1.85, w=6.04, unit="(Unit: %, tests)")
vrows = [["Line", f"Re-test {mname(1)}", f"Re-test {mname(0)}", f"Tests {mname(1)}", f"Tests {mname(0)}"]]
for n, s1, s0, r1, r0, t1, t0 in vol:
    vrows.append([n, f"{r1:.2f}", f"{r0:.2f}", num(t1), num(t0)])
def vfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if i and j == 2: o["color"] = RED if vol[i - 1][4] > vol[i - 1][3] else GREEN
    if i and j == 4 and abs(vol[i - 1][2] - vol[i - 1][1]) >= 1.0: o.update({"bold": True, "color": DARK})
    if vrows[i][0] == FN: o["fill"] = LGREEN
    return o
table(f.s, 6.73, yt, 6.04, vrows, [1.24, 1.2, 1.2, 1.2, 1.2], row_h=min(0.235, (7.0 - yt) / len(vrows)), size=8, cell_fmt=vfmt, name="Volume by line")

# ---------- 6. Section divider ----------
def section_slide(sl, lines_):
    """Section divider with the big title only (no number, no subtitle)."""
    strip_annotations(sl)
    for sh in list(sl.shapes):
        if sh.name == "Title 1": remove(sh)
        elif sh.name == "Content Placeholder 2" and sh.has_text_frame:
            if sh.top / 914400 < 1: set_runs(sh, lines_)
            else: remove(sh)
sd = S[5]
section_slide(sd, [FN, "Improvement Review"])

# ---------- 7. Before vs after by model ----------
f = Frame(S[6], f"{FN}: Improvement Results by Model", f"Improvement start: {STARTS} · control line {CN} (same models)")
yy = f.section(f"{FN} key indicators by model", unit="(Unit: %)")
cw2 = (12.24 - 0.24) / 2
net = {}
for k, g in enumerate(MODELS):
    b, a = q(f"line{FOCUS}_before_g{k}"), q(f"line{FOCUS}_after_g{k}")
    cb, ca = q(f"line{CONTROL}_before_g{k}"), q(f"line{CONTROL}_after_g{k}")
    x = 0.53 + k * (cw2 + 0.24)
    rect(f.s, x, yy, cw2, 1.85, G2, name=f"Model card {SHORT[g]}")
    textbox(f.s, x + 0.25, yy + 0.15, cw2 - 0.5, 0.3, [[(g, {"size": 14, "bold": True})] + ([] if b and a else [("  no data", {"size": 9, "color": G3})])])
    textbox(f.s, x + 0.25, yy + 0.4, cw2 - 0.5, 0.2, [ptxt(MI[k])], size=8.5, color=G3)
    if not (b and a): continue
    for j, (nm, fn, hb, col) in enumerate((("Re-test", rt, False, VIOLET), ("NTF", ntf, False, DARK), ("RTY", rty, True, GREEN))):
        xx = x + 0.25 + j * (cw2 - 0.5) / 3
        textbox(f.s, xx, yy + 0.62, 1.8, 0.22, [nm], size=10, color=G3)
        textbox(f.s, xx, yy + 0.84, 1.85, 0.4, [[(f"{fn(b):.2f} → ", {"size": 13, "color": G3, "bold": True}), (f"{fn(a):.2f}%", {"size": 17, "color": col, "bold": True})]])
        d_ = fn(a) - fn(b)
        textbox(f.s, xx, yy + 1.24, 1.8, 0.22, [signed(d_)], size=11, color=dcol(d_, hb), bold=True)
        if cb and ca: textbox(f.s, xx, yy + 1.5, 1.85, 0.22, [f"{CN}: {fn(cb):.2f} → {fn(ca):.2f}"], size=8.5, color=G3)
    if cb and ca:
        net[g] = ((rt(a) - rt(b)) - (rt(ca) - rt(cb)), (ntf(a) - ntf(b)) - (ntf(ca) - ntf(cb)), (rty(a) - rty(b)) - (rty(ca) - rty(cb)))
def drivers(before, b_att, after, a_att, n=3):
    """Error codes behind a change: (increases, decreases) as (code, before %, after %, delta %p)."""
    rb_ = {p["code"]: p["count"] * 100 / b_att for p in before}; ra_ = {p["code"]: p["count"] * 100 / a_att for p in after}
    rows_ = [(c_, rb_.get(c_, 0), ra_.get(c_, 0), ra_.get(c_, 0) - rb_.get(c_, 0)) for c_ in set(rb_) | set(ra_)]
    ups = sorted([r for r in rows_ if r[3] > 0.005], key=lambda r: -r[3])[:n]
    downs = sorted([r for r in rows_ if r[3] < -0.005], key=lambda r: r[3])[:n]
    return ups, downs
for k, g in enumerate(MODELS):
    b, a = q(f"line{FOCUS}_before_g{k}"), q(f"line{FOCUS}_after_g{k}")
    x = 0.53 + k * (cw2 + 0.24)
    y2 = f.section(f"What changed – {SHORT[g]} on {FN}", x=x, y=yy + 2.1, w=cw2, unit="(Unit: % of tests)")
    if not (b and a): continue
    ups, downs = drivers(D.get(f"pareto_line{FOCUS}_before_g{k}", []), b["retestAttempts"], D.get(f"pareto_line{FOCUS}_after_g{k}", []), a["retestAttempts"])
    wr = [["", "Error code", "Before", "After", "Δ"]]
    for lab, lst in (("▲ worse", ups), ("▼ better", downs)):
        for j_, (c_, bb, aa, dd_) in enumerate(lst):
            wr.append([lab if j_ == 0 else "", c_, f"{bb:.2f}%", f"{aa:.2f}%", f"{dd_:+.2f}%"])
    table(f.s, x, y2, cw2, wr, [0.85, 2.85, 0.75, 0.75, 0.8], row_h=0.25, size=8,
          cell_fmt=lambda i, j, v, wr=wr: ({"bold": True, "color": RED if wr[i][4].startswith("+") else GREEN} if j in (0, 4)
                                          else ({"align": PP_ALIGN.LEFT} if j == 1 else None)), name=f"What changed {SHORT[g]}")
textbox(f.s, 0.53, 6.62, 12.24, 0.2, [f"* Error codes with the largest increase (red) and decrease (green) in % of test attempts on {FN}, before vs after for each model; "
                                       f"together they explain the change of Re-test in the cards. Line RTY = passed all {FN} stations first time."], size=8, color=G3)

# ---------- 8. Weekly trend by model ----------
f = Frame(S[7], f"{FN}: Weekly Trend by Model", f"Re-test by ISO week · improvement start: {STARTS}")
def is_after(w, k):
    monday = dt.date.fromisocalendar(MI[k]["A"][0].year, w, 1)
    return monday + dt.timedelta(days=3) >= MI[k]["A"][0].date()
wks = sorted({int(k[2:].split("_")[0]) for k in D if k.startswith("wk") and f"_line{FOCUS}_g" in k})
series = {}
for k, g in enumerate(MODELS):
    x = 0.53 + k * (5.84 + 0.56)
    yy = f.section(f"{g} – {FN} vs {CN}", x=x, w=5.84, unit="(Unit: %)")
    fw = [rt(q(f"wk{w}_line{FOCUS}_g{k}")) if q(f"wk{w}_line{FOCUS}_g{k}") else 0 for w in wks]
    cwv = [rt(q(f"wk{w}_line{CONTROL}_g{k}")) if q(f"wk{w}_line{CONTROL}_g{k}") else 0 for w in wks]
    series[g] = fw
    line_chart(f.s, x, yy, 5.84, 2.6, [f"W{w}" for w in wks], [(FN, fw), (CN, cwv)], [VIOLET, "BFBFBF"], fmt='0', lo=0,
               hi=round(max(fw + cwv + [1]) * 1.25 + 1), name=f"Weekly re-test {SHORT[g]}")
y2 = f.section(f"{FN} weekly Re-test and tests by model", y=1.44 + 0.38 + 2.75)
wrows = [["Week"] + [f"W{w}" for w in wks]]
for k, g in enumerate(MODELS):
    wrows.append([f"{SHORT[g]} Re-test %"] + [f"{v:.1f}" if v else "–" for v in series[g]])
    wrows.append([f"{SHORT[g]} tests"] + [f"{q(f'wk{w}_line{FOCUS}_g{k}')['retestAttempts'] / 1000:.1f}k" if q(f"wk{w}_line{FOCUS}_g{k}") else "–" for w in wks])
table(f.s, 0.53, y2, 12.24, wrows, [2.0] + [1] * len(wks), row_h=0.27, size=7.5,
      cell_fmt=lambda i, j, v: ({"bold": True} if j == 0 else {}) | ({"fill": LGREEN} if i > 0 and j > 0 and is_after(wks[j - 1], (i - 1) // 2) else {}), name="Weekly figures by model")
avg = []
for k, g in enumerate(MODELS):
    ms_ = [(is_after(w, k), q(f"wk{w}_line{FOCUS}_g{k}")) for w in wks if q(f"wk{w}_line{FOCUS}_g{k}")]
    def wavg(flag):
        sel = [m for a_, m in ms_ if a_ == flag]
        t_ = sum(m["retestAttempts"] for m in sel)
        return sum(m["retestNgAttempts"] for m in sel) * 100 / t_ if t_ else None
    pre, post = wavg(False), wavg(True)
    if pre is not None and post is not None: avg.append(f"{SHORT[g]} {pre:.1f}% → {post:.1f}%")
textbox(f.s, 0.53, y2 + 0.27 * len(wrows) + 0.06, 12.24, 0.2, [f"* Green = improvement period (weeks with most days after the start). Re-test on {FN} before → after (NG / tests): " + "; ".join(avg) + f". W{wks[-1]} may be partial."], size=8, color=G3)

# ---------- 9. By station & model ----------
f = Frame(S[8], f"{FN}: Results by Station and Model", " · ".join(f"{m_['short']}: {ptxt(m_)}" for m_ in MI))
srow = []
for sid, meta in st_meta.items():
    if meta["lineId"] != FOCUS: continue
    for k, g in enumerate(MODELS):
        b, a = q(f"st{sid}_before_g{k}"), q(f"st{sid}_after_g{k}")
        if b and a and b["retestAttempts"] >= 500 and a["retestAttempts"] >= 500: srow.append((meta["name"], g, b, a))
srow.sort(key=lambda x: (MODELS.index(x[1]), -x[2]["retestNgAttempts"]))
yy = f.section("Station table", unit="(Unit: tests, %)")
trs = [["Model", "Station", "Tests B", "Tests A", "Re-test B", "Re-test A", "Δ Re-test", "NTF B", "NTF A", "Δ NTF", "Main cause of the Re-test change"]]
sid_of = {(m_["name"], m_["lineId"]): i_ for i_, m_ in st_meta.items()}
for n, g, b, a in srow:
    k_ = MODELS.index(g); sid_ = sid_of.get((n, FOCUS))
    ups, downs = drivers(D.get(f"pareto_st{sid_}_before_g{k_}", []), b["retestAttempts"], D.get(f"pareto_st{sid_}_after_g{k_}", []), a["retestAttempts"], n=1)
    lst = ups if rt(a) > rt(b) else downs
    cause = f"{lst[0][0]} {lst[0][3]:+.2f}%" if lst else "–"
    trs.append([SHORT[g], n, num(b["retestAttempts"]), num(a["retestAttempts"]), f"{rt(b):.2f}", f"{rt(a):.2f}", signed(rt(a) - rt(b)),
                f"{ntf(b):.2f}", f"{ntf(a):.2f}", signed(ntf(a) - ntf(b)), cause])
def sfmt(i, j, v):
    o = {"bold": True} if j in (0, 1) else {}
    if j in (6, 9): o.update({"bold": True, "color": GREEN if v.startswith("-") else RED})
    if j == 10: o.update({"align": PP_ALIGN.LEFT, "color": GREEN if "-" in v.split(" ")[-1] else RED})
    return o
rh9 = 0.27
table(f.s, 0.53, yy, 12.24, trs, [0.8, 0.9, 0.85, 0.85, 0.8, 0.8, 0.85, 0.7, 0.7, 0.8, 3.0], row_h=rh9, size=8, cell_fmt=sfmt, name="Stations by model")
y3 = yy + rh9 * len(trs) + 0.15
y4 = f.section("Re-test by station – before vs after", y=y3, unit="(Unit: %)")
column_chart(f.s, 0.53, y4, 12.24, 6.85 - y4, [f"{n} · {SHORT[g]}" for n, g, _, _ in srow],
             [("Before", [rt(b) for _, _, b, _ in srow]), ("After", [rt(a) for _, _, _, a in srow])], ["BFBFBF", GREEN], fmt='0.0', lo=0, gap=70, overlap=-10,
             name="Station re-test before after")

# ---------- 10. Error codes by model ----------
f = Frame(S[9], f"{FN}: Error Codes by Model", "Error-code rate in % of test attempts (normalised for volume) · before vs after")
code_gain = {}
for k, g in enumerate(MODELS):
    b, a = q(f"line{FOCUS}_before_g{k}"), q(f"line{FOCUS}_after_g{k}")
    x = 0.53 + k * (5.84 + 0.56)
    yy = f.section(f"{g}", x=x, w=5.84, unit="(Unit: % of tests)")
    if not (b and a): continue
    rb = {p["code"]: p["count"] * 100 / b["retestAttempts"] for p in D.get(f"pareto_line{FOCUS}_before_g{k}", [])}
    ra = {p["code"]: p["count"] * 100 / a["retestAttempts"] for p in D.get(f"pareto_line{FOCUS}_after_g{k}", [])}
    codes = sorted(set(list(rb)[:8]) | set(list(ra)[:4]), key=lambda c_: -max(rb.get(c_, 0), ra.get(c_, 0)))[:11]
    rows_ = [["Error code", "Before", "After", "Δ", "Rel. change"]]
    for c_ in codes:
        bb, aa = rb.get(c_, 0), ra.get(c_, 0)
        rows_.append([c_, f"{bb:.2f}%", f"{aa:.2f}%", f"{aa - bb:+.2f}%", f"{chg(bb, aa):+.0f}%" if bb else "new"])
        code_gain[(g, c_)] = (bb, aa)
    table(f.s, x, yy, 5.84, rows_, [2.75, 0.75, 0.75, 0.75, 0.8], row_h=0.36, size=8,
          cell_fmt=lambda i, j, v: {"bold": True, "align": PP_ALIGN.LEFT} if j == 0 else ({"color": GREEN if v.startswith("-") else RED} if j in (3, 4) else None),
          name=f"Error codes {SHORT[g]}")
    textbox(f.s, x, yy + 0.36 * len(rows_) + 0.06, 5.84, 0.2, [f"* Tests: before {num(b['retestAttempts'])}, after {num(a['retestAttempts'])}."], size=8, color=G3)


# ---------- 11. Improvement verification (section, summary, trend pages) ----------
IMP = D.get("improvements") or []
VCOL = {"Effective": GREEN, "Worse": RED, "Small improvement": GREEN, "Improving (not significant)": "BF8F00",
        "No clear effect": G3, "Insufficient data": G3, "Code not seen": G3, "No baseline": G3, "No error code": G3}
VFILL = {"Effective": "C6EFCE", "Worse": "FFC7CE", "Small improvement": "E2EFDA", "Improving (not significant)": "FFEB9C"}
section_slide(S[10], ["Improvement", "Verification"])
def pc(v, d=2): return "–" if v is None else f"{v:.{d}f}%"
def dd(s): return dt.date.fromisoformat(s).strftime("%d/%m")
def ddw(s):                                   # date with its ISO week, e.g. 30/10 (W44)
    d_ = dt.date.fromisoformat(s); return f"{d_:%d/%m} (W{d_.isocalendar()[1]})"
import os as _os
def codes_short(code):
    """'LTE_B5_Connected_V2; LTE_B1_Connected_V2' -> 'LTE_B5/B1_Connected_V2' (common prefix / suffix kept once)."""
    cs = [c.strip() for c in (code or "").split(";") if c.strip()]
    if len(cs) < 2: return code or ""
    pre = _os.path.commonprefix(cs); suf = _os.path.commonprefix([c[::-1] for c in cs])[::-1]
    while pre and pre[-1].isalnum() and not all(len(c) > len(pre) and not c[len(pre)].isalnum() for c in cs): pre = pre[:-1]
    mids = [c[len(pre):len(c) - len(suf)] for c in cs]
    if pre and suf and all(mids) and len(pre) + len(suf) >= 6:
        return pre + "/".join(mids) + suf
    return "; ".join(cs)
f = Frame(S[11], "Improvement Verification", f"{len(IMP)} improvements from ImprovementList.xlsx · error-code rate before vs after")
yy = f.section("Summary", unit="(Unit: % of test attempts)")
rows = [["#", "Line", "Station", "Model", "Error code", "Action", "Date", "Code B", "Code A", "Change", "Re-test B → A", "Verdict"]]
for i, x in enumerate(IMP, 1):
    rows.append([str(i), x["line"], x["station"], x["model"].replace("BMW ", ""), (codes_short(x["code"]) or "–") + (" *" if x.get("auto_code") else ""),
                 x["action"] or "–", ddw(x["date"]),
                 pc(x["rate_before"]), pc(x["rate_after"]), "–" if x["change_pct"] is None else f"{x['change_pct']:+.0f}%",
                 f"{pc(x['retest_before'], 1)} → {pc(x['retest_after'], 1)}", x["verdict"]])
def vbase(v): return v.replace(" (early)", "")

def ifmt2(i, j, v):
    x = IMP[i - 1]
    if j in (4, 5): return {"align": PP_ALIGN.LEFT}
    if j == 9 and v != "–": return {"bold": True, "color": GREEN if v.startswith("-") else RED}
    if j == 11: return {"bold": True, "color": VCOL.get(vbase(x["verdict"]), DARK), "fill": VFILL.get(vbase(x["verdict"]))}
rh_ = min(0.36, 4.75 / max(len(rows), 1))
if IMP:
    table(f.s, 0.53, yy, 12.24, rows, [0.3, 0.7, 0.75, 1.15, 1.8, 3.35, 0.8, 0.6, 0.6, 0.6, 1.0, 1.2], row_h=rh_, size=7,
          cell_fmt=ifmt2, name="Improvement summary")
    textbox(f.s, 0.53, yy + rh_ * len(rows) + 0.06, 12.24, 0.4,
            ["* Code B/A = NG attempts with that error code / test attempts at the line + station + model, 28 days before vs up to 28 days after "
             "(action day excluded). Effective = −30% or more and p < 0.05. * = error code detected from the data. "
             "(early) = fewer than 7 days after the action. One 'Verify Corrective Action' page with the trend follows for each improvement "
             "except 'Insufficient data'."], size=8, color=G3)
else:
    textbox(f.s, 0.53, yy + 0.2, 12.24, 0.4, ["Reports/ImprovementList.xlsx not found or empty."], size=12, color=G3)

TRENDED = [(i, x) for i, x in enumerate(IMP, 1) if x["verdict"] != "Insufficient data"]   # numbers as in the summary table
TREND_SLIDES = S[12:35]                # S[35] is used for the line-mix page
pages = TRENDED[:len(TREND_SLIDES)]
BORDER = "ADADAD"
STATUS = {"Effective": ("OK", GREEN, BLACK), "Small improvement": ("Monitor", "FFEB9C", BLACK),
          "Improving (not significant)": ("Monitor", "FFEB9C", BLACK), "Worse": ("NG", RED, WHITE),
          "No clear effect": ("NG", "F4B183", BLACK)}
def status_of(v):
    st, fill, fc = STATUS.get(vbase(v), ("Check", G1, BLACK))
    return (st + "\n(early)" if v.endswith("(early)") else st), fill, fc
COLS = [0.53, 4.59, 4.71, 0.77, 0.95, 0.68]           # as the "Verify Permanent Corrective Action" page
TX, TY, H0, H1 = 0.53, 1.81, 0.52, 4.13
def pca_cell(cell, paras, size=9.5, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, fill=WHITE, color=BLACK, left=BORDER, right=BORDER):
    style_cell(cell, paras, size=size, color=color, fill=fill, align=align, top=BORDER, bottom=BORDER, left=left, right=right)
    cell.vertical_anchor = anchor
    cell.margin_left = Inches(0.08); cell.margin_top = Inches(0.08); cell.margin_right = Inches(0.05)
for sl, (num_, x) in zip(TREND_SLIDES, pages):
    d_ = dt.date.fromisoformat(x["date"]); wk_ = f"W{d_.isocalendar()[1]}"
    f = Frame(sl, "Verify Corrective Action", f"#{num_} · {x['line']} · {x['station']} · {x['model']}")
    f.section(f"Issue: {codes_short(x['code']) or '–'}" + (" (detected from data)" if x.get("auto_code") else ""), unit="(Unit: % of test attempts)")
    gf = f.s.shapes.add_table(2, 6, Inches(TX), Inches(TY), Inches(sum(COLS)), Inches(H0 + H1)); gf.name = f"PCA table {num_}"
    tbl = gf.table; tblPr = tbl._tbl.tblPr; tblPr.set("firstRow", "0"); tblPr.set("bandRow", "0")
    sid_ = tblPr.find(qn("a:tableStyleId"))
    if sid_ is None: sid_ = etree.SubElement(tblPr, qn("a:tableStyleId"))
    sid_.text = NOSTYLE
    for c_, w_ in enumerate(COLS): tbl.columns[c_].width = Inches(w_)
    tbl.rows[0].height = Inches(H0); tbl.rows[1].height = Inches(H1)
    for c_, h_ in enumerate(["No", "Issue & Corrective Action", "Actual Check", "PIC", "Due\nDate", "Status"]):
        pca_cell(tbl.cell(0, c_), h_.split("\n"), size=10, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, fill=BLACK, color=WHITE,
                 left=None if c_ == 0 else BORDER, right=None if c_ == 5 else BORDER)
    pca_cell(tbl.cell(1, 0), [str(num_)], size=10.5, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, left=None)
    res_col = GREEN if (x["change_pct"] or 0) < 0 else RED
    paras = [[("Issue", {"bold": True})],
             f"{codes_short(x['code']) or '–'} on {x['line']} {x['station']} ({x['model']}): {pc(x['rate_before'])} of tests before the action.",
             "",
             [("Corrective action", {"bold": True})],
             x["action"] or "–",
             f"Done {d_:%d/%m/%Y} ({wk_})"]
    if x["notes"]:
        paras += ["", [("Notes", {"bold": True})]] + [[("• " + n_, {"color": DARK if " rise to " in n_ else G3, "size": 8.5})] for n_ in x["notes"]]
    pca_cell(tbl.cell(1, 1), paras, size=9.5)
    result = [[("Result", {"bold": True})],
              [("Error code: ", {}), (f"{pc(x['rate_before'])} → {pc(x['rate_after'])}", {"bold": True, "color": res_col}),
               (f" ({x['change_pct']:+.0f}%)" if x["change_pct"] is not None else "", {"color": res_col}),
               (f"   ·   Station Re-test: {pc(x['retest_before'], 1)} → {pc(x['retest_after'], 1)}", {})],
              [("Verdict: ", {}), (x["verdict"], {"bold": True, "color": VCOL.get(vbase(x["verdict"]), DARK)}),
               (f"   ·   before {dd(x['before'][0])}–{dd((dt.date.fromisoformat(x['before'][1]) - dt.timedelta(days=1)).isoformat())}, "
                f"after {dd(x['after'][0])}–{dd((dt.date.fromisoformat(x['after'][1]) - dt.timedelta(days=1)).isoformat())}", {"color": G3})]]
    pca_cell(tbl.cell(1, 2), result, size=9)
    textbox(f.s, TX + COLS[0] + COLS[1] + 0.08, TY + H0 + H1 - 0.3, COLS[2] - 0.16, 0.22,
            ["grey = before · green = after · " + ("by day" if x["trend_daily"] else "by ISO week") + f" · action {dd(x['date'])} ({wk_})"],
            size=8, color=G3, align=PP_ALIGN.CENTER, name=f"Trend legend {num_}")
    pca_cell(tbl.cell(1, 3), [""], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    pca_cell(tbl.cell(1, 4), [f"{d_:%d/%m/%Y}", f"({wk_})"], size=10, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    st_, sfill, sfc = status_of(x["verdict"])
    pca_cell(tbl.cell(1, 5), st_.split("\n"), size=10.5, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, fill=sfill, color=sfc, right=None)
    # trend chart inside the "Actual Check" cell
    pts = [p for p in x["trend"] if p[1] is not None]
    if pts:
        cx = TX + COLS[0] + COLS[1] + 0.08; cy = TY + H0 + 0.72
        cd = CategoryChartData(); cd.categories = [p[0] for p in pts]
        cd.add_series("Code rate %", [round(p[1], 3) for p in pts])
        gch = f.s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(cx), Inches(cy), Inches(COLS[2] - 0.16), Inches(H1 - 1.05), cd)
        gch.name = f"Trend {num_}"
        ch = gch.chart; chart_text(ch, 8); ch.has_legend = False
        ch.has_title = True; ch.chart_title.text_frame.text = f"{codes_short(x['code'])} – % of tests"
        for r_ in ch.chart_title.text_frame.paragraphs[0].runs: font(r_, 9, DARK, True)
        plot = ch.plots[0]; plot.gap_width = 40
        ser = plot.series[0]
        for i_, p in enumerate(pts):
            pt = ser.points[i_]; pt.format.fill.solid(); pt.format.fill.fore_color.rgb = rgb(GREEN if p[2] else "BFBFBF")
        labels(ser, '0.00', XL_LABEL_POSITION.OUTSIDE_END, size=7)
        axis_quiet(ch.value_axis, True, '0.0', 0, None); axis_quiet(ch.category_axis, False)
        ch.category_axis.tick_labels.font.size = Pt(7.5)
# remove the trend pages that are not needed
def drop_slide(slide):
    sldIdLst = prs.slides._sldIdLst
    for sldId in list(sldIdLst):
        if prs.part.related_part(sldId.rId) is slide.part:
            for el in prs.part._element.iter("{http://schemas.microsoft.com/office/powerpoint/2010/main}sldId"):
                if el.get("id") == str(sldId.id): el.getparent().remove(el)
            prs.part.drop_rel(sldId.rId); sldIdLst.remove(sldId); return
for sl in TREND_SLIDES[len(pages):]:
    drop_slide(sl)
def move_after(slide, after):
    lst = prs.slides._sldIdLst; ids = {prs.part.related_part(e.rId): e for e in lst}
    el, ref = ids[slide.part], ids[after.part]
    lst.remove(el); ref.addnext(el)
    P14 = "{http://schemas.microsoft.com/office/powerpoint/2010/main}sldId"
    sec_ = {e.get("id"): e for e in prs.part._element.iter(P14)}
    a_, r_ = sec_.get(str(el.id)), sec_.get(str(ref.id))
    if a_ is not None and r_ is not None: a_.getparent().remove(a_); r_.addnext(a_)
move_after(MIX, S[4])
N_TREND = len(pages)

# ---------- 12. Key positive changes ----------
f = Frame(S[36], "Key Positive Changes", f"{MONTH_TITLE} · {FN} improvement start: {STARTS}")
yy = f.section("Highlights backed by PMSystem2 data (only changes that improved)")
cand = []
for k, g in enumerate(MODELS):
    b, a = q(f"line{FOCUS}_before_g{k}"), q(f"line{FOCUS}_after_g{k}")
    if not (b and a): continue
    nr, nn, ny = net.get(g, (0, 0, 0))
    cand.append((abs(rt(a) - rt(b)) * 3, signed(rt(a) - rt(b)), f"{FN} {SHORT[g]} Re-test",
                 f"{pct(rt(b))} → {pct(rt(a))} ({chg(rt(b), rt(a)):+.0f}%).", rt(a) < rt(b), "line"))
    cand.append((abs(ntf(a) - ntf(b)) * 3, signed(ntf(a) - ntf(b)), f"{FN} {SHORT[g]} NTF", f"{pct(ntf(b))} → {pct(ntf(a))}.", ntf(a) < ntf(b), "line"))
    cand.append((abs(rty(a) - rty(b)) * 3, signed(rty(a) - rty(b)), f"{FN} {SHORT[g]} RTY", f"{pct(rty(b))} → {pct(rty(a))}.", rty(a) > rty(b), "line"))
for n, g, b, a in srow:
    cand.append((abs(rt(a) - rt(b)), signed(rt(a) - rt(b)), f"{n} · {SHORT[g]} ({FN})", f"Re-test {pct(rt(b))} → {pct(rt(a))}; NTF {pct(ntf(b))} → {pct(ntf(a))}.", rt(a) < rt(b), "Station"))
for (g, c_), (bb, aa) in code_gain.items():
    if bb >= 0.1: cand.append((abs(chg(bb, aa)) / 20, f"{chg(bb, aa):+.0f}%", f"{c_[:28]} · {SHORT[g]}", f"{bb:.2f}% → {aa:.2f}% of tests on {FN}.", aa < bb * 0.85, "Error code"))
cand.append((abs(rt(cur) - rt(prev)) * 2, signed(rt(cur) - rt(prev)), "Plant Re-test", f"{mname(1)} {pct(rt(prev))} → {mname(0)} {pct(rt(cur))}; NTF {pct(ntf(prev))} → {pct(ntf(cur))}.", rt(cur) < rt(prev), "plant"))
cand.append((abs(rty(cur) - rty(prev)) * 2, signed(rty(cur) - rty(prev)), "Plant RTY", f"{mname(1)} {pct(rty(prev))} → {mname(0)} {pct(rty(cur))}.", rty(cur) > rty(prev), "plant"))
cand.append((improved / max(len(lines), 1), f"{improved}/{len(lines)}", "Lines with lower Re-test", f"Lines that reduced Re-test in {mname(0)} vs {mname(1)}.", improved * 2 > len(lines), "plant"))
good, caps, line_models = [], {"line": 2, "Station": 1, "Error code": 1, "plant": 2}, set()
for c_ in sorted([c_ for c_ in cand if c_[4]], key=lambda c_: -c_[0]):
    if c_[5] == "line":
        mdl = next((g for g in MODELS if f" {SHORT[g]} " in c_[2]), None)
        if mdl in line_models: continue          # best line-level change of each model
        line_models.add(mdl)
    if caps[c_[5]] > 0: caps[c_[5]] -= 1; good.append(c_)
good = sorted(good, key=lambda c_: ["line", "Station", "Error code", "plant"].index(c_[5]))[:6]
gw, gh = (12.24 - 2 * 0.24) / 3, 2.15
for i, (_, big, head, detail, _, _) in enumerate(good):
    x = 0.53 + (i % 3) * (gw + 0.24); y = yy + (i // 3) * (gh + 0.24)
    rect(f.s, x, y, gw, gh, G2, name=f"Positive change {i + 1}")
    textbox(f.s, x + 0.25, y + 0.2, 0.4, 0.3, [f"{i + 1:02d}"], size=12, color=G3, bold=True)
    textbox(f.s, x + 0.25, y + 0.5, gw - 0.5, 0.6, [big], size=30, color=GREEN, bold=True)
    textbox(f.s, x + 0.25, y + 1.15, gw - 0.5, 0.3, [head], size=12 if len(head) <= 34 else 10, bold=True)
    textbox(f.s, x + 0.25, y + 1.5, gw - 0.5, 0.55, [detail], size=9.5, color=DARK)
print("positive changes:", [g[2] for g in good])

# ---------- 12. Remaining issues ----------
f = Frame(S[37], "Remaining Issues", f"{MONTH_TITLE} · plant-wide")
tops = sorted([(st_meta.get(int(k[5:])), q(k)) for k in D if k.startswith("m0_st") and q(k)], key=lambda x: -x[1]["retestNgAttempts"])[:10]
tot_ng = cur["retestNgAttempts"]
yy = f.section("Top 10 stations by NG attempts", w=7.3, unit="(Unit: attempts, %)")
tr2 = [["#", "Line", "Station", "Model group", "Tests", "NG", "% NG", "Re-test", "NTF"]]
for i, (mt, m) in enumerate(tops, 1):
    tr2.append([str(i), mt["lineName"], mt["name"], mt["modelGroupName"], num(m["retestAttempts"]), num(m["retestNgAttempts"]),
                f"{m['retestNgAttempts'] * 100 / tot_ng:.1f}", f"{rt(m):.2f}", f"{ntf(m):.2f}"])
def ifmt(i, j, v):
    o = {"bold": True} if j == 2 else {}
    if j == 7 and float(v) >= rt(cur) * 1.5: o.update({"color": RED, "bold": True})
    if j == 8 and float(v) >= ntf(cur) * 1.5: o.update({"color": RED, "bold": True})
    return o
table(f.s, 0.53, yy, 7.3, tr2, [0.3, 0.8, 1.0, 1.35, 0.8, 0.65, 0.55, 0.7, 0.6], row_h=0.36, size=8,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 5, cell_fmt=ifmt, name="Top stations")
textbox(f.s, 0.53, yy + 0.36 * len(tr2) + 0.06, 7.3, 0.2, [f"* Red: ≥ 1.5× plant level ({pct(rt(cur))} / {pct(ntf(cur))})."], size=8, color=G3)
f.section("Top error codes (plant)", x=8.13, w=4.64, unit="(Unit: attempts, %)")
par = D.get("pareto_m0") or []
prow = [["#", "Error code", "NG", "%"]] + [[str(i), p["code"], num(p["count"]), f"{p['pct']:.1f}"] for i, p in enumerate(par[:10], 1)]
table(f.s, 8.13, yy, 4.64, prow, [0.3, 2.6, 0.7, 0.55], row_h=0.36, size=8, aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER],
      cell_fmt=lambda i, j, v: {"bold": True} if j == 1 else ({"fill": LVIOLET} if i <= 3 else None), name="Top error codes")
textbox(f.s, 8.13, yy + 0.36 * len(prow) + 0.06, 4.64, 0.2, [f"* Top 10 = {sum(p['pct'] for p in par[:10]):.1f}% of NG attempts."], size=8, color=G3)

# ---------- 13. Action plan ----------
f = Frame(S[38], "Action Plan", f"Follow-up from the {mname(0, False)} review · generated from the findings of this report")
nxt = LAST + dt.timedelta(days=7 - LAST.weekday() + 4)          # Friday of next week
def due(d): return f"{d:%d/%m} (W{d.isocalendar()[1]})"
D_URG, D_REV = due(nxt), due(nxt + dt.timedelta(days=21))
plan = []                                                        # (priority, category, issue, action, due)
JIG = re.compile(r"(W\d+|\d\d/\d\d) rise to ([\d.]+)%: (Jig \d+(?: \(IP [\d.]+\))?) = (\d+)% of the NG \((\d+) NG / ([\d,]+) tests")
seen_jig = set()
for num_, x in enumerate(IMP, 1):
    for n_ in x["notes"]:
        mj = JIG.search(n_)
        if mj and (x["line"], x["station"], mj.group(3)) not in seen_jig:
            seen_jig.add((x["line"], x["station"], mj.group(3)))
            plan.append((1, "Jig", f"#{num_} {x['line']} {x['station']}: {codes_short(x['code'])} back to {mj.group(2)}% in {mj.group(1)}; "
                                   f"{mj.group(3)} = {mj.group(4)}% of the NG ({mj.group(5)} NG / {mj.group(6)} tests)",
                         f"Check pins / RF contact of {mj.group(3).split(' (')[0]} (repeat the fix: {x['action'][:60]}); compare with the other jigs; "
                         f"stop the jig if NG stays > 3%", D_URG))
rises, sides = [], []
for n, m, pm in lines:
    if not pm or rt(m) <= rt(pm): continue
    rb_ = {p_["code"]: p_["count"] * 100 / pm["retestAttempts"] for p_ in D.get(f"pareto_m1_line{line_id[n]}", [])}
    ra_ = {p_["code"]: p_["count"] * 100 / m["retestAttempts"] for p_ in D.get(f"pareto_m0_line{line_id[n]}", [])}
    best = max(((ra_.get(c, 0) - rb_.get(c, 0), c) for c in set(rb_) | set(ra_)), default=(0, ""))
    if best[0] < 0.2: continue
    acted = [k for k, x in enumerate(IMP, 1) if x["line"] == n and best[1] in x["code"]]
    if acted:
        plan.append((3, "Monitor", f"{n}: Re-test {pct(rt(pm))} → {pct(rt(m))}; {best[1]} +{best[0]:.2f}% of tests",
                     f"Action already taken (#{', #'.join(map(str, acted))}); confirm the code stays down for 4 weeks", D_REV))
    else:
        rises.append((best[0], 2, "Line Re-test", f"{n}: Re-test {pct(rt(pm))} → {pct(rt(m))}; main cause {best[1]} +{best[0]:.2f}% of tests",
                     f"Find the station / jig with most {best[1]} NG, analyse NG logs and define a corrective action; add it to ImprovementList", D_URG))
plan += [r[1:] for r in sorted(rises, reverse=True)[:3]]
WATCH = re.compile(r"watch: (.+) rose \+([\d.]+)% at the same station")
for num_, x in enumerate(IMP, 1):
    for n_ in x["notes"]:
        mw = WATCH.search(n_)
        if mw and float(mw.group(2)) >= 0.5:
            sides.append((float(mw.group(2)), 2, "Side effect", f"#{num_} {x['line']} {x['station']} ({SHORT.get(x['model'], x['model'])}): {mw.group(1)} rose +{mw.group(2)}% after the action",
                         f"Check whether the action on {codes_short(x['code'])} caused it (same jig / pin?); define an action if it stays high", D_URG))
plan += [r[1:] for r in sorted(sides, reverse=True)[:2]]
early = [k for k, x in enumerate(IMP, 1) if "(early)" in x["verdict"] or (x["days_after"] or 0) < 14 and x["verdict"] != "Insufficient data"]
if early:
    plan.append((3, "Monitor", f"Improvements with < 14 days of data after the action: #{', #'.join(map(str, early))}",
                 "Keep tracking weekly; confirm the verdict with ≥ 4 weeks of data at the next monthly review", D_REV))
insuf = [(k, x) for k, x in enumerate(IMP, 1) if x["verdict"] == "Insufficient data"]
if insuf:
    lns = sorted({f"{x['line']} {x['station']}" for _, x in insuf})
    plan.append((2, "Data", f"Cannot verify #{', #'.join(str(k) for k, _ in insuf)} ({', '.join(lns)}): too few test logs after the action",
                 "Restore the test-log upload of these stations to PMSystem2, then re-run the verification", D_URG))
st_by_id = {int(k): v for k, v in st_meta.items()} if isinstance(next(iter(st_meta), 0), str) else st_meta
for sid_, v in sorted(D.get("excl_m0_st", {}).items(), key=lambda kv: -kv[1]):
    mt, m = st_by_id.get(int(sid_)), q(f"m0_st{sid_}")
    if not mt or not m or v * 100 < m["retestAttempts"] * 1.0: continue
    plan.append((2, "Data", f"{mt['lineName']} {mt['name']} ({mt['modelGroupName']}): {num(v)} NG ({v * 100 / m['retestAttempts']:.1f}% of tests) "
                            f"without an error in the log (UNKNOWN)", "Send sample logs to update the log reader so the real error code is recorded", D_URG))
if not plan:
    plan.append((3, "Monitor", "No open finding from the data", "Keep the current controls", D_REV))
plan.sort(key=lambda x: x[0])
# 5 actions: one per category (same-category findings merged), then fill with the remaining ones
CATS = ["Jig", "Line Re-test", "Side effect", "Data", "Monitor"]
MERGE = {"Jig", "Data", "Monitor"}
grp = {c: [x for x in plan if x[1] == c] for c in CATS}
picked = []
for c in CATS:
    g = grp[c]
    if not g: continue
    if c in MERGE and len(g) > 1:
        acts = list(dict.fromkeys(x[3] for x in g))
        picked.append((min(x[0] for x in g), c, "; ".join(x[2] for x in g), " / ".join(acts)))
        grp[c] = []
    else:
        picked.append(g[0][:4]); grp[c] = g[1:]
rest = sorted((x for c in CATS for x in grp[c]), key=lambda x: x[0])
picked += [x[:4] for x in rest[:max(0, 5 - len(picked))]]
picked = sorted(picked[:5], key=lambda x: x[0])
plan = [x + (due(nxt + dt.timedelta(days=7 * min(i, 3))),) for i, x in enumerate(picked)]   # next week ... +3 weeks (~1 month)
yy = f.section("Actions", unit="(PIC to be assigned in the meeting)")
PRI = {1: ("High", RED), 2: ("Medium", "F4B183"), 3: ("Low", "FFEB9C")}
arows = [["#", "Priority", "Category", "Issue (from data)", "Action", "PIC", "Due date", "Status"]]
for i, (pr, cat, iss, act, dd_) in enumerate(plan, 1):
    arows.append([str(i), PRI[pr][0], cat, iss, act, "", dd_, "Open"])
def afmt(i, j, v):
    if i == 0: return None
    o = {}
    if j == 1: o.update({"fill": PRI[plan[i - 1][0]][1], "bold": True, "color": WHITE if plan[i - 1][0] == 1 else BLACK})
    if j == 2: o["bold"] = True
    if j in (3, 4): o["align"] = PP_ALIGN.LEFT
    return o
arh = min(0.85, (6.85 - yy - 0.3) / len(plan))
table(f.s, 0.53, yy, 12.24, arows, [0.3, 0.7, 0.95, 4.2, 4.04, 0.65, 0.85, 0.55], row_h=arh, size=9, header_h=0.3, cell_fmt=afmt, name="Action plan")
textbox(f.s, 0.53, yy + 0.3 + arh * len(plan) + 0.05, 12.24, 0.2,
        [f"* Generated from this report: jig rises after an action, lines with higher Re-test vs {mname(1)}, side effects, early verdicts, missing logs and NG without an error code. "
         f"Due dates spread over the next month by priority."], size=7.5, color=G3)

# ---------- 14. End ----------
strip_annotations(S[39])
for idx, sl in enumerate(list(prs.slides), 1):
    for sh in sl.shapes:
        if sh.name.startswith("슬라이드 번호") and sh.has_text_frame and not sh._element.findall(".//" + qn("a:fld")) and sh.text_frame.paragraphs[0].runs:
            set_runs(sh, [str(idx)])
prs.save(OUT); print("saved", OUT)
