# Zen Stock Prophet Pro

日本株の寄り付き前デイトレ候補を、統計・ルール・機械学習風スコアで絞り込む分析支援アプリです。投資助言、買い推奨、証券会社への自動注文は行いません。

## Current Operating Policy

- 固定観察銘柄は `4980.T` デクセリアルズのみです。
- それ以外の候補は、JPX 上場銘柄リストから国内市場の銘柄を読み込み、無料データで一括スクリーニングします。
- `/api/screen` は固定観察銘柄を残したまま、国内市場ユニバースの上位候補を `STOCKS` に反映します。
- Jobs Decision は50万円のシミュレーションとして、指値、売値、損切り、100株単位の株数、想定利幅を表示します。実注文は常にオフです。

## Universe Settings

`.env` で以下を調整できます。

- `ZEN_JPX_UNIVERSE_PATH`: ローカルのJPX銘柄マスタ xlsx/csv を優先使用する場合のパス
- `ZEN_JPX_LISTED_ISSUES_URL`: JPX上場銘柄データURL。標準は月次の全上場銘柄 `.xls`
- `ZEN_JPX_UPDATED_ISSUES_URL`: `.xls` を読み込めない環境で使う更新銘柄 `.xlsx` フォールバック
- `ZEN_SCREEN_MAX_UNIVERSE`: `0` は読み込めた国内市場ユニバースを全件スキャン
- `ZEN_SCREEN_BATCH_SIZE`: yfinance 一括取得のバッチ件数

日本株の寄り付き前デイトレ候補を、統計・ルールベース・検証ログで絞り込む分析支援アプリです。投資助言、買い推奨、証券会社への自動発注は行いません。

## 現在構成

- `backend/server.py` - FastAPI API、候補リスト、ポートフォリオ、詳細分析、ローカルDB
- `backend/preopen_scoring.py` - 寄り付き前に利用可能な情報だけで作る100点スコア
- `backend/advanced_analysis.py` - 履歴検証、ウォークフォワード、モンテカルロ、品質ゲート
- `backend/daytrade_engine.py` - 板・寄り付き監視用のペーパー検証チケット
- `backend/jquants_bridge.py` - 任意の読み取り専用J-Quants連携
- `src/App.jsx` / `src/index.css` - React UI
- `tests/` - スクリーニング、詳細分析、アラート、ポートフォリオ、寄り前スコアの回帰テスト

## 寄り前スコア

`preopen_scoring.py` は当日寄り後の価格、高値、終値、出来高を使いません。入力は完了済み日足と、実運用で別途接続できる任意フィードだけです。未接続のニュース、PTS、寄り前気配、セクター強度は推測で加点せず、UI上では未確認リスクとして表示します。

スコア配分:

- 材料性: 20点
- 出来高急増: 20点
- PTS・寄り前気配: 15点
- テクニカル: 15点
- 地合い・セクター: 10点
- 流動性: 10点
- リスク控除: 最大30点

主なリスク判定:

- 低流動性
- 過熱
- 高ボラティリティ
- 寄り天傾向
- 代替データ使用
- 材料、PTS、気配、地合いフィード未接続

## 起動

```powershell
cd C:\Users\BRB33\investment-simulator-pro
python -m pip install -r requirements.txt
npm install
python backend/server.py
npm run dev
```

通常の確認URL:

- Frontend: `http://127.0.0.1:5174/latest.html`
- Backend: `http://127.0.0.1:8889/api/stocks`
- Pre-open API: `http://127.0.0.1:8889/api/preopen/4980.T`

## 設定

`.env.example` を `.env` にコピーして利用します。APIキーやトークンは空欄のままでも動作します。実キーはコミットしないでください。

## 検証

```powershell
python -m unittest discover -s tests
npm run lint
npm run build
```

UIを変更した場合はブラウザで `latest.html` を開き、候補カード、Pre-Open Score、根拠、リスク表示が崩れていないことを確認します。

## 運用注意

- 表示は「高騰候補」「監視候補」「リスク確認」であり、「買い推奨」ではありません。
- yfinanceや任意外部APIの欠損、遅延、調整後価格の扱いに結果が依存します。
- PTS、寄り前気配、適時開示、セクター強度は未接続時に加点しません。
- 実運用前に、時系列分割、ウォークフォワード検証、手数料、スリッページ、約定可能性、最大投入額制限を必ず検証してください。
