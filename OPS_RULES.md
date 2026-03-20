# OPS_RULES.md — Zero Stop Policy（全プロジェクト共通）

## 目的
“Always run”でも止まる状況（入力待ち・待機）を根絶し、誰でも再現可能な運用に統一する。

## 禁止（破ったらNG）
- dev server を foreground 起動（待機で止まる原因）
- 手打ち curl / Invoke-WebRequest（クォート崩れ→入力待ち）
- Next.js rewrites の利用（API競合の温床）
- fetch の res.json() 直呼び（HTML 500でクラッシュ）

## 強制（唯一の正解）
- 起動・再起動：`.\scripts\restart.ps1`
- 疎通確認：`.\scripts\healthcheck.ps1`
- 全検証：`.\scripts\verify_all.ps1`

## 成功条件（毎回これが揃うこと）
- logs/restart_*.log
- logs/healthcheck_*.log
- verify:all PASS
