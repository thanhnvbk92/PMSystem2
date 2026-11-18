"""Monthly Quality Report (English): NTF / Re-test / FPY + Line 6-1 improvement review (before vs after)."""
import json, os, sys, datetime as dt
from pptlib import *

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.environ.get("DATA_M", os.path.join(HERE, "data_m.json")), encoding="utf-8"))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "report_m.pptx")
META = D["meta"]
RM = dt.datetime.fromisoformat(META["report_month"]); RE = dt.datetime.fromisoformat(META["report_end"])
BEF = [dt.datetime.fromisoformat(x) for x in META["before"]]; AFT = [dt.datetime.fromisoformat(x) for x in META["after"]]
FOCUS, CONTROL = META["focus"], META["control"]
LN = {l["id"]: l["name"] for l in D["lines"]}
FN, CN = LN[FOCUS], LN[CONTROL]
MTD = (RE - dt.timedelta(days=1)).month == RM.month and RE.day != 1
LAST = RE - dt.timedelta(days=1)

def q(k):
    v = D.get(k)
    return v if isinstance(v, dict) and "error" not in v and v.get("retestAttempts") else None
def fpy(m): return m["rtyRate"]
def rt(m): return m["retestDefectRate"]
def ntf(m): return m["ntfRate"]
def sfpy(m): return round(100 - m["ntfRate"], 2)
def mstart(i):
    y, mo = RM.year, RM.month - i
    while mo <= 0: mo += 12; y -= 1
    return dt.date(y, mo, 1)
def mname(i, short=True):
    s = mstart(i).strftime("%b" if short else "%B %Y")
    return s + ("*" if i == 0 and MTD and short else "")
def d2(d): return d.strftime("%d %b")
MONTH_TITLE = f"{mname(0, False)}" + (f" (MTD {mstart(0).strftime('%d')}–{LAST.strftime('%d %b')})" if MTD else "")
BEF_TXT = f"{d2(BEF[0])} – {d2(BEF[1] - dt.timedelta(days=1))}"
AFT_TXT = f"{d2(AFT[0])} – {d2(AFT[1] - dt.timedelta(days=1))}"
def chg(a, b):  # relative change %
    return (b - a) * 100 / a if a else 0
def signed(v, unit="%p"): return f"{v:+.2f}{unit}"

cur, prev = q("m0"), q("m1")
st_meta = {s["id"]: s for s in D["stations"]}

prs = Presentation(os.path.join(HERE, "skeleton_m.pptx"))
S = list(prs.slides)

# ---------- 1. Cover ----------
c = S[0]; strip_annotations(c)
set_runs(by_name(c, "Title 1"), ["Monthly Quality Report", "NTF · Re-test · FPY"])
sub = by_name(c, "내용 개체 틀 2"); set_runs(sub, [f"{MONTH_TITLE} · {FN} improvement review · PMSystem2 data"]); sub.width = Inches(9)
gt = by_name(c, "Group 46").table
for r in range(len(gt.rows)):
    if gt.cell(r, 0).text_frame.text.strip().startswith("Document"):
        cell = gt.cell(r, 1); runs = cell.text_frame.paragraphs[0].runs
        runs[0].text = f"QA-{RM.strftime('%Y-%m')}"
        for extra in runs[1:]: extra._r.getparent().remove(extra._r)

# ---------- 2. Contents ----------
TOC = [("Monthly KPI Summary", "3"), (f"{FN} Improvement Review", "6"), ("Key Positive Changes", "11"),
       ("Remaining Issues", "12"), ("Action Plan", "13")]
t = S[1]; strip_annotations(t)
rows = {}
for sh in list(t.shapes):
    if sh.has_text_frame and sh.name == "Content Placeholder 2":
        rows.setdefault(round(sh.top / 914400 / 0.555), []).append(sh)
for i, k in enumerate(sorted(rows)):
    grp = rows[k]
    if i >= len(TOC):
        for sh in grp: remove(sh)
        continue
    for sh in grp:
        x = sh.left / 914400
        if x < 5: set_runs(sh, [f"{i + 1:02d}"])
        elif x < 10.5: set_runs(sh, [TOC[i][0]]); sh.width = Inches(3.0)
        else: set_runs(sh, [TOC[i][1]])
