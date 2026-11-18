"""Weekly Quality Report (English): NTF / Re-test / FPY for one ISO week."""
import json, os, sys, datetime as dt
from pptlib import *

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.environ.get("DATA", os.path.join(HERE, "data.json")), encoding="utf-8"))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "report_w.pptx")
END = dt.date(2026, 11, 16)                        # Monday after the report week (exclusive)
WS, WE = END - dt.timedelta(days=7), END - dt.timedelta(days=1)
WN = WS.isocalendar()[1]
def wname(i): return f"W{WN - i}"
def dm(d): return d.strftime("%d %b")
PERIOD = f"{wname(0)} {dm(WS)} – {dm(WE)} {WE.year}"

def q(k):
    v = D.get(k)
    return v if isinstance(v, dict) and "error" not in v and v.get("retestAttempts") else None
def fpy(m): return m["rtyRate"]
def rt(m): return m["retestDefectRate"]
def ntf(m): return m["ntfRate"]
def sfpy(m): return round(100 - m["ntfRate"], 2)
cur, prev = q("week0"), q("week1")
st_meta = {s["id"]: s for s in D["stations"]}
DQ_NOTE = ("* Tests with an invalid start time (infinity / future clock) are not counted: "
           "Line 4-2 FCT IGM, Line 4-1 FCT Radio, Line 6-2 FID, Line 3-1 BMW AZV DFE.")

prs = Presentation(os.path.join(HERE, "skeleton.pptx"))
S = list(prs.slides)

# ---------- 1. Cover ----------
c = S[0]; strip_annotations(c)
set_runs(by_name(c, "Title 1"), ["Weekly Quality Report", "NTF · Re-test · FPY"])
sub = by_name(c, "내용 개체 틀 2"); set_runs(sub, [f"{PERIOD} · PMSystem2 data"]); sub.width = Inches(8)
gt = by_name(c, "Group 46").table
for r in range(len(gt.rows)):
    if gt.cell(r, 0).text_frame.text.strip().startswith("Document"):
        runs = gt.cell(r, 1).text_frame.paragraphs[0].runs; runs[0].text = f"QA-{WE.year}-{wname(0)}"
        for extra in runs[1:]: extra._r.getparent().remove(extra._r)

# ---------- 2. Contents ----------
TOC = [(f"KPI Summary {wname(0)}", "3"), ("6-Week Trend", "4"), ("Daily Trend", "5"), ("KPI by Line", "6"),
       ("Top Stations to Improve", "7"), ("Error Code Pareto", "8"), ("Findings & Actions", "9")]
t = S[1]; strip_annotations(t)
rows = {}
for sh in list(t.shapes):
    if sh.has_text_frame and sh.name == "Content Placeholder 2":
        rows.setdefault(round(sh.top / 914400 / 0.555), []).append(sh)
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

# ---------- 3. KPI summary ----------
f = Frame(S[2], "Quality KPI Summary", f"{PERIOD} · vs {wname(1)}")
yy = f.section(f"Key indicators – {wname(0)}", unit="(Unit: %, %p = percentage points)")
cards = [("FPY", "plant-wide", fpy, True, f"{num(cur['rtyStraightThroughPcbs'])} first-pass PCBs / {num(cur['rtyPcbs'])} PCBs", GREEN),
         ("Re-test", "NG test attempts", rt, False, f"{num(cur['retestNgAttempts'])} NG / {num(cur['retestAttempts'])} test attempts", VIOLET),
         ("NTF", "PID–Station ever NG", ntf, False, f"{num(cur['ntfNgPcbStations'])} NG / {num(cur['ntfPcbStations'])} PID–Stations", DARK)]
cw = 3.92
for i, (nm, sub_, fn, hb, det, col) in enumerate(cards):
    x = 0.53 + i * (cw + 0.24)
    rect(f.s, x, yy, cw, 2.05, G2, name=f"KPI card {nm}")
    textbox(f.s, x + 0.25, yy + 0.2, cw - 0.5, 0.3, [[(nm, {"size": 14, "bold": True}), (f"  {sub_}", {"size": 10, "color": G3})]])
    textbox(f.s, x + 0.25, yy + 0.55, cw - 0.5, 0.75, [pct(fn(cur))], size=40, color=col, bold=True)
    dtx, dcol = delta(fn(cur), fn(prev), hb)
    textbox(f.s, x + 0.25, yy + 1.33, cw - 0.5, 0.25, [[(dtx, {"color": dcol, "bold": True}), (f"  vs {wname(1)} ({pct(fn(prev))})", {"color": G3})]], size=11)
    textbox(f.s, x + 0.25, yy + 1.65, cw - 0.5, 0.25, [det], size=9, color=G3)
