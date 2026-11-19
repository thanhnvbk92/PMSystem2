"""One-off: rebuild NTF / RTY summaries of every PID that has test records with an infinite start time.
Those records are left in pcb_results (raw data) but are no longer part of the quality summaries
(QualitySummaryService and the backfill skip them since this version). A PID whose records are all
infinite disappears from the summaries. Upserts, safe to run while the backend is refreshing summaries.

python refresh_summaries_infinite_pids.py
"""
import json, os, time
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(HERE, "..", "appsettings.Local.json"), encoding="utf-8"))
kv = {k.strip().lower(): v for k, v in (p.split("=", 1) for p in cfg["ConnectionStrings"]["DefaultConnection"].split(";") if "=" in p)}
conn = psycopg2.connect(host=kv["host"], port=kv["port"], dbname=kv["database"], user=kv["username"], password=kv["password"],
                        application_name="refresh_summaries_infinite_pids")
conn.autocommit = True
cur = conn.cursor()
t0 = time.time()
cur.execute("SELECT array_agg(DISTINCT pid) FROM pcb_results WHERE NOT isfinite(inspect_time) AND pid IS NOT NULL")
pids = cur.fetchone()[0] or []
print(f"PIDs with infinite start time records: {len(pids):,}", flush=True)
VALID = """SELECT p.pid, p.station_id, p.inspect_time, p.result, p.job_file, p.model_id
    FROM pcb_results p LEFT JOIN job_file_model_mappings mapping ON mapping.job_file = p.job_file
    WHERE p.pid = ANY(%s) AND p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED' AND isfinite(p.inspect_time)
      AND COALESCE(mapping.model_id, p.model_id) IS DISTINCT FROM 0"""
for i in range(0, len(pids), 1000):
    chunk = pids[i:i + 1000]
    cur.execute("BEGIN")
    cur.execute("DELETE FROM pcb_ntf_summaries WHERE pid = ANY(%s)", (chunk,))
    cur.execute("DELETE FROM pcb_rty_summaries WHERE pid = ANY(%s)", (chunk,))
    cur.execute(f"""WITH v AS ({VALID})
        INSERT INTO pcb_ntf_summaries (pid, station_id, first_test_time, last_test_time, test_count, ng_count, ever_ng, updated_at, job_file, model_id)
        SELECT pid, station_id, MIN(inspect_time), MAX(inspect_time), COUNT(*), COUNT(*) FILTER (WHERE result IN ('NG','FAIL')),
               BOOL_OR(result IN ('NG','FAIL')), NOW(), (array_agg(job_file ORDER BY inspect_time DESC))[1], (array_agg(model_id ORDER BY inspect_time DESC))[1]
        FROM v GROUP BY pid, station_id
        ON CONFLICT (pid, station_id) DO UPDATE SET first_test_time = EXCLUDED.first_test_time, last_test_time = EXCLUDED.last_test_time,
            test_count = EXCLUDED.test_count, ng_count = EXCLUDED.ng_count, ever_ng = EXCLUDED.ever_ng, updated_at = EXCLUDED.updated_at,
            job_file = EXCLUDED.job_file, model_id = EXCLUDED.model_id""", (chunk,))
    cur.execute(f"""WITH v AS ({VALID})
        INSERT INTO pcb_rty_summaries (pid, first_test_time, last_test_time, station_count, test_count, ng_count, ever_ng, updated_at)
        SELECT pid, MIN(inspect_time), MAX(inspect_time), COUNT(DISTINCT station_id), COUNT(*), COUNT(*) FILTER (WHERE result IN ('NG','FAIL')),
               BOOL_OR(result IN ('NG','FAIL')), NOW()
        FROM v GROUP BY pid
        ON CONFLICT (pid) DO UPDATE SET first_test_time = EXCLUDED.first_test_time, last_test_time = EXCLUDED.last_test_time,
            station_count = EXCLUDED.station_count, test_count = EXCLUDED.test_count, ng_count = EXCLUDED.ng_count,
            ever_ng = EXCLUDED.ever_ng, updated_at = EXCLUDED.updated_at""", (chunk,))
    cur.execute("COMMIT")
cur.execute("SELECT count(*) FROM pcb_ntf_summaries WHERE NOT isfinite(first_test_time) OR NOT isfinite(last_test_time)")
print(f"done in {time.time() - t0:.0f}s; NTF rows still infinite: {cur.fetchone()[0]}", flush=True)
conn.close()
