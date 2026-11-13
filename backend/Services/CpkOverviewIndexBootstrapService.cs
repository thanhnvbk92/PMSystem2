using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using PMSystem2.Api.Data;

namespace PMSystem2.Api.Services;

public static class CpkOverviewIndexState
{
    private static int _ready;
    public static bool IsReady => Volatile.Read(ref _ready) == 1;
    public static void MarkReady(bool ready) => Volatile.Write(ref _ready, ready ? 1 : 0);
}

public sealed class CpkOverviewIndexBootstrapService : BackgroundService
{
    private const string IndexName = "ix_pcb_results_cpk_overview_time";
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IMemoryCache _memoryCache;
    private readonly ILogger<CpkOverviewIndexBootstrapService> _logger;

    public CpkOverviewIndexBootstrapService(IServiceScopeFactory scopeFactory, IMemoryCache memoryCache,
        ILogger<CpkOverviewIndexBootstrapService> logger)
    {
        _scopeFactory = scopeFactory;
        _memoryCache = memoryCache;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested && !CpkOverviewIndexState.IsReady)
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Database.SetCommandTimeout(0);

                var indexValid = await db.Database.SqlQueryRaw<bool>($@"
                    SELECT COALESCE((
                        SELECT i.indisvalid
                        FROM pg_index i
                        WHERE i.indexrelid = to_regclass('public.{IndexName}')
                    ), TRUE) AS ""Value""").SingleAsync(stoppingToken);

                if (!indexValid)
                    await db.Database.ExecuteSqlRawAsync($"DROP INDEX CONCURRENTLY IF EXISTS {IndexName}", stoppingToken);

                await db.Database.ExecuteSqlRawAsync($@"
                    CREATE INDEX CONCURRENTLY IF NOT EXISTS {IndexName}
                    ON pcb_results (inspect_time)
                    INCLUDE (id, channel_id, job_file, result, pid)", stoppingToken);

                CpkOverviewIndexState.MarkReady(true);
                _memoryCache.Remove("cpk-overview-latest-history");
                _logger.LogInformation("CPK Overview time index is ready.");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "CPK Overview index setup is still pending; automatic CPK calculation will wait until it is ready.");
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }
    }
}
