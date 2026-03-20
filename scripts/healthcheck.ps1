# scripts/healthcheck.ps1
# Advanced System Integrity Verification (v2.0)

Write-Host "--- ADVANCED HEALTH CHECK START ---" -ForegroundColor Cyan
$Success = $true

function Test-Endpoint($url, $name, $method = "GET", $body = $null) {
    try {
        $params = @{
            Uri         = $url
            Method      = $method
            TimeoutSec  = 5
            ErrorAction = "Stop"
        }
        if ($body) {
            $params.Body = $body
            $params.ContentType = "application/json"
        }
        
        $resp = Invoke-WebRequest @params
        if ($resp.StatusCode -eq 200) {
            Write-Host "[OK] $name ($url) responded 200 OK" -ForegroundColor Green
            return $true
        }
    }
    catch {
        Write-Host "[FAIL] $name ($url) unreachable or error: $($_.Exception.Message)" -ForegroundColor Red
    }
    return $false
}

# 1. Connectivity Checks
if (!(Test-Endpoint "http://127.0.0.1:8000/docs" "Backend API Docs")) { $Success = $false }
if (!(Test-Endpoint "http://localhost:3000" "Frontend Web Server")) { $Success = $false }

# 2. Deep API Validation (Functional Check)
Write-Host "Verifying API Logic (/api/predict)..." -ForegroundColor Gray
$predictBody = '{"ticker": "7203"}' # Default check Toyota
if (!(Test-Endpoint "http://localhost:3000/api/predict" "API Predict Route" "POST" $predictBody)) {
    Write-Host "[CAUTION] API Route check failed. Ensure Backend is fully initialized." -ForegroundColor Yellow
    $Success = $false
}

if ($Success) {
    Write-Host "--- SYSTEM STATUS: NOMINAL ---" -ForegroundColor Green
    exit 0
}
else {
    Write-Host "--- SYSTEM STATUS: CRITICAL ERROR DETECTED ---" -ForegroundColor Red
    exit 1
}
