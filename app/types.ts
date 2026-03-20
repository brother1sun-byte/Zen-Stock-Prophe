// API レスポンス型定義
// フロントエンドとバックエンドで共通使用

export interface PredictionResponse {
    // 基本情報
    ticker: string;
    company_name: string;
    current_price: number;
    price_change: number;
    price_change_percent: number;

    // 予測・分析結果 (Backend API準拠)
    forecasts: Record<string, number>;
    volatility: number;
    confidence_score: number;
    sentiment_score: number;
    recommendation: string;
    reasoning: string;

    // 四本値
    open_price: number;
    high_price: number;
    low_price: number;
    close_price: number;

    // テクニカル指標 (Backend API準拠)
    technical_indicators: {
        sma_5: number;
        sma_20: number;
        rsi: number;
        macd: number;
        bollinger_upper: number;
        bollinger_lower: number;
    };

    // デイトレードシグナル (Phase 2)
    day_trading?: {
        signal: string;
        entry_price: number;
        stop_loss: number;
        take_profit: number;
        decision: string;
        super_score: number;
        final_action_line: string;
        lot_management: {
            shares: number;
            target_price: number;
            stop_price: number;
        };
        // Legacy/DayTrading Ext
        order_flow?: {
            bias_jp?: string;
        };
        regime_info?: {
            regime?: string;
        };
        reasoning_list?: string[];


        explanations?: {
            technical_reasons?: string[];
            fundamental_reasons?: string[];
        };

        // Scorecard for Visualization (v8.0)
        scorecard?: {
            regime: ScorecardItem;
            trend: ScorecardItem;
            volume: ScorecardItem;
            risk: ScorecardItem;
            data_quality: ScorecardItem;
        };
    };

    // メタデータ
    model_name: string;
    prediction_date: string;

    // トレードシナリオ (Phase 3)
    trade_scenarios?: ScenarioRuleSet;
    market_regime?: string; // "range", "trend_up", "trend_down"

    // マクロ分析 (Phase 3.2)
    macro_analysis?: {
        trend: string;      // "bullish" | "bearish" | "neutral"
        score: number;      // -100 to 100
        summary: string;    // 要約テキスト
    };

    // Phase 3.2 Additions
    // Phase 3.2 Additions
    long_term_snapshot?: LongTermSnapshot;
    event_risk?: EventRisk; // Changed from array to object to match WeekendPlanSection usage
    concentration_risk?: ConcentrationRisk;
    macro_snapshot?: MacroSnapshot;
    playbook_references?: PlaybookEntry[];
    partial?: boolean;
    missing_fields?: string[];

    // Technical Analysis (Merged)
    technical_analysis?: {
        market_phase?: {
            is_open: boolean;
            label?: string;
            detail?: string;
            risk?: string;
        };
    };

    // 直近5日間の価格データ (チャート用)
    recent_prices: {
        date: string;
        price: number;
    }[];

    // Compatibility for useStockData / dateUtils
    asof?: string;
    last_sync?: string;
    fetch_errors?: Record<string, string>;
    chart_data?: ChartDataPoint[];
    beginner_judgment?: BeginnerJudgment;
}

export interface BeginnerJudgment {
    verdict: string;
    sign: string;
    color: string;
    description: string;
    summary: string;
    points: string[];
}


export interface ChartDataPoint {
    name: string;
    price: number;
    ma5?: number;
    ma25?: number;
    volume?: number;
}

export interface ScorecardItem {
    status: string; // OK | Caution | NG
    label: string;
    value: string;
    reason: string;
}

// --- Phase 3: Scenario & Rules ---

// --- Phase 3: Scenario & Rules ---

export interface ScenarioRule {
    entry_condition: string;
    take_profit: string;
    stop_loss: string;
    lot_cap: string;
    no_trade_condition: string;
    note: string;
}

export interface ScenarioRuleSet {
    version: string;
    ticker: string;
    asof: string;
    created_at: string;
    updated_at: string;
    rules_gap_up: ScenarioRule;
    rules_gap_down: ScenarioRule;
    rules_range: ScenarioRule;
}

export interface ScenarioEvaluationResult {
    ticker?: string;
    asof?: string;
    scenario?: "gap_up" | "gap_down" | "range";
    action?: "buy" | "sell" | "wait";
    reason?: string;
    plan?: {
        entry_price?: number;
        stop_loss?: number;
        take_profit?: number;
    };
    recommended_action?: string;
    scenario_type?: string;
    ok?: boolean;
    warnings?: string[];
    updated_at?: string;
}

// --- Phase 3.2: Macro Snapshot ---

export interface MacroSnapshot {
    asof: string;
    trend: string;      // "bullish" | "bearish" | "neutral"
    score: number;      // -100 to 100
    indicators: {
        nikkei_225: { price: number; change_percent: number; trend: string };
        usmjqy: { price: number; change_percent: number; trend: string }; // USD/JPY
        topix: { price: number; change_percent: number; trend: string };
        growth_250: { price: number; change_percent: number; trend: string };
    };
    summary: string;
    updated_at: string;
    vix?: number;
    partial?: boolean;
    missing_fields?: string[];


    // Flat fields for UI
    nikkei?: number;
    topix?: number;
    usdjpy?: number;
    us10y?: number;
    risk_sentiment?: string;

    // User Def
    us_2y?: number;
    oil?: number;
    sp500?: number;
}

// --- Phase 3.2: Additional Types for Weekend Plan ---

