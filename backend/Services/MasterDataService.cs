using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services
{
    public interface IMasterDataService
    {
        Task RefreshCacheAsync();
        ChannelHierarchyInfo? GetChannelHierarchy(int channelId);
        Task<List<BuyerDto>> GetBuyersAsync();
        Task<List<LineDto>> GetLinesAsync();
        Task<List<StationDto>> GetStationsAsync();
        Task<List<ChannelDto>> GetChannelsAsync();
        Task<BuyerDto> CreateBuyerAsync(CreateBuyerRequest req);
        Task<LineDto> CreateLineAsync(CreateLineRequest req);
        Task<StationDto> CreateStationAsync(CreateStationRequest req);
        Task<ChannelDto> CreateChannelAsync(CreateChannelRequest req);
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
                    c.Station != null ? c.Station.Name : "",
                    c.Station != null ? c.Station.LineId : 0,
                    c.Station != null && c.Station.Line != null ? c.Station.Line.Name : "",
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

            var entity = new Channel { StationId = req.StationId, Name = req.Name, IpAddress = req.IpAddress };
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
    }
}
