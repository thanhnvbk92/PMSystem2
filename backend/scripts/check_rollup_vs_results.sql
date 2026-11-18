-- Reconciles pcb_analytics_daily (filled by trigger trg_pcb_analytics_daily) with pcb_results.
-- The trigger buckets by inspect_time::date, which depends on the session TimeZone: if the backend
-- and a psql session (e.g. merge_none_pid.sql) use different TimeZone settings, UPDATE/DELETE
-- decrement a bucket that does not exist and the counts drift. Run this after bulk SQL changes.
--
-- psql -v day_from=2026-08-01 -v day_to=2026-11-19 -v repair=0 -f check_rollup_vs_results.sql
--   repair=1 rebuilds the rollup rows of every mismatching day before today (days that no
--   longer receive uploads, so the rebuild cannot race with the trigger).
\set ON_ERROR_STOP on
\timing on
SHOW TimeZone;
SELECT pg_get_functiondef(p.oid) LIKE '%Only the row just decremented%' AS fast_trigger_installed
FROM pg_proc p WHERE p.proname = 'update_pcb_analytics_daily';

CREATE TEMP TABLE actual AS
SELECT inspect_time::date AS d, station_id, channel_id, result, COALESCE(error_code, '') AS error_code,
       COALESCE(job_file, '') AS job_file, COALESCE(model_id, 0) AS model_id, count(*)::bigint AS n
FROM pcb_results
WHERE inspect_time >= :'day_from'::date AND inspect_time < :'day_to'::date
GROUP BY 1, 2, 3, 4, 5, 6, 7;

CREATE TEMP TABLE diff AS
SELECT COALESCE(a.d, r.bucket_date) AS d, COALESCE(a.n, 0) AS actual, COALESCE(r.total_count, 0) AS rollup
FROM actual a
FULL JOIN (SELECT * FROM pcb_analytics_daily WHERE bucket_date >= :'day_from'::date AND bucket_date < :'day_to'::date) r
  ON r.bucket_date = a.d AND r.station_id = a.station_id AND r.channel_id = a.channel_id AND r.result = a.result
 AND r.error_code = a.error_code AND r.job_file = a.job_file AND r.model_id = a.model_id
WHERE COALESCE(a.n, 0) <> COALESCE(r.total_count, 0);

-- Days with a difference (empty result = rollup is consistent).
SELECT d, count(*) AS keys_off, sum(actual) AS actual, sum(rollup) AS rollup, sum(rollup - actual) AS rollup_minus_actual
FROM diff GROUP BY d ORDER BY d;

\if :repair
BEGIN;
CREATE TEMP TABLE bad_days AS SELECT DISTINCT d FROM diff WHERE d < current_date;
DELETE FROM pcb_analytics_daily WHERE bucket_date IN (SELECT d FROM bad_days);
INSERT INTO pcb_analytics_daily (bucket_date, station_id, channel_id, result, error_code, job_file, model_id, total_count)
SELECT d, station_id, channel_id, result, error_code, job_file, model_id, n FROM actual WHERE d IN (SELECT d FROM bad_days);
SELECT count(*) AS repaired_days FROM bad_days;
COMMIT;
\endif
