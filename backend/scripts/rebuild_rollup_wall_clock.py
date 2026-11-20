"""One-off: switch pcb_analytics_daily to factory wall-clock days and rebuild it.

1. Installs the trigger function with (inspect_time AT TIME ZONE 'UTC')::date (same body as Program.cs).
2. Rebuilds the rollup in chunks of up to 7 days. Each chunk runs in its own short transaction that
   holds LOCK pcb_results IN SHARE MODE (reads continue, uploads wait a few seconds), deletes the
   chunk's buckets and re-inserts them from pcb_results.
   Old buckets were shifted +7 h, so every old bucket date d holds tests of wall days d and d-1;
   the chunk set is therefore {d, d-1} for all old bucket dates, which covers every row.
3. Verifies rollup == pcb_results for every rebuilt day.

python rebuild_rollup_wall_clock.py [--dry-run]
Reads the connection string from backend/appsettings.Local.json.
"""
import json, os, sys, time, datetime as dt
import psycopg2

DRY = "--dry-run" in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(HERE, "..", "appsettings.Local.json"), encoding="utf-8"))
cs = dict(p.split("=", 1) for p in cfg["ConnectionStrings"]["DefaultConnection"].split(";") if "=" in p)
conn = psycopg2.connect(host=cs["Host"], port=cs["Port"], dbname=cs["Database"], user=cs["Username"],
                        password=cs["Password"], application_name="rebuild_rollup_wall_clock")
cur = conn.cursor()
t0 = time.time()
def log(m): print(f"[{time.time() - t0:7.1f}s] {m}", flush=True)

FUNCTION = r"""
CREATE OR REPLACE FUNCTION update_pcb_analytics_daily() RETURNS TRIGGER AS $rollup$
DECLARE old_date DATE; new_date DATE;
BEGIN
    -- inspect_time holds the factory clock with a UTC marker. A bare ::date would
    -- convert it with the session TimeZone (Asia/Bangkok) and put 17:00-24:00 into
    -- the next day, so the wall-clock day is taken in UTC.
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        old_date := (OLD.inspect_time AT TIME ZONE 'UTC')::date;
        UPDATE pcb_analytics_daily SET total_count = total_count - 1
        WHERE bucket_date = old_date AND station_id = OLD.station_id AND channel_id = OLD.channel_id
          AND result = OLD.result AND error_code = COALESCE(OLD.error_code, '')
          AND job_file = COALESCE(OLD.job_file, '') AND model_id = COALESCE(OLD.model_id, 0);
        -- Only the row just decremented (primary key): a table-wide
        -- 'total_count <= 0' scan made every UPDATE/DELETE take ~0.2 s.
        DELETE FROM pcb_analytics_daily
        WHERE bucket_date = old_date AND station_id = OLD.station_id AND channel_id = OLD.channel_id
          AND result = OLD.result AND error_code = COALESCE(OLD.error_code, '')
          AND job_file = COALESCE(OLD.job_file, '') AND model_id = COALESCE(OLD.model_id, 0)
          AND total_count <= 0;
    END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN
        new_date := (NEW.inspect_time AT TIME ZONE 'UTC')::date;
        INSERT INTO pcb_analytics_daily
            (bucket_date, station_id, channel_id, result, error_code, job_file, model_id, total_count)
        VALUES (new_date, NEW.station_id, NEW.channel_id, NEW.result,
            COALESCE(NEW.error_code, ''), COALESCE(NEW.job_file, ''), COALESCE(NEW.model_id, 0), 1)
        ON CONFLICT (bucket_date, station_id, channel_id, result, error_code, job_file, model_id)
        DO UPDATE SET total_count = pcb_analytics_daily.total_count + 1;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$rollup$ LANGUAGE plpgsql;
"""

cur.execute("SELECT DISTINCT bucket_date FROM pcb_analytics_daily WHERE isfinite(bucket_date) ORDER BY 1")
old_dates = [r[0] for r in cur.fetchall()]
dates = sorted(set(old_dates) | {d - dt.timedelta(days=1) for d in old_dates})
chunks, cur_chunk = [], []
for d in dates:
    if cur_chunk and (d - cur_chunk[0]).days >= 7 or cur_chunk and (d - cur_chunk[-1]).days > 1:
        chunks.append(cur_chunk); cur_chunk = []
    cur_chunk.append(d)
if cur_chunk: chunks.append(cur_chunk)
conn.rollback()
log(f"{len(old_dates)} old bucket dates -> {len(dates)} wall dates in {len(chunks)} chunks "
    f"({dates[0] if dates else '-'} .. {dates[-1] if dates else '-'})")
if DRY:
    sys.exit(0)

cur.execute(FUNCTION); conn.commit(); log("trigger function installed (wall-clock day)")

for i, ch in enumerate(chunks, 1):
    a, b = ch[0], ch[-1] + dt.timedelta(days=1)
    for attempt in range(5):
        try:
            cur.execute("SET LOCAL lock_timeout = '15s'")
            cur.execute("LOCK TABLE pcb_results IN SHARE MODE")
            cur.execute("DELETE FROM pcb_analytics_daily WHERE bucket_date >= %s AND bucket_date < %s", (a, b))
            cur.execute("""
                INSERT INTO pcb_analytics_daily (bucket_date, station_id, channel_id, result, error_code, job_file, model_id, total_count)
                SELECT (inspect_time AT TIME ZONE 'UTC')::date, station_id, channel_id, result,
                       COALESCE(error_code, ''), COALESCE(job_file, ''), COALESCE(model_id, 0), count(*)
                FROM pcb_results
                WHERE inspect_time >= (%s::timestamp AT TIME ZONE 'UTC') AND inspect_time < (%s::timestamp AT TIME ZONE 'UTC')
                  AND COALESCE(error_code, '') !~* 'CHANGE[_.]JOB'      -- a job change is not a test
                GROUP BY 1, 2, 3, 4, 5, 6, 7""", (a, b))
            n = cur.rowcount
            conn.commit()
            break
        except psycopg2.errors.LockNotAvailable:
            conn.rollback(); log(f"chunk {a}: lock busy, retry {attempt + 1}"); time.sleep(5)
    else:
        raise SystemExit(f"chunk {a}..{b} could not get the lock")
    if i % 10 == 0 or i == len(chunks):
        log(f"chunk {i}/{len(chunks)} {a}..{b - dt.timedelta(days=1)} rows={n}")

# Verification of every rebuilt day (rows inserted after a chunk are counted by the new trigger).
cur.execute("""
    WITH actual AS (
        SELECT (inspect_time AT TIME ZONE 'UTC')::date AS d, count(*) AS n FROM pcb_results
        WHERE isfinite(inspect_time) AND COALESCE(error_code, '') !~* 'CHANGE[_.]JOB' AND inspect_time >= (%s::timestamp AT TIME ZONE 'UTC')
        GROUP BY 1),
    roll AS (SELECT bucket_date AS d, sum(total_count) AS n FROM pcb_analytics_daily
             WHERE isfinite(bucket_date) AND bucket_date >= %s GROUP BY 1)
    SELECT COALESCE(a.d, r.d), COALESCE(a.n, 0), COALESCE(r.n, 0) FROM actual a FULL JOIN roll r ON r.d = a.d
    WHERE COALESCE(a.n, 0) <> COALESCE(r.n, 0) ORDER BY 1""", (dates[0], dates[0]))
bad = cur.fetchall(); conn.rollback()
log("verification: OK, rollup matches pcb_results on every day" if not bad else f"verification: {len(bad)} days differ: {bad[:10]}")
conn.close()
