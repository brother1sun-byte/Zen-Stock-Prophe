## 追加実装: P1.6 ウォッチリスト寄り付き前チェック

単一銘柄の「寄り付き前チェック」を、ウォッチリストに表示される複数銘柄へ拡張した。朝の銘柄確認で、どの銘柄に開示・決算材料の確認優先度があるかを一覧で把握するためのリサーチ補助であり、売買推奨ではない。

### 実装内容

- `src/utils/watchlistPreopenCheck.js` を追加し、ウォッチリスト全銘柄の寄り付き前チェック、件数サマリー、注意度順の並び替え、フィルター、次工程のChatGPT相談用材料生成を純粋関数として実装。
- 既存のEDINET取得結果、決算カレンダー取得結果、日本営業日カレンダーを再利用し、銘柄ごとに外部APIを連打しない構成にした。
- ウォッチリスト画面に「ウォッチリスト一括チェック」パネルを追加し、対象銘柄数、重要予定あり、確認推奨、データ未取得、目立つ材料なし、エラー件数を表示。
- 銘柄別行は展開可能にし、EDINET提出書類、決算予定、照合方法、ソース別取得状況、一次情報確認メッセージを確認できるようにした。
- フィルターは「すべて」「重要予定あり」「確認推奨」「データ未取得」「目立つ材料なし」に限定し、朝の確認導線を増やしすぎないようにした。

### 制約と扱い

- J-Quants決算予定の実取得はP1.7へ送る。P1.6では既存の決算カレンダー土台、手動JSON、未取得表示を使う。
- TDnet相当データは無料・規約面の制約があるため、スクレイピングは行わない。
- 架空データを実データのように表示しない。未取得、API未設定、キャッシュ利用は画面上で明示する。
- 本機能は投資助言ではなく、一次情報確認と材料整理の補助に限定する。

### 次の改善候補

- P1.7: J-Quants決算予定の実取得。
- P1.8: ChatGPT相談用プロンプトへの開示・決算材料の自動挿入。
- P1.9: 重要材料のAI要約と根拠表示。
- P2: ウォッチリストCSVインポート、TDnetアドオン利用時の設計、前日引け後TDnet重要開示確認。

# 無料で構築する日本株リサーチ強化計画

## 目的

Zen Stock Prophet Proを、無料API・公開データ・OSSを中心にした日本株リサーチ支援ツールとして強化する。実注文や投資助言ではなく、銘柄選定前の確認材料、根拠、リスク、未確認項目を短時間で整理することを目的にする。

## 現状アプリの課題

| 領域 | 現状 | 課題 |
| --- | --- | --- |
| 株価データ | yfinance、Yahooチャート、Stooq、J-Quants遅延、cache/syntheticを扱う | 画面上で「どの材料が揃っているか」を横断確認しづらい |
| スクリーニング | ランキング、候補スコア、短期上昇/出来高/品質などの軸がある | ランキング軸ごとの出所と欠損時の注意が一目で分かりにくい |
| テクニカル | トレンド、勢い、流動性、ATR、ウォークフォワード検証がある | 指標はあるが、取得済み/未取得/参考扱いの区別が弱い |
| AI分析 | ローカルMLの検証補助を導入済み | AIを買い推奨と誤解しないための説明と証拠表示をさらに強める余地がある |
| ファンダメンタル | J-Quants連携とEPS/BPS表示がある | EDINET/TDnet/財務指標の網羅表示はまだ弱い |
| UI/UX | 日本語UI、シンプル/詳細切替、ChatGPT相談用コピーがある | 文字化け修復と、初心者向けの「確認できた材料」表示が必要 |
| 保守性 | hooks分離が進んでいる | App.jsxと表示用ViewModelにまだ責務が残る |

## GitHub調査結果

2026-06-27時点でGitHub APIまたは公開ページから確認した候補。

