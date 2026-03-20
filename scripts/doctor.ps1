function Check-Port($port) {
    try {
        $lines = netstat -ano -p tcp | Select-String "LISTENING" | Select-String ":$port\s"
        if ($lines) {
            Write-Host "[OK] Port $port is LISTENING." -ForegroundColor Green
            return $true
        }
        else {
            Write-Host "[WAIT] Port $port is not listening." -ForegroundColor Yellow
            return $false
        }
    }
    catch { return $false }
}

Write-Host "=== System Doctor: Environment Diagnosis ===" -ForegroundColor Cyan

# 1. Directory Check
if (Test-Path "backend/main.py") {
    Write-Host "[OK] Backend source found." -ForegroundColor Green
}
else {
    Write-Warning "[ERR] Backend source (backend/main.py) missing!"
}

# 2. Dependency Check
if (Get-Command "npm" -ErrorAction SilentlyContinue) {
    Write-Host "[OK] npm found." -ForegroundColor Green
}
else {
    Write-Warning "[ERR] npm not found!"
}

if (Get-Command "python" -ErrorAction SilentlyContinue) {
    Write-Host "[OK] python found." -ForegroundColor Green
}
else {
    Write-Warning "[ERR] python not found!"
}

# 3. Network Environment Check
Check-Port 8000
Check-Port 3000

# 4. Data File Integrity
$dataFiles = @("backend/data/stock_list.json", "backend/data/historical_data.json")
foreach ($f in $dataFiles) {
    if (Test-Path $f) {
        Write-Host "[OK] Data file found: $f" -ForegroundColor Green
    }
    else {
        Write-Warning "[WARN] Data file missing: $f"
    }
}

Write-Host "=== Diagnosis Complete ===" -ForegroundColor Cyan
