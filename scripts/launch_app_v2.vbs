Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Force current directory to project root (HARDCODED for reliability)
ProjectRoot = "C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet"
WshShell.CurrentDirectory = ProjectRoot

' Define paths
PowerShellPath = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
UpScriptPath = ProjectRoot & "\scripts\up.ps1"

' Run up.ps1 in hidden mode (0)
' ExecutionPolicy Bypass is required
Command = """" & PowerShellPath & """ -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & UpScriptPath & """"
WshShell.Run Command, 0, False