for sh in list(t.shapes):
    if sh.shape_type == 9 and sh.top / 914400 > 0.56 + 0.555 * (len(TOC) - 1) + 0.4: remove(sh)

# ---------- 3. Monthly KPI summary ----------
f = Frame(S[2], "Monthly KPI Summary", f"{MONTH_TITLE} · vs {mname(1, False)}")
yy = f.section(f"Key indicators – {mname(0, False)}", unit="(Unit: %, %p = percentage points)")
cards = [("FPY", "plant-wide", fpy, True, lambda m: f"{num(m['rtyStraightThroughPcbs'])} first-pass PCBs / {num(m['rtyPcbs'])} PCBs", GREEN),
         ("Re-test", "NG test attempts", rt, False, lambda m: f"{num(m['retestNgAttempts'])} NG / {num(m['retestAttempts'])} test attempts", VIOLET),
         ("NTF", "PID–Station ever NG", ntf, False, lambda m: f"{num(m['ntfNgPcbStations'])} NG / {num(m['ntfPcbStations'])} PID–Stations", DARK)]
cw = 3.92
for i, (nm, sub_, fn, hb, det, col) in enumerate(cards):
    x = 0.53 + i * (cw + 0.24)
    rect(f.s, x, yy, cw, 2.05, G2, name=f"KPI card {nm}")
    textbox(f.s, x + 0.25, yy + 0.2, cw - 0.5, 0.3, [[(nm, {"size": 14, "bold": True}), (f"  {sub_}", {"size": 10, "color": G3})]])
    textbox(f.s, x + 0.25, yy + 0.55, cw - 0.5, 0.75, [pct(fn(cur))], size=40, color=col, bold=True)
    dtx, dcol = delta(fn(cur), fn(prev), hb)
    textbox(f.s, x + 0.25, yy + 1.33, cw - 0.5, 0.25, [[(dtx, {"color": dcol, "bold": True}), (f"  vs {mname(1)} ({pct(fn(prev))})", {"color": G3})]], size=11)
    textbox(f.s, x + 0.25, yy + 1.65, cw - 0.5, 0.25, [det(cur)], size=9, color=G3)
y2 = f.section("Definitions & figures", y=yy + 2.35)
m2 = q("m2")
defs = [["KPI", "Definition (PMSystem2)", mname(2), mname(1), mname(0), f"vs {mname(1)}"]]
for nm, formula, fn, hb in [("FPY", "PCBs never NG at any Station / all PCBs (PID) tested in the period", fpy, True),
                            ("Re-test", "NG test attempts / all test attempts (each test run = 1 attempt)", rt, False),
                            ("NTF", "PID–Station pairs that were ever NG / all PID–Station pairs tested", ntf, False)]:
    defs.append([nm, formula, pct(fn(m2)) if m2 else "–", pct(fn(prev)), pct(fn(cur)), delta(fn(cur), fn(prev), hb)[0]])
def dfmt(i, j, v):
    if j == 0: return {"bold": True}
    if j == 4: return {"bold": True, "fill": LVIOLET}
    if j == 5: return {"bold": True, "color": delta(float(defs[i][4][:-1]), float(defs[i][3][:-1]), defs[i][0] == "FPY")[1]}
table(f.s, 0.53, y2, 12.24, defs, [1.0, 5.6, 1.1, 1.1, 1.1, 1.3], row_h=0.34,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 4, cell_fmt=dfmt, name="KPI definitions")
textbox(f.s, 0.53, y2 + 0.34 * 4 + 0.08, 12.24, 0.2,
        [("* " + (f"{mname(0, False)} is month-to-date until {LAST.strftime('%d %b')}. " if MTD else "")
          + "Periods by test start time (factory clock). Line/Station FPY on later pages = 100% − NTF of that scope.")], size=8, color=G3)

