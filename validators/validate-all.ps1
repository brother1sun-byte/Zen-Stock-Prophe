$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $repoRoot
try {
    & python (Join-Path $PSScriptRoot 'validate_all.py') @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
