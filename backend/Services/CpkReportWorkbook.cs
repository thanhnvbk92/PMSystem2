using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services;

public record CpkReportStation(int LineId, string Line, int StationId, string Station, string? ModelGroup);
public record CpkReportChannel(CpkReportStation Station, int ChannelId, string Channel,
    string? JobFile, int? StepNumber, string? StepName, bool Configured,
    CpkCacheOverviewDto? Analysis, IReadOnlyList<CpkPointDto> Points);

/// <summary>An Excel formula plus the value it evaluates to when the file is written.</summary>
public sealed record XlFormula(string Expression, object? Cached);

// Native Excel cells keep the report readable and filterable. CPK_Channels holds
// the per-Channel data; Dashboard, Summary and CPK_Overview are formulas over it,
// so every total is traceable and recalculates if the Channel rows are edited.
public static partial class CpkReportWorkbook
{
    private const string MainNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private const string RelNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    // CPK_Channels columns used by formulas on the other sheets:
    // A Line, B Station, C Channel, D CPK, E Status, F LSL, G USL,
    // H Model Group, I Job File, J Step Number, K Step Name.
    private const string ChLine = "A", ChStation = "B", ChChannel = "C", ChCpk = "D", ChStatus = "E",
        ChModelGroup = "H", ChStepName = "K";

    /// <summary>
    /// Model Group as written in Summary and CPK_Channels. A blank criterion cell would
    /// be read as 0 by COUNTIFS, so an empty Model Group is written as "-".
    /// </summary>
    private static string GroupLabel(string? modelGroup) => string.IsNullOrWhiteSpace(modelGroup) ? "-" : modelGroup;

    /// <summary>Row ranges of the data sheets that formulas refer to.</summary>
    private sealed record SheetRanges(int ChannelLastRow, int SummaryLastRow)
    {
        public string Ch(string column) => $"CPK_Channels!${column}$2:${column}${ChannelLastRow}";
        public string Sum(string column) => $"Summary!${column}$2:${column}${SummaryLastRow}";
    }

