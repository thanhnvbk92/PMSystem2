using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PMSystem2.Api.Data;

namespace PMSystem2.Api.Services;

/// <summary>
/// Fast data source for the periodic quality reports (Re-test, NTF, FPY).
/// Reads only the pre-aggregated tables, never the pcb_results fact table:
///  - pcb_analytics_daily : test attempts per day / station / result / error code (Re-test, Pareto)
///  - pcb_ntf_summaries   : one row per PID + Station (NTF)
///  - pcb_rty_summaries   : one row per PID (plant-wide FPY)
/// NTF and FPY use the cohort of PCBs (PID-Station / PID) whose FIRST test falls in the period.
/// Timestamps hold the factory clock with a UTC marker, so periods are cut on the UTC wall value.
/// </summary>
public class QualityReportDataService
{
    private readonly AppDbContext _db;
    public QualityReportDataService(AppDbContext db) => _db = db;

    public record AttemptRow(DateOnly Period, int StationId, string Result, string ErrorCode, long Count);
    public record NtfRow(DateOnly Period, int StationId, long Pairs, long NgPairs);
    public record FpyRow(DateOnly Period, long Pcbs, long EverNgPcbs);
    /// <summary>Health of the statistics tables the report relies on.</summary>
    public record Diagnostics(string DbTimeZone, string InspectTimeType, bool RollupTriggerPresent, bool RollupTriggerFastVersion,
        long NonePidNtfRows, long NonePidRtyRows, long MergedPids, long MergedPidsStaleSummaries);
    public record QualityReportData(string Period, DateOnly StartDate, DateOnly EndDate, Diagnostics Diagnostics,
        List<AttemptRow> Attempts, List<NtfRow> Ntf, List<FpyRow> Fpy);

