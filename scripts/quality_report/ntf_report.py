"""NTF report for NAD FCT (English deck, Haengsung template, page 2 = user's 'NAD FCT NTF RATE' form).

  python ntf_report.py [--groups "Line 6-1=BMW ICON25 NAD" "Line 6-1=BMW Wave High NAD" "Line 6-2=BMW Wave High NAD"]
                       [--action 2026-11-10] [--before-days 28] [--out Reports/...pptx]

NTF = PID-Station pairs that were NG at least once / all PID-Station pairs, cohort = first test of the pair
in the period (pcb_ntf_summaries). A pair that was NG only for a job change (CHANGE_JOB) is not NG.
NTF NG item = NG step of the first real NG of the pair (pcb_results), with the jig it ran on.
"""
import argparse, datetime as dt, json, os, re, sys
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import qfast
from pptlib import *

ap = argparse.ArgumentParser()
ap.add_argument("--groups", nargs="+", default=["Line 6-1=BMW ICON25 NAD", "Line 6-1=BMW Wave High NAD", "Line 6-2=BMW Wave High NAD"])
ap.add_argument("--action", default="2026-11-10"); ap.add_argument("--before-days", type=int, default=28)
ap.add_argument("--today", default=None); ap.add_argument("--out", default=None); ap.add_argument("--reports-dir", default=None)
A = ap.parse_args()
ACT = dt.date.fromisoformat(A.action)
TODAY = dt.date.fromisoformat(A.today) if A.today else dt.date.today()
B0 = ACT - dt.timedelta(days=A.before_days)
TS = ACT - dt.timedelta(weeks=10); TS -= dt.timedelta(days=TS.weekday())
W0 = min(TS, B0)
cfg = json.load(open(os.path.join(HERE, "report_config.json"), encoding="utf-8"))
EXCL = set(cfg.get("excluded_error_codes", ["UNKNOWN", "UNKNOWN_DEFECT"]))
NOT_A_TEST = cfg.get("not_a_test_regex") or "^$NONE"
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RD = A.reports_dir or os.path.join(ROOT, "Reports")
OUT = A.out or os.path.join(RD, f"NAD_FCT_NTF_Report_{TODAY - dt.timedelta(days=1):%Y-%m-%d}.pptx")
GROUPS = [tuple(g.split("=", 1)) for g in A.groups]          # (line name, model name)

# ======================= data =======================
conn = qfast.connect(); cur = conn.cursor()
cur.execute("SELECT id, name FROM lines"); LINE_ID = {n: i for i, n in cur.fetchall()}
cur.execute("SELECT id, name FROM models"); MODEL_ID = {n: i for i, n in cur.fetchall()}
cur.execute("SELECT job_file, model_id FROM job_file_model_mappings WHERE model_id IS NOT NULL"); job_model = dict(cur.fetchall())
def eff(job, mid): return job_model.get(job, mid or 0)
LIDS = sorted({LINE_ID[l] for l, _ in GROUPS})
cur.execute("SELECT s.id, s.name, s.line_id FROM stations s WHERE s.line_id = ANY(%s) ORDER BY s.id", (LIDS,))
STN = {}; ST_LINE = {}
for i, n, li in cur.fetchall(): STN[i] = n; ST_LINE[i] = li
SIDS = list(STN)
cur.execute("SELECT id, name, ip_address FROM channels WHERE station_id = ANY(%s)", (SIDS,)); JIG = {i: (n, ip) for i, n, ip in cur.fetchall()}
GKEY = {(LINE_ID[l], MODEL_ID[m]): k for k, (l, m) in enumerate(GROUPS)}

ts_ = lambda d: dt.datetime.combine(d, dt.time())
# cohort: PID-Station pairs whose first test is in the window
pairs = {}                                   # (pid, sid) -> (group k, first day)
cur.execute("""SELECT pid, station_id, (first_test_time AT TIME ZONE 'UTC')::date, job_file, model_id
               FROM pcb_ntf_summaries
               WHERE station_id = ANY(%s) AND pid <> 'None'
                 AND first_test_time >= (%s::timestamp AT TIME ZONE 'UTC') AND first_test_time < (%s::timestamp AT TIME ZONE 'UTC')""",
            (SIDS, ts_(W0), ts_(TODAY)))
