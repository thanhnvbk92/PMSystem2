"""NTF report for NAD FCT (English deck, Haengsung template, page 2 = user's 'NAD FCT NTF RATE' form).

  python ntf_report.py [--groups "Line 6-1=BMW ICON25 NAD" "Line 6-1=BMW Wave High NAD" "Line 6-2=BMW Wave High NAD"]
                       [--action 2026-11-10] [--before-days 28] [--out Reports/...pptx]

NTF = PID-Station pairs that were NG at least once / all PID-Station pairs, cohort = first test of the pair
in the period (pcb_ntf_summaries). A pair that was NG only for a job change (CHANGE_JOB) is not NG.
NTF NG item = NG step of the first NG of the pair (pcb_ntf_summaries.first_ng_error_code / first_ng_channel_id).
Before / after per model and line: the first action date of that line and model in Reports/ImprovementList.xlsx
(--action when the list has none); before = the --before-days days before it, after = from it until today.
"""
import argparse, datetime as dt, json, os, re, sys
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import qfast, improvements
from pptlib import *
from pca import pca_page, verification_summary

ap = argparse.ArgumentParser()
ap.add_argument("--groups", nargs="+", default=["Line 6-1=BMW ICON25 NAD", "Line 6-1=BMW Wave High NAD", "Line 6-2=BMW Wave High NAD"])
ap.add_argument("--action", default="2026-11-10"); ap.add_argument("--before-days", type=int, default=28)
ap.add_argument("--today", default=None); ap.add_argument("--out", default=None); ap.add_argument("--reports-dir", default=None)
A = ap.parse_args()
TODAY = dt.date.fromisoformat(A.today) if A.today else dt.date.today()
cfg = json.load(open(os.path.join(HERE, "report_config.json"), encoding="utf-8"))
EXCL = set(cfg.get("excluded_error_codes", ["UNKNOWN", "UNKNOWN_DEFECT"]))
NOT_A_TEST = cfg.get("not_a_test_regex") or "^$NONE"
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RD = A.reports_dir or os.path.join(ROOT, "Reports")
OUT = A.out or os.path.join(RD, f"NAD_FCT_NTF_Report_{TODAY - dt.timedelta(days=1):%Y-%m-%d}.pptx")
GROUPS = sorted((tuple(g.split("=", 1)) for g in A.groups), key=lambda g: (g[1], g[0]))   # (line, model), by model then line
ITEMS = improvements.read_list(os.path.join(RD, "ImprovementList.xlsx"))
ACTS = []                                                      # per group: action start (first action of that line + model)
for l, m in GROUPS:
    ds = sorted(it["date"] for it in ITEMS if it["line"] == l and it["model"] == m)
    ACTS.append(ds[0] if ds else dt.date.fromisoformat(A.action))
BEF = [(a - dt.timedelta(days=A.before_days), a) for a in ACTS]; AFT = [(a, TODAY) for a in ACTS]
TSS = [a - dt.timedelta(weeks=10) - dt.timedelta(days=(a - dt.timedelta(weeks=10)).weekday()) for a in ACTS]   # weekly trend start
W0 = min(TSS + [b[0] for b in BEF])

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
# cohort: PID-Station pairs whose first test is in the window, with the NG step / jig of their first NG
pairs = {}                                   # (pid, sid) -> (group k, first day)
first_ng = {}                                # (pid, sid) -> (NG step, channel) for pairs that were NG
cur.execute("""SELECT pid, station_id, (first_test_time AT TIME ZONE 'UTC')::date, job_file, model_id, ever_ng,
                      first_ng_error_code, first_ng_channel_id
               FROM pcb_ntf_summaries
               WHERE station_id = ANY(%s) AND pid <> 'None'
                 AND first_test_time >= (%s::timestamp AT TIME ZONE 'UTC') AND first_test_time < (%s::timestamp AT TIME ZONE 'UTC')""",
            (SIDS, ts_(W0), ts_(TODAY)))
