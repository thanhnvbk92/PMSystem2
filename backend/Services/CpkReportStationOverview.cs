using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace PMSystem2.Api.Services;

public static partial class CpkReportWorkbook
{
    private static (int Columns, int Rows) MatrixSize(IReadOnlyList<CpkReportStation> stations,
        IReadOnlyList<CpkReportChannel> channels) => (
            Math.Max(4, channels.GroupBy(c => c.Station.StationId).Select(g => g.Count()).DefaultIfEmpty(0).Max()) + 1,
            Math.Max(6, 5 + stations.Count + stations.Select(s => s.LineId).Distinct().Count() * 2));

    private static void WriteStationOverview(ZipArchive zip, IReadOnlyList<CpkReportStation> stations,
        IReadOnlyList<CpkReportChannel> channels, SheetRanges ranges)
    {
        var size = MatrixSize(stations, channels);
        // Columns are sized so every station label and machine tile fits on its two
        // lines without wrapping: all station rows then share the same compact height.
        var tileTexts = channels.SelectMany(c => new[] { c.Channel ?? "", "CPK: " + (c.Analysis?.Cpk?.ToString("0.000", CultureInfo.InvariantCulture) ?? "N/A") })
            .Append("No machine").Append("MACHINE 99");
        var widths = Enumerable.Repeat(FitWidth(tileTexts, 14, 24), size.Columns).ToArray();
        widths[0] = FitWidth(stations.Select(StationLabel).Append("STATION / MODEL GROUP"), 26, 60);
        var rows = new Dictionary<int, object?[]>();
        var styles = new Dictionary<(int Row, int Column), int>();
        var heights = new Dictionary<int, double>();
        var merges = new List<string>();
        var links = new List<(string Cell, string Location)>();
        var colourRules = new List<(string Sqref, string[] Formulas)>();
        void Banner(int row, object text, int style, double minimumHeight = 28)
        {
            var cells = Enumerable.Repeat<object?>("", size.Columns).ToArray();
            cells[0] = text; rows[row] = cells;
            for (var col = 1; col <= size.Columns; col++) styles[(row, col)] = style;
            merges.Add($"A{row}:{Column(size.Columns)}{row}");
            var face = DashboardFont(style);
            var available = widths.Sum(ColumnPixels) - 24;
            heights[row] = Math.Max(minimumHeight,
                WrappedLines(CellText(text), available, face.Size, face.Bold) * face.Size * 1.55 + 12);
        }
        Banner(1, "CPK STATION OVERVIEW", Title, 48);
        Banner(2, "Grouped by production line. Each station is one row; machines are arranged horizontally.", Subtitle);
        Banner(3, "Select a machine to open its detailed CPK record. Scroll right for additional machines. Empty slots mean no machine.", Note);
        var headers = Enumerable.Range(0, size.Columns).Select(i => (object?)(i == 0 ? "STATION / MODEL GROUP" : $"MACHINE {i}")).ToArray();
        rows[4] = headers; heights[4] = GetRowHeight(headers, widths, header: true);
        for (var col = 1; col <= size.Columns; col++) styles[(4, col)] = 1;
        Banner(5, "COLOR KEY  |  Good: CPK >= 1.33  |  Warning: 1.00 <= CPK < 1.33  |  Below Target: CPK < 1.00  |  N/A: no calculable CPK", Note);

        var channelRows = channels.Select((channel, index) => (channel.ChannelId, Row: index + 2))
            .ToDictionary(item => item.ChannelId, item => item.Row);
        var stationRows = stations.OrderBy(s => s.Line).ThenBy(s => s.Station)
            .Select((station, index) => (station.StationId, Row: index + 2)).ToDictionary(item => item.StationId, item => item.Row);
        var byStation = channels.ToLookup(c => c.Station.StationId);
        var next = 6;
        foreach (var line in stations.GroupBy(s => s.LineId)
            .OrderBy(g => g.First().Line, NaturalLabelComparer.Instance).ThenBy(g => g.Key))
        {
            var lineStations = line.OrderBy(s => s.Station, NaturalLabelComparer.Instance).ThenBy(s => s.StationId).ToList();
            var count = lineStations.Sum(s => byStation[s.StationId].Count());
            var lineName = line.First().Line;
            // Counts come from Summary / CPK_Channels so they follow the source data.
            Banner(next++, new XlFormula(
                XlText(lineName + "  |  ") + $"&COUNTIF({ranges.Sum("A")},{XlText(lineName)})&\" stations  |  \"&COUNTIF({ranges.Ch(ChLine)},{XlText(lineName)})&\" machines\"",
                $"{lineName}  |  {lineStations.Count} stations  |  {count} machines"), Section, 32);
            foreach (var station in lineStations)
            {
                var row = next++;
                var machines = byStation[station.StationId].OrderBy(c => c.Channel, NaturalLabelComparer.Instance)
                    .ThenBy(c => c.ChannelId).ToList();
                var values = Enumerable.Repeat<object?>("", size.Columns).ToArray();
                // Two lines: "Station · Model Group" and the machine count.
                var stationHead = StationLabel(station) + "\n";
                // Line breaks inside a formula string are written as CHAR(10).
                values[0] = new XlFormula(
                    XlText(stationHead).Replace("\n", "\"&CHAR(10)&\"")
                        + $"&COUNTIFS({ranges.Ch(ChLine)},{XlText(station.Line)},{ranges.Ch(ChStation)},{XlText(station.Station)},{ranges.Ch(ChModelGroup)},{XlText(GroupLabel(station.ModelGroup))})&\" machines\"",
                    $"{stationHead}{machines.Count} machines");
                styles[(row, 1)] = Bold;
                links.Add(($"A{row}", $"'Summary'!B{stationRows[station.StationId]}"));
                for (var slot = 0; slot < machines.Count; slot++)
                {
                    var channel = machines[slot];
                    var a = channel.Analysis;
                    var cpk = a?.Cpk?.ToString("0.000", CultureInfo.InvariantCulture) ?? "N/A";
                    // Name and CPK are read from the Channel's row in CPK_Channels.
                    // FIXED() is locale-safe (TEXT() format codes are not).
                    var sourceRow = channelRows[channel.ChannelId];
                    var source = $"CPK_Channels!${ChCpk}${sourceRow}";
                    values[slot + 1] = new XlFormula(
                        $"CPK_Channels!${ChChannel}${sourceRow}&CHAR(10)&\"CPK: \"&IF(ISNUMBER({source}),FIXED({source},3),\"N/A\")",
                        $"{channel.Channel}\nCPK: {cpk}");
                    // Neutral (grey) by default; coloured from the Channel's CPK cell so it
                    // follows edits in CPK_Channels.
                    styles[(row, slot + 2)] = Unavailable;
                    colourRules.Add(($"{Column(slot + 2)}{row}", CpkRules(source)));
                    links.Add(($"{Column(slot + 2)}{row}", $"'CPK_Channels'!C{channelRows[channel.ChannelId]}"));
                }
                if (machines.Count == 0) { values[1] = "No machine"; styles[(row, 2)] = Unavailable; }
                rows[row] = values;
                heights[row] = GetRowHeight(values, widths);
            }
            rows[next] = Enumerable.Repeat<object?>("", size.Columns).ToArray();
            heights[next++] = 10;
        }
        if (stations.Count == 0) Banner(6, "No station data is available.", Unavailable, 48);

        static string StationLabel(CpkReportStation station) =>
            $"{station.Station}{(string.IsNullOrWhiteSpace(station.ModelGroup) ? "" : " · " + station.ModelGroup)}";
        // Smallest width (characters) at which every text stays on one line.
        static double FitWidth(IEnumerable<string> texts, double min, double max)
        {
            var list = texts.ToList();
            for (var width = min; width < max; width++)
                if (list.All(t => WrappedLines(t, Math.Max(24, ColumnPixels(width) - 24), bold: true) == 1)) return width;
            return max;
        }

        using var stream = zip.CreateEntry("xl/worksheets/sheet5.xml").Open();
        using var xml = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false) });
        xml.WriteStartDocument(); xml.WriteStartElement("worksheet", MainNs);
        WriteSheetProperties(xml, "0891B2");
        xml.WriteStartElement("dimension"); xml.WriteAttributeString("ref", $"A1:{Column(size.Columns)}{size.Rows}"); xml.WriteEndElement();
        xml.WriteStartElement("sheetViews"); xml.WriteStartElement("sheetView");
        xml.WriteAttributeString("workbookViewId", "0"); xml.WriteAttributeString("showGridLines", "0"); xml.WriteAttributeString("zoomScale", "85");
        xml.WriteStartElement("pane"); xml.WriteAttributeString("xSplit", "1"); xml.WriteAttributeString("ySplit", "5");
        xml.WriteAttributeString("topLeftCell", "B6"); xml.WriteAttributeString("activePane", "bottomRight"); xml.WriteAttributeString("state", "frozen");
        xml.WriteEndElement(); xml.WriteEndElement(); xml.WriteEndElement();
        xml.WriteStartElement("sheetFormatPr"); xml.WriteAttributeString("defaultRowHeight", "28");
        xml.WriteAttributeString("defaultColWidth", "34"); xml.WriteEndElement();
        xml.WriteStartElement("cols");
        for (var col = 1; col <= widths.Length; col++)
        {
            xml.WriteStartElement("col"); xml.WriteAttributeString("min", col.ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("max", col.ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("width", widths[col - 1].ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("customWidth", "1"); xml.WriteEndElement();
        }
        xml.WriteEndElement();
        xml.WriteStartElement("sheetData");
        foreach (var (row, values) in rows.OrderBy(item => item.Key))
            WriteRow(xml, row, values, style: (col, _) => styles.GetValueOrDefault((row, col), Canvas), height: heights[row]);
        xml.WriteEndElement();
        xml.WriteStartElement("mergeCells"); xml.WriteAttributeString("count", merges.Count.ToString(CultureInfo.InvariantCulture));
        foreach (var merge in merges) { xml.WriteStartElement("mergeCell"); xml.WriteAttributeString("ref", merge); xml.WriteEndElement(); }
        xml.WriteEndElement();
        WriteConditionalFormats(xml, colourRules);
        if (links.Count > 0)
        {
            xml.WriteStartElement("hyperlinks");
            foreach (var link in links)
            {
                xml.WriteStartElement("hyperlink"); xml.WriteAttributeString("ref", link.Cell); xml.WriteAttributeString("location", link.Location); xml.WriteEndElement();
            }
            xml.WriteEndElement();
        }
        WritePrintSettings(xml, dashboard: false, widePages: Math.Max(1, (int)Math.Ceiling(widths.Sum(ColumnPixels) / 1500)));
        xml.WriteEndElement(); xml.WriteEndDocument();
    }

    private sealed class NaturalLabelComparer : IComparer<string>
    {
        public static readonly NaturalLabelComparer Instance = new();
        public int Compare(string? left, string? right)
        {
            var a = Regex.Split(left ?? "", "([0-9]+)");
            var b = Regex.Split(right ?? "", "([0-9]+)");
            for (var i = 0; i < Math.Min(a.Length, b.Length); i++)
            {
                var x = i % 2 == 1 ? a[i].TrimStart('0') : a[i];
                var y = i % 2 == 1 ? b[i].TrimStart('0') : b[i];
                var result = i % 2 == 1 ? x.Length.CompareTo(y.Length) : 0;
                if (result == 0) result = StringComparer.OrdinalIgnoreCase.Compare(x, y);
                if (result != 0) return result;
            }
            return a.Length.CompareTo(b.Length);
        }
    }
}
