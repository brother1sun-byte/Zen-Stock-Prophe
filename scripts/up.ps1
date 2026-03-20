$ErrorActionPreference = "Stop"
$logDir = "$PSScriptRoot/../logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir }
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = "$logDir/up_$timestamp.log"

function Write-Log($msg, $color = "White") {
    Write-Host "[$timestamp] $msg" -ForegroundColor $color
}

Start-Transcript -Path $logFile

$cleanupCalled = $false
function Global-Cleanup {
    if ($script:cleanupCalled) { return }
    $script:cleanupCalled = $true
    Write-Log "`n[CLEANUP] Ensuring all processes are stopped..." "Yellow"
    npm run down | Out-Null
}

$currentStep = "INITIALIZE"
try {
    Write-Log "=== Japan Stock Prophet: Automated Startup (npm run up) ===" "Cyan"

    # 1. Clean state
    $currentStep = "CLEANUP"
    Write-Log "0. Cleaning up previous state..." "Gray"
    try {
        npm run down | Out-Null
    }
    catch {
        Write-Log "Warning: Cleanup (down) encountered an issue, but continuing startup..." "Yellow"
    }

    # 2. Start Backend
    $currentStep = "BACKEND_START"
    Write-Log "1. Starting Backend & Waiting for Health Check..." "Green"
    $backendLog = "$logDir/backend_startup_$timestamp.log"
    
    # Start-Process with -PassThru to get the process object
    # CD into backend is critical for relative imports (data_ingestion.py)
    $backendProc = Start-Process powershell -ArgumentList "-Command", "cd backend; python main.py 2>&1 | Tee-Object -FilePath $backendLog" -WindowStyle Hidden -PassThru
    
    # Wait for Backend
    $currentStep = "BACKEND_HEALTH"
    $maxWait = 60
    $waited = 0
    $backendReady = $false
    while ($waited -lt $maxWait) {
        # Check if process is still alive
        if ($backendProc.HasExited) {
            Write-Log "`nERROR: Backend process exited prematurely with code $($backendProc.ExitCode)." "Red"
            Write-Log "Please check the log: $backendLog" "Yellow"
            throw "BACKEND_CRASHED: Exit code $($backendProc.ExitCode). See $backendLog for details."
        }

        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -ErrorAction SilentlyContinue -TimeoutSec 2
            if ($resp.status -eq "ok") {
                Write-Log "`nBackend is READY (Port 8000)." "Green"
                $backendReady = $true
                break
            }
        }
        catch {}
        
        Start-Sleep -Seconds 2
        $waited += 2
        Write-Host "." -NoNewline
    }
    if (-not $backendReady) { throw "BACKEND_STARTUP_TIMEOUT: CHECK $backendLog" }

    # 3. Build & Start Frontend
    $currentStep = "FRONTEND_BUILD"
    Write-Log "2. Building Frontend..." "Green"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "FRONTEND_BUILD_FAILED" }

    $currentStep = "FRONTEND_START"
    Write-Log "3. Starting Frontend..." "Green"
    Start-Process powershell -ArgumentList "-Command", "npm run start" -WindowStyle Hidden

    # Wait for Frontend
    $currentStep = "FRONTEND_LISTEN"
    Write-Log "4. Waiting for Frontend Port 3000..." "Gray"
    $waited = 0
    $frontendReady = $false
    while ($waited -lt $maxWait) {
        $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            Write-Log "Port 3000 is now LISTEN." "Green"
            $frontendReady = $true
            break
        }
        Start-Sleep -Seconds 2
        $waited += 2
        Write-Host "." -NoNewline
    }
    if (-not $frontendReady) { throw "FRONTEND_STARTUP_TIMEOUT" }

    # 4. Final Verification
    $currentStep = "SMOKE"
    Write-Log "5. Running Smoke Test..." "Green"
    $tempSmoke = [System.IO.Path]::GetTempFileName()
    try {
        powershell -ExecutionPolicy Bypass -File "$PSScriptRoot/smoke.ps1" | Tee-Object -FilePath $tempSmoke
        $smokeOut = Get-Content $tempSmoke
        
        if ($smokeOut -match "RESULT: STALE") {
            throw "SMOKE_STALE: Data is too old."
        }
        elseif ($smokeOut -match "RESULT: OK" -or $smokeOut -match "RESULT: PARTIAL") {
            Write-Log "Smoke Test Passed." "Green"
        }
        else {
            throw "SMOKE_FAILED: Unexpected smoke test output."
        }
    }
    finally {
        if (Test-Path $tempSmoke) { Remove-Item $tempSmoke }
    }

    Write-Log "`n=== STARTUP SUCCESSFUL ===" "Green"
    Write-Log "Access at: http://127.0.0.1:3000" "Cyan"

    # Automatically launch the browser for the user
    Start-Process "http://localhost:3000"

}
catch {
    Write-Log "`n!!! STARTUP FAILED !!!" "Red"
    Write-Log "FAILED_STEP: $currentStep" "Yellow"
    Write-Log "ERROR_MSG: $($_.Exception.Message)" "Yellow"
    
    $script:cleanupCalled = $false # Allow Global-Cleanup to run again
    Global-Cleanup
    
    Write-Log "`n--- NEXT ACTIONS ---" "Cyan"
    Write-Log "1. Run: npm run down" "Cyan"
    Write-Log "2. Run: npm run up" "Cyan"
    Write-Log "3. Run: npm run diagnosis" "Cyan"
    Write-Log "LOG FILE: $logFile" "Cyan"
    exit 1
}
finally {
    Stop-Transcript
}
