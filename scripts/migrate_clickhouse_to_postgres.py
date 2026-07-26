"""
PMSystem2 - Automated ClickHouse to PostgreSQL Migration Script
Author: Antigravity AI Engineering
Description:
    1. Truncates existing mockup / old data in PostgreSQL (TRUNCATE ... CASCADE).
    2. Aligns PostgreSQL schema (drops obsolete line_id/buyer_id in pcb_results, adds gmes_status, created_at, process_info).
    3. Initializes fallback ID=0 records for unassigned references.
    4. Migrates all Master Data (buyers, model_groups, models, station_types, device_types, lines, stations, channels, devices).
    5. Migrates Time-Series telemetry data (pcb_results) and detailed test steps (test_steps) in high-speed batches.
    6. Automatically populates error_code for NG results from the first failed test step.
"""

import sys
import os
import argparse
import time
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_batch
from clickhouse_driver import Client

import builtins

def pprint(*args, **kwargs):
    kwargs['flush'] = True
    builtins.print(*args, **kwargs)

print = pprint

# Default Configuration
DEFAULT_CH_HOST = os.getenv("CLICKHOUSE_HOST", "192.168.100.10")
DEFAULT_CH_PORT = int(os.getenv("CLICKHOUSE_PORT", 9000))
DEFAULT_CH_DB = os.getenv("CLICKHOUSE_DB", "default")
DEFAULT_CH_USER = os.getenv("CLICKHOUSE_USER", "default")
DEFAULT_CH_PASS = os.getenv("CLICKHOUSE_PASSWORD", "")

DEFAULT_PG_HOST = os.getenv("POSTGRES_HOST", "127.0.0.1")
DEFAULT_PG_PORT = int(os.getenv("POSTGRES_PORT", 5432))
DEFAULT_PG_DB = os.getenv("POSTGRES_DB", "pmsystem2")
DEFAULT_PG_USER = os.getenv("POSTGRES_USER", "postgres")
DEFAULT_PG_PASS = os.getenv("POSTGRES_PASSWORD", "Anduongb67")

BATCH_SIZE = 20000


def get_clickhouse_client(host, port, user, password, database):
    print(f"[*] Connecting to ClickHouse [{host}:{port} / db: {database}]...")
    try:
        client = Client(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            connect_timeout=10
        )
        client.execute("SELECT 1")
        print("[OK] ClickHouse connection established.")
        return client
    except Exception as e:
        print(f"[FAIL] Failed to connect to ClickHouse: {e}")
        return None


def get_postgres_connection(host, port, user, password, database):
    print(f"[*] Connecting to PostgreSQL [{host}:{port} / db: {database}]...")
    try:
        conn = psycopg2.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            dbname=database
        )
        conn.autocommit = False
        print("[OK] PostgreSQL connection established.")
        return conn
    except Exception as e:
        print(f"[FAIL] Failed to connect to PostgreSQL: {e}")
        return None