| リポジトリ | URL | 概要 | 主な技術 | 日本株対応度 | 無料 | Star | 最終更新 | License | 参考にすべき点 | 活用方法 | 注意点 |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| J-Quants API Client | https://github.com/J-Quants/jquants-api-client-python | J-Quants公式Pythonクライアント | Python | 高 | 無料枠あり | 194 | 2026-06-19 | Apache-2.0 | 公式データ取得 | 遅延株価、財務、銘柄情報の正規ルート | 無料枠制限と遅延を明示 |
| JPX Tokyo Stock Exchange Prediction | https://github.com/J-Quants/JPXTokyoStockExchangePrediction | 日本株予測コンペ実装例 | Notebook | 高 | 可 | 56 | 2023-01-12 | Apache-2.0 | 特徴量設計、検証設計 | ML特徴量と検証の参考 | 更新は古め |
| awesome-japan-finance-data | https://github.com/ajtgjmdjp/awesome-japan-finance-data | 日本金融データのリンク集 | Docs | 高 | 可 | 13 | 2026-02-19 | CC0-1.0 | 無料データ源の棚卸し | データソース拡張の調査起点 | 実装ではなく一覧 |
| tdnet-disclosure-mcp | https://github.com/ajtgjmdjp/tdnet-disclosure-mcp | TDnet開示MCP | Python | 高 | 可 | 3 | 2026-03-02 | Apache-2.0 | 適時開示検索の設計 | TDnet材料確認の参考 | Starは少なく検証必要 |
| edinet-tools | https://github.com/matthelmer/edinet-tools | EDINET文書取得・解析 | Python | 高 | 可 | 46 | 2026-06-12 | MIT | EDINET文書タイプ解析 | 有報/決算関連の取得参考 | APIキー管理が必要 |
| edinet2dataset | https://github.com/SakanaAI/edinet2dataset | EDINETから財務データセット構築 | Python | 高 | 可 | 40 | 2026-03-06 | Apache-2.0 | データセット化 | 財務特徴量の中期候補 | バッチ処理向き |
| dexter-jp | https://github.com/edinetdb/dexter-jp | EDINET DB + J-Quantsの企業調査AI | TypeScript | 高 | OSS | 279 | 2026-06-09 | MIT | RAG型企業分析 | レポート生成設計の参考 | 外部DB前提部分に注意 |
| TradeSim | https://github.com/wabisukecx/TradeSim | 株価テクニカル分析・バックテストアプリ | Dart/Flutter | 中 | 可 | 5 | 2026-03-24 | 未確認 | 初心者向け画面 | UX参考 | ライセンス未確認 |
| kabuto | https://github.com/kokimame/kabuto | 日本株Bot/Freqtrade系 | Python | 高 | 可 | 18 | 2023-02-10 | GPL-3.0 | バックテスト/取引Bot構成 | 実装思想のみ参考 | 実売買・GPL・kabuステーション接続は採用しない |
| stocktrading | https://github.com/hajime-f/stocktrading | 機械学習応用の日本株自動売買 | Python | 高 | 可 | 9 | 2025-09-08 | NOASSERTION | ML特徴量 | ローカルML検証の参考 | 実売買系なので直接導入しない |
| jquants-pairs-trading-python | https://github.com/10mohi6/jquants-pairs-trading-python | J-Quantsペアトレード検証 | Python | 高 | 可 | 4 | 2023-10-30 | MIT | カルマンフィルタ検証 | 中長期の検証例 | デイトレ候補選定には優先度低 |
| yfinance | https://github.com/ranaroussi/yfinance | Yahoo Financeデータ取得 | Python | 中 | 可 | 24417 | 2026-06-25 | Apache-2.0 | 株価取得の汎用性 | 現行の価格取得を継続 | 非公式で欠損/変更リスク |
| ta | https://github.com/bukosabino/ta | Pandas/Numpyのテクニカル分析 | Python | 汎用 | 可 | 5100 | 2026-03-18 | MIT | 指標実装 | 指標計算の参考 | 既存計算との重複注意 |
| TA-Lib Python | https://github.com/TA-Lib/ta-lib-python | TA-Lib Pythonラッパー | Cython | 汎用 | 可 | 12067 | 2026-06-22 | BSD-2-Clause | 豊富な指標 | 将来候補 | Windows導入負荷が高い |
| backtrader | https://github.com/mementum/backtrader | バックテストライブラリ | Python | 汎用 | 可 | 22141 | 2024-08-19 | GPL-3.0 | 戦略検証 | 設計参考 | GPLと保守状況に注意 |
| backtesting.py | https://github.com/kernc/backtesting.py | 軽量バックテスト | Python | 汎用 | 可 | 8571 | 2025-12-20 | AGPL-3.0 | シンプルな検証UI | 設計参考 | AGPLのため直接組込は慎重 |
| Lightweight Charts | https://github.com/tradingview/lightweight-charts | 金融チャート表示 | TypeScript | 汎用 | 可 | 16365 | 2026-06-22 | Apache-2.0 | 高性能ローソク足 | Reactチャート改善候補 | 既存Rechartsとの移行設計が必要 |
| LightGBM | https://github.com/lightgbm-org/LightGBM | 勾配ブースティング | C++/Python | 汎用 | 可 | 18498 | 2026-06-26 | MIT | 表形式予測 | ローカルML高度化 | 過学習・説明責任に注意 |
| XGBoost | https://github.com/dmlc/xgboost | 勾配ブースティング | C++/Python | 汎用 | 可 | 28497 | 2026-06-27 | Apache-2.0 | 予測モデル比較 | 中期ML検証 | 計算負荷と説明が必要 |
| Prophet | https://github.com/facebook/prophet | 時系列予測 | Python | 汎用 | 可 | 20262 | 2026-05-08 | MIT | 季節性予測 | 出来高季節性などの研究候補 | 短期売買単体では過信不可 |