for pid, sid, day, job, mid, ng, code, ch in cur.fetchall():
    k = GKEY.get((ST_LINE[sid], eff(job, mid)))
    if k is None: continue
    pairs[(pid, sid)] = (k, day)
    if ng: first_ng[(pid, sid)] = (code or "UNKNOWN_DEFECT", ch)
IMP_ALL = json.loads(json.dumps(improvements.analyze(conn, os.path.join(RD, "ImprovementList.xlsx"), TODAY, sorted(EXCL), NOT_A_TEST), default=str))
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
SB = [stats(k, *BEF[k]) for k in range(len(GROUPS))]; SA = [stats(k, *AFT[k]) for k in range(len(GROUPS))]

# ======================= deck =======================
prs = Presentation(os.path.join(HERE, "assets", "skeleton_monthly.pptx")); S = list(prs.slides)
def wk(d): return f"W{d.isocalendar()[1]}"
def PB(k): return f"{dm(BEF[k][0])} to {dm(BEF[k][1] - dt.timedelta(days=1))}"
def PA(k): return f"{dm(AFT[k][0])} to {dm(TODAY - dt.timedelta(days=1))}"
def pc_(v, d=2): return "–" if v is None else f"{v:.{d}f}%"
def short(m): return m.replace("BMW ", "").replace(" NAD", "")
def gname(k): return f"{short(GROUPS[k][1])} · {GROUPS[k][0]}"
def jname(sid, ch):
    n, ip = JIG.get(ch, (f"ch {ch}", None)); return f"{STN[sid]} {n}" + (f" ({ip})" if ip else "")

# ---- 1. cover ----
c = S[0]; strip_annotations(c)
set_runs(by_name(c, "Title 1"), ["NAD FCT NTF Report", " · ".join(dict.fromkeys(short(m) for _, m in GROUPS))])
sub = by_name(c, "내용 개체 틀 2")
set_runs(sub, [" · ".join(f"{gname(k)} from {dm(ACTS[k])}" for k in range(len(GROUPS))) + " · PMSystem2 data"]); sub.width = Inches(11)
gt = by_name(c, "Group 46").table
for r in range(len(gt.rows)):
    if gt.cell(r, 0).text_frame.text.strip().startswith("Document"):
        runs = gt.cell(r, 1).text_frame.paragraphs[0].runs; runs[0].text = f"QA-{TODAY:%y%m}-NTF"
        for extra in runs[1:]: extra._r.getparent().remove(extra._r)

# ---- 2. NAD FCT NTF RATE (form) ----
f = Frame(S[2], "NAD FCT NTF RATE", "NTF = units that were NG at least once / units tested (unit = one PCB at one station) · before / after per model and line from the first action in ImprovementList")
yy = f.section("NTF rate – before vs after", y=1.2, unit="(Unit: %)")
cw = 3.92
for k in range(len(GROUPS)):
    x = 0.53 + k * (cw + 0.24); b, a = SB[k], SA[k]
    rect(f.s, x, yy, cw, 1.48, G2, name=f"NTF card {k}")
    textbox(f.s, x + 0.25, yy + 0.08, cw - 0.5, 0.28, [[(short(GROUPS[k][1]), {"size": 14, "bold": True}), (f"  {GROUPS[k][0]}", {"size": 11, "color": G3})]])
    v = (a["ntf"] or 0) - (b["ntf"] or 0); col = GREEN if v < 0 else RED
    textbox(f.s, x + 0.25, yy + 0.32, cw - 0.5, 0.5, [[(pc_(b["ntf"]), {"color": G3, "size": 16}), (" → ", {"color": G3, "size": 16}),
                                                    (pc_(a["ntf"]), {"color": col, "size": 26, "bold": True})]])
    textbox(f.s, x + 0.25, yy + 0.8, cw - 0.5, 0.22, [[(f"{'▼' if v < 0 else '▲'} {abs(v):.2f}%", {"color": col, "bold": True}),
                                                     ("  after vs before", {"color": G3})]], size=10.5)
    textbox(f.s, x + 0.25, yy + 1.03, cw - 0.5, 0.2, [f"before {PB(k)} · after {PA(k)} ({wk(ACTS[k])})"], size=8, color=DARK)
    textbox(f.s, x + 0.25, yy + 1.23, cw - 0.5, 0.2, [f"NG units: {num(b['ng'])} / {num(b['pairs'])} → {num(a['ng'])} / {num(a['pairs'])}"], size=8, color=G3)
