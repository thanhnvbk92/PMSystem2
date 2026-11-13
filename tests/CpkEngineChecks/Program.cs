// Console checks for the incremental CPK engine (no database needed).
// Run: dotnet run --project tests/CpkEngineChecks
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services.Cpk;

// --csv-export <out.csv> <pid>: run the server CSV export against the live database (read only).
if (args.Length >= 3 && args[0] == "--csv-export")
{
    AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);
    var settings = System.Text.Json.JsonDocument.Parse(File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, @"..\..\..\..\..\backend\appsettings.Local.json")));
    var cs = settings.RootElement.GetProperty("ConnectionStrings").EnumerateObject().First().Value.GetString()!;
    var services = new Microsoft.Extensions.DependencyInjection.ServiceCollection();
    Microsoft.Extensions.DependencyInjection.EntityFrameworkServiceCollectionExtensions.AddDbContext<PMSystem2.Api.Data.AppDbContext>(services, o => o.UseNpgsql(cs));
    using var provider = Microsoft.Extensions.DependencyInjection.ServiceCollectionContainerBuilderExtensions.BuildServiceProvider(services);
    var scopeFactory = Microsoft.Extensions.DependencyInjection.ServiceProviderServiceExtensions.GetRequiredService<Microsoft.Extensions.DependencyInjection.IServiceScopeFactory>(provider);
    using var scope = scopeFactory.CreateScope();
    var db = Microsoft.Extensions.DependencyInjection.ServiceProviderServiceExtensions.GetRequiredService<PMSystem2.Api.Data.AppDbContext>(scope.ServiceProvider);
    var master = new PMSystem2.Api.Services.MasterDataService(scopeFactory, NullLogger<PMSystem2.Api.Services.MasterDataService>.Instance);
    await master.GetChannelsAsync();
    var pcbService = new PMSystem2.Api.Services.PcbService(db, master, null!, NullLogger<PMSystem2.Api.Services.PcbService>.Instance,
        new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions()),
        new CpkEngine(Options.Create(new CpkOptions()), NullLogger<CpkEngine>.Instance),
        new PMSystem2.Api.Services.QualitySummaryQueue(NullLogger<PMSystem2.Api.Services.QualitySummaryQueue>.Instance));
    var sw = System.Diagnostics.Stopwatch.StartNew();
    var bytes = args[2] == "--ng-days"
        ? await pcbService.GetExportCsvAsync(resultFilter: "NG", startDate: DateTime.Now.AddDays(-int.Parse(args[3])),
            stationIds: args[4].Split(',').Select(int.Parse).ToList())
        : await pcbService.GetExportCsvAsync(limit: 10, searchPid: args[2]);
    Console.WriteLine($"export took {sw.Elapsed.TotalSeconds:0.0}s, rows {System.Text.Encoding.UTF8.GetString(bytes).Count(c => c == '\n') - 1}");
    File.WriteAllBytes(args[1], bytes);
    Console.WriteLine($"csv written: {args[1]} ({bytes.Length} bytes)");
    return 0;
}

// --real-report <out.xlsx>: build the workbook from the running backend's data (layout check).
if (args.Length >= 2 && args[0] == "--real-report")
{
    using var http = new HttpClient { BaseAddress = new Uri("http://localhost:5000/api/v1/") };
    var json = new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true };
    var stationRows = await http.GetFromJsonAsync<List<System.Text.Json.JsonElement>>("master/stations", json) ?? new();
    var channelRows = await http.GetFromJsonAsync<List<System.Text.Json.JsonElement>>("master/channels", json) ?? new();
    var overviewRows = await http.GetFromJsonAsync<List<CpkCacheOverviewDto>>("production/cpk/overview", json) ?? new();
    var stationList = stationRows.Select(x => new PMSystem2.Api.Services.CpkReportStation(x.GetProperty("lineId").GetInt32(),
        x.GetProperty("lineName").GetString() ?? "", x.GetProperty("id").GetInt32(), x.GetProperty("name").GetString() ?? "",
        x.GetProperty("modelGroupName").GetString())).ToList();
    var stationById = stationList.ToDictionary(x => x.StationId);
    var byChannel = overviewRows.ToDictionary(x => x.ChannelId);
    var list = channelRows.Where(x => stationById.ContainsKey(x.GetProperty("stationId").GetInt32())).Select(x =>
    {
        var id = x.GetProperty("id").GetInt32();
        byChannel.TryGetValue(id, out var a);
        if (a != null) a = a with { Cpk = a.Cpk is double v ? Math.Round(v, 3) : null };
        return new PMSystem2.Api.Services.CpkReportChannel(stationById[x.GetProperty("stationId").GetInt32()], id,
            x.GetProperty("name").GetString() ?? "", a?.JobFile, a?.StepNumber, a?.StepName, a != null, a, Array.Empty<CpkPointDto>());
    }).OrderBy(c => c.Station.Line).ThenBy(c => c.Station.Station).ThenBy(c => c.Channel).ToList();
    File.WriteAllBytes(args[1], PMSystem2.Api.Services.CpkReportWorkbook.Build(stationList, list));
    Console.WriteLine($"real report written: {args[1]} ({list.Count} channels)");
    return 0;
}