export interface LongTermSnapshot {
    weekly_trend?: string;
    monthly_trend?: string;
    major_support?: number;
    major_resistance?: number;
    updated_at?: string;
    profitability?: {
        roe?: number;
        operating_margin?: number;
        revenue_growth?: number;
    };
    safety?: {
        equity_ratio?: number;
        debt_to_equity?: number;
        net_debt?: number;
        interest_bearing_debt?: number;
    };
    shareholder_returns?: {
        dividend_yield?: number;
        payout_ratio?: number;
    };
    valuation?: {
        per?: number;
        pbr?: number;
        band?: string;
    };
    valuation_band?: {
        per?: number;
        pbr?: number;
        status?: string;
    };
    warnings?: string[];
}

export interface EventRisk {
    id?: string;
    date?: string;
    title?: string;
    impact?: "High" | "Medium" | "Low";

    // User Def & WeekendPlanSection
    earnings_date?: string;
    ex_dividend_date?: string;
    is_imminent_earnings?: boolean;
    days_to_earnings?: number;
    warnings?: string[];
    upcoming_events?: {
        type: string;
        date: string;
        days_left: number;
    }[];
}

export interface ConcentrationItem {
    sector: string;
    weight: number;
    status: "Safe" | "Warning" | "Danger";
}

export interface CorrelationItem {
    pair: string;
    correlation: number;
}

export interface ConcentrationRisk {
    sector_breakdown?: ConcentrationItem[];
    correlation_report?: CorrelationItem[];

    // User Def
    sector_bias?: {
        sector?: string;
        count?: number;
        ratio?: number;
    }[];
    correlated_pairs?: {
        a: string;
        b: string;
        corr: number;
    }[];
    sector_distribution?: Record<string, number>;
    warnings?: string[];
}

export interface PlaybookEntry {
    id: string;
    title: string;
    description: string;
    win_rate: number;

    // User Def
    ticker?: string;
    asof?: string;
    scenario?: string;
    outcome?: string;
    lesson?: string;
    created_at?: string;
}

// --- Phase 4: Diary & Scoring ---

export interface DiaryEntry {
    version: string;
    id: string;
    created_at: string;
    date: string;           // YYYY-MM-DD
    ticker: string;
    scenario_type: "gap_up" | "gap_down" | "range";
    planned_action: string;
    actual_action: string;
    result: "win" | "loss" | "flat" | "skip";
    pnl_yen?: number;
    notes?: string;
}

export interface PostDiaryRequest {
    date: string;
    ticker: string;
    scenario_type: string;
    planned_action: string;
    actual_action: string;
    result: string;
    pnl_yen?: number;
    notes?: string;
}

export interface GetDiaryResponse {
    ok: boolean;
    ticker?: string;
    count: number;
    items: DiaryEntry[];
}

export interface ScenarioScore {
    ok: boolean;
    ticker: string;
    period: string; // "weekly", "monthly"
    period_start: string;
    period_end: string;

    total_entries: number;
    total_trades: number;
    win_count: number;
    loss_count: number;
    flat_count: number;
    skip_count: number;

    win_rate: number;
    execution_rate: number;
    skip_rate: number;

    updated_at: string;

    // Partial data handling
    asof?: string;
    last_sync?: string;
    partial?: boolean;
    missing_fields?: string[];
}

export interface RuleMetrics {
    total_entries: number;
    total_trades: number;
    win_count: number;
    loss_count: number;
    flat_count: number;
    skip_count: number;

    win_rate: number;
    execution_rate: number;
    skip_rate: number;
}

export interface AggregateScoringResponse {
    ok: boolean;
    period: string;
    period_start: string;
    period_end: string;

    tickers_count: number;

    total_entries: number;
    total_trades: number;
    win_count: number;
    loss_count: number;
    flat_count: number;
    skip_count: number;

    win_rate: number;
    execution_rate: number;
    skip_rate: number;

    per_ticker: {
        ticker: string;
        total_trades: number;
        win_rate: number;
        execution_rate: number;
    }[];

    updated_at: string;

    asof?: string;
    last_sync?: string;
    partial?: boolean;
    missing_fields?: string[];
}

export interface RuleScoringResponse {
    ok: boolean;
    period: string;
    period_start: string;
    period_end: string;
    rules: {
        gap_up: RuleMetrics;
        gap_down: RuleMetrics;
        range: RuleMetrics;
    };
    updated_at: string;
}

export interface PortfolioResponse {
    ok: boolean;
    tickers: string[];
    updated_at: string;
    partial?: boolean;
    missing_fields?: string[];
}

export interface PortfolioRequest {
    tickers: string[];
}

export interface DateUtils {
    getLatestTradingDate: (data: PredictionResponse) => string;
    isJstMarketOpen: () => boolean;
}

export interface WeeklyReviewResponse {
    ok: boolean;
    total_entries: number;
    executed_trades: number;
    win_rate: number;
    execution_rate: number;
    best_trade: number;
    worst_trade: number;
    notes: string[];
    is_partial?: boolean;
    partial?: boolean;
    missing_fields?: string[];
    asof?: string;
    last_sync?: string;
    updated_at?: string;
}

export interface ZenSignal {
    ticker: string;
    analysis: {
        values: {
            close: number;
            rsi: number;
            sma_25: number;
            sma_75: number;
            vol_avg_20: number;
            vol_today: number;
        };
        conditions: {
            trend_up: boolean;
            price_above_ma: boolean;
            rsi_range: boolean;
            rsi_up: boolean;
            vol_spike: boolean;
        };
        advanced?: {
            bb_squeeze: boolean;
            consecutive_positive: boolean;
            consecutive_days: number;
        };
        risk_mgmt: {
            stop_loss: number;
            target_price_1: number;
            target_price_2: number;
        };
    };
}

export interface MarketRanking {
    top_gainers: RankingItem[];
    top_losers: RankingItem[];
}

export interface RankingItem {
    ticker: string;
    name: string;
    price: number;
    change_percent: number;
}
