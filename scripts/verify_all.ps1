$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ConfirmPreference = "None"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Write-Host "=== verify_all.ps1 ===" -ForegroundColor Cyan
Write-Host "[1/2] Linting & Protocol Guards..." -ForegroundColor Cyan
npm run lint:guards

if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Protocol guards failed!" -ForegroundColor Red
    exit 1
}

Write-Host "[2/2] Automated Tests (Playwright)..." -ForegroundColor Cyan
npx playwright test tests/

if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Tests failed!" -ForegroundColor Red
    exit 1
}

Write-Host "[PASS] verify_all.ps1 ALL GREEN" -ForegroundColor Green
