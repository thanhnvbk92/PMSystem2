using System.Data;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services.Cpk;

/// <summary>
/// Owns the <see cref="CpkEngine"/> state: restores it from <c>cpk_current</c>,
/// seeds it once from history, applies queued samples, persists changed keys in
/// batches and pushes changed Channels to the web via SignalR.
/// </summary>
public sealed class CpkEngineService : BackgroundService
{
    private const string NumericPattern = @"^[+-]?[0-9]+([.,][0-9]+)?([eE][+-]?[0-9]+)?$";
    private const int UpsertChunkSize = 400;
    // Bump when the sampling rules change; cpk_current is rebuilt once.
    // v3: live samples used the wrong time zone (+7 h); rebuild from the database.
    private const string DataVersion = "3";

    private readonly CpkEngine _engine;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<ProductionHub, IProductionClient> _hub;
    private readonly ILogger<CpkEngineService> _logger;
    private readonly Dictionary<int, CpkCacheOverviewDto> _lastBroadcast = new();
    private readonly List<int> _pendingMarks = new(); // Channels whose bootstrap finished
    private readonly List<(int ChannelId, bool Found)> _pendingFallbackMarks = new();
    private DateTime _nextPrune = DateTime.MinValue;

    public CpkEngineService(CpkEngine engine, IServiceScopeFactory scopeFactory,
        IHubContext<ProductionHub, IProductionClient> hub, ILogger<CpkEngineService> logger)
    {
        _engine = engine;
        _scopeFactory = scopeFactory;
        _hub = hub;
        _logger = logger;
    }

