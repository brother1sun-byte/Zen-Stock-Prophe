# Save to GitHub Helper Script
# Usage: ./scripts/save_to_github.ps1 "Commit Message"
param (
    [string]$message = "Update: Enforce V7.5 UI and Polish Codebase"
)

Write-Host "Saving changes to GitHub..." -ForegroundColor Cyan

# Check if git is available
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Git is not installed or not in the PATH."
    exit 1
}

# Add all changes
git add .
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to add files."
    exit 1
}

# Commit
git commit -m "$message"
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Commit failed. Maybe nothing to commit?"
}

# Push
git push
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to push to remote."
    exit 1
}

Write-Host "Successfully saved to GitHub!" -ForegroundColor Green
