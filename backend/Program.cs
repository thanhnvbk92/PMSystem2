using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Npgsql;
using PMSystem2.Api.Data;
using PMSystem2.Api.Hubs;
using PMSystem2.Api.Services;

// Enable Npgsql legacy timestamp behavior to allow DateTime with Kind=Unspecified
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

// The API is launched interactively/by dotnet watch. Do not register the
// Windows Event Log provider because standard user accounts may not have write
// access to the .NET Runtime source, which can otherwise abort host startup.
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

// Optional machine-local settings. This file is ignored by Git so database
// credentials do not need to be committed to source control.
builder.Configuration.AddJsonFile(
    "appsettings.Local.json",
    optional: true,
    reloadOnChange: true);

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
    MaxPoolSize = 50,
    MinPoolSize = 0,
    ConnectionIdleLifetime = 15,
    ConnectionPruningInterval = 5,
    Timeout = 10,
    CommandTimeout = 60
};

if (string.IsNullOrWhiteSpace(connectionBuilder.Password) ||
    connectionBuilder.Password.Equals("CHANGE_ME", StringComparison.Ordinal))
{
    throw new InvalidOperationException(
        "Database password is not configured. Create backend/appsettings.Local.json " +
        "from appsettings.Local.example.json or set ConnectionStrings__DefaultConnection.");
}

connectionString = connectionBuilder.ConnectionString;

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString, npgsqlOptions =>
        npgsqlOptions.EnableRetryOnFailure(
            maxRetryCount: 3,
            maxRetryDelay: TimeSpan.FromSeconds(1),
            errorCodesToAdd: new[] { PostgresErrorCodes.DeadlockDetected })));

// Register Application Services
builder.Services.AddSingleton<IMasterDataService, MasterDataService>();
builder.Services.AddScoped<IPcbService, PcbService>();
builder.Services.AddScoped<IInvalidPcbResultService, InvalidPcbResultService>();
builder.Services.AddSingleton<MachineStatusService>();
builder.Services.AddHostedService<CpkOverviewIndexBootstrapService>();
builder.Services.AddHostedService<CpkCacheRefreshService>();

// Incremental CPK: request threads enqueue, one background loop computes,
// persists to cpk_current in batches and pushes changes over SignalR.
// (Replaces the per-PCB catalog INSERTs and the startup catalog rebuild.)
builder.Services.Configure<PMSystem2.Api.Services.Cpk.CpkOptions>(builder.Configuration.GetSection("Cpk"));
builder.Services.AddSingleton<PMSystem2.Api.Services.Cpk.CpkEngine>();
builder.Services.AddHostedService<PMSystem2.Api.Services.Cpk.CpkEngineService>();

