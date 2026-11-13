using System.Globalization;
using System.Text;

namespace PMSystem2.Api.Services;

public static partial class CpkReportWorkbook
{
    private const double DashboardColumnWidth = 16;
    // Report font sizes (points). Larger than Excel's 11 pt default for readability.
    private const double BodyFontSize = 13, NoteFontSize = 12, TitleFontSize = 28, KpiFontSize = 32;
    // One text line at the body font plus padding (CPK_Channels data rows).
    private const double DataRowHeight = 24;

    // Excel stores widths in character units and heights in points. Use a
    // conservative Calibri 11 glyph estimate, plus padding, rather than a fixed
    // row height or string length divided by the nominal column width.
    private static double TextPixels(string text, double fontSize = BodyFontSize, bool bold = false)
    {
        var width = 0d;
        foreach (var rune in text.EnumerateRunes())
        {
            var c = rune.Value;
            width += c switch {
                9 => 16,
                32 => 4,
                105 or 108 or 73 or 33 or 39 or 46 or 44 or 58 or 59 or 124 => 4,
                102 or 114 or 116 or 40 or 41 or 91 or 93 or 123 or 125 => 6,
                77 or 87 or 109 or 119 or 64 or 35 or 37 or 38 => 13,
                >= 48 and <= 57 => 8,
                >= 65 and <= 90 => 9,
                >= 97 and <= 122 => 8,
                >= 0x2e80 => 16,
                _ => 9
            };
        }
        return width * fontSize / 11 * (bold ? 1.08 : 1);
    }

    private static string CellText(object? value) => value switch {
        null => "",
        XlFormula formula => CellText(formula.Cached),
        DateTime date => date.ToString("O", CultureInfo.InvariantCulture),
        IFormattable number => number.ToString(null, CultureInfo.InvariantCulture) ?? "",
        _ => value.ToString() ?? ""
    };

    private static double ColumnPixels(double width) => width * 7 + 5;

    private static int WrappedLines(string text, double availablePixels, double fontSize = BodyFontSize, bool bold = false)
    {
        var lines = 0;
        foreach (var paragraph in text.Replace("\r", "").Split('\n'))
        {
            var used = 0d;
            lines++;
            foreach (var word in paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var width = TextPixels(word, fontSize, bold);
                var space = used > 0 ? TextPixels(" ", fontSize, bold) : 0;
                if (used > 0 && used + space + width > availablePixels) { lines++; used = 0; space = 0; }
                if (width > availablePixels)
                {
                    foreach (var rune in word.EnumerateRunes())
                    {
                        var glyph = TextPixels(rune.ToString(), fontSize, bold);
                        if (used > 0 && used + glyph > availablePixels) { lines++; used = 0; }
                        used += glyph;
                    }
                }
                else used += space + width;
            }
        }
        return Math.Max(1, lines);
    }

    private static double[] GetColumnWidths(string[] headers, IReadOnlyList<object?[]> rows)
    {
        return headers.Select((header, index) =>
        {
            var limits = header switch {
                "Line" => (18d, 30d),
                "Station" => (22d, 36d),
                "Channel" => (14d, 30d),
                "Model Group" => (28d, 46d),
                "Job File" => (30d, 46d),
                "Step Name" => (30d, 46d),
                "Status" or "Raw Data Status" => (34d, 54d),
                "PID" => (30d, 50d),
                "Data From" or "Calculated At" or "Inspect Time (ISO 8601)" => (42d, 50d),
                "Station ID" or "Channel ID" => (16d, 22d),
                "Step Number" => (12d, 16d),
                "Sample Index" => (16d, 22d),
                "Historical Data" => (22d, 36d),
                "CPK" or "CPL" or "CPU" => (14d, 18d),
                _ => (18d, 30d)
            };
            var contentWidth = rows.Count == 0 ? 0 : rows.Max(row => TextPixels(CellText(row[index])));
            var pixels = Math.Max(contentWidth, TextPixels(header, bold: true));
            return Math.Round(Math.Clamp((pixels + 24) / 7, limits.Item1, limits.Item2), 2);
        }).ToArray();
    }

    private static double GetRowHeight(object?[] values, double[] widths, bool header = false)
    {
        var lines = values.Select((value, index) =>
            WrappedLines(CellText(value), Math.Max(24, ColumnPixels(widths[index]) - 24), bold: header)).DefaultIfEmpty(1).Max();
        return Math.Min(409, Math.Max(header ? 40 : 30, lines * Math.Ceiling(BodyFontSize * 1.55) + 12));
    }

    private static (double Size, bool Bold) DashboardFont(int style) => style switch {
        Title => (TitleFontSize, true),
        KpiValue or KpiGoodValue or KpiWarnValue or KpiNaValue => (KpiFontSize, true),
        Note => (NoteFontSize, false),
        0 or 2 or Subtitle or Unavailable or Canvas or Wrap or WrapAlternate => (BodyFontSize, false),
        _ => (BodyFontSize, true)
    };
}
