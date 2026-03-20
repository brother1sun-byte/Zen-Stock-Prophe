$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("C:\Users\BRB33\OneDrive\Desktop\Zen Stock Prophet.lnk")
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = """C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\ZenStockProphet_HiddenLaunch.vbs"""
$Shortcut.WorkingDirectory = "C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet"
$Shortcut.IconLocation = "C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\ZenStockProphet.ico, 0"
$Shortcut.Description = "Zen Stock Prophet - AI Stock Analysis System"
$Shortcut.Save()
Write-Host "Shortcut updated successfully!"
