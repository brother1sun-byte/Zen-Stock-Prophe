@echo off
setlocal
cd /d "%~dp0.."
python "%~dp0validate_all.py" %*
exit /b %ERRORLEVEL%