# ---------- 4. 6-month trend ----------
f = Frame(S[3], "6-Month Trend", f"{mname(5, False)} – {mname(0, False)}")
ms = [i for i in range(5, -1, -1) if q(f"m{i}")]
cats = [mname(i) for i in ms]; mm = [q(f"m{i}") for i in ms]
fv, rv, nv = [fpy(m) for m in mm], [rt(m) for m in mm], [ntf(m) for m in mm]
yy = f.section("FPY by month", w=5.84, unit="(Unit: %)")
column_chart(f.s, 0.53, yy, 5.84, 2.6, cats, [("FPY", fv)], [GREEN], lo=max(0, int(min(fv)) - 3), hi=100, name="FPY by month")
f.section("Re-test & NTF by month", x=6.93, w=5.84, unit="(Unit: %)")
line_chart(f.s, 6.93, yy, 5.84, 2.6, cats, [("Re-test", rv), ("NTF", nv)], [VIOLET, DARK], lo=0, hi=round(max(rv) * 1.35 + 0.5), name="Re-test NTF by month")
y2 = f.section("Monthly figures", y=yy + 2.75)
trows = [["KPI"] + cats, ["FPY (%)"] + [f"{v:.2f}" for v in fv], ["Re-test (%)"] + [f"{v:.2f}" for v in rv],
         ["NTF (%)"] + [f"{v:.2f}" for v in nv], ["Test attempts"] + [num(m["retestAttempts"]) for m in mm],
         ["PCBs (PID)"] + [num(m["rtyPcbs"]) for m in mm]]
def tfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j == len(cats): o.update({"fill": LVIOLET, "bold": True})
    return o
table(f.s, 0.53, y2, 12.24, trows, [1.6] + [1] * len(cats), row_h=0.27, cell_fmt=tfmt, name="Monthly figures")
textbox(f.s, 0.53, y2 + 0.27 * len(trows) + 0.06, 12.24, 0.2,
        [f"* {mname(0)} = month-to-date until {LAST.strftime('%d %b')}." if MTD else "* Full calendar months."], size=8, color=G3)

# ---------- 5. KPI by line ----------
f = Frame(S[4], "KPI by Line", f"{MONTH_TITLE} · vs {mname(1, False)}")
lines = []
for l in D["lines"]:
    m, pm = q(f"m0_line{l['id']}"), q(f"m1_line{l['id']}")
    if m: lines.append((l["name"], m, pm, l["id"]))
lines.sort(key=lambda t: -rt(t[1]))
yy = f.section(f"Re-test by line – {mname(1)} vs {mname(0)}", w=5.84, unit="(Unit: %)")
column_chart(f.s, 0.53, yy, 5.84, 4.6, [n for n, *_ in lines],
             [(mname(1), [rt(pm) if pm else 0 for _, _, pm, _ in lines]), (mname(0), [rt(m) for _, m, _, _ in lines])],
             [G1.replace("E7E7E7", "BFBFBF"), VIOLET], bar=True, gap=60, overlap=-10, lo=0, name="Re-test by line")
f.section("KPI table by line (sorted by Re-test)", x=6.93, w=5.84, unit="(Unit: %)")
lrows = [["Line", "Tests", "Re-test", f"Δ {mname(1)}", "NTF", f"Δ {mname(1)}", "Stn FPY"]]
for n, m, pm, lid in lines:
    lrows.append([n, num(m["retestAttempts"]), f"{rt(m):.2f}", delta(rt(m), rt(pm), False)[0] if pm else "–",
                  f"{ntf(m):.2f}", delta(ntf(m), ntf(pm), False)[0] if pm else "–", f"{sfpy(m):.2f}"])
def lfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j in (3, 5) and v != "–": o["color"] = RED if v.startswith("▲") else (GREEN if v.startswith("▼") else G3)
    if lrows[i][0] == FN: o["fill"] = LGREEN
    return o
rh = min(0.3, 4.6 / len(lrows))
table(f.s, 6.93, yy, 5.84, lrows, [1.25, 1.1, 0.8, 1.0, 0.8, 1.0, 0.8], row_h=rh, size=8.5, cell_fmt=lfmt, name="KPI by line")
improved = sum(1 for _, m, pm, _ in lines if pm and rt(m) < rt(pm))
textbox(f.s, 6.93, yy + rh * len(lrows) + 0.06, 5.84, 0.4,
        [f"* {improved} of {len(lines)} lines reduced Re-test vs {mname(1)}. Stn FPY = 100% − NTF. Green row = focus line {FN}."], size=8, color=G3)

