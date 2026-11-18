import json, copy, datetime as dt, sys, os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION, XL_MARKER_STYLE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.environ.get("DATA", os.path.join(HERE, "data.json")), encoding="utf-8"))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "report.pptx")

# ---------- palette / fonts (from template theme 행성_color) ----------
BLACK, WHITE = "000000", "FFFFFF"
G1, G2, G3 = "E7E7E7", "F2F2F2", "7F7F7F"
GREEN, VIOLET, RED, DARK = "55B669", "7D84FE", "FF0000", "404040"
LGREEN, LVIOLET = "BCE3C2", "E3ECFE"
FM, FS = "Pretendard Medium", "Pretendard SemiBold"

# ---------- periods ----------
END = dt.date(2026, 11, 16)
def wk(i):  # i=0 -> W46
    e = END - dt.timedelta(days=7 * i); s = e - dt.timedelta(days=7)
    return s, e - dt.timedelta(days=1)
def wname(i): return f"W{46 - i}"
def dm(d): return d.strftime("%d/%m")
W46S, W46E = wk(0)
PERIOD = f"W46 {dm(W46S)} – {dm(W46E)}/2026"

def q(k):
    v = D.get(k)
    return v if isinstance(v, dict) and "error" not in v else None

cur, prev = q("week0"), q("week1")
def fpy(m): return m["rtyRate"]
def rt(m): return m["retestDefectRate"]
def ntf(m): return m["ntfRate"]
def sfpy(m): return round(100 - m["ntfRate"], 2)   # station-level first pass yield

# ---------- low level helpers ----------
def rgb(h): return RGBColor.from_string(h)

def font(run, size=None, color=None, bold=False, name=None):
    f = run.font
    if size: f.size = Pt(size)
    if color: f.color.rgb = rgb(color)
    nm = name or (FS if bold else FM)
    f.name = nm
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rPr, qn(tag))
        el.set("typeface", nm)
    # schema order: ... latin, ea, cs -> ensure latin precedes
    lat = rPr.find(qn("a:latin"))
    if lat is not None:
        rPr.remove(lat); idx = list(rPr).index(rPr.find(qn("a:ea"))); rPr.insert(idx, lat)

def remove(shape):
    el = shape._element; el.getparent().remove(el)

def by_name(slide, name):
    for s in slide.shapes:
        if s.name == name: return s
    return None

def strip_annotations(slide):
    for s in list(slide.shapes):
        if (s.top is not None and s.top < 0) or (s.left is not None and s.left < 0):
            remove(s)

def set_runs(shape, parts):
    """Replace text keeping the first run's formatting. parts: list of lines; each line str."""
    tf = shape.text_frame
    p0 = tf.paragraphs[0]
    r0 = copy.deepcopy(p0.runs[0]._r)
    pPr = p0._p.find(qn("a:pPr"))
    txBody = tf._txBody
    for p in list(tf.paragraphs):
        txBody.remove(p._p)
    for line in parts:
        p = etree.SubElement(txBody, qn("a:p"))
        if pPr is not None: p.append(copy.deepcopy(pPr))
        r = copy.deepcopy(r0)
        r.find(qn("a:t")).text = line
        p.append(r)