def truncate_and_prepare_schema(pg_conn):
    """Aligns database schema and truncates all existing data in PostgreSQL."""
    print("\n[*] Preparing PostgreSQL schema and truncating existing tables...")
    cursor = pg_conn.cursor()
    cursor.execute("""
        -- 1. Schema alignment
        ALTER TABLE pcb_results DROP COLUMN IF EXISTS line_id CASCADE;
        ALTER TABLE pcb_results DROP COLUMN IF EXISTS buyer_id CASCADE;
        ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS gmes_status VARCHAR(50);
        ALTER TABLE pcb_results ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
        ALTER TABLE pcb_results ALTER COLUMN job_file TYPE VARCHAR(500);
        ALTER TABLE pcb_results ALTER COLUMN pid TYPE VARCHAR(250);
        ALTER TABLE pcb_results ALTER COLUMN fid TYPE VARCHAR(250);
        ALTER TABLE pcb_results ALTER COLUMN pcba_partno TYPE VARCHAR(250);
        ALTER TABLE pcb_results ALTER COLUMN error_code TYPE VARCHAR(250);
        ALTER TABLE pcb_results ALTER COLUMN file_path TYPE TEXT;

        ALTER TABLE stations ADD COLUMN IF NOT EXISTS process_info VARCHAR(200);

        ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS step_type VARCHAR(250);
        ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS step_number INT DEFAULT 0;
        ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS spec_min VARCHAR(250);
        ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS spec_max VARCHAR(250);
        ALTER TABLE test_steps ALTER COLUMN step_name TYPE VARCHAR(250);
        ALTER TABLE test_steps ALTER COLUMN value TYPE TEXT;

        -- 2. Truncate all tables (cascading dependency order)
        TRUNCATE TABLE test_steps RESTART IDENTITY CASCADE;
        TRUNCATE TABLE pcb_results RESTART IDENTITY CASCADE;
        TRUNCATE TABLE devices RESTART IDENTITY CASCADE;
        TRUNCATE TABLE device_types RESTART IDENTITY CASCADE;
        TRUNCATE TABLE channels RESTART IDENTITY CASCADE;
        TRUNCATE TABLE stations RESTART IDENTITY CASCADE;
        TRUNCATE TABLE station_types RESTART IDENTITY CASCADE;
        TRUNCATE TABLE models RESTART IDENTITY CASCADE;
        TRUNCATE TABLE model_groups RESTART IDENTITY CASCADE;
        TRUNCATE TABLE lines RESTART IDENTITY CASCADE;
        TRUNCATE TABLE buyers RESTART IDENTITY CASCADE;
    """)
    pg_conn.commit()
    cursor.close()
    print("[OK] All PostgreSQL tables truncated and schema aligned successfully.")


def ensure_unassigned_fallback_records(pg_conn):
    """Ensures ID=0 records exist in master tables to prevent foreign key violations for orphaned telemetry logs."""
    cursor = pg_conn.cursor()
    cursor.execute("""
        INSERT INTO buyers (id, name, remark, created_at)
        VALUES (0, 'Unassigned Buyer', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO model_groups (id, buyer_id, name, remark, created_at)
        VALUES (0, 0, 'Unassigned Model Group', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO models (id, model_group_id, name, remark, created_at)
        VALUES (0, 0, 'Unassigned Model', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO station_types (id, name, remark, created_at)
        VALUES (0, 'Unassigned Station Type', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO device_types (id, name, remark, created_at)
        VALUES (0, 'Unassigned Device Type', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO lines (id, name, remark, created_at)
        VALUES (0, 'Unassigned Line', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO stations (id, line_id, model_group_id, station_type_id, name, remark, created_at)
        VALUES (0, 0, 0, 0, 'Unassigned Station', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO channels (id, station_id, name, ip_address, status, created_at)
        VALUES (0, 0, 'Unassigned Channel', '127.0.0.1', 'offline', NOW())
        ON CONFLICT (id) DO NOTHING;
    """)
    pg_conn.commit()
    cursor.close()
    print("[OK] Fallback records (ID=0) initialized in PostgreSQL.")


