@echo off
echo [DEV] Starting Backend (Port 8000) and Frontend (Port 3000)...
cd /d %~dp0..

echo Starting Backend...
start "Backend API" cmd /k "cd backend && python -m uvicorn main:app --reload --port 8000"

echo Waiting for Backend to initialize...
timeout /t 5 >nul

echo Starting Frontend...
start "Frontend App" cmd /k "npm run dev"

echo [DEV] Startup sequence initiated.
echo [INFO] API Logs: backend/logs/api_requests.log
echo [INFO] App URL: http://localhost:3000
echo [HELP] If frontend fails, check if port 3000 is free.
pause
