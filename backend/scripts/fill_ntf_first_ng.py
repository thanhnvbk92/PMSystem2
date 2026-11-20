"""One-off: fill pcb_ntf_summaries.first_ng_error_code / first_ng_channel_id (NG step and jig of the first NG
of each PID-Station) for rows written before these columns existed. Same record rules as the summaries:
DEFECT_UNSPECIFIED, job changes (CHANGE_JOB), infinite start times and the Unassigned model are not tests.
Runs station by station; safe while the backend is running (new refreshes write the columns themselves).

python fill_ntf_first_ng.py
"""
import json, os, time
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(HERE, "..", "appsettings.Local.json"), encoding="utf-8"))
kv = {k.strip().lower(): v for k, v in (p.split("=", 1) for p in cfg["ConnectionStrings"]["DefaultConnection"].split(";") if "=" in p)}
conn = psycopg2.connect(host=kv["host"], port=kv["port"], dbname=kv["database"], user=kv["username"], password=kv["password"],
                        application_name="fill_ntf_first_ng")
conn.autocommit = True
cur = conn.cursor()
t0 = time.time()
cur.execute("""SELECT count(*) FROM information_schema.columns
               WHERE table_name = 'pcb_ntf_summaries' AND column_name IN ('first_ng_error_code', 'first_ng_channel_id')""")
if cur.fetchone()[0] < 2:                       # ALTER takes a table lock even with IF NOT EXISTS: only when needed
    cur.execute("SET lock_timeout = '30s'")
    cur.execute("ALTER TABLE pcb_ntf_summaries ADD COLUMN IF NOT EXISTS first_ng_error_code TEXT")
    cur.execute("ALTER TABLE pcb_ntf_summaries ADD COLUMN IF NOT EXISTS first_ng_channel_id INT")
    cur.execute("SET lock_timeout = 0")
cur.execute("SELECT DISTINCT station_id FROM pcb_ntf_summaries WHERE ever_ng ORDER BY 1")
stations = [r[0] for r in cur.fetchall()]
total = 0
for sid in stations:
    for attempt in range(10):
        try:
            cur.execute("""
                UPDATE pcb_ntf_summaries s
                SET first_ng_error_code = f.code, first_ng_channel_id = f.ch
                FROM (SELECT DISTINCT ON (p.pid) p.pid, p.error_code AS code, p.channel_id AS ch
                      FROM pcb_results p
                      LEFT JOIN job_file_model_mappings mapping ON mapping.job_file = p.job_file
                      WHERE p.station_id = %s AND p.result IN ('NG', 'FAIL')
                        AND p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED'
                        AND COALESCE(p.error_code, '') !~* 'CHANGE[_.]JOB'
                        AND isfinite(p.inspect_time)
                        AND COALESCE(mapping.model_id, p.model_id) IS DISTINCT FROM 0
                      ORDER BY p.pid, p.inspect_time) f
                WHERE s.station_id = %s AND s.pid = f.pid AND s.ever_ng
                  AND (s.first_ng_error_code IS DISTINCT FROM f.code OR s.first_ng_channel_id IS DISTINCT FROM f.ch)""", (sid, sid))
            total += cur.rowcount; break
        except (psycopg2.errors.DeadlockDetected, psycopg2.errors.LockNotAvailable):
            time.sleep(2 + attempt)
    else:
        raise SystemExit(f"station {sid} failed after retries")
    print(f"  station {sid}: {cur.rowcount:,} rows ({time.time() - t0:.0f}s)", flush=True)
cur.execute("SELECT count(*) FILTER (WHERE ever_ng), count(*) FILTER (WHERE ever_ng AND first_ng_error_code IS NULL) FROM pcb_ntf_summaries")
ng, missing = cur.fetchone()
print(f"done in {time.time() - t0:.0f}s; {total:,} rows filled; NG rows {ng:,}, without NG step {missing:,}", flush=True)
conn.close()
