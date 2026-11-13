using System.ComponentModel.DataAnnotations.Schema;

namespace PMSystem2.Api.Models;

[Table("pcb_analytics_daily")]
public class PcbAnalyticsDaily
{
    [Column("bucket_date")] public DateOnly BucketDate { get; set; }
    [Column("station_id")] public int StationId { get; set; }
    [Column("channel_id")] public int ChannelId { get; set; }
    [Column("result")] public string Result { get; set; } = string.Empty;
    [Column("error_code")] public string ErrorCode { get; set; } = string.Empty;
    [Column("job_file")] public string JobFile { get; set; } = string.Empty;
    [Column("model_id")] public int ModelId { get; set; }
    [Column("total_count")] public long TotalCount { get; set; }
}
