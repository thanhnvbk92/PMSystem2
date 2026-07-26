using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace PMSystem2.Api.Models
{
    [Table("buyers")]
    public class Buyer
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<ModelGroup> ModelGroups { get; set; } = new List<ModelGroup>();
    }

    [Table("model_groups")]
    public class ModelGroup
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Column("buyer_id")]
        public int? BuyerId { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey(nameof(BuyerId))]
        public Buyer? Buyer { get; set; }

        public ICollection<ModelItem> Models { get; set; } = new List<ModelItem>();
        public ICollection<Station> Stations { get; set; } = new List<Station>();
    }

    [Table("models")]
    public class ModelItem
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Column("model_group_id")]
        public int? ModelGroupId { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey(nameof(ModelGroupId))]
        public ModelGroup? ModelGroup { get; set; }
    }

    [Table("station_types")]
    public class StationType
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<Station> Stations { get; set; } = new List<Station>();
    }

    [Table("lines")]
    public class Line
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<Station> Stations { get; set; } = new List<Station>();
    }

    [Table("stations")]
    public class Station
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Column("line_id")]
        public int LineId { get; set; }

        [Column("model_group_id")]
        public int? ModelGroupId { get; set; }

        [Column("station_type_id")]
        public int? StationTypeId { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [MaxLength(200)]
        [Column("process_info")]
        public string? ProcessInfo { get; set; }

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey(nameof(LineId))]
        public Line? Line { get; set; }

        [ForeignKey(nameof(ModelGroupId))]
        public ModelGroup? ModelGroup { get; set; }

        [ForeignKey(nameof(StationTypeId))]
        public StationType? StationType { get; set; }

        public ICollection<Channel> Channels { get; set; } = new List<Channel>();
    }

    [Table("channels")]
    public class Channel
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Column("station_id")]
        public int StationId { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [MaxLength(100)]
        [Column("machine_partno")]
        public string? MachinePartNo { get; set; }

        [MaxLength(45)]
        [Column("ip_address")]
        public string? IpAddress { get; set; }

        [MaxLength(50)]
        [Column("mac_address")]
        public string? MacAddress { get; set; }

        [MaxLength(100)]
        [Column("gmes_name")]
        public string? GmesName { get; set; }

        [MaxLength(20)]
        [Column("status")]
        public string Status { get; set; } = "online";

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey(nameof(StationId))]
        public Station? Station { get; set; }

        public ICollection<Device> Devices { get; set; } = new List<Device>();
    }

    [Table("device_types")]
    public class DeviceType
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<Device> Devices { get; set; } = new List<Device>();
    }

    [Table("devices")]
    public class Device
    {
        [Key]
        [Column("id")]
        public int Id { get; set; }

        [Column("channel_id")]
        public int ChannelId { get; set; }

        [Column("device_type_id")]
        public int? DeviceTypeId { get; set; }

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [MaxLength(100)]
        [Column("model_partno")]
        public string? ModelPartNo { get; set; }

        [MaxLength(100)]
        [Column("serial_number")]
        public string? SerialNumber { get; set; }

        [MaxLength(20)]
        [Column("status")]
        public string Status { get; set; } = "OK";

        [Column("calibration_date")]
        public DateTime? CalibrationDate { get; set; }

        [Column("calibration_due_date")]
        public DateTime? CalibrationDueDate { get; set; }

        [MaxLength(50)]
        [Column("calibration_status")]
        public string? CalibrationStatus { get; set; }

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey(nameof(ChannelId))]
        public Channel? Channel { get; set; }

        [ForeignKey(nameof(DeviceTypeId))]
        public DeviceType? DeviceType { get; set; }
    }

    // DTOs
    public record BuyerDto(int Id, string Name, string? Remark);
    public record ModelGroupDto(int Id, int? BuyerId, string? BuyerName, string Name, string? Remark);
    public record ModelItemDto(int Id, int? ModelGroupId, string? ModelGroupName, string Name, string? Remark);
    public record StationTypeDto(int Id, string Name, string? Remark);
    public record LineDto(int Id, string Name, string? Remark);
    public record StationDto(int Id, int LineId, string LineName, int? ModelGroupId, string? ModelGroupName, int? StationTypeId, string? StationTypeName, string Name, string? ProcessInfo, string? Remark);
    public record ChannelDto(int Id, int StationId, string StationName, int LineId, string LineName, string Name, string? MachinePartNo, string? IpAddress, string? MacAddress, string? GmesName, string Status, string? Remark);
    public record DeviceTypeDto(int Id, string Name, string? Remark);
    public record DeviceDto(int Id, int ChannelId, string ChannelName, int? DeviceTypeId, string? DeviceTypeName, string Name, string? ModelPartNo, string? SerialNumber, string Status, DateTime? CalibrationDate, DateTime? CalibrationDueDate, string? CalibrationStatus, string? Remark);

    public record CreateBuyerRequest(string Name, string? Remark);
    public record UpdateBuyerRequest(string Name, string? Remark);

    public record CreateLineRequest(string Name, string? Remark);
    public record UpdateLineRequest(string Name, string? Remark);

    public record CreateStationRequest(int LineId, int? ModelGroupId, int? StationTypeId, string Name, string? ProcessInfo = null, string? Remark = null);
    public record UpdateStationRequest(int LineId, int? ModelGroupId, int? StationTypeId, string Name, string? ProcessInfo = null, string? Remark = null);

    public record CreateChannelRequest(int StationId, string Name, string? MachinePartNo = null, string? IpAddress = null, string? MacAddress = null, string? GmesName = null, string? Remark = null);
    public record UpdateChannelRequest(int StationId, string Name, string? MachinePartNo = null, string? IpAddress = null, string? MacAddress = null, string? GmesName = null, string? Status = null, string? Remark = null);

    public record CreateModelGroupRequest(int? BuyerId, string Name, string? Remark);
    public record UpdateModelGroupRequest(int? BuyerId, string Name, string? Remark);

    public record CreateModelItemRequest(int? ModelGroupId, string Name, string? Remark);
    public record UpdateModelItemRequest(int? ModelGroupId, string Name, string? Remark);

    public record CreateStationTypeRequest(string Name, string? Remark);
    public record UpdateStationTypeRequest(string Name, string? Remark);

    public record CreateDeviceTypeRequest(string Name, string? Remark);
    public record UpdateDeviceTypeRequest(string Name, string? Remark);

    public record CreateDeviceRequest(int ChannelId, int? DeviceTypeId, string Name, string? ModelPartNo = null, string? SerialNumber = null, string Status = "online", DateTime? CalibrationDate = null, DateTime? CalibrationDueDate = null, string? CalibrationStatus = null, string? Remark = null);
    public record UpdateDeviceRequest(int ChannelId, int? DeviceTypeId, string Name, string? ModelPartNo = null, string? SerialNumber = null, string Status = "online", DateTime? CalibrationDate = null, DateTime? CalibrationDueDate = null, string? CalibrationStatus = null, string? Remark = null);
}
