@echo off
echo [LINT] Running Type & Lint Check...
cd /d %~dp0..

echo.
echo === Frontend Type Check (tsc) ===
call npx tsc --noEmit
if %errorlevel% neq 0 (
    echo [ERROR] TypeScript errors found!
) else (
    echo [OK] No type errors.
)

echo.
echo === Frontend Lint (eslint) ===
call npm run lint
if %errorlevel% neq 0 (
    echo [ERROR] Lint errors found!
) else (
    echo [OK] Lint passed.
)

echo.
echo [INFO] Check completed.
pause
