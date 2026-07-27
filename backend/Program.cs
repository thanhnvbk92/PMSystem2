using Microsoft.EntityFrameworkCore;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Services;

// Enable Npgsql legacy timestamp behavior to allow DateTime with Kind=Unspecified
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

// Bind Kestrel to listen on all network interfaces (LAN & Localhost) on port 5000
builder.WebHost.UseUrls("http://0.0.0.0:5000");

// Add Services to Container
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure SignalR
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = true;
});

// Configure PostgreSQL DbContext
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? "Host=localhost;Port=5432;Database=pmsystem2;Username=postgres;Password=postgrespassword;";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

// Register Application Services
builder.Services.AddSingleton<IMasterDataService, MasterDataService>();
builder.Services.AddScoped<IPcbService, PcbService>();

// Configure CORS for LAN access
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.SetIsOriginAllowed(_ => true) // Allow any LAN IP or origin
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials(); // Critical for SignalR WebSocket handshake
    });
});

var app = builder.Build();

// Configure HTTP pipeline
if (app.Environment.IsDevelopment() || true)
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowFrontend");
app.UseAuthorization();

app.MapControllers();
app.MapHub<ProductionHub>("/hubs/production");
app.MapHub<CommandHub>("/hubs/command");

// Initialize Database & Refresh Master Data Cache on Startup
using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.EnsureCreated();

        // Ensure all missing ClickHouse master data tables and columns exist in PostgreSQL
        try
        {
            db.Database.SetCommandTimeout(60);
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS model_groups (
                    id SERIAL PRIMARY KEY,
                    buyer_id INT REFERENCES buyers(id) ON DELETE SET NULL,
                    name VARCHAR(100) NOT NULL,
                    remark TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS models (
                    id SERIAL PRIMARY KEY,
                    model_group_id INT REFERENCES model_groups(id) ON DELETE SET NULL,
                    name VARCHAR(100) NOT NULL,
                    remark TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS station_types (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    remark TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS device_types (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    remark TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS devices (
                    id SERIAL PRIMARY KEY,
                    channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                    device_type_id INT REFERENCES device_types(id) ON DELETE SET NULL,
                    name VARCHAR(100) NOT NULL,
                    model_partno VARCHAR(100),
                    serial_number VARCHAR(100),
                    status VARCHAR(20) NOT NULL DEFAULT 'OK',
                    calibration_date TIMESTAMPTZ,
                    calibration_due_date TIMESTAMPTZ,
                    calibration_status VARCHAR(50),
                    remark TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                ALTER TABLE stations ADD COLUMN IF NOT EXISTS model_group_id INT REFERENCES model_groups(id) ON DELETE SET NULL;
                ALTER TABLE stations ADD COLUMN IF NOT EXISTS station_type_id INT REFERENCES station_types(id) ON DELETE SET NULL;

                ALTER TABLE channels ADD COLUMN IF NOT EXISTS machine_partno VARCHAR(100);
                ALTER TABLE channels ADD COLUMN IF NOT EXISTS gmes_name VARCHAR(100);
                ALTER TABLE channels ADD COLUMN IF NOT EXISTS remark TEXT;

                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS job_file VARCHAR(100);
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS model_id INT REFERENCES models(id) ON DELETE SET NULL;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS buyer_id INT REFERENCES buyers(id) ON DELETE SET NULL;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS fid VARCHAR(100);
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS pcba_partno VARCHAR(100);
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS test_time DOUBLE PRECISION;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);
            ");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Notice during schema initialization / column synchronization.");
        }

        logger.LogInformation("PostgreSQL Database initialized successfully.");

        var masterDataService = app.Services.GetRequiredService<IMasterDataService>();
        await masterDataService.SeedDefaultDataIfEmptyAsync();
        await masterDataService.RefreshCacheAsync();
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "An error occurred while initializing the database.");
    }
}

app.Run();
