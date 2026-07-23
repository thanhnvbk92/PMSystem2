# Script chạy chuyển đổi dữ liệu từ ClickHouse sang PostgreSQL cho PMSystem2
param (
    [string]$ChHost = "192.168.100.10",
    [int]$ChPort = 9000,
    [string]$PgHost = "127.0.0.1",
    [int]$PgPort = 5432,
    [string]$PgUser = "postgres",
    [string]$PgPass = "Anduongb67",
    [string]$PgDb = "pmsystem2"
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "🚀 Chạy script chuyển đổi dữ liệu ClickHouse -> PostgreSQL" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan

python "$PSScriptRoot\migrate_clickhouse_to_postgres.py" `
    --ch-host $ChHost `
    --ch-port $ChPort `
    --pg-host $PgHost `
    --pg-port $PgPort `
    --pg-user $PgUser `
    --pg-pass $PgPass `
    --pg-db $PgDb