y2 = f.section("Definitions & figures", y=yy + 2.35)
defs = [["KPI", "Definition (PMSystem2)", wname(1), wname(0), "Change", f"Numerator / denominator {wname(0)}"]]
for nm, formula, fn, hb, a, b in [("FPY", "PCBs never NG at any Station / all PCBs (PID) tested in the period", fpy, True, "rtyStraightThroughPcbs", "rtyPcbs"),
                                  ("Re-test", "NG test attempts / all test attempts (each test run = 1 attempt)", rt, False, "retestNgAttempts", "retestAttempts"),
                                  ("NTF", "PID–Station pairs that were ever NG / all PID–Station pairs tested", ntf, False, "ntfNgPcbStations", "ntfPcbStations")]:
    defs.append([nm, formula, pct(fn(prev)), pct(fn(cur)), delta(fn(cur), fn(prev), hb)[0], f"{num(cur[a])} / {num(cur[b])}"])
def dfmt(i, j, v):
    if j == 0: return {"bold": True}
    if j == 4: return {"bold": True, "color": delta(float(defs[i][3][:-1]), float(defs[i][2][:-1]), defs[i][0] == "FPY")[1]}
table(f.s, 0.53, y2, 12.24, defs, [1.0, 5.2, 1.0, 1.0, 1.2, 2.4], row_h=0.34,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 4, cell_fmt=dfmt, name="KPI definitions")
textbox(f.s, 0.53, y2 + 0.34 * 4 + 0.08, 12.24, 0.4,
        ["* Periods by test start time (factory clock). Line/Station FPY on later pages = 100% − NTF of that scope.", DQ_NOTE], size=8, color=G3)

# ---------- 4. 6-week trend ----------
weeks = [i for i in range(5, -1, -1) if q(f"week{i}")]
cats = [wname(i) for i in weeks]; wm = [q(f"week{i}") for i in weeks]
wc = q("weekcur")
if wc: cats.append(f"W{WN + 1}*"); wm.append(wc)
f = Frame(S[3], "6-Week Trend", f"{cats[0]} – {wname(0)} · W{WN + 1} partial ({dm(END)} – {dm(END + dt.timedelta(days=1))})")
yy = f.section("FPY by week", w=5.84, unit="(Unit: %)")
fv, rv, nv = [fpy(m) for m in wm], [rt(m) for m in wm], [ntf(m) for m in wm]
column_chart(f.s, 0.53, yy, 5.84, 2.6, cats, [("FPY", fv)], [GREEN], lo=max(0, int(min(fv)) - 3), hi=100, name="FPY by week")
f.section("Re-test & NTF by week", x=6.93, w=5.84, unit="(Unit: %)")
line_chart(f.s, 6.93, yy, 5.84, 2.6, cats, [("Re-test", rv), ("NTF", nv)], [VIOLET, DARK], lo=0, hi=round(max(rv) * 1.35 + 0.5), name="Re-test NTF by week")
y2 = f.section("Weekly figures", y=yy + 2.75)
trows = [["KPI"] + cats, ["FPY (%)"] + [f"{v:.2f}" for v in fv], ["Re-test (%)"] + [f"{v:.2f}" for v in rv],
         ["NTF (%)"] + [f"{v:.2f}" for v in nv], ["Test attempts"] + [num(m["retestAttempts"]) for m in wm],
         ["PCBs (PID)"] + [num(m["rtyPcbs"]) for m in wm]]
def tfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if trows[0][j] == wname(0): o.update({"fill": LVIOLET, "bold": True})
    return o
table(f.s, 0.53, y2, 12.24, trows, [1.6] + [1] * len(cats), row_h=0.27, cell_fmt=tfmt, name="Weekly figures")
textbox(f.s, 0.53, y2 + 0.27 * len(trows) + 0.06, 12.24, 0.2, [f"* W{WN + 1} has 2 days only, for reference."], size=8, color=G3)

