Set WshShell = CreateObject("WScript.Shell")
' Get the directory of the script
strPath = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
' Launch the batch file hidden
WshShell.Run """" & strPath & "launch_tenkai.bat""", 0, False
