-- PMSystem2 PostgreSQL Master & Telemetry Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Master Data Tables & Foreign Keys

-- Buyers Table
CREATE TABLE IF NOT EXISTS buyers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Model Groups Table
CREATE TABLE IF NOT EXISTS model_groups (
    id SERIAL PRIMARY KEY,
    buyer_id INT REFERENCES buyers(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Models Table
CREATE TABLE IF NOT EXISTS models (
    id SERIAL PRIMARY KEY,
    model_group_id INT REFERENCES model_groups(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Station Types Table
CREATE TABLE IF NOT EXISTS station_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lines Table
CREATE TABLE IF NOT EXISTS lines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stations Table
CREATE TABLE IF NOT EXISTS stations (
    id SERIAL PRIMARY KEY,
    line_id INT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    model_group_id INT REFERENCES model_groups(id) ON DELETE SET NULL,
    station_type_id INT REFERENCES station_types(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Channels Table
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    station_id INT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    machine_partno VARCHAR(100),
    ip_address VARCHAR(45) UNIQUE,
    mac_address VARCHAR(50),
    gmes_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'online',
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Device Types Table
CREATE TABLE IF NOT EXISTS device_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Devices Table
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

-- 2. Production Data Tables (Telemetry & Results)
CREATE TABLE IF NOT EXISTS pcb_results (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    channel_id INT NOT NULL REFERENCES channels(id),
    station_id INT NOT NULL REFERENCES stations(id),
    line_id INT NOT NULL REFERENCES lines(id),
    model_id INT REFERENCES models(id),
    buyer_id INT REFERENCES buyers(id),
    pid VARCHAR(100) NOT NULL,
    job_file VARCHAR(100),
    fid VARCHAR(100),
    pcba_partno VARCHAR(100),
    result VARCHAR(10) NOT NULL, -- 'OK' / 'NG'
    error_code VARCHAR(100),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    test_time DOUBLE PRECISION,
    file_path VARCHAR(500),
    inspect_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Test Steps Table
CREATE TABLE IF NOT EXISTS test_steps (
    id BIGSERIAL PRIMARY KEY,
    pcb_result_id UUID NOT NULL REFERENCES pcb_results(id) ON DELETE CASCADE,
    step_type VARCHAR(50),
    step_number INT NOT NULL,
    step_name VARCHAR(200),
    value TEXT,
    spec_min TEXT,
    spec_max TEXT,
    result VARCHAR(10) NOT NULL, -- 'OK' / 'NG'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for Query Performance
CREATE INDEX IF NOT EXISTS idx_pcb_results_pid ON pcb_results(pid);
CREATE INDEX IF NOT EXISTS idx_pcb_results_inspect_time ON pcb_results(inspect_time DESC);
CREATE INDEX IF NOT EXISTS idx_pcb_results_channel_id ON pcb_results(channel_id);
CREATE INDEX IF NOT EXISTS idx_test_steps_pcb_result_id ON test_steps(pcb_result_id);
