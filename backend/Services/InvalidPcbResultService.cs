using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services;

public interface IInvalidPcbResultService
{
    bool IsValidResult(string? result);
    Task QuarantineAsync(SubmitPcbRequest request, CancellationToken cancellationToken = default);
    Task<InvalidPcbResultPage> GetPageAsync(string? status, string? search, string? rawResult, int page, int pageSize);
    Task<bool> ResolveAsync(long id, string? note);
}

public sealed class InvalidPcbResultService : IInvalidPcbResultService
{
    private readonly AppDbContext _db;
    public InvalidPcbResultService(AppDbContext db) => _db = db;

    public bool IsValidResult(string? result)
    {
        string value = NormalizeToken(result);
        return value is "OK" or "NG" or "PASS" or "FAIL" or "CHECK" or "STOP" or "EJECT" or "TIMEOUT" or "GOTO_ERR";
    }

    public async Task QuarantineAsync(SubmitPcbRequest request, CancellationToken cancellationToken = default)
    {
        string rawResult = request.Result?.Trim() ?? string.Empty;
        string payload = JsonSerializer.Serialize(request);
        string identity = $"{request.ChannelId}|{request.Pid?.Trim()}|{rawResult.ToUpperInvariant()}|{request.StartTime:O}";
        string fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant();
        string reason = string.IsNullOrWhiteSpace(rawResult)
            ? "Result is empty"
            : $"Unsupported PCB result: {rawResult}";

        var parameters = new[]
        {
            new NpgsqlParameter("fingerprint", fingerprint),
            new NpgsqlParameter("pid", (object?)request.Pid ?? DBNull.Value),
            new NpgsqlParameter("channelId", request.ChannelId),
            new NpgsqlParameter("rawResult", (object?)rawResult ?? DBNull.Value),
            new NpgsqlParameter("startTime", (object?)request.StartTime ?? DBNull.Value),
            new NpgsqlParameter("reason", reason),
            new NpgsqlParameter("payload", NpgsqlDbType.Jsonb) { Value = payload }
        };
        await _db.Database.ExecuteSqlRawAsync(@"
            INSERT INTO invalid_pcb_results
                (fingerprint, pid, channel_id, raw_result, start_time, reason, payload_json)
            VALUES (@fingerprint, @pid, @channelId, @rawResult, @startTime, @reason, @payload)
            ON CONFLICT (fingerprint) DO UPDATE SET
                payload_json = EXCLUDED.payload_json,
                reason = EXCLUDED.reason,
                occurrence_count = invalid_pcb_results.occurrence_count + 1,
                last_seen_at = NOW(),
                status = 'OPEN', resolved_at = NULL, resolution_note = NULL", parameters, cancellationToken);
    }

    public async Task<InvalidPcbResultPage> GetPageAsync(string? status, string? search, string? rawResult, int page, int pageSize)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 10, 200);
        var query = _db.InvalidPcbResults.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(status) && !status.Equals("ALL", StringComparison.OrdinalIgnoreCase))
            query = query.Where(x => x.Status == status.ToUpper());
        if (!string.IsNullOrWhiteSpace(rawResult))
            query = query.Where(x => x.RawResult == rawResult);
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(x => (x.Pid != null && x.Pid.Contains(search)) || x.Reason.Contains(search));
        int total = await query.CountAsync();
        int open = await _db.InvalidPcbResults.CountAsync(x => x.Status == "OPEN");
        var items = await query.OrderByDescending(x => x.LastSeenAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new InvalidPcbResultPage(total, open, items);
    }

    public async Task<bool> ResolveAsync(long id, string? note)
    {
        var item = await _db.InvalidPcbResults.FindAsync(id);
        if (item == null) return false;
        item.Status = "RESOLVED";
        item.ResolvedAt = DateTime.UtcNow;
        item.ResolutionNote = note?.Trim();
        await _db.SaveChangesAsync();
        return true;
    }

    private static string NormalizeToken(string? value) => (value ?? string.Empty).Trim().ToUpperInvariant();
}
