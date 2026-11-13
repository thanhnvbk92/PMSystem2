@echo off
title PMSystem2 Backend
echo =======================================================
echo   Khoi dong PMSystem2 Backend (.NET - Port 5000)
echo =======================================================
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File .\run-backend.ps1
pause