for pid, sid, day, job, mid in cur.fetchall():
    k = GKEY.get((ST_LINE[sid], eff(job, mid)))
    if k is not None: pairs[(pid, sid)] = (k, day)
# first real NG of each pair (job changes are not tests)
first_ng = {}                                # (pid, sid) -> (code, channel)
cur.execute("""SELECT DISTINCT ON (pid, station_id) pid, station_id, error_code, channel_id
               FROM pcb_results
               WHERE station_id = ANY(%s) AND result IN ('NG', 'FAIL')
                 AND start_time >= (%s::timestamp AT TIME ZONE 'UTC') AND start_time < (%s::timestamp AT TIME ZONE 'UTC')
                 AND COALESCE(error_code, '') <> 'DEFECT_UNSPECIFIED' AND COALESCE(error_code, '') !~* %s
               ORDER BY pid, station_id, start_time""", (SIDS, ts_(W0), ts_(TODAY), NOT_A_TEST))
for pid, sid, code, ch in cur.fetchall():
    if (pid, sid) in pairs: first_ng[(pid, sid)] = (code or "UNKNOWN_DEFECT", ch)
conn.close()

def stats(k, a, b, sid=None):
    n = ng = 0; items = defaultdict(int); jigs = defaultdict(lambda: [0, 0]); item_st = defaultdict(lambda: defaultdict(int))
    item_jig = defaultdict(lambda: defaultdict(int))
    for key, (g, d) in pairs.items():
        if g != k or not (a <= d < b) or (sid is not None and key[1] != sid): continue
        n += 1
        f_ = first_ng.get(key)
        if f_:
            ng += 1; code, ch = f_
            jigs[(key[1], ch)][1] += 1
            if code not in EXCL: items[code] += 1; item_st[code][key[1]] += 1; item_jig[code][(key[1], ch)] += 1
        # jig of the pair's test is only known for NG pairs; pair counts per jig use NG pairs only
    return {"pairs": n, "ng": ng, "ntf": ng * 100.0 / n if n else None, "items": items, "item_st": item_st, "item_jig": item_jig, "jigs": jigs}
BEF, AFT = (B0, ACT), (ACT, TODAY)
SB = [stats(k, *BEF) for k in range(len(GROUPS))]; SA = [stats(k, *AFT) for k in range(len(GROUPS))]

# ======================= deck =======================
prs = Presentation(os.path.join(HERE, "assets", "skeleton_monthly.pptx")); S = list(prs.slides)
def wk(d): return f"W{d.isocalendar()[1]}"
PB = f"{dm(B0)} to {dm(ACT - dt.timedelta(days=1))}"; PA = f"{dm(ACT)} to {dm(TODAY - dt.timedelta(days=1))}"
def pc_(v, d=2): return "–" if v is None else f"{v:.{d}f}%"
def short(m): return m.replace("BMW ", "").replace(" NAD", "")
def gname(k): return f"{short(GROUPS[k][1])} · {GROUPS[k][0]}"
def jname(sid, ch):
    n, ip = JIG.get(ch, (f"ch {ch}", None)); return f"{STN[sid]} {n}" + (f" ({ip})" if ip else "")

# ---- 1. cover ----
c = S[0]; strip_annotations(c)
set_runs(by_name(c, "Title 1"), ["NAD FCT NTF Report", " · ".join(dict.fromkeys(short(m) for _, m in GROUPS))])
sub = by_name(c, "내용 개체 틀 2")
set_runs(sub, [f"Before {PB} vs after {PA} · " + ", ".join(dict.fromkeys(l for l, _ in GROUPS)) + " · PMSystem2 data"]); sub.width = Inches(10)
gt = by_name(c, "Group 46").table
for r in range(len(gt.rows)):
    if gt.cell(r, 0).text_frame.text.strip().startswith("Document"):
        runs = gt.cell(r, 1).text_frame.paragraphs[0].runs; runs[0].text = f"QA-{TODAY:%y%m}-NTF"
        for extra in runs[1:]: extra._r.getparent().remove(extra._r)