# ---------- 6. Section divider ----------
sd = S[5]; strip_annotations(sd)
set_runs(by_name(sd, "Title 1"), ["02"])
for sh in sd.shapes:
    if sh.name == "Content Placeholder 2" and sh.has_text_frame:
        if sh.top / 914400 < 1: set_runs(sh, [FN, "Improvement Review"])
        else: set_runs(sh, [f"Before: {BEF_TXT}", f"After: {AFT_TXT}"]); sh.width = Inches(4.0)

# ---------- 7. Line 6-1 before vs after ----------
fb, fa = q(f"line{FOCUS}_before"), q(f"line{FOCUS}_after")
cb, ca = q(f"line{CONTROL}_before"), q(f"line{CONTROL}_after")
f = Frame(S[6], f"{FN}: Before vs After", f"Before {BEF_TXT} · After {AFT_TXT} · control line {CN} (same model)")
yy = f.section(f"{FN} key indicators", unit="(Unit: %)")
kp = [("Re-test", rt, False, VIOLET), ("NTF", ntf, False, DARK), ("Station FPY", sfpy, True, GREEN)]
for i, (nm, fn, hb, col) in enumerate(kp):
    x = 0.53 + i * (cw + 0.24)
    rect(f.s, x, yy, cw, 1.95, G2, name=f"Before-after {nm}")
    textbox(f.s, x + 0.25, yy + 0.18, cw - 0.5, 0.3, [[(nm, {"size": 14, "bold": True}), (f"  {FN}", {"size": 10, "color": G3})]])
    textbox(f.s, x + 0.25, yy + 0.55, cw - 0.5, 0.6, [[(pct(fn(fb)), {"size": 20, "color": G3, "bold": True}),
                                                       ("  →  ", {"size": 16, "color": G3}),
                                                       (pct(fn(fa)), {"size": 26, "color": col, "bold": True})]])
    d_, dc = delta(fn(fa), fn(fb), hb)
    textbox(f.s, x + 0.25, yy + 1.25, cw - 0.5, 0.25, [[(d_, {"color": dc, "bold": True}), (f"  ({chg(fn(fb), fn(fa)):+.0f}% relative)", {"color": G3})]], size=11)
    textbox(f.s, x + 0.25, yy + 1.55, cw - 0.5, 0.25, [f"{CN} (control): {pct(fn(cb))} → {pct(fn(ca))}"], size=9, color=G3)
y2 = f.section(f"Improvement effect vs control line {CN}", y=yy + 2.25)
erows = [["Line", "Role", "Tests before", "Tests after", "Re-test before", "Re-test after", "Δ Re-test", "NTF before", "NTF after", "Δ NTF"]]
for n, role, b, a in ((FN, "Focus line", fb, fa), (CN, "Control (no focus)", cb, ca)):
    erows.append([n, role, num(b["retestAttempts"]), num(a["retestAttempts"]), f"{rt(b):.2f}", f"{rt(a):.2f}",
                  signed(rt(a) - rt(b)), f"{ntf(b):.2f}", f"{ntf(a):.2f}", signed(ntf(a) - ntf(b))])
net_rt = (rt(fa) - rt(fb)) - (rt(ca) - rt(cb)); net_ntf = (ntf(fa) - ntf(fb)) - (ntf(ca) - ntf(cb))
erows.append(["Net effect", f"{FN} − {CN}", "", "", "", "", signed(net_rt), "", "", signed(net_ntf)])
def efmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j in (6, 9) and v: o.update({"bold": True, "color": GREEN if v.startswith("-") else RED})
    if i == 3: o["fill"] = (LGREEN if v.startswith("-") else "FADBD8") if j in (6, 9) else G2
    return o
