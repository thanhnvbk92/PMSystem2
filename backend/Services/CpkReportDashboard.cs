using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;

namespace PMSystem2.Api.Services;

public static partial class CpkReportWorkbook
{
    private static readonly string[] StateNames = { "Good", "Warning", "Below Target", "N/A" };

    private static int State(CpkReportChannel channel) => channel.Analysis?.Cpk is not double value
        ? 3 : value >= 1.33 ? 0 : value >= 1 ? 1 : 2;

    // Every number on the Dashboard is a formula over CPK_Channels / Summary.
    // The cached value (computed here with the same rule) is stored alongside.
    private static void WriteDashboard(ZipArchive zip, IReadOnlyList<CpkReportStation> stations,
        IReadOnlyList<CpkReportChannel> channels, SheetRanges ranges)
    {
        var counts = Enumerable.Range(0, 4).Select(state => channels.Count(c => State(c) == state)).ToArray();
        var groups = stations.DistinctBy(s => s.LineId).OrderBy(s => s.Line)
            .Select(s => (s.Line, Counts: Enumerable.Range(0, 4).Select(state =>
                channels.Count(c => c.Station.LineId == s.LineId && State(c) == state)).ToArray())).ToList();
        var cells = new Dictionary<(int Row, int Column), (object Value, int Style)>();
        var merges = new List<string>();
        var blocks = new List<(int Row, int Column, int LastRow, int LastColumn, object Value, int Style)>();
        void Put(int row, int col, object value, int style) => cells[(row, col)] = (value, style);
        void Range(int row, int col, int lastRow, int lastColumn, object value, int style)
        {
            blocks.Add((row, col, lastRow, lastColumn, value, style));
            for (var r = row; r <= lastRow; r++)
                for (var c = col; c <= lastColumn; c++) Put(r, c, r == row && c == col ? value : "", style);
            if (row != lastRow || col != lastColumn) merges.Add($"{Column(col)}{row}:{Column(lastColumn)}{lastRow}");
        }

        string Ch(string column) => ranges.Ch(column);
        var totalF = $"COUNTA({Ch(ChChannel)})";
        var withCpkF = $"COUNT({Ch(ChCpk)})";
        string StatusF(string status) => $"COUNTIF({Ch(ChStatus)},\"{status}\")";
        var stationsF = $"COUNTA({ranges.Sum("B")})";

        var generated = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Bangkok");
        var reportTime = generated.ToString("dd MMM yyyy HH:mm", CultureInfo.GetCultureInfo("en-US"));
        Range(1, 1, 2, 15, "CPK QUALITY REPORT", Title);
        Range(3, 1, 3, 15, new XlFormula(
            $"\"FCT SYSTEM  |  Generated {reportTime} (UTC+07)  |  \"&{stationsF}&\" stations  |  \"&{totalF}&\" channels\"",
            $"FCT SYSTEM  |  Generated {reportTime} (UTC+07)  |  {stations.Count} stations  |  {channels.Count} channels"), Subtitle);
        var cards = new[] {
            (Column:1, Label:"TOTAL CHANNELS", Value:new XlFormula(totalF, channels.Count), LabelStyle:KpiLabel, ValueStyle:KpiValue),
            (Column:5, Label:"CHANNELS WITH CPK", Value:new XlFormula(withCpkF, channels.Count - counts[3]), LabelStyle:KpiGoodLabel, ValueStyle:KpiGoodValue),
            (Column:9, Label:"WARNING / BELOW TARGET", Value:new XlFormula($"{StatusF("Warning")}+{StatusF("Below Target")}", counts[1] + counts[2]), LabelStyle:KpiWarnLabel, ValueStyle:KpiWarnValue),
            (Column:13, Label:"NO CPK RESULT / N/A", Value:new XlFormula($"{totalF}-{withCpkF}", counts[3]), LabelStyle:KpiNaLabel, ValueStyle:KpiNaValue)
        };
        foreach (var card in cards)
        {
            Range(5, card.Column, 5, card.Column + 2, card.Label, card.LabelStyle);
            Range(6, card.Column, 7, card.Column + 2, card.Value, card.ValueStyle);
        }

        Range(9, 1, 9, 7, "CPK STATUS DISTRIBUTION", Section);
        Range(9, 8, 9, 15, "CHANNEL STATUS BY LINE", Section);
        Range(11, 1, 11, 5, "STATUS", 1);
        Range(11, 6, 11, 7, "CHANNELS", 1);
        var stateStyles = new[] { GoodText, WarningText, BadText, Unavailable };
        var stateFormulas = new[] { StatusF("Good"), StatusF("Warning"), StatusF("Below Target"), $"{totalF}-{withCpkF}" };
        for (var i = 0; i < StateNames.Length; i++)
        {
            var row = 12 + i;
            Range(row, 1, row, 5, StateNames[i], stateStyles[i]);
            Range(row, 6, row, 7, new XlFormula(stateFormulas[i], counts[i]), Unavailable);
        }

        Range(11, 8, 11, 10, "LINE", 1);
        Range(11, 11, 11, 11, "GOOD", 1);
        Range(11, 12, 11, 12, "WARNING", 1);
        Range(11, 13, 11, 14, "BELOW TARGET", 1);
        Range(11, 15, 11, 15, "N/A", 1);
        var visibleGroups = groups.Take(16).ToList();
        if (visibleGroups.Count == 0) Range(12, 8, 12, 15, "No line data", Unavailable);
        for (var i = 0; i < visibleGroups.Count; i++)
        {
            var row = 12 + i;
            var basic = i % 2 == 1 ? 2 : 0;
            string ByLine(string status) =>
                $"COUNTIFS({Ch(ChLine)},$H{row},{Ch(ChStatus)},\"{status}\")";
            var c = visibleGroups[i].Counts;
            Range(row, 8, row, 10, visibleGroups[i].Line, basic);
            Range(row, 11, row, 11, new XlFormula(ByLine("Good"), c[0]), Unavailable);
            Range(row, 12, row, 12, new XlFormula(ByLine("Warning"), c[1]), Unavailable);
            Range(row, 13, row, 14, new XlFormula(ByLine("Below Target"), c[2]), Unavailable);
            Range(row, 15, row, 15, new XlFormula($"COUNTIF({Ch(ChLine)},$H{row})-K{row}-L{row}-M{row}", c[3]), Unavailable);
        }
        if (groups.Count > visibleGroups.Count)
            Range(28, 8, 28, 15, $"Showing {visibleGroups.Count} of {groups.Count} lines; see Summary for all stations.", Note);

        // Lowest CPK: the k-th smallest CPK (SMALL) and its row in CPK_Channels (MATCH).
        // The matched position is kept in hidden column P so equal CPK values are
        // listed once each: a tie continues the search after the previous match.
        Range(29, 1, 29, 15, "LOWEST CPK CHANNELS  |  Ranked among channels with calculated results", Section);
        var tableColumns = new[] { (1, 2, "Line"), (3, 5, "Station"), (6, 7, "Channel"), (8, 9, "CPK"), (10, 11, "Status"), (12, 15, "Step") };
        foreach (var (first, last, name) in tableColumns) Range(30, first, 30, last, name, 1);
        var lowest = channels.Select((c, index) => (Channel: c, Index: index))
            .Where(x => x.Channel.Analysis?.Cpk != null)
            .OrderBy(x => x.Channel.Analysis!.Cpk).ThenBy(x => x.Index).Take(8).ToList();
        var cpkRange = Ch(ChCpk);
        for (var k = 1; k <= 8; k++)
        {
            var row = 30 + k;
            var smallest = $"SMALL({cpkRange},{k})";
            var position = k == 1
                ? $"IFERROR(MATCH({smallest},{cpkRange},0),\"\")"
                : $"IFERROR(IF({smallest}=SMALL({cpkRange},{k - 1}),$P{row - 1}+MATCH({smallest},INDEX({cpkRange},$P{row - 1}+1):CPK_Channels!${ChCpk}${ranges.ChannelLastRow},0),MATCH({smallest},{cpkRange},0)),\"\")";
            var entry = k <= lowest.Count ? lowest[k - 1] : default;
            Put(row, 16, new XlFormula(position, entry.Channel != null ? entry.Index + 1 : ""), Canvas);
            string Lookup(string column) => $"IFERROR(INDEX({Ch(column)},$P{row}),\"\")";
            var c = entry.Channel;
            var basic = k % 2 == 1 ? 0 : 2;
            var wrap = k % 2 == 1 ? Wrap : WrapAlternate;
            var cpk = c?.Analysis?.Cpk;
            var stateStyle = basic;   // coloured by conditional formatting
            var statusStyle = basic;
            Range(row, 1, row, 2, new XlFormula(Lookup(ChLine), c?.Station.Line ?? ""), basic);
            Range(row, 3, row, 5, new XlFormula(Lookup(ChStation), c?.Station.Station ?? ""), wrap);
            Range(row, 6, row, 7, new XlFormula(Lookup(ChChannel), c?.Channel ?? ""), wrap);
            Range(row, 8, row, 9, new XlFormula(Lookup(ChCpk), (object?)cpk ?? ""), stateStyle);
            Range(row, 10, row, 11, new XlFormula(Lookup(ChStatus), c != null ? Status(c) : ""), statusStyle);
            Range(row, 12, row, 15, new XlFormula(Lookup(ChStepName), c?.StepName ?? ""), wrap);
        }

        Range(40, 1, 40, 7, "DATA COVERAGE", Section);
        Range(40, 8, 40, 15, "HOW TO READ THIS REPORT", Section);
        var notes = new[] {
            (new XlFormula($"{withCpkF}&\" channels with a calculated CPK\"", $"{channels.Count - counts[3]} channels with a calculated CPK"),
                "Good: CPK >= 1.33", GoodText),
            (new XlFormula($"{StatusF("Insufficient data")}&\" channels with fewer than 30 samples\"",
                $"{channels.Count(c => Status(c) == "Insufficient data")} channels with fewer than 30 samples"),
                "Warning: 1.00 <= CPK < 1.33", WarningText),
            (new XlFormula($"{StatusF("No measurement data")}&\" channels without measurement data\"",
                $"{channels.Count(c => Status(c) == "No measurement data")} channels without measurement data"),
                "Below Target: CPK < 1.00", BadText),
            (new XlFormula($"{StatusF("Specification limits missing")}&\" channels without specification limits\"",
                $"{channels.Count(c => Status(c) == "Specification limits missing")} channels without specification limits"),
                "N/A: not calculable; see the Status column in CPK_Channels", Unavailable),
            (new XlFormula($"{stationsF}&\" stations / \"&{totalF}&\" channels\"", $"{stations.Count} stations / {channels.Count} channels"),
                "All totals are formulas over CPK_Channels", Bold)
        };
        for (var i = 0; i < notes.Length; i++)
        {
            Range(41 + i, 1, 41 + i, 7, notes[i].Item1, Note);
            Range(41 + i, 8, 41 + i, 15, notes[i].Item2, notes[i].Item3);
        }
        Range(47, 1, 47, 15, "SCOPE / All channels on the CPK page. Each CPK uses the latest 50 OK samples of its Channel, Job and Step (at least 30 samples).", Note);
        Range(48, 1, 48, 15, "SELECTION / For each Channel the step with the highest CPK among recently tested Jobs is reported.", Note);
        Range(49, 1, 49, 15, "NAVIGATION / Tables have filters and frozen identity columns. Use the links below to open the detail sheets.", Note);
        Range(51, 1, 51, 5, "Station CPK Overview", Link);
        Range(51, 6, 51, 10, "Station Summary", Link);
        Range(51, 11, 51, 15, "Channel Details", Link);

        const int lastRow = 51;
        var rowHeights = Enumerable.Range(1, lastRow).ToDictionary(row => row,
            row => row is 1 or 2 ? 30d : row is 4 or 8 or 10 or 28 or 39 or 46 or 50 ? 8
                : row is >= 11 and <= 27 ? 24 : row is >= 31 and <= 38 ? 32 : row is 6 or 7 ? 32 : 28);
        foreach (var block in blocks)
        {
            var font = DashboardFont(block.Style);
            var available = (block.LastColumn - block.Column + 1) * ColumnPixels(DashboardColumnWidth) - 24;
            var needed = WrappedLines(CellText(block.Value), available, font.Size, font.Bold) * font.Size * 1.55 + 12;
            var actual = Enumerable.Range(block.Row, block.LastRow - block.Row + 1).Sum(row => rowHeights[row]);
            if (needed > actual)
                foreach (var row in Enumerable.Range(block.Row, block.LastRow - block.Row + 1))
                    rowHeights[row] += (needed - actual) / (block.LastRow - block.Row + 1);
        }
        using (var stream = zip.CreateEntry("xl/worksheets/sheet4.xml").Open())
        using (var xml = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false) }))
        {
            xml.WriteStartDocument(); xml.WriteStartElement("worksheet", MainNs);
            WriteSheetProperties(xml, "7C3AED");
            xml.WriteStartElement("dimension"); xml.WriteAttributeString("ref", $"A1:P{lastRow}"); xml.WriteEndElement();
            xml.WriteStartElement("sheetViews"); xml.WriteStartElement("sheetView");
            xml.WriteAttributeString("workbookViewId", "0"); xml.WriteAttributeString("showGridLines", "0");
            xml.WriteAttributeString("tabSelected", "1"); xml.WriteAttributeString("zoomScale", "80");
            xml.WriteEndElement(); xml.WriteEndElement();
            xml.WriteStartElement("sheetFormatPr"); xml.WriteAttributeString("defaultRowHeight", "24");
            xml.WriteAttributeString("defaultColWidth", DashboardColumnWidth.ToString(CultureInfo.InvariantCulture)); xml.WriteEndElement();
            xml.WriteStartElement("cols");
            xml.WriteStartElement("col"); xml.WriteAttributeString("min", "1"); xml.WriteAttributeString("max", "15"); xml.WriteAttributeString("width", DashboardColumnWidth.ToString(CultureInfo.InvariantCulture)); xml.WriteAttributeString("customWidth", "1"); xml.WriteEndElement();
            // P: helper for the Lowest CPK lookup (row position in CPK_Channels), hidden.
            xml.WriteStartElement("col"); xml.WriteAttributeString("min", "16"); xml.WriteAttributeString("max", "16"); xml.WriteAttributeString("width", "8"); xml.WriteAttributeString("hidden", "1"); xml.WriteAttributeString("customWidth", "1"); xml.WriteEndElement();
            xml.WriteEndElement();
            xml.WriteStartElement("sheetData");
            for (var row = 1; row <= lastRow; row++)
            {
                var values = new object?[16];
                for (var col = 1; col <= 16; col++)
                    values[col - 1] = cells.TryGetValue((row, col), out var cell) ? cell.Value : col == 16 ? null : "";
                WriteRow(xml, row, values, style: (col, _) => cells.TryGetValue((row, col), out var cell) ? cell.Style : Canvas,
                    height: rowHeights[row]);
            }
            xml.WriteEndElement();
            xml.WriteStartElement("mergeCells"); xml.WriteAttributeString("count", merges.Count.ToString(CultureInfo.InvariantCulture));
            foreach (var merge in merges) { xml.WriteStartElement("mergeCell"); xml.WriteAttributeString("ref", merge); xml.WriteEndElement(); }
            xml.WriteEndElement();
            // Lowest CPK rows change with the data, so their colours are rule-based too.
            WriteConditionalFormats(xml, new[] { ("H31:H38", CpkRules("H31")), ("J31:J38", StatusRules("J31")) });
            // Counts are coloured by their category only while they are above zero.
            var lastLineRow = 11 + Math.Max(1, visibleGroups.Count);
            WriteConditionalFormats(xml, new[] {
                ("F12", CountRule("F12", CountGoodDxf)), ("F13", CountRule("F13", CountWarningDxf)),
                ("F14", CountRule("F14", CountBadDxf)), ("F15", CountRule("F15", CountNaDxf)),
                ($"K12:K{lastLineRow}", CountRule("K12", CountGoodDxf)),
                ($"L12:L{lastLineRow}", CountRule("L12", CountWarningDxf)),
                ($"M12:M{lastLineRow}", CountRule("M12", CountBadDxf)),
                ($"O12:O{lastLineRow}", CountRule("O12", CountNaDxf)) });
            xml.WriteStartElement("hyperlinks");
            foreach (var link in new[] { ("A51", "CPK_Overview"), ("F51", "Summary"), ("K51", "CPK_Channels") })
            {
                xml.WriteStartElement("hyperlink"); xml.WriteAttributeString("ref", link.Item1);
                xml.WriteAttributeString("location", $"'{link.Item2}'!A1"); xml.WriteEndElement();
            }
            xml.WriteEndElement();
            WritePrintSettings(xml, dashboard: true);
            xml.WriteEndElement(); xml.WriteEndDocument();
        }
    }
}