# ---------- 5. Daily trend ----------
days = [d for d in range(9) if q(f"day{d}")]
dcats = [(WS + dt.timedelta(days=d)).strftime("%d/%m") for d in days]; dmx = [q(f"day{d}") for d in days]
f = Frame(S[4], "Daily Trend", f"{dm(WS)} – {dm(WS + dt.timedelta(days=8))} ({wname(0)} + start of W{WN + 1})")
yy = f.section("Re-test & NTF by day", unit="(Unit: %)")
dr, dn = [rt(m) for m in dmx], [ntf(m) for m in dmx]
line_chart(f.s, 0.53, yy, 12.24, 2.45, dcats, [("Re-test", dr), ("NTF", dn)], [VIOLET, DARK], lo=0, hi=round(max(dr) * 1.3 + 0.5), name="Re-test NTF by day")
y2 = f.section("Daily figures", y=yy + 2.6)
drows = [["KPI"] + dcats, ["FPY (%)"] + [f"{fpy(m):.2f}" for m in dmx], ["Re-test (%)"] + [f"{v:.2f}" for v in dr],
         ["NTF (%)"] + [f"{v:.2f}" for v in dn], ["Test attempts"] + [num(m["retestAttempts"]) for m in dmx],
         ["NG attempts"] + [num(m["retestNgAttempts"]) for m in dmx]]
