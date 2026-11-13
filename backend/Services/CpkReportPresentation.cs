using System.Globalization;
using System.IO.Compression;
using System.Xml;
using System.Xml.Linq;

namespace PMSystem2.Api.Services;

public static partial class CpkReportWorkbook
{
    private const int Metric = 3, MetricAlternate = 4, Good = 5, Warning = 6, Bad = 7, Unavailable = 8;
    private const int GoodText = 9, WarningText = 10, BadText = 11, Title = 12, Subtitle = 13, Section = 14;
    private const int KpiLabel = 15, KpiValue = 16, KpiGoodLabel = 17, KpiGoodValue = 18;
    private const int KpiWarnLabel = 19, KpiWarnValue = 20, KpiNaLabel = 21, KpiNaValue = 22;
    private const int Link = 23, Note = 25, Bold = 26, Canvas = 27, Wrap = 28, WrapAlternate = 29;
    private const int NoWrap = 34, NoWrapAlternate = 35;

    private static void WriteStyles(ZipArchive zip)
    {
        XNamespace n = MainNs;
        XElement Font(double size, string color, bool bold = false, bool underline = false) => new(n + "font",
            bold ? new XElement(n + "b") : null, underline ? new XElement(n + "u") : null,
            new XElement(n + "sz", new XAttribute("val", size.ToString(CultureInfo.InvariantCulture))), new XElement(n + "color", new XAttribute("rgb", "FF" + color)),
            new XElement(n + "name", new XAttribute("val", "Calibri")));
        XElement Fill(string color) => new(n + "fill", new XElement(n + "patternFill", new XAttribute("patternType", "solid"),
            new XElement(n + "fgColor", new XAttribute("rgb", "FF" + color)), new XElement(n + "bgColor", new XAttribute("indexed", 64))));
        // Conditional-format fills use bgColor as the cell colour. Leaving it at
        // indexed 64 (system foreground) painted CPK cells black.
        XElement CpkNumFmt() => new(n + "numFmt", new XAttribute("numFmtId", 164), new XAttribute("formatCode", "0.000"));
        XElement DxfFill(string color) => new(n + "fill", new XElement(n + "patternFill", new XAttribute("patternType", "solid"),
            new XElement(n + "fgColor", new XAttribute("rgb", "FF" + color)), new XElement(n + "bgColor", new XAttribute("rgb", "FF" + color))));
        XElement Xf(int font, int fill, int number = 0, int border = 1, string align = "left", bool wrap = true) => new(n + "xf",
            new XAttribute("numFmtId", number), new XAttribute("fontId", font), new XAttribute("fillId", fill),
            new XAttribute("borderId", border), new XAttribute("xfId", 0), new XAttribute("applyFont", 1),
            new XAttribute("applyFill", 1), new XAttribute("applyAlignment", 1),
            number > 0 ? new XAttribute("applyNumberFormat", 1) : null,
            new XElement(n + "alignment", new XAttribute("horizontal", align), new XAttribute("vertical", "center"),
                wrap ? new XAttribute("wrapText", 1) : null, align == "left" ? new XAttribute("indent", 1) : null));
        var fonts = new[] {
            Font(BodyFontSize, "334155"), Font(BodyFontSize, "FFFFFF", true), Font(BodyFontSize, "047857", true), Font(BodyFontSize, "B45309", true),
            Font(BodyFontSize, "BE123C", true), Font(BodyFontSize, "64748B"), Font(TitleFontSize, "FFFFFF", true), Font(KpiFontSize, "1D4ED8", true),
            Font(KpiFontSize, "047857", true), Font(KpiFontSize, "B45309", true), Font(KpiFontSize, "475569", true), Font(BodyFontSize, "2563EB", true, underline: true),
            Font(BodyFontSize, "0F172A", true), Font(NoteFontSize, "475569")
        };
        var fills = new[] {
            new XElement(n + "fill", new XElement(n + "patternFill", new XAttribute("patternType", "none"))),
            new XElement(n + "fill", new XElement(n + "patternFill", new XAttribute("patternType", "gray125"))),
            Fill("0F172A"), Fill("F8FAFC"), Fill("DCFCE7"), Fill("FEF3C7"), Fill("FFE4E6"), Fill("F1F5F9"),
            Fill("DBEAFE"), Fill("FFFFFF"), Fill("1E3A8A")
        };
        var xfs = new[] {
            Xf(0,9), Xf(1,10,border:0,align:"center",wrap:true), Xf(0,3),
            Xf(0,9,164,align:"right"), Xf(0,3,164,align:"right"),
            Xf(2,4,164,align:"right"), Xf(3,5,164,align:"right"), Xf(4,6,164,align:"right"), Xf(5,7,align:"center"),
            Xf(2,4,align:"center"), Xf(3,5,align:"center"), Xf(4,6,align:"center"),
            Xf(6,2,border:0), Xf(5,3,border:0), Xf(1,10,border:0),
            Xf(12,8,border:0,align:"center"), Xf(7,8,166,border:0,align:"center"),
            Xf(2,4,border:0,align:"center"), Xf(8,4,166,border:0,align:"center"),
            Xf(3,5,border:0,align:"center"), Xf(9,5,166,border:0,align:"center"),
            Xf(5,7,border:0,align:"center"), Xf(10,7,166,border:0,align:"center"),
            Xf(11,9,border:0), Xf(0,9,165,align:"right"), Xf(13,3,border:0,wrap:true), Xf(12,3),
            Xf(0,3,border:0), Xf(0,9,wrap:true), Xf(0,3,wrap:true),
            Xf(0,9,167,align:"right"), Xf(0,3,167,align:"right"),
            Xf(0,9,168,align:"right"), Xf(0,3,168,align:"right"),
            Xf(0,9,wrap:false), Xf(0,3,wrap:false)
        };
        var root = new XElement(n + "styleSheet",
            new XElement(n + "numFmts", new XAttribute("count", 5),
                new XElement(n + "numFmt", new XAttribute("numFmtId", 164), new XAttribute("formatCode", "0.000")),
                new XElement(n + "numFmt", new XAttribute("numFmtId", 165), new XAttribute("formatCode", "0.0%")),
                new XElement(n + "numFmt", new XAttribute("numFmtId", 166), new XAttribute("formatCode", "#,##0")),
                new XElement(n + "numFmt", new XAttribute("numFmtId", 167), new XAttribute("formatCode", "0.######")),
                new XElement(n + "numFmt", new XAttribute("numFmtId", 168), new XAttribute("formatCode", "0.000E+00"))),
            new XElement(n + "fonts", new XAttribute("count", fonts.Length), fonts),
            new XElement(n + "fills", new XAttribute("count", fills.Length), fills),
            new XElement(n + "borders", new XAttribute("count", 2), new XElement(n + "border"),
                new XElement(n + "border", new XElement(n + "left"), new XElement(n + "right"), new XElement(n + "top"),
                    new XElement(n + "bottom", new XAttribute("style", "hair"), new XElement(n + "color", new XAttribute("rgb", "FFE2E8F0"))), new XElement(n + "diagonal"))),
            new XElement(n + "cellStyleXfs", new XAttribute("count", 1),
                new XElement(n + "xf", new XAttribute("numFmtId", 0), new XAttribute("fontId", 0), new XAttribute("fillId", 0), new XAttribute("borderId", 0))),
            new XElement(n + "cellXfs", new XAttribute("count", xfs.Length), xfs),
            new XElement(n + "cellStyles", new XAttribute("count", 1), new XElement(n + "cellStyle",
                new XAttribute("name", "Normal"), new XAttribute("xfId", 0), new XAttribute("builtinId", 0))),
            new XElement(n + "dxfs", new XAttribute("count", 7),
                // 0-2: CPK values (Good / Warning / Below Target) with the 0.000 format
                new XElement(n + "dxf", Font(BodyFontSize,"047857",true), CpkNumFmt(), DxfFill("DCFCE7")),
                new XElement(n + "dxf", Font(BodyFontSize,"B45309",true), CpkNumFmt(), DxfFill("FEF3C7")),
                new XElement(n + "dxf", Font(BodyFontSize,"BE123C",true), CpkNumFmt(), DxfFill("FFE4E6")),
                // 3-5: counts in the same colours, keeping their integer format
                new XElement(n + "dxf", Font(BodyFontSize,"047857",true), DxfFill("DCFCE7")),
                new XElement(n + "dxf", Font(BodyFontSize,"B45309",true), DxfFill("FEF3C7")),
                new XElement(n + "dxf", Font(BodyFontSize,"BE123C",true), DxfFill("FFE4E6")),
                // 6: N/A count
                new XElement(n + "dxf", Font(BodyFontSize,"475569",true), DxfFill("E2E8F0"))));
        WriteXml(zip, "xl/styles.xml", root.ToString(SaveOptions.DisableFormatting));
    }

