@echo off
title PMSystem2 Backend - Hot Reload
echo ===================================================
echo   Starting PMSystem2 .NET Backend (Hot Reload Mode)
echo ===================================================
cd /d "%~dp0backend"
dotnet watch run
pause
