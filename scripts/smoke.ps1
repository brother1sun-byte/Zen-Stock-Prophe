$ErrorActionPreference = "Stop"
$API_BASE = "http://localhost:8000"
$POLICY_FILE = "$PSScriptRoot/.smoke_policy.json"
$logDir = "$PSScriptRoot/../logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir }

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = "$logDir/smoke_$timestamp.log"

function Write-Log($msg, $color = "White", $noNewline = $false) {
    if ($noNewline) {
        Write-Host $msg -ForegroundColor $color -NoNewline
    }
    else {
        Write-Host $msg -ForegroundColor $color
    }
}

Start-Transcript -Path $logFile -Append

try {
    Write-Log "--- Starting Smoke Test & Freshness Check (Japan Stock Prophet) ---" "Cyan"

    # Load Policy
    if (-not (Test-Path $POLICY_FILE)) { throw "Policy file not found: $POLICY_FILE" }
    $policy = Get-Content $POLICY_FILE | ConvertFrom-Json
    $isPartial = $false
    $isStale = $false

    function Is-Market-Closed {
        $now = [DateTime]::Now
        $day = $now.DayOfWeek
        $hour = $now.Hour
        if ($day -eq "Saturday" -or $day -eq "Sunday") { return $true }
        if ($hour -lt $policy.market_open_hour -or $hour -ge $policy.market_close_hour) { return $true }
        return $false
    }

    function Check-Freshness($lastSyncStr) {
        if (-not $lastSyncStr) { return $false }
        try {
            $lastSync = [DateTime]::ParseExact($lastSyncStr, "yyyy-MM-dd HH:mm:ss", $null)
            $diff = [DateTime]::Now - $lastSync
            
            $thresholdMinutes = $policy.max_stale_minutes
            if (Is-Market-Closed) {
                $thresholdMinutes = $policy.weekend_threshold_hours * 60
                Write-Log " (Market Closed mode: threshold ${thresholdMinutes}m)" "Gray" $true
            }

            if ($diff.TotalMinutes -gt $thresholdMinutes) {
                Write-Log " [STALE] ($($diff.TotalMinutes.ToString('F0')) min ago)" "Red"
                $script:isStale = $true
                return $false
            }
            return $true
        }
        catch {
            return $false
        }
    }

    function Check-Endpoint($url, $requiredFields = @(), $verifyFreshness = $false) {
        Write-Log "Checking $url..." "White" $true
        try {
            $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10
            Write-Log " [PASS]" "Green" $true
            
            if ($requiredFields.Count -gt 0) {
                foreach ($field in $requiredFields) {
                    if (-not $response.PSObject.Properties[$field]) {
                        Write-Log "`n  ! Missing required field: $field" "Yellow"
                        return $false
                    }
                }
            }

            if ($response.PSObject.Properties['partial'] -and $response.partial -eq $true) {
                $script:isPartial = $true
                if ($response.PSObject.Properties['missing_fields']) {
                    $fields = ($response.missing_fields -join ", ")
                    Write-Log "`n  ! PARTIAL DATA: [$fields]" "Yellow"
                }
            }

            if ($verifyFreshness) {
                if (-not (Check-Freshness $response.last_sync)) {
                    return $false
                }
            }
            else {
                Write-Log ""
            }
            return $true
        }
        catch {
            Write-Log " [FAIL]" "Red"
            $script:isStale = $true
            $msg = $_.Exception.Message
            Write-Log " Error: $msg" "Gray"
            return $false
        }
    }

    $today = Get-Date -Format "yyyy-MM-dd"
    $lastWeek = (Get-Date).AddDays(-7).ToString("yyyy-MM-dd")

    $tests = @(
        @{ Url = "$API_BASE/health"; Fields = @("status"); Fresh = $false },
        @{ Url = "$API_BASE/api/scoring?ticker=7203"; Fields = @("asof", "last_sync"); Fresh = $true },
        @{ Url = "$API_BASE/api/review?from=$lastWeek&to=$today"; Fields = @("asof", "last_sync"); Fresh = $true },
        @{ Url = "$API_BASE/api/macro_snapshot?asof=$today"; Fields = @("asof"); Fresh = $false }
    )

    foreach ($test in $tests) {
        Check-Endpoint $test.Url $test.Fields $test.Fresh | Out-Null
    }

    if ($isStale) {
        Write-Log "`nRESULT: STALE" "Red"
        Write-Log "FAIL_REASON: Data is too old or connectivity failed." "White"
        exit 1
    }
    elseif ($isPartial) {
        Write-Log "`nRESULT: PARTIAL" "Yellow"
        Write-Log "WARNING: Some data fields are missing. Use with caution." "Yellow"
        exit 0
    }
    else {
        Write-Log "`nRESULT: OK" "Green"
        Write-Log "--- ALL SMOKE TESTS PASSED ---" "Green"
        exit 0
    }
}
catch {
    Write-Log "`nRESULT: ERROR" "Red"
    Write-Log "FAIL_REASON: Unexpected error: $($_.Exception.Message)" "Yellow"
    exit 1
}
finally {
    Stop-Transcript
}
