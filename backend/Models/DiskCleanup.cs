using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace PMSystem2.Api.Models
{
    /// <summary>
    /// Disk clean-up settings applied by every Backup_Log2 PC (stored as JSON in app_settings).
    /// A PC cleans a drive when its used space is above <see cref="TriggerUsedPercent"/>: first every
    /// DeleteAll rule, then the OldestFirst rules (oldest file first) until <see cref="OkUsedPercent"/>.
    /// </summary>
    public sealed class DiskCleanupConfig
    {
        public bool Enabled { get; set; }
        public double TriggerUsedPercent { get; set; } = 80;
        public double OkUsedPercent { get; set; } = 70;
        public int CheckIntervalMinutes { get; set; } = 30;
        public List<DiskCleanupRule> Rules { get; set; } = new();
        public DateTime? UpdatedAt { get; set; }
    }

    public sealed class DiskCleanupRule
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        /// <summary>Folder on the PC; %ENV%, {LogFolder} and * / ? in folder names are accepted.</summary>
        public string Folder { get; set; } = string.Empty;
        /// <summary>"*.bmp;*.tmp" (empty = every file).</summary>
        public string Pattern { get; set; } = "*";
        public bool IncludeSubfolders { get; set; } = true;
        /// <summary>OldestFirst (default), DeleteAll or KeepNewest.</summary>
        public string Mode { get; set; } = DiskCleanupModes.OldestFirst;
        public int KeepDays { get; set; }
        public bool DryRun { get; set; } = true;
        public bool Enabled { get; set; } = true;
    }

    public static class DiskCleanupModes
    {
        public const string OldestFirst = "OldestFirst";
        public const string DeleteAll = "DeleteAll";
        /// <summary>Delete every matching file except the newest one (runs with DeleteAll, before OldestFirst).</summary>
        public const string KeepNewest = "KeepNewest";
    }

    /// <summary>Latest clean-up report of each PC (one row per MAC), plus the latest run that deleted files.</summary>
    [Table("disk_cleanup_reports")]
    public class DiskCleanupReportEntry
    {
        [Key, MaxLength(32), Column("mac_key")] public string MacKey { get; set; } = string.Empty;
        [MaxLength(50), Column("mac_address")] public string? MacAddress { get; set; }
        [MaxLength(100), Column("hostname")] public string? Hostname { get; set; }
        [MaxLength(20), Column("kind")] public string? Kind { get; set; }
        [Column("ran_at")] public DateTime RanAt { get; set; }
        [Column("received_at")] public DateTime ReceivedAt { get; set; }
        [Column("report_json")] public string ReportJson { get; set; } = "{}";
        [Column("warning")] public string? Warning { get; set; }
        [Column("last_cleanup_at")] public DateTime? LastCleanupAt { get; set; }
        [Column("last_cleanup_files")] public int? LastCleanupFiles { get; set; }
        [Column("last_cleanup_bytes")] public long? LastCleanupBytes { get; set; }
    }
}