    private static int CpkStyle(double value) => value >= 1.33 ? Good : value >= 1 ? Warning : Bad;

    private static int TableCellStyle(int sheet, int row, int column, object? value)
    {
        var alternate = row % 2 == 0;
        // CPK_Channels rows are one line each (uniform height); long text is clipped
        // rather than wrapped, and the column can be widened to read it.
        var basic = sheet == 2 ? (alternate ? NoWrapAlternate : NoWrap) : alternate ? 2 : 0;
        if (sheet == 1)
            return column switch { 5 => GoodText, 6 => WarningText, 7 => BadText, 8 => Unavailable, _ => basic };
        if (sheet == 2 && column is 4 or 5)
            return Unavailable; // coloured by conditional formatting (follows edits)
        if (sheet == 2 && column is 6 or 7)
            return value is double number && number != 0 && Math.Abs(number) < 0.000001
                ? (alternate ? 33 : 32) : (alternate ? 31 : 30);
        return basic;
    }

    private static void WriteSheetProperties(XmlWriter xml, string color)
    {
        xml.WriteStartElement("sheetPr");
        xml.WriteStartElement("tabColor"); xml.WriteAttributeString("rgb", "FF" + color); xml.WriteEndElement();
        xml.WriteStartElement("pageSetUpPr"); xml.WriteAttributeString("fitToPage", "1"); xml.WriteEndElement();
        xml.WriteEndElement();
    }

