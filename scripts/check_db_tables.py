from clickhouse_driver import Client
import psycopg2

print("=== 1. CLICKHOUSE TABLES ===")
ch_client = Client(host='192.168.100.10', port=9000)
ch_tables = sorted([r[0] for r in ch_client.execute('SHOW TABLES')])
print(f"ClickHouse Total Tables: {len(ch_tables)}")
for t in ch_tables:
    try:
        cnt = ch_client.execute(f"SELECT count(*) FROM {t}")[0][0]
        print(f"  - {t:<25} ({cnt:,} records)")
    except Exception as e:
        print(f"  - {t:<25} (Error getting count: {e})")

print("\n=== 2. POSTGRESQL TABLES ===")
pg_conn = psycopg2.connect(host='127.0.0.1', port=5432, dbname='pmsystem2', user='postgres', password='Anduongb67')
cur = pg_conn.cursor()
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
pg_tables = [r[0] for r in cur.fetchall()]
print(f"PostgreSQL Total Tables: {len(pg_tables)}")
for t in pg_tables:
    try:
        cur.execute(f'SELECT count(*) FROM "{t}"')
        cnt = cur.fetchone()[0]
        print(f"  - {t:<25} ({cnt:,} records)")
    except Exception as e:
        print(f"  - {t:<25} (Error getting count: {e})")

ch_set = set(ch_tables)
pg_set = set(pg_tables)

print("\n=== 3. COMPARISON ANALYSIS ===")
print("Tables in ClickHouse but missing in PostgreSQL:")
for t in sorted(ch_set - pg_set):
    print(f"  [MISSING IN PG] {t}")

print("\nTables in PostgreSQL but not in ClickHouse:")
for t in sorted(pg_set - ch_set):
    print(f"  [NEW IN PG]     {t}")
