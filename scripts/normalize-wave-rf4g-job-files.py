"""Normalize machine-prefixed Job File values in pcb_results.

Dry-run is the default. Use --apply only after reviewing the preview.
The script uses the PostgreSQL connection from backend/appsettings.json and
invokes the installed psql client, so no additional Python package is needed.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "backend" / "appsettings.json"

# Remove an HS.../DESKTOP... machine prefix through YYYY_MM_DD-, then remove
# a trailing Windows/Unix path. The broad HS match also covers historical
# spelling variants such as HS-WVAE and HSBMWWAVERF5G13.
NORMALIZED_SQL = r"""
split_part(
    split_part(
        regexp_replace(
            job_file,
            '^.*(HS.*|DESKTOP-.*)-[0-9]{4}_[0-9]{2}_[0-9]{2}-',
            '',
            'i'
        ),
        E'\\',
        1
    ),
    '/',
    1
)
""".strip()

MATCH_SQL = (
    "job_file ~* "
    "'^.*(HS.*|DESKTOP-.*)-[0-9]{4}_[0-9]{2}_[0-9]{2}-'"
)


def parse_connection_string(value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for segment in value.split(";"):
        if "=" in segment:
            key, item = segment.split("=", 1)
            result[key.strip().lower()] = item.strip()
    return result


def database_settings() -> tuple[list[str], dict[str, str]]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
    connection = config.get("ConnectionStrings", {}).get("DefaultConnection", "")
    parts = parse_connection_string(connection)
    password = parts.get("password", "")
    if not password or password == "CHANGE_ME":
        raise RuntimeError(f"Database password is not configured in {CONFIG_PATH}")

    psql = shutil.which("psql")
    if not psql:
        raise RuntimeError("psql was not found in PATH")

    args = [
        psql,
        "-X",
        "-v", "ON_ERROR_STOP=1",
        "-h", parts.get("host", "localhost"),
        "-p", parts.get("port", "5432"),
        "-U", parts.get("username", parts.get("user id", "postgres")),
        "-d", parts.get("database", "pmsystem2"),
    ]
    environment = os.environ.copy()
    environment["PGPASSWORD"] = password
    return args, environment


def run_sql(sql: str) -> None:
    args, environment = database_settings()
    completed = subprocess.run(
        args,
        input=sql,
        text=True,
        encoding="utf-8",
        env=environment,
        cwd=ROOT,
        check=False,
    )
    if completed.returncode:
        raise RuntimeError(f"psql exited with code {completed.returncode}")


def preview_sql(limit: int) -> str:
    return f"""
SELECT COUNT(*) AS affected_pcb_results,
       COUNT(DISTINCT job_file) AS distinct_original_values
FROM pcb_results
WHERE {MATCH_SQL}
  AND job_file IS DISTINCT FROM ({NORMALIZED_SQL});

SELECT job_file AS old_job_file,
       {NORMALIZED_SQL} AS normalized_job_file,
       COUNT(*) AS pcb_count
FROM pcb_results
WHERE {MATCH_SQL}
  AND job_file IS DISTINCT FROM ({NORMALIZED_SQL})
GROUP BY job_file
ORDER BY COUNT(*) DESC
LIMIT {limit};
"""


def apply_sql() -> str:
    return f"""
BEGIN;

CREATE TEMP TABLE wave_rf4g_job_file_changes ON COMMIT DROP AS
SELECT DISTINCT job_file AS old_job_file,
       {NORMALIZED_SQL} AS new_job_file
FROM pcb_results
WHERE {MATCH_SQL}
  AND job_file IS DISTINCT FROM ({NORMALIZED_SQL})
  AND ({NORMALIZED_SQL}) <> '';

UPDATE pcb_results AS p
SET job_file = c.new_job_file
FROM wave_rf4g_job_file_changes AS c
WHERE p.job_file = c.old_job_file;

-- Register normalized names in Master Data without overwriting any mapping.
INSERT INTO job_file_model_mappings (job_file, model_id, created_at, updated_at)
SELECT DISTINCT new_job_file, NULL::integer, NOW(), NOW()
FROM wave_rf4g_job_file_changes
ON CONFLICT (job_file) DO NOTHING;

-- Remove only obsolete, unmapped aliases created by the earlier backfill.
DELETE FROM job_file_model_mappings AS m
USING wave_rf4g_job_file_changes AS c
WHERE m.job_file = c.old_job_file
  AND m.model_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM pcb_results AS p WHERE p.job_file = m.job_file);

SELECT COUNT(*) AS remaining_unnormalized_rows
FROM pcb_results
WHERE {MATCH_SQL}
  AND job_file IS DISTINCT FROM ({NORMALIZED_SQL});

COMMIT;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Commit the normalization to PostgreSQL")
    parser.add_argument("--limit", type=int, default=30, help="Number of distinct preview examples")
    args = parser.parse_args()

    try:
        if args.apply:
            print("Applying Job File normalization in one transaction...")
            run_sql(apply_sql())
        else:
            print("DRY RUN: database will not be changed. Previewing normalization...")
            run_sql(preview_sql(max(1, min(args.limit, 200))))
            print("Run again with --apply to commit these changes.")
        return 0
    except (OSError, RuntimeError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
