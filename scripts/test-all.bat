@echo off
echo [TEST] Running All Tests...
cd /d %~dp0..

echo.
echo === Frontend Tests (app) ===
call npm test
if %errorlevel% neq 0 echo [WARN] Frontend tests failed!

echo.
echo === Backend Tests (backend) ===
cd ..\backend
echo No backend automated tests configured yet.
echo (To add tests, create test_main.py and run 'pytest')

echo.
echo [INFO] Test run completed.
pause