from improvements import _in_family
from pca import codes_short
def rate(S_, k, fam, sid=None):
    """% of all units of the group whose first NG was in this NG step family (at this station)."""
    n = sum(v for c, st_ in S_[k]["item_st"].items() if _in_family(c, fam) for s_, v in st_.items() if sid is None or s_ == sid)
    return n * 100.0 / S_[k]["pairs"] if S_[k]["pairs"] else 0.0
items, acts = [], []                                           # by model, then line
for k, (line, model) in enumerate(GROUPS):
    imp = [(n_, x) for n_, x in enumerate(IMP_ALL, 1) if x["line"] == line and x["model"] == model]
    # 1) NG steps of the improvement list (one row per station + NG step), with the action numbers
    rows_ = {}
    for n_, x in imp:
        sid = next((s_ for s_, nm in STN.items() if nm == x["station"] and ST_LINE[s_] == LINE_ID[line]), None)
        rows_.setdefault((sid, x["code"]), []).append(n_)
    for (sid, fam), nums in rows_.items():
        items.append((k, STN.get(sid, "–"), codes_short(fam), rate(SB, k, fam, sid), rate(SA, k, fam, sid), "Improved #" + ",#".join(map(str, nums))))
    # 2) the NG step that increased most and has no action yet
    fams = [x["code"] for _, x in imp]
    cand = []; acts_new = None
    for c in set(SA[k]["items"]) | set(SB[k]["items"]):
        if any(_in_family(c, f_) for f_ in fams): continue
        ra_ = SA[k]["items"].get(c, 0) * 100.0 / max(SA[k]["pairs"], 1); rb_ = SB[k]["items"].get(c, 0) * 100.0 / max(SB[k]["pairs"], 1)
        if ra_ > rb_: cand.append((ra_ - rb_, c, rb_, ra_))
    for d_, c, rb_, ra_ in sorted(cand, reverse=True)[:1]:
        stn = max(SA[k]["item_st"][c].items(), key=lambda kv: kv[1])[0]
        items.append((k, STN[stn], c, rb_, ra_, "Increased"))
        n = SA[k]["items"][c]
        jj = sorted(SA[k]["item_jig"][c].items(), key=lambda kv: -kv[1]); top_j = jj[0] if jj else None
        if top_j and top_j[1] * 100 >= 40 * n:
            act = f"Check / clean pins of {jname(*top_j[0])}: {top_j[1] * 100 // n}% of the NG"; cyc = "daily"
        else:
            act = f"{STN[stn]} {c}: analyse NG logs, check limits and fixture"; cyc = "weekly"
        acts_new = (short(model), line, act, f"Open ({cyc})")
    # actions already done (same action text merged)
    done = {}
    for n_, x in imp:
        d = done.setdefault(x["action"] or "–", {"nums": [], "codes": [], "date": x["date"]})
        d["nums"].append(n_); d["date"] = min(d["date"], x["date"])
        if codes_short(x["code"]) not in d["codes"]: d["codes"].append(codes_short(x["code"]))
    for act, d in sorted(done.items(), key=lambda kv: (kv[1]["date"], kv[1]["nums"][0])):
        acts.append((short(model), line, f"#{', #'.join(map(str, d['nums']))} {act}", f"Done {dm(d['date'])}"))
    if acts_new: acts.append(acts_new)
