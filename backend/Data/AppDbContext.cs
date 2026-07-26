using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
        }

        public DbSet<Buyer> Buyers => Set<Buyer>();
        public DbSet<ModelGroup> ModelGroups => Set<ModelGroup>();
        public DbSet<ModelItem> Models => Set<ModelItem>();
        public DbSet<StationType> StationTypes => Set<StationType>();
        public DbSet<Line> Lines => Set<Line>();
        public DbSet<Station> Stations => Set<Station>();
        public DbSet<Channel> Channels => Set<Channel>();
        public DbSet<DeviceType> DeviceTypes => Set<DeviceType>();
        public DbSet<Device> Devices => Set<Device>();
        public DbSet<PcbResult> PcbResults => Set<PcbResult>();
        public DbSet<TestStep> TestSteps => Set<TestStep>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // 1. ModelGroup -> Buyer (FK)
            modelBuilder.Entity<ModelGroup>()
                .HasOne(mg => mg.Buyer)
                .WithMany(b => b.ModelGroups)
                .HasForeignKey(mg => mg.BuyerId)
                .OnDelete(DeleteBehavior.SetNull);

            // 2. ModelItem -> ModelGroup (FK)
            modelBuilder.Entity<ModelItem>()
                .HasOne(m => m.ModelGroup)
                .WithMany(mg => mg.Models)
                .HasForeignKey(m => m.ModelGroupId)
                .OnDelete(DeleteBehavior.SetNull);

            // 3. Station -> Line, ModelGroup, StationType (FKs)
            modelBuilder.Entity<Station>()
                .HasOne(s => s.Line)
                .WithMany(l => l.Stations)
                .HasForeignKey(s => s.LineId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<Station>()
                .HasOne(s => s.ModelGroup)
                .WithMany(mg => mg.Stations)
                .HasForeignKey(s => s.ModelGroupId)
                .OnDelete(DeleteBehavior.SetNull);

            modelBuilder.Entity<Station>()
                .HasOne(s => s.StationType)
                .WithMany(st => st.Stations)
                .HasForeignKey(s => s.StationTypeId)
                .OnDelete(DeleteBehavior.SetNull);

            // 4. Channel -> Station (FK)
            modelBuilder.Entity<Channel>()
                .HasOne(c => c.Station)
                .WithMany(s => s.Channels)
                .HasForeignKey(c => c.StationId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<Channel>()
                .HasIndex(c => c.IpAddress)
                .IsUnique();

            // 5. Device -> Channel, DeviceType (FKs)
            modelBuilder.Entity<Device>()
                .HasOne(d => d.Channel)
                .WithMany(c => c.Devices)
                .HasForeignKey(d => d.ChannelId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<Device>()
                .HasOne(d => d.DeviceType)
                .WithMany(dt => dt.Devices)
                .HasForeignKey(d => d.DeviceTypeId)
                .OnDelete(DeleteBehavior.SetNull);

            // 6. TestStep -> PcbResult (FK)
            modelBuilder.Entity<TestStep>()
                .HasOne(t => t.PcbResult)
                .WithMany(p => p.TestSteps)
                .HasForeignKey(t => t.PcbResultId)
                .OnDelete(DeleteBehavior.Cascade);

            // 7. PcbResult Index
            modelBuilder.Entity<PcbResult>()
                .HasIndex(p => new { p.StationId, p.Pid, p.InspectTime, p.Result })
                .IsUnique()
                .HasDatabaseName("UX_pcb_results_station_pid_time_result");
        }
    }
}
