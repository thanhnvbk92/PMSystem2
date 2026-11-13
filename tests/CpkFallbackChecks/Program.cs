using System.Globalization;
using System.Text.Json;
using System.IO.Compression;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;

// Run against the configured local PostgreSQL database. Every fixture and
// service cache write stays inside a transaction that is rolled back.
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);
var root = new DirectoryInfo(Directory.GetCurrentDirectory());
while (root != null && !File.Exists(Path.Combine(root.FullName, "backend", "appsettings.json")))
    root = root.Parent;
if (root == null) throw new InvalidOperationException("Run from the repository checkout.");
var settingsPath = Path.Combine(root.FullName, "backend", "appsettings.Local.json");
using var settings = JsonDocument.Parse(await File.ReadAllTextAsync(settingsPath));
var connection = settings.RootElement.GetProperty("ConnectionStrings").GetProperty("DefaultConnection").GetString();
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseNpgsql(connection, postgres => postgres.EnableRetryOnFailure()).Options;
var now = DateTime.UtcNow;
var month = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
var older = month.AddDays(-2);
var count = 0;

CheckWorkbook();
if (args.Contains("--export-report"))
{
    await using var db = new AppDbContext(options);
    using var memory = new MemoryCache(new MemoryCacheOptions());
    var service = new PcbService(db, null!, null!, NullLogger<PcbService>.Instance, memory);
    var bytes = await service.GetCpkReportAsync();
    var target = Path.Combine(root.FullName, "backend", "bin", "CpkReportQa", "CPK_Report_All.xlsx");
    Directory.CreateDirectory(Path.GetDirectoryName(target)!);
    await File.WriteAllBytesAsync(target, bytes);
    Console.WriteLine($"PASS: live CPK workbook exported to {target} ({bytes.Length} bytes).");
    return;
}

await Check("50 current-month samples take priority over older data", async f =>
{
    f.AddMeasurements(50, month.AddMinutes(1), "current");
    f.AddMeasurements(50, older, "older");
    var result = await f.Analyze();
    Require(result.SampleCount == 50 && result.Cpk != null && !result.IsHistorical, "Expected a current study.");
    Require(result.Points.All(p => p.Pid.Contains("current")), "Older data leaked into a complete current study.");
});

await Check("49 current samples are completed with the latest older sample", async f =>
{
    f.AddMeasurements(49, month.AddMinutes(1), "current");
    f.AddMeasurements(50, older, "older");
    var result = await f.Analyze();
    Require(result.SampleCount == 50 && result.Cpk != null && result.IsHistorical, "Expected historical fallback at 49 samples.");
    Require(result.Points.Count(p => p.Pid.Contains("current")) == 49, "Current samples were discarded.");
    Require(result.Points.Single(p => p.Pid.Contains("older")).Pid.EndsWith("_49"), "Expected the most recent older sample.");
    Require(result.FromDate < month, "Historical period is missing.");
});

await Check("zero current samples use 50 older matching OK/PASS measurements", async f =>
{
    f.AddMeasurements(50, older, "older");
    f.AddMeasurements(20, month.AddMinutes(1), "wrong-job", job: f.Job + "-other");
    f.AddMeasurements(20, month.AddMinutes(1), "wrong-step", step: f.Step + 1);
    f.AddMeasurements(20, month.AddMinutes(1), "ng", result: "NG");
    var result = await f.Analyze();
    Require(result.SampleCount == 50 && result.IsHistorical && result.Cpk != null, "Expected older data.");
    Require(result.Points.All(p => p.Pid.Contains("older")), "Mismatched job, step, or NG samples were included.");
    var overview = (await f.Service.GetCpkOverviewAsync()).Single(r => r.ChannelId == f.Channel && r.JobFile == f.Job);
    Require(overview.Cpk == result.Cpk && overview.IsHistorical,
        "Overview ignored the historical result calculated before the daily snapshot.");
});

