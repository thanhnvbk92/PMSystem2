import json, copy, datetime as dt, sys, os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION, XL_MARKER_STYLE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree

# ---------- palette / fonts (from template theme 행성_color) ----------
BLACK, WHITE = "000000", "FFFFFF"
G1, G2, G3 = "E7E7E7", "F2F2F2", "7F7F7F"
GREEN, VIOLET, RED, DARK = "55B669", "7D84FE", "FF0000", "404040"
LGREEN, LVIOLET = "BCE3C2", "E3ECFE"
FM, FS = "Pretendard Medium", "Pretendard SemiBold"

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