# ---- 2. NAD FCT NTF RATE (form) ----
f = Frame(S[2], "NAD FCT NTF RATE", f"NTF = PID–Station pairs that were NG at least once · before {PB} vs after {PA} (action start {dm(ACT)}, {wk(ACT)})")
yy = f.section("NTF rate – before vs after", y=1.2, unit="(Unit: %)")
cw = 3.92
for k in range(len(GROUPS)):
    x = 0.53 + k * (cw + 0.24); b, a = SB[k], SA[k]
    rect(f.s, x, yy, cw, 1.5, G2, name=f"NTF card {k}")
    textbox(f.s, x + 0.25, yy + 0.1, cw - 0.5, 0.28, [[(short(GROUPS[k][1]), {"size": 14, "bold": True}), (f"  {GROUPS[k][0]}", {"size": 11, "color": G3})]])
    v = (a["ntf"] or 0) - (b["ntf"] or 0); col = GREEN if v < 0 else RED
    textbox(f.s, x + 0.25, yy + 0.4, cw - 0.5, 0.5, [[(pc_(b["ntf"]), {"color": G3, "size": 16}), (" → ", {"color": G3, "size": 16}),
                                                    (pc_(a["ntf"]), {"color": col, "size": 26, "bold": True})]])
    textbox(f.s, x + 0.25, yy + 0.92, cw - 0.5, 0.22, [[(f"{'▼' if v < 0 else '▲'} {abs(v):.2f}%", {"color": col, "bold": True}),
                                                     ("  after vs before", {"color": G3})]], size=10.5)
    textbox(f.s, x + 0.25, yy + 1.17, cw - 0.5, 0.22, [f"NG pairs: {num(b['ng'])} / {num(b['pairs'])} → {num(a['ng'])} / {num(a['pairs'])}"], size=8.5, color=G3)
y2 = f.section("NTF NG items (after the action)", y=yy + 1.72, w=6.0, unit="(Unit: NG pairs, %)")
allitems = []
for k in range(len(GROUPS)):
    for code, n in SA[k]["items"].items():
        stn = max(SA[k]["item_st"][code].items(), key=lambda kv: kv[1])[0]
        rb_ = SB[k]["items"].get(code, 0) * 100.0 / SB[k]["pairs"] if SB[k]["pairs"] else 0
        allitems.append((n * 100.0 / SA[k]["pairs"], k, code, stn, n, rb_))
allitems.sort(reverse=True)
TOPN = 8
nrows = [["#", "NG step", "Model · Line", "Station", "NG pairs", "% of pairs", "Before"]]
for i, (r_, k, code, stn, n, rb_) in enumerate(allitems[:TOPN], 1):
    nrows.append([str(i), code, gname(k), STN[stn], num(n), f"{r_:.2f}", f"{rb_:.2f}"])
def nfmt(i, j, v):
    o = {"align": PP_ALIGN.LEFT, "bold": True} if j == 1 else {}
    if j == 5 and i: o["color"] = RED if float(v) > float(nrows[i][6]) else GREEN
    return o
table(f.s, 0.53, y2, 6.0, nrows, [0.25, 2.05, 1.25, 0.65, 0.6, 0.65, 0.55], row_h=0.32, size=7.5, cell_fmt=nfmt, name="NTF NG items")
textbox(f.s, 0.53, y2 + 0.32 * len(nrows) + 0.04, 6.0, 0.3, ["* % of pairs = pairs whose first NG was this NG step / all pairs of that model and line (after). "
                                                             "Before = same rate before the action."], size=7.5, color=G3)
