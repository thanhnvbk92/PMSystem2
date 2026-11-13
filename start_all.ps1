# Script PowerShell de khoi chay ca Frontend va Backend trong 2 cua so rieng biet

$RootDir = $PSScriptRoot

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   Khoi dong PMSystem2 (Backend & Frontend)" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# 1. Start Backend in a new window
Write-Host "[1/2] Dang khoi dong Backend (Port 5000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "$RootDir\run-backend.ps1"

# 2. Start Frontend in a new window
Write-Host "[2/2] Dang khoi dong Frontend (Port 3000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootDir\frontend'; npm run dev"

Write-Host "`nCa 2 dich vu dang duoc mo trong 2 cua so PowerShell rieng biet!" -ForegroundColor Green
Write-Host "Backend:  http://localhost:5000" -ForegroundColor Gray
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Gray
