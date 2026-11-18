"""Monthly Quality Report (English): NTF / Re-test / RTY + Line 6-1 improvement review by model."""
import json, os, sys, datetime as dt
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
def signed(v, unit="%p"): return f"{v:+.2f}{unit}"
def dcol(v, higher_better=False):
    if abs(v) < 0.005: return G3
    return GREEN if (v > 0) == higher_better else RED
cur, prev = q("m0"), q("m1")
st_meta = {s["id"]: s for s in D["stations"]}
DQ = ("* Model = current job-file mapping (pcb_results.model_id is outdated for ICON25 and August data). "
      "Tests with an invalid start time (infinity / future clock) are not counted.")

prs = Presentation(os.environ.get("SKELETON", os.path.join(HERE, "assets", "skeleton_monthly.pptx"))); S = list(prs.slides)

# ---------- 1. Cover ----------
c = S[0]; strip_annotations(c)
set_runs(by_name(c, "Title 1"), ["Monthly Quality Report", "NTF · Re-test · RTY"])
sub = by_name(c, "내용 개체 틀 2"); set_runs(sub, [f"{MONTH_TITLE} · {FN} improvement review · PMSystem2 data"]); sub.width = Inches(9)
gt = by_name(c, "Group 46").table
for r in range(len(gt.rows)):
    if gt.cell(r, 0).text_frame.text.strip().startswith("Document"):
        runs = gt.cell(r, 1).text_frame.paragraphs[0].runs; runs[0].text = f"QA-{RM.strftime('%Y-%m')}"
        for extra in runs[1:]: extra._r.getparent().remove(extra._r)

# ---------- 2. Contents ----------
TOC = [("Monthly KPI Summary", "3"), (f"{FN} Improvement Review", "6"), ("Key Positive Changes", "11"),
       ("Remaining Issues", "12"), ("Action Plan", "13")]
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
yy = f.section(f"Key indicators – {mname(0, False)}", unit="(Unit: %, %p = percentage points)")
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
yy = f.section(f"Re-test by line – {mname(1)} vs {mname(0)}", w=5.84, unit="(Unit: %)")
column_chart(f.s, 0.53, yy, 5.84, 4.6, [n for n, *_ in lines], [(mname(1), [rt(pm) if pm else 0 for _, _, pm in lines]), (mname(0), [rt(m) for _, m, _ in lines])],
             ["BFBFBF", VIOLET], bar=True, gap=60, overlap=-10, lo=0, name="Re-test by line")
f.section("KPI table by line (sorted by Re-test)", x=6.93, w=5.84, unit="(Unit: %)")
lrows = [["Line", "Tests", "Re-test", f"Δ {mname(1)}", "NTF", "RTY", f"Δ RTY"]]
for n, m, pm in lines:
    lrows.append([n, num(m["retestAttempts"]), f"{rt(m):.2f}", delta(rt(m), rt(pm), False)[0] if pm else "–",
                  f"{ntf(m):.2f}", f"{rty(m):.2f}", delta(rty(m), rty(pm), True)[0] if pm else "–"])
def lfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j == 3 and v != "–": o["color"] = RED if v.startswith("▲") else (GREEN if v.startswith("▼") else G3)
    if j == 6 and v != "–": o["color"] = GREEN if v.startswith("▲") else (RED if v.startswith("▼") else G3)
    if lrows[i][0] == FN: o["fill"] = LGREEN
    return o
rh = min(0.3, 4.6 / len(lrows))
table(f.s, 6.93, yy, 5.84, lrows, [1.25, 1.1, 0.8, 1.0, 0.75, 0.8, 1.0], row_h=rh, size=8.5, cell_fmt=lfmt, name="KPI by line")
improved = sum(1 for _, m, pm in lines if pm and rt(m) < rt(pm))
textbox(f.s, 6.93, yy + rh * len(lrows) + 0.06, 5.84, 0.4,
        [f"* {improved} of {len(lines)} lines reduced Re-test vs {mname(1)}. Line RTY = PCBs that passed every station of the line first time. Green row = {FN}."], size=8, color=G3)

