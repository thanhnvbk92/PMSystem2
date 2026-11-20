using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace PMSystem2.Api.Models
{
    /// <summary>
    /// Latest known state of one Backup_Log2 PC, keyed by its MAC address (upper-case hex, no separators).
    /// Updated when its SignalR connection opens/closes and by the telemetry it sends every minute.
    /// Only the current state is kept (no history).
    /// </summary>
    [Table("machine_status")]
    public class MachineStatusEntry
    {
        [Key, MaxLength(32), Column("mac_key")] public string MacKey { get; set; } = string.Empty;
        [MaxLength(50), Column("mac_address")] public string? MacAddress { get; set; }
        [Column("channel_id")] public int? ChannelId { get; set; }
        [MaxLength(100), Column("hostname")] public string? Hostname { get; set; }
        [MaxLength(200), Column("ip_address")] public string? IpAddress { get; set; }
        [MaxLength(200), Column("os_version")] public string? OsVersion { get; set; }
        [MaxLength(50), Column("app_version")] public string? AppVersion { get; set; }
        [MaxLength(200), Column("current_model")] public string? CurrentModel { get; set; }
        [MaxLength(200), Column("log_type")] public string? LogType { get; set; }
        [Column("log_folders")] public string? LogFolders { get; set; }
        [MaxLength(50), Column("app_status")] public string? AppStatus { get; set; }
        [Column("cpu_percent")] public double? CpuPercent { get; set; }
        [Column("ram_total_mb")] public int? RamTotalMb { get; set; }
        [Column("ram_used_mb")] public int? RamUsedMb { get; set; }
        [MaxLength(20), Column("disk_drive")] public string? DiskDrive { get; set; }
        [Column("disk_total_gb")] public double? DiskTotalGb { get; set; }
        [Column("disk_free_gb")] public double? DiskFreeGb { get; set; }
        [Column("app_started_at")] public DateTime? AppStartedAt { get; set; }
        [Column("last_upload_at")] public DateTime? LastUploadAt { get; set; }
        /// <summary>True while the PC has an open SignalR connection.</summary>
        [Column("is_connected")] public bool IsConnected { get; set; }
        /// <summary>Old Backup_Log2 builds send telemetry only once per connection and a fixed "2.0.0" version.</summary>
        [Column("is_legacy")] public bool IsLegacy { get; set; } = true;
        [Column("connected_at")] public DateTime? ConnectedAt { get; set; }
        [Column("disconnected_at")] public DateTime? DisconnectedAt { get; set; }
        [Column("last_seen_at")] public DateTime? LastSeenAt { get; set; }
        [Column("last_telemetry_at")] public DateTime? LastTelemetryAt { get; set; }
        /// <summary>PC wall clock minus server wall clock at the last telemetry (seconds).</summary>
        [Column("clock_offset_seconds")] public double? ClockOffsetSeconds { get; set; }
        /// <summary>Every fixed drive at the last telemetry: [{"drive":"C:","total_gb":..,"free_gb":..}].</summary>
        [Column("disks_json")] public string? DisksJson { get; set; }
    }

    /// <summary>Simple key/value settings (e.g. the standard Backup_Log2 version).</summary>
    [Table("app_settings")]
    public class AppSetting
    {
        [Key, MaxLength(100), Column("key")] public string Key { get; set; } = string.Empty;
        [Column("value")] public string? Value { get; set; }
        [Column("updated_at")] public DateTime UpdatedAt { get; set; }
    }
}
