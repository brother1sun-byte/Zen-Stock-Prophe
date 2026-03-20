@echo off
setlocal
title MinatoMirai Pro - Stable Launcher

echo === Japan Stock Prophet: Launching... ===

call npm run up

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo !!! STARTUP FAILED !!!
    echo Please run "npm run diagnosis" for analysis.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Launching Browser...
start "" "http://localhost:3000"

echo.
echo === All systems are GO ===
echo Keep this window open while using the application.
echo.
pause