# ---------- 6. Section divider ----------
sd = S[5]; strip_annotations(sd)
set_runs(by_name(sd, "Title 1"), ["02"])
for sh in sd.shapes:
    if sh.name == "Content Placeholder 2" and sh.has_text_frame:
        if sh.top / 914400 < 1: set_runs(sh, [FN, "Improvement Review"])
        else: set_runs(sh, [f"{m_['name']}: improvement from {d2(m_['A'][0])}" for m_ in MI]); sh.width = Inches(4.0)

# ---------- 7. Before vs after by model ----------
f = Frame(S[6], f"{FN}: Before vs After by Model", f"Improvement start: {STARTS} · control line {CN} (same models)")
yy = f.section(f"{FN} key indicators by model", unit="(Unit: %)")
cw2 = (12.24 - 0.24) / 2
net = {}
for k, g in enumerate(MODELS):
    b, a = q(f"line{FOCUS}_before_g{k}"), q(f"line{FOCUS}_after_g{k}")
    cb, ca = q(f"line{CONTROL}_before_g{k}"), q(f"line{CONTROL}_after_g{k}")
    x = 0.53 + k * (cw2 + 0.24)
    rect(f.s, x, yy, cw2, 1.85, G2, name=f"Model card {SHORT[g]}")
    textbox(f.s, x + 0.25, yy + 0.15, cw2 - 0.5, 0.3, [[(g, {"size": 14, "bold": True}),
            (f"  {num(b['retestAttempts'])} → {num(a['retestAttempts'])} tests" if b and a else "  no data", {"size": 9, "color": G3})]])
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
y2 = f.section(f"Improvement effect vs control line {CN}", y=yy + 2.1)
erows = [["Model", "Line", "Re-test B", "Re-test A", "Δ Re-test", "NTF B", "NTF A", "Δ NTF", "RTY B", "RTY A", "Δ RTY"]]
for k, g in enumerate(MODELS):
    for lid, lab in ((FOCUS, FN), (CONTROL, f"{CN} (control)")):
        b, a = q(f"line{lid}_before_g{k}"), q(f"line{lid}_after_g{k}")
        if not (b and a): erows.append([SHORT[g], lab] + ["–"] * 9); continue
        erows.append([SHORT[g], lab, f"{rt(b):.2f}", f"{rt(a):.2f}", signed(rt(a) - rt(b)), f"{ntf(b):.2f}", f"{ntf(a):.2f}",
                      signed(ntf(a) - ntf(b)), f"{rty(b):.2f}", f"{rty(a):.2f}", signed(rty(a) - rty(b))])
    if g in net:
        nr, nn, ny = net[g]; erows.append([SHORT[g], "Net effect", "", "", signed(nr), "", "", signed(nn), "", "", signed(ny)])
def efmt(i, j, v):
    o = {"bold": True} if j in (0, 1) and erows[i][1] == "Net effect" else ({"bold": True} if j == 0 else {})
    if j in (4, 7, 10) and v not in ("", "–"):
        good = v.startswith("-") if j != 10 else v.startswith("+")
        o.update({"bold": True, "color": GREEN if good else RED})
        if erows[i][1] == "Net effect": o["fill"] = LGREEN if good else "FADBD8"
    elif erows[i][1] == "Net effect": o["fill"] = G2
    return o
table(f.s, 0.53, y2, 12.24, erows, [1.0, 1.5, 0.9, 0.9, 1.0, 0.85, 0.85, 1.0, 0.85, 0.85, 1.0], row_h=0.29, size=8.5, cell_fmt=efmt, name="Before-after by model")
textbox(f.s, 0.53, y2 + 0.29 * len(erows) + 0.06, 12.24, 0.4,
        [f"* B = before, A = after (periods per model, see cards). Net effect = change on {FN} minus change on {CN} for the same model (removes shared month-to-month effects). Line RTY = passed all {FN} stations first time."], size=8, color=G3)

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
trs = [["Model", "Station", "Tests B", "Tests A", "Re-test B", "Re-test A", "Δ Re-test", "NTF B", "NTF A", "Δ NTF", "RTY B", "RTY A"]]
for n, g, b, a in srow:
    trs.append([SHORT[g], n, num(b["retestAttempts"]), num(a["retestAttempts"]), f"{rt(b):.2f}", f"{rt(a):.2f}", signed(rt(a) - rt(b)),
                f"{ntf(b):.2f}", f"{ntf(a):.2f}", signed(ntf(a) - ntf(b)), f"{rty(b):.2f}", f"{rty(a):.2f}"])