table(f.s, 0.53, y2, 12.24, erows, [1.1, 1.5, 1.1, 1.1, 1.1, 1.1, 1.0, 1.0, 1.0, 1.0], row_h=0.32, cell_fmt=efmt, name="Before-after vs control")
textbox(f.s, 0.53, y2 + 0.32 * 4 + 0.08, 12.24, 0.4,
        [f"* Net effect = change on {FN} minus change on {CN}; it removes month-to-month effects shared by both lines (same model BMW Wave NAD). Negative = better."], size=8, color=G3)

# ---------- 8. Weekly trend ----------
wks = sorted({int(k[2:].split("_")[0]) for k in D if k.startswith("wk") and k.endswith(f"_line{FOCUS}")})
wks = [w for w in wks if q(f"wk{w}_line{FOCUS}")]
aft_week = AFT[0].isocalendar()[1]
f = Frame(S[7], f"{FN}: Weekly Trend", f"W{wks[0]} – W{wks[-1]} · improvement period from {d2(AFT[0])} (W{aft_week})")
yy = f.section(f"Re-test by week – {FN} vs {CN}", unit="(Unit: %)")
wc = [f"W{w}" for w in wks]
f_rt = [rt(q(f"wk{w}_line{FOCUS}")) for w in wks]
c_rt = [rt(q(f"wk{w}_line{CONTROL}")) if q(f"wk{w}_line{CONTROL}") else 0 for w in wks]
line_chart(f.s, 0.53, yy, 12.24, 2.5, wc, [(FN, f_rt), (CN, c_rt)], [VIOLET, "BFBFBF"], fmt='0.0', lo=0, hi=round(max(f_rt + c_rt) * 1.25 + 1), name="Weekly re-test")
y2 = f.section(f"{FN} weekly figures", y=yy + 2.65)
wrows = [["Week"] + wc, ["Re-test (%)"] + [f"{v:.1f}" for v in f_rt],
         ["NTF (%)"] + [f"{ntf(q(f'wk{w}_line{FOCUS}')):.1f}" for w in wks],
         ["Tests"] + [f"{q(f'wk{w}_line{FOCUS}')['retestAttempts'] / 1000:.1f}k" for w in wks]]
def wfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j > 0 and wks[j - 1] >= aft_week: o["fill"] = LGREEN
    return o
table(f.s, 0.53, y2, 12.24, wrows, [1.3] + [1] * len(wks), row_h=0.28, size=8, cell_fmt=wfmt, name="Weekly figures")
pre = [v for w, v in zip(wks, f_rt) if w < aft_week]; post = [v for w, v in zip(wks, f_rt) if w >= aft_week]
textbox(f.s, 0.53, y2 + 0.28 * len(wrows) + 0.06, 12.24, 0.4,
        [f"* Green = improvement period. Average weekly Re-test {FN}: {sum(pre) / len(pre):.1f}% before → {sum(post) / len(post):.1f}% after; "
         f"best week W{wks[f_rt.index(min(post))]} ({min(post):.1f}%). W{wks[-1]} may be partial."], size=8, color=G3)

# ---------- 9. By station ----------
f = Frame(S[8], f"{FN}: Results by Station", f"Before {BEF_TXT} vs After {AFT_TXT}")
def st_rows(lid):
    out = []
    for sid, meta in st_meta.items():
        if meta["lineId"] != lid: continue
        b, a = q(f"st{sid}_before"), q(f"st{sid}_after")
        if b and a: out.append((meta["name"], b, a))
    return sorted(out, key=lambda t: -t[1]["retestNgAttempts"])
fs, cs = st_rows(FOCUS), st_rows(CONTROL)
yy = f.section(f"Re-test by station – {FN}", w=5.84, unit="(Unit: %)")
column_chart(f.s, 0.53, yy, 5.84, 4.4, [n for n, *_ in fs], [("Before", [rt(b) for _, b, _ in fs]), ("After", [rt(a) for _, _, a in fs])],
             ["BFBFBF", GREEN], fmt='0.0', lo=0, gap=70, overlap=-10, name="Station re-test before after")
