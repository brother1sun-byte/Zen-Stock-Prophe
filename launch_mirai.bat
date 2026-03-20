@echo off
title Minato Mirai Pro Launcher
echo Starting Minato Mirai Neural Core...

:: Start Backend
start "MinatoMirai_Backend" /b python backend/main.py > backend.log 2>&1

:: Start Frontend
echo Initializing Professional UI...
start "MinatoMirai_Frontend" /b npx next dev -p 3000 > frontend.log 2>&1

:: Wait for services to initialize
timeout /t 5 /nobreak > nul

:: Open Browser
echo Launching Interface...
start http://localhost:3000

echo.
echo ==========================================
echo Minato Mirai is now running in the background.
echo You can close this window.
echo ==========================================
timeout /t 5 > nul
exit
