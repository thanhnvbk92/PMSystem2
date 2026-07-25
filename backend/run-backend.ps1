# Powershell Script to stop any existing PMSystem2.Api process and run the backend cleanly

$ProcessName = "PMSystem2.Api"
$ProjectFile = "$PSScriptRoot\PMSystem2.Api.csproj"

if (-not (Test-Path $ProjectFile)) {
    $ProjectFile = "$PSScriptRoot\backend\PMSystem2.Api.csproj"
}

Write-Host "[1/3] Checking for running instances of $ProcessName..." -ForegroundColor Cyan

$runningProcesses = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
if ($runningProcesses) {
    Write-Host "Found $($runningProcesses.Count) running process(es). Terminating to free file lock..." -ForegroundColor Yellow
    foreach ($proc in $runningProcesses) {
        Stop-Process -Id $proc.Id -Force
        Write-Host "Killed process ID $($proc.Id)" -ForegroundColor Gray
    }
    Start-Sleep -Seconds 1
} else {
    Write-Host "No existing $ProcessName process running." -ForegroundColor Green
}

# Optional: Check if port 5000 is still locked by anything else
$portConnections = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($portConnections) {
    foreach ($conn in $portConnections) {
        if ($conn.OwningProcess -gt 0) {
            Write-Host "Warning: Port 5000 is being used by PID $($conn.OwningProcess). Terminating..." -ForegroundColor Yellow
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "[2/3] Building backend project..." -ForegroundColor Cyan
dotnet build $ProjectFile --nologo

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Please fix compilation errors." -ForegroundColor Red
    exit 1
}

Write-Host "[3/3] Starting PMSystem2.Api backend (Listening on http://0.0.0.0:5000)..." -ForegroundColor Green
dotnet run --project $ProjectFile
