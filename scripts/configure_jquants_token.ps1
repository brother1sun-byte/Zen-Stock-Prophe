param(
    [Parameter(Mandatory = $true)]
    [string] $ApiKey
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $root ".env.local"

$lines = @(
    "# Local secrets for Zen Stock Prophet Pro",
    "# Do not commit or share this file.",
    "JQUANTS_API_KEY=$ApiKey"
)

Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8
Write-Host "Saved J-Quants API key to $envPath"
Write-Host "Restart the backend process, then open /api/research/jquants/status to verify."
