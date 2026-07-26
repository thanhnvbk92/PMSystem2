Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Starting PMSystem2 .NET Backend (Hot Reload Mode)" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
Set-Location -Path "$scriptDir\backend"
dotnet watch run
