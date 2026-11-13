-- One-time migration: change PCB identity from (pid, result, start_time)
-- to (pid, start_time).
--
-- Stop the backend and Backup Log clients before running this script. The table
-- is write-locked intentionally so no new duplicate can enter during migration.
-- For each duplicate key: retain OK/PASS when present, otherwise retain the
-- earliest record. test_steps of deleted PCB rows are removed by FK cascade.

BEGIN;
SET LOCAL statement_timeout = 0;
SET LOCAL lock_timeout = 0;

LOCK TABLE pcb_results IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE pcb_dedup_delete_ids (
    id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO pcb_dedup_delete_ids (id)
SELECT id
FROM (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY pid, start_time
               ORDER BY CASE WHEN UPPER(result) IN ('OK', 'PASS') THEN 0 ELSE 1 END,
                        created_at ASC,
                        id::text ASC
           ) AS row_num
    FROM pcb_results
    WHERE start_time IS NOT NULL
) ranked
WHERE ranked.row_num > 1;

-- Avoid executing the analytics rollup trigger once for every deleted row.
ALTER TABLE pcb_results DISABLE TRIGGER trg_pcb_analytics_daily;

DELETE FROM pcb_results target
USING pcb_dedup_delete_ids duplicate
WHERE target.id = duplicate.id;

-- Older deployments created unquoted/lower-case index names, while newer EF
-- configurations use quoted PascalCase names. PostgreSQL treats those as
-- different identifiers, so remove every known variant before recreating the
-- canonical index.
DROP INDEX IF EXISTS ix_pcb_results_pid_result_start_time;
DROP INDEX IF EXISTS "IX_pcb_results_pid_result_start_time";
DROP INDEX IF EXISTS ix_pcb_results_pid_start_time;
DROP INDEX IF EXISTS "IX_pcb_results_pid_start_time";
CREATE UNIQUE INDEX "IX_pcb_results_pid_start_time"
    ON pcb_results (pid, start_time);

-- Rebuild the rollup once, set-based, so it exactly matches retained PCB rows.
TRUNCATE TABLE pcb_analytics_daily;
INSERT INTO pcb_analytics_daily
    (bucket_date, station_id, channel_id, result, error_code, job_file, model_id, total_count)
SELECT inspect_time::date,
       station_id,
       channel_id,
       result,
       COALESCE(error_code, ''),
       COALESCE(job_file, ''),
       COALESCE(model_id, 0),
       COUNT(*)
FROM pcb_results
GROUP BY inspect_time::date,
         station_id,
         channel_id,
         result,
         COALESCE(error_code, ''),
         COALESCE(job_file, ''),
         COALESCE(model_id, 0);

ALTER TABLE pcb_results ENABLE TRIGGER trg_pcb_analytics_daily;
ANALYZE pcb_results;
ANALYZE pcb_analytics_daily;

-- Fail the migration if any legacy identity index somehow remains. Keeping it
-- would make the application model and the database enforce different keys.
DO $$
BEGIN
    IF to_regclass('public.ix_pcb_results_pid_result_start_time') IS NOT NULL
       OR to_regclass('public."IX_pcb_results_pid_result_start_time"') IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy PCB identity index still exists';
    END IF;
END $$;

COMMIT;