    public static byte[] Build(IReadOnlyList<CpkReportStation> stations, IReadOnlyList<CpkReportChannel> channels)
    {
        var matrixSize = MatrixSize(stations, channels);
        var orderedStations = stations.OrderBy(s => s.Line).ThenBy(s => s.Station).ToList();
        var ranges = new SheetRanges(Math.Max(2, channels.Count + 1), Math.Max(2, orderedStations.Count + 1));

        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteXml(zip, "[Content_Types].xml", """
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                  <Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                </Types>
                """);
            WriteXml(zip, "_rels/.rels", """
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>
                """);
            // fullCalcOnLoad: Excel recalculates every formula when the file opens.
            WriteXml(zip, "xl/workbook.xml", $"""
                <workbook xmlns="{MainNs}" xmlns:r="{RelNs}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>
                  <sheet name="Dashboard" sheetId="4" r:id="rId4"/>
                  <sheet name="CPK_Overview" sheetId="5" r:id="rId6"/>
                  <sheet name="Summary" sheetId="1" r:id="rId1"/>
                  <sheet name="CPK_Channels" sheetId="2" r:id="rId2"/>
                </sheets><definedNames>
                  <definedName name="_xlnm.Print_Area" localSheetId="0">'Dashboard'!$A$1:$O$51</definedName>
                  <definedName name="_xlnm.Print_Area" localSheetId="1">'CPK_Overview'!$A$1:${Column(matrixSize.Columns)}${matrixSize.Rows}</definedName>
                  <definedName name="_xlnm.Print_Titles" localSheetId="1">'CPK_Overview'!$1:$5,'CPK_Overview'!$A:$A</definedName>
                  <definedName name="_xlnm.Print_Titles" localSheetId="2">'Summary'!$1:$1</definedName>
                  <definedName name="_xlnm.Print_Titles" localSheetId="3">'CPK_Channels'!$1:$1</definedName>
                </definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>
                """);
            WriteXml(zip, "xl/_rels/workbook.xml.rels", $"""
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="{RelNs}/worksheet" Target="worksheets/sheet1.xml"/>
                  <Relationship Id="rId2" Type="{RelNs}/worksheet" Target="worksheets/sheet2.xml"/>
                  <Relationship Id="rId4" Type="{RelNs}/worksheet" Target="worksheets/sheet4.xml"/>
                  <Relationship Id="rId5" Type="{RelNs}/styles" Target="styles.xml"/>
                  <Relationship Id="rId6" Type="{RelNs}/worksheet" Target="worksheets/sheet5.xml"/>
                </Relationships>
                """);
            WriteStyles(zip);
            WriteDashboard(zip, orderedStations, channels, ranges);
            WriteStationOverview(zip, stations, channels, ranges);

            // Summary: one row per Station (Line + Station + Model Group identify it);
            // every count is a formula over CPK_Channels.
            var grouped = channels.ToLookup(c => c.Station.StationId);
            WriteSheet(zip, 1, new[] { "Line", "Station", "Model Group", "Channels", "Good (CPK >= 1.33)",
                "Warning (1 <= CPK < 1.33)", "Below Target (CPK < 1)", "N/A", "Station ID" },
                orderedStations.Select((station, index) =>
                {
                    var r = index + 2;
                    var items = grouped[station.StationId].ToList();
                    int CountStatus(string status) => items.Count(c => Status(c) == status);
                    var good = CountStatus("Good"); var warning = CountStatus("Warning"); var below = CountStatus("Below Target");
                    var station3 = $"{ranges.Ch(ChLine)},$A{r},{ranges.Ch(ChStation)},$B{r},{ranges.Ch(ChModelGroup)},$C{r}";
                    string ByStatus(string status) => $"COUNTIFS({station3},{ranges.Ch(ChStatus)},\"{status}\")";
                    return new object?[] { station.Line, station.Station, GroupLabel(station.ModelGroup),
                        new XlFormula($"COUNTIFS({station3})", items.Count),
                        new XlFormula(ByStatus("Good"), good),
                        new XlFormula(ByStatus("Warning"), warning),
                        new XlFormula(ByStatus("Below Target"), below),
                        new XlFormula($"D{r}-E{r}-F{r}-G{r}", items.Count - good - warning - below),
                        station.StationId };
                }));

            // CPK_Channels: the source data for every formula in the workbook.
            WriteSheet(zip, 2, new[] { "Line", "Station", "Channel", "CPK", "Status", "LSL", "USL",
                "Model Group", "Job File", "Step Number", "Step Name" },
                channels.Select((c, index) =>
                {
                    var r = index + 2;
                    var a = c.Analysis;
                    // Status follows the CPK cell; the reason text is used while it is not a number.
                    var reason = a?.Cpk == null ? Status(c) : "N/A";
                    var status = new XlFormula(
                        $"IF(ISNUMBER({ChCpk}{r}),IF({ChCpk}{r}>=1.33,\"Good\",IF({ChCpk}{r}>=1,\"Warning\",\"Below Target\")),{XlText(reason)})",
                        Status(c));
                    return new object?[] { c.Station.Line, c.Station.Station, c.Channel, (object?)a?.Cpk ?? "N/A", status,
                        a?.SpecMin, a?.SpecMax, GroupLabel(c.Station.ModelGroup), c.JobFile, c.StepNumber, c.StepName };
                }));
        }
        return output.ToArray();
    }

    private static string Status(CpkReportChannel channel)
    {
        var a = channel.Analysis;
        if (a == null || a.SampleCount == 0) return "No measurement data";
        if (a.Cpk == null) return !a.SpecMin.HasValue || !a.SpecMax.HasValue
            ? "Specification limits missing" : a.StandardDeviation == 0 ? "Zero standard deviation" : "Insufficient data";
        return a.Cpk >= 1.33 ? "Good" : a.Cpk >= 1 ? "Warning" : "Below Target";
    }

    /// <summary>Quotes text for use as a string literal inside an Excel formula.</summary>
    private static string XlText(string? text) => "\"" + (text ?? "").Replace("\"", "\"\"") + "\"";

    private static void WriteXml(ZipArchive zip, string path, string xml)
    {
        using var writer = new StreamWriter(zip.CreateEntry(path).Open(), new UTF8Encoding(false));
        writer.Write(xml);
    }

    private static void WriteSheet(ZipArchive zip, int id, string[] headers, IEnumerable<object?[]> rows)
    {
        var dataRows = rows.ToList();
        var widths = GetColumnWidths(headers, dataRows);
        using var stream = zip.CreateEntry($"xl/worksheets/sheet{id}.xml").Open();
        using var xml = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false) });
        xml.WriteStartDocument();
        xml.WriteStartElement("worksheet", MainNs);
        WriteSheetProperties(xml, id == 1 ? "2563EB" : "047857");
        xml.WriteStartElement("dimension"); xml.WriteAttributeString("ref", $"A1:{Column(headers.Length)}{dataRows.Count + 1}"); xml.WriteEndElement();
        xml.WriteStartElement("sheetViews");
        xml.WriteStartElement("sheetView"); xml.WriteAttributeString("workbookViewId", "0");
        xml.WriteAttributeString("showGridLines", "0"); xml.WriteAttributeString("zoomScale", "85");
        xml.WriteStartElement("pane"); xml.WriteAttributeString("ySplit", "1");
        var frozenColumns = id == 1 ? 2 : 3;
        xml.WriteAttributeString("xSplit", frozenColumns.ToString(CultureInfo.InvariantCulture));
        xml.WriteAttributeString("topLeftCell", $"{Column(frozenColumns + 1)}2"); xml.WriteAttributeString("activePane", "bottomRight");
        xml.WriteAttributeString("state", "frozen"); xml.WriteEndElement();
        xml.WriteEndElement(); xml.WriteEndElement();
        xml.WriteStartElement("sheetFormatPr"); xml.WriteAttributeString("defaultRowHeight", "24");
        xml.WriteAttributeString("defaultColWidth", "18"); xml.WriteEndElement();
        xml.WriteStartElement("cols");
        for (var i = 0; i < headers.Length; i++)
        {
            xml.WriteStartElement("col");
            xml.WriteAttributeString("min", (i + 1).ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("max", (i + 1).ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("width", widths[i].ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("customWidth", "1"); xml.WriteEndElement();
        }
        xml.WriteEndElement();
        xml.WriteStartElement("sheetData");
        var rowIndex = 1;
        WriteRow(xml, rowIndex, headers.Cast<object?>().ToArray(), header: true,
            height: GetRowHeight(headers.Cast<object?>().ToArray(), widths, header: true));
        foreach (var row in dataRows)
        {
            rowIndex++;
            WriteRow(xml, rowIndex, row, style: (column, value) => TableCellStyle(id, rowIndex, column, value),
                height: id == 2 ? DataRowHeight : GetRowHeight(row, widths));
        }
        xml.WriteEndElement();
        xml.WriteStartElement("autoFilter"); xml.WriteAttributeString("ref", $"A1:{Column(headers.Length)}{rowIndex}");
        xml.WriteEndElement();
        if (dataRows.Count > 0 && id == 2)
            WriteConditionalFormats(xml, new[] {
                ($"{ChCpk}2:{ChCpk}{rowIndex}", CpkRules($"{ChCpk}2")),
                ($"{ChStatus}2:{ChStatus}{rowIndex}", StatusRules($"{ChStatus}2")) });
        WritePrintSettings(xml, dashboard: false);
        xml.WriteEndElement(); xml.WriteEndDocument();
    }

    private static void WriteRow(XmlWriter xml, int index, object?[] cells, bool header = false,
        Func<int, object?, int>? style = null, double? height = null)
    {
        xml.WriteStartElement("row"); xml.WriteAttributeString("r", index.ToString(CultureInfo.InvariantCulture));
        if (height.HasValue)
        {
            xml.WriteAttributeString("ht", height.Value.ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("customHeight", "1");
        }
        for (var i = 0; i < cells.Length; i++)
        {
            var value = cells[i];
            if (value == null) continue;
            var formula = value as XlFormula;
            var shown = formula != null ? formula.Cached : value;
            xml.WriteStartElement("c"); xml.WriteAttributeString("r", $"{Column(i + 1)}{index}");
            xml.WriteAttributeString("s", (header ? 1 : style?.Invoke(i + 1, shown) ?? 0).ToString(CultureInfo.InvariantCulture));
            var numeric = shown is int or long or double or decimal && (shown is not double number || double.IsFinite(number));
            if (formula != null)
            {
                // Formula with its cached result so the value shows before recalculation.
                if (!numeric) xml.WriteAttributeString("t", "str");
                xml.WriteElementString("f", formula.Expression);
                if (shown != null)
                    xml.WriteElementString("v", numeric ? Convert.ToString(shown, CultureInfo.InvariantCulture) : CleanText(CellText(shown)));
            }
            else if (numeric)
            {
                xml.WriteElementString("v", Convert.ToString(value, CultureInfo.InvariantCulture));
            }
            else
            {
                xml.WriteAttributeString("t", "inlineStr"); xml.WriteStartElement("is"); xml.WriteStartElement("t");
                xml.WriteAttributeString("xml", "space", "http://www.w3.org/XML/1998/namespace", "preserve");
                var text = value is DateTime date ? date.ToString("O", CultureInfo.InvariantCulture) : value.ToString() ?? "";
                xml.WriteString(CleanText(text));
                xml.WriteEndElement(); xml.WriteEndElement();
            }
            xml.WriteEndElement();
        }
        xml.WriteEndElement();
    }

    private static string CleanText(string text) =>
        new(text.Where(c => XmlConvert.IsXmlChar(c) || char.IsSurrogate(c)).ToArray());

    private static string Column(int index)
    {
        var name = "";
        for (; index > 0; index = (index - 1) / 26) name = (char)('A' + (index - 1) % 26) + name;
        return name;
    }
}