def migrate_master_data(ch_client, pg_conn):
    print("\n=== 1. MIGRATING FULL MASTER DATA ===")
    ensure_unassigned_fallback_records(pg_conn)
    cursor = pg_conn.cursor()

    # 1. Buyers
    print("\n[1/9] Migrating Buyers...")
    try:
        tbl = "buyer" if ch_client.execute("EXISTS TABLE buyer")[0][0] else "buyers"
        ch_buyers = ch_client.execute(f"SELECT id, name, remark FROM {tbl} FINAL")
        sql = """
            INSERT INTO buyers (id, name, remark, created_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, remark = EXCLUDED.remark;
        """
        execute_batch(cursor, sql, ch_buyers)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_buyers)} buyers.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for buyers: {e}")

    # 2. Model Groups
    print("\n[2/9] Migrating Model Groups...")
    try:
        tbl = "model_group" if ch_client.execute("EXISTS TABLE model_group")[0][0] else "model_groups"
        ch_mg = ch_client.execute(f"SELECT id, buyer_id, name, remark FROM {tbl} FINAL")
        sql = """
            INSERT INTO model_groups (id, buyer_id, name, remark, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET buyer_id = EXCLUDED.buyer_id, name = EXCLUDED.name, remark = EXCLUDED.remark;
        """
        execute_batch(cursor, sql, ch_mg)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_mg)} model groups.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for model_groups: {e}")

    # 3. Models
    print("\n[3/9] Migrating Models...")
    try:
        ch_models = ch_client.execute("SELECT id, model_group_id, name, remark FROM models FINAL")
        sql = """
            INSERT INTO models (id, model_group_id, name, remark, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET model_group_id = EXCLUDED.model_group_id, name = EXCLUDED.name, remark = EXCLUDED.remark;
        """
        execute_batch(cursor, sql, ch_models)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_models)} models.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for models: {e}")

    # 4. Station Types
    print("\n[4/9] Migrating Station Types...")
    try:
        ch_st = ch_client.execute("SELECT id, name, remark FROM station_types FINAL")
        sql = """
            INSERT INTO station_types (id, name, remark, created_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, remark = EXCLUDED.remark;
        """
        execute_batch(cursor, sql, ch_st)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_st)} station types.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for station_types: {e}")

    # 5. Device Types
    print("\n[5/9] Migrating Device Types...")
    try:
        ch_dt = ch_client.execute("SELECT id, name, remark FROM device_types FINAL")
        sql = """
            INSERT INTO device_types (id, name, remark, created_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, remark = EXCLUDED.remark;
        """
        execute_batch(cursor, sql, ch_dt)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_dt)} device types.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for device_types: {e}")

    # 6. Lines
    print("\n[6/9] Migrating Lines...")
    try:
        ch_lines = ch_client.execute("SELECT id, name, remark FROM lines FINAL")
        sql = """
            INSERT INTO lines (id, name, remark, created_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, remark = EXCLUDED.remark;
        """
        execute_batch(cursor, sql, ch_lines)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_lines)} lines.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for lines: {e}")

    # 7. Stations
    print("\n[7/9] Migrating Stations...")
    try:
        ch_stations = ch_client.execute("SELECT id, line_id, model_group_id, station_type_id, name FROM stations FINAL")
        stations_data = [
            (r[0], r[1], r[2] if r[2] != 0 else None, r[3] if r[3] != 0 else None, r[4], "")
            for r in ch_stations
        ]
        sql = """
            INSERT INTO stations (id, line_id, model_group_id, station_type_id, name, remark, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                line_id = EXCLUDED.line_id,
                model_group_id = EXCLUDED.model_group_id,
                station_type_id = EXCLUDED.station_type_id,
                name = EXCLUDED.name;
        """
        execute_batch(cursor, sql, stations_data)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_stations)} stations.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for stations: {e}")

    # 8. Channels
    print("\n[8/9] Migrating Channels...")
    try:
        ch_channels = ch_client.execute("SELECT id, station_id, name, ip_address, status FROM channels FINAL")
        sql = """
            INSERT INTO channels (id, station_id, name, ip_address, status, created_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                station_id = EXCLUDED.station_id,
                name = EXCLUDED.name,
                ip_address = EXCLUDED.ip_address,
                status = EXCLUDED.status;
        """
        execute_batch(cursor, sql, ch_channels)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_channels)} channels.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for channels: {e}")

    # 9. Devices
    print("\n[9/9] Migrating Devices...")
    try:
        ch_devices = ch_client.execute("SELECT id, channel_id, device_type_id, name, model_partno, serial_number, status, calibration_date, calibration_due_date, calibration_status, remark FROM devices FINAL")
        sql = """
            INSERT INTO devices (id, channel_id, device_type_id, name, model_partno, serial_number, status, calibration_date, calibration_due_date, calibration_status, remark, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                channel_id = EXCLUDED.channel_id,
                device_type_id = EXCLUDED.device_type_id,
                name = EXCLUDED.name,
                model_partno = EXCLUDED.model_partno,
                serial_number = EXCLUDED.serial_number,
                status = EXCLUDED.status,
                calibration_date = EXCLUDED.calibration_date,
                calibration_due_date = EXCLUDED.calibration_due_date,
                calibration_status = EXCLUDED.calibration_status,
                remark = EXCLUDED.remark;
        """
        execute_batch(cursor, sql, ch_devices)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_devices)} devices.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for devices: {e}")

    # Reset Sequences
    print("\nResetting PostgreSQL serial sequences...")
    reset_sql = """
        SELECT setval('buyers_id_seq', COALESCE((SELECT MAX(id) FROM buyers), 1));
        SELECT setval('model_groups_id_seq', COALESCE((SELECT MAX(id) FROM model_groups), 1));
        SELECT setval('models_id_seq', COALESCE((SELECT MAX(id) FROM models), 1));
        SELECT setval('station_types_id_seq', COALESCE((SELECT MAX(id) FROM station_types), 1));
        SELECT setval('device_types_id_seq', COALESCE((SELECT MAX(id) FROM device_types), 1));
        SELECT setval('lines_id_seq', COALESCE((SELECT MAX(id) FROM lines), 1));
        SELECT setval('stations_id_seq', COALESCE((SELECT MAX(id) FROM stations), 1));
        SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1));
        SELECT setval('devices_id_seq', COALESCE((SELECT MAX(id) FROM devices), 1));
    """
    cursor.execute(reset_sql)
    pg_conn.commit()
    cursor.close()
    print("[OK] Master Data sequences updated.")


