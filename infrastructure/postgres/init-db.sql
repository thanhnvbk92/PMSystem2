-- PMSystem2 Database Initialization Script (Standard PostgreSQL & TimescaleDB compatible)

-- 1. Enable TimescaleDB Extension if available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
        CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'TimescaleDB extension not present, proceeding with standard PostgreSQL.';
END $$;

-- 2. Master Data Tables (Standard RDBMS Tables with FKs)
CREATE TABLE IF NOT EXISTS buyers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stations (
    id SERIAL PRIMARY KEY,
    line_id INT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    station_id INT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45),
    status VARCHAR(20) DEFAULT 'online',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Production Data Tables (Time-Series Table)
CREATE TABLE IF NOT EXISTS pcb_results (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    channel_id INT NOT NULL,
    station_id INT NOT NULL,
    line_id INT NOT NULL,
    pid VARCHAR(100) NOT NULL,
    result VARCHAR(10) NOT NULL, -- 'OK' / 'NG'
    error_code VARCHAR(100),
    inspect_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_steps (
    id BIGSERIAL PRIMARY KEY,
    pcb_result_id UUID NOT NULL,
    step_type VARCHAR(50),
    step_number INT DEFAULT 0,
    step_name VARCHAR(100) NOT NULL,
    value VARCHAR(100),
    spec_min VARCHAR(100),
    spec_max VARCHAR(100),
    result VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safely convert pcb_results into a TimescaleDB Hypertable if timescaledb exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('pcb_results', 'inspect_time', if_not_exists => TRUE, chunk_time_interval => INTERVAL '7 days');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Skipping create_hypertable on standard PostgreSQL.';
END $$;

-- Create Efficient Indexes
CREATE INDEX IF NOT EXISTS idx_pcb_results_brin ON pcb_results USING BRIN (inspect_time);
CREATE INDEX IF NOT EXISTS idx_pcb_results_channel_time ON pcb_results (channel_id, inspect_time DESC);
CREATE INDEX IF NOT EXISTS idx_pcb_results_station_time ON pcb_results (station_id, inspect_time DESC);
CREATE INDEX IF NOT EXISTS idx_pcb_results_line_time ON pcb_results (line_id, inspect_time DESC);
CREATE INDEX IF NOT EXISTS idx_pcb_results_pid ON pcb_results (pid);
