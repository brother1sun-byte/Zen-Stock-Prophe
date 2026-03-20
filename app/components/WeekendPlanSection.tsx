"use client";

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    ShieldCheck,
    Target,
    BookOpen,
    PieChart,
    BarChart3,
    Calendar,
    History,
    Save,
    Loader2,
    CheckCircle2,
    XCircle,
    Play,
    BrainCircuit,
    Globe
} from 'lucide-react';
import { PredictionResponse, LongTermSnapshot, EventRisk, ConcentrationRisk, PlaybookEntry, ScenarioRuleSet, ScenarioEvaluationResult, MacroSnapshot, DiaryEntry, ScenarioScore, PostDiaryRequest, AggregateScoringResponse, RuleScoringResponse, PortfolioResponse, PortfolioRequest, WeeklyReviewResponse } from '../types';
import { getScenario, saveScenario, evaluateScenario, getMacroSnapshot, saveDiaryEntry, fetchDiaryEntries, getScenarioScore, getAggregateScoring, getRuleScoring, fetchPortfolio, savePortfolio, fetchWeeklyReview } from '../utils/api';
import { getLatestTradingDate, isJstMarketOpen } from '../utils/dateUtils';
import { translateMissingField } from '../utils/formatUtils';

interface WeekendPlanSectionProps {
    data: PredictionResponse;
}

const DEFAULT_RULE_SET = (ticker: string, asof: string): ScenarioRuleSet => ({
    version: "1.0",
    ticker,
    asof,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    rules_gap_up: { entry_condition: "", take_profit: "", stop_loss: "", lot_cap: "100", no_trade_condition: "", note: "" },
    rules_gap_down: { entry_condition: "", take_profit: "", stop_loss: "", lot_cap: "100", no_trade_condition: "", note: "" },
    rules_range: { entry_condition: "", take_profit: "", stop_loss: "", lot_cap: "100", no_trade_condition: "", note: "" },
});