def clean_str(val):
    if val is None:
        return ""
    return str(val).replace('\x00', '')


def transform_result(result_val):
    if not result_val:
        return "OK"
    res_str = str(result_val).upper()
    if res_str in ["OK", "PASS", "1", "TRUE"]:
        return "OK"
    return "NG"


def migrate_production_data(ch_client, pg_conn):
    print("\n=== 2. MIGRATING PRODUCTION TELEMETRY DATA ===")
    cursor = pg_conn.cursor()

    # Get valid master IDs from PostgreSQL for sanitization
    cursor.execute("SELECT id FROM stations")
    valid_stations = set(r[0] for r in cursor.fetchall())
    cursor.execute("SELECT id FROM channels")
    valid_channels = set(r[0] for r in cursor.fetchall())
    cursor.execute("SELECT id FROM models")
    valid_models = set(r[0] for r in cursor.fetchall())

    # Total count in ClickHouse
    try:
        total_records = ch_client.execute("SELECT count(*) FROM pcb_results")[0][0]
        print(f"Total PCB Results in ClickHouse: {total_records:,} records")
    except Exception as e:
        print(f"Failed to count pcb_results in ClickHouse: {e}")
        return

    if total_records == 0:
        print("No production telemetry data found in ClickHouse pcb_results table.")
        return

    select_sql = """
        SELECT 
            toString(id) as id_str,
            channel_id,
            station_id,
            pid,
            jobfile,
            model_id,
            fid,
            pcba_partno,
            start_time,
            end_time,
            test_time,
            toString(result) as res_str,
            file_path,
            created_at
        FROM pcb_results
    """

    print("Streaming PCB Results in high-speed batches...")
    start_time = time.time()
    migrated_count = 0

    insert_sql = """
        INSERT INTO pcb_results (
            id, channel_id, station_id, pid, job_file, model_id, fid, pcba_partno, 
            start_time, end_time, test_time, result, file_path, inspect_time, created_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING;
    """

    clean_batch = []
    
    for row in ch_client.execute_iter(select_sql, settings={'max_block_size': BATCH_SIZE}):
        pcb_id, ch_id, st_id, pid, job_file, m_id, fid, pcba_pno, st_time, end_t, test_t, res, f_path, crt_at = row
        
        # Sanitize Foreign Keys to 0 / None
        ch_id = ch_id if ch_id in valid_channels else 0
        st_id = st_id if st_id in valid_stations else 0
        m_id = m_id if (m_id and m_id in valid_models) else None
        
        res_clean = transform_result(res)
        pid_clean = clean_str(pid)
        job_file_clean = clean_str(job_file)
        fid_clean = clean_str(fid)
        pcba_pno_clean = clean_str(pcba_pno)
        f_path_clean = clean_str(f_path)
        
        clean_batch.append((
            pcb_id, ch_id, st_id, pid_clean, job_file_clean, m_id, fid_clean, pcba_pno_clean,
            st_time, end_t, test_t, res_clean, f_path_clean, st_time, crt_at
        ))

        if len(clean_batch) >= BATCH_SIZE:
            try:
                execute_batch(cursor, insert_sql, clean_batch, page_size=BATCH_SIZE)
                pg_conn.commit()
                migrated_count += len(clean_batch)
                clean_batch.clear()
                
                if migrated_count % 100000 == 0 or migrated_count >= total_records:
                    elapsed = time.time() - start_time
                    rate = migrated_count / elapsed if elapsed > 0 else 0
                    pct = (migrated_count / total_records) * 100 if total_records > 0 else 100
                    print(f"   -> Progress: {migrated_count:,} / {total_records:,} ({pct:.1f}%) - Speed: {rate:.0f} rows/sec")
            except Exception as e:
                pg_conn.rollback()
                clean_batch.clear()
                print(f"   Batch insert warning: {e}")

    # Insert remaining records
    if clean_batch:
        try:
            execute_batch(cursor, insert_sql, clean_batch, page_size=BATCH_SIZE)
            pg_conn.commit()
            migrated_count += len(clean_batch)
            clean_batch.clear()
        except Exception as e:
            pg_conn.rollback()
            print(f"   Final batch insert warning: {e}")

    # Migrate Test Steps if table exists
    try:
        if ch_client.execute("EXISTS TABLE test_steps")[0][0]:
            print("\n=== 3. MIGRATING DETAILED TEST STEPS ===")
            total_steps = ch_client.execute("SELECT count(*) FROM test_steps")[0][0]
            print(f"Total Test Steps in ClickHouse: {total_steps:,} records")

            step_sql = """
                SELECT 
                    toString(pcb_result_id), 
                    step_type, 
                    step_number, 
                    step_name, 
                    toString(value), 
                    spec_min, 
                    spec_max, 
                    toString(result) 
                FROM test_steps
            """
            step_insert = """
                INSERT INTO test_steps (pcb_result_id, step_type, step_number, step_name, value, spec_min, spec_max, result, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW());
            """
            steps_migrated = 0
            clean_steps = []
            step_start_time = time.time()
            
            for row in ch_client.execute_iter(step_sql, settings={'max_block_size': BATCH_SIZE}):
                pcb_res_id, st_type, st_num, st_name, val, s_min, s_max, res = row
                res_clean = transform_result(res)
                st_type_clean = clean_str(st_type)
                st_name_clean = clean_str(st_name)
                val_clean = clean_str(val)
                s_min_clean = clean_str(s_min)
                s_max_clean = clean_str(s_max)
                
                clean_steps.append((pcb_res_id, st_type_clean, st_num or 0, st_name_clean, val_clean, s_min_clean, s_max_clean, res_clean))
                
                if len(clean_steps) >= BATCH_SIZE:
                    try:
                        execute_batch(cursor, step_insert, clean_steps, page_size=BATCH_SIZE)
                        pg_conn.commit()
                        steps_migrated += len(clean_steps)
                        clean_steps.clear()
                        if steps_migrated % 100000 == 0 or steps_migrated >= total_steps:
                            elapsed = time.time() - step_start_time
                            rate = steps_migrated / elapsed if elapsed > 0 else 0
                            pct = (steps_migrated / total_steps) * 100 if total_steps > 0 else 100
                            print(f"   -> Progress: {steps_migrated:,} / {total_steps:,} ({pct:.1f}%) - Speed: {rate:.0f} rows/sec")
                    except Exception as ex:
                        pg_conn.rollback()
                        clean_steps.clear()
                        print(f"   Test steps batch warning: {ex}")
            
            if clean_steps:
                try:
                    execute_batch(cursor, step_insert, clean_steps, page_size=BATCH_SIZE)
                    pg_conn.commit()
                    steps_migrated += len(clean_steps)
                    clean_steps.clear()
                except Exception as ex:
                    pg_conn.rollback()
                    print(f"   Final test steps batch warning: {ex}")

            # Reset sequence
            cursor.execute("SELECT setval('test_steps_id_seq', COALESCE((SELECT MAX(id) FROM test_steps), 1));")
            pg_conn.commit()
            print(f"[OK] Migrated {steps_migrated:,} total test steps.")

            # Compute error_code for NG pcb_results from first failed test step
            print("\n[*] Populating error_code for NG PCB Results from first failed test steps...")
            cursor.execute("""
                UPDATE pcb_results p
                SET error_code = t.step_name
                FROM (
                    SELECT DISTINCT ON (pcb_result_id) pcb_result_id, 
                           COALESCE(NULLIF(step_name, ''), NULLIF(value, ''), 'DEFECT_UNSPECIFIED') as step_name
                    FROM test_steps
                    WHERE result IN ('NG', 'FAIL')
                    ORDER BY pcb_result_id, step_number ASC
                ) t
                WHERE p.id = t.pcb_result_id 
                  AND p.result IN ('NG', 'FAIL') 
                  AND (p.error_code IS NULL OR p.error_code = '');
            """)
            pg_conn.commit()
            print("[OK] Error codes updated from test steps for NG records.")

            cursor.execute("""
                UPDATE pcb_results
                SET error_code = 'DEFECT_UNSPECIFIED'
                WHERE result IN ('NG', 'FAIL') AND (error_code IS NULL OR error_code = '');
            """)
            pg_conn.commit()
            print("[OK] Fallback error codes set for remaining NG records.")

    except Exception as e:
        pg_conn.rollback()
        print(f"   Test steps migration notice: {e}")

    cursor.close()
    total_time = time.time() - start_time
    print(f"\nProduction telemetry migration finished in {total_time:.2f} seconds ({migrated_count:,} total PCB records).")


