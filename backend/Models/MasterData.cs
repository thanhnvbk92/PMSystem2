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

        [Required]
        [MaxLength(100)]
        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("remark")]
        public string? Remark { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey(nameof(LineId))]
        public Line? Line { get; set; }

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

        [MaxLength(45)]
        [Column("ip_address")]
        public string? IpAddress { get; set; }

        [MaxLength(50)]
        [Column("mac_address")]
        public string? MacAddress { get; set; }

        [MaxLength(20)]
        [Column("status")]
        public string Status { get; set; } = "online";

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey(nameof(StationId))]
        public Station? Station { get; set; }
    }

    // DTOs
    public record BuyerDto(int Id, string Name, string? Remark);
    public record LineDto(int Id, string Name, string? Remark);
    public record StationDto(int Id, int LineId, string LineName, string Name, string? Remark);
    public record ChannelDto(int Id, int StationId, string StationName, int LineId, string LineName, string Name, string? IpAddress, string? MacAddress, string Status);

    public record CreateBuyerRequest(string Name, string? Remark);
    public record UpdateBuyerRequest(string Name, string? Remark);

    public record CreateLineRequest(string Name, string? Remark);
    public record UpdateLineRequest(string Name, string? Remark);

    public record CreateStationRequest(int LineId, string Name, string? Remark);
    public record UpdateStationRequest(int LineId, string Name, string? Remark);

    public record CreateChannelRequest(int StationId, string Name, string? IpAddress, string? MacAddress = null);
    public record UpdateChannelRequest(int StationId, string Name, string? IpAddress, string? MacAddress = null, string? Status = null);
}
