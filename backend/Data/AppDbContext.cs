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
        public DbSet<JobFileModelMapping> JobFileModelMappings => Set<JobFileModelMapping>();
        public DbSet<StationType> StationTypes => Set<StationType>();
        public DbSet<Line> Lines => Set<Line>();
        public DbSet<Station> Stations => Set<Station>();
        public DbSet<Channel> Channels => Set<Channel>();
        public DbSet<DeviceType> DeviceTypes => Set<DeviceType>();
        public DbSet<Device> Devices => Set<Device>();
        public DbSet<PcbResult> PcbResults => Set<PcbResult>();
        public DbSet<TestStep> TestSteps => Set<TestStep>();
        public DbSet<CpkStepCatalog> CpkStepCatalog => Set<CpkStepCatalog>();
        public DbSet<CpkResultCache> CpkResultCache => Set<CpkResultCache>();
        public DbSet<RawCpk> RawCpk => Set<RawCpk>();
        public DbSet<CpkResultHistory> CpkResultHistory => Set<CpkResultHistory>();
        public DbSet<Improvement> Improvements => Set<Improvement>();
        public DbSet<ImprovementAction> ImprovementActions => Set<ImprovementAction>();

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

            modelBuilder.Entity<JobFileModelMapping>()
                .HasOne(m => m.Model).WithMany(m => m.JobFileMappings)
                .HasForeignKey(m => m.ModelId).OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<JobFileModelMapping>()
                .HasIndex(m => m.JobFile).IsUnique();

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
                .HasIndex(p => new { p.Pid, p.Result, p.StartTime })
                .HasDatabaseName("IX_pcb_results_pid_result_start_time");

            modelBuilder.Entity<CpkStepCatalog>()
                .HasIndex(s => new { s.StationId, s.JobFile, s.StepNumber, s.StepName })
                .IsUnique()
                .HasDatabaseName("UX_cpk_step_catalog_station_job_number_name");

            modelBuilder.Entity<CpkResultCache>()
                .HasIndex(c => new { c.ChannelId, c.JobFile, c.StepNumber, c.StepName, c.FromDate })
                .IsUnique()
                .HasDatabaseName("UX_cpk_result_cache_key");

            modelBuilder.Entity<RawCpk>()
                .HasIndex(r => new { r.CalculationDate, r.ChannelId, r.JobFile, r.StepNumber, r.StepName });

            modelBuilder.Entity<CpkResultHistory>()
                .HasIndex(r => new { r.CalculationDate, r.ChannelId, r.JobFile, r.StepNumber, r.StepName })
                .IsUnique().HasDatabaseName("UX_cpk_result_history_daily");

            modelBuilder.Entity<Improvement>().HasIndex(i => i.Code).IsUnique();
            modelBuilder.Entity<ImprovementAction>()
                .HasOne(a => a.Improvement).WithMany(i => i.Actions)
                .HasForeignKey(a => a.ImprovementId).OnDelete(DeleteBehavior.Cascade);
        }
    }
}