int failures = 0;
void Check(bool condition, string name)
{
    Console.WriteLine($"{(condition ? "PASS" : "FAIL")}  {name}");
    if (!condition) failures++;
}
bool Near(double? a, double? b, double tol = 1e-9) =>
    a.HasValue && b.HasValue && Math.Abs(a.Value - b.Value) <= tol * Math.Max(1, Math.Abs(b.Value));

CpkEngine NewEngine(int size = 50, int minSamples = 2) => new(Options.Create(new CpkOptions { SampleSize = size, MinSamples = minSamples, ExactRecomputeEvery = 1000 }),
    NullLogger<CpkEngine>.Instance);

(double Mean, double Std, double Cpk) Direct(IReadOnlyList<double> v, double lsl, double usl)
{
    var mean = v.Average();
    var std = Math.Sqrt(v.Sum(x => (x - mean) * (x - mean)) / (v.Count - 1));
    return (mean, std, Math.Min((mean - lsl) / (3 * std), (usl - mean) / (3 * std)));
}

var t0 = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);
var rng = new Random(42);
var noBroadcast = new Dictionary<int, CpkCacheOverviewDto>();

// 1. Rolling window: 300 samples arriving out of order -> stats equal the
//    direct calculation over the newest 50 by inspect time.
{
    var engine = NewEngine();
    var samples = Enumerable.Range(0, 300)
        .Select(i => (Time: t0.AddMinutes(i), Value: 1.5 + rng.NextDouble() * 0.1, Pid: $"P{i}"))
        .OrderBy(_ => rng.Next()).ToList();
    foreach (var s in samples)
        engine.AddSample(1, 10, "JOB", new CpkStepInput(5, "VOLT", null, s.Value.ToString("R"), "1", "2"), s.Pid, s.Time);
    engine.PublishDirty(noBroadcast);
    var expected = Direct(samples.OrderBy(s => s.Time).TakeLast(50).Select(s => s.Value).ToList(), 1, 2);
    engine.TryGetAnalysis(10, "JOB", 5, "VOLT", out var a);
    Check(a.SampleCount == 50, "rolling window keeps 50 samples");
    Check(Near(a.Mean, expected.Mean) && Near(a.StandardDeviation, expected.Std, 1e-7) && Near(a.Cpk, expected.Cpk, 1e-7),
        "incremental mean/std/cpk match direct calculation");
    Check(a.Points.Select(p => p.InspectTime).SequenceEqual(a.Points.Select(p => p.InspectTime).OrderBy(x => x)),
        "points are sorted by inspect time");
    Check(a.Points[0].InspectTime == t0.AddMinutes(250), "oldest kept sample is the 251st");
}

// 2. Large offset + many updates (running sums must not drift).
{
    var engine = NewEngine();
    var values = new List<double>();
    for (int i = 0; i < 5000; i++)
    {
        var v = 1_000_000 + rng.NextDouble() * 0.001;
        values.Add(v);
        engine.AddSample(1, 11, "J", new CpkStepInput(1, "F", null, v.ToString("R"), "999999.99", "1000000.01"), $"P{i}", t0.AddSeconds(i));
    }
    engine.PublishDirty(noBroadcast);
    var expected = Direct(values.TakeLast(50).ToList(), 999999.99, 1000000.01);
    engine.TryGetAnalysis(11, "J", 1, "F", out var a);
    Check(Near(a.StandardDeviation, expected.Std, 1e-5), $"no drift with large offset (std {a.StandardDeviation:G6} vs {expected.Std:G6})");
}

