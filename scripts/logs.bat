@echo off
REM ログ確認スクリプト

echo ========================================
echo ログ確認
echo ========================================
echo.
echo 開いているサーバーウィンドウ:
echo   - Frontend-3000: フロントエンドログ
echo   - Backend-8000:  バックエンドログ
echo.
echo 直近のAPIログを確認するには:
echo   type backend\logs\api_requests.log
echo.
echo ========================================

REM ログディレクトリ作成
if not exist "%~dp0..\backend\logs" mkdir "%~dp0..\backend\logs"

REM 直近ログ表示
if exist "%~dp0..\backend\logs\api_requests.log" (
    echo.
    echo === 直近APIリクエストログ (最新10件) ===
    powershell -Command "Get-Content '%~dp0..\backend\logs\api_requests.log' -Tail 10"
) else (
    echo APIログはまだありません
)

echo.
pause
