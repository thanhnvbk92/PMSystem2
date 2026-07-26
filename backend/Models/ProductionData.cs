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

        [Required]
        [MaxLength(100)]
        [Column("pid")]
        public string Pid { get; set; } = string.Empty;

        [MaxLength(100)]
        [Column("job_file")]
        public string? JobFile { get; set; }

        [Column("model_id")]
        public int? ModelId { get; set; }

        [MaxLength(100)]
        [Column("fid")]
        public string? Fid { get; set; }

        [MaxLength(100)]
        [Column("pcba_partno")]
        public string? PcbaPartNo { get; set; }

        [Column("start_time")]
        public DateTime? StartTime { get; set; }

        [Column("end_time")]
        public DateTime? EndTime { get; set; }

        [Column("test_time")]
        public double? TestTime { get; set; }

        [MaxLength(500)]
        [Column("file_path")]
        public string? FilePath { get; set; }

        [Required]
        [MaxLength(10)]
        [Column("result")]
        public string Result { get; set; } = "OK"; // OK or NG

        [MaxLength(100)]
        [Column("error_code")]
        public string? ErrorCode { get; set; }

        [MaxLength(50)]
        [Column("gmes_status")]
        public string? GmesStatus { get; set; }

        [Column("inspect_time")]
        public DateTime InspectTime { get; set; } = DateTime.UtcNow;

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

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
        [System.Text.Json.Serialization.JsonPropertyName("step_type")]
        public string? StepType { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("stepType")]
        public string? StepTypeCamel 
        { 
            get => StepType;
            set { if (!string.IsNullOrWhiteSpace(value)) StepType = value; } 
        }

        [System.Text.Json.Serialization.JsonPropertyName("step_number")]
        public int StepNumber { get; set; } = 0;

        [System.Text.Json.Serialization.JsonPropertyName("stepNumber")]
        public int StepNumberCamel 
        { 
            get => StepNumber;
            set { if (value != 0) StepNumber = value; } 
        }

        [System.Text.Json.Serialization.JsonPropertyName("step_name")]
        public string StepName { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("stepName")]
        public string StepNameCamel 
        { 
            get => StepName;
            set { if (!string.IsNullOrWhiteSpace(value)) StepName = value; } 
        }

        [System.Text.Json.Serialization.JsonPropertyName("value")]
        public string? Value { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("spec_min")]
        public string? SpecMin { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("specMin")]
        public string? SpecMinCamel 
        { 
            get => SpecMin;
            set { if (!string.IsNullOrWhiteSpace(value)) SpecMin = value; } 
        }

        [System.Text.Json.Serialization.JsonPropertyName("spec_max")]
        public string? SpecMax { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("specMax")]
        public string? SpecMaxCamel 
        { 
            get => SpecMax;
            set { if (!string.IsNullOrWhiteSpace(value)) SpecMax = value; } 
        }

        [System.Text.Json.Serialization.JsonPropertyName("result")]
        public string Result { get; set; } = "OK";
    }

    public class SubmitPcbRequest
    {
        [System.Text.Json.Serialization.JsonPropertyName("channel_id")]
        public int ChannelId { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("pid")]
        public string Pid { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("job_file")]
        public string? JobFile { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("jobfile")]
        public string? JobFileAlias
        {
            get => JobFile;
            set { if (!string.IsNullOrWhiteSpace(value)) JobFile = value; }
        }

        [System.Text.Json.Serialization.JsonPropertyName("result")]
        public string Result { get; set; } = "OK"; // OK / NG

        [System.Text.Json.Serialization.JsonPropertyName("error_code")]
        public string? ErrorCode { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("gmes_status")]
        public string? GmesStatus { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("inspect_time")]
        public DateTime? InspectTime { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("start_time")]
        public DateTime? StartTime { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("end_time")]
        public DateTime? EndTime { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("test_time")]
        public double? TestTime { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("model_id")]
        public int? ModelId { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("fid")]
        public string? Fid { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("pcba_partno")]
        public string? PcbaPartNo { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("file_path")]
        public string? FilePath { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("steps")]
        public List<TestStepInputDto>? Steps { get; set; }
    }

    public record PcbResultDto(
        Guid Id,
        int ChannelId,
        string ChannelName,
        string ChannelIp,
        int StationId,
        string StationName,
        int LineId,
        string LineName,
        string Pid,
        string Result,
        string? ErrorCode,
        string? GmesStatus,
        DateTime InspectTime,
        DateTime CreatedAt,
        string? JobFile,
        int? ModelId,
        int? BuyerId,
        string? Fid,
        string? PcbaPartNo,
        DateTime? StartTime,
        DateTime? EndTime,
        double? TestTime,
        string? FilePath,
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