## 採用候補の優先順位

### 最優先で取り込むべきもの

- 公式/準公式データ源の見える化: J-Quants、JPX、EDINET、TDnet、yfinance、Yahoo、Stooqの出所と欠損をUIに明示。
- 取得済み材料の横断カバレッジ表示: 株価、ランキング、テクニカル、ウォークフォワード、AI検証、開示、財務。
- yfinance/J-Quants/EDINET/TDnetの失敗時に「未確認」として表示し、強い判断を出さないゲート。
- 既存ローカルMLを「検証補助」として使い、買い推奨にしない説明強化。

### 中期的に取り込むべきもの

- EDINET APIを使った財務指標のバッチ取得と銘柄別キャッシュ。
- TDnet適時開示のイベント分類と除外ルール。
- Lightweight Chartsによるローソク足と出来高の視認性改善。
- LightGBM/XGBoostのウォークフォワード比較、特徴量重要度表示。
- バックテスト結果の勝率、期待値、最大ドローダウンの銘柄別保存。

### 参考程度に留めるもの

- kabuto、stocktradingなど実売買Bot系: 実発注思想は採用しない。
- GPL/AGPLライブラリの直接組込: ライセンス影響が大きいため、設計参考に留める。
- Kabutan/Minkabu等のスクレイピング: 規約リスクがあるため、公式APIやリンク提示を優先。

## 改善方針

| 観点 | 方針 |
| --- | --- |
| データ基盤 | 無料ソースをsource registryとして整理し、UIに出所、遅延、補完、未取得を表示 |
| 銘柄スクリーニング | ランキング軸ごとに、短期上昇、値上がり率、高値更新、人気、出来高、品質、過熱注意を比較 |
| AI分析 | ローカルMLは検証補助。確率、標本数、特徴量、警告を必ず表示 |
| チャート分析 | ローソク足、出来高、移動平均、VWAP、RSI/MACDを整理 |
| ファンダメンタル | J-Quants/EDINETでPER、PBR、EPS、BPS、ROE、配当を段階導入 |
| ニュース・開示 | TDnet/EDINET/J-Quantsを材料イベントとして扱い、決算前後は注意表示 |
| ポートフォリオ | 練習注文/保有台帳は実注文と明確に分離 |
| バックテスト | ウォークフォワード、勝率、期待値、最大ドローダウンを根拠欄へ |
| UI/UX | まず「見るべき候補」「揃っている材料」「未確認リスク」を少ない項目で表示 |
| レポート生成 | ChatGPT相談用コピーを強化し、出所・未確認項目・寄り付き後方針を含める |