f.section("Actions (item · PIC · cycle)", x=6.73, y=yy + 1.72, w=6.04, unit="(PIC to be assigned)")
acts = []
for r_, k, code, stn, n, rb_ in allitems[:4]:
    jj = sorted(SA[k]["item_jig"][code].items(), key=lambda kv: -kv[1])
    top_j = jj[0] if jj else None
    share = top_j[1] * 100 // n if top_j else 0
    if top_j and share >= 40:
        acts.append((f"{code} ({gname(k)}): {top_j[1]} of {n} NG pairs on {jname(*top_j[0])} → check / clean pins and contact of this jig", "Daily until OK, then weekly"))
    else:
        acts.append((f"{code} ({gname(k)}, {STN[stn]}): NG on several jigs → analyse NG logs, check program limits and fixture", "Weekly review"))
acts.append(("Clean pins / pads of all FID and RF jigs (preventive maintenance)", "Weekly"))
acts.append(("Review NTF rate and top NTF NG items by jig in PMSystem2", "Weekly (production meeting)"))
arows = [["#", "Action item", "PIC", "Cycle"]] + [[str(i), a_, "", c_] for i, (a_, c_) in enumerate(acts[:6], 1)]
table(f.s, 6.73, y2, 6.04, arows, [0.25, 4.0, 0.7, 1.09], row_h=min(0.5, 3.1 / len(arows)), size=7.5,
      cell_fmt=lambda i, j, v: {"align": PP_ALIGN.LEFT} if j == 1 else None, name="NTF actions")

