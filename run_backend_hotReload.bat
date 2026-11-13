@echo off
title PMSystem2 Backend - Hot Reload
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_backend_hotReload.ps1"
pause
