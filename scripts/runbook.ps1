# scripts/runbook.ps1
# Antigravity One-Touch Operational Runbook
# Run this for standard maintenance/restart/check cycles.

Write-Host "############################################" -ForegroundColor Cyan
Write-Host "# ANTIGRAVITY OPERATIONAL RUNBOOK STARTING #" -ForegroundColor Cyan
Write-Host "############################################" -ForegroundColor Cyan

# 1. Archive previous state
powershell -ExecutionPolicy Bypass -File .\scripts\collect_logs.ps1

# 2. Restart services
powershell -ExecutionPolicy Bypass -File .\scripts\restart.ps1

# 3. Wait for boot
Write-Host "Waiting for services to stabilize (10s)..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 4. Final Diagnostics
powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1

if ($LASTEXITCODE -eq 0) {
    Write-Host "############################################" -ForegroundColor Green
    Write-Host "#  RUNBOOK COMPLETE: SYSTEM IS OPERATIONAL #" -ForegroundColor Green
    Write-Host "############################################" -ForegroundColor Green
}
else {
    Write-Host "############################################" -ForegroundColor Red
    Write-Host "#  RUNBOOK FAILED: MANUAL CHECK REQUIRED   #" -ForegroundColor Red
    Write-Host "############################################" -ForegroundColor Red
    exit 1
}
