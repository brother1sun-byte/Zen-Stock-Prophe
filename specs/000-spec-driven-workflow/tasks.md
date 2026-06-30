# Tasks: Spec-Driven Development Workflow

## 目的
Zen Stock Prophet のAI実装依頼を、仕様・計画・タスクに基づく流れへ変更する。

## 結論
今回のタスクは、ドキュメント追加のみで完了する。

## 判断範囲

### T001: プロジェクト憲法を追加する
- [x] `.specify/memory/constitution.md` を追加
- [x] 投資助言表現禁止の原則を明記
- [x] APIキーをバックエンドのみで扱う原則を明記
- [x] データ出所・鮮度・欠損時の表示原則を明記

### T002: 運用ガイドを追加する
- [x] `docs/spec-kit-workflow.md` を追加
- [x] Spec Kitの使いどころを明記
- [x] Codexへ渡すプロンプト型を追加
- [x] CLI利用は任意と明記

### T003: 初期仕様セットを追加する
- [x] `specs/000-spec-driven-workflow/spec.md` を追加
- [x] `specs/000-spec-driven-workflow/plan.md` を追加
- [x] `specs/000-spec-driven-workflow/tasks.md` を追加

### T004: READMEに参照を追加する
- [x] READMEへ `docs/spec-kit-workflow.md` の参照を追記

### T005: 後続候補
- [ ] 次のP1系機能から、`specs/001-<feature>/` 形式で仕様を作成する
- [ ] 必要に応じてローカルで `specify init . --integration copilot --script ps` を実行する
- [ ] 実装後に `/speckit.analyze` 相当のレビュー観点で仕様と実装のズレを確認する

## 検証
- [x] ドキュメント追加のみのため、ランタイム影響なし
- [x] README更新後、リンク先のパスを確認する

## 完了条件
- READMEからSpec Kit運用ガイドにアクセスできる
- 今後のCodex依頼で参照できる憲法・仕様・計画・タスクが揃っている