// NTF/RTY quality summaries: uploads enqueue PIDs, one background worker refreshes them.
builder.Services.AddSingleton<QualitySummaryQueue>();
builder.Services.AddHostedService<QualitySummaryService>();

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
app.UseStaticFiles();
// wwwroot may not exist on the first startup. Register the upload directory
// explicitly so files created after startup are immediately available and
// previously uploaded improvement images do not return HTTP 404.
var uploadsRoot = Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads");
Directory.CreateDirectory(uploadsRoot);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadsRoot),
    RequestPath = "/uploads"
});
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

        // Persistent PID-level quality state used by NTF and system-wide RTY.
        // CREATE IF NOT EXISTS is cheap on subsequent starts; historical data is
        // populated by scripts/backfill_quality_summaries.sql once per database.
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS pcb_ntf_summaries (
                pid TEXT NOT NULL,
                station_id INT NOT NULL,
                first_test_time TIMESTAMPTZ NOT NULL,
                last_test_time TIMESTAMPTZ NOT NULL,
                test_count BIGINT NOT NULL,
                ng_count BIGINT NOT NULL,
                ever_ng BOOLEAN NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (pid, station_id)
            );
            CREATE INDEX IF NOT EXISTS ix_pcb_ntf_summaries_station_ever_ng
                ON pcb_ntf_summaries (station_id, ever_ng);

            CREATE TABLE IF NOT EXISTS pcb_rty_summaries (
                pid TEXT PRIMARY KEY,
                first_test_time TIMESTAMPTZ NOT NULL,
                last_test_time TIMESTAMPTZ NOT NULL,
                station_count INT NOT NULL,
                test_count BIGINT NOT NULL,
                ng_count BIGINT NOT NULL,
                ever_ng BOOLEAN NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_pcb_rty_summaries_ever_ng
                ON pcb_rty_summaries (ever_ng);
        ");

        // Ensure all missing ClickHouse master data tables and columns exist in PostgreSQL
        try
        {
            db.Database.SetCommandTimeout(60);
            var legacySchemaCurrent = await db.Database.SqlQueryRaw<bool>(@"
                SELECT (to_regclass('public.cpk_result_cache') IS NOT NULL
                    AND to_regclass('public.cpk_step_catalog') IS NOT NULL
                    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pcb_results' AND column_name='file_path')
                    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='channels' AND column_name='cpk_step_name')
                    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stations' AND column_name='cpk_job_file')) AS ""Value""
            ").SingleAsync();
            if (!legacySchemaCurrent)
            {
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

                -- One row per (Channel, Job, Step): the latest N OK samples and
                -- the CPK computed from them. Maintained by CpkEngineService.
                CREATE TABLE IF NOT EXISTS cpk_current (
                    channel_id INT NOT NULL,
                    job_file TEXT NOT NULL,
                    step_number INT NOT NULL,
                    step_name TEXT NOT NULL,
                    station_id INT NOT NULL,
                    step_type TEXT,
                    sample_count INT NOT NULL,
                    spec_min DOUBLE PRECISION,
                    spec_max DOUBLE PRECISION,
                    mean DOUBLE PRECISION,
                    standard_deviation DOUBLE PRECISION,
                    cpl DOUBLE PRECISION,
                    cpu DOUBLE PRECISION,
                    cpk DOUBLE PRECISION,
                    status VARCHAR(30) NOT NULL,
                    sample_values DOUBLE PRECISION[] NOT NULL,
                    sample_pids TEXT[] NOT NULL,
                    sample_times TIMESTAMPTZ[] NOT NULL,
                    first_time TIMESTAMPTZ NOT NULL,
                    last_time TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (channel_id, job_file, step_number, step_name)
                );
                CREATE INDEX IF NOT EXISTS IX_cpk_current_station ON cpk_current (station_id);

                -- Engine data-format version; a bump rebuilds cpk_current once.
                CREATE TABLE IF NOT EXISTS cpk_engine_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                -- Channels that already searched history older than the bootstrap
                -- window because they had no CPK (found = a study was recovered).
                CREATE TABLE IF NOT EXISTS cpk_fallback_state (
                    channel_id INT PRIMARY KEY,
                    found BOOLEAN NOT NULL,
                    checked_at TIMESTAMPTZ NOT NULL
                );

                -- Channels whose recent history (BootstrapDays) has been loaded.
                CREATE TABLE IF NOT EXISTS cpk_bootstrap_channel (
                    channel_id INT PRIMARY KEY,
                    completed_at TIMESTAMPTZ NOT NULL
                );

                -- Which (Station, history window) seeds of cpk_current are done (legacy).
                CREATE TABLE IF NOT EXISTS cpk_bootstrap_state (
                    station_id INT NOT NULL,
                    window_index INT NOT NULL,
                    completed_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (station_id, window_index)
                );
            ");
            logger.LogInformation("CPK result cache table is ready.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to initialize the independent CPK result cache table.");
        }

        db.Database.SetCommandTimeout(300);
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
                    model_id INT REFERENCES models(id) ON DELETE SET NULL,
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
                ALTER TABLE improvements ADD COLUMN IF NOT EXISTS model_id INT REFERENCES models(id) ON DELETE SET NULL;
                DROP INDEX IF EXISTS IX_improvements_scope;
                CREATE INDEX IF NOT EXISTS IX_improvements_scope ON improvements(error_code, line_id, station_id, model_id);
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
                ALTER TABLE improvement_actions ADD COLUMN IF NOT EXISTS before_report TEXT;
                ALTER TABLE improvement_actions ADD COLUMN IF NOT EXISTS after_report TEXT;
                ALTER TABLE improvement_actions ADD COLUMN IF NOT EXISTS before_image_url VARCHAR(500);
                ALTER TABLE improvement_actions ADD COLUMN IF NOT EXISTS after_image_url VARCHAR(500);
                CREATE TABLE IF NOT EXISTS job_file_model_mappings (
                    id SERIAL PRIMARY KEY,
                    job_file VARCHAR(255) NOT NULL UNIQUE,
                    model_id INT NULL REFERENCES models(id) ON DELETE SET NULL,
                    remark TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                ALTER TABLE job_file_model_mappings ALTER COLUMN model_id DROP NOT NULL;
                ALTER TABLE job_file_model_mappings DROP CONSTRAINT IF EXISTS job_file_model_mappings_model_id_fkey;
                ALTER TABLE job_file_model_mappings ADD CONSTRAINT job_file_model_mappings_model_id_fkey
                    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE SET NULL;
                CREATE INDEX IF NOT EXISTS IX_job_file_model_mappings_model ON job_file_model_mappings(model_id);
                CREATE TABLE IF NOT EXISTS invalid_pcb_results (
                    id BIGSERIAL PRIMARY KEY,
                    fingerprint VARCHAR(64) NOT NULL UNIQUE,
                    pid VARCHAR(100),
                    channel_id INT,
                    raw_result VARCHAR(100),
                    start_time TIMESTAMPTZ,
                    reason VARCHAR(300) NOT NULL,
                    payload_json JSONB NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
                    occurrence_count INT NOT NULL DEFAULT 1,
                    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    resolved_at TIMESTAMPTZ,
                    resolution_note TEXT
                );
                CREATE INDEX IF NOT EXISTS IX_invalid_pcb_results_status_seen
                    ON invalid_pcb_results(status, last_seen_at DESC);
                CREATE TABLE IF NOT EXISTS pcb_analytics_daily (
                    bucket_date DATE NOT NULL,
                    station_id INT NOT NULL,
                    channel_id INT NOT NULL,
                    result VARCHAR(10) NOT NULL,
                    error_code VARCHAR(100) NOT NULL DEFAULT '',
                    job_file VARCHAR(255) NOT NULL DEFAULT '',
                    model_id INT NOT NULL DEFAULT 0,
                    total_count BIGINT NOT NULL,
                    PRIMARY KEY (bucket_date, station_id, channel_id, result, error_code, job_file, model_id)
                );
                CREATE INDEX IF NOT EXISTS IX_pcb_analytics_daily_date ON pcb_analytics_daily(bucket_date);

                CREATE OR REPLACE FUNCTION update_pcb_analytics_daily() RETURNS TRIGGER AS $rollup$
                DECLARE old_date DATE; new_date DATE;
                BEGIN
                    IF TG_OP IN ('UPDATE', 'DELETE') THEN
                        old_date := OLD.inspect_time::date;
                        UPDATE pcb_analytics_daily SET total_count = total_count - 1
                        WHERE bucket_date = old_date AND station_id = OLD.station_id AND channel_id = OLD.channel_id
                          AND result = OLD.result AND error_code = COALESCE(OLD.error_code, '')
                          AND job_file = COALESCE(OLD.job_file, '') AND model_id = COALESCE(OLD.model_id, 0);
                        -- Only the row just decremented (primary key): a table-wide
                        -- 'total_count <= 0' scan made every UPDATE/DELETE take ~0.2 s.
                        DELETE FROM pcb_analytics_daily
                        WHERE bucket_date = old_date AND station_id = OLD.station_id AND channel_id = OLD.channel_id
                          AND result = OLD.result AND error_code = COALESCE(OLD.error_code, '')
                          AND job_file = COALESCE(OLD.job_file, '') AND model_id = COALESCE(OLD.model_id, 0)
                          AND total_count <= 0;
                    END IF;
                    IF TG_OP IN ('UPDATE', 'INSERT') THEN
                        new_date := NEW.inspect_time::date;
                        INSERT INTO pcb_analytics_daily
                            (bucket_date, station_id, channel_id, result, error_code, job_file, model_id, total_count)
                        VALUES (new_date, NEW.station_id, NEW.channel_id, NEW.result,
                            COALESCE(NEW.error_code, ''), COALESCE(NEW.job_file, ''), COALESCE(NEW.model_id, 0), 1)
                        ON CONFLICT (bucket_date, station_id, channel_id, result, error_code, job_file, model_id)
                        DO UPDATE SET total_count = pcb_analytics_daily.total_count + 1;
                    END IF;
                    RETURN COALESCE(NEW, OLD);
                END;
                $rollup$ LANGUAGE plpgsql;
                DROP TRIGGER IF EXISTS trg_pcb_analytics_daily ON pcb_results;
                CREATE TRIGGER trg_pcb_analytics_daily
                    AFTER INSERT OR UPDATE OR DELETE ON pcb_results
                    FOR EACH ROW EXECUTE FUNCTION update_pcb_analytics_daily();

                DO $backfill$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pcb_analytics_daily LIMIT 1) THEN
                        INSERT INTO pcb_analytics_daily
                            (bucket_date, station_id, channel_id, result, error_code, job_file, model_id, total_count)
                        SELECT inspect_time::date, station_id, channel_id, result,
                            COALESCE(error_code, ''), COALESCE(job_file, ''), COALESCE(model_id, 0), COUNT(*)
                        FROM pcb_results
                        GROUP BY inspect_time::date, station_id, channel_id, result,
                            COALESCE(error_code, ''), COALESCE(job_file, ''), COALESCE(model_id, 0);
                    END IF;
                END;
                $backfill$;
            ");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to initialize improvement tracking tables.");
        }
        finally
        {
            db.Database.SetCommandTimeout(60);
        }

        // PC monitoring: latest state of each Backup_Log2 PC and simple key/value settings.
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS machine_status (
                    mac_key VARCHAR(32) PRIMARY KEY,
                    mac_address VARCHAR(50),
                    channel_id INT,
                    hostname VARCHAR(100),
                    ip_address VARCHAR(200),
                    os_version VARCHAR(200),
                    app_version VARCHAR(50),
                    current_model VARCHAR(200),
                    log_type VARCHAR(200),
                    log_folders TEXT,
                    app_status VARCHAR(50),
                    cpu_percent DOUBLE PRECISION,
                    ram_total_mb INT,
                    ram_used_mb INT,
                    disk_drive VARCHAR(20),
                    disk_total_gb DOUBLE PRECISION,
                    disk_free_gb DOUBLE PRECISION,
                    app_started_at TIMESTAMPTZ,
                    last_upload_at TIMESTAMPTZ,
                    is_connected BOOLEAN NOT NULL DEFAULT FALSE,
                    is_legacy BOOLEAN NOT NULL DEFAULT TRUE,
                    connected_at TIMESTAMPTZ,
                    disconnected_at TIMESTAMPTZ,
                    last_seen_at TIMESTAMPTZ,
                    last_telemetry_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS IX_machine_status_channel ON machine_status(channel_id);
                CREATE TABLE IF NOT EXISTS app_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                -- Connections do not survive a server restart; PCs reconnect and mark themselves again.
                UPDATE machine_status SET is_connected = FALSE, disconnected_at = NOW() WHERE is_connected;
            ");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to initialize PC monitoring tables.");
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
