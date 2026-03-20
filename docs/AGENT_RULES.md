# AGENT_RULES.md - Project Integrity & Operational Protocol

## 1. Always-run 停止の根絶（最優先）
Antigravity（エージェント）は、VSCode の "Always run" モードが確認ダイアログ（Run command?）によって停止することを防ぐため、以下のルールを厳守してください。

### 1.1 アドホック・コマンドの禁止
ターミナル上で以下のような複雑・危険なコマンドを直接組み立てて実行してはなりません。差分が発生し、人間による承認が必要になります。
- **禁止**: `Stop-Process`, `taskkill`, `netstat`, `findstr`, `|` (パイプ), `;` (連結)
- **許可**: `npm run <コマンド>` または `powershell -ExecutionPolicy Bypass -File .\scripts\<固定>.ps1`

### 1.2 固定コマンド・リスト
プロジェクトの運用・診断には、以下の固定文字列のみを使用してください。
- **再起動**: `npm run restart`
- **疎通確認**: `npm run healthcheck`
- **全検証**: `npm run verify:all`
- **開発起動**: `npm run dev:all`

## 2. スクリプト運用
- 新しい診断や複雑な操作が必要になった場合、まず `scripts/` にその操作をラップしたスクリプトを作成し、その後でそのスクリプトを「固定コマンド」として実行してください。
- すべてのスクリプトは非対話型（`-Force`, `-Confirm:$false` 等）で実装し、終了コード (`exit 0` / `exit 1`) を明確に出力してください。

## 3. 開発環境の標準化
- `.vscode/settings.json` により、ターミナルの挙動や保存時の動作を固定し、環境差異による「意図しない確認」を抑制します。

---
*Created by Antigravity - System Reliability Protcol*