def sfmt(i, j, v):
    o = {"bold": True} if j in (0, 1) else {}
    if j in (6, 9): o.update({"bold": True, "color": GREEN if v.startswith("-") else RED})
    return o
rh9 = 0.27
table(f.s, 0.53, yy, 12.24, trs, [0.9, 1.1, 1.0, 1.0, 0.95, 0.95, 1.0, 0.85, 0.85, 0.95, 0.85, 0.85], row_h=rh9, size=8.5, cell_fmt=sfmt, name="Stations by model")
y3 = yy + rh9 * len(trs) + 0.15
y4 = f.section("Re-test by station – before vs after", y=y3, unit="(Unit: %)")
column_chart(f.s, 0.53, y4, 12.24, 6.85 - y4, [f"{n} · {SHORT[g]}" for n, g, _, _ in srow],
             [("Before", [rt(b) for _, _, b, _ in srow]), ("After", [rt(a) for _, _, _, a in srow])], ["BFBFBF", GREEN], fmt='0.0', lo=0, gap=70, overlap=-10,
             name="Station re-test before after")

# ---------- 10. Error codes by model ----------
f = Frame(S[9], f"{FN}: Error Codes by Model", "NG per 1,000 test attempts (normalised for volume) · before vs after")
code_gain = {}
for k, g in enumerate(MODELS):
    b, a = q(f"line{FOCUS}_before_g{k}"), q(f"line{FOCUS}_after_g{k}")
    x = 0.53 + k * (5.84 + 0.56)
    yy = f.section(f"{g}", x=x, w=5.84, unit="(Unit: NG / 1k tests)")
    if not (b and a): continue
    rb = {p["code"]: p["count"] * 1000 / b["retestAttempts"] for p in D.get(f"pareto_line{FOCUS}_before_g{k}", [])}
    ra = {p["code"]: p["count"] * 1000 / a["retestAttempts"] for p in D.get(f"pareto_line{FOCUS}_after_g{k}", [])}
    codes = sorted(set(list(rb)[:8]) | set(list(ra)[:4]), key=lambda c_: -max(rb.get(c_, 0), ra.get(c_, 0)))[:11]
    rows_ = [["Error code", "Before", "After", "Δ", "Change"]]
    for c_ in codes:
        bb, aa = rb.get(c_, 0), ra.get(c_, 0)
        rows_.append([c_, f"{bb:.2f}", f"{aa:.2f}", f"{aa - bb:+.2f}", f"{chg(bb, aa):+.0f}%" if bb else "new"])
        code_gain[(g, c_)] = (bb, aa)
    table(f.s, x, yy, 5.84, rows_, [2.75, 0.75, 0.75, 0.75, 0.8], row_h=0.36, size=8,
          cell_fmt=lambda i, j, v: {"bold": True, "align": PP_ALIGN.LEFT} if j == 0 else ({"color": GREEN if v.startswith("-") else RED} if j in (3, 4) else None),
          name=f"Error codes {SHORT[g]}")
    textbox(f.s, x, yy + 0.36 * len(rows_) + 0.06, 5.84, 0.2, [f"* Tests: before {num(b['retestAttempts'])}, after {num(a['retestAttempts'])}."], size=8, color=G3)