## 実装ロードマップ

### Phase 1: 短期改善

- データ出所ラベルと警告文の文字化け修復
- 無料リサーチ網羅度パネルの追加
- 主要価格のsource/cache/synthetic/unknown表示確認
- 高度分析画面の日本語表示修復
- Playwrightで網羅度パネルとデータ出所表示を確認

### Phase 2: 中期改善

- EDINET/TDnetの材料イベントを銘柄詳細に統合
- 財務指標カードを追加
- 銘柄比較とバックテスト結果保存
- Lightweight Charts移行のPoC
- LightGBM/XGBoostのモデル比較をローカル検証として追加

### Phase 3: 長期改善

- 決算短信RAGと企業調査レポート生成
- ニュース感情分析
- 業種別ランキングと市場地合い比較
- 投資シナリオ分析
- 初心者向け学習モード

## Codex実装タスク

| 優先度 | タスク | 目的 | 変更対象 | テスト |
| --- | --- | --- | --- | --- |
| P0 | データ出所日本語修復 | synthetic/cache誤認を防ぐ | `src/utils/dataSource.js` | UIとPlaywright |
| P0 | 無料リサーチ網羅度パネル | 判断材料の不足を一目で確認 | `src/utils/researchCoverage.js`, `src/App.jsx`, `src/index.css` | Playwright |
| P0 | 高度分析主要ラベル修復 | 文字化けによる判断不能を防ぐ | `src/App.jsx`, `src/hooks/useDashboardViewModel.js` | build/UI |
| P1 | EDINET/TDnet材料カード | 決算・開示イベントを明示 | backend material service, DetailPanels | Python unittest |
| P1 | 財務指標カード | PER/PBR/ROE/配当を表示 | backend J-Quants/EDINET, frontend | unit/UI |
| P1 | バックテスト保存 | 検証結果を候補ごとに比較 | backend advanced analysis, frontend | unittest |
| P2 | Lightweight Charts PoC | チャート視認性改善 | chart component | visual regression |
| P2 | LightGBM/XGBoost比較 | ML検証を高度化 | backend ML module | walk-forward test |

## 優先順位付きToDo

- P0: データ出所表示の日本語修復
- P0: 無料リサーチ網羅度パネル
- P0: 高度分析画面の主要ラベル修復
- P0: Playwrightで表示回帰確認
- P1: EDINET/TDnet材料確認の統合強化
- P1: 財務指標カード
- P1: バックテスト結果の保存/比較
- P2: Lightweight Charts検証
- P2: MLモデル比較

## 注意

- 実注文機能は追加しない。
- 予測やAI出力は投資助言ではなく検証補助として扱う。
- synthetic/cacheは投資判断に使わない旨を表示する。
- スクレイピングは規約リスクがあるため、公式API、公開CSV、リンク提示を優先する。

## 追加実装: 開示・決算チェック

P0追加として、高度分析画面に「開示・決算チェック」パネルを追加した。

### 実装内容

- `src/utils/disclosureEvents.js` を追加し、銘柄コード正規化、開示イベント分類、注意度分類、EDINET/TDnet/J-Quants/キャッシュの取得状況整理を実装。
- 高度分析画面で、総合ステータス、注意度、直近イベント、データ取得状況、一次情報確認の注意文を表示。
- 業績修正、配当修正、自社株買い、大量保有報告、有価証券報告書、四半期報告書、臨時報告書などを分類。
- EDINET APIキー未設定、TDnetデータ未取得、J-Quants未取得、キャッシュ利用を画面上で明示。
- 売買推奨ではなく、確認推奨、注意、材料あり、一次情報確認、リスク確認、判断保留の文脈に限定。

## 追加実装: EDINET実取得の第1段階

