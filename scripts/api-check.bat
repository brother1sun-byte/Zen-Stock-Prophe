@echo off
REM API疎通確認スクリプト

echo ========================================
echo API疎通確認 (localhost:8000/predict)
echo ========================================
echo.

REM バックエンド疎通確認
echo [1/2] バックエンド接続テスト...
curl -s -o nul -w "%%{http_code}" http://localhost:8000/docs > %TEMP%\api_status.txt 2>&1
set /p STATUS=<%TEMP%\api_status.txt

if "%STATUS%"=="200" (
    echo    OK - バックエンドは稼働中
) else (
    echo    NG - バックエンドに接続できません
    echo.
    echo    確認場所:
    echo      1. Backend-8000 ウィンドウのログ
    echo      2. python -m uvicorn main:app --reload で手動起動
    echo.
    goto :end
)

REM Predict API テスト
echo [2/2] Predict API テスト...
curl -s -X POST http://localhost:8000/predict -H "Content-Type: application/json" -d "{\"ticker\": \"7203\", \"period\": \"1d\", \"capital\": 500000}" > %TEMP%\api_response.json 2>&1

if %ERRORLEVEL% EQU 0 (
    echo    OK - API応答あり
    echo.
    echo    レスポンス (先頭200文字):
    type %TEMP%\api_response.json | head -c 200
    echo ...
) else (
    echo    NG - APIリクエスト失敗
    echo.
    echo    確認場所:
    echo      1. Backend-8000 ウィンドウのエラーログ
    echo      2. backend\main.py の predict エンドポイント
)

:end
echo.
echo ========================================
pause
