@echo off
setlocal
cd /d "%~dp0"

:: Set environment to prevent Next.js from opening a browser automatically (just in case)
set BROWSER=none

:: Check if the app is already running on port 3000
netstat -ano | findstr :3000 > nul
if %errorlevel% equ 0 (
    :: Already running, just refresh/open browser
    start http://localhost:3000
    exit /b
)

:: Clean start: Ensure no hanging backend or frontend processes from previous failed runs
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Tenkai*" /T > nul 2>&1
taskkill /F /IM python.exe /FI "WINDOWTITLE eq Tenkai*" /T > nul 2>&1

:: Start Backend quietly
start "Tenkai_Backend" /b python backend/main.py > backend.log 2>&1

:: Start Frontend quietly
start "Tenkai_Frontend" /b npm run dev -- -p 3000 > nul 2>&1

:: Wait for services to be ready
timeout /t 6 /nobreak > nul

:: Open the browser JUST ONCE
start http://localhost:3000

:: Keep the script running to maintain the background processes
:keepalive
timeout /t 3600 /nobreak > nul
goto keepalive
