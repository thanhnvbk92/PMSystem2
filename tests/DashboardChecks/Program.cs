using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;

// Read-only checks of the dashboard data against the configured local PostgreSQL database:
// every number the dashboard shows is compared with an independent SQL count over pcb_results
// or the PID summaries, for "today" (raw table) and "this month" (daily rollup).
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);
var root = new DirectoryInfo(Directory.GetCurrentDirectory());
while (root != null && !File.Exists(Path.Combine(root.FullName, "backend", "appsettings.json")))
    root = root.Parent;
if (root == null) throw new InvalidOperationException("Run from the repository checkout.");
var settingsPath = Path.Combine(root.FullName, "backend", "appsettings.Local.json");
if (args.Length > 0 && File.Exists(args[0])) settingsPath = args[0];
using var settings = JsonDocument.Parse(await File.ReadAllTextAsync(settingsPath));
var connection = settings.RootElement.GetProperty("ConnectionStrings").GetProperty("DefaultConnection").GetString()!;

var services = new ServiceCollection()
    .AddLogging()
    .AddDbContext<AppDbContext>(o => o.UseNpgsql(connection))
    .AddSingleton<IMasterDataService, MasterDataService>()
    .BuildServiceProvider();

// Dashboard periods: factory clock with a UTC marker, as the page sends them.
var now = DateTime.Now;
var todayStart = new DateTime(now.Year, now.Month, now.Day, 0, 0, 0, DateTimeKind.Utc);
var todayEnd = todayStart.AddDays(1).AddMilliseconds(-1);
var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
var monthEnd = monthStart.AddMonths(1).AddMilliseconds(-1);
int failures = 0;

PcbService NewService(IServiceScope scope) => new(scope.ServiceProvider.GetRequiredService<AppDbContext>(),
    scope.ServiceProvider.GetRequiredService<IMasterDataService>(), null!, NullLogger<PcbService>.Instance,
    new MemoryCache(new MemoryCacheOptions()), null!, null!);

async Task<T> Timed<T>(string name, Func<Task<T>> run)
{
    var sw = Stopwatch.StartNew();
    var result = await run();
    Console.WriteLine($"  {name,-34} {sw.Elapsed.TotalSeconds,6:F2} s");
    return result;
}

void Check(bool ok, string message)
{
    Console.WriteLine($"{(ok ? "PASS" : "FAIL")}: {message}");
    if (!ok) failures++;
}

// Same exclusions as PcbService.ExcludeUnassignedModelData.
const string Kept = @"
      (error_code IS NULL OR error_code <> 'DEFECT_UNSPECIFIED')
  AND (error_code IS NULL OR error_code NOT ILIKE '%CHANGE_JOB%')
  AND NOT (job_file IS NOT NULL AND job_file IN (SELECT job_file FROM job_file_model_mappings WHERE model_id = 0))
  AND NOT (model_id = 0 AND (job_file IS NULL OR job_file NOT IN
      (SELECT job_file FROM job_file_model_mappings WHERE model_id IS NOT NULL AND job_file IS NOT NULL)))";
string Ts(DateTime dt) => dt.ToString("yyyy-MM-dd HH:mm:ss.fff") + "+00";

async Task<long[]> Sql(string sql)
{
    await using var conn = new NpgsqlConnection(connection);
    await conn.OpenAsync();
    await using var cmd = new NpgsqlCommand(sql, conn) { CommandTimeout = 600 };
    await using var r = await cmd.ExecuteReaderAsync();
    await r.ReadAsync();
    return Enumerable.Range(0, r.FieldCount).Select(i => r.IsDBNull(i) ? 0L : Convert.ToInt64(r.GetValue(i))).ToArray();
}

