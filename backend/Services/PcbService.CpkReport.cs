using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services;

public partial class PcbService
{
    // The report uses the same incremental CPK results as the CPK page (latest
    // 50 OK samples per Channel/Job/Step, at least 30), so both always agree.
    public async Task<byte[]> GetCpkReportAsync(CancellationToken cancellationToken = default)
    {
        var overview = _cpkEngine.GetOverview().ToDictionary(row => row.ChannelId);
        var stations = await _db.Stations.AsNoTracking()
            .Include(s => s.Line).Include(s => s.ModelGroup).ToListAsync(cancellationToken);
        var channels = await _db.Channels.AsNoTracking().ToListAsync(cancellationToken);
        var stationIndex = stations.ToDictionary(s => s.Id);
        var reportStations = stations.Select(s => new CpkReportStation(
            s.LineId, s.Line?.Name ?? "", s.Id, s.Name, s.ModelGroup?.Name)).ToList();
        var reportStationIndex = reportStations.ToDictionary(s => s.StationId);
        var report = new List<CpkReportChannel>();
        foreach (var channel in channels)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!stationIndex.ContainsKey(channel.StationId)) continue;
            overview.TryGetValue(channel.Id, out var analysis);
            if (analysis != null)
                analysis = analysis with
                {
                    Cpk = analysis.Cpk is double cpk ? Math.Round(cpk, 3, MidpointRounding.AwayFromZero) : null,
                    Cpl = analysis.Cpl is double cpl ? Math.Round(cpl, 3, MidpointRounding.AwayFromZero) : null,
                    Cpu = analysis.Cpu is double cpu ? Math.Round(cpu, 3, MidpointRounding.AwayFromZero) : null,
                };
            report.Add(new CpkReportChannel(reportStationIndex[channel.StationId], channel.Id, channel.Name,
                analysis?.JobFile, analysis?.StepNumber, analysis?.StepName, analysis != null, analysis,
                Array.Empty<CpkPointDto>()));
        }
        report = report.OrderBy(c => c.Station.Line).ThenBy(c => c.Station.Station).ThenBy(c => c.Channel).ToList();
        return CpkReportWorkbook.Build(reportStations, report);
    }
}