// 3. Filtering and parsing.
{
    var engine = NewEngine();
    Check(!engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, "1.2", "-", "2"), "P", t0), "non-numeric spec is rejected");
    Check(!engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, "OK", "1", "2"), "P", t0), "non-numeric value is rejected");
    Check(engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, " 1,25 ", "1", "2"), "P1", t0), "comma decimal is accepted");
    Check(!engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, "1.3", "1", "2"), "P1", t0), "same PID + time is a duplicate");
    Check(engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, "1.3", "1", "2"), "P2", t0), "different PID at same time is kept");
    Check(engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, "1.4E0", "1", "2"), "P3", t0.AddSeconds(1)), "scientific notation is accepted");
    Check(!engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, "21.1", "0", "0.1", "FAIL"), "P4", t0.AddSeconds(2)), "FAIL step of an OK PCB is rejected");
    Check(!engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, "1.5", "1", "2", "NG"), "P5", t0.AddSeconds(3)), "NG step is rejected");
    Check(engine.AddSample(1, 12, "J", new CpkStepInput(1, "A", null, "1.5", "1", "2", " pass "), "P6", t0.AddSeconds(4)), "PASS step (any case/spacing) is accepted");
}

// 4. When the window is full, a sample older than all kept ones is ignored.
{
    var engine = NewEngine(5);
    for (int i = 0; i < 5; i++)
        engine.AddSample(1, 13, "J", new CpkStepInput(1, "A", null, $"1.{i}", "1", "2"), $"P{i}", t0.AddMinutes(10 + i));
    Check(!engine.AddSample(1, 13, "J", new CpkStepInput(1, "A", null, "1.9", "1", "2"), "OLD", t0), "older-than-window sample is ignored");
    Check(engine.AddSample(1, 13, "J", new CpkStepInput(1, "A", null, "1.9", "1", "2"), "MID", t0.AddMinutes(12).AddSeconds(30)), "in-between sample is inserted");
    engine.PublishDirty(noBroadcast);
    engine.TryGetAnalysis(13, "J", 1, "A", out var a);
    Check(a.Points.Select(p => p.Pid).SequenceEqual(new[] { "P1", "P2", "MID", "P3", "P4" }), "in-between sample lands in time order, oldest dropped");
}

// 5. Overview picks the best active step; old jobs are ignored; broadcast throttling.
{
    var engine = NewEngine(10);
    void Feed(string job, int step, double spread, DateTime start)
    {
        for (int i = 0; i < 10; i++)
            engine.AddSample(1, 20, job, new CpkStepInput(step, $"S{step}", null,
                (1.5 + (i % 2 == 0 ? spread : -spread)).ToString("R"), "1", "2"), $"{job}{step}{i}", start.AddMinutes(i));
    }
    Feed("OLDJOB", 1, 0.001, t0.AddDays(-30));   // excellent CPK but not run recently
    Feed("NEWJOB", 2, 0.05, t0);                 // good
    Feed("NEWJOB", 3, 0.2, t0);                  // poor
    var last = new Dictionary<int, CpkCacheOverviewDto>();
    var (_, broadcast) = engine.PublishDirty(last);
    var row = engine.GetOverview().Single(r => r.ChannelId == 20);
    Check(row.JobFile == "NEWJOB" && row.StepNumber == 2, $"best active step selected (got {row.JobFile}#{row.StepNumber})");
    Check(broadcast.Count == 1, "first result is broadcast");
    foreach (var r in broadcast) last[r.ChannelId] = r;

    // Tiny change -> not pushed.
    engine.AddSample(1, 20, "NEWJOB", new CpkStepInput(2, "S2", null, "1.5", "1", "2"), "tiny", t0.AddMinutes(20));
    (_, broadcast) = engine.PublishDirty(last);
    var row2 = engine.GetOverview().Single(r => r.ChannelId == 20);
    var expectPush = Math.Abs(row2.Cpk!.Value - row.Cpk!.Value) >= 0.01;
    Check(broadcast.Count == (expectPush ? 1 : 0), $"push only when CPK moves >= 0.01 (delta {row2.Cpk - row.Cpk:F4})");
}