    private CpkOptions Options => _engine.Options;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RestoreAsync(stoppingToken); break; }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "CPK engine restore failed; retrying in 30 s.");
                try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
        _engine.IsReady = true;
        foreach (var (channelId, row) in _engine.EffectiveOverview()) _lastBroadcast[channelId] = row;

        var bootstrap = new Queue<(int ChannelId, int StationId)>();
        try
        {
            foreach (var step in await LoadBootstrapPlanAsync(stoppingToken)) bootstrap.Enqueue(step);
            if (bootstrap.Count > 0)
                _logger.LogInformation("CPK bootstrap: {Channels} channels pending.", bootstrap.Count);
        }
        catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "CPK bootstrap plan could not be loaded; only live data will be used until restart.");
        }

        var interval = TimeSpan.FromSeconds(Math.Max(1, Options.FlushIntervalSeconds));
        var nextFlush = DateTime.UtcNow + interval;
        Queue<(int ChannelId, int StationId)>? fallback = null;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var now = DateTime.UtcNow;
                if (now >= nextFlush)
                {
                    await FlushAsync(stoppingToken);
                    nextFlush = DateTime.UtcNow + interval;
                    if (DateTime.UtcNow >= _nextPrune) await PruneAsync(stoppingToken);
                }
                else if (bootstrap.Count > 0)
                {
                    var (channelId, stationId) = bootstrap.Peek();
                    await RunBootstrapChannelAsync(channelId, stationId, stoppingToken);
                    bootstrap.Dequeue();
                    _pendingMarks.Add(channelId);
                    if (bootstrap.Count == 0) _logger.LogInformation("CPK bootstrap finished.");
                    await Task.Delay(Math.Max(0, Options.BootstrapStepDelayMs), stoppingToken);
                }
                else if (fallback == null)
                {
                    // Channels still without a CPK after the normal history window
                    // search older data, one Channel per step, newest window first.
                    fallback = new Queue<(int ChannelId, int StationId)>(await LoadFallbackPlanAsync(stoppingToken));
                    if (fallback.Count > 0)
                        _logger.LogInformation("CPK history fallback: {Channels} channels without CPK will search older data.", fallback.Count);
                }
                else if (fallback.Count > 0)
                {
                    var (channelId, stationId) = fallback.Peek();
                    var found = await RunFallbackAsync(channelId, stationId, stoppingToken);
                    fallback.Dequeue();
                    _pendingFallbackMarks.Add((channelId, found));
                    if (fallback.Count == 0) _logger.LogInformation("CPK history fallback finished.");
                    await Task.Delay(Math.Max(0, Options.BootstrapStepDelayMs), stoppingToken);
                }
                else if (_engine.IsRebuilding)
                {
                    await FinishRebuildAsync(stoppingToken);
                }
                else
                {
                    await Task.Delay(nextFlush - now, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "CPK engine cycle failed; it will retry on the next cycle.");
                try { await Task.Delay(interval, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }

        // Persist what is still queued so a restart loses nothing.
        try
        {
            using var shutdown = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            await FlushAsync(shutdown.Token);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Final CPK flush on shutdown did not complete.");
        }
    }

    // ---------------------------------------------------------------------
    // Flush: apply queue -> recompute dirty keys -> persist -> push
    // ---------------------------------------------------------------------

    private async Task FlushAsync(CancellationToken token)
    {
        _engine.DrainQueue(int.MaxValue);
        var (persist, broadcast) = _engine.PublishDirty(_lastBroadcast);
        var catalog = _engine.NewCatalogEntries.ToList();
        _engine.NewCatalogEntries.Clear();
        var marks = _pendingMarks.ToList();
        var fallbackMarks = _pendingFallbackMarks.ToList();

        if (persist.Count > 0 || catalog.Count > 0 || marks.Count > 0 || fallbackMarks.Count > 0)
        {
            try
            {
                await PersistAsync(persist, catalog, marks, fallbackMarks, token);
                _pendingMarks.Clear();
                _pendingFallbackMarks.Clear();
            }
            catch (Exception ex)
            {
                // Keep the work for the next cycle instead of losing it.
                foreach (var item in persist) _engine.Dirty.Add(item.Key);
                foreach (var entry in catalog) _engine.NewCatalogEntries.Add(entry);
                if (token.IsCancellationRequested) throw;
                _logger.LogWarning(ex, "CPK persist failed for {Keys} keys; retrying next cycle.", persist.Count);
            }
        }

        if (broadcast.Count == 0) return;
        foreach (var row in broadcast) _lastBroadcast[row.ChannelId] = row;
        try
        {
            await _hub.Clients.All.ReceiveCpkUpdate(broadcast);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "CPK SignalR broadcast failed.");
        }
    }

    private async Task PersistAsync(
        List<(CpkKey Key, CpkEngine.KeyState State, CpkKeySnapshot Snapshot)> rows,
        List<(int StationId, string JobFile, int StepNumber, string StepName, string? StepType)> catalog,
        List<int> marks,
        List<(int ChannelId, bool Found)> fallbackMarks,
        CancellationToken token)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await connection.OpenAsync(token);
        await using var tx = await connection.BeginTransactionAsync(token);

        for (int offset = 0; offset < rows.Count; offset += UpsertChunkSize)
        {
            var chunk = rows.Skip(offset).Take(UpsertChunkSize).ToList();
            await using var cmd = new NpgsqlCommand { Connection = connection, Transaction = tx };
            var sql = new StringBuilder(@"INSERT INTO cpk_current
                (channel_id, job_file, step_number, step_name, station_id, step_type, sample_count,
                 spec_min, spec_max, mean, standard_deviation, cpl, cpu, cpk, status,
                 sample_values, sample_pids, sample_times, first_time, last_time, updated_at) VALUES ");
            for (int i = 0; i < chunk.Count; i++)
            {
                var (key, _, s) = chunk[i];
                if (i > 0) sql.Append(',');
                sql.Append($"(@c{i},@j{i},@n{i},@s{i},@st{i},@t{i},@cnt{i},@mn{i},@mx{i},@me{i},@sd{i},@l{i},@u{i},@k{i},@ss{i},@v{i},@p{i},@ti{i},@f{i},@la{i},NOW())");
                cmd.Parameters.Add(new NpgsqlParameter($"c{i}", NpgsqlDbType.Integer) { Value = key.ChannelId });
                cmd.Parameters.Add(new NpgsqlParameter($"j{i}", NpgsqlDbType.Text) { Value = key.JobFile });
                cmd.Parameters.Add(new NpgsqlParameter($"n{i}", NpgsqlDbType.Integer) { Value = key.StepNumber });
                cmd.Parameters.Add(new NpgsqlParameter($"s{i}", NpgsqlDbType.Text) { Value = key.StepName });
                cmd.Parameters.Add(new NpgsqlParameter($"st{i}", NpgsqlDbType.Integer) { Value = s.StationId });
                cmd.Parameters.Add(new NpgsqlParameter($"t{i}", NpgsqlDbType.Text) { Value = (object?)s.StepType ?? DBNull.Value });
                cmd.Parameters.Add(new NpgsqlParameter($"cnt{i}", NpgsqlDbType.Integer) { Value = s.SampleCount });
                cmd.Parameters.Add(Num($"mn{i}", s.SpecMin));
                cmd.Parameters.Add(Num($"mx{i}", s.SpecMax));
                cmd.Parameters.Add(Num($"me{i}", s.Mean));
                cmd.Parameters.Add(Num($"sd{i}", s.StandardDeviation));
                cmd.Parameters.Add(Num($"l{i}", s.Cpl));
                cmd.Parameters.Add(Num($"u{i}", s.Cpu));
                cmd.Parameters.Add(Num($"k{i}", s.Cpk));
                cmd.Parameters.Add(new NpgsqlParameter($"ss{i}", NpgsqlDbType.Text) { Value = s.Status });
                cmd.Parameters.Add(new NpgsqlParameter($"v{i}", NpgsqlDbType.Array | NpgsqlDbType.Double)
                    { Value = s.Points.Select(p => p.Value).ToArray() });
                cmd.Parameters.Add(new NpgsqlParameter($"p{i}", NpgsqlDbType.Array | NpgsqlDbType.Text)
                    { Value = s.Points.Select(p => p.Pid).ToArray() });
                cmd.Parameters.Add(new NpgsqlParameter($"ti{i}", NpgsqlDbType.Array | NpgsqlDbType.TimestampTz)
                    { Value = s.Points.Select(p => CpkEngine.ToUtc(p.InspectTime)).ToArray() });
                cmd.Parameters.Add(new NpgsqlParameter($"f{i}", NpgsqlDbType.TimestampTz) { Value = CpkEngine.ToUtc(s.FirstTime) });
                cmd.Parameters.Add(new NpgsqlParameter($"la{i}", NpgsqlDbType.TimestampTz) { Value = CpkEngine.ToUtc(s.LastTime) });
            }
            sql.Append(@" ON CONFLICT (channel_id, job_file, step_number, step_name) DO UPDATE SET
                station_id = EXCLUDED.station_id, step_type = EXCLUDED.step_type,
                sample_count = EXCLUDED.sample_count, spec_min = EXCLUDED.spec_min, spec_max = EXCLUDED.spec_max,
                mean = EXCLUDED.mean, standard_deviation = EXCLUDED.standard_deviation,
                cpl = EXCLUDED.cpl, cpu = EXCLUDED.cpu, cpk = EXCLUDED.cpk, status = EXCLUDED.status,
                sample_values = EXCLUDED.sample_values, sample_pids = EXCLUDED.sample_pids,
                sample_times = EXCLUDED.sample_times, first_time = EXCLUDED.first_time,
                last_time = EXCLUDED.last_time, updated_at = EXCLUDED.updated_at");
            cmd.CommandText = sql.ToString();
            await cmd.ExecuteNonQueryAsync(token);
        }

        // Keep cpk_step_catalog (Station step picker, monthly report) current.
        // Only first-seen keys reach here, so this is rare after warm-up.
        for (int offset = 0; offset < catalog.Count; offset += UpsertChunkSize)
        {
            var chunk = catalog.Skip(offset).Take(UpsertChunkSize).ToList();
            await using var cmd = new NpgsqlCommand { Connection = connection, Transaction = tx };
            var sql = new StringBuilder(@"INSERT INTO cpk_step_catalog
                (station_id, job_file, step_number, step_name, step_type, updated_at)
                SELECT v.station_id, v.job_file, v.step_number, v.step_name, v.step_type, NOW()
                FROM (VALUES ");
            for (int i = 0; i < chunk.Count; i++)
            {
                var entry = chunk[i];
                if (i > 0) sql.Append(',');
                sql.Append($"(@st{i}::int,@j{i}::text,@n{i}::int,@s{i}::text,@t{i}::text)");
                cmd.Parameters.AddWithValue($"st{i}", entry.StationId);
                cmd.Parameters.AddWithValue($"j{i}", Truncate(entry.JobFile, 100) ?? string.Empty);
                cmd.Parameters.AddWithValue($"n{i}", entry.StepNumber);
                cmd.Parameters.AddWithValue($"s{i}", Truncate(entry.StepName, 100) ?? string.Empty);
                cmd.Parameters.Add(new NpgsqlParameter($"t{i}", NpgsqlDbType.Text)
                    { Value = (object?)Truncate(entry.StepType, 50) ?? DBNull.Value });
            }
            sql.Append(@") AS v(station_id, job_file, step_number, step_name, step_type)
                WHERE EXISTS (SELECT 1 FROM stations s WHERE s.id = v.station_id)
                ON CONFLICT (station_id, job_file, step_number, step_name) DO NOTHING");
            cmd.CommandText = sql.ToString();
            await cmd.ExecuteNonQueryAsync(token);
        }

        if (marks.Count > 0)
        {
            await using var cmd = new NpgsqlCommand(@"
            INSERT INTO cpk_bootstrap_channel (channel_id, completed_at)
            SELECT m.channel_id, NOW() FROM UNNEST(@channels) AS m(channel_id)
            ON CONFLICT (channel_id) DO UPDATE SET completed_at = EXCLUDED.completed_at",
            connection, tx);
            cmd.Parameters.AddWithValue("channels", marks.ToArray());
            await cmd.ExecuteNonQueryAsync(token);
        }

        if (fallbackMarks.Count > 0)
        {
            await using var cmd = new NpgsqlCommand(@"
                INSERT INTO cpk_fallback_state (channel_id, found, checked_at)
                SELECT m.channel_id, m.found, NOW() FROM UNNEST(@channels, @found) AS m(channel_id, found)
                ON CONFLICT (channel_id) DO UPDATE SET found = EXCLUDED.found, checked_at = EXCLUDED.checked_at",
                connection, tx);
            cmd.Parameters.AddWithValue("channels", fallbackMarks.Select(m => m.ChannelId).ToArray());
            cmd.Parameters.AddWithValue("found", fallbackMarks.Select(m => m.Found).ToArray());
            await cmd.ExecuteNonQueryAsync(token);
        }

        await tx.CommitAsync(token);
    }

    // ---------------------------------------------------------------------
    // Startup restore, retention and one-time history bootstrap
    // ---------------------------------------------------------------------

    private async Task RestoreAsync(CancellationToken token)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await connection.OpenAsync(token);

        // Rebuild once whenever the sample rules change (v2: FAIL step rows of
        // OK PCBs are excluded), so previously stored windows are not reused.
        await using (var version = new NpgsqlCommand(@"
            DO $v$
            BEGIN
                IF COALESCE((SELECT value FROM cpk_engine_meta WHERE key = 'data_version'), '') <> @version THEN
                    -- Keep the old results visible until the rebuild completes. If a
                    -- rebuild was already interrupted, keep the older, complete copy.
                    IF to_regclass('public.cpk_current_previous') IS NULL THEN
                        CREATE TABLE cpk_current_previous AS SELECT * FROM cpk_current;
                    END IF;
                    TRUNCATE cpk_current;
                    TRUNCATE cpk_bootstrap_state;
                    TRUNCATE cpk_bootstrap_channel;
                    TRUNCATE cpk_fallback_state;
                    INSERT INTO cpk_engine_meta (key, value) VALUES ('data_version', @version)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
                END IF;
            END $v$;", connection))
        {
            version.CommandText = version.CommandText.Replace("@version", $"'{DataVersion}'");
            await version.ExecuteNonQueryAsync(token);
        }

        await using (var bootstrapVersion = new NpgsqlCommand($@"
            DO $b$
            BEGIN
                IF COALESCE((SELECT value FROM cpk_engine_meta WHERE key = 'bootstrap_version'), '') <> '{BootstrapVersion}' THEN
                    TRUNCATE cpk_bootstrap_channel;
                    INSERT INTO cpk_engine_meta (key, value) VALUES ('bootstrap_version', '{BootstrapVersion}')
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
                END IF;
            END $b$;", connection))
        {
            await bootstrapVersion.ExecuteNonQueryAsync(token);
        }

        await using (var cleanup = new NpgsqlCommand(@"
            DELETE FROM cpk_current c WHERE c.last_time < @cutoff
              AND EXISTS (SELECT 1 FROM cpk_current f WHERE f.channel_id = c.channel_id
                          AND f.last_time >= @cutoff AND f.status = 'READY');
            DELETE FROM cpk_current c WHERE NOT EXISTS (SELECT 1 FROM channels ch WHERE ch.id = c.channel_id);",
            connection))
        {
            cleanup.Parameters.Add(new NpgsqlParameter("cutoff", NpgsqlDbType.TimestampTz) { Value = RetentionCutoff() });
            await cleanup.ExecuteNonQueryAsync(token);
        }

        int restored = 0;
        await using (var cmd = new NpgsqlCommand(@"
            SELECT channel_id, job_file, step_number, step_name, station_id, step_type,
                   spec_min, spec_max, sample_values, sample_pids, sample_times
            FROM cpk_current", connection))
        await using (var reader = await cmd.ExecuteReaderAsync(token))
        {
            while (await reader.ReadAsync(token))
            {
                var key = new CpkKey(reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3));
                _engine.Restore(key, reader.GetInt32(4),
                    reader.IsDBNull(5) ? null : reader.GetString(5),
                    reader.IsDBNull(6) ? null : reader.GetDouble(6),
                    reader.IsDBNull(7) ? null : reader.GetDouble(7),
                    reader.GetFieldValue<double[]>(8),
                    reader.GetFieldValue<string[]>(9),
                    reader.GetFieldValue<DateTime[]>(10));
                restored++;
            }
        }
        _engine.RebuildOverview();

        await using (var exists = new NpgsqlCommand("SELECT to_regclass('public.cpk_current_previous') IS NOT NULL", connection))
        {
            if (await exists.ExecuteScalarAsync(token) is true)
            {
                var previous = new List<(CpkKey, int, string?, double?, double?, double[], string[], DateTime[])>();
                await using var cmd = new NpgsqlCommand(@"
                    SELECT channel_id, job_file, step_number, step_name, station_id, step_type,
                           spec_min, spec_max, sample_values, sample_pids, sample_times
                    FROM cpk_current_previous", connection);
                await using var reader = await cmd.ExecuteReaderAsync(token);
                while (await reader.ReadAsync(token))
                    previous.Add((new CpkKey(reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3)),
                        reader.GetInt32(4), reader.IsDBNull(5) ? null : reader.GetString(5),
                        reader.IsDBNull(6) ? null : reader.GetDouble(6), reader.IsDBNull(7) ? null : reader.GetDouble(7),
                        reader.GetFieldValue<double[]>(8), reader.GetFieldValue<string[]>(9), reader.GetFieldValue<DateTime[]>(10)));
                _engine.LoadPrevious(previous);
                _logger.LogInformation("CPK rebuild in progress: {Keys} previous results stay visible until it completes.", previous.Count);
            }
        }
        _nextPrune = DateTime.UtcNow.AddHours(1);
        _logger.LogInformation("CPK engine restored {Keys} keys from cpk_current.", restored);
    }

    private async Task PruneAsync(CancellationToken token)
    {
        _nextPrune = DateTime.UtcNow.AddHours(1);
        var cutoff = RetentionCutoff();
        var removed = _engine.PruneStale(cutoff);
        if (removed.Count == 0) return;
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await connection.OpenAsync(token);
        // Same rule as the engine: idle keys go only where the Channel has a fresh CPK.
        await using (var cmd = new NpgsqlCommand(@"
            DELETE FROM cpk_current c WHERE c.last_time < @cutoff
              AND EXISTS (SELECT 1 FROM cpk_current f WHERE f.channel_id = c.channel_id
                          AND f.last_time >= @cutoff AND f.status = 'READY')", connection))
        {
            cmd.Parameters.Add(new NpgsqlParameter("cutoff", NpgsqlDbType.TimestampTz) { Value = cutoff });
            await cmd.ExecuteNonQueryAsync(token);
        }
        foreach (var key in removed) _lastBroadcast.Remove(key.ChannelId);
        _logger.LogInformation("CPK engine pruned {Keys} idle keys.", removed.Count);
    }

    private DateTime RetentionCutoff() => DateTime.UtcNow.AddDays(-Math.Max(1, Options.BootstrapDays));

    /// <summary>Channels whose recent history has not been loaded yet.</summary>
    private async Task<List<(int ChannelId, int StationId)>> LoadBootstrapPlanAsync(CancellationToken token)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await connection.OpenAsync(token);
        var plan = new List<(int, int)>();
        await using var cmd = new NpgsqlCommand(@"
            SELECT c.id, c.station_id FROM channels c
            WHERE NOT EXISTS (SELECT 1 FROM cpk_bootstrap_channel b WHERE b.channel_id = c.id)
            ORDER BY c.id", connection);
        await using var reader = await cmd.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) plan.Add((reader.GetInt32(0), reader.GetInt32(1)));
        return plan;
    }

    /// <summary>
    /// Loads one Channel's recent samples (within BootstrapDays): pages back through its
    /// OK PCBs until every step it measures has a full window. Each page is an index seek
    /// on (channel_id, inspect_time), so this never scans a whole Station's history.
    /// </summary>
    private async Task RunBootstrapChannelAsync(int channelId, int stationId, CancellationToken token)
    {
        var now = DateTime.UtcNow;
        var used = await PageChannelHistoryAsync(channelId, stationId, now.AddMinutes(5),
            now.AddDays(-Math.Max(1, Options.BootstrapDays)), () => _engine.ChannelKeysFull(channelId),
            BootstrapMaxPages, giveUpWithoutMeasurements: false, token);
        _logger.LogDebug("CPK bootstrap Channel {ChannelId}: {Used} samples applied.", channelId, used.Used);
    }

    /// <summary>Replaces the previous results with the rebuilt ones and drops the copy.</summary>
    private async Task FinishRebuildAsync(CancellationToken token)
    {
        await FlushAsync(token); // make sure the last bootstrap/fallback samples are published
        var changes = _engine.EndRebuild();
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("DROP TABLE IF EXISTS cpk_current_previous", token);
        }
        foreach (var row in changes)
        {
            if (row.Cpk == null && string.IsNullOrEmpty(row.StepName)) _lastBroadcast.Remove(row.ChannelId);
            else _lastBroadcast[row.ChannelId] = row;
        }
        if (changes.Count > 0)
        {
            try { await _hub.Clients.All.ReceiveCpkUpdate(changes); }
            catch (Exception ex) { _logger.LogWarning(ex, "CPK SignalR broadcast after rebuild failed."); }
        }
        _logger.LogInformation("CPK rebuild completed; previous results released ({Changes} channels updated).", changes.Count);
    }

    /// <summary>Channels without a CPK that have not searched older history yet.</summary>
    private async Task<List<(int ChannelId, int StationId)>> LoadFallbackPlanAsync(CancellationToken token)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await connection.OpenAsync(token);
        var plan = new List<(int, int)>();
        await using var cmd = new NpgsqlCommand(@"
            SELECT c.id, c.station_id FROM channels c
            WHERE NOT EXISTS (SELECT 1 FROM cpk_fallback_state f WHERE f.channel_id = c.id)
            ORDER BY c.id", connection);
        await using var reader = await cmd.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
        {
            var channelId = reader.GetInt32(0);
            if (!_engine.ChannelHasReady(channelId)) plan.Add((channelId, reader.GetInt32(1)));
        }
        return plan;
    }

    private const int PageSize = 200, EmptyPagesToGiveUp = 2;
    // Recent window: read up to 5,000 OK PCBs per Channel and never give up early, so a
    // Channel running a job without measurements still reaches its older measured job.
    private const int BootstrapMaxPages = 25;
    // Older history (fallback): at most 2,000 PCBs and stop early on pages without
    // measurements, so Stations that never upload values are not scanned for years.
    private const int FallbackMaxPages = 10;
    // Bump to re-run the per-Channel bootstrap once (keeps the CPK results).
    private const string BootstrapVersion = "2";

    /// <summary>
    /// History older than the bootstrap window for a Channel still without CPK; stops as
    /// soon as the Channel has a reportable study.
    /// </summary>
    private async Task<bool> RunFallbackAsync(int channelId, int stationId, CancellationToken token)
    {
        var result = await PageChannelHistoryAsync(channelId, stationId,
            DateTime.UtcNow.AddDays(-Math.Max(1, Options.BootstrapDays)),
            new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc), () => _engine.ChannelHasReady(channelId),
            FallbackMaxPages, giveUpWithoutMeasurements: true, token);
        if (result.Stopped)
            _logger.LogInformation("CPK history fallback: Channel {ChannelId} recovered a CPK study ({Used} samples).", channelId, result.Used);
        return result.Stopped;
    }

    /// <summary>
    /// Walks one Channel's OK PCBs backwards from <paramref name="cursor"/> to
    /// <paramref name="floor"/>, 200 at a time (index seek with LIMIT, then only those
    /// PCBs' steps), feeding the engine until <paramref name="done"/> is true. Gives up
    /// early when the first pages carry no measurements (the tester never uploads them).
    /// </summary>
    private async Task<(bool Stopped, int Used)> PageChannelHistoryAsync(int channelId, int stationId,
        DateTime cursor, DateTime floor, Func<bool> done, int maxPages, bool giveUpWithoutMeasurements,
        CancellationToken token)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await connection.OpenAsync(token);

        int used = 0, emptyPages = 0;
        for (var page = 0; page < maxPages; page++)
        {
            var ids = new List<Guid>();
            var meta = new Dictionary<Guid, (string Pid, DateTime Time, string Job)>();
            await using (var cmd = new NpgsqlCommand(@"
                SELECT pr.id, pr.pid, pr.inspect_time, COALESCE(pr.job_file, '')
                FROM pcb_results pr
                WHERE pr.channel_id = @channel AND pr.inspect_time < @cursor AND pr.inspect_time > @floor
                  AND pr.result IN ('OK', 'PASS')
                ORDER BY pr.inspect_time DESC
                LIMIT @limit", connection) { CommandTimeout = 300 })
            {
                cmd.Parameters.AddWithValue("channel", channelId);
                cmd.Parameters.Add(new NpgsqlParameter("cursor", NpgsqlDbType.TimestampTz) { Value = cursor });
                cmd.Parameters.Add(new NpgsqlParameter("floor", NpgsqlDbType.TimestampTz) { Value = floor });
                cmd.Parameters.AddWithValue("limit", PageSize);
                await using var reader = await cmd.ExecuteReaderAsync(token);
                while (await reader.ReadAsync(token))
                {
                    var id = reader.GetGuid(0);
                    var time = CpkEngine.ToUtc(reader.GetDateTime(2));
                    ids.Add(id);
                    meta[id] = (reader.IsDBNull(1) ? string.Empty : reader.GetString(1), time, reader.GetString(3));
                    if (time < cursor) cursor = time;
                }
            }
            if (ids.Count == 0) break;

            await using (var cmd = new NpgsqlCommand($@"
                SELECT ts.pcb_result_id, ts.step_number, ts.step_name, ts.step_type, ts.value, ts.spec_min, ts.spec_max, ts.result
                FROM test_steps ts
                WHERE ts.pcb_result_id = ANY(@ids)
                  AND UPPER(BTRIM(COALESCE(ts.result, ''))) IN ('OK', 'PASS', '')
                  AND BTRIM(ts.spec_min) ~ '{NumericPattern}'
                  AND BTRIM(ts.spec_max) ~ '{NumericPattern}'
                  AND BTRIM(ts.value) ~ '{NumericPattern}'", connection) { CommandTimeout = 300 })
            {
                cmd.Parameters.AddWithValue("ids", ids.ToArray());
                await using var reader = await cmd.ExecuteReaderAsync(token);
                while (await reader.ReadAsync(token))
                {
                    var pcb = meta[reader.GetGuid(0)];
                    var step = new CpkStepInput(reader.GetInt32(1), reader.GetString(2),
                        reader.IsDBNull(3) ? null : reader.GetString(3),
                        reader.IsDBNull(4) ? null : reader.GetString(4),
                        reader.IsDBNull(5) ? null : reader.GetString(5),
                        reader.IsDBNull(6) ? null : reader.GetString(6),
                        reader.IsDBNull(7) ? null : reader.GetString(7));
                    if (_engine.AddSample(stationId, channelId, pcb.Job, step, pcb.Pid, pcb.Time)) used++;
                }
            }
            if (done()) return (true, used);
            if (giveUpWithoutMeasurements && used == 0 && ++emptyPages >= EmptyPagesToGiveUp) break;
            if (ids.Count < PageSize) break;
        }
        return (false, used);
    }

    private static NpgsqlParameter Num(string name, double? value) =>
        new(name, NpgsqlDbType.Double) { Value = value.HasValue && double.IsFinite(value.Value) ? value.Value : DBNull.Value };

    private static string? Truncate(string? value, int max) =>
        value == null || value.Length <= max ? value : value[..max];
}
