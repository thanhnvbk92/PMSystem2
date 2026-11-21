using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services
{
    /// <summary>
    /// Dashboard data for long periods (week / month / year) and the "Worst" panel.
    ///
    /// The dashboard used to scan pcb_results (~3.5 M rows per month) once per card, which made the
    /// month view take 10-60 s. Periods longer than 48 h are now read from the trigger-maintained
    /// daily rollup pcb_analytics_daily (same filters as ExcludeUnassignedModelData), and NTF / RTY
    /// from the PID summaries (cohort of PCBs first tested in the period, as in the NTF report).
    ///
    /// Time convention: the dashboard sends the factory clock with a UTC marker ("2026-11-01T00:00Z"
    /// means 00:00 at the factory, +07). inspect_time / first_test_time hold the real instant (live data is
    /// written in UTC), so raw-table periods are cut at 00:00 +07. Note: pcb_analytics_daily buckets by the
    /// UTC date of inspect_time (its trigger), so rollup days run 07:00 - 07:00 factory time.
    /// </summary>
    public partial class PcbService
    {
        private const int WorstMinVolume = 30;
        private static string? _inspectTimeType;

        /// <summary>Long periods are served from the daily rollup (same threshold as the BI page).</summary>
        private static bool UseDashboardRollup(DateTime? startDate, DateTime? endDate) =>
            startDate.HasValue && endDate.HasValue && (endDate.Value - startDate.Value).TotalHours > 48;

        /// <summary>Factory calendar day of a dashboard bound (its wall-clock value, no conversion).</summary>
        private static DateOnly FactoryDay(DateTime dt) => new(dt.Year, dt.Month, dt.Day);

        private static DateOnly FactoryToday() => FactoryDay(DateTime.Now);

        private static (DateOnly From, DateOnly To) RollupDays(DateTime? startDate, DateTime? endDate) =>
            (startDate.HasValue ? FactoryDay(startDate.Value) : DateOnly.MinValue,
             endDate.HasValue ? FactoryDay(endDate.Value) : DateOnly.MaxValue);

        /// <summary>
        /// pcb_analytics_daily rows with the same exclusions as ExcludeUnassignedModelData
        /// (CHANGE_JOB rows never enter the rollup). The rollup stores a NULL job file as ''
        /// and a NULL model id as 0. Line / station filters use the stored station, like the raw queries.
        /// </summary>
        private async Task<IQueryable<PcbAnalyticsDaily>> DashboardRollupAsync(
            int? lineId, int? stationId, DateOnly fromDay, DateOnly toDay)
        {
            var unassignedJobs = _db.JobFileModelMappings.AsNoTracking()
                .Where(x => x.ModelId == 0).Select(x => x.JobFile);
            var mappedJobs = _db.JobFileModelMappings.AsNoTracking()
                .Where(x => x.ModelId != null).Select(x => x.JobFile);
            var query = _db.PcbAnalyticsDaily.AsNoTracking()
                .Where(x => x.BucketDate >= fromDay && x.BucketDate <= toDay
                    && x.ErrorCode != "DEFECT_UNSPECIFIED"
                    && !(x.JobFile != "" && unassignedJobs.Contains(x.JobFile))
                    && !(x.ModelId == 0 && (x.JobFile == "" || !mappedJobs.Contains(x.JobFile))));
            if (lineId.HasValue)
            {
                var ids = (await _masterDataService.GetStationsAsync())
                    .Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(x => ids.Contains(x.StationId));
            }
            if (stationId.HasValue) query = query.Where(x => x.StationId == stationId.Value);
            return query;
        }

        private async Task<(long Total, long Ok, long Ng)> RollupCountsAsync(
            int? lineId, int? stationId, DateTime? startDate, DateTime? endDate)
        {
            var (from, to) = RollupDays(startDate, endDate);
            var query = await DashboardRollupAsync(lineId, stationId, from, to);
            var stats = await query.GroupBy(_ => 1).Select(g => new
            {
                Total = g.Sum(x => x.TotalCount),
                Ok = g.Where(x => x.Result == "OK" || x.Result == "PASS").Sum(x => x.TotalCount),
                Ng = g.Where(x => x.Result == "NG" || x.Result == "FAIL").Sum(x => x.TotalCount)
            }).SingleOrDefaultAsync();
            return (stats?.Total ?? 0, stats?.Ok ?? 0, stats?.Ng ?? 0);
        }

        /// <summary>Daily buckets (00:00 factory clock) - the page groups them per day or per month.</summary>
        private async Task<List<HourlyStatDto>> RollupDailyTrendAsync(
            int? lineId, int? stationId, DateTime? startDate, DateTime? endDate)
        {
            var (from, to) = RollupDays(startDate, endDate);
            var query = await DashboardRollupAsync(lineId, stationId, from, to);
            var days = await query.GroupBy(x => x.BucketDate).Select(g => new
            {
                Day = g.Key,
                Total = g.Sum(x => x.TotalCount),
                Ok = g.Where(x => x.Result == "OK" || x.Result == "PASS").Sum(x => x.TotalCount),
                Ng = g.Where(x => x.Result == "NG" || x.Result == "FAIL").Sum(x => x.TotalCount)
            }).OrderBy(x => x.Day).ToListAsync();
            return days.Select(d => new HourlyStatDto(d.Day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
                lineId ?? 0, stationId ?? 0, d.Total, d.Ok, d.Ng,
                d.Total > 0 ? Math.Round((double)d.Ok / d.Total * 100.0, 2) : 0.0)).ToList();
        }

        private async Task<List<StationYieldStatDto>> RollupStationYieldAsync(
            int? lineId, DateTime? startDate, DateTime? endDate)
        {
            var (from, to) = RollupDays(startDate, endDate);
            var query = await DashboardRollupAsync(lineId, null, from, to);
            var grouped = await query.GroupBy(x => x.StationId).Select(g => new
            {
                StationId = g.Key,
                Total = g.Sum(x => x.TotalCount),
                Ok = g.Where(x => x.Result == "OK" || x.Result == "PASS").Sum(x => x.TotalCount),
                Ng = g.Where(x => x.Result == "NG" || x.Result == "FAIL").Sum(x => x.TotalCount)
            }).ToListAsync();
            var stations = (await _masterDataService.GetStationsAsync()).ToDictionary(s => s.Id);
            var lines = (await _masterDataService.GetLinesAsync()).ToDictionary(l => l.Id);
            return grouped.Select(g =>
            {
                stations.TryGetValue(g.StationId, out var st);
                var lId = st?.LineId ?? 0;
                return new StationYieldStatDto(g.StationId, st?.Name ?? $"Station {g.StationId}", lId,
                    lines.TryGetValue(lId, out var line) ? line.Name : $"Line {lId}",
                    g.Total, g.Ok, g.Ng, g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0);
            }).OrderBy(r => r.YieldRate).ToList();
        }

        /// <summary>
        /// NTF / RTY over the cohort of PCBs whose first test falls in the period (one row per
        /// PID-Station / PID in the summaries), as in the NTF report. The two counts run in parallel
        /// on their own connections.
        /// </summary>
        private async Task<(long NtfTotal, long NtfNg, long RtyTotal, long RtyEverNg)> CohortQualityAsync(
            int? lineId, int? stationId, DateTime? startDate, DateTime? endDate)
        {
            var connectionString = _db.Database.GetConnectionString()!;
            var inspectType = _inspectTimeType ??= await ScalarTextAsync(connectionString, @"
                SELECT data_type FROM information_schema.columns
                WHERE table_name = 'pcb_results' AND column_name = 'inspect_time' LIMIT 1") ?? "";
            // A timestamptz inspect_time carries the factory clock as UTC; a plain timestamp one was
            // converted with the session TimeZone when the summaries were written.
            // Typed parameters: a text parameter cast in SQL ("@from::timestamptz") is re-cast on
            // every row and made the scan 10x slower (45 s instead of 4.7 s for a month).
            bool tz = inspectType == "timestamp with time zone";
            string Bound(string name) => tz ? $"@{name}" : $"(@{name} AT TIME ZONE current_setting('TimeZone'))";
            // The page sends the factory clock (server time zone) with a UTC marker; first_test_time is
            // the real instant, so the bound is that wall clock at the server offset (00:00 = 00:00 +07).
            NpgsqlParameter Param(string name, DateTime wall) => tz
                ? new NpgsqlParameter(name, NpgsqlTypes.NpgsqlDbType.TimestampTz)
                    { Value = new DateTimeOffset(DateTime.SpecifyKind(wall, DateTimeKind.Unspecified),
                        TimeZoneInfo.Local.GetUtcOffset(DateTime.SpecifyKind(wall, DateTimeKind.Unspecified))).ToUniversalTime() }
                : new NpgsqlParameter(name, NpgsqlTypes.NpgsqlDbType.Timestamp)
                    { Value = DateTime.SpecifyKind(wall, DateTimeKind.Unspecified) };

            var where = "pid <> 'None'";
            var bounds = new List<(string Name, DateTime Wall)>();
            if (startDate.HasValue) { where += $" AND first_test_time >= {Bound("from")}"; bounds.Add(("from", startDate.Value)); }
            if (endDate.HasValue) { where += $" AND first_test_time <= {Bound("to")}"; bounds.Add(("to", endDate.Value)); }
            List<NpgsqlParameter> BoundParameters() => bounds.Select(b => Param(b.Name, b.Wall)).ToList();
            var parameters = BoundParameters();

            int[]? scopeStations = stationId.HasValue
                ? new[] { stationId.Value }
                : lineId.HasValue
                    ? (await _masterDataService.GetStationsAsync())
                        .Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToArray()
                    : null;

            var ntfWhere = where;
            var ntfParameters = BoundParameters();
            if (scopeStations != null)
            {
                ntfWhere += " AND station_id = ANY(@stations)";
                ntfParameters.Add(new("stations", scopeStations));
            }

            var ntfTask = CountPairAsync(connectionString,
                $"SELECT count(*), count(*) FILTER (WHERE ever_ng) FROM pcb_ntf_summaries WHERE {ntfWhere}", ntfParameters);
            Task<(long Total, long Flagged)> rtyTask;
            if (scopeStations == null)
            {
                // Whole plant: one row per PID, NG at any station of its history.
                rtyTask = CountPairAsync(connectionString,
                    $"SELECT count(*), count(*) FILTER (WHERE ever_ng) FROM pcb_rty_summaries WHERE {where}", parameters);
            }
            else
            {
                // A line (or station): PIDs whose FIRST test on its stations falls in the period; a PID
                // runs straight when it never failed at any of them. Built from the PID-Station summaries;
                // LATERAL makes PostgreSQL look each PID up by the primary key (pid, station_id) instead
                // of scanning every row of the line (15 s -> 5 s for a month).
                var rtyParameters = BoundParameters();
                rtyParameters.Add(new("stations", scopeStations));
                var firstOnLine = startDate.HasValue ? $"WHERE x.first_test >= {Bound("from")}" : "";
                rtyTask = CountPairAsync(connectionString, $@"
                    WITH cand AS (SELECT DISTINCT pid FROM pcb_ntf_summaries WHERE {ntfWhere})
                    SELECT count(*), count(*) FILTER (WHERE x.ng)
                    FROM cand c CROSS JOIN LATERAL (
                        SELECT bool_or(n.ever_ng) AS ng, min(n.first_test_time) AS first_test
                        FROM pcb_ntf_summaries n
                        WHERE n.pid = c.pid AND n.station_id = ANY(@stations)) x
                    {firstOnLine}", rtyParameters);
            }
            var ntf = await ntfTask;
            var rty = await rtyTask;
            return (ntf.Total, ntf.Flagged, rty.Total, rty.Flagged);
        }

        private static async Task<(long Total, long Flagged)> CountPairAsync(
            string connectionString, string sql, List<NpgsqlParameter> parameters)
        {
            await using var conn = new NpgsqlConnection(connectionString);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand(sql, conn) { CommandTimeout = 120 };
            cmd.Parameters.AddRange(parameters.ToArray());
            await using var reader = await cmd.ExecuteReaderAsync();
            return await reader.ReadAsync() ? (reader.GetInt64(0), reader.GetInt64(1)) : (0, 0);
        }

        private static async Task<string?> ScalarTextAsync(string connectionString, string sql)
        {
            await using var conn = new NpgsqlConnection(connectionString);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand(sql, conn);
            return (await cmd.ExecuteScalarAsync()) as string;
        }

        // ------------------------------------------------------------------ Worst panel

        public async Task<DashboardWorstDto> GetDashboardWorstAsync(
            int? lineId, DateTime? startDate, DateTime? endDate, int top = 5)
        {
            top = Math.Clamp(top, 1, 20);
            var (fromDay, toDay) = RollupDays(startDate, endDate);
            var today = FactoryToday();
            // "Recent" = the last day of the period that has started (today for the current period).
            var recentDay = toDay > today ? today : toDay;
            if (recentDay < fromDay) recentDay = fromDay;
            var cacheKey = $"dashboard-worst:{lineId}:{fromDay}:{toDay}:{recentDay}:{top}";
            return await _memoryCache.GetOrCreateAsync(cacheKey, async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2);

                // Recent day against the 7 days before it - spots a jig / code / station that just got worse.
                var baselineFrom = recentDay.AddDays(-7);
                List<WorstRow> period;
                List<WorstRow> window;
                if (UseDashboardRollup(startDate, endDate))
                {
                    // Period totals per station / jig / NG code / job file - the rollup without days.
                    var periodQuery = await DashboardRollupAsync(lineId, null, fromDay, toDay);
                    period = await periodQuery
                        .GroupBy(x => new { x.StationId, x.ChannelId, x.JobFile, x.ModelId,
                            Ng = x.Result == "NG" || x.Result == "FAIL",
                            Code = x.Result == "NG" || x.Result == "FAIL" ? x.ErrorCode : "" })
                        .Select(g => new WorstRow(g.Key.StationId, g.Key.ChannelId, g.Key.JobFile, g.Key.ModelId,
                            g.Key.Ng, g.Key.Code, g.Sum(x => x.TotalCount), false))
                        .ToListAsync();
                    var windowQuery = await DashboardRollupAsync(lineId, null, baselineFrom, recentDay);
                    window = await windowQuery
                        .GroupBy(x => new { Recent = x.BucketDate == recentDay, x.StationId, x.ChannelId, x.JobFile, x.ModelId,
                            Ng = x.Result == "NG" || x.Result == "FAIL",
                            Code = x.Result == "NG" || x.Result == "FAIL" ? x.ErrorCode : "" })
                        .Select(g => new WorstRow(g.Key.StationId, g.Key.ChannelId, g.Key.JobFile, g.Key.ModelId,
                            g.Key.Ng, g.Key.Code, g.Sum(x => x.TotalCount), g.Key.Recent))
                        .ToListAsync();
                }
                else
                {
                    // Today (<= 48 h): the raw table, cut on the factory day like the cards and the trend
                    // (the rollup days run 07:00 - 07:00 factory time). The period is the "recent" part;
                    // the 7 days before it come from the rollup.
                    var raw = ExcludeUnassignedModelData(_db.PcbResults.AsNoTracking());
                    if (lineId.HasValue)
                    {
                        var ids = (await _masterDataService.GetStationsAsync())
                            .Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                        raw = raw.Where(p => ids.Contains(p.StationId));
                    }
                    if (startDate.HasValue) { var start = EnsureUtc(startDate.Value); raw = raw.Where(p => p.InspectTime >= start); }
                    if (endDate.HasValue) { var end = EnsureUtc(endDate.Value); raw = raw.Where(p => p.InspectTime <= end); }
                    period = await raw
                        .GroupBy(p => new { p.StationId, p.ChannelId, JobFile = p.JobFile ?? "", ModelId = p.ModelId ?? 0,
                            Ng = p.Result == "NG" || p.Result == "FAIL",
                            Code = p.Result == "NG" || p.Result == "FAIL" ? (p.ErrorCode ?? "") : "" })
                        .Select(g => new WorstRow(g.Key.StationId, g.Key.ChannelId, g.Key.JobFile, g.Key.ModelId,
                            g.Key.Ng, g.Key.Code, g.Count(), true))
                        .ToListAsync();
                    var baselineQuery = await DashboardRollupAsync(lineId, null, baselineFrom, recentDay.AddDays(-1));
                    var baseline = await baselineQuery
                        .GroupBy(x => new { x.StationId, x.ChannelId, x.JobFile, x.ModelId,
                            Ng = x.Result == "NG" || x.Result == "FAIL",
                            Code = x.Result == "NG" || x.Result == "FAIL" ? x.ErrorCode : "" })
                        .Select(g => new WorstRow(g.Key.StationId, g.Key.ChannelId, g.Key.JobFile, g.Key.ModelId,
                            g.Key.Ng, g.Key.Code, g.Sum(x => x.TotalCount), false))
                        .ToListAsync();
                    window = period.Concat(baseline).ToList();
                }

                var stations = (await _masterDataService.GetStationsAsync()).ToDictionary(s => s.Id);
                var lines = (await _masterDataService.GetLinesAsync()).ToDictionary(l => l.Id);
                var channels = (await _masterDataService.GetChannelsAsync()).GroupBy(c => c.Id).ToDictionary(g => g.Key, g => g.First());
                var models = (await _masterDataService.GetModelsAsync()).ToDictionary(m => m.Id);
                var mappings = await _db.JobFileModelMappings.AsNoTracking()
                    .Where(x => x.ModelId != null && x.JobFile != null).ToListAsync();
                var modelByJob = mappings.GroupBy(x => x.JobFile.Trim(), StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.UpdatedAt).ThenByDescending(x => x.Id).First().ModelId!.Value,
                        StringComparer.OrdinalIgnoreCase);
                int ModelOf(WorstRow r) => modelByJob.TryGetValue(r.JobFile.Trim(), out var m) ? m : r.ModelId;

                string StationName(int id) => stations.TryGetValue(id, out var s) ? s.Name : $"Station {id}";
                string LineOfStation(int id) => stations.TryGetValue(id, out var s)
                    ? (lines.TryGetValue(s.LineId, out var l) ? l.Name : s.LineName) : "";

                long total = period.Sum(x => x.Count);
                long ng = period.Where(x => x.IsNg).Sum(x => x.Count);
                double ngRate = total > 0 ? ng * 100.0 / total : 0;

                List<DashboardWorstItemDto> Rank<TKey>(string kind, Func<WorstRow, TKey> key,
                    Func<TKey, (string Name, string? Context)> describe, bool byRate) where TKey : notnull
                {
                    var recent = window.Where(x => x.Recent).GroupBy(key).ToDictionary(g => g.Key, g => g.ToList());
                    var baseline = window.Where(x => !x.Recent).GroupBy(key).ToDictionary(g => g.Key, g => g.ToList());
                    return period.GroupBy(key).Select(g =>
                    {
                        long t = g.Sum(x => x.Count);
                        long n = g.Where(x => x.IsNg).Sum(x => x.Count);
                        var rRows = recent.GetValueOrDefault(g.Key) ?? new List<WorstRow>();
                        var bRows = baseline.GetValueOrDefault(g.Key) ?? new List<WorstRow>();
                        // For NG codes the rate is over every test in scope (the code has no OK rows).
                        long rt = byRate ? rRows.Sum(x => x.Count) : window.Where(x => x.Recent).Sum(x => x.Count);
                        long rn = rRows.Where(x => x.IsNg).Sum(x => x.Count);
                        long bt = byRate ? bRows.Sum(x => x.Count) : window.Where(x => !x.Recent).Sum(x => x.Count);
                        long bn = bRows.Where(x => x.IsNg).Sum(x => x.Count);
                        double rate = (byRate ? t : total) > 0 ? n * 100.0 / (byRate ? t : total) : 0;
                        double rRate = rt > 0 ? rn * 100.0 / rt : 0;
                        double bRate = bt > 0 ? bn * 100.0 / bt : 0;
                        // A spike: enough NG on the recent day and clearly above its own last 7 days.
                        bool spike = rn >= 5 && rt >= WorstMinVolume && rRate >= Math.Max(bRate * 1.5, bRate + 1.0);
                        // Stations / jigs / models: NG above what the average NG rate would give, so a
                        // high-volume station with a normal rate does not outrank a small bad jig.
                        double excess = byRate ? n - t * ngRate / 100.0 : n;
                        var (name, context) = describe(g.Key);
                        return new DashboardWorstItemDto(kind, g.Key.ToString() ?? "", name, context, t, n,
                            Math.Round(rate, 2), ng > 0 ? Math.Round(n * 100.0 / ng, 1) : 0,
                            rt, rn, Math.Round(rRate, 2), Math.Round(bRate, 2), spike, Math.Round(excess, 1));
                    })
                    .Where(x => x.Ng > 0 && (!byRate || x.Total >= WorstMinVolume))
                    .OrderByDescending(x => x.Excess).ThenByDescending(x => x.Ng)
                    .ToList();
                }
                List<DashboardWorstItemDto> Worst(List<DashboardWorstItemDto> items) =>
                    items.Where(x => x.Excess > 0).Take(top).ToList();

                var stationItems = Rank("station", r => r.StationId,
                    id => (StationName(id), LineOfStation(id)), true);
                // Channels: IP, station and line apart, and the NG errors that make them worst.
                var channelErrors = period.Where(x => x.IsNg).GroupBy(x => x.ChannelId)
                    .ToDictionary(g => g.Key, g =>
                    {
                        long channelNg = g.Sum(x => x.Count);
                        return g.GroupBy(x => x.Code)
                            .Select(c => new DashboardWorstErrorDto(
                                string.IsNullOrWhiteSpace(c.Key) ? "(không mã lỗi)" : c.Key, c.Sum(x => x.Count),
                                channelNg > 0 ? Math.Round(c.Sum(x => x.Count) * 100.0 / channelNg, 1) : 0))
                            .OrderByDescending(c => c.Ng).Take(3).ToList();
                    });
                var jigItems = Rank("jig", r => r.ChannelId,
                    id => channels.TryGetValue(id, out var c)
                        ? ($"{c.Name}", $"{c.StationName} · {c.LineName}")
                        : ($"Jig #{id}", null), true)
                    .Select(x =>
                    {
                        int id = int.Parse(x.Key);
                        channels.TryGetValue(id, out var c);
                        var stationRow = period.FirstOrDefault(r => r.ChannelId == id);
                        return x with
                        {
                            Ip = c?.IpAddress,
                            StationName = c?.StationName ?? (stationRow != null ? StationName(stationRow.StationId) : null),
                            LineName = c?.LineName ?? (stationRow != null ? LineOfStation(stationRow.StationId) : null),
                            TopErrors = channelErrors.GetValueOrDefault(id) ?? new List<DashboardWorstErrorDto>()
                        };
                    }).ToList();
                var codeTopStation = period.Where(x => x.IsNg).GroupBy(x => x.Code)
                    .ToDictionary(g => g.Key, g => g.GroupBy(x => x.StationId)
                        .Select(s => new { s.Key, Ng = s.Sum(x => x.Count) }).OrderByDescending(s => s.Ng).First());
                var codeItems = Rank("code", r => r.IsNg ? r.Code : "\u0000ok",
                    code => (string.IsNullOrWhiteSpace(code) ? "(không mã lỗi)" : code,
                        codeTopStation.TryGetValue(code, out var s)
                            ? $"Nhiều nhất: {StationName(s.Key)} ({s.Ng:N0})" : null), false)
                    .Where(x => x.Key != "\u0000ok").ToList();
                var modelItems = Rank("model", ModelOf,
                    id => (models.TryGetValue(id, out var m) ? m.Name : $"Model #{id}",
                        models.TryGetValue(id, out var mm) ? mm.ModelGroupName : null), true);

                // Spikes from every dimension (also items that are not in a period top list, e.g. a
                // jig that went bad today), biggest jump first - what to look at right now.
                var alerts = stationItems.Concat(jigItems).Concat(codeItems).Concat(modelItems)
                    .Where(x => x.Spike)
                    .OrderByDescending(x => x.RecentNgRate - x.BaselineNgRate)
                    .Take(top * 2).ToList();
                return new DashboardWorstDto(fromDay == DateOnly.MinValue ? null : fromDay,
                    toDay == DateOnly.MaxValue ? null : toDay, recentDay, total, ng, Math.Round(ngRate, 2),
                    Worst(stationItems), Worst(jigItems), Worst(codeItems), Worst(modelItems), alerts);
            }) ?? new DashboardWorstDto(null, null, recentDay, 0, 0, 0, new(), new(), new(), new(), new());
        }

        private sealed record WorstRow(int StationId, int ChannelId, string JobFile, int ModelId,
            bool IsNg, string Code, long Count, bool Recent);
    }
}
