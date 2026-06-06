@echo off
set "APP_DIR=%~dp0"
set "PYTHONW="
for %%P in (pythonw.exe) do set "PYTHONW=%%~$PATH:P"
if not defined PYTHONW set "PYTHONW=pythonw.exe"
start "" /b "%PYTHONW%" "%APP_DIR%launcher.py"
exit /b 0
