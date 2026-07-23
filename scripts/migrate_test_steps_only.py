import os
import sys
import time
import psycopg2
from psycopg2.extras import execute_batch
from clickhouse_driver import Client

BATCH_SIZE = 10000

def get_clickhouse_client():
    return Client(
        host="192.168.100.10",
        port=9000,
        user="default",
        password="",
        database="default",
        connect_timeout=10
    )

def get_postgres_connection():
    conn = psycopg2.connect(
        host="127.0.0.1",
        port=5432,
        user="postgres",
        password="Anduongb67",
        dbname="pmsystem2"
    )
    conn.autocommit = False
    return conn

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

def migrate_test_steps():
    print("=== MIGRATING TEST STEPS (19.4M Records) ===")
    ch_client = get_clickhouse_client()
    pg_conn = get_postgres_connection()
    cursor = pg_conn.cursor()

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
    start_time = time.time()

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
            if steps_migrated % 100000 == 0 or steps_migrated >= total_steps:
                elapsed = time.time() - start_time
                speed = steps_migrated / elapsed if elapsed > 0 else 0
                pct = (steps_migrated / total_steps) * 100
                print(f"   -> Progress: {steps_migrated:,} / {total_steps:,} ({pct:.1f}%) - Speed: {speed:.0f} rows/sec")

    if clean_steps:
        execute_batch(cursor, step_insert, clean_steps, page_size=BATCH_SIZE)
        pg_conn.commit()
        steps_migrated += len(clean_steps)
        clean_steps.clear()

    print(f"[*] Resetting test_steps sequence...")
    cursor.execute("SELECT setval('test_steps_id_seq', COALESCE((SELECT MAX(id) FROM test_steps), 1));")
    pg_conn.commit()

    total_time = time.time() - start_time
    print(f"Successfully migrated {steps_migrated:,} test steps in {total_time:.2f} seconds!")
    cursor.close()
    pg_conn.close()

if __name__ == "__main__":
    migrate_test_steps()
