$logDir = "$PSScriptRoot/../logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir }
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = "$logDir/down_$timestamp.log"

function Write-Log($msg, $color = "White") {
    Write-Host "[$timestamp] $msg" -ForegroundColor $color
}

Start-Transcript -Path $logFile

try {
    Write-Log "=== Japan Stock Prophet: Application Shutdown (npm run down) ===" "Cyan"
    Write-Log "Stopping Port 3000..." "Gray"
    $nodePids = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
    if ($nodePids) { $nodePids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }

    Write-Log "Stopping Port 8000..." "Gray"
    $pyPids = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
    if ($pyPids) { $pyPids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }

    Write-Log "`n=== SHUTDOWN COMPLETE ===" "Green"
}
catch {
    Write-Log "`nWarning: Shutdown encountered an error: $($_.Exception.Message)" "Yellow"
}
finally {
    Stop-Transcript
    exit 0
}
