using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;

namespace PMSystem2.Api.Services;

public sealed class CpkCatalogBackfillService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<CpkCatalogBackfillService> _logger;

    public CpkCatalogBackfillService(IServiceScopeFactory scopeFactory, ILogger<CpkCatalogBackfillService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Database.SetCommandTimeout(300);
            var stationIds = await db.Stations.AsNoTracking()
                .Select(s => s.Id).ToListAsync(stoppingToken);

            foreach (var stationId in stationIds)
            {
                stoppingToken.ThrowIfCancellationRequested();
                await db.Database.ExecuteSqlInterpolatedAsync($@"
                    DELETE FROM cpk_step_catalog
                    WHERE station_id = {stationId};

                    INSERT INTO cpk_step_catalog (station_id, job_file, step_number, step_name, step_type)
                    SELECT {stationId}, x.job_file, x.step_number, x.step_name, x.step_type
                    FROM (
                        SELECT DISTINCT ON (COALESCE(p.job_file, ''), t.step_number, t.step_name)
                               COALESCE(p.job_file, '') AS job_file, t.step_number, t.step_name, t.step_type
                        FROM test_steps t
                        INNER JOIN pcb_results p ON p.id = t.pcb_result_id
                        WHERE p.station_id = {stationId}
                          AND (p.result = 'OK' OR p.result = 'PASS')
                          AND NULLIF(BTRIM(t.value), '') IS NOT NULL
                          AND NULLIF(BTRIM(t.spec_min), '') IS NOT NULL
                          AND NULLIF(BTRIM(t.spec_max), '') IS NOT NULL
                        ORDER BY COALESCE(p.job_file, ''), t.step_number, t.step_name, t.id DESC
                    ) x
                    ON CONFLICT (station_id, job_file, step_number, step_name)
                    DO UPDATE SET step_type = EXCLUDED.step_type, updated_at = NOW()", stoppingToken);

                _logger.LogInformation("CPK Step catalog synchronized for Station #{StationId}.", stationId);
            }
            _logger.LogInformation("CPK Step catalog background backfill completed for {StationCount} Stations.", stationIds.Count);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("CPK Step catalog backfill stopped for application shutdown/reload.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "CPK Step catalog background backfill did not complete. New production data will continue populating the catalog.");
        }
    }
}