await Check("a complete history study survives a newer empty or partial snapshot", async f =>
{
    f.AddHistory(older, DateOnly.FromDateTime(older), 50, 1.75);
    f.AddHistory(month, DateOnly.FromDateTime(month), 12, 0.5);
    for (var i = 0; i < 50; i++) f.Db.RawCpk.Add(new RawCpk {
        ChannelId = f.Channel, JobFile = f.Job, StepNumber = f.Step, StepName = f.Name,
        CalculationDate = DateOnly.FromDateTime(older), InspectTime = older.AddSeconds(i),
        Value = 10 + i * 0.01, SpecMin = 0, SpecMax = 20
    });
    var result = await f.Analyze();
    Require(result.SampleCount == 50 && result.Cpk == 1.75 && result.IsHistorical, "Detail lost the complete history study.");
    Require(result.Points.Count == 50, "Historical chart measurements are missing.");
    var overview = (await f.Service.GetCpkOverviewAsync()).Single(r => r.ChannelId == f.Channel && r.JobFile == f.Job);
    Require(overview.Cpk == result.Cpk && overview.IsHistorical && overview.FromDate == result.FromDate,
        "Overview and detail disagree about historical data.");
});

await Check("older monthly cache works when daily history is absent", async f =>
{
    f.Db.CpkResultCache.Add(new CpkResultCache {
        ChannelId = f.Channel, JobFile = f.Job, StepNumber = f.Step, StepName = f.Name,
        FromDate = older, SampleCount = 50, Cpk = 2.25, StandardDeviation = 0.1,
        SpecMin = 0, SpecMax = 20, Mean = 10
    });
    var result = await f.Analyze();
    Require(result.Cpk == 2.25 && result.IsHistorical, "Expected fallback to monthly cache.");
});

await Check("a partial current cache does not hide newly available complete current data", async f =>
{
    f.Db.CpkResultCache.Add(new CpkResultCache {
        ChannelId = f.Channel, JobFile = f.Job, StepNumber = f.Step, StepName = f.Name,
        FromDate = month, SampleCount = 12, Cpk = 0.1
    });
    f.AddMeasurements(50, month.AddMinutes(1), "current");
    var result = await f.Analyze();
    Require(result.SampleCount == 50 && !result.IsHistorical && result.Cpk != 0.1,
        "The incomplete cache blocked the current study.");
});

await Check("no matching current or historical data remains unavailable", async f =>
{
    var result = await f.Analyze();
    Require(result.SampleCount == 0 && result.Cpk == null && !result.IsHistorical,
        "Missing data was replaced with an invented result.");
});

Console.WriteLine($"PASS: {count} CPK fallback checks; all fixtures rolled back.");

async Task Check(string name, Func<Fixture, Task> run)
{
    await using var db = new AppDbContext(options);
    await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
    {
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync();
        using var memory = new MemoryCache(new MemoryCacheOptions());
        try
        {
            var channel = await db.Channels.AsNoTracking().OrderByDescending(c => c.Id).FirstAsync();
            var fixture = new Fixture(db, new PcbService(db, null!, null!, NullLogger<PcbService>.Instance, memory),
                channel.Id, channel.StationId);
            await run(fixture);
        }
        finally { await transaction.RollbackAsync(); }
    });
    count++;
    Console.WriteLine($"PASS: {name}");
}

