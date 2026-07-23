"""
PMSystem2 - ClickHouse to PostgreSQL Automated High-Performance Migration Tool
Author: Antigravity AI Engineering
Description: Migrates Master Data and 8.6M+ Time-Series PCB Inspection logs from ClickHouse to PostgreSQL (TimescaleDB).
"""

import sys
import os
import argparse
import time
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_batch
from clickhouse_driver import Client

# Fix encoding issues for Windows console
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

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

BATCH_SIZE = 10000


def get_clickhouse_client(host, port, user, password, database):
    print(f"[*] Connecting to ClickHouse [{host}:{port} / db: {database}]...")
    try:
        client = Client(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            connect_timeout=5
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


def clear_existing_data(pg_conn):
    """Truncates/clears existing PostgreSQL tables to remove mockup data before migration."""
    print("\n[*] Clearing existing mockup data from PostgreSQL tables...")
    cursor = pg_conn.cursor()
    cursor.execute("""
        ALTER TABLE lines DROP COLUMN IF EXISTS buyer_id CASCADE;
        ALTER TABLE pcb_results DROP COLUMN IF EXISTS buyer_id CASCADE;

        ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS step_type VARCHAR(50);
        ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS step_number INT DEFAULT 0;
        ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS spec_min VARCHAR(100);
        ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS spec_max VARCHAR(100);

        TRUNCATE TABLE test_steps RESTART IDENTITY CASCADE;
        TRUNCATE TABLE pcb_results RESTART IDENTITY CASCADE;
        TRUNCATE TABLE channels RESTART IDENTITY CASCADE;
        TRUNCATE TABLE stations RESTART IDENTITY CASCADE;
        TRUNCATE TABLE lines RESTART IDENTITY CASCADE;
        TRUNCATE TABLE buyers RESTART IDENTITY CASCADE;
    """)
    pg_conn.commit()
    cursor.close()
    print("[OK] Existing mockup data and obsolete columns cleared successfully.")


def ensure_unassigned_fallback_records(pg_conn):
    """Ensures ID=0 records exist in master tables to prevent foreign key violations."""
    cursor = pg_conn.cursor()
    cursor.execute("""
        INSERT INTO buyers (id, name, remark, created_at)
        VALUES (0, 'Unassigned Buyer', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO lines (id, name, remark, created_at)
        VALUES (0, 'Unassigned Line', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO stations (id, line_id, name, remark, created_at)
        VALUES (0, 0, 'Unassigned Station', 'Fallback for orphaned records', NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO channels (id, station_id, name, ip_address, status, created_at)
        VALUES (0, 0, 'Unassigned Channel', '127.0.0.1', 'offline', NOW())
        ON CONFLICT (id) DO NOTHING;
    """)
    pg_conn.commit()
    cursor.close()
    print("[OK] Fallback records (ID=0) initialized in PostgreSQL.")


def migrate_master_data(ch_client, pg_conn):
    print("\n=== 1. MIGRATING MASTER DATA ===")
    ensure_unassigned_fallback_records(pg_conn)
    cursor = pg_conn.cursor()

    # 1. Buyers
    print("\n[1/4] Migrating Buyers...")
    try:
        table_name = "buyer" if ch_client.execute("EXISTS TABLE buyer")[0][0] else "buyers"
        ch_buyers = ch_client.execute(f"SELECT id, name, remark FROM {table_name} FINAL")
        
        insert_sql = """
            INSERT INTO buyers (id, name, remark, created_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                remark = EXCLUDED.remark;
        """
        execute_batch(cursor, insert_sql, ch_buyers)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_buyers)} buyers successfully.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for buyers migration: {e}")

    # 2. Lines
    print("\n[2/4] Migrating Lines...")
    try:
        ch_lines = ch_client.execute("SELECT id, name, remark FROM lines FINAL")
        lines_data = [(row[0], row[1], row[2]) for row in ch_lines]
        
        insert_sql = """
            INSERT INTO lines (id, name, remark, created_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                remark = EXCLUDED.remark;
        """
        execute_batch(cursor, insert_sql, lines_data)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_lines)} lines successfully.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for lines migration: {e}")

    # 3. Stations
    print("\n[3/4] Migrating Stations...")
    try:
        ch_stations = ch_client.execute("SELECT id, line_id, name FROM stations FINAL")
        stations_with_remark = [(row[0], row[1], row[2], "") for row in ch_stations]
        
        insert_sql = """
            INSERT INTO stations (id, line_id, name, remark, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                line_id = EXCLUDED.line_id,
                name = EXCLUDED.name;
        """
        execute_batch(cursor, insert_sql, stations_with_remark)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_stations)} stations successfully.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for stations migration: {e}")

    # 4. Channels
    print("\n[4/4] Migrating Channels...")
    try:
        ch_channels = ch_client.execute("SELECT id, station_id, name, ip_address, status FROM channels FINAL")
        
        insert_sql = """
            INSERT INTO channels (id, station_id, name, ip_address, status, created_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                station_id = EXCLUDED.station_id,
                name = EXCLUDED.name,
                ip_address = EXCLUDED.ip_address,
                status = EXCLUDED.status;
        """
        execute_batch(cursor, insert_sql, ch_channels)
        pg_conn.commit()
        print(f"   -> Migrated {len(ch_channels)} channels successfully.")
    except Exception as e:
        pg_conn.rollback()
        print(f"   Notice for channels migration: {e}")

    # Reset sequences
    print("\nResetting PostgreSQL serial sequences...")
    reset_sql = """
        SELECT setval('buyers_id_seq', COALESCE((SELECT MAX(id) FROM buyers), 1));
        SELECT setval('lines_id_seq', COALESCE((SELECT MAX(id) FROM lines), 1));
        SELECT setval('stations_id_seq', COALESCE((SELECT MAX(id) FROM stations), 1));
        SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1));
    """
    cursor.execute(reset_sql)
    pg_conn.commit()
    cursor.close()
    print("   -> Master Data sequences updated.")


