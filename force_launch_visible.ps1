
Write-Host "Project Tenkai: Emergency Foreground Launch" -ForegroundColor Yellow
Write-Host "Cleaning up stale processes..."
Stop-Process -Name "node", "python", "npx" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Start Backend in a new visible window
Write-Host "Launching Backend (8000)..."
Start-Process cmd.exe -ArgumentList "/c cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000" -WorkingDirectory "C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet"

# Start Frontend in a new visible window
Write-Host "Launching Frontend (3000)..."
Start-Process cmd.exe -ArgumentList "/c npx.cmd next dev -p 3000" -WorkingDirectory "C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet"

Write-Host "Waiting for services to initialize..."
Start-Sleep -Seconds 15

# Open browser directly via Start-Process
Write-Host "Opening Browser: http://127.0.0.1:3000"
Start-Process "http://127.0.0.1:3000"
