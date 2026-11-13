@echo off
title PMSystem2 - Start All (Backend & Frontend)
echo =======================================================
echo   Khoi dong PMSystem2 (Backend & Frontend)
echo =======================================================

echo [1/2] Dang khoi dong Backend (Port 5000)...
start "PMSystem2 Backend (.NET)" cmd /k "cd /d "%~dp0" && powershell -ExecutionPolicy Bypass -File .\run-backend.ps1"

echo [2/2] Dang khoi dong Frontend (Port 3000)...
start "PMSystem2 Frontend (Vite React)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo =======================================================
echo   Ca Frontend va Backend dang duoc chay trong 2 cua so rieng.
echo   Backend:  http://localhost:5000
echo   Frontend: http://localhost:3000
echo =======================================================
