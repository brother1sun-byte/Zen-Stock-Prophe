@echo off
REM テスト一括実行スクリプト

echo ========================================
echo テスト一括実行
echo ========================================
echo.

cd /d %~dp0..

echo [1/3] TypeScript 型チェック...
call npx tsc --noEmit
if %ERRORLEVEL% EQU 0 (
    echo    OK
) else (
    echo    NG - 型エラーあり
)

echo.
echo [2/3] ESLint チェック...
call npx eslint app --ext .ts,.tsx --max-warnings 0
if %ERRORLEVEL% EQU 0 (
    echo    OK
) else (
    echo    NG - Lintエラーあり
)

echo.
echo [3/3] API疎通確認...
call %~dp0api-check.bat

echo.
echo ========================================
echo テスト完了
echo ========================================
pause