# the two tables side by side: same top, same header height, same total height
TY2 = yy + 1.66
y2 = f.section("NTF NG items – improved (ImprovementList) and increased", y=TY2, w=6.0, unit="(Unit: % of units)")
f.section("Actions – done and to do", x=6.73, y=TY2, w=6.04, unit="(PIC to be assigned)")
HH, BODY = 0.3, 6.78 - y2 - 0.3 - 0.22                          # header height, body height (footnote below)
nrows = [["#", "Model", "Line", "Station", "NG step", "Before", "After", "Type"]]
for i, (k, stn, code, rb_, ra_, typ) in enumerate(items, 1):
    nrows.append([str(i), short(GROUPS[k][1]), GROUPS[k][0], stn, code, f"{rb_:.2f}", f"{ra_:.2f}", typ])
def nfmt(i, j, v):
    o = {"align": PP_ALIGN.LEFT, "bold": True} if j == 4 else ({"bold": True} if j in (1, 2) else {})
    if i and j == 6: o["color"] = RED if float(v) > float(nrows[i][5]) else GREEN
    if i and j == 7: o.update({"color": RED if v == "Increased" else GREEN, "bold": True})
    return o
table(f.s, 0.53, y2, 6.0, nrows, [0.25, 0.68, 0.55, 0.6, 1.95, 0.5, 0.5, 0.97], row_h=BODY / len(items), header_h=HH, size=6.5,
      cell_fmt=nfmt, name="NTF NG items")
arows = [["#", "Model", "Line", "Action item", "PIC", "Status"]] + [[str(i), m_, l_, a_, "", st_] for i, (m_, l_, a_, st_) in enumerate(acts, 1)]
def afmt(i, j, v):
    if j == 3: return {"align": PP_ALIGN.LEFT}
    if j in (1, 2): return {"bold": True}
    if i and j == 5: return {"bold": True, "color": GREEN if v.startswith("Done") else RED}
table(f.s, 6.73, y2, 6.04, arows, [0.25, 0.65, 0.48, 3.56, 0.3, 0.8], row_h=BODY / len(acts), header_h=HH, size=6.5,
      cell_fmt=afmt, name="NTF actions")
textbox(f.s, 0.53, y2 + HH + BODY + 0.04, 12.24, 0.25,
        ["* Before / After = units whose first NG was this NG step at this station / all units of the model and line. Improved = NG step with an action in "
         "ImprovementList; Increased = NG step that increased most without an action. Unit = one PCB at one station; job changes are not tests."], size=7, color=G3)

