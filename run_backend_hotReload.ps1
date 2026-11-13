$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$backendRoot = Join-Path $projectRoot 'backend'
$apiPathPrefix = (Join-Path $backendRoot 'bin') + [IO.Path]::DirectorySeparatorChar
$projectFile = Join-Path $backendRoot 'PMSystem2.Api.csproj'

Write-Host '===================================================' -ForegroundColor Cyan
Write-Host '  Starting PMSystem2 .NET Backend (Hot Reload Mode)' -ForegroundColor Green
Write-Host '===================================================' -ForegroundColor Cyan

# Stop only the existing PMSystem2 host and its dotnet-watch parents. Killing
# the executable alone lets the old watcher immediately relaunch it and keep
# port 5000 occupied.
$allProcesses = @(Get-CimInstance Win32_Process)
$processById = @{}
foreach ($process in $allProcesses) { $processById[[int]$process.ProcessId] = $process }
$toStop = [System.Collections.Generic.HashSet[int]]::new()
foreach ($api in $allProcesses | Where-Object {
    $_.Name -eq 'PMSystem2.Api.exe' -and $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith($apiPathPrefix, [StringComparison]::OrdinalIgnoreCase)
}) {
    $id = [int]$api.ProcessId
    while ($processById.ContainsKey($id)) {
        $current = $processById[$id]
        if ($current.Name -eq 'dotnet.exe' -and $current.CommandLine -match 'dotnet-watch\.dll|watch\s+run') {
            [void]$toStop.Add($id)
        }
        if ($current.Name -eq 'PMSystem2.Api.exe' -or $current.Name -eq 'dotnet.exe') {
            [void]$toStop.Add($id)
        }
        if ($current.Name -eq 'dotnet.exe' -and $current.CommandLine -match 'watch\s+run') { break }
        $id = [int]$current.ParentProcessId
    }
}

# Also stop orphaned watchers for this project (watchers whose API child has
# already exited). Several concurrent watchers rebuild into the same bin folder
# and corrupt PMSystem2.Api.dll (BadImageFormatException). Watchers started by
# this script carry the csproj path on their command line, so match on it.
foreach ($watcher in $allProcesses | Where-Object {
    $_.Name -eq 'dotnet.exe' -and $_.CommandLine -and
    $_.CommandLine -match 'watch' -and
    $_.CommandLine.IndexOf($projectFile, [StringComparison]::OrdinalIgnoreCase) -ge 0
}) {
    [void]$toStop.Add([int]$watcher.ProcessId)
}

foreach ($id in @($toStop)) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}
if ($toStop.Count -gt 0) {
    Write-Host "Stopped $($toStop.Count) previous backend/watch process(es)." -ForegroundColor Yellow
    Start-Sleep -Seconds 1
}

$listener = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    $ownerName = if ($owner) { $owner.Name } else { "PID $($listener.OwningProcess)" }
    Write-Error "Port 5000 is still occupied by $ownerName. Stop that service before starting PMSystem2."
    exit 1
}

Set-Location -Path $backendRoot

# Larger scroll-back so earlier output can still be scrolled to in the window.
try {
    $rawUi = $Host.UI.RawUI
    $buffer = $rawUi.BufferSize
    if ($buffer.Height -lt 30000) {
        $buffer.Height = 30000
        $rawUi.BufferSize = $buffer
    }
} catch { }

# Also write everything to logs\backend_<time>.log (keep the newest 14 files)
# so the output can be read later in any editor, even after the window scrolls.
$logDir = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Get-ChildItem -Path $logDir -Filter 'backend_*.log' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 13 |
    Remove-Item -Force -ErrorAction SilentlyContinue
$logFile = Join-Path $logDir ("backend_{0}.log" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
Write-Host "Starting dotnet watch run... (log: $logFile)" -ForegroundColor Green

$writer = New-Object System.IO.StreamWriter($logFile, $true, (New-Object System.Text.UTF8Encoding($false)))
$writer.AutoFlush = $true
try {
    dotnet watch --project $projectFile run | ForEach-Object {
        $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $_
        $writer.WriteLine($line)
        $_
    }
}
finally {
    $writer.Dispose()
}
