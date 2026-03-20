@echo off
echo [TENKAI] Force Launch Sequence Initiated...

:: 1. Cleanup
echo [1/4] Cleaning up previous processes...
taskkill /F /IM python.exe /T >nul 2>&1
taskkill /F /IM node.exe /T >nul 2>&1

:: 2. Start Backend
echo [2/4] Starting AI Backend (Port 8000)...
start "Tenkai Backend" /min cmd /k "cd backend && python -m uvicorn main:app --port 8000"

:: 3. Start Frontend
echo [3/4] Starting Frontend Dashboard (Port 3000)...
echo Please wait 10 seconds for the server to build...
start "Tenkai Frontend" /min cmd /k "npm start"

:: 4. Wait and Launch
timeout /t 15 /nobreak
echo [4/4] OPENING BROWSER NOW...
start http://localhost:3000
echo Done.
pause
