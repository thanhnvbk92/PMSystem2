from clickhouse_driver import Client
import psycopg2
from psycopg2.extras import execute_batch

def migrate_all_master():
    print("=== STARTING FULL MASTER DATA MIGRATION FROM CLICKHOUSE TO POSTGRESQL ===")
    
    ch_client = Client(host='192.168.100.10', port=9000)
    pg_conn = psycopg2.connect(host='127.0.0.1', port=5432, dbname='pmsystem2', user='postgres', password='Anduongb67')
    cur = pg_conn.cursor()

    # 1. Buyers
    print("\n[1/7] Migrating buyers...")
    ch_buyers = ch_client.execute("SELECT id, name, remark FROM buyer FINAL")
    execute_batch(cur, """
        INSERT INTO buyers (id, name, remark, created_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, remark = EXCLUDED.remark;
    """, ch_buyers)
    pg_conn.commit()
    print(f"  -> {len(ch_buyers)} buyers migrated.")

    # 2. Model Groups
    print("\n[2/7] Migrating model_groups...")
    ch_mg = ch_client.execute("SELECT id, buyer_id, name, remark FROM model_group FINAL")
    execute_batch(cur, """
        INSERT INTO model_groups (id, buyer_id, name, remark, created_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (id) DO UPDATE SET buyer_id = EXCLUDED.buyer_id, name = EXCLUDED.name, remark = EXCLUDED.remark;
    """, ch_mg)
    pg_conn.commit()
    print(f"  -> {len(ch_mg)} model_groups migrated.")

    # 3. Models
    print("\n[3/7] Migrating models...")
    ch_models = ch_client.execute("SELECT id, model_group_id, name, remark FROM models FINAL")
    execute_batch(cur, """
        INSERT INTO models (id, model_group_id, name, remark, created_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (id) DO UPDATE SET model_group_id = EXCLUDED.model_group_id, name = EXCLUDED.name, remark = EXCLUDED.remark;
    """, ch_models)
    pg_conn.commit()
    print(f"  -> {len(ch_models)} models migrated.")

    # 4. Station Types
    print("\n[4/7] Migrating station_types...")
    ch_st = ch_client.execute("SELECT id, name, remark FROM station_types FINAL")
    execute_batch(cur, """
        INSERT INTO station_types (id, name, remark, created_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, remark = EXCLUDED.remark;
    """, ch_st)
    pg_conn.commit()
    print(f"  -> {len(ch_st)} station_types migrated.")

    # 5. Device Types
    print("\n[5/7] Migrating device_types...")
    ch_dt = ch_client.execute("SELECT id, name, remark FROM device_types FINAL")
    execute_batch(cur, """
        INSERT INTO device_types (id, name, remark, created_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, remark = EXCLUDED.remark;
    """, ch_dt)
    pg_conn.commit()
    print(f"  -> {len(ch_dt)} device_types migrated.")

    # 6. Update Stations with FKs (model_group_id, station_type_id)
    print("\n[6/7] Updating stations with model_group_id & station_type_id...")
    ch_stations = ch_client.execute("SELECT id, model_group_id, station_type_id FROM stations FINAL")
    execute_batch(cur, """
        UPDATE stations
        SET model_group_id = NULLIF(%s, 0),
            station_type_id = NULLIF(%s, 0)
        WHERE id = %s;
    """, [(row[1], row[2], row[0]) for row in ch_stations])
    pg_conn.commit()
    print(f"  -> Updated {len(ch_stations)} stations.")

    # 7. Devices
    print("\n[7/7] Migrating devices...")
    ch_devices = ch_client.execute("SELECT id, channel_id, device_type_id, name, model_partno, serial_number, status, calibration_date, calibration_due_date, calibration_status, remark FROM devices FINAL")
    execute_batch(cur, """
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
    """, ch_devices)
    pg_conn.commit()
    print(f"  -> {len(ch_devices)} devices migrated.")

    # Reset sequences
    print("\nResetting sequences...")
    cur.execute("""
        SELECT setval('buyers_id_seq', COALESCE((SELECT MAX(id) FROM buyers), 1));
        SELECT setval('model_groups_id_seq', COALESCE((SELECT MAX(id) FROM model_groups), 1));
        SELECT setval('models_id_seq', COALESCE((SELECT MAX(id) FROM models), 1));
        SELECT setval('station_types_id_seq', COALESCE((SELECT MAX(id) FROM station_types), 1));
        SELECT setval('device_types_id_seq', COALESCE((SELECT MAX(id) FROM device_types), 1));
        SELECT setval('devices_id_seq', COALESCE((SELECT MAX(id) FROM devices), 1));
    """)
    pg_conn.commit()
    print("  -> Sequences reset completed.")

    cur.close()
    pg_conn.close()
    print("\n=== MIGRATION COMPLETED SUCCESSFULLY ===")

if __name__ == '__main__':
    migrate_all_master()
