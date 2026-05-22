@echo off
title ZEN STOCK PROPHET PRO - SYSTEM LAUNCHER
echo ==================================================
echo         ZEN STOCK PROPHET PRO : SYSTEM ONLINE
echo ==================================================
echo.
echo [1/3] Backend starting...
start /min cmd /c "cd /d %~dp0 && set ZEN_API_HOST=127.0.0.1&& set ZEN_API_PORT=8889&& python backend/server.py"
echo [2/3] Waiting for backend to stabilize...
timeout /t 5 /nobreak > nul
echo [3/3] Frontend starting...
start /min cmd /c "cd /d %~dp0 && npm run dev"
echo.
echo Launching Dashboard...
timeout /t 3 /nobreak > nul
start http://localhost:5174/
echo.
echo ==================================================
echo   SYSTEM IS RUNNING. DO NOT CLOSE THESE WINDOWS.
echo ==================================================
pause