f.section("Station table", x=6.93, w=5.84, unit="(Unit: %)")
def srows(rows_):
    out = [["Station", "Re-test B", "Re-test A", "Δ", "NTF B", "NTF A", "Δ"]]
    for n, b, a in rows_:
        out.append([n, f"{rt(b):.2f}", f"{rt(a):.2f}", signed(rt(a) - rt(b), ""), f"{ntf(b):.2f}", f"{ntf(a):.2f}", signed(ntf(a) - ntf(b), "")])
    return out
def sfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j in (3, 6): o.update({"bold": True, "color": GREEN if v.startswith("-") else RED})
    return o
cw7 = [1.3, 0.85, 0.85, 0.75, 0.75, 0.75, 0.75]
textbox(f.s, 6.93, yy, 5.84, 0.22, [[(FN, {"bold": True}), ("  (improved line)", {"color": G3})]], size=10)
r1 = srows(fs)
table(f.s, 6.93, yy + 0.28, 5.84, r1, cw7, row_h=0.3, size=8.5, cell_fmt=sfmt, name="Stations focus line")
y3 = yy + 0.28 + 0.3 * len(r1) + 0.2
textbox(f.s, 6.93, y3, 5.84, 0.22, [[(CN, {"bold": True}), ("  (control line)", {"color": G3})]], size=10)
r2 = srows(cs)
table(f.s, 6.93, y3 + 0.28, 5.84, r2, cw7, row_h=0.3, size=8.5, cell_fmt=sfmt, name="Stations control line")
textbox(f.s, 6.93, y3 + 0.28 + 0.3 * len(r2) + 0.06, 5.84, 0.2, ["* B = before, A = after, Δ in %p. Negative (green) = better."], size=8, color=G3)

# ---------- 10. Error codes ----------
f = Frame(S[9], f"{FN}: Error Codes Before vs After", "NG per 1,000 test attempts (normalised for volume)")
pb = D.get(f"pareto_line{FOCUS}_before") or []; pa = D.get(f"pareto_line{FOCUS}_after") or []
tb_, ta_ = fb["retestAttempts"], fa["retestAttempts"]
rb = {p["code"]: p["count"] * 1000 / tb_ for p in pb}; ra = {p["code"]: p["count"] * 1000 / ta_ for p in pa}
codes = sorted(set(list(rb)[:10]) | set(list(ra)[:5]), key=lambda c_: -rb.get(c_, 0))[:10]
yy = f.section("Top error codes – NG per 1,000 tests", w=6.4, unit="(Unit: NG / 1k tests)")
column_chart(f.s, 0.53, yy, 6.4, 4.5, [c_[:26] for c_ in codes], [("Before", [round(rb.get(c_, 0), 2) for c_ in codes]),
             ("After", [round(ra.get(c_, 0), 2) for c_ in codes])], ["BFBFBF", GREEN], fmt='0.0', bar=True, lo=0, gap=50, overlap=-10, name="Error codes before after")
f.section("Error code table", x=7.23, w=5.54, unit="(Unit: NG / 1k tests)")
erows2 = [["Error code", "Before", "After", "Δ", "Change"]]
for c_ in codes:
    b, a = rb.get(c_, 0), ra.get(c_, 0)
    erows2.append([c_, f"{b:.2f}", f"{a:.2f}", f"{a - b:+.2f}", f"{chg(b, a):+.0f}%" if b else "new"])
def cfmt(i, j, v):
    o = {"bold": True, "align": PP_ALIGN.LEFT} if j == 0 else {}
    if j in (3, 4): o["color"] = GREEN if v.startswith("-") else RED
    return o
table(f.s, 7.23, yy, 5.54, erows2, [2.7, 0.75, 0.75, 0.7, 0.75], row_h=0.36, size=8.5, cell_fmt=cfmt, name="Error code table")
textbox(f.s, 7.23, yy + 0.36 * len(erows2) + 0.06, 5.54, 0.4,
        [f"* Test attempts: before {num(tb_)}, after {num(ta_)}. Codes = top 10 before + top 5 after."], size=8, color=G3)

