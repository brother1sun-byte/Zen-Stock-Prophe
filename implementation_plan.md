# Implementation Plan: Phase 2 Refined & Autonomous Execution

## Goal
Phase 2 の実装を洗練させ、長期運用に耐えうる堅牢なバックエンドを構築する。特にデータ欠損時の弾力性、判定基準の再現性、後方互換性、およびキャッシュ戦略に重点を置く。

## User Review Required
> [!IMPORTANT]
> - `/api/playbook` は初期段階としてサーバー上のファイル（JSON）で永続化し、ファイルロックによる排他制御を行います。
> - ロット自動半減は「新規エントリー」のみを対象とし、既存ポジションの利確・損切りは制限しません。

## Proposed Changes

### 1. Backend Data Models (`backend/main.py`)
- **[MODIFY] `PredictionResponse`**:
    - `long_term_snapshot`, `event_risk`, `concentration_risk`: 全て `Optional` でデフォルト `None`。
    - **[NEW]** `partial: bool = False` 追加。
    - **[NEW]** `missing_fields: List[str] = []` 追加。
- **[MODIFY] `PlaybookEntry`**:
    - `version`, `created_at`, `asof`, `tags`, `market_regime` を追加。

### 2. API エンドポイント & ロジック
- **[MODIFY] 設定値の外部化**:
    - 相関閾値（0.8）、セクター偏り閾値（60%）、イベント窓（7日）を定数または環境変数として定義し、後方から調整可能にする。
- **[MODIFY] `asof` 引数への対応**:
    - `/api/fundamentals`, `/api/events`, `/api/correlation` に `asof: Optional[str] = None` (JST, YYYY-MM-DD) を追加。
    - 指定がない場合は現在時刻（JST）を基準。判定は暦日7日以内。
- **[MODIFY] キャッシュ戦略 (`TwoLayerCache`)**:
    - Fundamentals/Events: 24時間。
    - Correlation: 1h。
    - キャッシュキーには `ticker` と `asof` を含める。
- **[MODIFY] 相関検知 (`GET /api/correlation`)**:
    - 高相関警告（>0.8）はスコア順上位3件に制限。
    - セクター比率が60%以上の場合のみ警告を生成。
- **[MODIFY] Playbook 永続化**:
    - `PLAYBOOK_FILE` への書き込み時にファイルロック（`portalocker` 等のライブラリまたは標準ライブラリの `msvcrt.locking`）を使用。
    - `version: "1.0"` を含め、将来のスキーマ変更に対応。

### 3. 分析ロジックの拡張
- **[MODIFY] ロット自動制限 (calculate_day_trading_signals)**:
    - **新規エントリーのみ制限**: `is_exit_order` フラグ（または既存ポジションの処理）を考慮し、利確・損切りは制限しない。
    - **優先順位**: `PANIC` > `HIGH VOLATILITY` > `EVENT RISK` の順で適用。パニック時は「新規禁止」メッセージを優先。
- **[MODIFY] `calculate_day_trading_signals`**:
    - 引数に `asof` を追加。
    - **ロット制限**: 新規注文のみに適用。`PANIC` または `HIGH VOLATILITY` 時は「新規禁止」を優先。
    - イベントリスク（決算直前）による半減ルールを詳細化。
- **[MODIFY] `get_analyst_report`**:
    - イベントリスクセクションに「新規エントリー制限」の背景と適用条件を明記。
    - データ取得失敗時は「データ欠損により一部推論を含む（partial）」旨の注釈を自動挿入。

### 4. Data Ingestion (`backend/data_ingestion.py`)
- **[MODIFY] `fetch_calendar_events`**: `asof` 基準での将来イベント抽出に対応。
- **[MODIFY] エラーハンドリング**: データ取得不可時に例外ではなく `None` または空データを返し、呼び出し側に委ねる。

### 5. Unified Testing (`backend/tests/test_phase2.py`) [NEW]
- **導線統一**: `FastAPI TestClient` を使用し、エンドポイントからビジネスロジックまで一気通貫で検証。
- **後方互換検証**: 旧バージョンのクライアントが期待するフィールドが欠けないことを確認。
- **OpenAPI スキーマ**: 自動生成されるスキーマを確認し、破壊的変更がないかチェック。

## Acceptance Criteria (受け入れ条件)

- **A. 旧レスポンスのクライアントが壊れない**: 既存フィールドの破壊的変更をゼロに保つ。
- **B. データ欠損でもAPIが500にならず部分返却できる**: `partial: true` と `missing_fields` で安全にフォールバック。
- **C. events の判定が asof JST 基準で再現できる**: 暦日7日間の正確な判定。
- **D. 警告は上位表示に制限され過剰にならない**: 高相関ペア上位3件、セクター偏り60%超。
- **E. playbook が永続化され再起動後も残る**: JSONファイルへの堅牢な保存。
- **F. 新規APIがキャッシュされ速度劣化がない**: `TwoLayerCache` によるレスポンス高速化。

## Verification Plan

### Automated Tests
- [run command] `python -m backend.tests.test_phase2`
- **項目**:
    1.  API レスポンスのフィールド欠損がないこと（後方互換性）。
    2.  `asof` 指定による再現可能なイベント判定。
    3.  プレイブックの同時書き込み耐性。
    4.  キャッシュヒット時のレスポンス。

### Manual Verification
- `walkthrough.md` を更新し、ロット制限の例外ルール（新規のみ）と `partial` 仕様について明記。
