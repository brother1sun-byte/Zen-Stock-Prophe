# scripts/collect_logs.ps1
# Log Archive Protocol

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$sourceDir = "backend/logs"
$destDir = "backups/logs_$timestamp"

Write-Host "--- LOG COLLECTION START ---" -ForegroundColor Cyan

if (Test-Path $sourceDir) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Copy-Item -Path "$sourceDir\*" -Destination $destDir -Force
    Write-Host "Logs backed up to: $destDir" -ForegroundColor Green
}
else {
    Write-Host "No logs found in $sourceDir" -ForegroundColor Yellow
}

Write-Host "--- LOG COLLECTION COMPLETE ---" -ForegroundColor Cyan