worst = max(range(len(dmx)), key=lambda i: dr[i])
def dfmt2(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j == worst + 1 and i in (2, 3): o.update({"color": RED, "bold": True})
    return o
table(f.s, 0.53, y2, 12.24, drows, [1.6] + [1] * len(dcats), row_h=0.27, cell_fmt=dfmt2, name="Daily figures")
textbox(f.s, 0.53, y2 + 0.27 * len(drows) + 0.06, 12.24, 0.2,
        [f"* Highest Re-test day: {dcats[worst]} ({pct(dr[worst])}). Daily FPY = PCBs tested that day, full history considered."], size=8, color=G3)

# ---------- 6. By line ----------
f = Frame(S[5], "KPI by Line", f"{PERIOD} · vs {wname(1)}")
lines = []
for l in D["lines"]:
    m, pm = q(f"line{l['id']}"), q(f"lineprev{l['id']}")
    if m: lines.append((l["name"], m, pm))
lines.sort(key=lambda x: -rt(x[1]))
yy = f.section("Re-test & NTF by line", w=5.84, unit="(Unit: %)")
column_chart(f.s, 0.53, yy, 5.84, 4.6, [n for n, *_ in lines], [("Re-test", [rt(m) for _, m, _ in lines]), ("NTF", [ntf(m) for _, m, _ in lines])],
             [VIOLET, DARK], bar=True, gap=60, overlap=-10, lo=0, name="Re-test NTF by line")
f.section("KPI table by line (sorted by Re-test)", x=6.93, w=5.84, unit="(Unit: %)")
lrows = [["Line", "Tests", "Re-test", f"Δ {wname(1)}", "NTF", f"Δ {wname(1)}", "Stn FPY"]]
for n, m, pm in lines:
    lrows.append([n, num(m["retestAttempts"]), f"{rt(m):.2f}", delta(rt(m), rt(pm), False)[0] if pm else "–",
                  f"{ntf(m):.2f}", delta(ntf(m), ntf(pm), False)[0] if pm else "–", f"{sfpy(m):.2f}"])
def lfmt(i, j, v):
    o = {"bold": True} if j == 0 else {}
    if j in (3, 5) and v != "–": o["color"] = RED if v.startswith("▲") else (GREEN if v.startswith("▼") else G3)
    if j == 2 and i <= 3: o.update({"color": RED, "bold": True})
    return o
rh = min(0.3, 4.6 / len(lrows))
table(f.s, 6.93, yy, 5.84, lrows, [1.25, 1.1, 0.8, 1.0, 0.8, 1.0, 0.8], row_h=rh, size=8.5, cell_fmt=lfmt, name="KPI by line")
textbox(f.s, 6.93, yy + rh * len(lrows) + 0.06, 5.84, 0.45, ["* Stn FPY = station first-pass yield = 100% − NTF. Top 3 Re-test in red.", DQ_NOTE], size=8, color=G3)

# ---------- 7. Top stations ----------
f = Frame(S[6], "Top Stations to Improve", f"{PERIOD} · Top 10 by NG attempts")
sts = [(meta, q(f"st{sid}")) for sid, meta in st_meta.items() if q(f"st{sid}") and q(f"st{sid}")["retestAttempts"] >= 300]
total_ng = cur["retestNgAttempts"]
sts.sort(key=lambda x: -x[1]["retestNgAttempts"]); top = sts[:10]
yy = f.section("Top 10 stations by NG attempts", unit="(Unit: attempts, %)")
srows = [["#", "Line", "Model group", "Station", "Tests", "NG", "% of NG", "Re-test", "NTF", "Stn FPY"]]
for i, (mt, m) in enumerate(top, 1):
    srows.append([str(i), mt["lineName"], mt["modelGroupName"], mt["name"], num(m["retestAttempts"]), num(m["retestNgAttempts"]),
                  pct(m["retestNgAttempts"] * 100 / total_ng, 1), f"{rt(m):.2f}", f"{ntf(m):.2f}", f"{sfpy(m):.2f}"])
def sfmt(i, j, v):
    o = {"bold": True} if j == 3 else {}
    if j == 7 and float(v) >= rt(cur) * 1.5: o.update({"color": RED, "bold": True})
    if j == 8 and float(v) >= ntf(cur) * 1.5: o.update({"color": RED, "bold": True})
    return o
table(f.s, 0.53, yy, 12.24, srows, [0.35, 1.0, 1.6, 1.7, 1.0, 0.9, 0.9, 0.8, 0.8, 0.8], row_h=0.29,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 6, cell_fmt=sfmt, name="Top 10 stations")
share = sum(m["retestNgAttempts"] for _, m in top) * 100 / total_ng
y3 = yy + 0.29 * len(srows) + 0.12
textbox(f.s, 0.53, y3, 12.24, 0.2, [f"* Red: Re-test or NTF ≥ 1.5× plant level ({pct(rt(cur))} / {pct(ntf(cur))}). Stations with ≥ 300 tests."], size=8, color=G3)
worst_st = max(top, key=lambda x: rt(x[1]))
co = [("Top 10 stations", pct(share, 1), "of all NG attempts in the plant", RED),
      ("Most NG attempts", top[0][0]["name"], f"{top[0][0]['lineName']} · {num(top[0][1]['retestNgAttempts'])} NG attempts", BLACK),
      ("Highest Re-test (Top 10)", pct(rt(worst_st[1])), f"{worst_st[0]['name']} · {worst_st[0]['lineName']}", RED)]
cw3 = (12.24 - 2 * 0.24) / 3
for i, (a, b, c_, col) in enumerate(co):
    x = 0.53 + i * (cw3 + 0.24)
    rect(f.s, x, y3 + 0.3, cw3, 0.95, G2, name=f"Callout {i + 1}")
    textbox(f.s, x + 0.2, y3 + 0.38, cw3 - 0.4, 0.22, [a], size=10, color=G3)
    textbox(f.s, x + 0.2, y3 + 0.6, cw3 - 0.4, 0.38, [b], size=20, color=col, bold=True)
    textbox(f.s, x + 0.2, y3 + 0.98, cw3 - 0.4, 0.2, [c_], size=9, color=G3)

# ---------- 8. Pareto ----------
f = Frame(S[7], "Error Code Pareto", f"{PERIOD} · Top 10 error codes")
p10 = (D.get("pareto") or [])[:10]
yy = f.section("NG attempts by error code", w=6.9, unit="(Unit: attempts)")
column_chart(f.s, 0.53, yy, 6.9, 4.5, [p["code"][:28] for p in p10], [("NG attempts", [p["count"] for p in p10])], [VIOLET],
             fmt='#,##0', bar=True, gap=50, lo=0, name="Error code pareto")
f.section("Pareto table", x=7.73, w=5.04, unit="(Unit: attempts, %)")
prow = [["#", "Error code", "NG", "%", "Cum. %"]]; cum = 0
for i, p in enumerate(p10, 1):
    cum += p["pct"]; prow.append([str(i), p["code"], num(p["count"]), f"{p['pct']:.1f}", f"{cum:.1f}"])
table(f.s, 7.73, yy, 5.04, prow, [0.35, 2.75, 0.8, 0.55, 0.75], row_h=0.36, size=8.5,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 3,
      cell_fmt=lambda i, j, v: {"bold": True} if j == 1 else ({"fill": LVIOLET} if i <= 3 else None), name="Pareto table")
textbox(f.s, 7.73, yy + 0.36 * len(prow) + 0.08, 5.04, 0.4,
        [f"* Top 10 error codes = {cum:.1f}% of {num(cur['retestNgAttempts'])} NG attempts. Shaded: top 3."], size=8, color=G3)

# ---------- 9. Findings & actions ----------
f = Frame(S[8], "Findings & Actions", PERIOD)
yy = f.section("Key findings", w=5.84)
mg = {}
for sid, meta in st_meta.items():
    m = q(f"st{sid}")
    if m:
        a = mg.setdefault(meta["modelGroupName"], [0, 0]); a[0] += m["retestNgAttempts"]; a[1] += m["retestAttempts"]
g1, (g1_ng, g1_tot) = sorted(mg.items(), key=lambda kv: -kv[1][0])[0]
best_line = max(lines, key=lambda x: (rt(x[2]) - rt(x[1])) if x[2] else -99)
hi_ntf = [x for x in top if 10 <= ntf(x[1]) < 99]
d_f, d_r, d_n = fpy(cur) - fpy(prev), rt(cur) - rt(prev), ntf(cur) - ntf(prev)
ins = [f"vs {wname(1)}: FPY {pct(fpy(cur))} ({d_f:+.2f}%p), Re-test {pct(rt(cur))} ({d_r:+.2f}%p), NTF {pct(ntf(cur))} ({d_n:+.2f}%p).",
       f"{g1} is the hot spot: {g1_ng * 100 / total_ng:.1f}% of all NG attempts, Re-test {g1_ng * 100 / g1_tot:.2f}%.",
       f"{worst_st[0]['name']} – {worst_st[0]['lineName']}: Re-test {pct(rt(worst_st[1]))}, about 1 NG in every {round(100 / rt(worst_st[1]))} tests.",
       f"{best_line[0]} improved most ({pct(rt(best_line[2]))} → {pct(rt(best_line[1]))}) but still has the highest line Re-test.",
       f"Error code {p10[0]['code']} = {p10[0]['pct']:.1f}% of NG attempts; the rest is spread (Top 10 = {cum:.1f}%)."]
if hi_ntf:
    ins.append("NTF > 10% (passes only on re-test): " + ", ".join(f"{x[0]['name']} – {x[0]['lineName']} ({pct(ntf(x[1]))})" for x in hi_ntf[:2]) + ".")
textbox(f.s, 0.53, yy + 0.05, 5.84, 3.3, [[("■  ", {"color": VIOLET, "size": 9}), (s_, {})] for s_ in ins], size=11, space_after=8, name="Key findings")
stats = [(pct(g1_ng * 100 / total_ng, 1), f"NG attempts from {g1}", RED),
         (pct(rt(worst_st[1])), f"Re-test {worst_st[0]['name']} {worst_st[0]['lineName']}", RED),
         (f"{d_f:+.2f}%p", f"FPY vs {wname(1)}", GREEN if d_f >= 0 else RED)]
bw = (5.84 - 2 * 0.2) / 3
for i, (big, small, col) in enumerate(stats):
    x = 0.53 + i * (bw + 0.2)
    rect(f.s, x, 5.2, bw, 1.15, G2, name=f"Highlight {i + 1}")
    textbox(f.s, x + 0.15, 5.32, bw - 0.3, 0.45, [big], size=22, color=col, bold=True)
    textbox(f.s, x + 0.15, 5.82, bw - 0.3, 0.45, [small], size=9, color=G3)
f.section("Action plan", x=6.93, w=5.84)
acts = [["Focus area", "Finding", "Action", "Owner", "Due"],
        [[worst_st[0]["name"], worst_st[0]["lineName"]], f"Re-test {pct(rt(worst_st[1]))}", "", "", ""],
        [[g1], f"{g1_ng * 100 / total_ng:.1f}% of NG attempts", "", "", ""],
        [[p10[0]["code"]], f"Top error code, {p10[0]['pct']:.1f}% of NG", "", "", ""],
        [["High NTF"] + ([f"{hi_ntf[0][0]['name']} · {hi_ntf[0][0]['lineName']}"] if hi_ntf else []),
         f"NTF {pct(ntf(hi_ntf[0][1]))}" if hi_ntf else "", "", "", ""],
        [["FPY"], f"{wname(0)}: {pct(fpy(cur))}", "", "", ""]]
table(f.s, 6.93, yy, 5.84, acts, [1.5, 1.5, 1.6, 0.65, 0.6], row_h=0.7, size=9, header_h=0.32,
      cell_fmt=lambda i, j, v: {"bold": True, "align": PP_ALIGN.LEFT} if j == 0 else ({"align": PP_ALIGN.LEFT} if j in (1, 2) else None),
      name="Action plan")
textbox(f.s, 6.93, yy + 0.32 + 0.7 * (len(acts) - 1) + 0.06, 5.84, 0.2, ["* Actions, owners and due dates to be filled in by the team."], size=8, color=G3)

# ---------- 10. End ----------
strip_annotations(S[9])
for idx, sl in enumerate(S, 1):
    for sh in sl.shapes:
        if sh.name.startswith("슬라이드 번호") and sh.has_text_frame and not sh._element.findall(".//" + qn("a:fld")) and sh.text_frame.paragraphs[0].runs:
            set_runs(sh, [str(idx)])
prs.save(OUT)
print("saved", OUT)
