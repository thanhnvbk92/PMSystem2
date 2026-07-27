using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services
{
    public interface IPcbService
    {
        Task<PcbResultDto> SubmitResultAsync(SubmitPcbRequest req);
        Task<List<PcbResultDto>> SubmitBatchAsync(List<SubmitPcbRequest> requests);
        Task<List<PcbResultDto>> GetLatestResultsAsync(int limit = 50, int? lineId = null, int? stationId = null, string? searchPid = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<int> GetExportCountAsync(int? lineId = null, int? stationId = null, string? searchPid = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<byte[]> GetExportCsvAsync(int? limit = null, int? lineId = null, int? stationId = null, string? searchPid = null, string? resultFilter = null, DateTime? startDate = null, DateTime? endDate = null);
        Task<List<HourlyStatDto>> GetHourlyStatsAsync(int hours = 24, int? lineId = null, int? stationId = null);
        Task<ProductionSummaryDto> GetSummaryAsync();
        Task<List<LineYieldStatDto>> GetLineYieldStatsAsync(int? lineId = null);
        Task<List<StationYieldStatDto>> GetStationYieldStatsAsync(int? lineId = null);
        Task<List<DefectParetoStatDto>> GetDefectParetoAsync(int? lineId = null, int? stationId = null);
    }

    public class PcbService : IPcbService
    {
        private readonly AppDbContext _db;
        private readonly IMasterDataService _masterDataService;
        private readonly IHubContext<ProductionHub, IProductionClient> _hubContext;
        private readonly ILogger<PcbService> _logger;

        public PcbService(
            AppDbContext db,
            IMasterDataService masterDataService,
            IHubContext<ProductionHub, IProductionClient> hubContext,
            ILogger<PcbService> logger)
        {
            _db = db;
            _masterDataService = masterDataService;
            _hubContext = hubContext;
            _logger = logger;
        }

        public async Task<PcbResultDto> SubmitResultAsync(SubmitPcbRequest req)
        {
            int channelId = req.ChannelId;
            var hierarchy = _masterDataService.GetChannelHierarchy(channelId);
            if (hierarchy == null)
            {
                // Fallback: If cache miss, refresh cache and try again
                await _masterDataService.RefreshCacheAsync();
                hierarchy = _masterDataService.GetChannelHierarchy(channelId);
            }

            if (hierarchy == null)
            {
                var channels = await _masterDataService.GetChannelsAsync();
                var fallbackChannel = channels.FirstOrDefault();
                if (fallbackChannel != null)
                {
                    channelId = fallbackChannel.Id;
                    hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                }
                else
                {
                    var stations = await _masterDataService.GetStationsAsync();
                    int stationId = stations.FirstOrDefault()?.Id ?? 1;
                    var newCh = await _masterDataService.CreateChannelAsync(new CreateChannelRequest(stationId, "Default Channel", IpAddress: "127.0.0.1"));
                    channelId = newCh.Id;
                    hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                }
            }

            if (hierarchy == null)
            {
                throw new ArgumentException($"Unable to resolve channel hierarchy for Channel ID {req.ChannelId}.");
            }

            var normalizedResult = req.Result.ToUpperInvariant();
            var rawInspectTime = req.InspectTime ?? req.StartTime ?? DateTime.UtcNow;
            var inspectTime = EnsureUtc(rawInspectTime);

            // Calculate ErrorCode: First NG step name if NG/FAIL, else null if OK
            string? computedErrorCode = null;
            if (normalizedResult == "NG" || normalizedResult == "FAIL")
            {
                var firstNgStep = req.Steps?.FirstOrDefault(s =>
                    !string.Equals(s.Result, "OK", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(s.Result, "PASS", StringComparison.OrdinalIgnoreCase));

                if (firstNgStep != null)
                {
                    computedErrorCode = !string.IsNullOrWhiteSpace(firstNgStep.StepName)
                        ? firstNgStep.StepName
                        : (!string.IsNullOrWhiteSpace(firstNgStep.Value) ? firstNgStep.Value : "DEFECT_UNSPECIFIED");
                }
                else
                {
                    computedErrorCode = !string.IsNullOrWhiteSpace(req.ErrorCode) ? req.ErrorCode : "DEFECT_UNSPECIFIED";
                }
            }

            // Deduplication Check
            var existingRecord = await _db.PcbResults
                .Include(p => p.TestSteps)
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.StationId == hierarchy.StationId && p.Pid == req.Pid && p.InspectTime == inspectTime);

            if (existingRecord != null)
            {
                _logger.LogWarning("[DEDUPLICATION] Duplicate PCB result ignored for PID: {Pid}, StationId: {StationId}, InspectTime: {InspectTime}",
                    req.Pid, hierarchy.StationId, inspectTime);

                return new PcbResultDto(
                    existingRecord.Id,
                    existingRecord.ChannelId,
                    hierarchy.ChannelName,
                    hierarchy.IpAddress,
                    existingRecord.StationId,
                    hierarchy.StationName,
                    hierarchy.LineId,
                    hierarchy.LineName,
                    existingRecord.Pid,
                    existingRecord.Result,
                    existingRecord.ErrorCode,
                    existingRecord.GmesStatus,
                    existingRecord.InspectTime,
                    existingRecord.CreatedAt,
                    existingRecord.JobFile,
                    existingRecord.ModelId,
                    null,
                    existingRecord.Fid,
                    existingRecord.PcbaPartNo,
                    existingRecord.StartTime,
                    existingRecord.EndTime,
                    existingRecord.TestTime,
                    existingRecord.FilePath,
                    existingRecord.TestSteps.OrderBy(t => t.StepNumber).Select(t => new TestStepInputDto
                    {
                        StepType = t.StepType,
                        StepNumber = t.StepNumber,
                        StepName = t.StepName,
                        Result = t.Result,
                        Value = t.Value,
                        SpecMin = t.SpecMin,
                        SpecMax = t.SpecMax
                    }).ToList()
                );
            }

            var entity = new PcbResult
            {
                ChannelId = channelId,
                StationId = hierarchy.StationId,
                Pid = req.Pid,
                JobFile = req.JobFile,
                ModelId = req.ModelId,
                Fid = req.Fid,
                PcbaPartNo = req.PcbaPartNo,
                StartTime = req.StartTime.HasValue ? EnsureUtc(req.StartTime.Value) : inspectTime,
                EndTime = EnsureUtc(req.EndTime),
                TestTime = req.TestTime,
                FilePath = req.FilePath,
                Result = normalizedResult,
                ErrorCode = computedErrorCode,
                GmesStatus = req.GmesStatus,
                InspectTime = inspectTime,
                CreatedAt = DateTime.UtcNow
            };

            if (req.Steps != null && req.Steps.Count > 0)
            {
                foreach (var s in req.Steps)
                {
                    entity.TestSteps.Add(new TestStep
                    {
                        StepType = s.StepType,
                        StepNumber = s.StepNumber,
                        StepName = s.StepName,
                        Result = s.Result.ToUpperInvariant(),
                        Value = s.Value,
                        SpecMin = s.SpecMin,
                        SpecMax = s.SpecMax
                    });
                }
            }

            try
            {
                _db.PcbResults.Add(entity);
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "[DEDUPLICATION] DB Unique constraint prevented inserting duplicate PCB result for PID: {Pid}", req.Pid);
                _db.Entry(entity).State = EntityState.Detached;

                // Fallback: Fetch existing record
                var duplicate = await _db.PcbResults
                    .AsNoTracking()
                    .FirstOrDefaultAsync(p => p.StationId == hierarchy.StationId && p.Pid == req.Pid && p.InspectTime == inspectTime);

                return new PcbResultDto(
                    duplicate?.Id ?? entity.Id,
                    channelId,
                    hierarchy.ChannelName,
                    hierarchy.IpAddress,
                    hierarchy.StationId,
                    hierarchy.StationName,
                    hierarchy.LineId,
                    hierarchy.LineName,
                    req.Pid,
                    normalizedResult,
                    computedErrorCode,
                    duplicate?.GmesStatus ?? req.GmesStatus,
                    inspectTime,
                    duplicate?.CreatedAt ?? entity.CreatedAt,
                    duplicate?.JobFile ?? req.JobFile,
                    duplicate?.ModelId ?? req.ModelId,
                    null,
                    duplicate?.Fid ?? req.Fid,
                    duplicate?.PcbaPartNo ?? req.PcbaPartNo,
                    duplicate?.StartTime ?? entity.StartTime,
                    duplicate?.EndTime ?? entity.EndTime,
                    duplicate?.TestTime ?? entity.TestTime,
                    duplicate?.FilePath ?? entity.FilePath,
                    req.Steps ?? new List<TestStepInputDto>()
                );
            }

            var dto = new PcbResultDto(
                entity.Id,
                entity.ChannelId,
                hierarchy.ChannelName,
                hierarchy.IpAddress,
                entity.StationId,
                hierarchy.StationName,
                hierarchy.LineId,
                hierarchy.LineName,
                entity.Pid,
                entity.Result,
                entity.ErrorCode,
                entity.GmesStatus,
                entity.InspectTime,
                entity.CreatedAt,
                entity.JobFile,
                entity.ModelId,
                null,
                entity.Fid,
                entity.PcbaPartNo,
                entity.StartTime,
                entity.EndTime,
                entity.TestTime,
                entity.FilePath,
                req.Steps ?? new List<TestStepInputDto>()
            );

            // Broadcast via SignalR to all connected clients & target groups
            await _hubContext.Clients.All.ReceivePcbResult(dto);
            await _hubContext.Clients.Group($"Line_{hierarchy.LineId}").ReceivePcbResult(dto);
            await _hubContext.Clients.Group($"Station_{entity.StationId}").ReceivePcbResult(dto);

            return dto;
        }

        public async Task<List<PcbResultDto>> SubmitBatchAsync(List<SubmitPcbRequest> requests)
        {
            if (requests == null || requests.Count == 0)
                return new List<PcbResultDto>();

            var resultDtos = new List<PcbResultDto>();
            var newEntities = new List<PcbResult>();

            foreach (var req in requests)
            {
                int channelId = req.ChannelId;
                var hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                if (hierarchy == null)
                {
                    await _masterDataService.RefreshCacheAsync();
                    hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                }

                if (hierarchy == null)
                {
                    var channels = await _masterDataService.GetChannelsAsync();
                    var fallbackChannel = channels.FirstOrDefault();
                    if (fallbackChannel != null)
                    {
                        channelId = fallbackChannel.Id;
                        hierarchy = _masterDataService.GetChannelHierarchy(channelId);
                    }
                }

                if (hierarchy == null) continue;

                var normalizedResult = req.Result.ToUpperInvariant();
                var rawInspectTime = req.InspectTime ?? req.StartTime ?? DateTime.UtcNow;
                var inspectTime = EnsureUtc(rawInspectTime);

                string? computedErrorCode = null;
                if (normalizedResult == "NG" || normalizedResult == "FAIL")
                {
                    var firstNgStep = req.Steps?.FirstOrDefault(s =>
                        !string.Equals(s.Result, "OK", StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(s.Result, "PASS", StringComparison.OrdinalIgnoreCase));

                    if (firstNgStep != null)
                    {
                        computedErrorCode = !string.IsNullOrWhiteSpace(firstNgStep.StepName)
                            ? firstNgStep.StepName
                            : (!string.IsNullOrWhiteSpace(firstNgStep.Value) ? firstNgStep.Value : "DEFECT_UNSPECIFIED");
                    }
                    else
                    {
                        computedErrorCode = !string.IsNullOrWhiteSpace(req.ErrorCode) ? req.ErrorCode : "DEFECT_UNSPECIFIED";
                    }
                }

                var entity = new PcbResult
                {
                    ChannelId = channelId,
                    StationId = hierarchy.StationId,
                    Pid = req.Pid,
                    JobFile = req.JobFile,
                    ModelId = req.ModelId,
                    Fid = req.Fid,
                    PcbaPartNo = req.PcbaPartNo,
                    StartTime = req.StartTime.HasValue ? EnsureUtc(req.StartTime.Value) : inspectTime,
                    EndTime = EnsureUtc(req.EndTime),
                    TestTime = req.TestTime,
                    FilePath = req.FilePath,
                    Result = normalizedResult,
                    ErrorCode = computedErrorCode,
                    GmesStatus = req.GmesStatus,
                    InspectTime = inspectTime,
                    CreatedAt = DateTime.UtcNow
                };

                if (req.Steps != null && req.Steps.Count > 0)
                {
                    foreach (var s in req.Steps)
                    {
                        entity.TestSteps.Add(new TestStep
                        {
                            StepType = s.StepType,
                            StepNumber = s.StepNumber,
                            StepName = s.StepName,
                            Result = s.Result.ToUpperInvariant(),
                            Value = s.Value,
                            SpecMin = s.SpecMin,
                            SpecMax = s.SpecMax
                        });
                    }
                }

                newEntities.Add(entity);
            }

            if (newEntities.Count > 0)
            {
                try
                {
                    _db.PcbResults.AddRange(newEntities);
                    await _db.SaveChangesAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[BATCH SUBMIT] Bulk save encountered issue, falling back to individual insert");
                    foreach (var entity in newEntities)
                    {
                        _db.Entry(entity).State = EntityState.Detached;
                    }
                    newEntities.Clear();
                    foreach (var req in requests)
                    {
                        try
                        {
                            var dto = await SubmitResultAsync(req);
                            resultDtos.Add(dto);
                        }
                        catch { }
                    }
                    return resultDtos;
                }

                foreach (var entity in newEntities)
                {
                    var hierarchy = _masterDataService.GetChannelHierarchy(entity.ChannelId);
                    var dto = new PcbResultDto(
                        entity.Id,
                        entity.ChannelId,
                        hierarchy?.ChannelName ?? "Unknown",
                        hierarchy?.IpAddress ?? "127.0.0.1",
                        entity.StationId,
                        hierarchy?.StationName ?? "Unknown",
                        hierarchy?.LineId ?? 1,
                        hierarchy?.LineName ?? "Unknown",
                        entity.Pid,
                        entity.Result,
                        entity.ErrorCode,
                        entity.GmesStatus,
                        entity.InspectTime,
                        entity.CreatedAt,
                        entity.JobFile,
                        entity.ModelId,
                        null,
                        entity.Fid,
                        entity.PcbaPartNo,
                        entity.StartTime,
                        entity.EndTime,
                        entity.TestTime,
                        entity.FilePath,
                        entity.TestSteps.Select(t => new TestStepInputDto
                        {
                            StepType = t.StepType,
                            StepNumber = t.StepNumber,
                            StepName = t.StepName,
                            Result = t.Result,
                            Value = t.Value,
                            SpecMin = t.SpecMin,
                            SpecMax = t.SpecMax
                        }).ToList()
                    );
                    resultDtos.Add(dto);
                }

                var latestDto = resultDtos.LastOrDefault();
                if (latestDto != null)
                {
                    try
                    {
                        await _hubContext.Clients.All.ReceivePcbResult(latestDto);
                        await _hubContext.Clients.Group($"Line_{latestDto.LineId}").ReceivePcbResult(latestDto);
                        await _hubContext.Clients.Group($"Station_{latestDto.StationId}").ReceivePcbResult(latestDto);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to broadcast SignalR notification for batch submit");
                    }
                }
            }

            return resultDtos;
        }

        public async Task<List<PcbResultDto>> GetLatestResultsAsync(
            int limit = 50, 
            int? lineId = null, 
            int? stationId = null,
            string? searchPid = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }
            if (!string.IsNullOrWhiteSpace(searchPid))
            {
                var term = searchPid.Trim().ToLower();
                query = query.Where(p => p.Pid.ToLower().Contains(term));
            }
            if (!string.IsNullOrWhiteSpace(resultFilter) && resultFilter != "ALL")
            {
                if (resultFilter == "OK")
                {
                    query = query.Where(p => p.Result == "OK" || p.Result == "PASS");
                }
                else if (resultFilter == "NG")
                {
                    query = query.Where(p => p.Result == "NG" || p.Result == "FAIL");
                }
            }
            if (startDate.HasValue)
            {
                query = query.Where(p => p.InspectTime >= startDate.Value.ToUniversalTime());
            }
            if (endDate.HasValue)
            {
                query = query.Where(p => p.InspectTime <= endDate.Value.ToUniversalTime());
            }

            var list = await query
                .OrderByDescending(p => p.InspectTime)
                .Take(limit)
                .Include(p => p.TestSteps)
                .ToListAsync();

            var results = new List<PcbResultDto>();
            foreach (var item in list)
            {
                var hierarchy = _masterDataService.GetChannelHierarchy(item.ChannelId);
                results.Add(new PcbResultDto(
                    item.Id,
                    item.ChannelId,
                    hierarchy?.ChannelName ?? (item.ChannelId > 0 ? $"Channel #{item.ChannelId}" : "Unassigned Channel"),
                    hierarchy?.IpAddress ?? "",
                    item.StationId,
                    hierarchy?.StationName ?? (item.StationId > 0 ? $"Station #{item.StationId}" : "Unassigned Station"),
                    hierarchy?.LineId ?? 0,
                    hierarchy?.LineName ?? (hierarchy?.LineId > 0 ? $"Line #{hierarchy.LineId}" : "Unassigned Line"),
                    item.Pid,
                    item.Result,
                    item.ErrorCode,
                    item.GmesStatus,
                    item.InspectTime,
                    item.CreatedAt,
                    item.JobFile,
                    item.ModelId,
                    null,
                    item.Fid,
                    item.PcbaPartNo,
                    item.StartTime,
                    item.EndTime,
                    item.TestTime,
                    item.FilePath,
                    item.TestSteps.OrderBy(t => t.StepNumber).Select(t => new TestStepInputDto {
                        StepType = t.StepType,
                        StepNumber = t.StepNumber,
                        StepName = t.StepName,
                        Result = t.Result,
                        Value = t.Value,
                        SpecMin = t.SpecMin,
                        SpecMax = t.SpecMax
                    }).ToList()
                ));
            }

            return results;
        }

        public async Task<int> GetExportCountAsync(
            int? lineId = null,
            int? stationId = null,
            string? searchPid = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue) query = query.Where(p => p.StationId == stationId.Value);
            if (!string.IsNullOrWhiteSpace(searchPid))
            {
                var term = searchPid.Trim().ToLower();
                query = query.Where(p => p.Pid.ToLower().Contains(term));
            }
            if (!string.IsNullOrWhiteSpace(resultFilter) && resultFilter != "ALL")
            {
                if (resultFilter == "OK") query = query.Where(p => p.Result == "OK" || p.Result == "PASS");
                else if (resultFilter == "NG") query = query.Where(p => p.Result == "NG" || p.Result == "FAIL");
            }
            if (startDate.HasValue) query = query.Where(p => p.InspectTime >= startDate.Value.ToUniversalTime());
            if (endDate.HasValue) query = query.Where(p => p.InspectTime <= endDate.Value.ToUniversalTime());

            return await query.CountAsync();
        }

        public async Task<byte[]> GetExportCsvAsync(
            int? limit = null,
            int? lineId = null,
            int? stationId = null,
            string? searchPid = null,
            string? resultFilter = null,
            DateTime? startDate = null,
            DateTime? endDate = null)
        {
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue) query = query.Where(p => p.StationId == stationId.Value);
            if (!string.IsNullOrWhiteSpace(searchPid))
            {
                var term = searchPid.Trim().ToLower();
                query = query.Where(p => p.Pid.ToLower().Contains(term));
            }
            if (!string.IsNullOrWhiteSpace(resultFilter) && resultFilter != "ALL")
            {
                if (resultFilter == "OK") query = query.Where(p => p.Result == "OK" || p.Result == "PASS");
                else if (resultFilter == "NG") query = query.Where(p => p.Result == "NG" || p.Result == "FAIL");
            }
            if (startDate.HasValue) query = query.Where(p => p.InspectTime >= startDate.Value.ToUniversalTime());
            if (endDate.HasValue) query = query.Where(p => p.InspectTime <= endDate.Value.ToUniversalTime());

            query = query.OrderByDescending(p => p.InspectTime);

            if (limit.HasValue && limit.Value > 0)
            {
                query = query.Take(limit.Value);
            }

            var list = await query
                .Include(p => p.TestSteps)
                .ToListAsync();

            var sb = new System.Text.StringBuilder();
            sb.Append('\uFEFF'); // UTF-8 BOM for Excel compatibility

            sb.AppendLine("\"ID\",\"Mã PCB (PID)\",\"Tên Lỗi (Defect Name)\",\"Tên Channel (Máy)\",\"Địa chỉ IP Channel\",\"Dây Chuyền (Line)\",\"Trạm (Station)\",\"Ngày Test\",\"Giờ Test\",\"Kết quả (Result)\",\"JobFile / Model\",\"Chi tiết Lỗi (Failed Steps)\"");

            foreach (var item in list)
            {
                var hierarchy = _masterDataService.GetChannelHierarchy(item.ChannelId);
                var inspectTimeLocal = item.InspectTime.ToLocalTime();
                var dateStr = inspectTimeLocal.ToString("yyyy-MM-dd");
                var timeStr = inspectTimeLocal.ToString("HH:mm:ss");

                string jobFile = item.JobFile ?? "";
                if (string.IsNullOrWhiteSpace(jobFile) && !string.IsNullOrWhiteSpace(item.Pid))
                {
                    var parts = item.Pid.Split(new[] { '-', '_', '/' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length > 1) jobFile = parts[0];
                    else jobFile = item.Pid;
                }
                if (string.IsNullOrWhiteSpace(jobFile)) jobFile = "DEFAULT_JOB";

                string errorCode = item.ErrorCode ?? (item.Result == "NG" || item.Result == "FAIL" ? "DEFECT_UNSPECIFIED" : "OK");

                var failedSteps = item.TestSteps
                    .Where(t => t.Result != "OK" && t.Result != "PASS")
                    .Select(t => {
                        var name = t.StepName ?? "";
                        var val = !string.IsNullOrWhiteSpace(t.Value) ? t.Value : "NG";
                        var hasSpec = !string.IsNullOrWhiteSpace(t.SpecMin) || !string.IsNullOrWhiteSpace(t.SpecMax);
                        var specStr = hasSpec ? $" [Min: {t.SpecMin ?? "-"}, Max: {t.SpecMax ?? "-"}]" : "";
                        return string.IsNullOrEmpty(name) ? $"{val}{specStr}" : $"{name}: {val}{specStr}";
                    })
                    .ToList();
                string failedStepsStr = failedSteps.Count > 0 ? string.Join("; ", failedSteps) : (item.Result == "NG" ? (item.ErrorCode != null ? $"Lỗi hệ thống ({item.ErrorCode})" : "Lỗi tổng hợp") : "N/A");

                var channelName = hierarchy?.ChannelName ?? (item.ChannelId > 0 ? $"Channel #{item.ChannelId}" : "Unassigned Channel");
                var lineName = hierarchy?.LineName ?? (hierarchy?.LineId > 0 ? $"Line #{hierarchy.LineId}" : "Unassigned Line");
                var stationName = hierarchy?.StationName ?? (item.StationId > 0 ? $"Station #{item.StationId}" : "Unassigned Station");

                sb.AppendLine($"\"{item.Id}\",\"{EscapeCsv(item.Pid)}\",\"{EscapeCsv(errorCode)}\",\"{EscapeCsv(channelName)}\",\"{EscapeCsv(hierarchy?.IpAddress ?? "")}\",\"{EscapeCsv(lineName)}\",\"{EscapeCsv(stationName)}\",\"{dateStr}\",\"{timeStr}\",\"{item.Result}\",\"{EscapeCsv(jobFile)}\",\"{EscapeCsv(failedStepsStr)}\"");
            }

            return System.Text.Encoding.UTF8.GetBytes(sb.ToString());
        }

        private static string EscapeCsv(string str)
        {
            if (string.IsNullOrEmpty(str)) return "";
            return str.Replace("\"", "\"\"");
        }

        public async Task<List<HourlyStatDto>> GetHourlyStatsAsync(int hours = 24, int? lineId = null, int? stationId = null)
        {
            var query = _db.PcbResults.AsNoTracking();

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }

            var cutoff = DateTime.UtcNow.AddHours(-hours);
            query = query.Where(p => p.InspectTime >= cutoff);

            var list = await query
                .OrderByDescending(p => p.InspectTime)
                .ToListAsync();

            var grouped = list
                .GroupBy(p => new {
                    Date = p.InspectTime.Date,
                    Hour = p.InspectTime.Hour
                })
                .Select(g => {
                    var total = g.Count();
                    var ok = g.Count(x => x.Result == "OK" || x.Result == "PASS");
                    var ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL");
                    return new HourlyStatDto(
                        DateTime.SpecifyKind(g.Key.Date.AddHours(g.Key.Hour), DateTimeKind.Utc),
                        lineId ?? 0,
                        stationId ?? 0,
                        total,
                        ok,
                        ng,
                        total > 0 ? Math.Round((double)ok / total * 100.0, 2) : 0.0
                    );
                })
                .OrderBy(g => g.Bucket)
                .ToList();

            return grouped;
        }

        public async Task<ProductionSummaryDto> GetSummaryAsync()
        {
            var totalInspected = await _db.PcbResults.CountAsync();
            var totalOk = await _db.PcbResults.CountAsync(p => p.Result == "OK" || p.Result == "PASS");
            var totalNg = await _db.PcbResults.CountAsync(p => p.Result == "NG" || p.Result == "FAIL");

            var yieldRate = totalInspected > 0 ? Math.Round((double)totalOk / totalInspected * 100.0, 2) : 0.0;
            var activeChannels = (await _masterDataService.GetChannelsAsync()).Count(c => c.Status == "online");
            var recentHourly = await GetHourlyStatsAsync(12);

            return new ProductionSummaryDto(
                totalInspected,
                totalOk,
                totalNg,
                yieldRate,
                activeChannels,
                recentHourly
            );
        }

        public async Task<List<LineYieldStatDto>> GetLineYieldStatsAsync(int? lineId = null)
        {
            var stations = await _masterDataService.GetStationsAsync();
            var lines = await _masterDataService.GetLinesAsync();
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var lineStationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => lineStationIds.Contains(p.StationId));
            }

            var stationStats = await query
                .GroupBy(p => p.StationId)
                .Select(g => new {
                    StationId = g.Key,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .ToListAsync();

            var lineGroups = stationStats
                .Select(stStat => {
                    var st = stations.FirstOrDefault(s => s.Id == stStat.StationId);
                    return new { LineId = st?.LineId ?? 0, stStat.Total, stStat.Ok, stStat.Ng };
                })
                .GroupBy(x => x.LineId)
                .Select(g => new {
                    LineId = g.Key,
                    Total = g.Sum(x => x.Total),
                    Ok = g.Sum(x => x.Ok),
                    Ng = g.Sum(x => x.Ng)
                });

            var result = new List<LineYieldStatDto>();
            foreach (var g in lineGroups)
            {
                var lineName = lines.FirstOrDefault(l => l.Id == g.LineId)?.Name ?? $"Line {g.LineId}";
                var yieldRate = g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0;
                result.Add(new LineYieldStatDto(g.LineId, lineName, g.Total, g.Ok, g.Ng, yieldRate));
            }

            return result.OrderByDescending(r => r.Total).ToList();
        }

        public async Task<List<StationYieldStatDto>> GetStationYieldStatsAsync(int? lineId = null)
        {
            var stations = await _masterDataService.GetStationsAsync();
            var lines = await _masterDataService.GetLinesAsync();
            var query = _db.PcbResults.AsNoTracking().AsQueryable();

            if (lineId.HasValue)
            {
                var lineStationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => lineStationIds.Contains(p.StationId));
            }

            var grouped = await query
                .GroupBy(p => p.StationId)
                .Select(g => new {
                    StationId = g.Key,
                    Total = g.Count(),
                    Ok = g.Count(x => x.Result == "OK" || x.Result == "PASS"),
                    Ng = g.Count(x => x.Result == "NG" || x.Result == "FAIL")
                })
                .ToListAsync();

            var result = new List<StationYieldStatDto>();
            foreach (var g in grouped)
            {
                var st = stations.FirstOrDefault(s => s.Id == g.StationId);
                var stName = st?.Name ?? $"Station {g.StationId}";
                var lineIdVal = st?.LineId ?? 0;
                var lineName = lines.FirstOrDefault(l => l.Id == lineIdVal)?.Name ?? $"Line {lineIdVal}";
                var yieldRate = g.Total > 0 ? Math.Round((double)g.Ok / g.Total * 100.0, 2) : 0.0;
                result.Add(new StationYieldStatDto(g.StationId, stName, lineIdVal, lineName, g.Total, g.Ok, g.Ng, yieldRate));
            }

            return result.OrderBy(r => r.YieldRate).ToList();
        }

        public async Task<List<DefectParetoStatDto>> GetDefectParetoAsync(int? lineId = null, int? stationId = null)
        {
            var query = _db.PcbResults.AsNoTracking()
                .Where(p => p.Result == "NG" || p.Result == "FAIL");

            if (lineId.HasValue)
            {
                var stations = await _masterDataService.GetStationsAsync();
                var stationIds = stations.Where(s => s.LineId == lineId.Value).Select(s => s.Id).ToList();
                query = query.Where(p => stationIds.Contains(p.StationId));
            }
            if (stationId.HasValue)
            {
                query = query.Where(p => p.StationId == stationId.Value);
            }

            var totalNg = await query.CountAsync();
            if (totalNg == 0) return new List<DefectParetoStatDto>();

            var grouped = await query
                .GroupBy(p => p.ErrorCode ?? "UNKNOWN_DEFECT")
                .Select(g => new {
                    Code = g.Key,
                    Count = g.Count()
                })
                .OrderByDescending(g => g.Count)
                .Take(20)
                .ToListAsync();

            return grouped.Select(g => new DefectParetoStatDto(
                g.Code,
                g.Count,
                Math.Round((double)g.Count / totalNg * 100.0, 2)
            )).ToList();
        }

        private static DateTime EnsureUtc(DateTime dt)
        {
            if (dt.Kind == DateTimeKind.Unspecified)
                return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
            return dt.ToUniversalTime();
        }

        private static DateTime? EnsureUtc(DateTime? dt)
        {
            if (!dt.HasValue) return null;
            return EnsureUtc(dt.Value);
        }
    }
}

