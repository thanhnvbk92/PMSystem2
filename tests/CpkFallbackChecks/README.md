Run from the repository root:

```powershell
dotnet run --project tests/CpkFallbackChecks/CpkFallbackChecks.csproj
```

Uses the database configured in `backend/appsettings.Local.json` and an existing
Channel for foreign keys. Each case uses a unique Job File and rolls back all
fixtures and cache writes in its own transaction. No test data is committed.

Checks the 49/50-sample boundary, older measurement selection, Job/Step/result
filters, history and monthly-cache fallbacks, overview/detail agreement,
historical chart points, and recovery from an incomplete current cache.

Workbook checks also cover the dashboard, its KPI counts and native charts,
conditional colors and frozen columns, all three data worksheets, Channels with
N/A, Stations without Channels, raw identifiers, numeric precision, and text types.
The `CPK_Overview` sheet groups stations by line and places their machines
horizontally, with natural machine ordering, color-coded CPK tiles, and links
to the detailed channel records. Empty stations and N/A channels remain visible.
The report language is English. Long-text fixtures check that all data sheets
expand their row heights, and the primary CPK/value columns precede metadata.
To validate and export a report from the configured local database:

```powershell
dotnet run --project tests/CpkFallbackChecks/CpkFallbackChecks.csproj -- --export-report
```

This writes `backend/bin/CpkReportQa/CPK_Report_All.xlsx` using a read-only
snapshot of the current CPK results and their saved raw data.

`tests/validate_cpk_workbook.py <workbook.xlsx>` independently checks the workbook
with openpyxl and Pillow, using actual Windows Calibri font metrics to detect
clipped text in normal and merged cells. It also checks English headers, chart
totals, raw source consistency, and frozen column positions.
Pass `--matrix-only` to limit font measurements to the dashboard and station
matrix while still validating all report values and links.