# ---- 3.. detail per model and line ----
DETAIL = [S[3], S[4], S[6], S[7], S[8], S[9]]
for k, sl in enumerate(DETAIL[:len(GROUPS)]):
    line, model = GROUPS[k]
    ACT = ACTS[k]
    f = Frame(sl, f"NTF Detail – {short(model)} · {line}", f"{model} on {line} · before {PB(k)} vs after {PA(k)} (action {dm(ACT)}, {wk(ACT)})")
    weeks = []; w = TSS[k]
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
    textbox(f.s, 0.53, yy + 2.37, 6.0, 0.2, [f"grey = before · green = week with / after {dm(ACT)} · units per week: " +
                                            ", ".join(f"{wk(w_)} {num(s_['pairs'])}" for w_, _, s_ in weeks[-4:])], size=7.5, color=G3)
    f.section("NTF by station", x=6.77, w=6.0, unit="(Unit: %)")
    srows = [["Station", "Units B / A", "NTF before", "NTF after", "Δ"]]
    for sid in [s for s in SIDS if ST_LINE[s] == LINE_ID[line]]:
        b, a = stats(k, *BEF[k], sid), stats(k, *AFT[k], sid)
        if not b["pairs"] and not a["pairs"]: continue
        d_ = (a["ntf"] or 0) - (b["ntf"] or 0)
        srows.append([STN[sid], f"{num(b['pairs'])} / {num(a['pairs'])}", pc_(b["ntf"]), pc_(a["ntf"]), f"{'▲' if d_ > 0 else '▼'} {abs(d_):.2f}%"])
    table(f.s, 6.77, yy, 6.0, srows, [1.2, 1.4, 1.1, 1.1, 1.2], row_h=0.3, size=8.5,
          cell_fmt=lambda i, j, v: ({"bold": True} if j == 0 else {}) | ({"color": RED if v.startswith("▲") else GREEN} if j == 4 and i else {}),
          name=f"NTF station {k}")
    y3 = f.section("Top NTF NG items – before vs after", y=yy + 2.7, w=6.0, unit="(Unit: % of units)")
    b, a = SB[k], SA[k]
    codes = sorted(set(b["items"]) | set(a["items"]), key=lambda c_: -max(b["items"].get(c_, 0) / max(b["pairs"], 1), a["items"].get(c_, 0) / max(a["pairs"], 1)))[:6]
    irows = [["NG step", "Before", "After", "Δ"]]
    for c_ in codes:
        rb_ = b["items"].get(c_, 0) * 100.0 / max(b["pairs"], 1); ra_ = a["items"].get(c_, 0) * 100.0 / max(a["pairs"], 1)
        irows.append([c_, f"{rb_:.2f}", f"{ra_:.2f}", f"{ra_ - rb_:+.2f}"])
    table(f.s, 0.53, y3, 6.0, irows, [3.3, 0.9, 0.9, 0.9], row_h=0.26, size=8,
          cell_fmt=lambda i, j, v: ({"align": PP_ALIGN.LEFT, "bold": True} if j == 0 else {}) | ({"color": RED if v.startswith("+") and v != "+0.00" else GREEN} if j == 3 and i else {}),
          name=f"NTF items {k}")
    f.section("Jigs with most NTF NG units (after)", x=6.77, y=yy + 2.7, w=6.0, unit="(Unit: NG units)")
    jj = sorted(a["jigs"].items(), key=lambda kv: -kv[1][1])[:6]
    jrows = [["Jig", "NG units after", "Share", "Main NG step"]]
    for (sid, ch), (_, n) in jj:
        main = max(((c_, d_.get((sid, ch), 0)) for c_, d_ in a["item_jig"].items()), key=lambda kv: kv[1], default=("–", 0))
        jrows.append([jname(sid, ch), num(n), f"{n * 100 // max(a['ng'], 1)}%", f"{main[0]} ({main[1]})" if main[1] else "–"])
    table(f.s, 6.77, y3, 6.0, jrows, [2.2, 1.0, 0.7, 2.1], row_h=0.26, size=8,
          cell_fmt=lambda i, j, v: {"align": PP_ALIGN.LEFT} if j in (0, 3) else None, name=f"NTF jigs {k}")

# ---- verification: one 'Verify Corrective Action' page per action of these models and lines (numbers as in the monthly report) ----
ALL_G = sorted(((n_, x) for n_, x in enumerate(IMP_ALL, 1) if (x["line"], x["model"]) in GROUPS),
               key=lambda t: (t[1]["model"], t[1]["line"], t[1]["date"], t[0]))
verification_summary(S[11], ALL_G, f"{len(ALL_G)} improvements of these models and lines (ImprovementList.xlsx) · numbers as in the monthly report")
PCA_SLOTS = S[12:36]
PCA = [(n_, x) for n_, x in enumerate(IMP_ALL, 1) if (x["line"], x["model"]) in GROUPS and x["verdict"] != "Insufficient data"][:len(PCA_SLOTS)]
PCA.sort(key=lambda t: (t[1]["model"], t[1]["line"], t[1]["date"], t[0]))
for sl, (n_, x) in zip(PCA_SLOTS, PCA): pca_page(sl, n_, x)

# ---- end, drop unused, page numbers ----
strip_annotations(S[39])
keep = {id(S[0]), id(S[2]), id(S[11]), id(S[39])} | {id(s) for s in DETAIL[:len(GROUPS)]} | {id(s) for s in PCA_SLOTS[:len(PCA)]}
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
