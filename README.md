# Zen Stock Prophet Pro

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
- Pre-open API: `http://127.0.0.1:8889/api/preopen/6503.T`

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
