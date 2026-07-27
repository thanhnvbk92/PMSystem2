@echo off
title PMSystem2 Backend - Hot Reload
echo ===================================================
echo   Starting PMSystem2 .NET Backend (Hot Reload Mode)
echo ===================================================
echo [1/2] Terminating old PMSystem2.Api process if running...
taskkill /f /im PMSystem2.Api.exe 2>nul
timeout /t 1 /nobreak >nul

echo [2/2] Starting dotnet watch run...
cd /d "%~dp0backend"
dotnet watch run
pause
