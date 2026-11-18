-- Merges the two records QSPR PathCheck / NAD RFCal stations produced for one test before the
-- BMWRFLog "None" PID fix (Backup_Log2 0c94f29):
--   "None" record : PID "None", the measured steps, time = result file time
--   ROOT record   : real PID, final result, real start/end time, 0 steps
-- The "None" record keeps its steps and takes the PID, result and times of the ROOT record; the ROOT
-- record is deleted. Both rows are copied to bak_none_merge first (batch = :'batch').
-- A ROOT record matched by more than one "None" record is left alone.
--
-- psql -v batch=<name> -v channel=<channel id or 0 = all> -v day_from=<yyyy-mm-dd> -v day_to=<yyyy-mm-dd, exclusive> -f merge_none_pid.sql
\set ON_ERROR_STOP on
\timing on
BEGIN;

CREATE TABLE IF NOT EXISTS bak_none_merge (
    batch text NOT NULL,
    role text NOT NULL,          -- 'none' (kept, updated) or 'root' (deleted)
    partner_id uuid NOT NULL,    -- the other record of the pair
    merged_at timestamptz NOT NULL DEFAULT now(),
    LIKE pcb_results
);

CREATE TEMP TABLE pairs ON COMMIT DROP AS
SELECT n.id AS none_id, r.id AS root_id
FROM pcb_results n
CROSS JOIN LATERAL (
    SELECT r.id FROM pcb_results r
    WHERE r.channel_id = n.channel_id
      AND r.inspect_time BETWEEN n.inspect_time - interval '10 minutes' AND n.inspect_time + interval '10 minutes'
      AND r.pid <> 'None' AND r.job_file = n.job_file
      AND r.end_time >= n.start_time AND r.end_time - n.start_time <= interval '15 seconds'
      AND r.file_path ~ '--1?\.xml$'
      AND NOT EXISTS (SELECT 1 FROM test_steps t WHERE t.pcb_result_id = r.id)
    ORDER BY r.end_time LIMIT 1) r
WHERE n.pid = 'None'
  AND (:channel = 0 OR n.channel_id = :channel)
  AND n.inspect_time >= :'day_from'::date AND n.inspect_time < :'day_to'::date;

DELETE FROM pairs WHERE root_id IN (SELECT root_id FROM pairs GROUP BY root_id HAVING count(*) > 1);
CREATE UNIQUE INDEX ON pairs (none_id);
CREATE UNIQUE INDEX ON pairs (root_id);

INSERT INTO bak_none_merge SELECT :'batch', 'none', p.root_id, now(), n.* FROM pairs p JOIN pcb_results n ON n.id = p.none_id;
INSERT INTO bak_none_merge SELECT :'batch', 'root', p.none_id, now(), r.* FROM pairs p JOIN pcb_results r ON r.id = p.root_id;

-- The ROOT record goes first: (pid, start_time) is unique.
DELETE FROM pcb_results r USING pairs p WHERE r.id = p.root_id;

UPDATE pcb_results n SET
    pid          = b.pid,
    result       = b.result,
    error_code   = CASE
                     WHEN b.result = 'OK' THEN n.error_code
                     WHEN COALESCE(n.error_code, '') NOT IN ('', 'DEFECT_UNSPECIFIED') THEN n.error_code
                     ELSE COALESCE(NULLIF(b.error_code, ''), n.error_code)
                   END,
    inspect_time = b.inspect_time,
    start_time   = b.start_time,
    end_time     = b.end_time,
    test_time    = b.test_time,
    file_path    = b.file_path,
    fid          = COALESCE(NULLIF(n.fid, ''), b.fid),
    pcba_partno  = COALESCE(NULLIF(n.pcba_partno, ''), b.pcba_partno),
    buyer_id     = COALESCE(n.buyer_id, b.buyer_id)
FROM pairs p
JOIN bak_none_merge b ON b.id = p.root_id AND b.role = 'root' AND b.batch = :'batch'
WHERE n.id = p.none_id;

SELECT :'batch' AS batch, count(*) AS merged FROM pairs;
COMMIT;
