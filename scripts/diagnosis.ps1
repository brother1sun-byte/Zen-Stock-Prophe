$logDir = "$PSScriptRoot/../logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir }
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$diagLog = "$logDir/diagnosis_$timestamp.log"

$msgFile = "$PSScriptRoot/diagnosis_messages.json"
$msgs = Get-Content $msgFile -Raw -Encoding UTF8 | ConvertFrom-Json

Start-Transcript -Path $diagLog

Write-Host "=== System Diagnosis Start ==="

$p3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1
$p8000 = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -First 1

$bkH = "FAILED"
try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 5 -ErrorAction Stop
    $bkH = $resp.status
}
catch { $bkH = "FAILED" }

$frH = "FAILED"
try {
    $web = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -Method Head -TimeoutSec 5 -ErrorAction Stop
    $frH = $web.StatusCode
}
catch { $frH = "FAILED" }

Write-Host "Port 3000: $(if($p3000){"LISTEN"}else{"FREE"})"
Write-Host "Port 8000: $(if($p8000){"LISTEN"}else{"FREE"})"
Write-Host "Backend Health: $bkH"
Write-Host "Frontend Status: $frH"

$res = "d"
if (-not $p8000) { $res = "a" }
elseif (-not $p3000) { $res = "b" }
elseif ($bkH -ne "ok" -or $frH -eq "FAILED") { $res = "c" }
elseif ($bkH -eq "ok" -and $frH -ne "FAILED") { $res = "success" }

Write-Host ""
if ($res -eq "a") { Write-Host $msgs.a -ForegroundColor Cyan }
if ($res -eq "b") { Write-Host $msgs.b -ForegroundColor Cyan }
if ($res -eq "c") { Write-Host $msgs.c -ForegroundColor Cyan }
if ($res -eq "d") { Write-Host $msgs.d -ForegroundColor Cyan }
if ($res -eq "success") { Write-Host $msgs.success -ForegroundColor Green }

if ($res -eq "success") {
    Write-Host $msgs.next_web -ForegroundColor Yellow
}
else {
    Write-Host $msgs.next_up -ForegroundColor Yellow
}

Write-Host "`n詳細ログ: $diagLog" -ForegroundColor Gray

Stop-Transcript
