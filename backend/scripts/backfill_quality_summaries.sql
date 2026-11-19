CREATE TABLE IF NOT EXISTS pcb_ntf_summaries (
    pid TEXT NOT NULL,
    station_id INT NOT NULL,
    first_test_time TIMESTAMPTZ NOT NULL,
    last_test_time TIMESTAMPTZ NOT NULL,
    test_count BIGINT NOT NULL,
    ng_count BIGINT NOT NULL,
    ever_ng BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pid, station_id)
);
CREATE INDEX IF NOT EXISTS ix_pcb_ntf_summaries_station_ever_ng
    ON pcb_ntf_summaries (station_id, ever_ng);

CREATE TABLE IF NOT EXISTS pcb_rty_summaries (
    pid TEXT PRIMARY KEY,
    first_test_time TIMESTAMPTZ NOT NULL,
    last_test_time TIMESTAMPTZ NOT NULL,
    station_count INT NOT NULL,
    test_count BIGINT NOT NULL,
    ng_count BIGINT NOT NULL,
    ever_ng BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_pcb_rty_summaries_ever_ng
    ON pcb_rty_summaries (ever_ng);

ALTER TABLE pcb_ntf_summaries ALTER COLUMN pid TYPE TEXT;
ALTER TABLE pcb_ntf_summaries ADD COLUMN IF NOT EXISTS job_file TEXT;
ALTER TABLE pcb_ntf_summaries ADD COLUMN IF NOT EXISTS model_id INT;
ALTER TABLE pcb_rty_summaries ALTER COLUMN pid TYPE TEXT;

BEGIN;

TRUNCATE TABLE pcb_ntf_summaries, pcb_rty_summaries;

WITH valid_results AS (
    SELECT p.*
    FROM pcb_results p
    LEFT JOIN job_file_model_mappings mapping ON mapping.job_file = p.job_file
    WHERE p.pid IS NOT NULL AND btrim(p.pid) <> ''
      AND p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED'
      AND isfinite(p.inspect_time)
      -- Effective model = Job File mapping, else pcb_results.model_id.
      AND COALESCE(mapping.model_id, p.model_id) IS DISTINCT FROM 0
)
INSERT INTO pcb_ntf_summaries
    (pid, station_id, first_test_time, last_test_time, test_count, ng_count, ever_ng, updated_at, job_file, model_id)
SELECT pid,
       station_id,
       MIN(inspect_time),
       MAX(inspect_time),
       COUNT(*),
       COUNT(*) FILTER (WHERE result IN ('NG', 'FAIL')),
       BOOL_OR(result IN ('NG', 'FAIL')),
       NOW(),
       (array_agg(job_file ORDER BY inspect_time DESC))[1],
       (array_agg(model_id ORDER BY inspect_time DESC))[1]
FROM valid_results
GROUP BY pid, station_id;

WITH valid_results AS (
    SELECT p.*
    FROM pcb_results p
    LEFT JOIN job_file_model_mappings mapping ON mapping.job_file = p.job_file
    WHERE p.pid IS NOT NULL AND btrim(p.pid) <> ''
      AND p.error_code IS DISTINCT FROM 'DEFECT_UNSPECIFIED'
      AND isfinite(p.inspect_time)
      -- Effective model = Job File mapping, else pcb_results.model_id.
      AND COALESCE(mapping.model_id, p.model_id) IS DISTINCT FROM 0
)
INSERT INTO pcb_rty_summaries
    (pid, first_test_time, last_test_time, station_count, test_count, ng_count, ever_ng, updated_at)
SELECT pid,
       MIN(inspect_time),
       MAX(inspect_time),
       COUNT(DISTINCT station_id),
       COUNT(*),
       COUNT(*) FILTER (WHERE result IN ('NG', 'FAIL')),
       BOOL_OR(result IN ('NG', 'FAIL')),
       NOW()
FROM valid_results
GROUP BY pid;

COMMIT;