// 6. Restore round-trip keeps statistics.
{
    var engine = NewEngine();
    var values = Enumerable.Range(0, 50).Select(_ => 3 + rng.NextDouble()).ToArray();
    var pids = Enumerable.Range(0, 50).Select(i => $"R{i}").ToArray();
    var times = Enumerable.Range(0, 50).Select(i => t0.AddMinutes(i)).ToArray();
    engine.Restore(new CpkKey(30, "J", 1, "A"), 1, null, 2, 5, values, pids, times);
    engine.RebuildOverview();
    var expected = Direct(values, 2, 5);
    Check(Near(engine.GetOverview().Single(r => r.ChannelId == 30).Cpk, expected.Cpk, 1e-9), "restored key reproduces CPK");
}

// 8. Minimum 30 samples: fewer -> no CPK; a 2-sample key with a huge CPK must
//    not beat a 50-sample key (the Jig 7-1 case).
{
    var engine = NewEngine(50, 30);
    for (int i = 0; i < 29; i++)
        engine.AddSample(1, 40, "J", new CpkStepInput(1, "A", null, (1.5 + (i % 3) * 0.01).ToString("R"), "1", "2"), $"A{i}", t0.AddMinutes(i));
    engine.PublishDirty(noBroadcast);
    engine.TryGetAnalysis(40, "J", 1, "A", out var a29);
    Check(a29.Cpk == null && a29.SampleCount == 29, "29 samples -> no CPK");
    var row29 = engine.GetOverview().Single(r => r.ChannelId == 40);
    Check(row29.Cpk == null && row29.SampleCount == 29, "channel shows 'insufficient samples' row (cpk null, 29 samples)");
    engine.AddSample(1, 40, "J", new CpkStepInput(1, "A", null, "1.51", "1", "2"), "A29", t0.AddMinutes(29));
    engine.PublishDirty(noBroadcast);
    engine.TryGetAnalysis(40, "J", 1, "A", out var a30);
    Check(a30.Cpk != null && a30.SampleCount == 30, "30 samples -> CPK reported");

    // Same channel: new job with only 2 nearly identical samples (huge CPK).
    engine.AddSample(1, 40, "NEWJOB", new CpkStepInput(33, "SLEEP", null, "5.000", "0", "100"), "N1", t0.AddMinutes(40));
    engine.AddSample(1, 40, "NEWJOB", new CpkStepInput(33, "SLEEP", null, "5.001", "0", "100"), "N2", t0.AddMinutes(41));
    engine.PublishDirty(noBroadcast);
    var best = engine.GetOverview().Single(r => r.ChannelId == 40);
    Check(best.JobFile == "J" && best.SampleCount == 30, $"2-sample key is not selected as best (got {best.JobFile}, n={best.SampleCount})");
}

// 7. Throughput: 3 million measurements (one production day) through AddSample.
{
    var engine = NewEngine();
    var sw = System.Diagnostics.Stopwatch.StartNew();
    var valueText = Enumerable.Range(0, 1000).Select(i => (1.5 + i * 1e-4).ToString("R")).ToArray();
    int n = 0;
    for (int pcb = 0; pcb < 300_000; pcb++)
    {
        var ch = pcb % 437;
        var time = t0.AddSeconds(pcb * 0.3);
        for (int step = 0; step < 10; step++, n++)
            engine.AddSample(ch % 50, ch, "JOB", new CpkStepInput(step, $"STEP{step}", null, valueText[n % 1000], "1", "2"), $"P{pcb}", time);
        if (pcb % 3000 == 0) engine.PublishDirty(noBroadcast); // ~ one flush per 10 s at ~300 PCB/10 s
    }
    engine.PublishDirty(noBroadcast);
    sw.Stop();
    Console.WriteLine($"INFO  {n:N0} measurements in {sw.ElapsedMilliseconds:N0} ms CPU on one core ({n / sw.Elapsed.TotalSeconds:N0}/s)");
    Check(sw.Elapsed < TimeSpan.FromSeconds(30), "one production day processes in well under real time");
}