# ---------- 11. Key positive changes ----------
f = Frame(S[10], "Key Positive Changes", f"{MONTH_TITLE} · {FN} improvement period {AFT_TXT}")
yy = f.section("Highlights backed by PMSystem2 data")
m5 = q(f"m{max(ms)}")
# candidates: (gain score for ranking, big number, heading, detail, is_positive)
cand = [
    (abs(rt(fa) - rt(fb)) * 3, signed(rt(fa) - rt(fb)), f"{FN} Re-test",
     f"{pct(rt(fb))} → {pct(rt(fa))} ({chg(rt(fb), rt(fa)):+.0f}%). Net {signed(net_rt)} vs control {CN}.", rt(fa) < rt(fb) and net_rt < 0),
    (abs(ntf(fa) - ntf(fb)) * 3, signed(ntf(fa) - ntf(fb)), f"{FN} NTF",
     f"{pct(ntf(fb))} → {pct(ntf(fa))}; Station FPY {pct(sfpy(fb))} → {pct(sfpy(fa))}.", ntf(fa) < ntf(fb)),
]
for n, b_, a_ in fs:
    cand.append((abs(rt(a_) - rt(b_)), signed(rt(a_) - rt(b_)), f"Station {n} ({FN})",
                 f"Re-test {pct(rt(b_))} → {pct(rt(a_))}; NTF {pct(ntf(b_))} → {pct(ntf(a_))}.", rt(a_) < rt(b_)))
for c_ in codes[:5]:
    b_, a_ = rb.get(c_, 0), ra.get(c_, 0)
    if b_ > 0:
        cand.append((abs(chg(b_, a_)) / 20, f"{chg(b_, a_):+.0f}%", f"Error code {c_[:30]}",
                     f"{b_:.1f} → {a_:.1f} NG per 1k tests on {FN}.", a_ < b_ * 0.9))
cand.append((abs(fpy(cur) - fpy(m5)), signed(fpy(cur) - fpy(m5)), "Plant FPY trend",
             f"{mname(max(ms))} {pct(fpy(m5))} → {mname(0)} {pct(fpy(cur))}; vs {mname(1)}: {signed(fpy(cur) - fpy(prev))}.", fpy(cur) > fpy(m5)))
cand.append((abs(rt(cur) - rt(prev)) * 2, signed(rt(cur) - rt(prev)), "Plant Re-test",
             f"{mname(1)} {pct(rt(prev))} → {mname(0)} {pct(rt(cur))}; NTF {pct(ntf(prev))} → {pct(ntf(cur))}.", rt(cur) < rt(prev)))
cand.append((improved / max(len(lines), 1), f"{improved}/{len(lines)}", "Lines with lower Re-test",
             f"Lines that reduced Re-test in {mname(0)} vs {mname(1)}.", improved * 2 > len(lines)))
good = sorted([c_ for c_ in cand if c_[4]], key=lambda c_: -c_[0])
# keep the two Line 6-1 headline items first when they are positive
good = [c_ for c_ in good if c_[2].startswith(FN)] + [c_ for c_ in good if not c_[2].startswith(FN)]
picked, caps = [], {"Station": 2, "Error code": 2}
for c_ in good:
    kind = next((k for k in caps if c_[2].startswith(k)), None)
    if kind:
        if caps[kind] == 0: continue
        caps[kind] -= 1
    picked.append(c_)
