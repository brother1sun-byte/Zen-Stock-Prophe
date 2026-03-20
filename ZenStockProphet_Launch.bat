@echo off
echo Starting Zen Stock Prophet Backend...
start cmd /k "cd /d C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\backend && python main.py"

echo Starting LazyGravity Discord Bot...
start cmd /k "cd /d C:\Users\BRB33\OneDrive\Desktop\Antigravity\LazyGravity && npx -y ts-node-dev --respawn src/bin/cli.ts start"

echo Starting Next.js Frontend...
start cmd /k "cd /d C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet && npm start"

echo Waiting for backend to initialize...
timeout /t 5

echo Opening Zen Stock Prophet Dashboard...
start http://localhost:3000

echo Both systems have been launched in background windows.
timeout /t 3
exit
