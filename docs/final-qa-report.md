# 最終QA記録

## QA実施日

2026-06-28

## 対象コミット

`4061526 Guide first-time users before final release polish`

## 実行した確認コマンド

- `npm run lint`
- `npm run build`
- `python -m unittest discover -s tests`
- `npm run test`
- `npm run test:ui`
- `git diff --check`
- `git status --short`
- `git log --oneline -1`

## lint結果

成功。`eslint .` がエラーなしで完了しました。

## build結果

成功。`vite build` が完了し、生成物を作成できました。

## Python unittest結果

成功。`Ran 170 tests` / `OK` を確認しました。

## UI test結果

成功。`npm run test` と `npm run test:ui` の両方で `63 passed` を確認しました。

## git diff --check結果

成功。空白エラーなしを確認しました。

## git status結果

P2.4差分のみが表示される状態で確認しました。コミット後にclean状態を再確認します。

## 主要画面確認

- 高度分析画面
- ウォッチリスト画面
- CSVインポート
- 寄り付き前チェック
- 開示・決算チェック
- ウォッチリスト一括チェック
- 重要材料サマリー
- ChatGPT相談用プロンプト生成
- データ設定パネル

## CSVインポート確認

サンプルCSVと不正行サンプルCSVで、プレビュー、スキップ理由、重複処理、一括チェック反映を確認対象にしています。

## EDINET API未設定時確認

EDINET API未設定時は、画面を落とさずAPI未設定またはデータ未取得として表示する設計です。

## J-Quants API未設定時確認

J-Quants API未設定時は、画面を落とさずAPI未設定またはデータ未取得として表示する設計です。

## TDnet相当データ未取得表示確認

TDnet相当データは未取得として表示します。
規約リスクのあるスクレイピングは行いません。

## ChatGPT相談用プロンプト生成確認

ChatGPT相談用プロンプトはコピー用テキストとして生成します。
ChatGPT APIやOpenAI APIへ直接送信しません。

## 重要材料サマリー確認

重要材料サマリーは、取得済みデータ、不足情報、根拠、データ充足度を表示します。
データ充足度は投資判断の確度ではありません。

## 禁止表現確認

主要ドキュメントと追加テストで禁止表現が追加されていないことを確認対象にしています。

## APIキー非表示確認

APIキーや認証情報そのものは画面、README、リリースノート、QA記録に表示しません。

## 外部AI送信なし確認

ChatGPT APIやOpenAI APIへ直接送信しません。
コピー用テキストのみ作成します。

## 実注文機能なし確認

実注文機能はありません。

## 証券会社API未接続確認

証券会社APIには接続しません。

## 残課題

- TDnet公式APIまたはJ-Quantsアドオン利用時の実取得設計
- 手動データ編集画面
- キャッシュ管理画面
- 実データキーを使ったライブ取得確認
- デプロイ手順書