good = picked[:6]
gw, gh = (12.24 - 2 * 0.24) / 3, 2.15
for i, (_, big, head, detail, _) in enumerate(good):
    x = 0.53 + (i % 3) * (gw + 0.24); y = yy + (i // 3) * (gh + 0.24)
    rect(f.s, x, y, gw, gh, G2, name=f"Positive change {i + 1}")
    textbox(f.s, x + 0.25, y + 0.2, 0.4, 0.3, [f"{i + 1:02d}"], size=12, color=G3, bold=True)
    textbox(f.s, x + 0.25, y + 0.5, gw - 0.5, 0.6, [big], size=30, color=GREEN, bold=True)
    textbox(f.s, x + 0.25, y + 1.15, gw - 0.5, 0.3, [head], size=12, bold=True)
    textbox(f.s, x + 0.25, y + 1.45, gw - 0.5, 0.6, [detail], size=9.5, color=DARK)
print("positive changes:", [g[2] for g in good])

# ---------- 12. Remaining issues ----------
f = Frame(S[11], "Remaining Issues", f"{MONTH_TITLE} · plant-wide")
tops = []
for k, v in D.items():
    if k.startswith("m0_st") and q(k):
        sid = int(k[5:]); tops.append((st_meta.get(sid, {"name": f"Station {sid}", "lineName": "", "modelGroupName": ""}), q(k)))
tot_ng = cur["retestNgAttempts"]
tops = sorted(tops, key=lambda t: -t[1]["retestNgAttempts"])[:10]
yy = f.section("Top 10 stations by NG attempts", w=7.3, unit="(Unit: attempts, %)")
trows2 = [["#", "Line", "Station", "Model group", "Tests", "NG", "% NG", "Re-test", "NTF"]]
for i, (mt, m) in enumerate(tops, 1):
    trows2.append([str(i), mt["lineName"], mt["name"], mt["modelGroupName"], num(m["retestAttempts"]), num(m["retestNgAttempts"]),
                   f"{m['retestNgAttempts'] * 100 / tot_ng:.1f}", f"{rt(m):.2f}", f"{ntf(m):.2f}"])
def ifmt(i, j, v):
    o = {"bold": True} if j == 2 else {}
    if j == 7 and float(v) >= rt(cur) * 1.5: o.update({"color": RED, "bold": True})
    if j == 8 and float(v) >= ntf(cur) * 1.5: o.update({"color": RED, "bold": True})
    return o
table(f.s, 0.53, yy, 7.3, trows2, [0.3, 0.8, 1.0, 1.35, 0.8, 0.65, 0.55, 0.7, 0.6], row_h=0.36, size=8,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 5, cell_fmt=ifmt, name="Top stations")
textbox(f.s, 0.53, yy + 0.36 * len(trows2) + 0.06, 7.3, 0.2, [f"* Red: ≥ 1.5× plant level ({pct(rt(cur))} / {pct(ntf(cur))})."], size=8, color=G3)
f.section("Top error codes (plant)", x=8.13, w=4.64, unit="(Unit: attempts, %)")
par = D.get("pareto_m0") or []
prow = [["#", "Error code", "NG", "%"]]
for i, p in enumerate(par[:10], 1):
    prow.append([str(i), p["code"], num(p["count"]), f"{p['pct']:.1f}"])
table(f.s, 8.13, yy, 4.64, prow, [0.3, 2.6, 0.7, 0.55], row_h=0.36, size=8,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER],
      cell_fmt=lambda i, j, v: {"bold": True} if j == 1 else ({"fill": LVIOLET} if i <= 3 else None), name="Top error codes")
textbox(f.s, 8.13, yy + 0.36 * len(prow) + 0.06, 4.64, 0.2, [f"* Top 10 = {sum(p['pct'] for p in par[:10]):.1f}% of NG attempts."], size=8, color=G3)

# ---------- 13. Action plan (filled in by the team) ----------
f = Frame(S[12], "Action Plan", f"Follow-up from the {mname(0, False)} review")
yy = f.section("Actions", unit="(To be completed by the owner)")
arows = [["#", "Focus area", "Finding", "Action", "Owner", "Due date", "Status"]]
focus_items = [(f"{tops[0][0]['name']} · {tops[0][0]['lineName']}", f"Most NG attempts ({tops[0][1]['retestNgAttempts'] * 100 / tot_ng:.1f}% of plant), Re-test {pct(rt(tops[0][1]))}")]
if par: focus_items.append((par[0]["code"], f"Top error code, {par[0]['pct']:.1f}% of NG attempts"))
focus_items.append((FN, f"Sustain improvement: Re-test {pct(rt(fa))} after vs {pct(rt(fb))} before"))
for i in range(6):
    a, b = focus_items[i] if i < len(focus_items) else ("", "")
    arows.append([str(i + 1), a, b, "", "", "", ""])
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
prs.save(OUT)
print("saved", OUT)
