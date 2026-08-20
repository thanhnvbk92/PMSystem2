using Microsoft.EntityFrameworkCore;
using Npgsql;
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
builder.Services.AddMemoryCache();

// Configure SignalR
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = true;
});

// Configure PostgreSQL DbContext
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? "Host=localhost;Port=5432;Database=pmsystem2;Username=postgres;Password=CHANGE_ME;Application Name=FCT-System-API;Maximum Pool Size=20;Minimum Pool Size=0;Connection Idle Lifetime=15;Connection Pruning Interval=5;Timeout=10;Command Timeout=60;";
var connectionBuilder = new NpgsqlConnectionStringBuilder(connectionString)
{
    ApplicationName = "FCT-System-API",
    MaxPoolSize = 20,
    MinPoolSize = 0,
    ConnectionIdleLifetime = 15,
    ConnectionPruningInterval = 5,
    Timeout = 10,
    CommandTimeout = 60
};
connectionString = connectionBuilder.ConnectionString;

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

// Register Application Services
builder.Services.AddSingleton<IMasterDataService, MasterDataService>();
builder.Services.AddScoped<IPcbService, PcbService>();
builder.Services.AddHostedService<CpkCatalogBackfillService>();
builder.Services.AddHostedService<CpkCacheRefreshService>();

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
                ALTER TABLE stations ADD COLUMN IF NOT EXISTS cpk_step_number INT;
                ALTER TABLE stations ADD COLUMN IF NOT EXISTS cpk_step_name VARCHAR(100);
                ALTER TABLE stations ADD COLUMN IF NOT EXISTS cpk_job_file VARCHAR(100);

                ALTER TABLE channels ADD COLUMN IF NOT EXISTS machine_partno VARCHAR(100);
                ALTER TABLE channels ADD COLUMN IF NOT EXISTS gmes_name VARCHAR(100);
                ALTER TABLE channels ADD COLUMN IF NOT EXISTS remark TEXT;
                ALTER TABLE channels ADD COLUMN IF NOT EXISTS cpk_step_number INT;
                ALTER TABLE channels ADD COLUMN IF NOT EXISTS cpk_step_name VARCHAR(100);

                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS job_file VARCHAR(100);
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS model_id INT REFERENCES models(id) ON DELETE SET NULL;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS buyer_id INT REFERENCES buyers(id) ON DELETE SET NULL;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS fid VARCHAR(100);
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS pcba_partno VARCHAR(100);
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS test_time DOUBLE PRECISION;
                ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);

                CREATE TABLE IF NOT EXISTS cpk_step_catalog (
                    id BIGSERIAL PRIMARY KEY,
                    station_id INT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
                    step_number INT NOT NULL,
                    step_name VARCHAR(100) NOT NULL,
                    step_type VARCHAR(50),
                    job_file VARCHAR(100) NOT NULL DEFAULT '',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT UX_cpk_step_catalog_station_number_name UNIQUE (station_id, step_number, step_name)
                );
                ALTER TABLE cpk_step_catalog ADD COLUMN IF NOT EXISTS job_file VARCHAR(100) NOT NULL DEFAULT '';
                ALTER TABLE cpk_step_catalog DROP CONSTRAINT IF EXISTS UX_cpk_step_catalog_station_number_name;
                CREATE UNIQUE INDEX IF NOT EXISTS UX_cpk_step_catalog_station_job_number_name
                    ON cpk_step_catalog (station_id, job_file, step_number, step_name);

                CREATE TABLE IF NOT EXISTS cpk_result_cache (
                    id BIGSERIAL PRIMARY KEY,
                    channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                    job_file VARCHAR(100) NOT NULL DEFAULT '',
                    step_number INT NOT NULL,
                    step_name VARCHAR(100) NOT NULL,
                    from_date TIMESTAMPTZ NOT NULL,
                    sample_count INT NOT NULL DEFAULT 0,
                    spec_min DOUBLE PRECISION,
                    spec_max DOUBLE PRECISION,
                    mean DOUBLE PRECISION,
                    standard_deviation DOUBLE PRECISION,
                    cpl DOUBLE PRECISION,
                    cpu DOUBLE PRECISION,
                    cpk DOUBLE PRECISION,
                    points_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT UX_cpk_result_cache_key UNIQUE (channel_id, job_file, step_number, step_name, from_date)
                );

            ");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Notice during schema initialization / column synchronization.");
        }

        // Keep CPK cache schema independent from the legacy synchronization
        // batch. A failure in an unrelated ALTER TABLE must not prevent the
        // cache table from being available to the overview endpoint.
        try
        {
            db.Database.SetCommandTimeout(60);
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS cpk_result_cache (
                    id BIGSERIAL PRIMARY KEY,
                    channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                    job_file VARCHAR(100) NOT NULL DEFAULT '',
                    step_number INT NOT NULL,
                    step_name VARCHAR(100) NOT NULL,
                    from_date TIMESTAMPTZ NOT NULL,
                    sample_count INT NOT NULL DEFAULT 0,
                    spec_min DOUBLE PRECISION,
                    spec_max DOUBLE PRECISION,
                    mean DOUBLE PRECISION,
                    standard_deviation DOUBLE PRECISION,
                    cpl DOUBLE PRECISION,
                    cpu DOUBLE PRECISION,
                    cpk DOUBLE PRECISION,
                    points_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE UNIQUE INDEX IF NOT EXISTS UX_cpk_result_cache_key
                    ON cpk_result_cache (channel_id, job_file, step_number, step_name, from_date);

                CREATE TABLE IF NOT EXISTS raw_cpk (
                    id BIGSERIAL PRIMARY KEY,
                    calculation_date DATE NOT NULL,
                    station_id INT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
                    channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                    job_file VARCHAR(100) NOT NULL,
                    step_number INT NOT NULL,
                    step_name VARCHAR(100) NOT NULL,
                    pid VARCHAR(100),
                    value DOUBLE PRECISION NOT NULL,
                    spec_min DOUBLE PRECISION NOT NULL,
                    spec_max DOUBLE PRECISION NOT NULL,
                    inspect_time TIMESTAMPTZ NOT NULL,
                    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS IX_raw_cpk_daily_lookup
                    ON raw_cpk (calculation_date, channel_id, job_file, step_number, step_name, inspect_time DESC);

                CREATE TABLE IF NOT EXISTS cpk_result_history (
                    id BIGSERIAL PRIMARY KEY,
                    calculation_date DATE NOT NULL,
                    station_id INT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
                    channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                    job_file VARCHAR(100) NOT NULL,
                    step_number INT NOT NULL,
                    step_name VARCHAR(100) NOT NULL,
                    period_start TIMESTAMPTZ NOT NULL,
                    period_end TIMESTAMPTZ NOT NULL,
                    sample_count INT NOT NULL,
                    spec_min DOUBLE PRECISION,
                    spec_max DOUBLE PRECISION,
                    mean DOUBLE PRECISION,
                    standard_deviation DOUBLE PRECISION,
                    cpl DOUBLE PRECISION,
                    cpu DOUBLE PRECISION,
                    cpk DOUBLE PRECISION,
                    status VARCHAR(30) NOT NULL,
                    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE UNIQUE INDEX IF NOT EXISTS UX_cpk_result_history_daily
                    ON cpk_result_history (calculation_date, channel_id, job_file, step_number, step_name);
            ");
            logger.LogInformation("CPK result cache table is ready.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to initialize the independent CPK result cache table.");
        }

        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS improvements (
                    id BIGSERIAL PRIMARY KEY,
                    code VARCHAR(30) NOT NULL UNIQUE,
                    title VARCHAR(200) NOT NULL,
                    error_code VARCHAR(100) NOT NULL,
                    line_id INT REFERENCES lines(id) ON DELETE SET NULL,
                    station_id INT REFERENCES stations(id) ON DELETE SET NULL,
                    problem_description TEXT,
                    root_cause TEXT,
                    owner VARCHAR(120),
                    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
                    baseline_start TIMESTAMPTZ NOT NULL,
                    baseline_end TIMESTAMPTZ NOT NULL,
                    tracking_start TIMESTAMPTZ NOT NULL,
                    tracking_end TIMESTAMPTZ NOT NULL,
                    target_reduction_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS IX_improvements_scope ON improvements(error_code, line_id, station_id);
                CREATE TABLE IF NOT EXISTS improvement_actions (
                    id BIGSERIAL PRIMARY KEY,
                    improvement_id BIGINT NOT NULL REFERENCES improvements(id) ON DELETE CASCADE,
                    description VARCHAR(300) NOT NULL,
                    owner VARCHAR(120),
                    status VARCHAR(30) NOT NULL DEFAULT 'TODO',
                    due_date TIMESTAMPTZ,
                    completed_at TIMESTAMPTZ,
                    evidence TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS IX_improvement_actions_parent ON improvement_actions(improvement_id, status);
            ");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to initialize improvement tracking tables.");
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