// 10. Retention: an idle Channel keeps its old study (history fallback); a Channel
//     with a fresh CPK drops its idle keys.
{
    var engine = NewEngine(50, 30);
    var now = DateTime.UtcNow;
    var old = now.AddDays(-200);
    void Feed(int channel, string job, DateTime start)
    {
        for (int i = 0; i < 35; i++)
            engine.AddSample(1, channel, job, new CpkStepInput(1, "A", null, (1.5 + (i % 5) * 0.01).ToString("R"), "1", "2"), $"{job}{i}", start.AddMinutes(i));
    }
    Feed(50, "OLDJOB", old);                 // idle Channel: only old data
    Feed(51, "OLDJOB", old);                 // Channel with old + fresh data
    Feed(51, "NEWJOB", now.AddHours(-2));
    engine.PublishDirty(noBroadcast);
    Check(engine.ChannelHasReady(50), "history fallback study counts as a CPK");
    var removed = engine.PruneStale(now.AddDays(-90));
    Check(removed.Count == 1 && removed[0].ChannelId == 51 && removed[0].JobFile == "OLDJOB",
        $"only the idle key of the Channel with fresh data is pruned (removed {removed.Count})");
    var row50 = engine.GetOverview().Single(r => r.ChannelId == 50);
    Check(row50.Cpk != null && row50.LastSampleAt < now.AddDays(-90), "idle Channel still shows its last CPK with its last sample date");
}

// 11. Time zone: a live PCB (wall clock labelled UTC by PcbService) and the same
//     PCB read back from PostgreSQL (DateTime Local) must be the same sample.
{
    var engine = NewEngine(50, 2);
    var wallClock = new DateTime(2026, 11, 5, 10, 51, 5);
    var live = new PcbResult { StationId = 1, ChannelId = 60, Pid = "611HS076849", JobFile = "JOB", Result = "OK",
        InspectTime = DateTime.SpecifyKind(wallClock, DateTimeKind.Utc) };
    live.TestSteps.Add(new TestStep { StepNumber = 104, StepName = "MIC", Value = "0.60", SpecMin = "0.52", SpecMax = "0.84", Result = "OK" });
    engine.Enqueue(live);
    engine.DrainQueue(10);
    var fromDb = DateTime.SpecifyKind(wallClock, DateTimeKind.Local); // how Npgsql returns timestamptz
    var duplicate = engine.AddSample(1, 60, "JOB", new CpkStepInput(104, "MIC", null, "0.60", "0.52", "0.84", "OK"),
        "611HS076849", CpkEngine.ToUtc(fromDb));
    engine.PublishDirty(noBroadcast);
    engine.TryGetAnalysis(60, "JOB", 104, "MIC", out var a);
    var expected = TimeZoneInfo.ConvertTimeToUtc(wallClock, TimeZoneInfo.Local);
    Check(a.Points.Count == 1 && a.Points[0].InspectTime == expected,
        $"live sample time matches the stored time ({a.Points[0].InspectTime:O} vs {expected:O})");
    Check(!duplicate, "same PCB from live upload and database is counted once");
}

// 12. Rebuild keeps previous results visible until new ones exist, then releases them.
{
    var engine = NewEngine(50, 30);
    var values = Enumerable.Range(0, 50).Select(i => 1.5 + (i % 7) * 0.01).ToArray();
    var pids = Enumerable.Range(0, 50).Select(i => $"Q{i}").ToArray();
    var times = Enumerable.Range(0, 50).Select(i => t0.AddMinutes(i)).ToArray();
    engine.LoadPrevious(new[] {
        (new CpkKey(70, "J", 1, "A"), 1, (string?)null, (double?)1, (double?)2, values, pids, times),
        (new CpkKey(71, "J", 1, "A"), 1, (string?)null, (double?)1, (double?)2, values, pids, times) });
    Check(engine.IsRebuilding && engine.GetOverview().Count(r => r.Cpk != null) == 2, "previous results are shown during a rebuild");

    // Channel 70 gets only 5 new samples (no CPK yet) -> still shows the previous CPK, nothing pushed.
    for (int i = 0; i < 5; i++)
        engine.AddSample(1, 70, "J", new CpkStepInput(1, "A", null, "1.55", "1", "2"), $"N{i}", t0.AddDays(1).AddMinutes(i));
    var last = engine.EffectiveOverview().ToDictionary(x => x.Key, x => x.Value);
    var (_, pushed) = engine.PublishDirty(last);
    Check(pushed.Count == 0 && engine.GetOverview().Single(r => r.ChannelId == 70).Cpk != null,
        "a Channel without a new CPK keeps its previous value and is not pushed as N/A");
    Check(engine.TryGetAnalysis(70, "J", 1, "A", out var detail) && detail.SampleCount == 50, "detail uses the previous study meanwhile");

    var changes = engine.EndRebuild();
    Check(!engine.IsRebuilding && changes.Count == 2 && changes.All(c => c.Cpk == null),
        "end of rebuild releases previous results and pushes the Channels that change");
}

