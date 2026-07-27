Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Starting PMSystem2 .NET Backend (Hot Reload Mode)" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan

# 1. Kill any existing PMSystem2.Api processes to release file locks on PMSystem2.Api.exe
$ProcessName = "PMSystem2.Api"
$runningProcesses = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
if ($runningProcesses) {
    Write-Host "Tự động tắt $($runningProcesses.Count) tiến trình $ProcessName cũ để giải phóng file lock..." -ForegroundColor Yellow
    foreach ($proc in $runningProcesses) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

# 2. Release port 5000 if occupied
$portConnections = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($portConnections) {
    foreach ($conn in $portConnections) {
        if ($conn.OwningProcess -gt 0) {
            Write-Host "Tắt tiến trình chiếm dụng Cổng 5000 (PID $($conn.OwningProcess))..." -ForegroundColor Yellow
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
}

# 3. Navigate to backend and run hot reload
$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
Set-Location -Path "$scriptDir\backend"

Write-Host "Khởi chạy dotnet watch run..." -ForegroundColor Green
dotnet watch run

