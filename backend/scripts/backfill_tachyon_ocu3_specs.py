"""
Backfill spec limits for existing Tachyon OCU3 RF steps (pcb_results.job_file
'OCU3;<process>_PCBA_TEST') that were stored without limits.

Rules (only steps whose spec_min AND spec_max are empty):
  LTE / WCDMA  "... MAX POWER"        -> 20.3 ~ 25.7   (WCDMA_INT is a different measurement: skipped)
  WCDMA        "... RX SENSITIVITY"   -> 0 ~ 1
  GSM          "... RX SENSITIVITY"   -> 0 ~ 3
  LTE          "... PRX SENSITIVITY"  -> 0 ~ 5

Runs in small batches (one Station x one day per statement, newest first) with a
pause between batches, and records each finished batch in tachyon_spec_backfill_log
so the script can be stopped and started again.

Usage:  python backfill_tachyon_ocu3_specs.py [--dry-run] [--pause 1.0] [--stations 1,6,10]
Revert: UPDATE test_steps SET spec_min = NULL, spec_max = NULL WHERE id IN (...) is not
        needed: the rows can be found again with the same filter and the values above
        (see REVERT_SQL at the bottom of this file).
"""
import argparse, datetime as dt, json, os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RULES_SQL = """
      (ts.step_type IN ('LTE','WCDMA') AND ts.step_name LIKE '% MAX POWER')
   OR (ts.step_type = 'WCDMA' AND ts.step_name LIKE '% RX SENSITIVITY')
   OR (ts.step_type = 'GSM'   AND ts.step_name LIKE '% RX SENSITIVITY')
   OR (ts.step_type = 'LTE'   AND ts.step_name LIKE '% PRX SENSITIVITY')"""

MIN_SQL = """CASE WHEN ts.step_name LIKE '% MAX POWER' THEN '20.3' ELSE '0' END"""
MAX_SQL = """CASE WHEN ts.step_name LIKE '% MAX POWER' THEN '25.7'
                  WHEN ts.step_type = 'GSM' THEN '3'
                  WHEN ts.step_name LIKE '% PRX SENSITIVITY' THEN '5'
                  ELSE '1' END"""


def connection():
    with open(os.path.join(ROOT, 'appsettings.Local.json'), encoding='utf-8-sig') as f:
        cs = list(json.load(f)['ConnectionStrings'].values())[0]
    kv = {k.strip().lower(): v for k, v in (p.split('=', 1) for p in cs.split(';') if '=' in p)}
    env = dict(os.environ, PGPASSWORD=kv['password'])
    args = ['psql', '-h', kv.get('host', 'localhost'), '-p', kv.get('port', '5432'),
            '-U', kv['username'], '-d', kv['database'], '-At', '-v', 'ON_ERROR_STOP=1']
    return args, env


def psql(sql, timeout=600):
    args, env = connection()
    r = subprocess.run(args + ['-c', sql], env=env, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='count the rows per batch, do not update')
    ap.add_argument('--pause', type=float, default=1.0, help='seconds between batches')
    ap.add_argument('--stations', default='1,6,10')
    ap.add_argument('--from-date', default='2025-12-01')
    ap.add_argument('--limit-batches', type=int, default=0)
    a = ap.parse_args()
    stations = [int(s) for s in a.stations.split(',')]

    psql("""CREATE TABLE IF NOT EXISTS tachyon_spec_backfill_log (
              station_id INT NOT NULL, day DATE NOT NULL, rows_updated INT NOT NULL,
              done_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (station_id, day))""")
    done = set()
    for line in psql("SELECT station_id || ',' || day FROM tachyon_spec_backfill_log").splitlines():
        s, d = line.split(',')
        done.add((int(s), d))

    start = dt.date.fromisoformat(a.from_date)
    today = dt.date.today()
    batches = [(s, today - dt.timedelta(days=i)) for i in range((today - start).days + 1) for s in stations]
    # Today's data is still growing: never mark it done, re-run it every time.
    total, began, n = 0, time.time(), 0
    for station, day in batches:
        if (station, day.isoformat()) in done and day < today:
            continue
        nxt = day + dt.timedelta(days=1)
        where = f"""ts.pcb_result_id = p.id
              AND COALESCE(ts.spec_min, '') = '' AND COALESCE(ts.spec_max, '') = ''
              AND ({RULES_SQL})"""
        pcbs = f"""SELECT id FROM pcb_results
                   WHERE station_id = {station} AND inspect_time >= '{day}' AND inspect_time < '{nxt}'
                     AND job_file LIKE 'OCU3;%PCBA_TEST'"""
        t0 = time.time()
        if a.dry_run:
            rows = int(psql(f"WITH p AS ({pcbs}) SELECT COUNT(*) FROM test_steps ts JOIN p ON {where}"))
        else:
            out = psql(f"""SET statement_timeout = '10min';
                WITH p AS ({pcbs}), u AS (
                    UPDATE test_steps ts SET spec_min = {MIN_SQL}, spec_max = {MAX_SQL}
                    FROM p WHERE {where} RETURNING 1)
                INSERT INTO tachyon_spec_backfill_log (station_id, day, rows_updated)
                SELECT {station}, '{day}', COUNT(*) FROM u
                ON CONFLICT (station_id, day) DO UPDATE
                    SET rows_updated = tachyon_spec_backfill_log.rows_updated + EXCLUDED.rows_updated, done_at = NOW()
                RETURNING rows_updated;""")
            # psql prints the RETURNING value, then the command tag ("INSERT 0 1").
            numbers = [l for l in out.splitlines() if l.strip().isdigit()]
            rows = int(numbers[-1]) if numbers else 0
        total += rows
        n += 1
        print(f"{dt.datetime.now():%H:%M:%S} station {station} {day}: {rows} rows ({time.time() - t0:.1f}s), total {total}", flush=True)
        if a.limit_batches and n >= a.limit_batches:
            break
        if rows:
            time.sleep(a.pause)
    print(f"DONE: {total} rows in {n} batches, {time.time() - began:.0f}s", flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as ex:
        print(f"ERROR: {ex}", flush=True)
        sys.exit(1)

# Revert (restores the empty limits written by this script):
REVERT_SQL = """
UPDATE test_steps ts SET spec_min = NULL, spec_max = NULL
FROM pcb_results p
WHERE ts.pcb_result_id = p.id AND p.station_id IN (1,6,10) AND p.job_file LIKE 'OCU3;%PCBA_TEST'
  AND ((ts.step_name LIKE '% MAX POWER' AND ts.spec_min = '20.3' AND ts.spec_max = '25.7')
    OR (ts.step_name LIKE '%RX SENSITIVITY' AND ts.spec_min = '0' AND ts.spec_max IN ('1','3','5')));
"""