// 13. Over-long tester text is fitted to the column; the PID is left untouched.
{
    var options = new Microsoft.EntityFrameworkCore.DbContextOptionsBuilder<PMSystem2.Api.Data.AppDbContext>()
        .UseNpgsql("Host=localhost;Database=none;Username=none;Password=none").Options;
    using var db = new PMSystem2.Api.Data.AppDbContext(options);
    var longPid = new string('P', 120);
    var pcb = new PcbResult { Pid = longPid, Result = "NG", ErrorCode = new string('E', 150), JobFile = "J" };
    pcb.TestSteps.Add(new TestStep { StepName = new string('S', 130), Value = new string('V', 150), SpecMin = "1", SpecMax = "2", Result = "NG" });
    db.PcbResults.Add(pcb);
    typeof(PMSystem2.Api.Data.AppDbContext).GetMethod("FitTesterTextToColumns",
        System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.Invoke(db, null);
    var step = pcb.TestSteps.Single();
    Check(step.Value!.Length == 100 && step.StepName.Length == 100 && pcb.ErrorCode!.Length == 100,
        $"long value / step name / error code are cut to 100 (got {step.Value.Length}/{step.StepName.Length}/{pcb.ErrorCode.Length})");
    Check(pcb.Pid == longPid, "PID is never truncated");
}

// 9. Report workbook: write a sample file for the Python formula checks.
{
    var stations = new List<PMSystem2.Api.Services.CpkReportStation> {
        new(1, "Line 1-1", 10, "Power", "OCU3"), new(1, "Line 1-1", 11, "RF \"5G\"", "OCU3"),
        new(2, "Line 2-1", 20, "FCT", null), new(2, "Line 2-1", 21, "Empty station", "TCU4") };
    var rng2 = new Random(7);
    var reportChannels = new List<PMSystem2.Api.Services.CpkReportChannel>();
    int id = 100;
    foreach (var st in stations.Take(3))
        for (int j = 1; j <= 6; j++)
        {
            double? cpk = (id % 5) switch { 0 => null, 1 => 0.8, 2 => 1.2, _ => Math.Round(1 + rng2.NextDouble() * 4, 3) };
            if (id == 104) cpk = 0.8; // tie with another 0.8
            var analysis = cpk == null && id % 2 == 0 ? null : new CpkCacheOverviewDto(id, "JOB", 33, "STEP", cpk == null ? 12 : 50,
                1, 2, 1.5, 0.05, cpk, cpk, cpk, t0, t0.AddDays(-40 * (id % 2)), id % 2 == 1);
            reportChannels.Add(new(st, id, $"Jig {j}", "JOB", 33, "STEP", analysis != null, analysis, Array.Empty<CpkPointDto>()));
            id++;
        }
    reportChannels = reportChannels.OrderBy(c => c.Station.Line).ThenBy(c => c.Station.Station).ThenBy(c => c.Channel).ToList();
    var bytes = PMSystem2.Api.Services.CpkReportWorkbook.Build(stations, reportChannels);
    var path = Path.Combine(Path.GetTempPath(), "pms2_report_check.xlsx");
    File.WriteAllBytes(path, bytes);
    Console.WriteLine($"INFO  sample report written: {path} ({bytes.Length:N0} bytes)");
    Check(bytes.Length > 0, "report workbook builds");
}

// Upload retry: deadlocks are recognised through EF's DbUpdateException wrapper.
{
    var deadlock = new Npgsql.PostgresException("deadlock detected", "ERROR", "ERROR", "40P01");
    var wrapped = new DbUpdateException("An error occurred while saving the entity changes.", deadlock);
    var unique = new DbUpdateException("save failed", new Npgsql.PostgresException("duplicate key", "ERROR", "ERROR", "23505"));
    Check(PMSystem2.Api.Services.PcbService.IsDeadlock(wrapped) && !PMSystem2.Api.Services.PcbService.IsDeadlock(unique),
        "deadlock (40P01) is detected for the batch retry, unique violation is not");
}

Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : $"{failures} CHECK(S) FAILED");
return failures == 0 ? 0 : 1;