export const WeekendPlanSection: React.FC<WeekendPlanSectionProps> = ({ data }) => {
    // Basic State
    const [isOpen, setIsOpen] = useState(() => {
        if (data.technical_analysis?.market_phase) {
            return !data.technical_analysis.market_phase.is_open;
        }
        return !isJstMarketOpen();
    });
    const [activeTab, setActiveTab] = useState<'snapshot' | 'risk' | 'playbook' | 'diary' | 'portfolio'>('snapshot');

    // Hardened asof logic
    const asofStr = getLatestTradingDate(data);
    const { long_term_snapshot, event_risk, concentration_risk, playbook_references, partial, missing_fields } = data;

    // --- Phase 3.1: Scenario Engine State ---
    const [scenarioRules, setScenarioRules] = useState<ScenarioRuleSet>(DEFAULT_RULE_SET(data.ticker, asofStr));
    const [evaluationResult, setEvaluationResult] = useState<ScenarioEvaluationResult | null>(null);
    const [isLoadingScenario, setIsLoadingScenario] = useState(false);
    const [isSavingScenario, setIsSavingScenario] = useState(false);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [scenarioSaveMsg, setScenarioSaveMsg] = useState<string | null>(null);

    // --- Phase 3.2: Macro Snapshot State ---
    const [macroData, setMacroData] = useState<MacroSnapshot | null>(null);
    const [isLoadingMacro, setIsLoadingMacro] = useState(false);

    // --- Phase 4.1: Diary State ---
    const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);
    const [isSavingDiary, setIsSavingDiary] = useState(false);
    const [isLoadingDiary, setIsLoadingDiary] = useState(false);
    const [newDiary, setNewDiary] = useState<Partial<DiaryEntry>>({
        date: new Date().toISOString().split('T')[0],
        scenario_type: 'range',
        result: 'skip',
        planned_action: '',
        actual_action: '',
        notes: ''
    });

    const [scoring, setScoring] = useState<ScenarioScore | null>(null);
    const [isLoadingScoring, setIsLoadingScoring] = useState(false);
    const [diaryError, setDiaryError] = useState<string | null>(null);
    const [diaryStatusMsg, setDiaryStatusMsg] = useState<string | null>(null);

    // --- Phase 4.3: Portfolio Scoring State ---
    const [portfolioTickers, setPortfolioTickers] = useState<string>(data.ticker); // Comma separated tickers
    const [savedPortfolio, setSavedPortfolio] = useState<string[]>([]);
    const [isSavingPortfolio, setIsSavingPortfolio] = useState(false);
    const [portfolioUpdatedAt, setPortfolioUpdatedAt] = useState<string | null>(null);
    const [aggregateScoring, setAggregateScoring] = useState<AggregateScoringResponse | null>(null);
    const [isLoadingAggregate, setIsLoadingAggregate] = useState(false);
    const [ruleScoring, setRuleScoring] = useState<RuleScoringResponse | null>(null);
    const [isLoadingRuleScoring, setIsLoadingRuleScoring] = useState(false);

    // --- Phase 4.5: Weekly Review State ---
    const [weeklyReview, setWeeklyReview] = useState<WeeklyReviewResponse | null>(null);
    const [isLoadingReview, setIsLoadingReview] = useState(false);

    // --- Phase 7: Freshness Logic ---
    const dataStatus = useMemo(() => {
        if (!data.last_sync) return 'PARTIAL';
        try {
            const lastSync = new Date(data.last_sync.replace(' ', 'T'));
            const now = new Date();
            const diffMin = (now.getTime() - lastSync.getTime()) / (1000 * 60);

            // Basic Market Hours (JST parity)
            const hour = now.getHours();
            const day = now.getDay(); // 0=Sun, 6=Sat
            const isMarketClosed = day === 0 || day === 6 || hour < 9 || hour >= 15;

            const threshold = isMarketClosed ? 24 * 60 : 30; // 24h vs 30m

            if (diffMin > threshold) return 'STALE';
            return partial ? 'PARTIAL' : 'OK';
        } catch (e) {
            return 'PARTIAL';
        }
    }, [data.last_sync, partial]);

    // Load Core Data on Mount/Asof Change
    useEffect(() => {
        let mounted = true;
        const loadCoreData = async () => {
            // Load Scenario
            setIsLoadingScenario(true);
            const loadedScenario = await getScenario(data.ticker, asofStr);
            if (mounted && loadedScenario) setScenarioRules(loadedScenario);
            setIsLoadingScenario(false);

            // Load Macro
            setIsLoadingMacro(true);
            const loadedMacro = await getMacroSnapshot(asofStr);
            if (mounted && loadedMacro) setMacroData(loadedMacro);
            setIsLoadingMacro(false);

            // Silent load of portfolio for Phase 4.5 Reflect buttons
            fetchPortfolio().then(pData => {
                if (mounted && pData && pData.tickers) {
                    setSavedPortfolio(pData.tickers);
                }
            });
        };
        loadCoreData();
        return () => { mounted = false; };
    }, [data.ticker, asofStr]);

    // Phase 4.1: Load Diary and Single Scoring when active
    useEffect(() => {
        if (activeTab === 'diary') {
            setIsLoadingDiary(true);
            fetchDiaryEntries(data.ticker, 10).then(entries => {
                setDiaryEntries(entries);
                setIsLoadingDiary(false);
            });
            setIsLoadingScoring(true);
            getScenarioScore(data.ticker).then(score => {
                setScoring(score);
                setIsLoadingScoring(false);
            });
        }
    }, [activeTab, data.ticker]);

    // Phase 4.3: Load Aggregate & Rule Scoring when relevant tabs are active
    useEffect(() => {
        if (activeTab === 'diary' || activeTab === 'portfolio') {
            if (portfolioTickers) {
                setIsLoadingAggregate(true);
                getAggregateScoring(portfolioTickers).then(agg => {
                    setAggregateScoring(agg);
                    setIsLoadingAggregate(false);
                });

                setIsLoadingRuleScoring(true);
                getRuleScoring(portfolioTickers).then(rule => {
                    setRuleScoring(rule);
                    setIsLoadingRuleScoring(false);
                });
            }
        }
    }, [activeTab, portfolioTickers]);

    useEffect(() => {
        if (activeTab === 'portfolio') {
            fetchPortfolio().then(data => {
                if (data && data.tickers) {
                    setSavedPortfolio(data.tickers);
                    setPortfolioTickers(data.tickers.join(', '));
                    setPortfolioUpdatedAt(data.updated_at);
                }
            });
        }
    }, [activeTab]);

    // Phase 4.5: Weekly Review Data
    useEffect(() => {
        if (activeTab === 'diary' || activeTab === 'portfolio') {
            setIsLoadingReview(true);
            const to = new Date().toISOString().split('T')[0];
            const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const tickers = portfolioTickers || (savedPortfolio.length > 0 ? savedPortfolio.join(',') : '');

            fetchWeeklyReview(tickers, from, to).then(res => {
                setWeeklyReview(res);
                setIsLoadingReview(false);
            });
        }
    }, [activeTab, portfolioTickers, savedPortfolio]);

    const reflectPortfolio = () => {
        if (savedPortfolio.length > 0) {
            setPortfolioTickers(savedPortfolio.join(', '));
        }
    };

    // Handlers
    const handleRuleChange = (scenario: 'rules_gap_up' | 'rules_gap_down' | 'rules_range', field: string, value: string) => {
        setScenarioRules(prev => ({
            ...prev,
            [scenario]: { ...prev[scenario], [field]: value }
        }));
    };

    const onSaveScenario = async () => {
        if (isSavingScenario) return;
        setIsSavingScenario(true);
        setScenarioSaveMsg(null);
        const toSave = { ...scenarioRules, updated_at: new Date().toISOString() };
        const success = await saveScenario(toSave);
        if (success) {
            setScenarioRules(toSave);
            setScenarioSaveMsg("保存しました (Saved)");
            setTimeout(() => setScenarioSaveMsg(null), 3000);
        } else {
            setScenarioSaveMsg("保存失敗 (Failed)");
        }
        setIsSavingScenario(false);
    };

    const onEvaluate = async () => {
        if (isEvaluating) return;
        setIsEvaluating(true);
        const prevClose = data.close_price || data.current_price;
        const openPrice = data.open_price || data.current_price;
        const regime = macroData?.vix && macroData.vix > 20 ? "HIGH_VOLATILITY" : "NORMAL";

        const res = await evaluateScenario(
            data.ticker,
            asofStr,
            data.current_price,
            openPrice,
            prevClose,
            scenarioRules,
            regime
        );
        setEvaluationResult(res);
        setIsEvaluating(false);
    };

    const onSaveDiary = async () => {
        if (isSavingDiary) return;
        if (!newDiary.planned_action || !newDiary.actual_action) {
            setDiaryError("作戦と行動を入力してください");
            return;
        }

        setIsSavingDiary(true);
        setDiaryError(null);
        setDiaryStatusMsg(null);

        const entry: PostDiaryRequest = {
            ticker: data.ticker,
            date: newDiary.date || asofStr,
            scenario_type: (newDiary.scenario_type as any) || 'range',
            planned_action: newDiary.planned_action,
            actual_action: newDiary.actual_action,
            result: (newDiary.result as any) || 'skip',
            notes: newDiary.notes || '',
            pnl_yen: newDiary.pnl_yen || 0,
        };

        const success = await saveDiaryEntry(entry);
        if (success) {
            setDiaryStatusMsg("保存しました (Saved)");
            const loaded = await fetchDiaryEntries(data.ticker, 10);
            setDiaryEntries(loaded);
            // Reset fields except date
            setNewDiary(prev => ({
                ...prev,
                planned_action: '',
                actual_action: '',
                notes: '',
                pnl_yen: 0
            }));
            setTimeout(() => setDiaryStatusMsg(null), 3000);
        } else {
            setDiaryError("保存に失敗しました (Failed)");
        }
        setIsSavingDiary(false);
    };

    const onRefreshPortfolio = async () => {
        if (!portfolioTickers) return;
        setIsLoadingAggregate(true);
        setIsLoadingRuleScoring(true);
        const [agg, rule] = await Promise.all([
            getAggregateScoring(portfolioTickers),
            getRuleScoring(portfolioTickers)
        ]);
        setAggregateScoring(agg);
        setRuleScoring(rule);
        setIsLoadingAggregate(false);
        setIsLoadingRuleScoring(false);
    };

    const onSavePortfolio = async () => {
        setIsSavingPortfolio(true);
        const tickers = portfolioTickers.split(',').map(t => t.trim()).filter(Boolean);
        const success = await savePortfolio(tickers);
        if (success) {
            setPortfolioUpdatedAt(new Date().toISOString());
        }
        setIsSavingPortfolio(false);
    };

    useEffect(() => {
        if (activeTab === 'portfolio') {
            fetchPortfolio().then(data => {
                if (data && data.tickers) {
                    setSavedPortfolio(data.tickers);
                    setPortfolioTickers(data.tickers.join(', '));
                    setPortfolioUpdatedAt(data.updated_at);
                }
            });
        }
    }, [activeTab]);

    // Recommendation Logic (Phase 4.3)
    const recommendation = useMemo(() => {
        if (!ruleScoring || !aggregateScoring) return "分析データが不足しています (Data missing)";

        const rules = ruleScoring.rules;
        const messages: string[] = [];

        if (rules.gap_up.total_entries > 0 && rules.gap_up.execution_rate < 0.5) {
            messages.push("上窓 (gap_up) の実行率が低いため、寄り付きのエントリールールを簡素化してチャンスを逃さないようにしてください。");
        }
        if (rules.range.total_entries > 0 && rules.range.win_rate > 0.65) {
            messages.push("レンジ相場での勝率が非常に高いため、現在のロットを維持しつつ、利益を伸ばす方針を継続してください。");
        }
        if (aggregateScoring.total_trades > 5 && aggregateScoring.win_rate < 0.4) {
            messages.push("全体の勝率が低迷しています。一旦ロットを1/2に制限し、確度の高いセットアップに絞り込む時期かもしれません。");
        }

        if (messages.length === 0) {
            return "現在の規律を維持し、安定したエントリーを継続してください。 (Maintain discipline)";
        }
        return messages[0]; // Return the most critical/first one
    }, [ruleScoring, aggregateScoring]);

    // Derived
    const isMarketOpen = data.technical_analysis?.market_phase?.is_open || isJstMarketOpen();

    const topCorrelationPairs = useMemo(() => {
        if (!concentration_risk?.correlation_report) return [];
        return [...concentration_risk.correlation_report]
            .sort((a, b) => b.correlation - a.correlation)
            .slice(0, 3);
    }, [concentration_risk]);

    return (
        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-xl overflow-hidden shadow-2xl" id="weekend-plan" data-testid="weekend-plan-section">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-800/30 transition-all group"
                data-testid="weekend-plan-toggle"
                aria-expanded={isOpen}
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/10 rounded-lg group-hover:bg-indigo-500/20 transition-colors">
                        <ShieldCheck className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                            ディフェンシブ・プレイブック (Weekend Plan)
                            <span className="text-[10px] text-slate-400 font-normal ml-2" data-testid="weekend-plan-asof">基準日: {asofStr}</span>
                            {data.last_sync && <span className="text-[9px] text-slate-500 font-normal" data-testid="weekend-plan-last-sync">({data.last_sync})</span>}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${dataStatus === 'OK' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                                dataStatus === 'STALE' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' :
                                    'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                }`} data-testid="data-status-indicator">
                                {dataStatus === 'OK' ? 'データ状態: OK' : dataStatus === 'STALE' ? 'データ状態: STALE (古い) ➔ npm run up を実行してください' : 'データ状態: PARTIAL'}
                            </span>
                        </h3>
                        <p className="text-xs text-slate-500 text-left">長期トレンド、重要イベント、及びデイリーシナリオの統合管理</p>
                    </div>
                </div>
                {isOpen ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
            </button>

            {isOpen && (
                <div className="border-t border-slate-800">
                    {/* Navigation Tabs */}
                    {partial && (
                        <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-3" data-testid="weekend-plan-partial-banner">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            <div className="text-[11px] text-amber-200" data-testid="weekend-plan-missing-fields">
                                一部データが取得できませんでした: {missing_fields?.map(translateMissingField).join(', ')}
                                {data.fetch_errors && Object.keys(data.fetch_errors).length > 0 && (
                                    <span className="ml-2 text-[10px] opacity-70">(理由: {Object.values(data.fetch_errors)[0]})</span>
                                )}
                            </div>
                        </div>
                    )}
                    <div className="flex p-1 bg-slate-950/50 border-b border-slate-800 gap-1">
                        <button
                            onClick={() => setActiveTab('snapshot')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-all ${activeTab === 'snapshot' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                            data-testid="tab-snapshot"
                        >
                            <Globe className="w-4 h-4" /> IX マクロスナップショット
                        </button>
                        <button
                            onClick={() => setActiveTab('risk')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-all ${activeTab === 'risk' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                            data-testid="tab-risk"
                        >
                            <AlertTriangle className="w-4 h-4" /> IX リスク警告
                        </button>
                        <button
                            onClick={() => setActiveTab('playbook')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-all ${activeTab === 'playbook' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                            data-testid="tab-playbook"
                        >
                            <BrainCircuit className="w-4 h-4" /> VIII 週末シナリオ
                        </button>
                        <button
                            onClick={() => setActiveTab('diary')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-all ${activeTab === 'diary' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                            data-testid="weekend-plan-tab-diary"
                        >
                            <History className="w-4 h-4" /> X トレード日誌
                        </button>
                        <button
                            onClick={() => setActiveTab('portfolio')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-all ${activeTab === 'portfolio' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                            data-testid="tab-portfolio"
                        >
                            <Target className="w-4 h-4" /> XI ポートフォリオ
                        </button>
                    </div>

                    <div className="p-6">
                        {activeTab === 'snapshot' && (
                            <div className="space-y-6 animate-in fade-in duration-500">
                                {/* Macro Snapshot */}
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 px-1">
                                        <Globe className="w-3.5 h-3.5" /> IX マクロスナップショット (Macro Snapshot)
                                    </h4>
                                    {macroData?.partial && (
                                        <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded flex items-center gap-2 mb-2" data-testid="weekend-plan-macro-partial">
                                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                                            <p className="text-[10px] text-amber-200" data-testid="macro-missing-fields">
                                                マクロ情報: 取得失敗項目があります ({macroData.missing_fields?.map(translateMissingField).join(', ') || 'VIX恐怖指数'})
                                            </p>
                                        </div>
                                    )}
                                    {isLoadingMacro ? (
                                        <div className="p-4 bg-slate-950/30 rounded-lg border border-slate-800/30 flex justify-center">
                                            <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                                        </div>
                                    ) : macroData ? (
                                        <div className="grid grid-cols-2 md:grid-cols-6 gap-2" data-testid="weekend-plan-macro">
                                            <MacroCard label="日経平均 (N225)" value={macroData.nikkei} format="Price" testId="weekend-plan-macro-item" />
                                            <MacroCard label="TOPIX" value={macroData.topix} format="Price" testId="weekend-plan-macro-item" />
                                            <MacroCard label="USD/JPY" value={macroData.usdjpy} format="Currency" testId="weekend-plan-macro-item" />
                                            <MacroCard label="米10年金利" value={macroData.us10y} format="Percent" testId="weekend-plan-macro-item" />
                                            <MacroCard label="VIX (恐怖指数)" value={macroData.vix} format="Number" warningThreshold={20} testId="weekend-plan-macro-item" />
                                            <div className="p-2 rounded border border-slate-800/30 bg-slate-950/30 col-span-2 md:col-span-1" data-testid="weekend-plan-macro-item">
                                                <p className="text-[10px] text-slate-500 font-bold mb-1">投資家心理 (Sentiment)</p>
                                                <p className={`text-sm font-bold ${macroData.risk_sentiment?.includes('Off') ? 'text-rose-400' : macroData.risk_sentiment?.includes('On') ? 'text-emerald-400' : 'text-slate-200'}`}>
                                                    {macroData.risk_sentiment || '---'}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-4 bg-slate-950/30 rounded-lg border border-slate-800/30 text-center text-xs text-slate-500">
                                            データ取得失敗
                                        </div>
                                    )}
                                </div>

                                {long_term_snapshot ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-4">
                                            <div className="p-3 bg-slate-950/30 rounded-lg border border-slate-800/30">
                                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                                    <PieChart className="w-3.5 h-3.5" /> 収益性 & 安全性
                                                </h4>
                                                <div className="grid grid-cols-2 gap-y-3 gap-x-1 sm:gap-x-4">
                                                    <MetricItem label="ROE" value={long_term_snapshot?.profitability?.roe ? `${(long_term_snapshot.profitability.roe * 100).toFixed(1)}%` : '---'} />
                                                    <MetricItem label="営業利益率" value={long_term_snapshot?.profitability?.operating_margin ? `${(long_term_snapshot.profitability.operating_margin * 100).toFixed(1)}%` : '---'} />
                                                    <MetricItem label="売上成長率" value={long_term_snapshot?.profitability?.revenue_growth ? `${(long_term_snapshot.profitability.revenue_growth * 100).toFixed(1)}%` : '---'} />
                                                    <MetricItem label="自己資本比率" value={long_term_snapshot?.safety?.equity_ratio ? `${(long_term_snapshot.safety.equity_ratio * 100).toFixed(1)}%` : '---'} />
                                                    <MetricItem label="負債比率" value={long_term_snapshot?.safety?.debt_to_equity ? `${long_term_snapshot.safety.debt_to_equity.toFixed(1)}%` : '---'} />
                                                </div>
                                            </div>
                                            <div className="p-3 bg-slate-950/30 rounded-lg border border-slate-800/30">
                                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                                    <Target className="w-3.5 h-3.5" /> 株主還元
                                                </h4>
                                                <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                                                    <MetricItem label="配当利回り" value={long_term_snapshot?.shareholder_returns?.dividend_yield ? `${(long_term_snapshot.shareholder_returns.dividend_yield * 100).toFixed(2)}%` : '---'} />
                                                    <MetricItem label="配当性向" value={long_term_snapshot?.shareholder_returns?.payout_ratio ? `${(long_term_snapshot.shareholder_returns.payout_ratio * 100).toFixed(1)}%` : '---'} />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="p-3 h-full bg-slate-950/30 rounded-lg border border-slate-800/30 flex flex-col">
                                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                                    <BarChart3 className="w-3.5 h-3.5" /> バリュエーション
                                                </h4>
                                                <div className="flex-1 space-y-4">
                                                    <div className="flex justify-between items-end border-b border-slate-800 pb-2">
                                                        <div>
                                                            <p className="text-[10px] text-slate-500 mb-0.5">現在 PER</p>
                                                            <p className="text-xl font-mono text-slate-100">{long_term_snapshot?.valuation_band?.per?.toFixed(1) || '---'}<span className="text-xs ml-1 text-slate-500">倍</span></p>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-[10px] text-slate-500 mb-0.5">現在 PBR</p>
                                                            <p className="text-xl font-mono text-slate-100">{long_term_snapshot?.valuation_band?.pbr?.toFixed(2) || '---'}<span className="text-xs ml-1 text-slate-500">倍</span></p>
                                                        </div>
                                                    </div>

                                                    <div className="pt-2">
                                                        <div className={`px-3 py-2 rounded-md text-sm font-bold text-center ${long_term_snapshot?.valuation_band?.status === 'UNDERVALUED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                            long_term_snapshot?.valuation_band?.status === 'OVERVALUED' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                                                'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                                            }`}>
                                                            判定: {
                                                                long_term_snapshot?.valuation_band?.status === 'UNDERVALUED' ? '割安・蓄積ゾーン' :
                                                                    long_term_snapshot?.valuation_band?.status === 'OVERVALUED' ? '高値警戒・過熱' :
                                                                        '適正価格・ニュートラル'
                                                            }
                                                        </div>
                                                    </div>

                                                    {long_term_snapshot?.warnings && long_term_snapshot.warnings.length > 0 && (
                                                        <div className="mt-auto pt-4 border-t border-slate-800/50">
                                                            <div className="text-[10px] text-slate-500 font-bold mb-2">長期保有上の警告:</div>
                                                            {long_term_snapshot.warnings.map((w: string, i: number) => (
                                                                <div key={i} className="text-xs text-amber-500/80 flex gap-1.5 items-start">
                                                                    <span className="mt-1 w-1 h-1 rounded-full bg-amber-500 flex-shrink-0" />
                                                                    {w}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center min-h-[200px] opacity-40">
                                        <BarChart3 className="w-8 h-8 mb-2" />
                                        <p className="text-sm">長期分析データは現在取得できませんでした</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'risk' && (
                            <div className="space-y-4 animate-in fade-in duration-500">
                                <div className="p-4 bg-slate-950/30 rounded-lg border border-slate-800/30">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
                                        <Calendar className="w-3.5 h-3.5" /> 直近の重要イベント履歴
                                    </h4>
                                    {event_risk?.warnings && event_risk.warnings.length > 0 && (
                                        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg mb-4 flex gap-3" data-testid="weekend-plan-event-warning">
                                            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                                            <div className="text-xs text-amber-200">
                                                <p className="font-bold mb-1">イベントリスク警告 (Event Risk Alert)</p>
                                                {event_risk.warnings.map((w, i) => (
                                                    <p key={i}>・{w} (決算直前のため新規エントリーのみ制限)</p>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {event_risk?.upcoming_events && event_risk.upcoming_events.length > 0 ? (
                                        <div className="space-y-3">
                                            {event_risk.upcoming_events.map((event: any, i: number) => (
                                                <div key={i} className={`flex items-center justify-between p-2 rounded-md ${event.days_left <= 7 ? 'bg-amber-500/5 border border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.05)]' : 'bg-slate-900/40 border border-slate-800/40'}`}>
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${event.days_left <= 7 ? 'bg-amber-500/20 text-amber-500' : 'bg-slate-800 text-slate-400'}`}>
                                                            <AlertTriangle className="w-4 h-4" />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-bold text-slate-200">{event.type}</p>
                                                            <p className="text-[10px] text-slate-500">{event.date}</p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className={`text-sm font-mono font-bold ${event.days_left <= 7 ? 'text-amber-500' : 'text-slate-400'}`}>
                                                            あと {event.days_left}日
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-slate-500 text-center py-4">直近の重大イベントはありません。</p>
                                    )}
                                </div>

                                <div className="p-4 bg-slate-950/30 rounded-lg border border-slate-800/30">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
                                        <PieChart className="w-3.5 h-3.5" /> 相関・セクター偏り
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-3">
                                            <p className="text-[10px] text-slate-500 font-bold">高相関ペア (上位3件):</p>
                                            {topCorrelationPairs.length > 0 ? (
                                                topCorrelationPairs.map((c: any, i: number) => (
                                                    <div key={i} className="flex justify-between items-center text-xs p-2 bg-slate-900/60 rounded border border-slate-800">
                                                        <span className="text-slate-300 font-bold">{c.pair}</span>
                                                        <span className={`font-mono font-bold ${c.correlation > 0.7 ? 'text-amber-500' : 'text-slate-500'}`}>
                                                            {c.correlation.toFixed(2)}
                                                        </span>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-xs text-slate-600 italic">データなし</p>
                                            )}
                                        </div>
                                        <div className="space-y-3">
                                            <p className="text-[10px] text-slate-500 font-bold">セクター集中度:</p>
                                            {concentration_risk?.sector_distribution ? (
                                                Object.entries(concentration_risk.sector_distribution).map(([sector, pct]: [string, any], i: number) => (
                                                    <div key={i} className="space-y-1">
                                                        <div className="flex justify-between text-[11px]">
                                                            <span className="text-slate-400">{sector}</span>
                                                            <span className="text-slate-200 font-mono font-bold">{(pct * 100).toFixed(0)}%</span>
                                                        </div>
                                                        <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full ${pct > 0.6 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                                                                style={{ width: `${pct * 100}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-xs text-slate-600 italic">データなし</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'playbook' && (
                            <div className="space-y-6 animate-in fade-in duration-500">
                                <div className="p-4 bg-indigo-950/20 border border-indigo-500/20 rounded-lg">
                                    <div className="flex justify-between items-center mb-4">
                                        <h4 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
                                            <BrainCircuit className="w-4 h-4" /> VIII 週末シナリオ (3パターン)
                                        </h4>
                                        <div className="flex gap-2">
                                            {isMarketOpen && (
                                                <button
                                                    onClick={onEvaluate}
                                                    disabled={isEvaluating}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-xs font-bold hover:bg-emerald-500/30 disabled:opacity-50"
                                                    data-testid="scenario-evaluate"
                                                >
                                                    {isEvaluating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                                    今日の行動を判定
                                                </button>
                                            )}
                                            <button
                                                onClick={onSaveScenario}
                                                disabled={isSavingScenario}
                                                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded text-xs font-bold hover:bg-indigo-500/30 disabled:opacity-50"
                                                data-testid="scenario-save"
                                            >
                                                {isSavingScenario ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                                シナリオ保存
                                            </button>
                                        </div>
                                    </div>

                                    {scenarioSaveMsg && (
                                        <div className="mb-4 text-xs font-bold text-center text-indigo-300 bg-indigo-500/10 p-1.5 rounded animate-pulse">
                                            {scenarioSaveMsg}
                                        </div>
                                    )}

                                    {evaluationResult && (
                                        <div className="mb-6 p-4 bg-emerald-950/30 border border-emerald-500/30 rounded-lg shadow-lg" data-testid="scenario-action">
                                            <div className="flex items-center gap-2 mb-2">
                                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                                <span className="text-lg font-bold text-emerald-100">今日の行動: {evaluationResult.recommended_action}</span>
                                            </div>
                                            <p className="text-xs text-slate-300">{evaluationResult.scenario_type} | {evaluationResult.reason}</p>
                                        </div>
                                    )}

                                    {isLoadingScenario ? (
                                        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
                                    ) : (
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="weekend-plan-scenario">
                                            <ScenarioInputCard
                                                title="上窓 (Gap Up)"
                                                color="emerald"
                                                rule={scenarioRules.rules_gap_up}
                                                onChange={(f, v) => handleRuleChange('rules_gap_up', f, v)}
                                                testId="scenario-gap-up-form"
                                            />
                                            <ScenarioInputCard
                                                title="レンジ (Range)"
                                                color="slate"
                                                rule={scenarioRules.rules_range}
                                                onChange={(f, v) => handleRuleChange('rules_range', f, v)}
                                                testId="scenario-range-form"
                                            />
                                            <ScenarioInputCard
                                                title="下窓 (Gap Down)"
                                                color="rose"
                                                rule={scenarioRules.rules_gap_down}
                                                onChange={(f, v) => handleRuleChange('rules_gap_down', f, v)}
                                                testId="scenario-gap-down-form"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="px-1">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 mb-3">
                                        <History className="w-3.5 h-3.5" /> 過去のプレイブック参照
                                    </h4>
                                    {playbook_references && playbook_references.length > 0 ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {playbook_references.map((pb: any, i: number) => (
                                                <div key={i} className="p-3 bg-slate-950/40 border border-slate-800/40 rounded-lg">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pb.result_outcome === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                                            {pb.scenario_type}
                                                        </span>
                                                        <span className="text-[9px] text-slate-600">{pb.timestamp.split(' ')[0]}</span>
                                                    </div>
                                                    <p className="text-[11px] text-slate-400 line-clamp-2 italic mb-2">"{pb.lessons_learned}"</p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {(pb.tags || []).map((tag: any, ti: number) => (
                                                            <span key={ti} className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-sm">#{tag}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-6 text-center text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg text-slate-400">
                                            履歴なし
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'diary' && (
                            <div className="space-y-6 animate-in fade-in duration-500" data-testid="weekend-plan-diary">
                                {/* Scoring Summary (Phase 4.2) */}
                                <div className="p-4 bg-slate-950/40 border border-slate-800/40 rounded-lg" data-testid="weekend-plan-scoring">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                        <PieChart className="w-3.5 h-3.5" /> XI 成績サマリー (Scoring Summary)
                                        <span className="text-[9px] text-slate-600 font-normal lowercase">直近7日間 / Weekly</span>
                                    </h4>

                                    {isLoadingScoring ? (
                                        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-500" /></div>
                                    ) : scoring && scoring.total_entries > 0 ? (
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4" data-testid="scoring-summary">
                                            <MetricItem label="実行件数" value={`${scoring.total_trades}件`} />
                                            <MetricItem label="記録件数" value={`${scoring.total_entries}件`} />
                                            <MetricItem label="勝率" value={`${(scoring.win_rate * 100).toFixed(1)}%`} />
                                            <MetricItem label="実行率" value={`${(scoring.execution_rate * 100).toFixed(1)}%`} />
                                            <div className="text-right flex flex-col justify-between">
                                                <div className="text-[10px] text-slate-500">
                                                    スキップ率: <span className="text-slate-300">{(scoring.skip_rate * 100).toFixed(1)}%</span>
                                                </div>
                                                <span className="text-[9px] text-slate-600 block mt-1" data-testid="scoring-updated-at">
                                                    更新: {scoring.updated_at?.split('T')[0] || '---'}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="py-4 text-center text-xs text-slate-600 italic" data-testid="scoring-empty">
                                            集計可能なデータがありません (No data in last 7 days)
                                        </div>
                                    )}
                                </div>

                                {/* XII Aggregate & Portfolio Input (Phase 4.3) */}
                                <div className="p-4 bg-slate-950/40 border border-slate-800/40 rounded-lg" data-testid="weekend-plan-aggregate-input-section">
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                                            <BarChart3 className="w-3.5 h-3.5" /> XII ポートフォリオ全体成績 (Aggregate Results)
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            {savedPortfolio.length > 0 && (
                                                <button
                                                    onClick={reflectPortfolio}
                                                    className="px-2 py-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded text-[9px] font-bold hover:bg-indigo-500/20 transition-all flex items-center gap-1"
                                                    title="ポートフォリオを反映"
                                                    data-testid="reflect-portfolio-btn"
                                                >
                                                    <Target className="w-2.5 h-2.5" /> 反映
                                                </button>
                                            )}
                                            <input
                                                type="text"
                                                value={portfolioTickers}
                                                onChange={e => setPortfolioTickers(e.target.value)}
                                                className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[10px] text-slate-300 w-32 outline-none focus:border-indigo-500/50"
                                                placeholder="7203, 9101, ..."
                                                data-testid="aggregate-portfolio-input"
                                            />
                                            <button
                                                onClick={onRefreshPortfolio}
                                                className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded hover:bg-indigo-500/30 transition-colors"
                                                title="再集計"
                                            >
                                                <History className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>

                                    {isLoadingAggregate ? (
                                        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-500" /></div>
                                    ) : aggregateScoring && aggregateScoring.total_entries > 0 ? (
                                        <div className="space-y-4" data-testid="weekend-plan-aggregate">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="aggregate-summary">
                                                <MetricItem label="全体実行数" value={`${aggregateScoring.total_trades}件`} />
                                                <MetricItem label="全体勝率" value={`${(aggregateScoring.win_rate * 100).toFixed(1)}%`} />
                                                <MetricItem label="全体実行率" value={`${(aggregateScoring.execution_rate * 100).toFixed(1)}%`} />
                                                <MetricItem label="対象銘柄数" value={`${aggregateScoring.tickers_count}銘柄`} />
                                            </div>
                                            <div className="pt-2 border-t border-slate-800/30">
                                                <p className="text-[10px] text-slate-600 font-bold mb-2">銘柄別 TOP3 (by Trades):</p>
                                                <div className="flex gap-4" data-testid="aggregate-top3">
                                                    {aggregateScoring.per_ticker.slice(0, 3).map((item, idx) => (
                                                        <div key={idx} className="bg-slate-900/40 p-2 rounded border border-slate-800/30 flex-1">
                                                            <div className="flex justify-between items-center mb-1">
                                                                <span className="text-[10px] font-bold text-indigo-400">{item.ticker}</span>
                                                                <span className="text-[9px] text-slate-500">{item.total_trades} trades</span>
                                                            </div>
                                                            <div className="text-[11px] font-mono text-slate-300">
                                                                勝率: {(item.win_rate * 100).toFixed(0)}%
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="py-2 text-center text-xs text-slate-600 italic">
                                            複数銘柄のデータを入力して集計してください
                                        </div>
                                    )}
                                </div>

                                {/* XIII Rule Based Scoring (Phase 4.3) */}
                                <div className="p-4 bg-slate-950/40 border border-slate-800/40 rounded-lg" data-testid="weekend-plan-by-rule">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                        <Target className="w-3.5 h-3.5" /> XIII ルール別成績 (Rule Analysis)
                                    </h4>
                                    {isLoadingRuleScoring ? (
                                        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-500" /></div>
                                    ) : ruleScoring ? (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <RuleMetricBox label="上窓 (Gap Up)" data={ruleScoring.rules.gap_up} color="emerald" testId="by-rule-gap-up" />
                                            <RuleMetricBox label="下窓 (Gap Down)" data={ruleScoring.rules.gap_down} color="rose" testId="by-rule-gap-down" />
                                            <RuleMetricBox label="レンジ (Range)" data={ruleScoring.rules.range} color="slate" testId="by-rule-range" />
                                        </div>
                                    ) : (
                                        <div className="py-2 text-center text-xs text-slate-600 italic">データなし</div>
                                    )}
                                </div>

                                {/* XIV Recommendation (Phase 4.3) */}
                                <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-lg" data-testid="weekend-plan-recommendation">
                                    <h4 className="text-xs font-bold text-indigo-400 uppercase mb-2 flex items-center gap-2">
                                        <BrainCircuit className="w-3.5 h-3.5" /> XIV 次週の改善提案 (Weekly Insights)
                                    </h4>
                                    <div className="flex gap-3 items-start p-3 bg-indigo-950/20 rounded border border-indigo-500/10">
                                        <div className="p-1.5 bg-indigo-500/20 rounded-full text-indigo-400 mt-0.5">
                                            <ShieldCheck className="w-4 h-4" />
                                        </div>
                                        <p className="text-xs leading-relaxed text-slate-200">
                                            {recommendation}
                                        </p>
                                    </div>
                                </div>

                                {/* XV Weekly Review (Phase 4.5) */}
                                <div className="p-4 bg-slate-950/40 border border-slate-800/40 rounded-lg" data-testid="weekend-plan-weekly-review">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                        <Calendar className="w-3.5 h-3.5" /> XV 週次レビュー (Weekly Review)
                                    </h4>
                                    {isLoadingReview ? (
                                        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-500" /></div>
                                    ) : weeklyReview ? (
                                        <div className="space-y-4">
                                            {weeklyReview.is_partial && (
                                                <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-200" data-testid="review-partial-warning">
                                                    <AlertTriangle className="w-3 h-3 text-amber-500" />
                                                    <span>対象期間のデータが不足しています。一部の集計が制限されます。</span>
                                                </div>
                                            )}
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                <MetricItem label="週間実行数" value={`${weeklyReview.executed_trades}件`} />
                                                <MetricItem label="週間勝率" value={`${(weeklyReview.win_rate * 100).toFixed(1)}%`} />
                                                <MetricItem label="週間実行率" value={`${(weeklyReview.execution_rate * 100).toFixed(1)}%`} />
                                            </div>
                                            {(weeklyReview.best_trade !== 0 || weeklyReview.worst_trade !== 0) && (
                                                <div className="grid grid-cols-2 gap-3 text-xs">
                                                    <div className="p-2 bg-emerald-500/5 border border-emerald-500/10 rounded">
                                                        <span className="text-[9px] text-slate-500 block mb-1">BESTトレード</span>
                                                        <span className="text-emerald-400 font-mono font-bold">+{weeklyReview.best_trade.toLocaleString()}円</span>
                                                    </div>
                                                    <div className="p-2 bg-rose-500/5 border border-rose-500/10 rounded">
                                                        <span className="text-[9px] text-slate-500 block mb-1">WORSTトレード</span>
                                                        <span className="text-rose-400 font-mono font-bold">{weeklyReview.worst_trade.toLocaleString()}円</span>
                                                    </div>
                                                </div>
                                            )}
                                            {weeklyReview.notes.length > 0 && (
                                                <div className="p-3 bg-slate-900/50 rounded border border-slate-800/50 space-y-1.5">
                                                    {weeklyReview.notes.map((note, idx) => (
                                                        <div key={idx} className="flex gap-2 items-start text-[11px] text-slate-300">
                                                            <CheckCircle2 className="w-3 h-3 text-indigo-400 mt-0.5 flex-shrink-0" />
                                                            <span>{note}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="py-2 text-center text-xs text-slate-600 italic">レビューを生成するための日誌データが不足しています</div>
                                    )}
                                </div>

                                {/* Diary Form */}
                                <div className="p-4 bg-slate-900/40 border border-slate-700/30 rounded-lg" data-testid="diary-form">
                                    <div className="flex justify-between items-center mb-4">
                                        <h4 className="text-sm font-bold text-slate-300">X トレード日誌入力</h4>
                                        <div className="flex items-center gap-4">
                                            {diaryStatusMsg && <span className="text-xs text-emerald-400 animate-pulse font-bold" data-testid="diary-save-status">{diaryStatusMsg}</span>}
                                            {diaryError && <span className="text-xs text-rose-400 font-bold" data-testid="diary-save-error">{diaryError}</span>}
                                            <button
                                                onClick={onSaveDiary}
                                                disabled={isSavingDiary}
                                                className="px-4 py-1.5 bg-indigo-500 text-white rounded text-xs font-bold hover:bg-indigo-600 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed transition-all shadow-lg active:scale-95"
                                                data-testid="diary-save"
                                            >
                                                {isSavingDiary ? (
                                                    <div className="flex items-center gap-2">
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                        <span>保存中...</span>
                                                    </div>
                                                ) : "日誌を記録"}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">取引日 (Date)</label>
                                                <input
                                                    type="date"
                                                    value={newDiary.date}
                                                    onChange={e => setNewDiary(prev => ({ ...prev, date: e.target.value }))}
                                                    className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                                                    data-testid="diary-date"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">直面したシナリオ (Type)</label>
                                                <select
                                                    value={newDiary.scenario_type}
                                                    onChange={e => setNewDiary(prev => ({ ...prev, scenario_type: e.target.value as any }))}
                                                    className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                                                    data-testid="diary-scenario-type"
                                                >
                                                    <option value="gap_up">上窓 (Gap Up)</option>
                                                    <option value="gap_down">下窓 (Gap Down)</option>
                                                    <option value="range">レンジ (Range)</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">損益額 (PnL Yen) - 任意</label>
                                                <input
                                                    type="number"
                                                    value={newDiary.pnl_yen}
                                                    onChange={e => setNewDiary(prev => ({ ...prev, pnl_yen: parseFloat(e.target.value) || 0 }))}
                                                    className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                                                    placeholder="0"
                                                    data-testid="diary-pnl"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">当初の作戦 (Planned)</label>
                                                <input
                                                    type="text"
                                                    value={newDiary.planned_action}
                                                    onChange={e => setNewDiary(prev => ({ ...prev, planned_action: e.target.value }))}
                                                    className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                                                    placeholder="例: +20 ticks で順張り買い"
                                                    data-testid="diary-planned-action"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">実際の行動 (Actual)</label>
                                                <input
                                                    type="text"
                                                    value={newDiary.actual_action}
                                                    onChange={e => setNewDiary(prev => ({ ...prev, actual_action: e.target.value }))}
                                                    className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                                                    placeholder="例: 同様にエントリー、+10で微利確"
                                                    data-testid="diary-actual-action"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1">結果 (Result)</label>
                                                <select
                                                    value={newDiary.result}
                                                    onChange={e => setNewDiary(prev => ({ ...prev, result: e.target.value as any }))}
                                                    className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                                                    data-testid="diary-result"
                                                >
                                                    <option value="win">利確 (Profit)</option>
                                                    <option value="loss">損切 (Loss)</option>
                                                    <option value="flat">同値 (Flat)</option>
                                                    <option value="skip">見送り (Skip)</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3">
                                        <label className="text-[10px] text-slate-500 block mb-1">反省ノート (Notes) - 任意</label>
                                        <textarea
                                            value={newDiary.notes}
                                            onChange={e => setNewDiary(prev => ({ ...prev, notes: e.target.value }))}
                                            className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-2 text-xs text-slate-200 h-16 resize-none outline-none focus:border-indigo-500/50"
                                            placeholder="感情の動き、規律の遵守、気づいた点など"
                                            data-testid="diary-notes"
                                        />
                                    </div>
                                </div>

                                {/* Diary List */}
                                <div className="space-y-4">
                                    <h5 className="text-[10px] font-bold text-slate-500 uppercase px-1 flex items-center justify-between">
                                        <span>直近のプレイ記録 (Recent Logs)</span>
                                        <span className="text-[9px] font-normal text-slate-700">銘柄別・最新10件</span>
                                    </h5>
                                    {isLoadingDiary ? (
                                        <div className="flex justify-center p-8 bg-slate-950/20 rounded-lg border border-slate-800/30">
                                            <Loader2 className="w-5 h-5 animate-spin text-slate-700" />
                                        </div>
                                    ) : diaryEntries.length > 0 ? (
                                        <div className="grid grid-cols-1 gap-2" data-testid="diary-list">
                                            {diaryEntries.map((entry) => (
                                                <div key={entry.id} className="p-4 bg-slate-950/30 border border-slate-800/40 rounded-lg flex gap-4 items-start hover:bg-slate-800/20 transition-colors" data-testid="diary-item">
                                                    <div className="min-w-[70px] pt-0.5">
                                                        <p className="text-[10px] text-slate-500 font-mono mb-1">{entry.date}</p>
                                                        <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${entry.result === 'win' ? 'bg-emerald-500/20 text-emerald-400' :
                                                            entry.result === 'loss' ? 'bg-rose-500/20 text-rose-400' :
                                                                'bg-slate-700/50 text-slate-400'
                                                            }`}>
                                                            {entry.result === 'win' ? '利確' : entry.result === 'loss' ? '損切' : entry.result === 'flat' ? '同値' : '見送り'}
                                                        </span>
                                                    </div>
                                                    <div className="flex-1 space-y-2">
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <p className="text-xs font-bold text-slate-300">
                                                                    <span className="text-indigo-400 mr-2">[{entry.scenario_type.toUpperCase()}]</span>
                                                                    {entry.planned_action}
                                                                </p>
                                                                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                                                                    <span className="text-[9px] text-slate-600 bg-slate-800 px-1 rounded">実績</span>
                                                                    {entry.actual_action}
                                                                </p>
                                                            </div>
                                                            {entry.pnl_yen !== 0 && entry.pnl_yen !== undefined && (
                                                                <p className={`text-xs font-mono font-bold ${entry.pnl_yen > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                    {entry.pnl_yen > 0 ? '+' : ''}{entry.pnl_yen.toLocaleString()}円
                                                                </p>
                                                            )}
                                                        </div>
                                                        {entry.notes && (
                                                            <div className="p-2 bg-slate-900/50 rounded text-[10px] text-slate-500 italic leading-relaxed border-l-2 border-slate-800">
                                                                {entry.notes}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-12 text-center bg-slate-950/10 border border-dashed border-slate-800 rounded-lg text-[11px] text-slate-600 flex flex-col items-center gap-2">
                                            <History className="w-6 h-6 opacity-20" />
                                            <span>この銘柄の取引記録はまだありません</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'portfolio' && (
                            <div className="space-y-6 animate-in fade-in duration-500">
                                <div className="p-4 bg-slate-950/30 rounded-lg border border-slate-800/30">
                                    <h4 className="text-sm font-bold text-slate-400 mb-4 flex items-center gap-2">
                                        <Target className="w-4 h-4" /> XI ポートフォリオ管理 (Portfolio)
                                    </h4>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">監視対象ティッカー (カンマ区切り)</label>
                                            <input
                                                type="text"
                                                value={portfolioTickers}
                                                onChange={(e) => setPortfolioTickers(e.target.value)}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                                                data-testid="portfolio-input"
                                                placeholder="7203, 9984, 8306..."
                                            />
                                        </div>
                                        <div className="flex justify-end gap-3">
                                            <button
                                                onClick={onSavePortfolio}
                                                disabled={isSavingPortfolio}
                                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-bold transition-colors disabled:opacity-50 flex items-center gap-2"
                                                data-testid="portfolio-save"
                                            >
                                                {isSavingPortfolio ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} 保存
                                            </button>
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-slate-800/50">
                                            <div className="flex justify-between items-center text-xs text-slate-500">
                                                <span>登録数: {portfolioTickers.split(',').filter(t => t.trim()).length}</span>
                                                {portfolioUpdatedAt && <span data-testid="portfolio-updated-at">最終更新: {new Date(portfolioUpdatedAt).toLocaleString('ja-JP')}</span>}
                                            </div>
                                        </div>

                                        {/* Portfolio Analysis Prompt */}
                                        <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                                            <p className="text-xs text-indigo-300">
                                                <Target className="w-3 h-3 inline-block mr-1" />
                                                ポートフォリオを保存すると、集計されたスコアリング (Aggregate Scoring) に反映されます。
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Sub-components
const MetricItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex flex-col">
        <span className="text-[9px] text-slate-500 font-bold mb-0.5">{label}</span>
        <span className="text-sm font-mono text-slate-200">{value}</span>
    </div>
);

const RuleMetricBox: React.FC<{ label: string; data: any; color: 'emerald' | 'rose' | 'slate'; testId: string }> = ({ label, data, color, testId }) => {
    const textColor = color === 'emerald' ? 'text-emerald-400' : color === 'rose' ? 'text-rose-400' : 'text-slate-400';
    return (
        <div className="bg-slate-900/60 p-3 rounded border border-slate-800/40" data-testid={testId}>
            <p className={`text-[10px] font-bold ${textColor} mb-2`}>{label}</p>
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <p className="text-[8px] text-slate-500">勝率 (Win)</p>
                    <p className="text-xs font-mono text-slate-200">{(data.win_rate * 100).toFixed(1)}%</p>
                </div>
                <div>
                    <p className="text-[8px] text-slate-500">実行率 (Exec)</p>
                    <p className="text-xs font-mono text-slate-200">{(data.execution_rate * 100).toFixed(1)}%</p>
                </div>
            </div>
            <p className="text-[8px] text-slate-600 mt-2">取引: {data.total_trades}件</p>
        </div>
    );
};

const MacroCard: React.FC<{ label: string; value: number | undefined; format: 'Price' | 'Currency' | 'Percent' | 'Number'; warningThreshold?: number; testId?: string }> = ({ label, value, format, warningThreshold, testId }) => {
    let formatted = '---';
    let isWarning = false;

    if (value !== undefined && value !== null) {
        if (format === 'Price') formatted = value.toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (format === 'Currency') formatted = value.toFixed(2);
        if (format === 'Percent') formatted = `${value.toFixed(2)}%`;
        if (format === 'Number') formatted = value.toFixed(2);
        if (warningThreshold && value > warningThreshold) isWarning = true;
    }

    return (
        <div className={`p-2 rounded border bg-slate-950/30 ${isWarning ? 'border-rose-500/40' : 'border-slate-800/30'}`} data-testid={testId}>
            <p className="text-[10px] text-slate-500 font-bold mb-1">{label}</p>
            <p className={`text-base font-mono font-bold ${isWarning ? 'text-rose-400' : 'text-slate-200'}`}>{formatted}</p>
        </div>
    );
};

const ScenarioInputCard: React.FC<{
    title: string;
    color: 'emerald' | 'rose' | 'slate';
    rule: any;
    onChange: (field: string, value: string) => void;
    testId: string;
}> = ({ title, color, rule, onChange, testId }) => {
    const borderColor = color === 'emerald' ? 'border-emerald-500/30' : color === 'rose' ? 'border-rose-500/30' : 'border-slate-500/30';
    const textColor = color === 'emerald' ? 'text-emerald-400' : color === 'rose' ? 'text-rose-400' : 'text-slate-400';
    const bgColor = color === 'emerald' ? 'bg-emerald-950/20' : color === 'rose' ? 'bg-rose-950/20' : 'bg-slate-900/40';

    return (
        <div className={`p-3 rounded-lg border ${borderColor} ${bgColor} flex flex-col gap-2`} data-testid={testId}>
            <h5 className={`text-xs font-bold ${textColor} border-b border-slate-700/50 pb-1 mb-1`}>{title}</h5>
            <div className="space-y-1">
                <label className="text-[10px] text-slate-500">エントリー条件</label>
                <input
                    type="text"
                    value={rule.entry_condition}
                    onChange={e => onChange('entry_condition', e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none"
                    placeholder="例: 始値 > 1000"
                />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className="text-[10px] text-slate-500">利確 (TP)</label>
                    <input
                        type="text"
                        value={rule.take_profit}
                        onChange={e => onChange('take_profit', e.target.value)}
                        className="w-full bg-slate-900/80 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none"
                        placeholder="例: +20 ticks"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] text-slate-500">損切 (SL)</label>
                    <input
                        type="text"
                        value={rule.stop_loss}
                        onChange={e => onChange('stop_loss', e.target.value)}
                        className="w-full bg-slate-900/80 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                </div>
            </div>
            <div className="space-y-1">
                <label className="text-[10px] text-slate-500">ノート</label>
                <textarea
                    value={rule.note}
                    onChange={e => onChange('note', e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 h-14 resize-none"
                />
            </div>
        </div>
    );
};