def textbox(slide, x, y, w, h, paras, size=11, color=BLACK, bold=False, align=PP_ALIGN.LEFT,
            anchor=MSO_ANCHOR.TOP, wrap=True, name=None, space_after=0):
    """paras: list of paragraphs; paragraph = str or list of (text, opts) runs."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name: tb.name = name
    tf = tb.text_frame; tf.word_wrap = wrap
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if space_after: p.space_after = Pt(space_after)
        runs = [(para, {})] if isinstance(para, str) else para
        for t, o in runs:
            r = p.add_run(); r.text = t
            font(r, o.get("size", size), o.get("color", color), o.get("bold", bold))
    return tb

def rect(slide, x, y, w, h, fill=G2, name=None):
    from pptx.enum.shapes import MSO_SHAPE
    s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid(); s.fill.fore_color.rgb = rgb(fill); s.line.fill.background()
    s.shadow.inherit = False
    if name: s.name = name
    return s

def clone(slide, shape, x=None, y=None, w=None):
    el = copy.deepcopy(shape._element)
    slide.shapes._spTree.append(el)
    new = slide.shapes[-1]
    if x is not None: new.left = Inches(x)
    if y is not None: new.top = Inches(y)
    if w is not None: new.width = Inches(w)
    return new

# ---------- table ----------
NOSTYLE = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"
def _ln(tag, color, w=6350):
    ln = etree.Element(qn(tag), w=str(w), cap="flat", cmpd="sng", algn="ctr")
    if color:
        sf = etree.SubElement(ln, qn("a:solidFill")); etree.SubElement(sf, qn("a:srgbClr"), val=color)
    else:
        etree.SubElement(ln, qn("a:noFill"))
    return ln

def style_cell(cell, text, size=9, color=BLACK, fill=None, bold=False, align=PP_ALIGN.CENTER,
               top=G3, bottom=G1, left=None, right=None):
    cell.margin_left = cell.margin_right = Inches(0.05)
    cell.margin_top = cell.margin_bottom = Inches(0.02)
    cell.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf = cell.text_frame
    tf.paragraphs[0].text = ""
    lines = text if isinstance(text, list) else [text]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        runs = [(line, {})] if isinstance(line, str) else line
        for t, o in runs:
            r = p.add_run(); r.text = t
            font(r, o.get("size", size), o.get("color", color), o.get("bold", bold))
    tcPr = cell._tc.get_or_add_tcPr()
    for tag in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
        for el in tcPr.findall(qn(tag)): tcPr.remove(el)
    for i, (tag, c) in enumerate((("a:lnL", left), ("a:lnR", right), ("a:lnT", top), ("a:lnB", bottom))):
        tcPr.insert(i, _ln(tag, c))
    if fill:
        cell.fill.solid(); cell.fill.fore_color.rgb = rgb(fill)
    else:
        cell.fill.background()

def table(slide, x, y, w, rows, col_w, row_h=0.28, header_rows=1, size=9, aligns=None, cell_fmt=None, name=None, header_h=None):
    nr, nc = len(rows), len(rows[0])
    gf = slide.shapes.add_table(nr, nc, Inches(x), Inches(y), Inches(w), Inches(row_h * nr))
    if name: gf.name = name
    tbl = gf.table
    tblPr = tbl._tbl.tblPr
    tblPr.set("firstRow", "0"); tblPr.set("bandRow", "0")
    sid = tblPr.find(qn("a:tableStyleId"))
    if sid is None: sid = etree.SubElement(tblPr, qn("a:tableStyleId"))
    sid.text = NOSTYLE
    tot = sum(col_w)
    for j, cw in enumerate(col_w): tbl.columns[j].width = Inches(w * cw / tot)
    for i in range(nr): tbl.rows[i].height = Inches(header_h if (header_h and i < header_rows) else row_h)
    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            if i < header_rows:
                style_cell(tbl.cell(i, j), val, size=size, color=WHITE, fill=BLACK, top=BLACK, bottom=G3 if i == header_rows - 1 else DARK)
            else:
                fmt = dict(size=size, align=(aligns[j] if aligns else PP_ALIGN.CENTER),
                           bottom=G3 if i == nr - 1 else G1, top=G1)
                if cell_fmt: fmt.update(cell_fmt(i, j, val) or {})
                style_cell(tbl.cell(i, j), val, **fmt)
    return gf

# ---------- chart ----------
def chart_text(chart, size=8, color=DARK):
    chart.font.size = Pt(size); chart.font.name = FM; chart.font.color.rgb = rgb(color)

def axis_quiet(ax, grid=True, fmt=None, lo=None, hi=None, visible=True):
    ax.format.line.color.rgb = rgb(G1)
    ax.has_major_gridlines = grid
    if grid:
        ax.major_gridlines.format.line.color.rgb = rgb(G1); ax.major_gridlines.format.line.width = Pt(0.5)
    if fmt: ax.tick_labels.number_format = fmt; ax.tick_labels.number_format_is_linked = False
    if lo is not None: ax.minimum_scale = lo
    if hi is not None: ax.maximum_scale = hi
    ax.tick_labels.font.size = Pt(8); ax.tick_labels.font.name = FM
    ax.tick_labels.font.color.rgb = rgb(G3)
    if not visible: ax.visible = False

def labels(series, fmt='0.00', pos=None, color=DARK, size=8):
    dl = series.data_labels
    dl.show_value = True; dl.number_format = fmt; dl.number_format_is_linked = False
    dl.font.size = Pt(size); dl.font.name = FM; dl.font.color.rgb = rgb(color)
    if pos is not None: dl.position = pos

def legend(chart, pos=XL_LEGEND_POSITION.TOP):
    chart.has_legend = True; chart.legend.position = pos; chart.legend.include_in_layout = False
    chart.legend.font.size = Pt(8); chart.legend.font.name = FM

def column_chart(slide, x, y, w, h, cats, series, colors, fmt='0.00', lo=None, hi=None, bar=False, gap=80, overlap=0, name=None):
    cd = CategoryChartData(); cd.categories = cats
    for n, vals in series: cd.add_series(n, vals)
    t = XL_CHART_TYPE.BAR_CLUSTERED if bar else XL_CHART_TYPE.COLUMN_CLUSTERED
    gf = slide.shapes.add_chart(t, Inches(x), Inches(y), Inches(w), Inches(h), cd)
    if name: gf.name = name
    ch = gf.chart; chart_text(ch)
    plot = ch.plots[0]; plot.gap_width = gap; plot.overlap = overlap
    for s, c in zip(plot.series, colors):
        s.format.fill.solid(); s.format.fill.fore_color.rgb = rgb(c); s.invert_if_negative = False
        labels(s, fmt, XL_LABEL_POSITION.OUTSIDE_END)
    axis_quiet(ch.value_axis, True, fmt, lo, hi)
    axis_quiet(ch.category_axis, False)
    if bar: ch.category_axis.reverse_order = True
    if len(series) > 1: legend(ch)
    else: ch.has_legend = False
    return ch

def line_chart(slide, x, y, w, h, cats, series, colors, fmt='0.00', lo=None, hi=None, name=None):
    cd = CategoryChartData(); cd.categories = cats
    for n, vals in series: cd.add_series(n, vals)
    gf = slide.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, Inches(x), Inches(y), Inches(w), Inches(h), cd)
    if name: gf.name = name
    ch = gf.chart; chart_text(ch)
    for i, (s, c) in enumerate(zip(ch.plots[0].series, colors)):
        s.smooth = False
        s.format.line.color.rgb = rgb(c); s.format.line.width = Pt(2)
        s.marker.style = XL_MARKER_STYLE.CIRCLE; s.marker.size = 6
        s.marker.format.fill.solid(); s.marker.format.fill.fore_color.rgb = rgb(c)
        s.marker.format.line.color.rgb = rgb(c)
        labels(s, fmt, XL_LABEL_POSITION.ABOVE if i == 0 else XL_LABEL_POSITION.BELOW, color=c)
    axis_quiet(ch.value_axis, True, fmt, lo, hi)
    axis_quiet(ch.category_axis, False)
    legend(ch)
    return ch

# ---------- formatting ----------
def pct(v, d=2): return f"{v:.{d}f}%"
def num(v): return f"{int(v):,}"
def delta(v_cur, v_prev, higher_better):
    d = round(v_cur - v_prev, 2)
    if abs(d) < 0.005: return ("■ 0.00%p", G3)
    good = (d > 0) == higher_better
    return (f"{'▲' if d > 0 else '▼'} {abs(d):.2f}%p", GREEN if good else RED)

# ---------- content slide frame (from template slide 17) ----------
class Frame:
    def __init__(self, slide, title, subtitle):
        self.s = slide
        strip_annotations(slide)
        set_runs(by_name(slide, "TextBox 5"), [title])
        set_runs(by_name(slide, "TextBox 10"), [subtitle])
        for nm in ("표 7", "표 8"):
            sh = by_name(slide, nm)
            if sh is not None: remove(sh)
        self.label = by_name(slide, "TextBox 3")
        self.icon = by_name(slide, "그림 1")
        self.hline = by_name(slide, "직선 연결선[R] 11")
        self.unit = by_name(slide, "TextBox 42")
        self.used = False

    def section(self, text, x=0.53, y=1.44, w=12.24, unit=None):
        """Section header: icon + 12pt label + rule (template style). y = icon top."""
        if not self.used:
            icon, lab, line, un = self.icon, self.label, self.hline, self.unit
            self.used = True
            icon.left, icon.top = Inches(x), Inches(y)
        else:
            icon = clone(self.s, self.icon, x, y)
            lab = clone(self.s, self.label); line = clone(self.s, self.hline); un = clone(self.s, self.unit)
        lab.left, lab.top = Inches(x + 0.14), Inches(y - 0.07)
        set_runs(lab, [text])
        line.left, line.top, line.width = Inches(x + 0.01), Inches(y + 0.23), Inches(w)
        un.left, un.top, un.width = Inches(x + w - 2.95), Inches(y - 0.03), Inches(2.95)
        set_runs(un, [unit or ""])
        if not unit: un.text_frame.paragraphs[0].runs[0].text = ""
        return y + 0.38   # content top

# ======================================================================
prs = Presentation(os.path.join(HERE, "skeleton.pptx"))
S = list(prs.slides)

# ---------- 1. Cover (template slide 7) ----------
c = S[0]; strip_annotations(c)
set_runs(by_name(c, "Title 1"), ["Báo cáo chất lượng", "NTF · Re-test · FPY"])
sub = by_name(c, "내용 개체 틀 2"); set_runs(sub, [f"Họp tuần {PERIOD} · Dữ liệu PMSystem2"])
sub.width = Inches(8)
gt = by_name(c, "Group 46").table
for r in range(len(gt.rows)):
    t0 = gt.cell(r, 0).text_frame.text.strip()
    if t0.startswith("Document"):
        cell = gt.cell(r, 1); cell.text_frame.paragraphs[0].runs[0].text = "QA-2026-W46"
        for extra in cell.text_frame.paragraphs[0].runs[1:]: extra._r.getparent().remove(extra._r)

# ---------- 2. Contents (template slide 8) ----------
TOC = [("Tổng hợp KPI tuần W46", "3"), ("Xu hướng 6 tuần", "4"), ("Xu hướng theo ngày", "5"),
       ("Phân tích theo Line", "6"), ("Top Station cần cải thiện", "7"), ("Pareto mã lỗi", "8"),
       ("Nhận định & hành động", "9")]
t = S[1]; strip_annotations(t)
rows = {}
for sh in list(t.shapes):
    if not sh.has_text_frame or sh.name != "Content Placeholder 2": continue
    key = round(sh.top / 914400 / 0.555)   # row index by y
    rows.setdefault(key, []).append(sh)
ordered = [rows[k] for k in sorted(rows)]
for i, grp in enumerate(ordered):
    if i >= len(TOC):
        for sh in grp: remove(sh)
        continue
    for sh in grp:
        x = sh.left / 914400
        if x < 5: set_runs(sh, [f"{i + 1:02d}"])
        elif x < 10.5: set_runs(sh, [TOC[i][0]]); sh.width = Inches(3.2)
        else: set_runs(sh, [TOC[i][1]])
for sh in list(t.shapes):
    if sh.shape_type == 9 and sh.top / 914400 > 0.56 + 0.555 * (len(TOC) - 1) + 0.4:
        remove(sh)

# ---------- 3. KPI summary ----------
f = Frame(S[2], "Tổng hợp KPI chất lượng", f"{PERIOD} · so sánh W45")
yy = f.section("Chỉ số chính tuần W46", unit="(Đơn vị: %, %p = điểm phần trăm)")
cards = [
    ("FPY", "toàn hệ thống", fpy(cur), fpy(prev), True,
     f"{num(cur['rtyStraightThroughPcbs'])} PCB pass thẳng / {num(cur['rtyPcbs'])} PCB", GREEN),
    ("Re-test", "tỷ lệ lượt test NG", rt(cur), rt(prev), False,
     f"{num(cur['retestNgAttempts'])} lượt NG / {num(cur['retestAttempts'])} lượt test", VIOLET),
    ("NTF", "PID–Station từng NG", ntf(cur), ntf(prev), False,
     f"{num(cur['ntfNgPcbStations'])} NG / {num(cur['ntfPcbStations'])} PID–Station", DARK),
]
cw, gap = 3.92, 0.24
for i, (nm, sub_, v, pv, hb, detail, col) in enumerate(cards):
    x = 0.53 + i * (cw + gap)
    rect(f.s, x, yy, cw, 2.05, G2, name=f"KPI card {nm}")
    textbox(f.s, x + 0.25, yy + 0.2, cw - 0.5, 0.3, [[(nm, {"size": 14, "bold": True}), (f"  {sub_}", {"size": 10, "color": G3})]])
    textbox(f.s, x + 0.25, yy + 0.55, cw - 0.5, 0.75, [pct(v)], size=40, color=col, bold=True)
    dtxt, dcol = delta(v, pv, hb)
    textbox(f.s, x + 0.25, yy + 1.33, cw - 0.5, 0.25, [[(dtxt, {"color": dcol, "bold": True}), (f"  so với W45 ({pct(pv)})", {"color": G3})]], size=11)
    textbox(f.s, x + 0.25, yy + 1.65, cw - 0.5, 0.25, [detail], size=9, color=G3)

y2 = f.section("Định nghĩa & số liệu chi tiết", y=yy + 2.35)
defs = [["Chỉ số", "Công thức (theo PMSystem2)", "W45", "W46", "Chênh lệch", "Tử số / Mẫu số W46"]]
for nm, formula, key, hb, a, b in [
    ("FPY", "PCB chưa từng NG tại bất kỳ Station nào / Tổng PCB (PID) có test trong kỳ", fpy, True, "rtyStraightThroughPcbs", "rtyPcbs"),
    ("Re-test", "Số lượt test NG / Tổng số lượt test (mỗi lần test = 1 lượt)", rt, False, "retestNgAttempts", "retestAttempts"),
    ("NTF", "Số PID–Station từng NG / Tổng PID–Station được test trong kỳ", ntf, False, "ntfNgPcbStations", "ntfPcbStations")]:
    defs.append([nm, formula, pct(key(prev)), pct(key(cur)), delta(key(cur), key(prev), hb)[0], f"{num(cur[a])} / {num(cur[b])}"])
def defs_fmt(i, j, v):
    if j == 0: return {"bold": True}
    if j == 4:
        hb = defs[i][0] == "FPY"
        return {"color": delta(float(defs[i][3][:-1]), float(defs[i][2][:-1]), hb)[1], "bold": True}
table(f.s, 0.53, y2, 12.24, defs, [1.0, 5.2, 1.0, 1.0, 1.2, 2.4], row_h=0.34, size=9,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 4, cell_fmt=defs_fmt, name="Bảng định nghĩa KPI")
textbox(f.s, 0.53, y2 + 0.34 * 4 + 0.08, 12.24, 0.2,
        ["* Kỳ báo cáo theo giờ Việt Nam (UTC+7). FPY ở cấp Line/Station trong các trang sau = 100% − NTF của công đoạn đó."], size=8, color=G3)

# ---------- 4. Weekly trend ----------
f = Frame(S[3], "Xu hướng 6 tuần", f"W41 – W46 · W47 tạm tính 16/11 – 17/11")
weeks = [i for i in range(5, -1, -1) if q(f"week{i}")]
cats = [wname(i) for i in weeks]
wm = [q(f"week{i}") for i in weeks]
wc = q("weekcur")
if wc: cats.append("W47*"); wm.append(wc)
yy = f.section("FPY theo tuần", w=5.84, unit="(Đơn vị: %)")
f_vals = [fpy(m) for m in wm]
column_chart(f.s, 0.53, yy, 5.84, 2.6, cats, [("FPY", f_vals)], [GREEN], lo=max(0, int(min(f_vals)) - 3), hi=100, name="Biểu đồ FPY theo tuần")
f.section("Re-test & NTF theo tuần", x=6.93, w=5.84, unit="(Đơn vị: %)")
r_vals = [rt(m) for m in wm]; n_vals = [ntf(m) for m in wm]
line_chart(f.s, 6.93, yy, 5.84, 2.6, cats, [("Re-test", r_vals), ("NTF", n_vals)], [VIOLET, DARK],
           lo=0, hi=round(max(r_vals) * 1.35 + 0.5), name="Biểu đồ Re-test NTF theo tuần")
y2 = f.section("Bảng số liệu theo tuần", y=yy + 2.75)
trows = [["Chỉ số"] + cats]
trows.append(["FPY (%)"] + [f"{v:.2f}" for v in f_vals])
trows.append(["Re-test (%)"] + [f"{v:.2f}" for v in r_vals])
trows.append(["NTF (%)"] + [f"{v:.2f}" for v in n_vals])
trows.append(["Số lượt test"] + [num(m["retestAttempts"]) for m in wm])
trows.append(["Số PCB (PID)"] + [num(m["rtyPcbs"]) for m in wm])
def tfmt(i, j, v):
    o = {}
    if j == 0: o["bold"] = True
    if trows[0][j] == "W46": o["fill"] = LVIOLET; o["bold"] = True
    return o
table(f.s, 0.53, y2, 12.24, trows, [1.6] + [1] * len(cats), row_h=0.27, size=9, cell_fmt=tfmt, name="Bảng số liệu theo tuần")
textbox(f.s, 0.53, y2 + 0.27 * len(trows) + 0.06, 12.24, 0.2, ["* W47 mới có 2 ngày (16–17/11), chỉ để tham khảo."], size=8, color=G3)

# ---------- 5. Daily trend ----------
f = Frame(S[4], "Xu hướng theo ngày", "09/11 – 17/11/2026 (W46 + đầu W47)")
days = [d for d in range(9) if q(f"day{d}")]
dcats = [dm(W46S + dt.timedelta(days=d)) for d in days]
dmx = [q(f"day{d}") for d in days]
yy = f.section("Re-test & NTF theo ngày", unit="(Đơn vị: %)")
dr = [rt(m) for m in dmx]; dn = [ntf(m) for m in dmx]
line_chart(f.s, 0.53, yy, 12.24, 2.45, dcats, [("Re-test", dr), ("NTF", dn)], [VIOLET, DARK], lo=0,
           hi=round(max(dr) * 1.3 + 0.5), name="Biểu đồ Re-test NTF theo ngày")
y2 = f.section("Bảng số liệu theo ngày", y=yy + 2.6)
drows = [["Chỉ số"] + dcats,
         ["FPY (%)"] + [f"{fpy(m):.2f}" for m in dmx],
         ["Re-test (%)"] + [f"{v:.2f}" for v in dr],
         ["NTF (%)"] + [f"{v:.2f}" for v in dn],
         ["Số lượt test"] + [num(m["retestAttempts"]) for m in dmx],
         ["Lượt NG"] + [num(m["retestNgAttempts"]) for m in dmx]]
worst_day = max(range(len(dmx)), key=lambda i: dr[i])
def dfmt(i, j, v):
    o = {}
    if j == 0: o["bold"] = True
    if j == worst_day + 1 and i in (2, 3): o["color"] = RED; o["bold"] = True
    return o
table(f.s, 0.53, y2, 12.24, drows, [1.6] + [1] * len(dcats), row_h=0.27, size=9, cell_fmt=dfmt, name="Bảng số liệu theo ngày")
textbox(f.s, 0.53, y2 + 0.27 * len(drows) + 0.06, 12.24, 0.2,
        [f"* Ngày có Re-test cao nhất: {dcats[worst_day]} ({pct(dr[worst_day])}). FPY theo ngày tính trên PCB có test trong ngày, xét toàn bộ lịch sử."], size=8, color=G3)

# ---------- 6. By line ----------
f = Frame(S[5], "Phân tích theo Line", f"{PERIOD} · so sánh W45")
lines = []
for l in D["lines"]:
    m, pm = q(f"line{l['id']}"), q(f"lineprev{l['id']}")
    if not m or m["retestAttempts"] == 0: continue
    lines.append((l["name"], m, pm))
lines.sort(key=lambda t: -rt(t[1]))
yy = f.section("Re-test & NTF theo Line", w=5.84, unit="(Đơn vị: %)")
lc = [n for n, _, _ in lines]
column_chart(f.s, 0.53, yy, 5.84, 4.6, lc, [("Re-test", [rt(m) for _, m, _ in lines]), ("NTF", [ntf(m) for _, m, _ in lines])],
             [VIOLET, DARK], bar=True, gap=60, overlap=-10, lo=0, name="Biểu đồ Re-test NTF theo Line")
f.section("Bảng KPI theo Line (sắp xếp theo Re-test)", x=6.93, w=5.84, unit="(Đơn vị: %)")
lrows = [["Line", "Lượt test", "Re-test", "Δ W45", "NTF", "Δ W45", "FPY CĐ"]]
for n, m, pm in lines:
    dr_ = delta(rt(m), rt(pm), False)[0] if pm and pm["retestAttempts"] else "–"
    dn_ = delta(ntf(m), ntf(pm), False)[0] if pm and pm["ntfPcbStations"] else "–"
    lrows.append([n, num(m["retestAttempts"]), f"{rt(m):.2f}", dr_, f"{ntf(m):.2f}", dn_, f"{sfpy(m):.2f}"])
tot_attempts = sum(m["retestAttempts"] for _, m, _ in lines)
def lfmt(i, j, v):
    o = {}
    if j == 0: o["bold"] = True
    if j in (3, 5) and v != "–": o["color"] = RED if v.startswith("▲") else (GREEN if v.startswith("▼") else G3)
    if j == 2 and i <= 3: o["color"] = RED; o["bold"] = True
    return o
rh = min(0.3, 4.6 / len(lrows))
table(f.s, 6.93, yy, 5.84, lrows, [1.25, 1.1, 0.8, 1.0, 0.8, 1.0, 0.8], row_h=rh, size=8.5, cell_fmt=lfmt, name="Bảng KPI theo Line")
textbox(f.s, 6.93, yy + rh * len(lrows) + 0.06, 5.84, 0.2, ["* FPY CĐ = FPY công đoạn = 100% − NTF. Top 3 Re-test tô đỏ."], size=8, color=G3)

# ---------- 7. Top stations ----------
f = Frame(S[6], "Top Station cần cải thiện", f"{PERIOD} · Top 10 theo số lượt NG")
st_meta = {s["id"]: s for s in D["stations"]}
sts = []
for sid, meta in st_meta.items():
    m = q(f"st{sid}")
    if m and m["retestAttempts"] >= 300: sts.append((meta, m))
total_ng = cur["retestNgAttempts"]
sts.sort(key=lambda t: -t[1]["retestNgAttempts"])
top = sts[:10]
yy = f.section("Top 10 Station theo số lượt NG", unit="(Đơn vị: lượt, %)")
srows = [["#", "Line", "Model group", "Station", "Lượt test", "Lượt NG", "% tổng NG", "Re-test", "NTF", "FPY CĐ"]]
for i, (meta, m) in enumerate(top, 1):
    srows.append([str(i), meta["lineName"], meta["modelGroupName"], meta["name"], num(m["retestAttempts"]), num(m["retestNgAttempts"]),
                  pct(m["retestNgAttempts"] * 100 / total_ng, 1), f"{rt(m):.2f}", f"{ntf(m):.2f}", f"{sfpy(m):.2f}"])
def sfmt(i, j, v):
    o = {}
    if j == 3: o["bold"] = True
    if j == 7 and float(v) >= rt(cur) * 1.5: o["color"] = RED; o["bold"] = True
    if j == 8 and float(v) >= ntf(cur) * 1.5: o["color"] = RED; o["bold"] = True
    return o
table(f.s, 0.53, yy, 12.24, srows, [0.35, 1.0, 1.6, 1.7, 1.0, 0.9, 0.9, 0.8, 0.8, 0.8], row_h=0.29, size=9,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 6, cell_fmt=sfmt, name="Bảng Top 10 Station")
top_share = sum(m["retestNgAttempts"] for _, m in top) * 100 / total_ng
y3 = yy + 0.29 * len(srows) + 0.12
textbox(f.s, 0.53, y3, 12.24, 0.2, [f"* Tô đỏ: Re-test hoặc NTF ≥ 1.5 lần mức chung ({pct(rt(cur))} / {pct(ntf(cur))}). Chỉ xét Station ≥ 300 lượt test."], size=8, color=G3)
co = [("Top 10 Station", pct(top_share, 1), "tổng lượt NG toàn nhà máy"),
      ("Station NG nhiều nhất", f"{top[0][0]['name']}", f"{top[0][0]['lineName']} · {num(top[0][1]['retestNgAttempts'])} lượt NG"),
      ("Re-test cao nhất (Top 10)", pct(max(rt(m) for _, m in top)),
       next(f"{mm['name']} · {mm['lineName']}" for mm, m in top if rt(m) == max(rt(x) for _, x in top)))]
cw3 = (12.24 - 2 * 0.24) / 3
for i, (a, b, c_) in enumerate(co):
    x = 0.53 + i * (cw3 + 0.24)
    rect(f.s, x, y3 + 0.3, cw3, 0.95, G2, name=f"Callout {i + 1}")
    textbox(f.s, x + 0.2, y3 + 0.38, cw3 - 0.4, 0.22, [a], size=10, color=G3)
    textbox(f.s, x + 0.2, y3 + 0.6, cw3 - 0.4, 0.38, [b], size=20, color=RED if i != 1 else BLACK, bold=True)
    textbox(f.s, x + 0.2, y3 + 0.98, cw3 - 0.4, 0.2, [c_], size=9, color=G3)

# ---------- 8. Pareto ----------
f = Frame(S[7], "Pareto mã lỗi", f"{PERIOD} · Top 10 Error code")
par = D.get("pareto") if isinstance(D.get("pareto"), list) else []
p10 = par[:10]
yy = f.section("Số lượt NG theo mã lỗi", w=6.9, unit="(Đơn vị: lượt)")
column_chart(f.s, 0.53, yy, 6.9, 4.5, [p["code"][:28] for p in p10], [("Lượt NG", [p["count"] for p in p10])], [VIOLET],
             fmt='#,##0', bar=True, gap=50, lo=0, name="Biểu đồ Pareto mã lỗi")
f.section("Bảng Pareto", x=7.73, w=5.04, unit="(Đơn vị: lượt, %)")
prow = [["#", "Error code", "Lượt NG", "%", "Lũy kế %"]]
cum = 0
for i, p in enumerate(p10, 1):
    cum += p["pct"]
    prow.append([str(i), p["code"], num(p["count"]), f"{p['pct']:.1f}", f"{cum:.1f}"])
def pfmt(i, j, v):
    if j == 1: return {"bold": True}
    if i <= 3: return {"fill": LVIOLET}
table(f.s, 7.73, yy, 5.04, prow, [0.35, 2.75, 0.8, 0.55, 0.75], row_h=0.36, size=8.5,
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT] + [PP_ALIGN.CENTER] * 3, cell_fmt=pfmt, name="Bảng Pareto")
textbox(f.s, 7.73, yy + 0.36 * len(prow) + 0.08, 5.04, 0.4,
        [f"* Top 10 mã lỗi chiếm {cum:.1f}% tổng lượt NG ({num(cur['retestNgAttempts'])} lượt). Tô nền: Top 3 mã lỗi."], size=8, color=G3)

# ---------- 9. Insights & actions ----------
f = Frame(S[8], "Nhận định & kế hoạch hành động", PERIOD)
yy = f.section("Nhận định chính", w=5.84)
d_f = round(fpy(cur) - fpy(prev), 2); d_r = round(rt(cur) - rt(prev), 2); d_n = round(ntf(cur) - ntf(prev), 2)
# NG by model group (sum of station scopes = plant total)
mg = {}
for sid, meta in st_meta.items():
    m = q(f"st{sid}")
    if not m: continue
    a = mg.setdefault(meta["modelGroupName"], [0, 0]); a[0] += m["retestNgAttempts"]; a[1] += m["retestAttempts"]
mg_sorted = sorted(mg.items(), key=lambda kv: -kv[1][0])
g1, (g1_ng, g1_tot) = mg_sorted[0]
worst_st = max(top, key=lambda t: rt(t[1]))
hi_ntf = [t for t in top if 10 <= ntf(t[1]) < 99]   # Top-10 stations only; ~100% NTF = data anomaly
hi_ntf.sort(key=lambda t: -ntf(t[1]))
best_line = max(lines, key=lambda t: (rt(t[2]) - rt(t[1])) if t[2] else -99)
ins = [
    f"Cả 3 chỉ số cải thiện so với W45: FPY {pct(fpy(cur))} (+{d_f:.2f}%p), Re-test {pct(rt(cur))} ({d_r:+.2f}%p), NTF {pct(ntf(cur))} ({d_n:+.2f}%p).",
    f"{g1} là điểm nóng: chiếm {g1_ng * 100 / total_ng:.1f}% lượt NG toàn nhà máy, Re-test {g1_ng * 100 / g1_tot:.2f}% (gần gấp đôi mức chung).",
    f"{worst_st[0]['name']} – {worst_st[0]['lineName']} có Re-test {pct(rt(worst_st[1]))}: cứ ~{round(100 / rt(worst_st[1]))} lượt test có 1 lượt NG.",
    f"{best_line[0]} cải thiện mạnh nhất ({pct(rt(best_line[2]))} → {pct(rt(best_line[1]))}) nhưng vẫn là Line có Re-test cao nhất.",
    f"Mã lỗi {p10[0]['code']} chiếm {p10[0]['pct']:.1f}% lượt NG; các mã còn lại phân tán (Top 10 = {sum(p['pct'] for p in p10):.1f}%).",
]
if hi_ntf:
    ins.append("NTF > 10% (test lại mới pass): " + ", ".join(f"{t[0]['name']} – {t[0]['lineName']} ({pct(ntf(t[1]))})" for t in hi_ntf[:2]) + ".")
paras = [[("■  ", {"color": VIOLET, "size": 9}), (s_, {})] for s_ in ins]
textbox(f.s, 0.53, yy + 0.05, 5.84, 3.3, paras, size=11, space_after=8, name="Nhận định chính")
# three stat callouts under the insights
stats = [(pct(g1_ng * 100 / total_ng, 1), f"lượt NG từ {g1}", RED),
         (pct(rt(worst_st[1])), f"Re-test {worst_st[0]['name']} {worst_st[0]['lineName']}", RED),
         (f"+{d_f:.2f}%p", "FPY so với W45", GREEN)]
bw = (5.84 - 2 * 0.2) / 3
for i, (big, small, col) in enumerate(stats):
    x = 0.53 + i * (bw + 0.2)
    rect(f.s, x, 5.2, bw, 1.15, G2, name=f"Điểm nổi bật {i + 1}")
    textbox(f.s, x + 0.15, 5.32, bw - 0.3, 0.45, [big], size=22, color=col, bold=True)
    textbox(f.s, x + 0.15, 5.82, bw - 0.3, 0.45, [small], size=9, color=G3)

f.section("Kế hoạch hành động đề xuất", x=6.93, w=5.84)
acts = [["Hạng mục", "Hành động đề xuất", "PIC", "Hạn"],
        [[worst_st[0]["name"], f"{worst_st[0]['lineName']} · {worst_st[0]['modelGroupName']}"],
         f"Re-test {pct(rt(worst_st[1]))}: kiểm tra jig/cáp/connector Interface, so sánh với {top[0][0]['lineName']}", "", ""],
        [[g1, "Line 6-1 / 6-2"], f"Pareto lỗi riêng cho {g1}; xử lý Top 3 mã lỗi của model", "", ""],
        [[p10[0]["code"]], f"{p10[0]['pct']:.1f}% lượt NG: kiểm tra đầu đọc FID/nhãn; xác nhận lỗi thật hay NTF", "", ""],
        [["NTF cao"] + ([f"{hi_ntf[0][0]['name']} · {hi_ntf[0][0]['lineName']}"] if hi_ntf else []),
         "Rà soát độ ổn định test & limit; hạn chế số lần re-test cho phép", "", ""],
        [["FPY"], f"Đặt mục tiêu FPY tuần (W46: {pct(fpy(cur))}) và theo dõi tại họp W47", "", ""]]
def afmt(i, j, v):
    if j == 0: return {"bold": True, "align": PP_ALIGN.LEFT}
    if j == 1: return {"align": PP_ALIGN.LEFT}
table(f.s, 6.93, yy, 5.84, acts, [1.7, 2.75, 0.7, 0.7], row_h=0.7, size=9, cell_fmt=afmt, name="Bảng kế hoạch hành động", header_h=0.32)
textbox(f.s, 6.93, yy + 0.32 + 0.7 * (len(acts) - 1) + 0.06, 5.84, 0.2, ["* PIC và hạn hoàn thành xác nhận trong cuộc họp."], size=8, color=G3)

# ---------- 10. End (template slide 12) ----------
strip_annotations(S[9])

# ---------- page numbers (template uses static text boxes) ----------
for idx, sl in enumerate(S, 1):
    for sh in sl.shapes:
        if sh.name.startswith("슬라이드 번호") and sh.has_text_frame:
            if sh._element.findall(".//" + qn("a:fld")): continue
            if sh.text_frame.paragraphs[0].runs:
                set_runs(sh, [str(idx)])

prs.save(OUT)
print("saved", OUT)
