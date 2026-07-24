using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services
{
    public interface IMasterDataService
    {
        Task RefreshCacheAsync();
        Task SeedDefaultDataIfEmptyAsync();
        ChannelHierarchyInfo? GetChannelHierarchy(int channelId);
        Task<List<BuyerDto>> GetBuyersAsync();
        Task<List<LineDto>> GetLinesAsync();
        Task<List<StationDto>> GetStationsAsync();
        Task<List<ChannelDto>> GetChannelsAsync();
        Task<BuyerDto> CreateBuyerAsync(CreateBuyerRequest req);
        Task<BuyerDto?> UpdateBuyerAsync(int id, UpdateBuyerRequest req);
        Task<bool> DeleteBuyerAsync(int id);

        Task<LineDto> CreateLineAsync(CreateLineRequest req);
        Task<LineDto?> UpdateLineAsync(int id, UpdateLineRequest req);
        Task<bool> DeleteLineAsync(int id);

        Task<StationDto> CreateStationAsync(CreateStationRequest req);
        Task<StationDto?> UpdateStationAsync(int id, UpdateStationRequest req);
        Task<bool> DeleteStationAsync(int id);

        Task<ChannelDto> CreateChannelAsync(CreateChannelRequest req);
        Task<ChannelDto?> UpdateChannelAsync(int id, UpdateChannelRequest req);
        Task<bool> DeleteChannelAsync(int id);
    }

    public record ChannelHierarchyInfo(
        int ChannelId,
        string ChannelName,
        int StationId,
        string StationName,
        int LineId,
        string LineName
    );

    public class MasterDataService : IMasterDataService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<MasterDataService> _logger;
        private readonly ConcurrentDictionary<int, ChannelHierarchyInfo> _cache = new();

        public MasterDataService(IServiceScopeFactory scopeFactory, ILogger<MasterDataService> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        public async Task SeedDefaultDataIfEmptyAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            if (await db.Lines.AnyAsync()) return;

            _logger.LogInformation("Seeding default Master Data...");

            var buyer1 = new Buyer { Name = "Mercedes-Benz", Remark = "Automotive Tier 1" };
            var buyer2 = new Buyer { Name = "Bosch Group", Remark = "Industrial Automation" };
            var buyer3 = new Buyer { Name = "Continental AG", Remark = "Electronics Powertrain" };
            db.Buyers.AddRange(buyer1, buyer2, buyer3);
            await db.SaveChangesAsync();

            var line1 = new Line { Name = "Line 01 SMT High-Speed", Remark = "Fuji AIMEX III Line" };
            var line2 = new Line { Name = "Line 02 SMT Dual-Lane", Remark = "Panasonic NPM-W2 Line" };
            var line3 = new Line { Name = "Line 03 SMT Flexible", Remark = "ASM SiPlace TX Line" };
            db.Lines.AddRange(line1, line2, line3);
            await db.SaveChangesAsync();

            var st1 = new Station { LineId = line1.Id, Name = "SPI Inspection #1", Remark = "Solder Paste Inspection" };
            var st2 = new Station { LineId = line1.Id, Name = "AOI Top Inspection", Remark = "Pre-reflow Top Camera" };
            var st3 = new Station { LineId = line1.Id, Name = "AXI X-Ray Inspection", Remark = "3D X-Ray Inspection" };
            var st4 = new Station { LineId = line1.Id, Name = "FCT Function Test", Remark = "Final Board Test" };

            var st5 = new Station { LineId = line2.Id, Name = "SPI Inspection #2", Remark = "Solder Paste Inspection" };
            var st6 = new Station { LineId = line2.Id, Name = "AOI Bottom Inspection", Remark = "Post-reflow Bottom Camera" };
            var st7 = new Station { LineId = line2.Id, Name = "FCT Function Test", Remark = "Final Board Test" };

            var st8 = new Station { LineId = line3.Id, Name = "AOI Inspection #3", Remark = "Flexible AOI Camera" };
            var st9 = new Station { LineId = line3.Id, Name = "FCT Function Test", Remark = "Final Board Test" };

            db.Stations.AddRange(st1, st2, st3, st4, st5, st6, st7, st8, st9);
            await db.SaveChangesAsync();

            var ch1 = new Channel { StationId = st1.Id, Name = "3D SPI Optical Sensor 1", IpAddress = "192.168.1.101", Status = "online" };
            var ch2 = new Channel { StationId = st2.Id, Name = "Top AOI High-Speed Cam #1", IpAddress = "192.168.1.102", Status = "online" };
            var ch3 = new Channel { StationId = st3.Id, Name = "AXI 3D Ray Transceiver #1", IpAddress = "192.168.1.103", Status = "online" };
            var ch4 = new Channel { StationId = st4.Id, Name = "FCT Multimeter Probe CH1", IpAddress = "192.168.1.104", Status = "online" };

            var ch5 = new Channel { StationId = st5.Id, Name = "3D SPI Optical Sensor 2", IpAddress = "192.168.1.105", Status = "online" };
            var ch6 = new Channel { StationId = st6.Id, Name = "Bottom AOI Cam #1", IpAddress = "192.168.1.106", Status = "online" };
            var ch7 = new Channel { StationId = st7.Id, Name = "FCT Multimeter Probe CH2", IpAddress = "192.168.1.107", Status = "online" };

            var ch8 = new Channel { StationId = st8.Id, Name = "AOI Flex Camera #3", IpAddress = "192.168.1.108", Status = "online" };
            var ch9 = new Channel { StationId = st9.Id, Name = "FCT Multimeter Probe CH3", IpAddress = "192.168.1.109", Status = "online" };

            db.Channels.AddRange(ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8, ch9);
            await db.SaveChangesAsync();

            _logger.LogInformation("Master Data seeded successfully.");
        }

        public async Task RefreshCacheAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var channels = await db.Channels
                .Include(c => c.Station!)
                .ThenInclude(s => s.Line!)
                .AsNoTracking()
                .ToListAsync();

            _cache.Clear();
            foreach (var ch in channels)
            {
                if (ch.Station?.Line != null)
                {
                    _cache[ch.Id] = new ChannelHierarchyInfo(
                        ch.Id,
                        ch.Name,
                        ch.StationId,
                        ch.Station.Name,
                        ch.Station.LineId,
                        ch.Station.Line.Name
                    );
                }
            }

            _logger.LogInformation("MasterDataService in-memory cache refreshed with {Count} channels", _cache.Count);
        }

        public ChannelHierarchyInfo? GetChannelHierarchy(int channelId)
        {
            if (_cache.TryGetValue(channelId, out var info))
            {
                return info;
            }
            return null;
        }

        public async Task<List<BuyerDto>> GetBuyersAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Buyers.AsNoTracking()
                .Select(b => new BuyerDto(b.Id, b.Name, b.Remark))
                .ToListAsync();
        }

        public async Task<List<LineDto>> GetLinesAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Lines.AsNoTracking()
                .Select(l => new LineDto(l.Id, l.Name, l.Remark))
                .ToListAsync();
        }

        public async Task<List<StationDto>> GetStationsAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Stations.Include(s => s.Line!).AsNoTracking()
                .Select(s => new StationDto(s.Id, s.LineId, s.Line != null ? s.Line.Name : "", s.Name, s.Remark))
                .ToListAsync();
        }

        public async Task<List<ChannelDto>> GetChannelsAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Channels.Include(c => c.Station!).ThenInclude(s => s.Line!).AsNoTracking()
                .Select(c => new ChannelDto(
                    c.Id,
                    c.StationId,
                    c.Station != null ? c.Station.Name : "Unassigned Station",
                    c.Station != null ? c.Station.LineId : 0,
                    c.Station != null && c.Station.Line != null ? c.Station.Line.Name : "Unassigned Line",
                    c.Name,
                    c.IpAddress,
                    c.Status
                ))
                .ToListAsync();
        }

        public async Task<BuyerDto> CreateBuyerAsync(CreateBuyerRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var entity = new Buyer { Name = req.Name, Remark = req.Remark };
            db.Buyers.Add(entity);
            await db.SaveChangesAsync();

            await RefreshCacheAsync();
            return new BuyerDto(entity.Id, entity.Name, entity.Remark);
        }

        public async Task<LineDto> CreateLineAsync(CreateLineRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var entity = new Line { Name = req.Name, Remark = req.Remark };
            db.Lines.Add(entity);
            await db.SaveChangesAsync();

            await RefreshCacheAsync();

            return new LineDto(entity.Id, entity.Name, entity.Remark);
        }

        public async Task<StationDto> CreateStationAsync(CreateStationRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var entity = new Station { LineId = req.LineId, Name = req.Name, Remark = req.Remark };
            db.Stations.Add(entity);
            await db.SaveChangesAsync();

            await db.Entry(entity).Reference(s => s.Line).LoadAsync();

            await RefreshCacheAsync();

            return new StationDto(
                entity.Id,
                entity.LineId,
                entity.Line?.Name ?? "",
                entity.Name,
                entity.Remark
            );
        }

        public async Task<ChannelDto> CreateChannelAsync(CreateChannelRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var entity = new Channel
            {
                StationId = req.StationId,
                Name = req.Name,
                IpAddress = req.IpAddress ?? "127.0.0.1",
                Status = "online"
            };
            db.Channels.Add(entity);
            await db.SaveChangesAsync();

            await db.Entry(entity).Reference(c => c.Station).LoadAsync();
            if (entity.Station != null)
            {
                await db.Entry(entity.Station).Reference(s => s.Line).LoadAsync();
            }

            await RefreshCacheAsync();

            return new ChannelDto(
                entity.Id,
                entity.StationId,
                entity.Station?.Name ?? "",
                entity.Station?.LineId ?? 0,
                entity.Station?.Line?.Name ?? "",
                entity.Name,
                entity.IpAddress,
                entity.Status
            );
        }

        // UPDATE & DELETE BUYER
        public async Task<BuyerDto?> UpdateBuyerAsync(int id, UpdateBuyerRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Buyers.FindAsync(id);
            if (entity == null) return null;

            entity.Name = req.Name;
            entity.Remark = req.Remark;
            await db.SaveChangesAsync();
            await RefreshCacheAsync();
            return new BuyerDto(entity.Id, entity.Name, entity.Remark);
        }

        public async Task<bool> DeleteBuyerAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Buyers.FindAsync(id);
            if (entity == null) return false;

            db.Buyers.Remove(entity);
            await db.SaveChangesAsync();
            await RefreshCacheAsync();
            return true;
        }

        // UPDATE & DELETE LINE
        public async Task<LineDto?> UpdateLineAsync(int id, UpdateLineRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Lines.FindAsync(id);
            if (entity == null) return null;

            entity.Name = req.Name;
            entity.Remark = req.Remark;
            await db.SaveChangesAsync();
            await RefreshCacheAsync();
            return new LineDto(entity.Id, entity.Name, entity.Remark);
        }

        public async Task<bool> DeleteLineAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var exists = await db.Lines.AnyAsync(l => l.Id == id);
            if (!exists) return false;

            var stationIds = await db.Stations.Where(s => s.LineId == id).Select(s => s.Id).ToListAsync();
            var channelIds = await db.Channels.Where(c => stationIds.Contains(c.StationId)).Select(c => c.Id).ToListAsync();

            // Direct SQL bulk delete pcb_results
            await db.PcbResults
                .Where(p => p.LineId == id || (stationIds.Count > 0 && stationIds.Contains(p.StationId)) || (channelIds.Count > 0 && channelIds.Contains(p.ChannelId)))
                .ExecuteDeleteAsync();

            // Direct SQL bulk delete child channels
            if (stationIds.Count > 0)
            {
                await db.Channels.Where(c => stationIds.Contains(c.StationId)).ExecuteDeleteAsync();
            }

            // Direct SQL bulk delete child stations
            await db.Stations.Where(s => s.LineId == id).ExecuteDeleteAsync();

            // Direct SQL delete the line entity itself
            await db.Lines.Where(l => l.Id == id).ExecuteDeleteAsync();

            await RefreshCacheAsync();
            return true;
        }

        // UPDATE & DELETE STATION
        public async Task<StationDto?> UpdateStationAsync(int id, UpdateStationRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Stations.FindAsync(id);
            if (entity == null) return null;

            entity.LineId = req.LineId;
            entity.Name = req.Name;
            entity.Remark = req.Remark;
            await db.SaveChangesAsync();

            await db.Entry(entity).Reference(s => s.Line).LoadAsync();
            await RefreshCacheAsync();

            return new StationDto(entity.Id, entity.LineId, entity.Line?.Name ?? "", entity.Name, entity.Remark);
        }

        public async Task<bool> DeleteStationAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var exists = await db.Stations.AnyAsync(s => s.Id == id);
            if (!exists) return false;

            var channelIds = await db.Channels.Where(c => c.StationId == id).Select(c => c.Id).ToListAsync();

            // Direct SQL bulk delete pcb_results
            await db.PcbResults
                .Where(p => p.StationId == id || (channelIds.Count > 0 && channelIds.Contains(p.ChannelId)))
                .ExecuteDeleteAsync();

            // Direct SQL bulk delete child channels
            await db.Channels.Where(c => c.StationId == id).ExecuteDeleteAsync();

            // Direct SQL delete station
            await db.Stations.Where(s => s.Id == id).ExecuteDeleteAsync();

            await RefreshCacheAsync();
            return true;
        }

        // UPDATE & DELETE CHANNEL
        public async Task<ChannelDto?> UpdateChannelAsync(int id, UpdateChannelRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Channels.FindAsync(id);
            if (entity == null) return null;

            entity.StationId = req.StationId;
            entity.Name = req.Name;
            if (req.IpAddress != null) entity.IpAddress = req.IpAddress;
            if (req.Status != null) entity.Status = req.Status;

            await db.SaveChangesAsync();

            await db.Entry(entity).Reference(c => c.Station).LoadAsync();
            if (entity.Station != null)
            {
                await db.Entry(entity.Station).Reference(s => s.Line).LoadAsync();
            }
            await RefreshCacheAsync();

            return new ChannelDto(
                entity.Id,
                entity.StationId,
                entity.Station?.Name ?? "",
                entity.Station?.LineId ?? 0,
                entity.Station?.Line?.Name ?? "",
                entity.Name,
                entity.IpAddress,
                entity.Status
            );
        }

        public async Task<bool> DeleteChannelAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var exists = await db.Channels.AnyAsync(c => c.Id == id);
            if (!exists) return false;

            // Direct SQL bulk delete pcb_results
            await db.PcbResults.Where(p => p.ChannelId == id).ExecuteDeleteAsync();

            // Direct SQL delete channel
            await db.Channels.Where(c => c.Id == id).ExecuteDeleteAsync();

            await RefreshCacheAsync();
            return true;
        }
    }
}