    public async Task<QualityReportData> GetAsync(DateOnly start, DateOnly endExclusive, string period, CancellationToken ct)
    {
        var unit = period switch { "day" => "day", "week" => "week", _ => "month" };
        // Factory-clock (wall) bounds, compared as timestamp without time zone.
        var fromTs = DateTime.SpecifyKind(start.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified);
        var toTs = DateTime.SpecifyKind(endExclusive.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified);

        var conn = _db.Database.GetDbConnection();
        var opened = conn.State != System.Data.ConnectionState.Open;
        if (opened) await conn.OpenAsync(ct);
        try
        {
            var diagnostics = await GetDiagnosticsAsync(conn, ct);
            // pcb_results.inspect_time holds the factory clock. When it is "timestamp" (no time zone),
            // the TIMESTAMPTZ summary columns were converted with the session TimeZone on insert, so the
            // wall clock is recovered with that zone; a timestamptz inspect_time carries it as UTC.
            var wall = diagnostics.InspectTimeType == "timestamp with time zone"
                ? "(first_test_time AT TIME ZONE 'UTC')"
                : "(first_test_time AT TIME ZONE current_setting('TimeZone'))";

            var attempts = new List<AttemptRow>();
            await using (var cmd = Command(conn, @"
                SELECT date_trunc(@unit, d.bucket_date::timestamp)::date AS period,
                       COALESCE(c.station_id, d.station_id) AS station_id,
                       d.result, d.error_code, SUM(d.total_count)::bigint AS cnt
                FROM pcb_analytics_daily d
                LEFT JOIN channels c ON c.id = d.channel_id
                WHERE d.bucket_date >= @from AND d.bucket_date < @to
                  AND NOT (d.model_id = 0 AND d.job_file IN
                           (SELECT job_file FROM job_file_model_mappings WHERE model_id = 0))
                GROUP BY 1, 2, 3, 4", unit, start, endExclusive))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
                while (await r.ReadAsync(ct))
                    attempts.Add(new AttemptRow(DateOnly.FromDateTime(r.GetDateTime(0)), r.GetInt32(1),
                        r.GetString(2), r.GetString(3), r.GetInt64(4)));

            var ntf = new List<NtfRow>();
            await using (var cmd = Command(conn, $@"
                SELECT date_trunc(@unit, {wall})::date AS period, station_id,
                       COUNT(*)::bigint, COUNT(*) FILTER (WHERE ever_ng)::bigint
                FROM pcb_ntf_summaries
                WHERE {wall} >= @fromTs AND {wall} < @toTs AND pid <> 'None'
                GROUP BY 1, 2", unit, start, endExclusive, fromTs, toTs))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
                while (await r.ReadAsync(ct))
                    ntf.Add(new NtfRow(DateOnly.FromDateTime(r.GetDateTime(0)), r.GetInt32(1), r.GetInt64(2), r.GetInt64(3)));

            var fpy = new List<FpyRow>();
            await using (var cmd = Command(conn, $@"
                SELECT date_trunc(@unit, {wall})::date AS period,
                       COUNT(*)::bigint, COUNT(*) FILTER (WHERE ever_ng)::bigint
                FROM pcb_rty_summaries
                WHERE {wall} >= @fromTs AND {wall} < @toTs AND pid <> 'None'
                GROUP BY 1", unit, start, endExclusive, fromTs, toTs))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
                while (await r.ReadAsync(ct))
                    fpy.Add(new FpyRow(DateOnly.FromDateTime(r.GetDateTime(0)), r.GetInt64(1), r.GetInt64(2)));

            return new QualityReportData(unit, start, endExclusive, diagnostics, attempts, ntf, fpy);
        }
        finally
        {
            if (opened) await conn.CloseAsync();
        }
    }

    private static DbCommand Command(DbConnection conn, string sql, string unit, DateOnly from, DateOnly to,
        DateTime? fromTs = null, DateTime? toTs = null)
    {
        var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 300;
        cmd.Parameters.Add(new NpgsqlParameter("unit", unit));
        cmd.Parameters.Add(new NpgsqlParameter("from", from));
        cmd.Parameters.Add(new NpgsqlParameter("to", to));
        if (fromTs.HasValue) cmd.Parameters.Add(new NpgsqlParameter("fromTs", NpgsqlTypes.NpgsqlDbType.Timestamp) { Value = fromTs.Value });
        if (toTs.HasValue) cmd.Parameters.Add(new NpgsqlParameter("toTs", NpgsqlTypes.NpgsqlDbType.Timestamp) { Value = toTs.Value });
        return cmd;
    }

    private static async Task<Diagnostics> GetDiagnosticsAsync(DbConnection conn, CancellationToken ct)
    {
        string tz = (string)(await Scalar(conn, "SHOW TimeZone", ct) ?? "");
        string inspectType = (string)(await Scalar(conn, @"
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'pcb_results' AND column_name = 'inspect_time' LIMIT 1", ct) ?? "");
        // Fast version = the one that deletes only the decremented row (commit a6fe75e).
        var def = (string?)await Scalar(conn, @"
            SELECT pg_get_functiondef(p.oid) FROM pg_proc p
            WHERE p.proname = 'update_pcb_analytics_daily' LIMIT 1", ct);
        bool triggerPresent = Convert.ToInt64(await Scalar(conn,
            "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_pcb_analytics_daily' AND NOT tgisinternal", ct) ?? 0L) > 0;
        bool fast = def != null && def.Contains("Only the row just decremented", StringComparison.Ordinal);
        long noneNtf = Convert.ToInt64(await Scalar(conn, "SELECT count(*) FROM pcb_ntf_summaries WHERE pid = 'None'", ct) ?? 0L);
        long noneRty = Convert.ToInt64(await Scalar(conn, "SELECT count(*) FROM pcb_rty_summaries WHERE pid = 'None'", ct) ?? 0L);
        long merged = 0, stale = 0;
        if (await Scalar(conn, "SELECT to_regclass('public.bak_none_merge')::text", ct) is string)
        {
            // PIDs merged by merge_none_pid.sql whose summary was not rebuilt after the merge.
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                WITH m AS (SELECT pid, max(merged_at) AS merged_at FROM bak_none_merge WHERE role = 'root' GROUP BY pid)
                SELECT count(*), count(*) FILTER (WHERE s.pid IS NULL OR s.updated_at < m.merged_at)
                FROM m LEFT JOIN pcb_rty_summaries s ON s.pid = m.pid";
            cmd.CommandTimeout = 300;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct)) { merged = r.GetInt64(0); stale = r.GetInt64(1); }
        }
        return new Diagnostics(tz, inspectType, triggerPresent, fast, noneNtf, noneRty, merged, stale);
    }

    private static async Task<object?> Scalar(DbConnection conn, string sql, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        return await cmd.ExecuteScalarAsync(ct);
    }
}
