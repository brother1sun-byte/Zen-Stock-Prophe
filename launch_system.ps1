
Write-Host "Cleaning up old processes..." -ForegroundColor Yellow
Stop-Process -Name "node", "python", "npx" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Starting Backend (Port 8000) on 127.0.0.1..." -ForegroundColor Cyan
Start-Process python -ArgumentList "-m uvicorn main:app --host 127.0.0.1 --port 8000" -WindowStyle Hidden -WorkingDirectory "C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\backend"

Write-Host "Starting Frontend (Port 3000)..." -ForegroundColor Cyan
Start-Process cmd.exe -ArgumentList "/c npx.cmd next dev -p 3000" -WindowStyle Hidden -WorkingDirectory "C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet"

function Wait-ForPort {
    param($port, $name)
    Write-Host "Waiting for $name (Port $port) to be ready..." -NoNewline
    $retries = 0
    while ($retries -lt 30) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect("127.0.0.1", $port)
            $tcp.Close()
            Write-Host " [OK]" -ForegroundColor Green
            return $true
        }
        catch {
            Start-Sleep -Seconds 2
            Write-Host "." -NoNewline
            $retries++
        }
    }
    Write-Host " [FAILED]" -ForegroundColor Red
    return $false
}

$backendReady = Wait-ForPort -port 8000 -name "Backend"
$frontendReady = Wait-ForPort -port 3000 -name "Frontend"

if ($backendReady -and $frontendReady) {
    Write-Host "All systems GO. Launching Browser..." -ForegroundColor Green
    Start-Process "http://127.0.0.1:3000"
}
else {
    Write-Host "Startup Failed. Please check logs." -ForegroundColor Red
}
