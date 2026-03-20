# AG_RULES.md - Antigravity 運用規約

本プロジェクトにおける、Antigravity (AI) および開発者の行動指針を定義する。
目的は、実行承認待ちによる停止を最小化し、「Zero-Intervention (ゼロ介入)」での完結を実現することである。

## 1. 絶対ルール：生コマンドの禁止
- Antigravity は、OS/シェル固有の生コマンドを直接（単発で）実行してはならない。
- すべての操作は `scripts/` ディレクトリに標準化されたスクリプト経由で実行する。
- 1ステップ = 1スクリプト実行 を徹底する。

## 2. 標準運用フロー (3-Step Strategy)
変更適用後、以下の順序でスクリプトを実行し、システムの整合性を確認する。

1. **Restart**: `powershell -ExecutionPolicy Bypass -File .\scripts\restart.ps1`
   - 全プロセスの停止・再起動・ポート待ち受け確認。
2. **Healthcheck**: `powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1`
   - API、Frontend、Proxy の疎通およびデータ整合性確認。
3. **Verify**: `powershell -ExecutionPolicy Bypass -File .\scripts\verify_all.ps1`
   - 静的解析、リント、および Playwright による自動テスト。

## 3. スクリプトの役割
- **scripts/doctor.ps1**: 環境診断（ポート使用状況、依存関係のチェック）。**新規コマンドが必要な際はこのスクリプトに統合してから使用する。**
- **scripts/restart.ps1**: リスクの高いプロセス操作（Stop-Process等）をここに集約。
- **scripts/healthcheck.ps1**: 接続テスト（Invoke-WebRequest/curl）をここに集約。
- **scripts/verify_all.ps1**: すべてのガードレールとテストの統合。

## 4. 停止回避の例外処理
もし、UI で「Run command?」の承認が頻発したり、コマンドがブロックされた場合は、以下の処置を行う：
1. ブロックされたコマンドを `scripts/doctor.ps1` または関連スクリプト内に統合する。
2. 作業手順を修正し、統合されたスクリプトのみを呼び出すようにする。
3. これにより、次回の作業からは 1 回の承認で一連の操作が完結するようにする。

---
**Date**: 2026-02-08
**Version**: 1.0.0
