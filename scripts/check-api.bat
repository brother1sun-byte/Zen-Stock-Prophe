@echo off
echo [TEST] Checking API Endpoint...
echo 1. Direct (8000): curl -X POST http://localhost:8000/predict ...
echo 2. Proxy (3000):  curl -X POST http://localhost:3000/api/predict ...

echo.
echo === Testing via Proxy (Recommended) ===
curl -v -X POST http://localhost:3000/api/predict -H "Content-Type: application/json" -d "{\"ticker\": \"7203\", \"period\": \"1d\", \"capital\": 500000}"

echo.
echo === Testing Direct ===
curl -v -X POST http://localhost:8000/predict -H "Content-Type: application/json" -d "{\"ticker\": \"7203\", \"period\": \"1d\", \"capital\": 500000}"

echo.
echo ---------------------------------------------------
echo [SUCCESS] If you see JSON from EITHER test, the API is reachable.
echo [FAILURE] If both fail, Backend is down or Port 8000 is blocked.
echo ---------------------------------------------------
pause
