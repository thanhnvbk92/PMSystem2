using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace PMSystem2.Api.Models;

[Table("invalid_pcb_results")]
public class InvalidPcbResult
{
    [Key, Column("id")]
    public long Id { get; set; }
    [Column("fingerprint"), MaxLength(64)]
    public string Fingerprint { get; set; } = string.Empty;
    [Column("pid"), MaxLength(100)]
    public string? Pid { get; set; }
    [Column("channel_id")]
    public int? ChannelId { get; set; }
    [Column("raw_result"), MaxLength(100)]
    public string? RawResult { get; set; }
    [Column("start_time")]
    public DateTime? StartTime { get; set; }
    [Column("reason"), MaxLength(300)]
    public string Reason { get; set; } = string.Empty;
    [Column("payload_json", TypeName = "jsonb")]
    public string PayloadJson { get; set; } = "{}";
    [Column("status"), MaxLength(20)]
    public string Status { get; set; } = "OPEN";
    [Column("occurrence_count")]
    public int OccurrenceCount { get; set; } = 1;
    [Column("first_seen_at")]
    public DateTime FirstSeenAt { get; set; } = DateTime.UtcNow;
    [Column("last_seen_at")]
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
    [Column("resolved_at")]
    public DateTime? ResolvedAt { get; set; }
    [Column("resolution_note")]
    public string? ResolutionNote { get; set; }
}

public record InvalidPcbResultPage(int Total, int Open, IReadOnlyList<InvalidPcbResult> Items);
public record ResolveInvalidPcbRequest(string? Note);