def main():
    parser = argparse.ArgumentParser(description="Migrate ClickHouse Data to PostgreSQL (PMSystem2)")
    parser.add_argument("--ch-host", default=DEFAULT_CH_HOST, help="ClickHouse Host")
    parser.add_argument("--ch-port", type=int, default=DEFAULT_CH_PORT, help="ClickHouse Port")
    parser.add_argument("--ch-db", default=DEFAULT_CH_DB, help="ClickHouse Database Name")
    parser.add_argument("--ch-user", default=DEFAULT_CH_USER, help="ClickHouse Username")
    parser.add_argument("--ch-pass", default=DEFAULT_CH_PASS, help="ClickHouse Password")

    parser.add_argument("--pg-host", default=DEFAULT_PG_HOST, help="PostgreSQL Host")
    parser.add_argument("--pg-port", type=int, default=DEFAULT_PG_PORT, help="PostgreSQL Port")
    parser.add_argument("--pg-db", default=DEFAULT_PG_DB, help="PostgreSQL Database Name")
    parser.add_argument("--pg-user", default=DEFAULT_PG_USER, help="PostgreSQL Username")
    parser.add_argument("--pg-pass", default=DEFAULT_PG_PASS, help="PostgreSQL Password")

    args = parser.parse_args()

    print("==========================================================================")
    print(" PMSystem2 - ClickHouse to PostgreSQL Automated High-Speed Migration Tool")
    print("==========================================================================")

    ch_client = get_clickhouse_client(args.ch_host, args.ch_port, args.ch_user, args.ch_pass, args.ch_db)
    if not ch_client:
        sys.exit(1)

    pg_conn = get_postgres_connection(args.pg_host, args.pg_port, args.pg_user, args.pg_pass, args.pg_db)
    if not pg_conn:
        sys.exit(1)

    try:
        truncate_and_prepare_schema(pg_conn)
        migrate_master_data(ch_client, pg_conn)
        migrate_production_data(ch_client, pg_conn)
        print("\n[SUCCESS] Full migration process completed successfully!")
    finally:
        if pg_conn:
            pg_conn.close()


if __name__ == "__main__":
    main()