static void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static void CheckWorkbook()
{
    var current = DateTime.UtcNow;
    var station = new CpkReportStation(1, "Line & A", 10, "Station <A> " + new string('W', 80), "Validation Model");
    var emptyStation = new CpkReportStation(1, "Line & A", 11, "Empty Station", null);
    var analysis = new CpkCacheOverviewDto(1, "A.JOB", 3, "Voltage", 2, 0, 20, 10, 0.1,
        2, 2, 2, current, current.AddMonths(-1), true);
    var channels = new[] {
        new CpkReportChannel(station, 1, "Channel " + new string('W', 90), "JOB_" + new string('W', 90) + ".JOB", 3,
            "Measurement\n" + new string('W', 85), true, analysis,
            new[] { new CpkPointDto("001234", current, 0), new CpkPointDto("=1+1", current, 10.1234567890123) }),
        new CpkReportChannel(station, 2, "Jig 3", null, null, null, false, null, Array.Empty<CpkPointDto>()),
        new CpkReportChannel(station, 3, "Jig 2", "A.JOB", 3, "Voltage", true,
            analysis with { ChannelId = 3, SampleCount = 0, Cpk = null }, Array.Empty<CpkPointDto>()),
        new CpkReportChannel(station, 4, "Jig 10", "A.JOB", 3, "Voltage", true,
            analysis with { ChannelId = 4 }, Array.Empty<CpkPointDto>())
    };
    var bytes = CpkReportWorkbook.Build(new[] { station, emptyStation }, channels);
    using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
    XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    XDocument Read(string path) { using var stream = zip.GetEntry(path)!.Open(); return XDocument.Load(stream); }
    var workbook = Read("xl/workbook.xml");
    Require(workbook.Descendants(ns + "sheet").Count() == 5, "Expected dashboard, station matrix, and three data worksheets.");
    Require((string?)workbook.Descendants(ns + "sheet").First().Attribute("name") == "Dashboard", "Dashboard must open first.");
    var summary = Read("xl/worksheets/sheet1.xml");
    var overview = Read("xl/worksheets/sheet2.xml");
    var raw = Read("xl/worksheets/sheet3.xml");
    var dashboard = Read("xl/worksheets/sheet4.xml");
    var matrix = Read("xl/worksheets/sheet5.xml");
    Require(summary.Descendants(ns + "row").Count() == 3, "Stations without Channels were omitted.");
    Require(overview.Descendants(ns + "row").Count() == 5, "N/A or missing-raw Channels were omitted.");
    Require(raw.Descendants(ns + "row").Count() == 3, "Raw sample count is incorrect.");
    string? Cell(XDocument doc, string name) => doc.Descendants(ns + "c")
        .First(c => (string?)c.Attribute("r") == name).Value;
    string ColumnFor(XDocument doc, string header) => new string(doc.Descendants(ns + "row").First()
        .Elements(ns + "c").Single(c => c.Value == header).Attribute("r")!.Value.TakeWhile(char.IsLetter).ToArray());
    string? Field(XDocument doc, string header, int row) => Cell(doc, ColumnFor(doc, header) + row);
    Require(Field(raw, "PID", 2) == "001234", "PID leading zeroes were lost.");
    Require(Field(raw, "PID", 3) == "=1+1" && !raw.Descendants(ns + "f").Any(), "Text was converted to an Excel formula.");
    Require(Field(raw, "Value", 2) == "0", "Zero-valued measurements were lost.");
    Require(Field(raw, "Value", 3) == "10.1234567890123", "Raw measurement precision was rounded.");
    Require(Field(overview, "CPK", 3) == "N/A", "Unconfigured CPK should stay N/A.");
    Require(Field(overview, "Raw Data Status", 5) == "Raw data unavailable", "Missing raw data should be explicit.");
    Require(Field(summary, "Channels", 2) == "4" || Field(summary, "Channels", 3) == "4", "Summary does not include all Channels.");
    Require(Cell(dashboard, "A6") == "4" && Cell(dashboard, "E6") == "2" && Cell(dashboard, "M6") == "2",
        "Dashboard KPI counts do not match the detailed data.");
    Require(dashboard.Descendants(ns + "mergeCell").Any() && dashboard.Descendants(ns + "hyperlink").Count() == 4,
        "Dashboard layout or sheet navigation is missing.");
    Require(overview.Descendants(ns + "cfRule").Count() == 3, "CPK conditional colors are missing.");
    Require((string?)overview.Descendants(ns + "pane").Single().Attribute("topLeftCell") == "D2",
        "Channel identity columns should stay visible while scrolling.");
    Require(ColumnFor(overview, "CPK") == "D" && ColumnFor(raw, "Value") == "F",
        "The primary result columns should be next to channel identity.");
    foreach (var sheet in new[] { summary, overview, raw })
        Require(sheet.Descendants(ns + "row").Skip(1).Max(row => (double?)row.Attribute("ht") ?? 0) > 45,
            "Long source text must expand row height on every data sheet.");
    Require((string?)workbook.Descendants(ns + "sheet").ElementAt(1).Attribute("name") == "CPK_Overview",
        "The station matrix must appear immediately after Dashboard.");
    Require((string?)workbook.Descendants(ns + "sheet").ElementAt(2).Attribute("name") == "Summary",
        "The summary sheet name must be English.");
    Require(Cell(dashboard, "A1") == "CPK QUALITY REPORT", "The dashboard title must be English.");
    Require((string?)matrix.Descendants(ns + "pane").Single().Attribute("topLeftCell") == "B6",
        "The station matrix must freeze station labels and column headings.");
    var machineCells = matrix.Descendants(ns + "c").Where(c => c.Value.Contains("\nCPK:")).ToList();
    Require(machineCells.Count == 4, "Every channel must appear once in the horizontal station matrix.");
    Require(machineCells.Select(c => c.Value.Contains("[#1]") ? 1 : c.Value.Contains("[#2]") ? 2
        : c.Value.Contains("[#3]") ? 3 : 4).SequenceEqual(new[] { 1, 3, 2, 4 }),
        "Machine labels must use natural ordering (Jig 2 before Jig 10).");
    Require(machineCells.Select(c => c.Attribute("r")!.Value.TrimEnd('0','1','2','3','4','5','6','7','8','9'))
        .SequenceEqual(new[] { "B", "C", "D", "E" }), "Machines must occupy columns across one station row.");
    Require(machineCells.All(c => c.Attribute("r")!.Value[1..] == machineCells[0].Attribute("r")!.Value[1..]),
        "A station's machines must stay on the same row.");
    Require(machineCells.First().Value.Contains("CPK: 2.000") && machineCells.First().Value.Contains("Historical"),
        "Matrix cells must include the CPK and historical-data flag.");
    Require(matrix.Descendants(ns + "c").Any(c => c.Value == "No machines configured"),
        "Stations without channels must remain in the overview.");
    XNamespace chartNs = "http://schemas.openxmlformats.org/drawingml/2006/chart";
    Require(Read("xl/charts/chart1.xml").Descendants(chartNs + "doughnutChart").Count() == 1,
        "Status doughnut chart is missing.");
    Require(Read("xl/charts/chart2.xml").Descendants(chartNs + "barChart").Count() == 1,
        "Line comparison chart is missing.");
    Require((string?)raw.Descendants(ns + "c").First(c => (string?)c.Attribute("r") == ColumnFor(raw, "Value") + "3").Attribute("s") is "0" or "2",
        "Raw measurements must keep an unrounded number format.");
    using (var emptyZip = new ZipArchive(new MemoryStream(CpkReportWorkbook.Build(Array.Empty<CpkReportStation>(), Array.Empty<CpkReportChannel>()))))
        Require(emptyZip.GetEntry("xl/charts/chart2.xml") != null, "Empty reports must still have a valid dashboard.");
    foreach (var entry in zip.Entries)
    {
        using var stream = entry.Open();
        XDocument.Load(stream);
    }
    var fixturePath = Path.Combine(Directory.GetCurrentDirectory(), "backend", "bin", "CpkReportQa", "CPK_Layout_Fixture.xlsx");
    Directory.CreateDirectory(Path.GetDirectoryName(fixturePath)!);
    File.WriteAllBytes(fixturePath, bytes);
    Console.WriteLine("PASS: dashboard KPIs, native charts, conditional colors, frozen columns, N/A, raw precision, and empty reports.");
}

