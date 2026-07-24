using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace PMSystem2.Api.Models
{
    [Table("pcb_results")]
    public class PcbResult
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("channel_id")]
        public int ChannelId { get; set; }

        [Column("station_id")]
        public int StationId { get; set; }

        [Column("line_id")]
        public int LineId { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("pid")]
        public string Pid { get; set; } = string.Empty;

        [Required]
        [MaxLength(10)]
        [Column("result")]
        public string Result { get; set; } = "OK"; // OK or NG

        [MaxLength(100)]
        [Column("error_code")]
        public string? ErrorCode { get; set; }

        [Column("inspect_time")]
        public DateTime InspectTime { get; set; } = DateTime.UtcNow;

        public ICollection<TestStep> TestSteps { get; set; } = new List<TestStep>();
    }

    [Table("test_steps")]
    public class TestStep
    {
        [Key]
        [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
        [Column("id")]
        public long Id { get; set; }

        [Column("pcb_result_id")]
        public Guid PcbResultId { get; set; }

        [MaxLength(50)]
        [Column("step_type")]
        public string? StepType { get; set; }

        [Column("step_number")]
        public int StepNumber { get; set; } = 0;

        [Required]
        [MaxLength(100)]
        [Column("step_name")]
        public string StepName { get; set; } = string.Empty;

        [MaxLength(100)]
        [Column("value")]
        public string? Value { get; set; }

        [MaxLength(100)]
        [Column("spec_min")]
        public string? SpecMin { get; set; }

        [MaxLength(100)]
        [Column("spec_max")]
        public string? SpecMax { get; set; }

        [Required]
        [MaxLength(10)]
        [Column("result")]
        public string Result { get; set; } = "OK";

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey(nameof(PcbResultId))]
        public PcbResult? PcbResult { get; set; }
    }

    // Ingestion Request DTOs
    public class TestStepInputDto
    {
        public string? StepType { get; set; }
        public int StepNumber { get; set; } = 0;
        public string StepName { get; set; } = string.Empty;
        public string? Value { get; set; }
        public string? SpecMin { get; set; }
        public string? SpecMax { get; set; }
        public string Result { get; set; } = "OK";
    }

    public class SubmitPcbRequest
    {
        public int ChannelId { get; set; }
        public string Pid { get; set; } = string.Empty;
        public string Result { get; set; } = "OK"; // OK / NG
        public string? ErrorCode { get; set; }
        public List<TestStepInputDto>? Steps { get; set; }
    }

    public record PcbResultDto(
        Guid Id,
        int ChannelId,
        string ChannelName,
        int StationId,
        string StationName,
        int LineId,
        string LineName,
        string Pid,
        string Result,
        string? ErrorCode,
        DateTime InspectTime,
        List<TestStepInputDto> Steps
    );

    public record HourlyStatDto(
        DateTime Bucket,
        int LineId,
        int StationId,
        long TotalCount,
        long OkCount,
        long NgCount,
        double YieldRate
    );

    public record ProductionSummaryDto(
        long TotalInspected,
        long TotalOk,
        long TotalNg,
        double OverallYieldRate,
        int ActiveChannels,
        List<HourlyStatDto> RecentHourlyStats
    );

    public record LineYieldStatDto(
        int LineId,
        string LineName,
        long Total,
        long Ok,
        long Ng,
        double YieldRate
    );

    public record DefectParetoStatDto(
        string Code,
        long Count,
        double Pct
    );

    public record StationYieldStatDto(
        int StationId,
        string StationName,
        int LineId,
        string LineName,
        long Total,
        long Ok,
        long Ng,
        double YieldRate
    );
}


