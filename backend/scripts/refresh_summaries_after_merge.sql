-- Rebuilds pcb_ntf_summaries / pcb_rty_summaries for every PID touched by merge_none_pid.sql.
-- Why: the summaries have no trigger; the backend refreshes them only for PIDs it receives in
-- uploads. merge_none_pid.sql changes pcb_results directly (PID, result, error_code, times), so the
-- summaries of the merged PIDs and of PID "None" stay as they were before the merge. In particular
-- a ROOT record with error_code DEFECT_UNSPECIFIED was excluded from the summaries; after the merge
-- it carries the measured error code and must be counted.
-- Same rules as QualitySummaryService.RefreshAsync. Safe to run again.
--
-- psql -f refresh_summaries_after_merge.sql
\set ON_ERROR_STOP on
\timing on
BEGIN;

CREATE TEMP TABLE affected ON COMMIT DROP AS
SELECT DISTINCT pid FROM bak_none_merge WHERE role = 'root'
UNION SELECT 'None';
CREATE UNIQUE INDEX ON affected (pid);
SELECT count(*) AS affected_pids FROM affected;

DELETE FROM pcb_ntf_summaries s USING affected a WHERE s.pid = a.pid;
DELETE FROM pcb_rty_summaries s USING affected a WHERE s.pid = a.pid;

CREATE TEMP TABLE valid_results ON COMMIT DROP AS
SELECT p.pid, p.station_id, p.inspect_time, p.result
FROM pcb_results p
JOIN affected a ON a.pid = p.pid
LEFT JOIN job_file_model_mappings mapping ON mapping.job_file = p.job_file
WHERE p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED'
  AND p.model_id IS DISTINCT FROM 0
  AND NOT (p.model_id IS NULL AND COALESCE(mapping.model_id, -1) = 0);

INSERT INTO pcb_ntf_summaries (pid, station_id, first_test_time, last_test_time, test_count, ng_count, ever_ng, updated_at)
SELECT pid, station_id, MIN(inspect_time), MAX(inspect_time), COUNT(*),
       COUNT(*) FILTER (WHERE result IN ('NG', 'FAIL')), BOOL_OR(result IN ('NG', 'FAIL')), NOW()
FROM valid_results GROUP BY pid, station_id;

INSERT INTO pcb_rty_summaries (pid, first_test_time, last_test_time, station_count, test_count, ng_count, ever_ng, updated_at)
SELECT pid, MIN(inspect_time), MAX(inspect_time), COUNT(DISTINCT station_id), COUNT(*),
       COUNT(*) FILTER (WHERE result IN ('NG', 'FAIL')), BOOL_OR(result IN ('NG', 'FAIL')), NOW()
FROM valid_results GROUP BY pid;

SELECT (SELECT count(*) FROM pcb_ntf_summaries s JOIN affected a USING (pid)) AS ntf_rows,
       (SELECT count(*) FROM pcb_rty_summaries s JOIN affected a USING (pid)) AS rty_rows;
COMMIT;
-- The backend caches NTF/RTY for 30 s; numbers update on the next dashboard refresh.