Task<long[]> RawCounts(DateTime from, DateTime to) => Sql($@"
    SELECT count(*), count(*) FILTER (WHERE result IN ('OK','PASS')), count(*) FILTER (WHERE result IN ('NG','FAIL'))
    FROM pcb_results WHERE inspect_time >= '{Ts(from)}' AND inspect_time <= '{Ts(to)}' AND {Kept}");
Task<long[]> Cohort(string table, DateTime from, DateTime to) => Sql($@"
    SELECT count(*), count(*) FILTER (WHERE ever_ng) FROM {table}
    WHERE pid <> 'None' AND first_test_time >= '{Ts(from)}' AND first_test_time <= '{Ts(to)}'");

foreach (var (label, from, to) in new[] { ("today", todayStart, todayEnd), ("month", monthStart, monthEnd) })
{
    Console.WriteLine($"\n== {label}: {from:yyyy-MM-dd HH:mm} .. {to:yyyy-MM-dd HH:mm} (factory clock)");
    using var scope = services.CreateScope();
    var service = NewService(scope);
    var counters = await Timed("counters", () => service.GetCountersAsync(null, null, from, to));
    var summary = await Timed("summary", () => service.GetSummaryAsync(null, null, from, to));
    var trend = await Timed("stats/hourly", () => service.GetHourlyStatsAsync(24, null, null, from, to));
    var stationYield = await Timed("stats/station-yield", () => service.GetStationYieldStatsAsync(null, from, to));
    var quality = await Timed("quality-modes", () => service.GetQualityModesAsync(null, null, from, to));
    var worst = await Timed("dashboard/worst", () => service.GetDashboardWorstAsync(null, from, to));
    var raw = await Timed("reference SQL (pcb_results)", () => RawCounts(from, to));

    // The rollup may differ from the fact table by a few rows (rows edited outside the trigger).
    bool Near(long a, long b) => Math.Abs(a - b) <= Math.Max(10, b / 10000);
    Check(Near(counters.TotalInspected, raw[0]) && Near(counters.TotalOk, raw[1]) && Near(counters.TotalNg, raw[2]),
        $"{label} counters {counters.TotalInspected}/{counters.TotalOk}/{counters.TotalNg} = SQL {raw[0]}/{raw[1]}/{raw[2]}");
    Check(summary.TotalInspected == counters.TotalInspected, $"{label} summary total = counters total");
    // Live production keeps inserting between the calls, hence Near() instead of equality.
    Check(Near(trend.Sum(x => x.TotalCount), counters.TotalInspected), $"{label} trend buckets add up to the total ({trend.Sum(x => x.TotalCount)})");
    Check(trend.All(x => x.Bucket >= from && x.Bucket <= to), $"{label} trend buckets lie inside the period");
    Check(Near(stationYield.Sum(x => x.Total), counters.TotalInspected), $"{label} station yields add up to the total ({stationYield.Sum(x => x.Total)})");
    if (trend.Count > 0)
    {
        var first = trend[0];
        var step = label == "today" ? TimeSpan.FromHours(1) : TimeSpan.FromDays(1);
        var bucketRaw = await RawCounts(first.Bucket, first.Bucket.Add(step).AddMilliseconds(-1));
        Check(Near(first.TotalCount, bucketRaw[0]), $"{label} first bucket {first.Bucket:yyyy-MM-dd HH:mm} = {first.TotalCount}, SQL {bucketRaw[0]}");
    }
    var ntf = await Cohort("pcb_ntf_summaries", from, to);
    var rty = await Cohort("pcb_rty_summaries", from, to);
    Check(quality.NtfPcbStations == ntf[0] && quality.NtfNgPcbStations == ntf[1], $"{label} NTF {quality.NtfNgPcbStations}/{quality.NtfPcbStations} = SQL {ntf[1]}/{ntf[0]} ({quality.NtfRate}%)");
    Check(quality.RtyPcbs == rty[0] && quality.RtyStraightThroughPcbs == rty[0] - rty[1], $"{label} RTY {quality.RtyStraightThroughPcbs}/{quality.RtyPcbs} = SQL ({quality.RtyRate}%)");
    Check(quality.RetestAttempts == counters.TotalInspected, $"{label} retest attempts = counters total");

    Check(Near(worst.Total, raw[0]) && Near(worst.Ng, raw[2]), $"{label} worst scope {worst.Ng}/{worst.Total} = SQL NG/total");
    foreach (var (name, list) in new[] { ("stations", worst.Stations), ("jigs", worst.Jigs), ("codes", worst.ErrorCodes), ("models", worst.Models) })
    {
        Check(list.Zip(list.Skip(1)).All(p => p.First.Excess >= p.Second.Excess), $"{label} worst {name} ranked by excess NG");
        foreach (var x in list)
            Console.WriteLine($"    {name,-8} {x.Name,-28} {x.Context,-34} NG {x.Ng,7:N0}/{x.Total,9:N0} {x.NgRate,6:F2}%  excess {x.Excess,8:F0}  recent {x.RecentNgRate,6:F2}% vs {x.BaselineNgRate,6:F2}%{(x.Spike ? "  SPIKE" : "")}");
    }
    foreach (var x in worst.Jigs)
    {
        Console.WriteLine($"    channel  {x.Name} | IP {x.Ip} | {x.StationName} | {x.LineName} | " +
            string.Join("; ", (x.TopErrors ?? new()).Select(e => $"{e.ErrorCode} {e.Ng} ({e.ShareOfItemNg}%)")));
        Check(x.TopErrors != null && x.TopErrors.Sum(e => e.Ng) <= x.Ng && x.TopErrors.Count > 0,
            $"{label} channel {x.Name} top errors are part of its NG");
    }
    Check(worst.Alerts.All(x => x.Spike), $"{label} alerts are spikes ({worst.Alerts.Count})");
    foreach (var x in worst.Alerts)
        Console.WriteLine($"    alert    [{x.Kind}] {x.Name} {x.Context}: {x.RecentNgRate:F2}% on {worst.RecentDay} vs {x.BaselineNgRate:F2}% (7 days)");
}

Console.WriteLine(failures == 0 ? "\nAll dashboard checks passed." : $"\n{failures} dashboard check(s) failed.");
return failures == 0 ? 0 : 1;
