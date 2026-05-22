@echo off
title AI Investment Simulator Server
echo ==============================================
echo Zen Stock Prophet Pro (AI Investment Simulator)
echo Starting servers...
echo ==============================================

cd /d "c:\Users\BRB33\investment-simulator-pro"

start "Backend Server Pro" cmd /k "set ZEN_API_HOST=127.0.0.1&& set ZEN_API_PORT=8889&& python backend/server.py"
start "Frontend Server Pro" cmd /k "npm run dev"

timeout /t 3 >nul
start http://localhost:5174

echo Started successfully!
timeout /t 2 >nul
exit
