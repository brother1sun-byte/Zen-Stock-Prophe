Set WshShell = CreateObject("WScript.Shell")

' 1. バックエンドの起動 (画面なし: 0)
backendCmd = "cmd /c cd /d ""C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\backend"" && python main.py"
WshShell.Run backendCmd, 0, False

' 2. Discordボットの起動 (画面なし: 0)
botCmd = "cmd /c cd /d ""C:\Users\BRB33\OneDrive\Desktop\Antigravity\LazyGravity"" && npx -y ts-node-dev --respawn src/bin/cli.ts start"
WshShell.Run botCmd, 0, False

' 3. フロントエンドの起動 (画面なし: 0)
frontendCmd = "cmd /c cd /d ""C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet"" && npm start"
WshShell.Run frontendCmd, 0, False

' サーバーが立ち上がるまで5秒待つ
WScript.Sleep 5000

' 4. ダッシュボードを開く
WshShell.Run "http://localhost:3000"