    /// <summary>Good / Warning / Below Target rules (dxf 0/1/2) for a numeric CPK cell.</summary>
    private static string[] CpkRules(string cpkCell) => new[] {
        $"AND(ISNUMBER({cpkCell}),{cpkCell}>=1.33)",
        $"AND(ISNUMBER({cpkCell}),{cpkCell}>=1,{cpkCell}<1.33)",
        $"AND(ISNUMBER({cpkCell}),{cpkCell}<1)" };

    /// <summary>Good / Warning / Below Target rules (dxf 0/1/2) for a Status text cell.</summary>
    private static string[] StatusRules(string statusCell) => new[] {
        $"{statusCell}=\"Good\"", $"{statusCell}=\"Warning\"", $"{statusCell}=\"Below Target\"" };

    /// <summary>
    /// Writes conditional formatting so colours follow the values when the workbook is
    /// edited (static styles only reflect the export). Each entry: target range, and
    /// three formulas written relative to the range's first cell.
    /// </summary>
    private static void WriteConditionalFormats(XmlWriter xml, IEnumerable<(string Sqref, string[] Formulas)> blocks) =>
        WriteConditionalFormats(xml, blocks.Select(b => (b.Sqref, b.Formulas.Select((f, i) => (f, i)).ToArray())));

    /// <summary>Same as above with an explicit dxf (style) per rule.</summary>
    private static void WriteConditionalFormats(XmlWriter xml, IEnumerable<(string Sqref, (string Formula, int Dxf)[] Rules)> blocks)
    {
        var priority = 1;
        foreach (var (sqref, rules) in blocks)
        {
            xml.WriteStartElement("conditionalFormatting"); xml.WriteAttributeString("sqref", sqref);
            foreach (var (formula, dxf) in rules)
            {
                xml.WriteStartElement("cfRule"); xml.WriteAttributeString("type", "expression");
                xml.WriteAttributeString("dxfId", dxf.ToString(CultureInfo.InvariantCulture));
                xml.WriteAttributeString("priority", (priority++).ToString(CultureInfo.InvariantCulture));
                xml.WriteAttributeString("stopIfTrue", "1");
                xml.WriteElementString("formula", formula); xml.WriteEndElement();
            }
            xml.WriteEndElement();
        }
    }

    // dxf ids for counts: Good, Warning, Below Target, N/A.
    private const int CountGoodDxf = 3, CountWarningDxf = 4, CountBadDxf = 5, CountNaDxf = 6;

    /// <summary>Colours a count only while it is greater than zero.</summary>
    private static (string Formula, int Dxf)[] CountRule(string cell, int dxf) =>
        new[] { ($"AND(ISNUMBER({cell}),{cell}>0)", dxf) };

    private static void WritePrintSettings(XmlWriter xml, bool dashboard, int widePages = 1)
    {
        xml.WriteStartElement("printOptions"); xml.WriteAttributeString("horizontalCentered", "1"); xml.WriteEndElement();
        xml.WriteStartElement("pageMargins");
        foreach (var side in new[] { "left", "right", "top", "bottom" }) xml.WriteAttributeString(side, "0.3");
        xml.WriteAttributeString("header", "0.15"); xml.WriteAttributeString("footer", "0.15"); xml.WriteEndElement();
        xml.WriteStartElement("pageSetup"); xml.WriteAttributeString("paperSize", "8");
        xml.WriteAttributeString("orientation", dashboard ? "portrait" : "landscape");
        xml.WriteAttributeString("fitToWidth", widePages.ToString(CultureInfo.InvariantCulture)); xml.WriteAttributeString("fitToHeight", dashboard ? "1" : "0");
        xml.WriteEndElement();
        xml.WriteStartElement("headerFooter");
        xml.WriteElementString("oddFooter", "&L FCT System | CPK Report &R Page &P of &N");
        xml.WriteEndElement();
    }
}
