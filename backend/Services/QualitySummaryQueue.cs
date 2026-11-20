using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PMSystem2.Api.Data;

namespace PMSystem2.Api.Services;

/// <summary>
/// PIDs whose NTF/RTY quality summaries must be recalculated. Upload requests only
/// enqueue (never block); <see cref="QualitySummaryService"/> refreshes them in the
/// background, so slow summary queries can no longer time out machine uploads.
/// </summary>
public sealed class QualitySummaryQueue
{
    private const int Capacity = 500_000;
    private readonly Channel<string> _channel = Channel.CreateBounded<string>(
        new BoundedChannelOptions(Capacity) { SingleReader = true, FullMode = BoundedChannelFullMode.DropWrite });
    private readonly ILogger<QualitySummaryQueue> _logger;
    private long _dropped;
    private DateTime _lastDropLog = DateTime.MinValue;

    public QualitySummaryQueue(ILogger<QualitySummaryQueue> logger) => _logger = logger;

    internal ChannelReader<string> Reader => _channel.Reader;

    public void Enqueue(IEnumerable<string> pids)
    {
        foreach (var pid in pids)
        {
            if (string.IsNullOrWhiteSpace(pid)) continue;
            if (_channel.Writer.TryWrite(pid.Trim())) continue;
            var dropped = Interlocked.Increment(ref _dropped);
            if (DateTime.UtcNow - _lastDropLog > TimeSpan.FromMinutes(1))
            {
                _lastDropLog = DateTime.UtcNow;
                _logger.LogWarning("Quality summary queue is full; {Dropped} PIDs skipped since start (summaries are rebuilt by later uploads).", dropped);
            }
        }
    }

    /// <summary>Puts PIDs back after a failed refresh so they are retried.</summary>
    internal void Requeue(IEnumerable<string> pids)
    {
        foreach (var pid in pids) _channel.Writer.TryWrite(pid);
    }
}

/// <summary>
/// Single background consumer: collects queued PIDs for a short moment, de-duplicates
/// them and rewrites their pcb_ntf_summaries / pcb_rty_summaries rows in chunks.
/// Being the only writer, it needs no lock against concurrent uploads.
/// </summary>
public sealed class QualitySummaryService : BackgroundService
{
    private const int ChunkSize = 200;
    private const int MaxPidsPerCycle = 5_000;
    private static readonly TimeSpan BatchWindow = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(120);

    private static bool IsTransient(Exception ex)
    {
        for (Exception? current = ex; current != null; current = current.InnerException)
        {
            if (current is TimeoutException) return true;
            if (current is PostgresException pg &&
                (pg.SqlState == PostgresErrorCodes.QueryCanceled || pg.SqlState == PostgresErrorCodes.DeadlockDetected ||
                 pg.SqlState == PostgresErrorCodes.LockNotAvailable)) return true;
        }
        return false;
    }

    private readonly QualitySummaryQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<QualitySummaryService> _logger;

    public QualitySummaryService(QualitySummaryQueue queue, IServiceScopeFactory scopeFactory, ILogger<QualitySummaryService> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var reader = _queue.Reader;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!await reader.WaitToReadAsync(stoppingToken)) break;
                // Let a burst of uploads accumulate so each PID is refreshed once.
                await Task.Delay(BatchWindow, stoppingToken);

                var pids = new HashSet<string>(StringComparer.Ordinal);
                while (pids.Count < MaxPidsPerCycle && reader.TryRead(out var pid)) pids.Add(pid);
                if (pids.Count == 0) continue;

