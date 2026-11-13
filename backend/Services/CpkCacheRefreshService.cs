using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services;

public sealed class CpkCacheRefreshService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IMemoryCache _memoryCache;
    private readonly ILogger<CpkCacheRefreshService> _logger;
    public CpkCacheRefreshService(IServiceScopeFactory scopeFactory, IMemoryCache memoryCache, ILogger<CpkCacheRefreshService> logger)
    { _scopeFactory = scopeFactory; _memoryCache = memoryCache; _logger = logger; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await CreateDailySnapshotsAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { _logger.LogWarning(ex, "Daily CPK snapshot job failed."); }

            var now = DateTime.Now;
            var nextRun = now.Date.AddDays(1).AddMinutes(5);
            await Task.Delay(nextRun - now, stoppingToken);
        }
    }

    private async Task CreateDailySnapshotsAsync(CancellationToken token)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var pcbService = scope.ServiceProvider.GetRequiredService<IPcbService>();
        var calculationDate = DateOnly.FromDateTime(DateTime.Now);
        var rules = await db.Stations.AsNoTracking()
            .Where(s => s.CpkStepNumber != null && s.CpkStepName != null && s.CpkJobFile != null)
            .Select(s => new { s.Id, StepNumber = s.CpkStepNumber!.Value, StepName = s.CpkStepName!, JobFile = s.CpkJobFile! })
            .ToListAsync(token);
        int created = 0, skipped = 0;

        foreach (var rule in rules)
        {
            var channelIds = await db.Channels.AsNoTracking().Where(c => c.StationId == rule.Id)
                .Select(c => c.Id).ToListAsync(token);
            foreach (var channelId in channelIds)
            {
                token.ThrowIfCancellationRequested();
                bool exists = await db.CpkResultHistory.AsNoTracking().AnyAsync(h =>
                    h.CalculationDate == calculationDate && h.ChannelId == channelId
                    && h.JobFile == rule.JobFile && h.StepNumber == rule.StepNumber
                    && h.StepName == rule.StepName && h.SampleCount >= 50 && h.Cpk != null, token);
                if (exists) { skipped++; continue; }

                await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    db.ChangeTracker.Clear();
                    await using var transaction = await db.Database.BeginTransactionAsync(token);
                    var analysis = await pcbService.GetCpkAnalysisAsync(channelId, rule.StepNumber,
                        rule.StepName, rule.JobFile, 50, forceRefresh: true);
                    await db.RawCpk.Where(r => r.CalculationDate == calculationDate && r.ChannelId == channelId
                        && r.JobFile == rule.JobFile && r.StepNumber == rule.StepNumber && r.StepName == rule.StepName)
                        .ExecuteDeleteAsync(token);

                    if (analysis.SpecMin.HasValue && analysis.SpecMax.HasValue)
                    {
                        db.RawCpk.AddRange(analysis.Points.Select(p => new RawCpk {
                            CalculationDate = calculationDate, StationId = rule.Id, ChannelId = channelId,
                            JobFile = rule.JobFile, StepNumber = rule.StepNumber, StepName = rule.StepName,
                            Pid = p.Pid, Value = p.Value, SpecMin = analysis.SpecMin.Value,
                            SpecMax = analysis.SpecMax.Value, InspectTime = p.InspectTime, RefreshedAt = DateTime.UtcNow
                        }));
                    }

                    string status = analysis.SampleCount < 50 ? "INSUFFICIENT_DATA"
                        : !analysis.SpecMin.HasValue || !analysis.SpecMax.HasValue ? "INVALID_SPEC"
                        : analysis.StandardDeviation is null or <= 0 ? "ZERO_VARIANCE" : "READY";
                    var snapshot = await db.CpkResultHistory.FirstOrDefaultAsync(h =>
                        h.CalculationDate == calculationDate && h.ChannelId == channelId
                        && h.JobFile == rule.JobFile && h.StepNumber == rule.StepNumber
                        && h.StepName == rule.StepName, token);
                    if (snapshot == null)
                    {
                        snapshot = new CpkResultHistory {
                            CalculationDate = calculationDate, StationId = rule.Id, ChannelId = channelId,
                            JobFile = rule.JobFile, StepNumber = rule.StepNumber, StepName = rule.StepName
                        };
                        db.CpkResultHistory.Add(snapshot);
                    }
                    snapshot.PeriodStart = analysis.FromDate; snapshot.PeriodEnd = DateTime.UtcNow;
                    snapshot.SampleCount = analysis.SampleCount; snapshot.SpecMin = analysis.SpecMin;
                    snapshot.SpecMax = analysis.SpecMax; snapshot.Mean = analysis.Mean;
                    snapshot.StandardDeviation = analysis.StandardDeviation;
                    snapshot.Cpl = analysis.Cpl; snapshot.Cpu = analysis.Cpu; snapshot.Cpk = analysis.Cpk;
                    snapshot.Status = status; snapshot.CalculatedAt = DateTime.UtcNow;
                    await db.SaveChangesAsync(token);
                    await transaction.CommitAsync(token);
                });
                created++;
            }
        }
        _memoryCache.Remove("cpk-overview-latest-history");
        _logger.LogInformation("Daily CPK snapshot completed. Date={Date}, Created={Created}, Skipped={Skipped}.", calculationDate, created, skipped);
    }
}
