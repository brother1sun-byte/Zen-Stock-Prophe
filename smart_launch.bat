@echo off
echo [TENKAI] Initializing System...

:: Kill existing
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1

:: Start Backend
echo [1/3] Starting AI Neural Backend...
start /min cmd /k "cd backend && python -m uvicorn main:app --port 8000"

:: Wait for Backend
:WAIT_BACKEND
timeout /t 3 /nobreak >nul
netstat -an | find "8000" >nul
if errorlevel 1 goto WAIT_BACKEND
echo [OK] Backend Online.

:: Start Frontend
echo [2/3] Starting Dashboard Interface...
start /min cmd /k "npm start"

:: Wait for Frontend
:WAIT_FRONTEND
timeout /t 5 /nobreak >nul
netstat -an | find "3000" >nul
if errorlevel 1 goto WAIT_FRONTEND
echo [OK] Frontend Online.

:: Launch Browser
echo [3/3] Launching Infinite Foresight...
start http://localhost:3000
echo [SUCCESS] System Fully Operational.
pause