                var ordered = pids.OrderBy(p => p, StringComparer.Ordinal).ToArray();
                var done = 0;
                try
                {
                    await using var scope = _scopeFactory.CreateAsyncScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    // Normally well under a second; allow for a busy disk (bulk rescans).
                    db.Database.SetCommandTimeout(CommandTimeout);
                    foreach (var chunk in ordered.Chunk(ChunkSize))
                    {
                        await RefreshAsync(db, chunk, stoppingToken);
                        done += chunk.Length;
                    }
                }
                catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                {
                    _queue.Requeue(ordered.Skip(done));
                    if (IsTransient(ex))
                        // Timeout or deadlock while the database is busy: expected, no stack trace.
                        _logger.LogWarning("Quality summary refresh postponed for {Count} PIDs (database busy: {Reason}); retrying in {Delay}.",
                            ordered.Length - done, ex.GetBaseException().Message, RetryDelay);
                    else
                        _logger.LogWarning(ex, "Quality summary refresh failed for {Count} PIDs; retrying in {Delay}.",
                            ordered.Length - done, RetryDelay);
                    await Task.Delay(RetryDelay, stoppingToken);
                }
                finally
                {
                    // Dashboards cache NTF/RTY by this version; invalidate after any change.
                    if (done > 0) PcbService.MarkQualitySummariesChanged();
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Quality summary worker cycle failed.");
                try { await Task.Delay(RetryDelay, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    /// <summary>Recomputes the NTF (per PID and Station) and RTY (per PID) summaries.</summary>
    private static Task RefreshAsync(AppDbContext db, string[] pids, CancellationToken token)
    {
        var pidParameter = new NpgsqlParameter<string[]>("affected_pids", pids);
        return db.Database.ExecuteSqlRawAsync(@"
            DELETE FROM pcb_ntf_summaries WHERE pid = ANY (@affected_pids);
            DELETE FROM pcb_rty_summaries WHERE pid = ANY (@affected_pids);

            WITH valid_results AS (
                SELECT p.pid, p.station_id, p.inspect_time, p.result, p.job_file, p.model_id, p.error_code, p.channel_id
                FROM pcb_results p
                LEFT JOIN job_file_model_mappings mapping ON mapping.job_file = p.job_file
                WHERE p.pid = ANY (@affected_pids)
                  AND p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED'
                  AND isfinite(p.inspect_time)          -- start time not readable from the log
                  AND COALESCE(p.error_code, '') !~* 'CHANGE[_.]JOB'   -- a job change is not a test
                  -- Effective model = current job-file mapping, else the stored model id.
                  AND COALESCE(mapping.model_id, p.model_id) IS DISTINCT FROM 0
            )
            INSERT INTO pcb_ntf_summaries
                (pid, station_id, first_test_time, last_test_time, test_count, ng_count, ever_ng, updated_at, job_file, model_id,
                 first_ng_error_code, first_ng_channel_id)
            SELECT pid, station_id, MIN(inspect_time), MAX(inspect_time), COUNT(*),
                   COUNT(*) FILTER (WHERE result IN ('NG', 'FAIL')),
                   BOOL_OR(result IN ('NG', 'FAIL')), NOW(),
                   (array_agg(job_file ORDER BY inspect_time DESC))[1],
                   (array_agg(model_id ORDER BY inspect_time DESC))[1],
                   (array_agg(error_code ORDER BY inspect_time) FILTER (WHERE result IN ('NG', 'FAIL')))[1],
                   (array_agg(channel_id ORDER BY inspect_time) FILTER (WHERE result IN ('NG', 'FAIL')))[1]
            FROM valid_results
            GROUP BY pid, station_id;

            WITH valid_results AS (
                SELECT p.pid, p.station_id, p.inspect_time, p.result, p.job_file, p.model_id, p.error_code, p.channel_id
                FROM pcb_results p
                LEFT JOIN job_file_model_mappings mapping ON mapping.job_file = p.job_file
                WHERE p.pid = ANY (@affected_pids)
                  AND p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED'
                  AND isfinite(p.inspect_time)          -- start time not readable from the log
                  AND COALESCE(p.error_code, '') !~* 'CHANGE[_.]JOB'   -- a job change is not a test
                  -- Effective model = current job-file mapping, else the stored model id.
                  AND COALESCE(mapping.model_id, p.model_id) IS DISTINCT FROM 0
            )
            INSERT INTO pcb_rty_summaries
                (pid, first_test_time, last_test_time, station_count, test_count, ng_count, ever_ng, updated_at)
            SELECT pid, MIN(inspect_time), MAX(inspect_time), COUNT(DISTINCT station_id), COUNT(*),
                   COUNT(*) FILTER (WHERE result IN ('NG', 'FAIL')),
                   BOOL_OR(result IN ('NG', 'FAIL')), NOW()
            FROM valid_results
            GROUP BY pid;
        ", new object[] { pidParameter }, token);
    }
}
