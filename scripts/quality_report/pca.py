"""'Verify Corrective Action' page (one per improvement), shared by the monthly report and the model review."""
import os as _os, datetime as dt
from pptlib import *

BORDER = "ADADAD"
VCOL = {"Effective": GREEN, "Worse": RED, "Small improvement": GREEN, "Improving (not significant)": "BF8F00",
        "No clear effect": G3, "Insufficient data": G3, "NG step not seen": G3, "No baseline": G3, "No NG step": G3}
STATUS = {"Effective": ("OK", GREEN, BLACK), "Small improvement": ("Monitor", "FFEB9C", BLACK),
          "Improving (not significant)": ("Monitor", "FFEB9C", BLACK), "Worse": ("NG", RED, WHITE),
          "No clear effect": ("NG", "F4B183", BLACK)}
def pc(v, d=2): return "–" if v is None else f"{v:.{d}f}%"
def dd(s): return dt.date.fromisoformat(s).strftime("%d/%m")
def vbase(v): return v.replace(" (early)", "")
def status_of(v):
    st, fill, fc = STATUS.get(vbase(v), ("Check", G1, BLACK))
    return (st + "\n(early)" if v.endswith("(early)") else st), fill, fc
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
COLS = [0.53, 4.59, 4.71, 0.77, 0.95, 0.68]           # as the "Verify Permanent Corrective Action" page
TX, TY, H0, H1 = 0.53, 1.81, 0.52, 4.13
def pca_cell(cell, paras, size=9.5, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, fill=WHITE, color=BLACK, left=BORDER, right=BORDER):
    style_cell(cell, paras, size=size, color=color, fill=fill, align=align, top=BORDER, bottom=BORDER, left=left, right=right)
    cell.vertical_anchor = anchor
    cell.margin_left = Inches(0.08); cell.margin_top = Inches(0.08); cell.margin_right = Inches(0.05)
def pca_page(sl, num_, x):
    """x = one improvement from improvements.analyze (JSON form: dates as ISO strings)."""
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
        paras += ["", [("Notes", {"bold": True})]] + [[("• " + n_, {"color": DARK if " increased to " in n_ else G3, "size": 8.5})] for n_ in x["notes"]]
    pca_cell(tbl.cell(1, 1), paras, size=9.5)
    result = [[("Result", {"bold": True})],
              [("NG step: ", {}), (f"{pc(x['rate_before'])} → {pc(x['rate_after'])}", {"bold": True, "color": res_col}),
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
        cd.add_series("NG step rate %", [round(p[1], 3) for p in pts])
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