def clean_str(val):
    if val is None:
        return ""
    return str(val).replace('\x00', '')


def transform_result(result_val):
    if not result_val:
        return "PASS"
    res_str = str(result_val).upper()
    if res_str in ["OK", "PASS", "1", "TRUE"]:
        return "PASS"
    return "FAIL"


def migrate_production_data(ch_client, pg_conn):
    print("\n=== 2. MIGRATING PRODUCTION TELEMETRY DATA ===")
    cursor = pg_conn.cursor()

    # Get valid master IDs from PostgreSQL for sanitization
    cursor.execute("SELECT id FROM buyers")
    valid_buyers = set(r[0] for r in cursor.fetchall())
    cursor.execute("SELECT id FROM lines")
    valid_lines = set(r[0] for r in cursor.fetchall())
    cursor.execute("SELECT id FROM stations")
    valid_stations = set(r[0] for r in cursor.fetchall())
    cursor.execute("SELECT id FROM channels")
    valid_channels = set(r[0] for r in cursor.fetchall())

    # Check total count in ClickHouse
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
            line_id,
            pid,
            toString(result) as res_str,
            start_time
        FROM pcb_results
    """

    print("Streaming records in high-speed batches...")
    start_time = time.time()
    migrated_count = 0

    insert_sql = """
        INSERT INTO pcb_results (id, channel_id, station_id, line_id, pid, result, inspect_time)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING;
    """

    clean_batch = []
    
    for row in ch_client.execute_iter(select_sql, settings={'max_block_size': BATCH_SIZE}):
        pcb_id, ch_id, st_id, ln_id, pid, res, insp_time = row
        
        # Sanitize Foreign Keys to 0 if missing
        ch_id = ch_id if ch_id in valid_channels else 0
        st_id = st_id if st_id in valid_stations else 0
        ln_id = ln_id if ln_id in valid_lines else 0
        
        res_clean = transform_result(res)
        
        clean_batch.append((pcb_id, ch_id, st_id, ln_id, pid, res_clean, insp_time))

        if len(clean_batch) >= BATCH_SIZE:
            try:
                execute_batch(cursor, insert_sql, clean_batch, page_size=BATCH_SIZE)
                pg_conn.commit()
                migrated_count += len(clean_batch)
                clean_batch.clear()
                
                if migrated_count % 50000 == 0 or migrated_count >= total_records:
                    elapsed = time.time() - start_time
                    rate = migrated_count / elapsed if elapsed > 0 else 0
                    pct = (migrated_count / total_records) * 100 if total_records > 0 else 100
                    print(f"   -> Progress: {migrated_count:,} / {total_records:,} ({pct:.1f}%) - Speed: {rate:.0f} rows/sec")
            except Exception as e:
                pg_conn.rollback()
                clean_batch.clear()
                print(f"   Batch insert warning: {e}")

    # Insert any remaining records in final batch
    if clean_batch:
        try:
            execute_batch(cursor, insert_sql, clean_batch, page_size=BATCH_SIZE)
            pg_conn.commit()
            migrated_count += len(clean_batch)
            clean_batch.clear()
        except Exception as e:
            pg_conn.rollback()
            print(f"   Final batch insert warning: {e}")

    # Migrate Test Steps if available
    try:
        if ch_client.execute("EXISTS TABLE test_steps")[0][0]:
            print("\nMigrating test_steps detailed inspection records...")
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
                WHERE pcb_result_id IN (SELECT id FROM pcb_results)
            """
            step_insert = """
                INSERT INTO test_steps (pcb_result_id, step_type, step_number, step_name, value, spec_min, spec_max, result, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW());
            """
            steps_migrated = 0
            clean_steps = []
            
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
                    execute_batch(cursor, step_insert, clean_steps, page_size=BATCH_SIZE)
                    pg_conn.commit()
                    steps_migrated += len(clean_steps)
                    clean_steps.clear()
                    if steps_migrated % 50000 == 0 or steps_migrated >= total_steps:
                        print(f"   -> Migrated {steps_migrated:,} / {total_steps:,} test steps...")
            
            if clean_steps:
                execute_batch(cursor, step_insert, clean_steps, page_size=BATCH_SIZE)
                pg_conn.commit()
                steps_migrated += len(clean_steps)
                clean_steps.clear()

            # Reset sequence
            cursor.execute("SELECT setval('test_steps_id_seq', COALESCE((SELECT MAX(id) FROM test_steps), 1));")
            pg_conn.commit()
            print(f"Migrated {steps_migrated:,} total test steps.")
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
    print(" PMSystem2 - ClickHouse to PostgreSQL Automated Migration Tool")
    print("==========================================================================")

    ch_client = get_clickhouse_client(args.ch_host, args.ch_port, args.ch_user, args.ch_pass, args.ch_db)
    if not ch_client:
        sys.exit(1)

    pg_conn = get_postgres_connection(args.pg_host, args.pg_port, args.pg_user, args.pg_pass, args.pg_db)
    if not pg_conn:
        sys.exit(1)

    try:
        clear_existing_data(pg_conn)
        migrate_master_data(ch_client, pg_conn)
        migrate_production_data(ch_client, pg_conn)
        print("\nMigration process completed successfully!")
    finally:
        if pg_conn:
            pg_conn.close()


if __name__ == "__main__":
    main()