# ---- 3.. detail per model and line ----
DETAIL = [S[3], S[4], S[6], S[7], S[8], S[9]]
for k, sl in enumerate(DETAIL[:len(GROUPS)]):
    line, model = GROUPS[k]
    f = Frame(sl, f"NTF Detail – {short(model)} · {line}", f"{model} on {line} · before {PB} vs after {PA}")
    weeks = []; w = TS
    while w < TODAY:
        e = min(w + dt.timedelta(days=7), TODAY); st_ = stats(k, w, e)
        if st_["pairs"]: weeks.append((w, e, st_))
        w += dt.timedelta(days=7)
    yy = f.section("NTF by week", w=6.0, unit="(Unit: %)")
    if weeks:
        ch = column_chart(f.s, 0.53, yy, 6.0, 2.35, [wk(w_) for w_, _, _ in weeks], [("NTF %", [round(x[2]["ntf"] or 0, 2) for x in weeks])], ["BFBFBF"],
                          fmt='0.0', lo=0, name=f"NTF weekly {k}")
        for i_, (ws, we, _) in enumerate(weeks):
            if we > ACT:
                pt = ch.plots[0].series[0].points[i_]; pt.format.fill.solid(); pt.format.fill.fore_color.rgb = rgb(GREEN)
    textbox(f.s, 0.53, yy + 2.37, 6.0, 0.2, [f"grey = before · green = week with / after {dm(ACT)} · pairs per week: " +
                                            ", ".join(f"{wk(w_)} {num(s_['pairs'])}" for w_, _, s_ in weeks[-4:])], size=7.5, color=G3)
    f.section("NTF by station", x=6.77, w=6.0, unit="(Unit: %)")
    srows = [["Station", "Pairs B / A", "NTF before", "NTF after", "Δ"]]
    for sid in [s for s in SIDS if ST_LINE[s] == LINE_ID[line]]:
        b, a = stats(k, *BEF, sid), stats(k, *AFT, sid)
        if not b["pairs"] and not a["pairs"]: continue
        d_ = (a["ntf"] or 0) - (b["ntf"] or 0)
        srows.append([STN[sid], f"{num(b['pairs'])} / {num(a['pairs'])}", pc_(b["ntf"]), pc_(a["ntf"]), f"{'▲' if d_ > 0 else '▼'} {abs(d_):.2f}%"])
    table(f.s, 6.77, yy, 6.0, srows, [1.2, 1.4, 1.1, 1.1, 1.2], row_h=0.3, size=8.5,
          cell_fmt=lambda i, j, v: ({"bold": True} if j == 0 else {}) | ({"color": RED if v.startswith("▲") else GREEN} if j == 4 and i else {}),
          name=f"NTF station {k}")
    y3 = f.section("Top NTF NG items – before vs after", y=yy + 2.7, w=6.0, unit="(Unit: % of pairs)")
    b, a = SB[k], SA[k]
    codes = sorted(set(b["items"]) | set(a["items"]), key=lambda c_: -max(b["items"].get(c_, 0) / max(b["pairs"], 1), a["items"].get(c_, 0) / max(a["pairs"], 1)))[:6]
    irows = [["NG step", "Before", "After", "Δ"]]
    for c_ in codes:
        rb_ = b["items"].get(c_, 0) * 100.0 / max(b["pairs"], 1); ra_ = a["items"].get(c_, 0) * 100.0 / max(a["pairs"], 1)
        irows.append([c_, f"{rb_:.2f}", f"{ra_:.2f}", f"{ra_ - rb_:+.2f}"])
    table(f.s, 0.53, y3, 6.0, irows, [3.3, 0.9, 0.9, 0.9], row_h=0.26, size=8,
          cell_fmt=lambda i, j, v: ({"align": PP_ALIGN.LEFT, "bold": True} if j == 0 else {}) | ({"color": RED if v.startswith("+") and v != "+0.00" else GREEN} if j == 3 and i else {}),
          name=f"NTF items {k}")
    f.section("Jigs with most NTF NG pairs (after)", x=6.77, y=yy + 2.7, w=6.0, unit="(Unit: NG pairs)")
    jj = sorted(a["jigs"].items(), key=lambda kv: -kv[1][1])[:6]
    jrows = [["Jig", "NG pairs after", "Share", "Main NG step"]]
    for (sid, ch), (_, n) in jj:
        main = max(((c_, d_.get((sid, ch), 0)) for c_, d_ in a["item_jig"].items()), key=lambda kv: kv[1], default=("–", 0))
        jrows.append([jname(sid, ch), num(n), f"{n * 100 // max(a['ng'], 1)}%", f"{main[0]} ({main[1]})" if main[1] else "–"])
    table(f.s, 6.77, y3, 6.0, jrows, [2.2, 1.0, 0.7, 2.1], row_h=0.26, size=8,
          cell_fmt=lambda i, j, v: {"align": PP_ALIGN.LEFT} if j in (0, 3) else None, name=f"NTF jigs {k}")

# ---- end, drop unused, page numbers ----
strip_annotations(S[39])
keep = {id(S[0]), id(S[2]), id(S[39])} | {id(s) for s in DETAIL[:len(GROUPS)]}
lst = prs.slides._sldIdLst
for sl in S:
    if id(sl) in keep: continue
    for e in list(lst):
        if prs.part.related_part(e.rId) is sl.part: prs.part.drop_rel(e.rId); lst.remove(e)
for el in list(prs.part._element.iter("{http://schemas.microsoft.com/office/powerpoint/2010/main}sectionLst")):
    ext = el.getparent(); ext.getparent().remove(ext)
for idx, sl in enumerate(list(prs.slides), 1):
    for sh in sl.shapes:
        if sh.name.startswith("슬라이드 번호") and sh.has_text_frame and not sh._element.findall(".//" + qn("a:fld")) and sh.text_frame.paragraphs[0].runs:
            set_runs(sh, [str(idx)])
tmp = OUT + ".part"; prs.save(tmp); os.replace(tmp, OUT)
print("saved", OUT)
for k in range(len(GROUPS)): print(gname(k), "before", SB[k]["ng"], SB[k]["pairs"], pc_(SB[k]["ntf"]), "after", SA[k]["ng"], SA[k]["pairs"], pc_(SA[k]["ntf"]))
