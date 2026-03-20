@echo off
REM みなとみらい株式AI - 開発サーバー起動スクリプト
REM フロントエンド(3000)とバックエンド(8000)を同時起動

echo ========================================
echo みなとみらい株式AI - Dev Server
echo ========================================
echo.

REM 既存プロセスをクリーンアップ
echo [1/3] ポート 3000, 8000 を解放中...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
echo    完了

REM バックエンド起動
echo [2/3] バックエンド起動中 (localhost:8000)...
cd /d %~dp0..\backend
start "Backend-8000" cmd /c "python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"

REM フロントエンド起動
echo [3/3] フロントエンド起動中 (localhost:3000)...
cd /d %~dp0..
start "Frontend-3000" cmd /c "npm run dev"

echo.
echo ========================================
echo 起動完了！
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
echo ========================================
echo.
echo ログ確認: scripts\logs.bat を実行
echo API確認:  scripts\api-check.bat を実行
echo.
pause