# ---------- 11. Key positive changes ----------
f = Frame(S[10], "Key Positive Changes", f"{MONTH_TITLE} · {FN} improvement start: {STARTS}")
yy = f.section("Highlights backed by PMSystem2 data (only changes that improved)")
cand = []
for k, g in enumerate(MODELS):
    b, a = q(f"line{FOCUS}_before_g{k}"), q(f"line{FOCUS}_after_g{k}")
    if not (b and a): continue
    nr, nn, ny = net.get(g, (0, 0, 0))
    cand.append((abs(rt(a) - rt(b)) * 3, signed(rt(a) - rt(b)), f"{FN} {SHORT[g]} Re-test",
                 f"{pct(rt(b))} → {pct(rt(a))} ({chg(rt(b), rt(a)):+.0f}%); net {signed(nr)} vs {CN}.", rt(a) < rt(b), "line"))
    cand.append((abs(ntf(a) - ntf(b)) * 3, signed(ntf(a) - ntf(b)), f"{FN} {SHORT[g]} NTF", f"{pct(ntf(b))} → {pct(ntf(a))}; net {signed(nn)} vs {CN}.", ntf(a) < ntf(b), "line"))
    cand.append((abs(rty(a) - rty(b)) * 3, signed(rty(a) - rty(b)), f"{FN} {SHORT[g]} RTY", f"{pct(rty(b))} → {pct(rty(a))}; net {signed(ny)} vs {CN}.", rty(a) > rty(b), "line"))
for n, g, b, a in srow:
    cand.append((abs(rt(a) - rt(b)), signed(rt(a) - rt(b)), f"{n} · {SHORT[g]} ({FN})", f"Re-test {pct(rt(b))} → {pct(rt(a))}; NTF {pct(ntf(b))} → {pct(ntf(a))}.", rt(a) < rt(b), "Station"))
for (g, c_), (bb, aa) in code_gain.items():
    if bb >= 1: cand.append((abs(chg(bb, aa)) / 20, f"{chg(bb, aa):+.0f}%", f"{c_[:28]} · {SHORT[g]}", f"{bb:.1f} → {aa:.1f} NG per 1k tests on {FN}.", aa < bb * 0.85, "Error code"))
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
    textbox(f.s, x + 0.25, y + 1.15, gw - 0.5, 0.3, [head if len(head) <= 34 else head[:33] + "…"], size=12, bold=True)
    textbox(f.s, x + 0.25, y + 1.5, gw - 0.5, 0.55, [detail], size=9.5, color=DARK)
print("positive changes:", [g[2] for g in good])

# ---------- 12. Remaining issues ----------
f = Frame(S[11], "Remaining Issues", f"{MONTH_TITLE} · plant-wide")
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
f = Frame(S[12], "Action Plan", f"Follow-up from the {mname(0, False)} review")
yy = f.section("Actions", unit="(To be completed by the owner)")
items = [(f"{tops[0][0]['name']} · {tops[0][0]['lineName']}", f"Most NG attempts ({tops[0][1]['retestNgAttempts'] * 100 / tot_ng:.1f}% of plant), Re-test {pct(rt(tops[0][1]))}")]
if par: items.append((par[0]["code"], f"Top error code, {par[0]['pct']:.1f}% of NG attempts"))
for k, g in enumerate(MODELS):
    b, a = q(f"line{FOCUS}_before_g{k}"), q(f"line{FOCUS}_after_g{k}")
    if b and a: items.append((f"{FN} · {SHORT[g]}", f"Re-test {pct(rt(b))} → {pct(rt(a))}, RTY {pct(rty(b))} → {pct(rty(a))}"))
arows = [["#", "Focus area", "Finding", "Action", "Owner", "Due date", "Status"]]
for i in range(6):
    a_, b_ = items[i] if i < len(items) else ("", "")
    arows.append([str(i + 1), a_, b_, "", "", "", ""])
table(f.s, 0.53, yy, 12.24, arows, [0.35, 2.0, 3.0, 3.9, 1.1, 1.0, 0.9], row_h=0.62, size=9, header_h=0.32,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.CENTER],
      cell_fmt=lambda i, j, v: {"bold": True} if j == 1 else None, name="Action plan")
textbox(f.s, 0.53, yy + 0.32 + 0.62 * 6 + 0.06, 12.24, 0.2, ["* Focus areas are suggested from the data; actions, owners and due dates to be added by the team."], size=8, color=G3)

# ---------- 14. End ----------
strip_annotations(S[13])
for idx, sl in enumerate(S, 1):
    for sh in sl.shapes:
        if sh.name.startswith("슬라이드 번호") and sh.has_text_frame and not sh._element.findall(".//" + qn("a:fld")) and sh.text_frame.paragraphs[0].runs:
            set_runs(sh, [str(idx)])
prs.save(OUT); print("saved", OUT)
