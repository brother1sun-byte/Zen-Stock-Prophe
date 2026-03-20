Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$outputPath = "C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\public\icons"

function Take-Screenshot($name) {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $bitmap.Size)
    $file = Join-Path $outputPath "$name.png"
    $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "Screenshot saved: $file"
}

# 1. Desktop Screenshot
Take-Screenshot "desktop_icons_check"

# 2. Startup Folder Screenshot (Try to open it first)
Start-Process explorer.exe "shell:startup"
Start-Sleep -Seconds 3 # Wait for folder to open/focus
Take-Screenshot "startup_folder_check"

Write-Host "--- Verification Screenshots Complete ---"
