-- One-time backfill for Job File -> Model master data.
--
-- This script only inserts Job Files that are not already in the mapping table.
-- Existing Model mappings are never overwritten. It is safe to rerun if needed,
-- although normal PCB ingestion automatically registers all new Job Files.

BEGIN;

WITH distinct_job_files AS (
    SELECT DISTINCT TRIM(job_file) AS job_file
    FROM pcb_results
    WHERE job_file IS NOT NULL
      AND TRIM(job_file) <> ''
),
inserted AS (
    INSERT INTO job_file_model_mappings (
        job_file,
        model_id,
        created_at,
        updated_at
    )
    SELECT
        job_file,
        NULL,
        NOW(),
        NOW()
    FROM distinct_job_files
    ON CONFLICT (job_file) DO NOTHING
    RETURNING id
)
SELECT COUNT(*) AS inserted_job_file_count
FROM inserted;

COMMIT;
