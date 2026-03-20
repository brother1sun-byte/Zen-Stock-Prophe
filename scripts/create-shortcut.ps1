$WshShell = New-Object -ComObject WScript.Shell
$ShortcutName = "MinatoMirai Pro.lnk"

# デスクトップパスの取得
$DesktopPath = [System.IO.Path]::Combine($env:USERPROFILE, "Desktop")
if (Test-Path "$env:USERPROFILE\OneDrive\Desktop") {
    $DesktopPath = "$env:USERPROFILE\OneDrive\Desktop"
}

$Paths = @($DesktopPath)

foreach ($Path in $Paths) {
    $ShortcutPath = Join-Path $Path $ShortcutName
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)

    # 起動コマンド (ステルス起動: VBScriptを使用してターミナルを表示させない)
    $Shortcut.TargetPath = "wscript.exe"
    $Shortcut.Arguments = """c:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\scripts\launch_silent.vbs"""
    $Shortcut.WorkingDirectory = "c:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet"

    # アイコンの設定 (透明背景対応マルチ解像度ICO v8.0.2)
    $IconPath = "c:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\public\icons\app_v802.ico"
    $Shortcut.IconLocation = "$IconPath,0"

    $Shortcut.Save()
    Write-Host "Created shortcut: $ShortcutPath"
}

# Windowsのアイコンキャッシュをリフレッシュ
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
'@
[Win32]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

# 強制的にエクスプローラーを再起動してキャッシュをフラッシュ（ユーザーへの提案に近いが、敢行）
# Stop-Process -Name explorer -Force # これは過激すぎるのでコメントアウト。SHChangeNotifyで粘る。

Write-Host "--- Shortcuts Updated & Icon Cache Refreshed (v8.0.2) ---"
Write-Host "Icon Applied: public/icons/app_v802.ico"
Write-Host "--------------------------------------------------------"
