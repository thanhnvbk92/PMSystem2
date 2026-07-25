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
        public DbSet<Line> Lines => Set<Line>();
        public DbSet<Station> Stations => Set<Station>();
        public DbSet<Channel> Channels => Set<Channel>();
        public DbSet<PcbResult> PcbResults => Set<PcbResult>();
        public DbSet<TestStep> TestSteps => Set<TestStep>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Configure Relationships

            modelBuilder.Entity<Station>()
                .HasOne(s => s.Line)
                .WithMany(l => l.Stations)
                .HasForeignKey(s => s.LineId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<Channel>()
                .HasOne(c => c.Station)
                .WithMany(s => s.Channels)
                .HasForeignKey(c => c.StationId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<Channel>()
                .HasIndex(c => c.IpAddress)
                .IsUnique();

            modelBuilder.Entity<TestStep>()
                .HasOne(t => t.PcbResult)
                .WithMany(p => p.TestSteps)
                .HasForeignKey(t => t.PcbResultId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<PcbResult>()
                .HasIndex(p => new { p.StationId, p.Pid, p.InspectTime, p.Result })
                .IsUnique()
                .HasDatabaseName("UX_pcb_results_station_pid_time_result");
        }
    }
}
