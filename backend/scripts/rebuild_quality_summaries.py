"""Rebuild pcb_ntf_summaries / pcb_rty_summaries with the Job-File-mapping model rule.

Why: the summaries have no trigger, so bulk SQL changes (merge_none_pid.sql) left them stale, and the
model rule changed (effective model = Job File mapping, else pcb_results.model_id). The NTF summary
also gains job_file / model_id (latest test) for reports by model.

1. adds the new columns and first-test indexes (CREATE INDEX CONCURRENTLY: no write lock)
2. computes the new summaries into temp tables (reads only)
3. swaps the content in one short transaction (EXCLUSIVE lock: reads continue, summary writes wait)
4. recomputes PIDs uploaded while step 2 ran
Run after deploying the backend version that writes job_file / model_id.

python rebuild_quality_summaries.py
"""
import json, os, time
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(HERE, "..", "appsettings.Local.json"), encoding="utf-8"))
kv = {k.strip().lower(): v for k, v in (p.split("=", 1) for p in cfg["ConnectionStrings"]["DefaultConnection"].split(";") if "=" in p)}
conn = psycopg2.connect(host=kv["host"], port=kv["port"], dbname=kv["database"], user=kv["username"], password=kv["password"],
                        application_name="rebuild_quality_summaries")
conn.autocommit = True
cur = conn.cursor()
t0 = time.time()
def log(m): print(f"[{time.time() - t0:7.1f}s] {m}", flush=True)

VALID = """
    SELECT p.pid, p.station_id, p.inspect_time, p.result, p.job_file, p.model_id
    FROM pcb_results p
    LEFT JOIN job_file_model_mappings mapping ON mapping.job_file = p.job_file
    WHERE p.pid IS NOT NULL AND btrim(p.pid) <> ''
      AND p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED' AND COALESCE(p.error_code, '') !~* 'CHANGE[_.]JOB' AND isfinite(p.inspect_time)
      AND COALESCE(mapping.model_id, p.model_id) IS DISTINCT FROM 0 {extra}"""
NTF = """
    SELECT pid, station_id, MIN(inspect_time) AS first_test_time, MAX(inspect_time) AS last_test_time, COUNT(*) AS test_count,
           COUNT(*) FILTER (WHERE result IN ('NG', 'FAIL')) AS ng_count, BOOL_OR(result IN ('NG', 'FAIL')) AS ever_ng, NOW() AS updated_at,
           (array_agg(job_file ORDER BY inspect_time DESC))[1] AS job_file, (array_agg(model_id ORDER BY inspect_time DESC))[1] AS model_id
    FROM v GROUP BY pid, station_id"""
RTY = """
    SELECT pid, MIN(inspect_time) AS first_test_time, MAX(inspect_time) AS last_test_time, COUNT(DISTINCT station_id) AS station_count,
           COUNT(*) AS test_count, COUNT(*) FILTER (WHERE result IN ('NG', 'FAIL')) AS ng_count,
           BOOL_OR(result IN ('NG', 'FAIL')) AS ever_ng, NOW() AS updated_at
    FROM v GROUP BY pid"""
NTF_COLS = "(pid, station_id, first_test_time, last_test_time, test_count, ng_count, ever_ng, updated_at, job_file, model_id)"
RTY_COLS = "(pid, first_test_time, last_test_time, station_count, test_count, ng_count, ever_ng, updated_at)"

cur.execute("ALTER TABLE pcb_ntf_summaries ADD COLUMN IF NOT EXISTS job_file TEXT")
cur.execute("ALTER TABLE pcb_ntf_summaries ADD COLUMN IF NOT EXISTS model_id INT")
cur.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_pcb_ntf_summaries_first_test ON pcb_ntf_summaries (first_test_time)")
cur.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_pcb_rty_summaries_first_test ON pcb_rty_summaries (first_test_time)")
log("columns and indexes ready")

cur.execute("SELECT now()"); started = cur.fetchone()[0]
cur.execute(f"CREATE TEMP TABLE v AS {VALID.format(extra='')}")
log("valid results collected")
cur.execute(f"CREATE TEMP TABLE new_ntf AS {NTF}"); log("new NTF summaries computed")
cur.execute(f"CREATE TEMP TABLE new_rty AS {RTY}"); log("new RTY summaries computed")
cur.execute("DROP TABLE v")

cur.execute("BEGIN")
cur.execute("SET LOCAL lock_timeout = '60s'")
cur.execute("LOCK TABLE pcb_ntf_summaries, pcb_rty_summaries IN EXCLUSIVE MODE")
cur.execute("DELETE FROM pcb_ntf_summaries")
cur.execute(f"INSERT INTO pcb_ntf_summaries {NTF_COLS} SELECT * FROM new_ntf"); n1 = cur.rowcount
cur.execute("DELETE FROM pcb_rty_summaries")
cur.execute(f"INSERT INTO pcb_rty_summaries {RTY_COLS} SELECT * FROM new_rty"); n2 = cur.rowcount
cur.execute("COMMIT")
log(f"summaries replaced: {n1:,} PID-Station rows, {n2:,} PID rows")

# PIDs uploaded while the snapshot was being computed. created_at stores real UTC in a
# timestamp without time zone column, so compare it with the start time in UTC.
cur.execute("SELECT array_agg(DISTINCT pid) FROM pcb_results WHERE created_at >= (%s AT TIME ZONE 'UTC') - interval '2 minutes'", (started,))
pids = cur.fetchone()[0] or []
for i in range(0, len(pids), 500):
    chunk = pids[i:i + 500]
    cur.execute("BEGIN")
    cur.execute("DELETE FROM pcb_ntf_summaries WHERE pid = ANY(%s)", (chunk,))
    cur.execute("DELETE FROM pcb_rty_summaries WHERE pid = ANY(%s)", (chunk,))
    cur.execute(f"CREATE TEMP TABLE v ON COMMIT DROP AS {VALID.format(extra='AND p.pid = ANY(%s)')}", (chunk,))
    # Upserts: the backend refreshes the same PIDs concurrently.
    cur.execute(f"""INSERT INTO pcb_ntf_summaries {NTF_COLS} {NTF}
        ON CONFLICT (pid, station_id) DO UPDATE SET first_test_time = EXCLUDED.first_test_time,
            last_test_time = EXCLUDED.last_test_time, test_count = EXCLUDED.test_count, ng_count = EXCLUDED.ng_count,
            ever_ng = EXCLUDED.ever_ng, updated_at = EXCLUDED.updated_at, job_file = EXCLUDED.job_file, model_id = EXCLUDED.model_id""")
    cur.execute(f"""INSERT INTO pcb_rty_summaries {RTY_COLS} {RTY}
        ON CONFLICT (pid) DO UPDATE SET first_test_time = EXCLUDED.first_test_time, last_test_time = EXCLUDED.last_test_time,
            station_count = EXCLUDED.station_count, test_count = EXCLUDED.test_count, ng_count = EXCLUDED.ng_count,
            ever_ng = EXCLUDED.ever_ng, updated_at = EXCLUDED.updated_at""")
    cur.execute("COMMIT")
log(f"caught up {len(pids):,} PIDs uploaded during the rebuild")
cur.execute("ANALYZE pcb_ntf_summaries"); cur.execute("ANALYZE pcb_rty_summaries")
cur.execute("SELECT count(*), count(*) FILTER (WHERE job_file IS NULL) FROM pcb_ntf_summaries")
log("NTF rows / without job_file: %s" % (cur.fetchone(),))
conn.close()
