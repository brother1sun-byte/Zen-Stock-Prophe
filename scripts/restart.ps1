# scripts/restart.ps1
# Advanced Safe Restart Protocol (v2.0)
# This script ensures no confirmation prompts and redirects service output to logs.

$ErrorActionPreference = "SilentlyContinue"
$LogDir = "logs"
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

Write-Host "--- ADVANCED RESTART PROTOCOL START ---" -ForegroundColor Cyan

function Stop-PortProcess($port) {
    Write-Host "Clearing Port: $port" -ForegroundColor Gray
    $nets = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($nets) {
        foreach ($net in $nets) {
            $foundPid = $net.OwningProcess
            if ($foundPid -gt 0) {
                Write-Host "Killing PID: $foundPid (Port $port)" -ForegroundColor Yellow
                Stop-Process -Id $foundPid -Force -Confirm:$false
            }
        }
    }
}

# 1. Kill existing services
Stop-PortProcess 3000
Stop-PortProcess 8000

# Give ports time to release
Start-Sleep -Seconds 2

# 2. Start Services in Background with Redirection
Write-Host "Launching Backend (FastAPI) -> logs/backend.log" -ForegroundColor Cyan
Start-Process "powershell" -ArgumentList "-NoProfile", "-ExecutionPolicy Bypass", "-Command", "cd backend; python main.py > ..\logs\backend.log 2>&1" -WindowStyle Minimized

Write-Host "Launching Frontend (Next.js) -> logs/frontend.log" -ForegroundColor Cyan
Start-Process "powershell" -ArgumentList "-NoProfile", "-ExecutionPolicy Bypass", "-Command", "npm run dev > logs\frontend.log 2>&1" -WindowStyle Minimized

Write-Host "Waiting for initialization (10s)..." -ForegroundColor Gray
Start-Sleep -Seconds 10

Write-Host "--- ADVANCED RESTART PROTOCOL COMPLETE ---" -ForegroundColor Cyan
