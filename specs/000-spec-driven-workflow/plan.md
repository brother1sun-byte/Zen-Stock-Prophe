# Implementation Plan: Spec-Driven Development Workflow

## 目的
Spec Kit の考え方を、Zen Stock Prophet の開発運用に最小追加で導入する。

## 結論
ランタイム依存を追加せず、ドキュメントと品質ゲートのみを追加する。

## 判断範囲

### 実装するもの
- `.specify/memory/constitution.md`
- `docs/spec-kit-workflow.md`
- `specs/000-spec-driven-workflow/spec.md`
- `specs/000-spec-driven-workflow/plan.md`
- `specs/000-spec-driven-workflow/tasks.md`
- READMEへの参照追記

### 実装しないもの
- `package.json` への依存追加
- Python依存追加
- UI変更
- API変更
- GitHub Actions変更

## 技術方針
- Markdownのみ追加する
- 既存アプリの実行パスに影響を与えない
- Spec Kit CLIは任意利用とし、強制しない
- Windows利用を想定し、CLI初期化例では `--script ps` を示す

## 憲法チェック
- [x] 売買推奨に見える表現を避ける
- [x] データ出所・鮮度・欠損表示の原則を入れる
- [x] APIキーをフロントへ出さない原則を入れる
- [x] 既存設計を壊さない
- [x] テスト可能な受け入れ条件を入れる

## 検証方針
ドキュメント追加のみのため、ランタイムテストは必須ではない。
ただし、次回以降の実装では以下を標準検証とする。

- `npm run build`
- `npm run typecheck`
- `npm run test:e2e`
- バックエンド変更がある場合はPythonテスト

## リスク
- Spec Kit CLIを実行しないため、公式テンプレート一式が完全には生成されない。
- 対策：今回は運用導入を優先し、必要に応じて後続タスクで `specify init` を実行する。

## 完了条件
- 仕様駆動開発の運用ファイルがリポジトリに追加されている
- READMEから運用手順へ辿れる
- Codexへ渡す標準プロンプト型が用意されている