P1として、EDINET APIキー設定時に前日引け後〜当日朝の提出書類一覧を取得し、選択銘柄の証券コードに一致する書類を「開示・決算チェック」へ統合した。

### 実装内容

- `backend/edinet_api_service.py` と `/api/research/edinet/documents` を追加し、バックエンド経由でEDINET APIキー取得、日付別取得、期間取得、提出書類正規化を実装。
- `src/utils/edinetClient.js` を追加し、フロントからバックエンドEDINETプロキシを呼び出す薄い取得クライアントを実装。
- `src/utils/disclosureEvents.js` にEDINET文書分類、注意度分類、証券コード一致のイベント生成、寄り付き前チェック期間の生成を追加。
- 高度分析画面で、EDINET最終確認、対象期間、照合方法を表示。
- APIキー未設定時は通信せず「APIキー未設定」と表示し、画面を落とさない。
- `secCode` がない書類は社名推定で無理に銘柄へ結び付けず、照合不可として扱う。
- 大量保有報告、変更報告、公開買付届出書、意見表明報告書、臨時報告書を確認注意の高い材料として扱う。

### 残る制約

- 推奨設定はバックエンドの `EDINET_API_KEY`。`VITE_EDINET_API_KEY` はブラウザに渡るため、検証用途に限定。
- 日本の祝日判定は未実装。現状は週末を考慮した前営業日相当の簡易期間に限定。
- TDnetは公式の安定無料APIが限られるため、規約リスクのあるスクレイピングは行わず、既存の無料RSS・キャッシュ・手動データ相当の情報のみ扱う。
- J-Quantsは既存の読み取り専用連携を利用し、未設定時は未取得として表示する。

### 次の改善候補

- EDINET API実取得をバックエンドプロキシ化し、APIキーをブラウザへ出さない。
- TDnet公式・代替データ取得方法の再調査。
- 決算カレンダー連携。
- 寄り付き前チェックリストへの材料イベント統合。
- 前日引け後の重要開示検出。
- 日本の祝日カレンダーを使った対象期間補正。
- 銘柄ウォッチリストとの連動。
- ChatGPT相談用プロンプトへの開示・決算チェック結果の追加。
- AI要約の根拠表示強化。

## 追加実装: 寄り付き前チェックと決算カレンダー土台

P1.5として、EDINET実取得後の次工程である「決算カレンダー連携の土台」と「日本営業日カレンダー」を追加した。

### 実装内容

- `src/data/japanHolidays.json` を追加し、2026年分の日本祝日を手動管理できるようにした。
- `src/utils/japanBusinessCalendar.js` を追加し、土日、祝日、年末年始、前営業日、次営業日、寄り付き前確認対象期間を判定。
- `backend/earnings_calendar_service.py` と `/api/research/earnings-calendar` を追加し、決算予定データの読み取り専用API土台を実装。
- `src/utils/earningsCalendarClient.js` を追加し、決算予定の正規化、銘柄照合、取得状況、寄り付き前チェック表示モデルを実装。
- 高度分析画面に「寄り付き前チェック」を追加し、対象日、営業日判定、前営業日、確認対象期間、EDINET確認、決算予定確認、決算予定一覧を表示。
- 決算予定データが未取得の場合は「J-Quants API未設定」「決算予定データは未取得」と明示。
- 手動JSONを使う場合は「手動データ」と明示し、架空データを実データのように扱わない。

### 残る制約

- 祝日データは2026年の手動JSON。対象年がない場合は「祝日データ未設定」と表示する。
- J-Quants決算予定の実取得は未接続。APIキーがある場合も、決算予定APIとしての実装は次工程。
- TDnet相当データは有料・規約面の制約があるため、規約リスクのあるスクレイピングは行わない。

### 次の改善候補

- J-Quants決算予定の実取得強化。
- TDnetアドオン利用時の設計。
- 前日引け後のTDnet重要開示確認。
- ウォッチリスト銘柄の一括寄り付き前チェック。
- ChatGPT相談用プロンプトへの自動挿入。
- 重要開示のAI要約。
