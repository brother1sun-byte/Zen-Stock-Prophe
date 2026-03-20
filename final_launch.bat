@echo off
setlocal
echo ===================================================
echo [PROJECT TENKAI] ULTIMATE STABLE LAUNCHER
echo ===================================================

echo [1/4] Cleaning up old sessions...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] Starting AI Backend (Port 8000)...
start "TENKAI_BACKEND" /min cmd /c "cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

echo [3/4] Starting Dashboard (Port 3000)...
start "TENKAI_FRONTEND" /min cmd /c "npx.cmd next dev -p 3000"

echo [4/4] Waiting for Neural Synchronization...
:CHECK
timeout /t 3 /nobreak >nul
netstat -ano | findstr :3000 | findstr LISTENING >nul
if errorlevel 1 (
    echo . 
    goto CHECK
)

echo [SUCCESS] System is SYNCHRONIZED.
echo Opening: http://127.0.0.1:3000
start http://127.0.0.1:3000

echo.
echo ---------------------------------------------------
echo 重要: このウィンドウを閉じるとシステムが終了します。
echo 分析中は開いたままにしてください。
echo ---------------------------------------------------
pause