sealed class Fixture(AppDbContext db, PcbService service, int channel, int station)
{
    public AppDbContext Db => db;
    public PcbService Service => service;
    public int Channel => channel;
    public int Step => 99999;
    public string Name => "CPK fallback regression";
    public string Job { get; } = "cpk-check-" + Guid.NewGuid().ToString("N");

    public void AddMeasurements(int count, DateTime start, string prefix, string? job = null, int? step = null, string result = "OK")
    {
        for (var i = 0; i < count; i++)
        {
            var pcb = new PcbResult {
                ChannelId = channel, StationId = station, JobFile = job ?? Job,
                Pid = $"{Job}-{prefix}_{i}", Result = result,
                InspectTime = start.AddSeconds(i), StartTime = start.AddSeconds(i),
                TestSteps = new List<TestStep> { new() {
                    StepNumber = step ?? Step, StepName = Name,
                    Value = (10 + i * 0.01).ToString(CultureInfo.InvariantCulture),
                    SpecMin = "0", SpecMax = "20", Result = result
                } }
            };
            db.PcbResults.Add(pcb);
        }
    }

    public void AddHistory(DateTime period, DateOnly date, int samples, double? cpk)
    {
        db.CpkResultHistory.Add(new CpkResultHistory {
            ChannelId = channel, StationId = station, JobFile = Job,
            StepNumber = Step, StepName = Name, PeriodStart = period,
            PeriodEnd = period.AddDays(1), CalculationDate = date,
            SampleCount = samples, Cpk = cpk, StandardDeviation = 0.1,
            SpecMin = 0, SpecMax = 20, Mean = 10
        });
    }

    public async Task<CpkAnalysisDto> Analyze()
    {
        await db.SaveChangesAsync();
        return await service.GetCpkAnalysisAsync(channel, Step, Name, Job);
    }
}
