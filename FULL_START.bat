@echo off
setlocal
title Project Tenkai - Full System Launch

echo ===================================================
echo   Project Tenkai (Japan Stock Prophet) Launcher
echo ===================================================
echo.

:: 1. Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.10+ and check "Add Python to PATH".
    pause
    exit /b
)

:: 2. Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js (LTS).
    pause
    exit /b
)

echo [1/2] Starting AI Backend (FastAPI)...
:: Launch in a separate visible window so errors can be seen, but minimized
start "Tenkai Backend" /min cmd /k "cd backend && python -m uvicorn main:app --reload --port 8000"

echo    Waiting for Backend to initialize...
timeout /t 5 >nul

echo [2/2] Starting Frontend (Next.js)...
:: Launch in a separate visible window
start "Tenkai Frontend" /min cmd /k "npm run dev"

echo.
echo ===================================================
echo   System Launching...
echo   Please wait for the browser to open.
echo   If you see "Connection Refused", wait a moment
echo   and refresh the page.
echo ===================================================
echo.

:: Wait a bit more for Next.js to compile
timeout /t 8 >nul

:: Open Browser
start http://localhost:3000

echo Done. You can verify the backend at:
echo http://localhost:8000/docs
echo.
pause
