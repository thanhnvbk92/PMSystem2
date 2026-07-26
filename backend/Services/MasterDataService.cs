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
        Task<BuyerDto> CreateBuyerAsync(CreateBuyerRequest req);
        Task<BuyerDto?> UpdateBuyerAsync(int id, UpdateBuyerRequest req);
        Task<bool> DeleteBuyerAsync(int id);

        Task<List<ModelGroupDto>> GetModelGroupsAsync();
        Task<ModelGroupDto> CreateModelGroupAsync(CreateModelGroupRequest req);
        Task<ModelGroupDto?> UpdateModelGroupAsync(int id, UpdateModelGroupRequest req);
        Task<bool> DeleteModelGroupAsync(int id);

        Task<List<ModelItemDto>> GetModelsAsync();
        Task<ModelItemDto> CreateModelAsync(CreateModelItemRequest req);
        Task<ModelItemDto?> UpdateModelAsync(int id, UpdateModelItemRequest req);
        Task<bool> DeleteModelAsync(int id);

        Task<List<StationTypeDto>> GetStationTypesAsync();
        Task<StationTypeDto> CreateStationTypeAsync(CreateStationTypeRequest req);
        Task<StationTypeDto?> UpdateStationTypeAsync(int id, UpdateStationTypeRequest req);
        Task<bool> DeleteStationTypeAsync(int id);

        Task<List<LineDto>> GetLinesAsync();
        Task<LineDto> CreateLineAsync(CreateLineRequest req);
        Task<LineDto?> UpdateLineAsync(int id, UpdateLineRequest req);
        Task<bool> DeleteLineAsync(int id);

        Task<List<StationDto>> GetStationsAsync();
        Task<StationDto> CreateStationAsync(CreateStationRequest req);
        Task<StationDto?> UpdateStationAsync(int id, UpdateStationRequest req);
        Task<bool> DeleteStationAsync(int id);

        Task<List<ChannelDto>> GetChannelsAsync();
        Task<ChannelDto> CreateChannelAsync(CreateChannelRequest req);
        Task<ChannelDto?> UpdateChannelAsync(int id, UpdateChannelRequest req);
        Task<bool> DeleteChannelAsync(int id);
        Task<ChannelDto> MergeChannelsAsync(int sourceChannelId, int targetChannelId);

        Task<List<DeviceTypeDto>> GetDeviceTypesAsync();
        Task<DeviceTypeDto> CreateDeviceTypeAsync(CreateDeviceTypeRequest req);
        Task<DeviceTypeDto?> UpdateDeviceTypeAsync(int id, UpdateDeviceTypeRequest req);
        Task<bool> DeleteDeviceTypeAsync(int id);

        Task<List<DeviceDto>> GetDevicesAsync();
        Task<DeviceDto> CreateDeviceAsync(CreateDeviceRequest req);
        Task<DeviceDto?> UpdateDeviceAsync(int id, UpdateDeviceRequest req);
        Task<bool> DeleteDeviceAsync(int id);
    }

    public record ChannelHierarchyInfo(
        int ChannelId,
        string ChannelName,
        string IpAddress,
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
                        ch.IpAddress ?? "",
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

        // BUYERS
        public async Task<List<BuyerDto>> GetBuyersAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Buyers.AsNoTracking()
                .Select(b => new BuyerDto(b.Id, b.Name, b.Remark))
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

        // MODEL GROUPS
        public async Task<List<ModelGroupDto>> GetModelGroupsAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.ModelGroups.Include(mg => mg.Buyer).AsNoTracking()
                .Select(mg => new ModelGroupDto(mg.Id, mg.BuyerId, mg.Buyer != null ? mg.Buyer.Name : null, mg.Name, mg.Remark))
                .ToListAsync();
        }

        public async Task<ModelGroupDto> CreateModelGroupAsync(CreateModelGroupRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = new ModelGroup { BuyerId = req.BuyerId, Name = req.Name, Remark = req.Remark };
            db.ModelGroups.Add(entity);
            await db.SaveChangesAsync();
            if (entity.BuyerId.HasValue) await db.Entry(entity).Reference(mg => mg.Buyer).LoadAsync();
            return new ModelGroupDto(entity.Id, entity.BuyerId, entity.Buyer?.Name, entity.Name, entity.Remark);
        }

        public async Task<ModelGroupDto?> UpdateModelGroupAsync(int id, UpdateModelGroupRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.ModelGroups.FindAsync(id);
            if (entity == null) return null;
            entity.BuyerId = req.BuyerId;
            entity.Name = req.Name;
            entity.Remark = req.Remark;
            await db.SaveChangesAsync();
            if (entity.BuyerId.HasValue) await db.Entry(entity).Reference(mg => mg.Buyer).LoadAsync();
            return new ModelGroupDto(entity.Id, entity.BuyerId, entity.Buyer?.Name, entity.Name, entity.Remark);
        }

        public async Task<bool> DeleteModelGroupAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.ModelGroups.FindAsync(id);
            if (entity == null) return false;
            db.ModelGroups.Remove(entity);
            await db.SaveChangesAsync();
            return true;
        }

        // MODELS
        public async Task<List<ModelItemDto>> GetModelsAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Models.Include(m => m.ModelGroup).AsNoTracking()
                .Select(m => new ModelItemDto(m.Id, m.ModelGroupId, m.ModelGroup != null ? m.ModelGroup.Name : null, m.Name, m.Remark))
                .ToListAsync();
        }

        public async Task<ModelItemDto> CreateModelAsync(CreateModelItemRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = new ModelItem { ModelGroupId = req.ModelGroupId, Name = req.Name, Remark = req.Remark };
            db.Models.Add(entity);
            await db.SaveChangesAsync();
            if (entity.ModelGroupId.HasValue) await db.Entry(entity).Reference(m => m.ModelGroup).LoadAsync();
            return new ModelItemDto(entity.Id, entity.ModelGroupId, entity.ModelGroup?.Name, entity.Name, entity.Remark);
        }

        public async Task<ModelItemDto?> UpdateModelAsync(int id, UpdateModelItemRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Models.FindAsync(id);
            if (entity == null) return null;
            entity.ModelGroupId = req.ModelGroupId;
            entity.Name = req.Name;
            entity.Remark = req.Remark;
            await db.SaveChangesAsync();
            if (entity.ModelGroupId.HasValue) await db.Entry(entity).Reference(m => m.ModelGroup).LoadAsync();
            return new ModelItemDto(entity.Id, entity.ModelGroupId, entity.ModelGroup?.Name, entity.Name, entity.Remark);
        }

        public async Task<bool> DeleteModelAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Models.FindAsync(id);
            if (entity == null) return false;
            db.Models.Remove(entity);
            await db.SaveChangesAsync();
            return true;
        }

        // STATION TYPES
        public async Task<List<StationTypeDto>> GetStationTypesAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.StationTypes.AsNoTracking()
                .Select(st => new StationTypeDto(st.Id, st.Name, st.Remark))
                .ToListAsync();
        }

        public async Task<StationTypeDto> CreateStationTypeAsync(CreateStationTypeRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = new StationType { Name = req.Name, Remark = req.Remark };
            db.StationTypes.Add(entity);
            await db.SaveChangesAsync();
            return new StationTypeDto(entity.Id, entity.Name, entity.Remark);
        }

        public async Task<StationTypeDto?> UpdateStationTypeAsync(int id, UpdateStationTypeRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.StationTypes.FindAsync(id);
            if (entity == null) return null;
            entity.Name = req.Name;
            entity.Remark = req.Remark;
            await db.SaveChangesAsync();
            return new StationTypeDto(entity.Id, entity.Name, entity.Remark);
        }

        public async Task<bool> DeleteStationTypeAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.StationTypes.FindAsync(id);
            if (entity == null) return false;
            db.StationTypes.Remove(entity);
            await db.SaveChangesAsync();
            return true;
        }

        // LINES
        public async Task<List<LineDto>> GetLinesAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Lines.AsNoTracking()
                .Select(l => new LineDto(l.Id, l.Name, l.Remark))
                .ToListAsync();
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

            await db.PcbResults
                .Where(p => (stationIds.Count > 0 && stationIds.Contains(p.StationId)) || (channelIds.Count > 0 && channelIds.Contains(p.ChannelId)))
                .ExecuteDeleteAsync();

            if (stationIds.Count > 0)
            {
                await db.Channels.Where(c => stationIds.Contains(c.StationId)).ExecuteDeleteAsync();
            }

            await db.Stations.Where(s => s.LineId == id).ExecuteDeleteAsync();
            await db.Lines.Where(l => l.Id == id).ExecuteDeleteAsync();

            await RefreshCacheAsync();
            return true;
        }

        // STATIONS
        public async Task<List<StationDto>> GetStationsAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Stations
                .Include(s => s.Line)
                .Include(s => s.ModelGroup)
                .Include(s => s.StationType)
                .AsNoTracking()
                .Select(s => new StationDto(
                    s.Id,
                    s.LineId,
                    s.Line != null ? s.Line.Name : "",
                    s.ModelGroupId,
                    s.ModelGroup != null ? s.ModelGroup.Name : null,
                    s.StationTypeId,
                    s.StationType != null ? s.StationType.Name : null,
                    s.Name,
                    s.ProcessInfo,
                    s.Remark
                ))
                .ToListAsync();
        }

        public async Task<StationDto> CreateStationAsync(CreateStationRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var entity = new Station
            {
                LineId = req.LineId,
                ModelGroupId = req.ModelGroupId,
                StationTypeId = req.StationTypeId,
                Name = req.Name,
                ProcessInfo = req.ProcessInfo,
                Remark = req.Remark
            };
            db.Stations.Add(entity);
            await db.SaveChangesAsync();

            await db.Entry(entity).Reference(s => s.Line).LoadAsync();
            if (entity.ModelGroupId.HasValue) await db.Entry(entity).Reference(s => s.ModelGroup).LoadAsync();
            if (entity.StationTypeId.HasValue) await db.Entry(entity).Reference(s => s.StationType).LoadAsync();

            await RefreshCacheAsync();

            return new StationDto(
                entity.Id,
                entity.LineId,
                entity.Line?.Name ?? "",
                entity.ModelGroupId,
                entity.ModelGroup?.Name,
                entity.StationTypeId,
                entity.StationType?.Name,
                entity.Name,
                entity.ProcessInfo,
                entity.Remark
            );
        }

        public async Task<StationDto?> UpdateStationAsync(int id, UpdateStationRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Stations.FindAsync(id);
            if (entity == null) return null;

            entity.LineId = req.LineId;
            entity.ModelGroupId = req.ModelGroupId;
            entity.StationTypeId = req.StationTypeId;
            entity.Name = req.Name;
            entity.ProcessInfo = req.ProcessInfo;
            entity.Remark = req.Remark;
            await db.SaveChangesAsync();

            await db.Entry(entity).Reference(s => s.Line).LoadAsync();
            if (entity.ModelGroupId.HasValue) await db.Entry(entity).Reference(s => s.ModelGroup).LoadAsync();
            if (entity.StationTypeId.HasValue) await db.Entry(entity).Reference(s => s.StationType).LoadAsync();
            await RefreshCacheAsync();

            return new StationDto(
                entity.Id,
                entity.LineId,
                entity.Line?.Name ?? "",
                entity.ModelGroupId,
                entity.ModelGroup?.Name,
                entity.StationTypeId,
                entity.StationType?.Name,
                entity.Name,
                entity.ProcessInfo,
                entity.Remark
            );
        }

        public async Task<bool> DeleteStationAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var exists = await db.Stations.AnyAsync(s => s.Id == id);
            if (!exists) return false;

            var channelIds = await db.Channels.Where(c => c.StationId == id).Select(c => c.Id).ToListAsync();

            await db.PcbResults
                .Where(p => p.StationId == id || (channelIds.Count > 0 && channelIds.Contains(p.ChannelId)))
                .ExecuteDeleteAsync();

            await db.Channels.Where(c => c.StationId == id).ExecuteDeleteAsync();
            await db.Stations.Where(s => s.Id == id).ExecuteDeleteAsync();

            await RefreshCacheAsync();
            return true;
        }

        // CHANNELS
        public async Task<List<ChannelDto>> GetChannelsAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            return await db.Channels
                .Include(c => c.Station)
                .ThenInclude(s => s != null ? s.Line : null)
                .AsNoTracking()
                .Select(c => new ChannelDto(
                    c.Id,
                    c.StationId,
                    c.Station != null ? c.Station.Name : "Unassigned Station",
                    c.Station != null ? c.Station.LineId : 0,
                    c.Station != null && c.Station.Line != null ? c.Station.Line.Name : "Unassigned Line",
                    c.Name,
                    c.MachinePartNo,
                    c.IpAddress,
                    c.MacAddress,
                    c.GmesName,
                    c.Status,
                    c.Remark
                ))
                .ToListAsync();
        }

        public async Task<ChannelDto> CreateChannelAsync(CreateChannelRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var targetIp = string.IsNullOrWhiteSpace(req.IpAddress) ? "127.0.0.1" : req.IpAddress.Trim();

            if (targetIp != "127.0.0.1")
            {
                var existingWithIp = await db.Channels.AsNoTracking().FirstOrDefaultAsync(c => c.IpAddress == targetIp);
                if (existingWithIp != null)
                {
                    throw new InvalidOperationException($"Địa chỉ IP '{targetIp}' đang được gán cho Channel '{existingWithIp.Name}' (ID: #{existingWithIp.Id}). Vui lòng cập nhật IP của Channel đó sang địa chỉ khác trước.");
                }
            }

            var entity = new Channel
            {
                StationId = req.StationId,
                Name = req.Name,
                MachinePartNo = req.MachinePartNo,
                IpAddress = targetIp,
                MacAddress = string.IsNullOrWhiteSpace(req.MacAddress) ? null : req.MacAddress.Trim(),
                GmesName = req.GmesName,
                Status = "online",
                Remark = req.Remark
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
                entity.MachinePartNo,
                entity.IpAddress,
                entity.MacAddress,
                entity.GmesName,
                entity.Status,
                entity.Remark
            );
        }

        public async Task<ChannelDto?> UpdateChannelAsync(int id, UpdateChannelRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Channels.FindAsync(id);
            if (entity == null) return null;

            if (!string.IsNullOrWhiteSpace(req.IpAddress))
            {
                var targetIp = req.IpAddress.Trim();
                if (targetIp != "127.0.0.1" && targetIp != entity.IpAddress)
                {
                    var existingWithIp = await db.Channels.AsNoTracking().FirstOrDefaultAsync(c => c.Id != id && c.IpAddress == targetIp);
                    if (existingWithIp != null)
                    {
                        throw new InvalidOperationException($"Địa chỉ IP '{targetIp}' đang được gán cho Channel '{existingWithIp.Name}' (ID: #{existingWithIp.Id}). Vui lòng cập nhật IP của Channel đó sang địa chỉ khác trước.");
                    }
                }
                entity.IpAddress = targetIp;
            }

            entity.StationId = req.StationId;
            entity.Name = req.Name;
            if (req.MachinePartNo != null) entity.MachinePartNo = req.MachinePartNo;
            if (req.MacAddress != null) entity.MacAddress = string.IsNullOrWhiteSpace(req.MacAddress) ? null : req.MacAddress.Trim();
            if (req.GmesName != null) entity.GmesName = req.GmesName;
            if (req.Status != null) entity.Status = req.Status;
            if (req.Remark != null) entity.Remark = req.Remark;

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
                entity.MachinePartNo,
                entity.IpAddress,
                entity.MacAddress,
                entity.GmesName,
                entity.Status,
                entity.Remark
            );
        }

        public async Task<bool> DeleteChannelAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var exists = await db.Channels.AnyAsync(c => c.Id == id);
            if (!exists) return false;

            await db.PcbResults.Where(p => p.ChannelId == id).ExecuteDeleteAsync();
            await db.Channels.Where(c => c.Id == id).ExecuteDeleteAsync();

            await RefreshCacheAsync();
            return true;
        }

        public async Task<ChannelDto> MergeChannelsAsync(int sourceChannelId, int targetChannelId)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var sourceChannel = await db.Channels.FindAsync(sourceChannelId);
            var targetChannel = await db.Channels.Include(c => c.Station).ThenInclude(s => s != null ? s.Line : null).FirstOrDefaultAsync(c => c.Id == targetChannelId);

            if (sourceChannel == null || targetChannel == null)
            {
                throw new KeyNotFoundException("Channel nguồn hoặc Channel đích không tồn tại.");
            }

            if (sourceChannelId == targetChannelId)
            {
                throw new InvalidOperationException("Không thể gộp một Channel vào chính nó.");
            }

            var targetStationId = targetChannel.StationId;
            await db.PcbResults
                .Where(p => p.ChannelId == sourceChannelId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.ChannelId, targetChannelId)
                    .SetProperty(p => p.StationId, targetStationId)
                );

            if (string.IsNullOrWhiteSpace(targetChannel.MacAddress) && !string.IsNullOrWhiteSpace(sourceChannel.MacAddress))
            {
                targetChannel.MacAddress = sourceChannel.MacAddress;
            }

            db.Channels.Remove(sourceChannel);
            await db.SaveChangesAsync();

            await RefreshCacheAsync();

            return new ChannelDto(
                targetChannel.Id,
                targetChannel.StationId,
                targetChannel.Station?.Name ?? "",
                targetChannel.Station?.LineId ?? 0,
                targetChannel.Station?.Line?.Name ?? "",
                targetChannel.Name,
                targetChannel.MachinePartNo,
                targetChannel.IpAddress,
                targetChannel.MacAddress,
                targetChannel.GmesName,
                targetChannel.Status,
                targetChannel.Remark
            );
        }

        // DEVICE TYPES
        public async Task<List<DeviceTypeDto>> GetDeviceTypesAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.DeviceTypes.AsNoTracking()
                .Select(dt => new DeviceTypeDto(dt.Id, dt.Name, dt.Remark))
                .ToListAsync();
        }

        public async Task<DeviceTypeDto> CreateDeviceTypeAsync(CreateDeviceTypeRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = new DeviceType { Name = req.Name, Remark = req.Remark };
            db.DeviceTypes.Add(entity);
            await db.SaveChangesAsync();
            return new DeviceTypeDto(entity.Id, entity.Name, entity.Remark);
        }

        public async Task<DeviceTypeDto?> UpdateDeviceTypeAsync(int id, UpdateDeviceTypeRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.DeviceTypes.FindAsync(id);
            if (entity == null) return null;
            entity.Name = req.Name;
            entity.Remark = req.Remark;
            await db.SaveChangesAsync();
            return new DeviceTypeDto(entity.Id, entity.Name, entity.Remark);
        }

        public async Task<bool> DeleteDeviceTypeAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.DeviceTypes.FindAsync(id);
            if (entity == null) return false;
            db.DeviceTypes.Remove(entity);
            await db.SaveChangesAsync();
            return true;
        }

        // DEVICES
        public async Task<List<DeviceDto>> GetDevicesAsync()
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Devices
                .Include(d => d.Channel)
                .Include(d => d.DeviceType)
                .AsNoTracking()
                .Select(d => new DeviceDto(
                    d.Id,
                    d.ChannelId,
                    d.Channel != null ? d.Channel.Name : "",
                    d.DeviceTypeId,
                    d.DeviceType != null ? d.DeviceType.Name : null,
                    d.Name,
                    d.ModelPartNo,
                    d.SerialNumber,
                    d.Status,
                    d.CalibrationDate,
                    d.CalibrationDueDate,
                    d.CalibrationStatus,
                    d.Remark
                ))
                .ToListAsync();
        }

        public async Task<DeviceDto> CreateDeviceAsync(CreateDeviceRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = new Device
            {
                ChannelId = req.ChannelId,
                DeviceTypeId = req.DeviceTypeId,
                Name = req.Name,
                ModelPartNo = req.ModelPartNo,
                SerialNumber = req.SerialNumber,
                Status = req.Status ?? "online",
                CalibrationDate = req.CalibrationDate,
                CalibrationDueDate = req.CalibrationDueDate,
                CalibrationStatus = req.CalibrationStatus,
                Remark = req.Remark
            };
            db.Devices.Add(entity);
            await db.SaveChangesAsync();

            await db.Entry(entity).Reference(d => d.Channel).LoadAsync();
            if (entity.DeviceTypeId.HasValue) await db.Entry(entity).Reference(d => d.DeviceType).LoadAsync();

            return new DeviceDto(
                entity.Id,
                entity.ChannelId,
                entity.Channel?.Name ?? "",
                entity.DeviceTypeId,
                entity.DeviceType?.Name,
                entity.Name,
                entity.ModelPartNo,
                entity.SerialNumber,
                entity.Status,
                entity.CalibrationDate,
                entity.CalibrationDueDate,
                entity.CalibrationStatus,
                entity.Remark
            );
        }

        public async Task<DeviceDto?> UpdateDeviceAsync(int id, UpdateDeviceRequest req)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Devices.FindAsync(id);
            if (entity == null) return null;

            entity.ChannelId = req.ChannelId;
            entity.DeviceTypeId = req.DeviceTypeId;
            entity.Name = req.Name;
            entity.ModelPartNo = req.ModelPartNo;
            entity.SerialNumber = req.SerialNumber;
            entity.Status = req.Status ?? entity.Status;
            entity.CalibrationDate = req.CalibrationDate;
            entity.CalibrationDueDate = req.CalibrationDueDate;
            entity.CalibrationStatus = req.CalibrationStatus;
            entity.Remark = req.Remark;

            await db.SaveChangesAsync();

            await db.Entry(entity).Reference(d => d.Channel).LoadAsync();
            if (entity.DeviceTypeId.HasValue) await db.Entry(entity).Reference(d => d.DeviceType).LoadAsync();

            return new DeviceDto(
                entity.Id,
                entity.ChannelId,
                entity.Channel?.Name ?? "",
                entity.DeviceTypeId,
                entity.DeviceType?.Name,
                entity.Name,
                entity.ModelPartNo,
                entity.SerialNumber,
                entity.Status,
                entity.CalibrationDate,
                entity.CalibrationDueDate,
                entity.CalibrationStatus,
                entity.Remark
            );
        }

        public async Task<bool> DeleteDeviceAsync(int id)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.Devices.FindAsync(id);
            if (entity == null) return false;

            db.Devices.Remove(entity);
            await db.SaveChangesAsync();
            return true;
        }
    }
}
