# Spec Kit Workflow for Zen Stock Prophet

## 目的
Spec Kit の考え方を使い、AI実装前に「仕様・計画・タスク・検証」を固定します。

このリポジトリでは、Spec Kitをアプリ実行時の依存関係として追加しません。アプリ本体の分析精度を直接上げるものではなく、Codex / Copilot などのAI実装作業を安定させる開発運用として使います。

## 結論
有効です。ただし、用途は「日本株分析ロジックの直接改善」ではなく、以下の品質管理です。

- 仕様の抜け漏れ防止
- 売買推奨に見える表現の混入防止
- APIキーをフロントへ出さない設計の維持
- データ出所・鮮度・欠損時表示の明確化
- 実装タスクと検証項目の追跡

## 判断範囲
今回の導入範囲は、以下に限定します。

- `.specify/memory/constitution.md` にプロジェクト原則を追加
- `specs/000-spec-driven-workflow/` に初期仕様・計画・タスクを追加
- README に運用方法を追記

以下は今回の対象外です。

- アプリ本体への新規依存追加
- Spec Kit CLI の強制インストール
- 既存UI・既存APIの変更
- ChatGPT APIへの自動送信
- 売買判断を自動化する機能

## 材料
Spec Kit の基本フローは、次の順番です。

1. Constitution: プロジェクト原則を決める
2. Specify: 何を作るか、なぜ作るかを定義する
3. Plan: 技術方針と影響範囲を整理する
4. Tasks: 実装単位に分解する
5. Implement: タスクに沿って実装する
6. Analyze / Checklist: 仕様と実装のズレを確認する

## 実運用ルール

### 新機能をCodexへ依頼する前
`specs/` 配下に、最低限以下を作成します。

- `spec.md`: 目的、ユーザーストーリー、受け入れ条件、非対象範囲
- `plan.md`: 技術方針、影響範囲、データ出所、セキュリティ
- `tasks.md`: 実装タスク、テスト、検証手順

### Codexへ渡すプロンプトの型

```text
目的：
<何を実現するか>

前提：
- .specify/memory/constitution.md を必ず守る
- specs/<feature>/spec.md、plan.md、tasks.md を参照する
- 売買推奨・投資助言に見える表現は禁止
- APIキーや認証情報はバックエンドのみで扱う
- 既存設計を壊さず、最小追加で実装する

実装範囲：
<今回実装するタスク番号>

検証：
- npm run build
- npm run typecheck
- npm run test:e2e
- 必要に応じてバックエンドテスト

完了条件：
- 変更ファイル一覧
- 実行した検証コマンド
- 残課題
- 売買推奨表現が混入していないこと
```

## Spec Kit CLI を使う場合
ローカルでCLIを使う場合のみ、公式GitHubリポジトリからインストールします。

```bash
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.13
specify init . --integration copilot --script ps
```

注意：PyPI上の同名パッケージではなく、公式GitHubリポジトリ由来のものを使います。

## 判断メモ
このアプリでは、AIにいきなりコードを書かせるより、先に仕様を固定した方が安全です。
特に、投資系アプリは「便利な表現」が投資助言に見えやすいため、Spec Kit型のゲートを置く価値があります。
