import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  Layers3,
  LineChart as LineChartIcon,
  Loader2,
  Play,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './index.css';

const API_BASE = import.meta.env.VITE_ZEN_API_BASE || `http://${window.location.hostname}:8889/api`;
const CACHE_KEY = 'zen-stock-prophet-pro-cache-v1';
const COLORS = ['#16f1a4', '#38bdf8', '#f59e0b', '#fb7185', '#a78bfa', '#22c55e'];
const PINNED_WATCH_TICKER = '4980.T';
const daytradeFallback = {
  plan: {
    premise: '楽天証券・MarketSpeedとは連携しません。短期検証はローカルの価格データとシミュレーション記録だけで行います。',
    modes: [
      { id: 'PAPER_REVIEW', label: 'ペーパー検証', description: '売買候補をローカルで記録し、実注文画面やRPAには渡しません。' },
    ],
    rules: {
      gapAbsPct: 3,
      minBookRatio: 1.5,
      maxSpreadPct: 0.15,
      takeProfitPct: 1,
      stopLossPct: 0.5,
      riskPerTradePct: 2,
      maxPositions: 3,
    },
  },
  signals: [
    {
      state: 'READY',
      mode: 'MANUAL_SIGNAL',
      ticker: '4980.T',
      name: 'デクセリアルズ',
      side: 'BUY',
      strategy: 'GAP_UP_PULLBACK',
      limitPrice: 2478,
      shares: 100,
      riskJpy: 1239,
      takeProfit: 2502,
      stopLoss: 2465,
      expiresAt: '09:05:20',
      bookRatio: 1.8,
      spreadPct: 0.04,
      vwapDeviationPct: 0.08,
      mlProbability: 0.64,
      reason: 'Gap +3%以上、流動性条件を満たし、VWAP付近で反発。ペーパー検証候補です。',
    },
  ],
  risk: {
    capitalJpy: 1000000,
    riskPerTradeJpy: 20000,
    maxPositionNotionalJpy: 300000,
    maxPositions: 3,
    maxConsecutiveLosses: 3,
    liveOrderMode: 'disabled',
    jobsVerdict: '楽天証券連携なし。ペーパー検証の記録だけを残し、実注文には接続しません。',
  },
  brokerStatus: {
    mode: 'BROKER_DISABLED',
    workbookExists: false,
    workbookOpen: false,
    message: '楽天証券・MarketSpeed連携は使用しません。短期検証はローカルデータのみです。',
  },
  autopilot: {
    running: false,
    mode: 'PAPER_AUTO',
    intervalSec: 60,
    lastSource: 'NOT_STARTED',
    lastReady: 0,
    lastRejected: 0,
    cycles: 0,
    liveOrdersEnabled: false,
    verdict: 'オートパイロットはローカル限定です。証券会社連携は無効です。',
  },
};
const PINNED_WATCH_STOCK = {
  ticker: PINNED_WATCH_TICKER,
  name: 'デクセリアルズ',
  emoji: 'DX',
  price: 2481,
  candidateScore: 100,
  candidateRank: 1,
  mustInclude: true,
  candidateReason: '固定観察銘柄。AI候補と常に比較します。',
};

const PROPHET_PRO_RESULT = {
  generatedAt: '2026-05-11T12:15:30+00:00',
  pick: {
    ticker: '6503.T',
    name: '三菱電機',
    confidence: 93.51,
    score: 0.9955,
    close: 6460,
    direction: 'up',
    reasons: [
      '5日モメンタム 6.07%',
      '20日モメンタム 19.70%',
      '終値 > 20日線 > 50日線',
      'RSIが順張り適温帯(68.2)',
    ],
    warnings: [],
    metrics: {
      momentum5: 6.07,
      momentum20: 19.70,
      rsi: 68.2,
      atr: 3.87,
    },
    quality: {
      qualityScore: 99,
      backtest: {
        sampleCount: 36,
        winRate: 58.3,
        avgNextDayReturnPct: 0.57,
        medianNextDayReturnPct: 0.18,
        verdict: 'positive_edge',
      },
      gates: [
        { id: 'truth', label: '1銘柄表示とウォッチリスト一致', ok: true },
        { id: 'freshness', label: '日足鮮度確認', ok: true },
        { id: 'momentum', label: '5日/20日モメンタム', ok: true },
        { id: 'heat', label: 'RSI過熱回避', ok: true },
        { id: 'order', label: '実注文は本人確認後', ok: true },
      ],
      warnings: [],
    },
  },
  ranking: [
    { ticker: '6503.T', name: '三菱電機', confidence: 93.51, score: 0.9955, warning: '採用候補 / 警告なし' },
    { ticker: '6526.T', name: 'ソシオネクスト', confidence: 93.90, score: 1.3202, warning: 'ATR高 / RSIやや高い' },
    { ticker: '9984.T', name: 'ソフトバンクG', confidence: 93.87, score: 1.2606, warning: 'ATR高' },
    { ticker: '8035.T', name: '東京エレクトロン', confidence: 93.80, score: 1.1735, warning: '利確リスク' },
    { ticker: '8053.T', name: '住友商事', confidence: 93.72, score: 1.1122, warning: 'RSIやや高い' },
    { ticker: '6954.T', name: 'ファナック', confidence: 93.65, score: 1.0674, warning: '利確リスク' },
    { ticker: '6981.T', name: '村田製作所', confidence: 93.52, score: 1.0017, warning: 'RSI過熱' },
    { ticker: '6752.T', name: 'パナソニックHD', confidence: 93.50, score: 0.9948, warning: '決算イベントリスク' },
  ],
};

const PROPHET_WATCH_STOCK = {
  ticker: PROPHET_PRO_RESULT.pick.ticker,
  name: PROPHET_PRO_RESULT.pick.name,
  emoji: 'ME',
  price: PROPHET_PRO_RESULT.pick.close,
  decision: 'DAYTRADE_ENTRY_OK',
  confidence: PROPHET_PRO_RESULT.pick.confidence,
  candidateScore: PROPHET_PRO_RESULT.pick.confidence,
  candidateRank: 1,
  prophetPick: true,
  mustInclude: true,
  buyLimit: Math.round(PROPHET_PRO_RESULT.pick.close * 1.002),
  entryGapPct: 0.2,
  candidateReason: `Prophet Proの「明日デイトレで買える高騰候補」。寄付き後5分以内に板・出来高・VWAPを確認し、近い上限指値または成行許容で入る候補です。${PROPHET_PRO_RESULT.pick.reasons.join(' / ')}`,
};

const demo = {
  stocks: [
    PINNED_WATCH_STOCK,
    { ticker: '7203.T', name: 'トヨタ自動車', emoji: 'TY', price: 3000, candidateScore: 74, candidateRank: 2, candidateReason: '大型・高流動性で比較しやすい候補です。' },
    { ticker: '6758.T', name: 'ソニーグループ', emoji: 'SY', price: 3127, candidateScore: 72, candidateRank: 3, candidateReason: 'グローバル事業とテーマ性を持つ成長観察候補です。' },
    { ticker: '9984.T', name: 'ソフトバンクグループ', emoji: 'SB', price: 5424, candidateScore: 68, candidateRank: 4, candidateReason: '値動きが大きく、上昇余地と下落リスクを同時に学ぶ候補です。' },
  ],
  portfolio: {
    cash: 160000,
    totalAssets: 1086200,
    totalPnl: 86200,
    totalPnlPct: 8.62,
    initialCash: 1000000,
    holdings: [
      { ticker: '4980.T', name: 'デクセリアルズ', emoji: 'DX', shares: 120, avgCost: 2310, currentPrice: 2481, value: 297720, pnl: 20520, pnlPct: 7.4 },
      { ticker: '7203.T', name: 'Toyota', emoji: 'TY', shares: 80, avgCost: 2850, currentPrice: 3000, value: 240000, pnl: 12000, pnlPct: 5.3 },
    ],
    history: Array.from({ length: 22 }, (_, i) => ({
      date: `${String(Math.max(1, i + 9)).padStart(2, '0')}:00`,
      value: 1000000 + Math.round(Math.sin(i / 2) * 18000 + i * 4200),
    })),
  },
  transactions: [
    { id: 1, ticker: '4980.T', name: 'デクセリアルズ', action: 'BUY', shares: 20, price: 2481, total: 49620, reason: 'デモ注文', createdAt: 'オフライン' },
  ],
};

function normalizeResponse(data) {
  return Array.isArray(data?.value) ? data.value : data;
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeout ?? 6500);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = payload?.detail ? `: ${payload.detail}` : '';
      } catch {
        detail = '';
      }
      throw new Error(`HTTP ${response.status}${detail}`);
    }
    return normalizeResponse(await response.json());
  } finally {
    window.clearTimeout(timeout);
  }
}

function yen(value) {
  return `¥${Math.round(Number(value || 0)).toLocaleString('ja-JP')}`;
}

function pct(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function shortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
}

function candidateScore(stock) {
  const parsed = Number(stock?.candidateScore);
  return Number.isFinite(parsed) ? clamp(parsed) : 55;
}

function candidateReason(stock) {
  return stock?.candidateReason || 'AIスクリーニングで抽出した注目候補です。詳細画面でシグナルとリスクを確認してください。';
}

function candidateQuality(stock, detail) {
  if (detail?.candidateQuality) return detail.candidateQuality;
  if (stock?.candidateQuality) return stock.candidateQuality;
  if (stock?.ticker === PROPHET_PRO_RESULT.pick.ticker) return PROPHET_PRO_RESULT.pick.quality;
  return null;
}

function backtestLabel(backtest) {
  if (!backtest?.sampleCount) return '検証不足';
  const sign = Number(backtest.avgNextDayReturnPct || 0) >= 0 ? '+' : '';
  return `勝率 ${backtest.winRate}% / 平均 ${sign}${backtest.avgNextDayReturnPct}%`;
}

function ensurePinnedWatchStock(list = []) {
  const normalized = Array.isArray(list) ? list.filter(Boolean) : [];
  const pinned = normalized.find((stock) => stock.ticker === PINNED_WATCH_TICKER);
  const prophet = normalized.find((stock) => stock.ticker === PROPHET_PRO_RESULT.pick.ticker);
  const prophetStock = {
    ...PROPHET_WATCH_STOCK,
    ...prophet,
    mustInclude: true,
    candidateRank: prophet?.candidateRank ?? PROPHET_WATCH_STOCK.candidateRank,
  };
  const pinnedStock = {
    ...PINNED_WATCH_STOCK,
    ...pinned,
    mustInclude: true,
    candidateRank: pinned?.candidateRank ?? PINNED_WATCH_STOCK.candidateRank,
  };
  return [
    prophetStock,
    pinnedStock,
    ...normalized.filter((stock) => ![PINNED_WATCH_TICKER, PROPHET_PRO_RESULT.pick.ticker].includes(stock.ticker)),
  ];
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function maxDrawdown(values) {
  let peak = values[0] || 0;
  let worst = 0;
  values.forEach((value) => {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, (value - peak) / peak);
  });
  return worst * 100;
}

function ratioLabel(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '-';
  return `${number.toFixed(2)}x`;
}

function scoreTone(value) {
  const number = Number(value || 0);
  if (number >= 72) return 'good';
  if (number >= 55) return 'info';
  return 'warn';
}

function stockDecisionTone(decision) {
  if (decision === 'DAYTRADE_ENTRY_OK') return 'buy-now';
  if (decision === 'BUY_LIMIT_OK') return 'buy-now';
  if (decision === 'REPRICE_FOR_DAYTRADE') return 'buy-candidate';
  if (decision === 'BUY_ON_PULLBACK') return 'buy-candidate';
  if (decision === 'AVOID') return 'avoid';
  return 'watch';
}

function exitPlanTone(action) {
  if (['RISK_EXIT', 'TRAIL_STOP_HIT'].includes(action)) return 'sell';
  if (['SCALE_OUT', 'TAKE_PROFIT'].includes(action)) return 'warn';
  if (action === 'HOLD_RIDE_TREND') return 'good';
  return 'info';
}

function stockDecisionPriority(stock) {
  if (stock?.decision === 'DAYTRADE_ENTRY_OK') return 0;
  if (stock?.ticker === PROPHET_PRO_RESULT.pick.ticker) return 0;
  if (stock?.decision === 'BUY_LIMIT_OK') return 0;
  if (stock?.decision === 'REPRICE_FOR_DAYTRADE') return 1;
  if (stock?.decision === 'BUY_ON_PULLBACK') return 1;
  if (stock?.mustInclude) return 2;
  if (stock?.decision === 'WATCH') return 3;
  return 4;
}

function signalMeta(signal = 'HOLD') {
  const map = {
    STRONG_BUY: ['強い買い', 'buy'],
    BUY: ['買い', 'buy'],
    WAIT: ['押し目待ち', 'hold'],
    HOLD: ['様子見', 'hold'],
    SELL: ['売り', 'sell'],
    STRONG_SELL: ['強い売り', 'sell'],
    AVOID: ['買わない', 'sell'],
  };
  return map[signal] || [signal, 'hold'];
}

function StatusPill({ label, tone = 'neutral' }) {
  return <span className={`pill ${tone}`}>{label}</span>;
}

function ProTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <b>{label}</b>
      {payload.map((item) => (
        <span key={item.dataKey || item.name} style={{ color: item.color }}>
          {item.name}: {typeof item.value === 'number' ? yen(item.value) : item.value}
        </span>
      ))}
    </div>
  );
}

export default function App() {
  const cached = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    } catch {
      return null;
    }
  }, []);

  const [stocks, setStocks] = useState(ensurePinnedWatchStock(cached?.stocks || demo.stocks));
  const [portfolio, setPortfolio] = useState(cached?.portfolio || demo.portfolio);
  const [transactions, setTransactions] = useState(cached?.transactions || demo.transactions);
  const [selectedTicker, setSelectedTicker] = useState(PROPHET_PRO_RESULT.pick.ticker);
  const [detail, setDetail] = useState(cached?.detail || null);
  const [daytradePlan, setDaytradePlan] = useState(cached?.daytradePlan || daytradeFallback.plan);
  const [daytradeSignals, setDaytradeSignals] = useState(cached?.daytradeSignals || daytradeFallback.signals);
  const [daytradeRisk, setDaytradeRisk] = useState(cached?.daytradeRisk || daytradeFallback.risk);
  const [daytradeSource, setDaytradeSource] = useState(cached?.daytradeSource || 'CSV_TEMPLATE');
  const [brokerStatus, setBrokerStatus] = useState(cached?.brokerStatus || daytradeFallback.brokerStatus);
  const [autopilotStatus, setAutopilotStatus] = useState(cached?.autopilotStatus || daytradeFallback.autopilot);
  const [alertReport, setAlertReport] = useState(cached?.alertReport || null);
  const [jquantsResearch, setJquantsResearch] = useState(cached?.jquantsResearch || null);
  const [advancedReport, setAdvancedReport] = useState(cached?.advancedReport || null);
  const [jquantsCode, setJquantsCode] = useState(PROPHET_PRO_RESULT.pick.ticker);
  const [activeTab, setActiveTab] = useState('plan');
  const [busy, setBusy] = useState('');
  const [screenProgress, setScreenProgress] = useState(null);
  const [status, setStatus] = useState({ tone: cached ? 'warn' : 'neutral', text: cached ? 'キャッシュ表示中' : '初期化中' });
  const [positionForm, setPositionForm] = useState({
    ticker: PINNED_WATCH_TICKER,
    name: 'デクセリアルズ',
    entryPrice: '2648',
    shares: '100',
    note: '手入力の買付記録',
  });
  const [log, setLog] = useState([
    { tag: 'Jobs', text: 'Pro版を起動。安全境界を保持し、独立ポートで運用します。' },
  ]);

  const addLog = useCallback((tag, text) => {
    setLog((items) => [{ tag, text }, ...items].slice(0, 12));
  }, []);

  const hydrate = useCallback(async (background = false) => {
    if (!background) setBusy('sync');
    try {
      const [stockResult, portfolioResult, txResult, daytradePlanResult, daytradeSignalsResult, daytradeRiskResult, brokerStatusResult, autopilotResult, alertResult, jquantsResult] = await Promise.allSettled([
        api('/stocks'),
        api('/portfolio'),
        api('/transactions'),
        api('/daytrade/plan'),
        api('/daytrade/signals'),
        api('/daytrade/risk-state'),
        api('/daytrade/broker-status'),
        api('/daytrade/autopilot/status'),
        api('/alerts/watchlist', { timeout: 12000 }),
        api('/research/jquants/status'),
      ]);
      const nextStocks = ensurePinnedWatchStock(stockResult.status === 'fulfilled' && stockResult.value?.length ? stockResult.value : stocks);
      const nextPortfolio = portfolioResult.status === 'fulfilled' && portfolioResult.value ? portfolioResult.value : portfolio;
      const nextTransactions = txResult.status === 'fulfilled' && txResult.value?.length ? txResult.value : transactions;
      const nextDaytradePlan = daytradePlanResult.status === 'fulfilled' && daytradePlanResult.value ? daytradePlanResult.value : daytradePlan;
      const signalPayload = daytradeSignalsResult.status === 'fulfilled' ? daytradeSignalsResult.value : null;
      const nextDaytradeSignals = signalPayload?.signals?.length ? signalPayload.signals : Array.isArray(signalPayload) && signalPayload.length ? signalPayload : daytradeSignals;
      const nextDaytradeSource = signalPayload?.source || daytradeSource;
      const nextDaytradeRisk = daytradeRiskResult.status === 'fulfilled' && daytradeRiskResult.value ? daytradeRiskResult.value : daytradeRisk;
      const nextBrokerStatus = brokerStatusResult.status === 'fulfilled' && brokerStatusResult.value ? brokerStatusResult.value : brokerStatus;
      const nextAutopilotStatus = autopilotResult.status === 'fulfilled' && autopilotResult.value ? autopilotResult.value : autopilotStatus;
      const nextAlertReport = alertResult.status === 'fulfilled' && alertResult.value ? alertResult.value : alertReport;
      const nextJquantsResearch = jquantsResult.status === 'fulfilled' && jquantsResult.value ? jquantsResult.value : jquantsResearch;
      setStocks(nextStocks);
      const topBuy = nextStocks.find((stock) => stock.ticker === PROPHET_PRO_RESULT.pick.ticker)
        || nextStocks.find((stock) => ['BUY_LIMIT_OK', 'BUY_ON_PULLBACK'].includes(stock.decision));
      const nextSelectedTicker = topBuy && (!selectedTicker || selectedTicker === PINNED_WATCH_TICKER)
        ? topBuy.ticker
        : selectedTicker;
      if (nextSelectedTicker !== selectedTicker) {
        setSelectedTicker(nextSelectedTicker);
      }
      if (nextStocks.length && !nextStocks.some((stock) => stock.ticker === selectedTicker)) {
        setSelectedTicker(nextStocks[0].ticker);
      }
      setPortfolio(nextPortfolio);
      setTransactions(nextTransactions);
      setDaytradePlan(nextDaytradePlan);
      setDaytradeSignals(nextDaytradeSignals);
      setDaytradeSource(nextDaytradeSource);
      setDaytradeRisk(nextDaytradeRisk);
      setBrokerStatus(nextBrokerStatus);
      setAutopilotStatus(nextAutopilotStatus);
      setAlertReport(nextAlertReport);
      setJquantsResearch(nextJquantsResearch);
      setStatus({ tone: 'good', text: `ライブ ${new Date().toLocaleTimeString('ja-JP')}` });
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        stocks: nextStocks,
        portfolio: nextPortfolio,
        transactions: nextTransactions,
        daytradePlan: nextDaytradePlan,
        daytradeSignals: nextDaytradeSignals,
        daytradeSource: nextDaytradeSource,
        daytradeRisk: nextDaytradeRisk,
        brokerStatus: nextBrokerStatus,
        autopilotStatus: nextAutopilotStatus,
        alertReport: nextAlertReport,
        jquantsResearch: nextJquantsResearch,
        advancedReport,
        jquantsCode,
        selectedTicker: nextSelectedTicker,
        detail,
      }));
    } catch (error) {
      setStatus({ tone: 'warn', text: 'オフライン高速表示' });
      addLog('SYS', `API応答を短縮: ${error.message}`);
    } finally {
      setBusy('');
    }
  }, [addLog, advancedReport, alertReport, autopilotStatus, daytradePlan, daytradeRisk, daytradeSignals, daytradeSource, detail, jquantsCode, jquantsResearch, portfolio, brokerStatus, selectedTicker, stocks, transactions]);

  const loadDetail = useCallback(async (ticker) => {
    setBusy('detail');
    try {
      const [detailResult, advancedResult] = await Promise.allSettled([
        api(`/stock/${encodeURIComponent(ticker)}`),
        api(`/analysis/advanced/${encodeURIComponent(ticker)}`, { timeout: 12000 }),
      ]);
      if (detailResult.status !== 'fulfilled') throw detailResult.reason;
      const data = detailResult.value;
      const nextAdvancedReport = advancedResult.status === 'fulfilled' ? advancedResult.value : null;
      setDetail(data);
      setAdvancedReport(nextAdvancedReport);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ stocks, portfolio, transactions, daytradePlan, daytradeSignals, daytradeSource, daytradeRisk, brokerStatus, autopilotStatus, alertReport, jquantsResearch, advancedReport: nextAdvancedReport, jquantsCode, selectedTicker: ticker, detail: data }));
      setStatus({ tone: nextAdvancedReport ? 'good' : 'warn', text: nextAdvancedReport ? `高度分析 ${ticker}` : `分析更新 ${ticker}` });
      if (advancedResult.status !== 'fulfilled') {
        addLog('SYS', `${ticker} の高度分析は未取得: ${advancedResult.reason?.message || 'unknown error'}`);
      }
    } catch (error) {
      addLog('SYS', `${ticker} の詳細取得をスキップ: ${error.message}`);
    } finally {
      setBusy('');
    }
  }, [addLog, alertReport, autopilotStatus, daytradePlan, daytradeRisk, daytradeSignals, daytradeSource, jquantsCode, jquantsResearch, portfolio, brokerStatus, stocks, transactions]);

  useEffect(() => {
    hydrate(false);
    const timer = window.setInterval(() => hydrate(true), 30000);
    return () => window.clearInterval(timer);
    // The first hydration owns the polling loop; state updates inside hydrate should not recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let timer;
    if (busy === 'screen') {
      timer = window.setInterval(async () => {
        try {
          const data = await api('/screen/progress', { timeout: 2000 });
          setScreenProgress(data);
        } catch {
          // ignore errors during polling
        }
      }, 1000);
    } else {
      setScreenProgress(null);
    }
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (selectedTicker) loadDetail(selectedTicker);
    // Detail loading is intentionally keyed only by ticker to avoid refetching on every cache update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicker]);

  const selectedStock = useMemo(
    () => stocks.find((stock) => stock.ticker === selectedTicker) || stocks[0],
    [selectedTicker, stocks],
  );
  const selectedQuality = useMemo(
    () => candidateQuality(selectedStock, detail),
    [detail, selectedStock],
  );

  const chartData = useMemo(() => {
    const source = detail?.chart?.length ? detail.chart : demo.portfolio.history.map((point, i) => ({
      date: point.date,
      close: Math.round(2300 + i * 12 + Math.sin(i / 2) * 85),
      volume: 800000 + i * 42000,
    }));
    return source.slice(-48).map((point) => ({
      date: point.date,
      close: point.close,
      high: point.high,
      low: point.low,
      volume: Math.round((point.volume || 0) / 1000),
      sma25: detail?.analysis?.indicators?.sma25 || null,
    }));
  }, [detail]);

  const allocation = useMemo(() => {
    const holdings = portfolio?.holdings?.map((item) => ({ name: item.name || item.ticker, value: item.value || 0 })) || [];
    return [...holdings, { name: '現金', value: portfolio?.cash || 0 }].filter((item) => item.value > 0);
  }, [portfolio]);

  const rankedStocks = useMemo(() => {
    return ensurePinnedWatchStock(stocks)
      .map((stock) => ({
        ...stock,
        candidateScore: candidateScore(stock),
        candidateReason: candidateReason(stock),
        mustInclude: stock.ticker === PINNED_WATCH_TICKER || Boolean(stock.mustInclude),
      }))
      .sort((a, b) => {
        const rankA = Number(a.candidateRank || 999);
        const rankB = Number(b.candidateRank || 999);
        return stockDecisionPriority(a) - stockDecisionPriority(b)
          || Number(b.confidence || 0) - Number(a.confidence || 0)
          || rankA - rankB
          || candidateScore(b) - candidateScore(a)
          || Number(b.price || 0) - Number(a.price || 0);
      })
      .slice(0, 12);
  }, [stocks]);

  const portfolioHealth = useMemo(() => {
    const holdings = portfolio?.holdings || [];
    const totalAssets = Number(portfolio?.totalAssets || 0);
    const cash = Number(portfolio?.cash || 0);
    const values = holdings.map((holding) => Number(holding.value || 0));
    const maxHoldingPct = totalAssets ? (Math.max(0, ...values) / totalAssets) * 100 : 0;
    const cashPct = totalAssets ? (cash / totalAssets) * 100 : 0;
    const closeValues = chartData.map((point) => Number(point.close || 0)).filter(Boolean);
    const returns = closeValues.slice(1).map((value, index) => (value - closeValues[index]) / closeValues[index]);
    const volatility = standardDeviation(returns) * Math.sqrt(252) * 100;
    const drawdown = maxDrawdown(closeValues);

    const diversificationScore = clamp((holdings.length / 5) * 55 + (100 - maxHoldingPct) * 0.45);
    const cashScore = cashPct >= 5 && cashPct <= 35 ? 100 : cashPct < 5 ? cashPct * 12 : Math.max(35, 100 - (cashPct - 35) * 1.3);
    const disciplineScore = detail?.analysis?.strategy?.stop_loss ? 88 : 52;
    const riskScore = clamp(100 - Math.max(0, volatility - 18) - Math.max(0, Math.abs(drawdown) - 12) * 1.5);
    const score = Math.round(diversificationScore * 0.34 + cashScore * 0.2 + disciplineScore * 0.22 + riskScore * 0.24);
    const strategy = detail?.analysis?.strategy || {};
    const entry = Number(strategy.buy_limit || 0);
    const rr = Number(strategy.rr_ratio || 0);

    const checklist = [
      { label: '明日買える上限価格を確認する', done: Boolean(entry) },
      { label: '損切り価格を先に決める', done: Boolean(strategy.stop_loss) },
      { label: '利確が損切り幅より十分大きい', done: rr >= 2 },
      { label: '100株を買う余力が残る', done: entry > 0 && cash >= entry * 100 },
      { label: '1銘柄の集中を50%以下に抑える', done: maxHoldingPct <= 50 },
      { label: '成行は板条件OK時だけにする', done: detail?.analysis?.execution?.marketAllowed || detail?.analysis?.execution?.decision !== 'BUY_NOW' },
    ];

    return {
      score,
      grade: score >= 82 ? 'A' : score >= 68 ? 'B' : score >= 52 ? 'C' : 'D',
      maxHoldingPct,
      cashPct,
      volatility,
      drawdown,
      checklist,
      completed: checklist.filter((item) => item.done).length,
    };
  }, [chartData, detail, portfolio]);

  const readyDaytradeSignals = useMemo(
    () => (daytradeSignals || []).filter((signal) => signal.state === 'READY'),
    [daytradeSignals],
  );
  const showOpeningGapDesk = autopilotStatus?.running;

  const [signalLabel] = signalMeta(detail?.analysis?.signal);
  const tradePlan = useMemo(() => {
    const strategy = detail?.analysis?.strategy || {};
    const execution = detail?.analysis?.execution || {};
    const price = Number(detail?.price || selectedStock?.price || 0);
    const entry = Number(strategy.buy_limit || 0);
    const target = Number(strategy.sell_limit || 0);
    const stop = Number(strategy.stop_loss || 0);
    const riskPerShare = Number(execution.riskPerShare || Math.max(entry - stop, 0));
    const entryGapPct = Number.isFinite(Number(execution.entryGapPct))
      ? Number(execution.entryGapPct)
      : entry && price ? ((entry / price) - 1) * 100 : 0;
    const assets = Number(portfolio?.totalAssets || 1000000);
    const cash = Number(portfolio?.cash || 0);
    const maxRiskJpy = assets * 0.01;
    const maxBudgetJpy = Math.min(cash, assets * 0.25);
    const byRisk = riskPerShare > 0 ? Math.floor(maxRiskJpy / riskPerShare / 100) * 100 : 0;
    const byCash = entry > 0 ? Math.floor(maxBudgetJpy / entry / 100) * 100 : 0;
    const suggestedShares = Math.max(0, Math.min(byRisk || 0, byCash || 0));
    const decision = execution.decision || 'WATCH';
    const tone = ['DAYTRADE_ENTRY_OK', 'BUY_LIMIT_OK', 'BUY_ON_PULLBACK', 'REPRICE_FOR_DAYTRADE'].includes(decision) ? 'buy' : decision === 'AVOID' ? 'sell' : 'hold';
    return {
      decision,
      tone,
      label: execution.label || signalLabel,
      headline: execution.headline || detail?.analysis?.reason || '分析結果を取得中です。',
      plainReason: execution.plainReason || detail?.analysis?.technicalSummary || detail?.analysis?.reason || '',
      entryCondition: execution.entryCondition || '条件が揃うまで待つ',
      avoidCondition: execution.avoidCondition || '損切りラインを割ったら見送り',
      entry,
      target,
      stop,
      rr: strategy.rr_ratio || '-',
      entryGapPct,
      maxRiskJpy,
      suggestedShares,
      suggestedRiskJpy: suggestedShares * riskPerShare,
      suggestedBudgetJpy: suggestedShares * entry,
      oneLotAffordable: entry > 0 && cash >= entry * 100,
      marketAllowed: Boolean(execution.marketAllowed),
      orderStyle: execution.orderStyle || 'limit_only',
    };
  }, [detail, portfolio, selectedStock, signalLabel]);

  const decisionGate = useMemo(() => {
    const rr = Number(tradePlan.rr || 0);
    const items = [
      {
        label: '明日買える価格帯である',
        ok: tradePlan.entry > 0 && tradePlan.entryGapPct <= 0.35 && tradePlan.entryGapPct >= -1.5,
        detail: '買えない深い指値ではなく、現在値近辺の上限価格だけを採用します。',
      },
      {
        label: '損切りが先に決まっている',
        ok: tradePlan.stop > 0 && tradePlan.stop < tradePlan.entry,
        detail: '損失額を先に固定し、感情で保有し続ける事故を防ぎます。',
      },
      {
        label: 'RRが最低2.0以上',
        ok: rr >= 2,
        detail: '勝率ではなく期待値で判断します。',
      },
      {
        label: '1回の想定損失が資産1%以内',
        ok: tradePlan.suggestedRiskJpy <= tradePlan.maxRiskJpy && tradePlan.suggestedRiskJpy > 0,
        detail: '連敗しても破綻しにくいサイズに抑えます。',
      },
      {
        label: 'データ出所を確認済み',
        ok: Boolean(detail?.freshness?.priceOk),
        detail: '最新日足の日付が古い場合は実注文判断に使いません。',
      },
      {
        label: 'デイトレ買い候補の判定である',
        ok: ['DAYTRADE_ENTRY_OK', 'BUY_LIMIT_OK'].includes(tradePlan.decision),
        detail: '押し目待ちや観察銘柄を、明日買う候補には混ぜません。',
      },
      {
        label: '直近ニュース鮮度を確認済み',
        ok: Boolean(detail?.freshness?.newsOk),
        detail: '材料が古い場合は、ニュース未確認として一段落として扱います。',
      },
      {
        label: 'ブローカー連携なし',
        ok: brokerStatus?.mode === 'BROKER_DISABLED',
        detail: 'この画面は注文実行ではなく、証券会社で手入力する前の確認票です。',
      },
    ];
    const passed = items.filter((item) => item.ok).length;
    return {
      items,
      passed,
      total: items.length,
      ready: passed === items.length,
      label: passed === items.length ? '注文準備OK' : '待機 / 再確認',
    };
  }, [brokerStatus, detail, tradePlan]);

  const dataProvenance = useMemo(() => {
    const policy = jquantsResearch?.dataPolicy;
    return [
      {
        label: '価格データ',
        value: detail?.latestBarDate ? `${detail.latestBarDate} 更新` : jquantsResearch?.latestQuote?.source || detail?.source || '未確認',
        note: detail?.latestBarAgeDays != null
          ? `最新日足は${detail.latestBarAgeDays}日前。直近12週間はyfinance補完、リアルタイム板ではありません。`
          : '価格鮮度を確認できない場合は実注文判断に使いません。',
      },
      {
        label: '直近値動き',
        value: detail?.recentWindow?.priceChangePct != null ? pct(detail.recentWindow.priceChangePct) : '-',
        note: detail?.recentWindow?.from
          ? `${detail.recentWindow.from}〜${detail.recentWindow.to} / ${detail.recentWindow.tradingDays}営業日`
          : '直近2週間相当の終値変化を取得できません。',
      },
      {
        label: 'ニュース',
        value: detail?.news?.count ? `${detail.news.count}件` : '未取得',
        note: detail?.news?.latestPublishedAt
          ? `最新: ${shortDate(detail.news.latestPublishedAt)} / 14日超なら材料未確認として扱います。`
          : 'ニュースが取得できない場合は、材料未確認として扱います。',
      },
      {
        label: '公式履歴',
        value: jquantsResearch?.configured ? 'J-Quants API' : '未接続',
        note: policy ? `${policy.recentWindowDays}日以内は補完、古い履歴はJ-Quants` : 'J-Quants設定後に公式履歴を確認できます。',
      },
    ];
  }, [detail, jquantsResearch]);

  async function runAction(kind) {
    const paths = { auto: '/auto-trade', screen: '/screen', learn: '/learn', reset: '/reset' };
    const labels = { auto: 'AI自動運用', screen: '全市場スクリーニング', learn: 'AI学習', reset: 'リセット' };
    const warnings = {
      auto: 'シミュレーション上の自動売買記録を作成します。実売買ではありませんが、履歴が変わります。続行しますか？',
      learn: '過去のシミュレーション結果からローカル学習値を更新します。続行しますか？',
      reset: 'ポートフォリオ、取引履歴、判断履歴を初期化します。取り消せません。続行しますか？',
    };
    if (warnings[kind] && !window.confirm(warnings[kind])) {
      addLog('SAFE', `${labels[kind]}をキャンセルしました。`);
      return;
    }
    setBusy(kind);
    addLog('Jobs', `${labels[kind]}を実行します。`);
    try {
      const result = await api(paths[kind], {
        method: 'POST',
        timeout: kind === 'screen' ? 180000 : 9000,
        body: kind === 'screen' ? JSON.stringify({ force: true }) : undefined,
      });
      addLog(result?.success === false ? 'SAFE' : 'API', result?.message || `${labels[kind]}が完了しました。`);
      await hydrate(true);
      if (selectedTicker) await loadDetail(selectedTicker);
    } catch (error) {
      addLog('SYS', `${labels[kind]}は未完了: ${error.message}`);
    } finally {
      setBusy('');
    }
  }

  async function scanDaytradeSignals() {
    setBusy('daytrade');
    addLog('Jobs', '短期ペーパー検証を更新します。楽天証券・MarketSpeed連携は使いません。');
    try {
      const result = await api('/daytrade/scan', { method: 'POST', timeout: 9000 });
      const nextSignals = result?.signals?.length ? result.signals : daytradeSignals;
      setDaytradeSignals(nextSignals);
      setDaytradeSource(result?.source || daytradeSource);
      addLog('SIM', result?.message || 'ペーパーシグナル検証が完了しました。');
      await hydrate(true);
    } catch (error) {
      addLog('SYS', `デイトレ検証に失敗しました: ${error.message}`);
    } finally {
      setBusy('');
    }
  }

  async function toggleAutopilot() {
    const action = autopilotStatus?.running ? 'stop' : 'start';
    setBusy('autopilot');
    addLog('Jobs', action === 'start' ? 'PAPER_AUTOを開始します。外部ブローカーには接続しません。' : 'PAPER_AUTOを停止します。');
    try {
      const result = await api(`/daytrade/autopilot/${action}`, { method: 'POST', timeout: 9000 });
      setAutopilotStatus(result);
      await hydrate(true);
    } catch (error) {
      addLog('SYS', `オートパイロット操作に失敗しました: ${error.message}`);
    } finally {
      setBusy('');
    }
  }

  async function loadJquantsResearch() {
    const code = (jquantsCode || selectedTicker || '4980.T').trim();
    setBusy('jquants');
    addLog('J-Quants', `${code} の日本株リサーチ補助データを確認します。発注は行いません。`);
    try {
      const result = await api(`/research/jquants/${encodeURIComponent(code)}`, { timeout: 12000 });
      setJquantsResearch(result);
      addLog('J-Quants', result?.summary || 'J-Quantsリサーチ補助データを読み込みました。');
      localStorage.setItem(CACHE_KEY, JSON.stringify({ stocks, portfolio, transactions, daytradePlan, daytradeSignals, daytradeSource, daytradeRisk, brokerStatus, autopilotStatus, alertReport, jquantsResearch: result, advancedReport, jquantsCode: code, selectedTicker, detail }));
    } catch (error) {
      addLog('J-Quants', `J-Quantsリサーチを利用できません: ${error.message}`);
    } finally {
      setBusy('');
    }
  }

  function updatePositionForm(field, value) {
    setPositionForm((current) => ({ ...current, [field]: value }));
  }

  async function saveManualPosition(event) {
    event.preventDefault();
    const payload = {
      ticker: positionForm.ticker.trim(),
      name: positionForm.name.trim() || undefined,
      entryPrice: Number(positionForm.entryPrice),
      shares: Number(positionForm.shares),
      note: positionForm.note.trim() || undefined,
    };
    if (!payload.ticker || !Number.isFinite(payload.entryPrice) || !Number.isFinite(payload.shares)) {
      addLog('SAFE', '銘柄、買値、株数を確認してください。');
      return;
    }
    setBusy('position');
    addLog('Jobs', `${payload.ticker} ${payload.entryPrice}円 ${payload.shares}株を保有台帳へ記録します。実注文は出しません。`);
    try {
      const result = await api('/portfolio/positions', {
        method: 'POST',
        timeout: 12000,
        body: JSON.stringify(payload),
      });
      addLog('PORT', result?.message || '保有台帳を更新しました。');
      await hydrate(true);
    } catch (error) {
      addLog('SYS', `保有台帳の更新に失敗しました: ${error.message}`);
    } finally {
      setBusy('');
    }
  }

  async function closePortfolioPosition(holding, action) {
    const actionLabel = {
      SOLD: '売却済み',
      VOIDED: '入力ミス訂正',
      ARCHIVED: '非表示保管',
    }[action] || action;
    const reason = {
      SOLD: '売却したため通常ポートフォリオから外す',
      VOIDED: '入力ミスのため訂正として通常ポートフォリオから外す',
      ARCHIVED: '現在の確認対象ではないため通常ポートフォリオから外す',
    }[action] || 'portfolio lifecycle update';

    setBusy(`position-${holding.ticker}-${action}`);
    setStatus({ tone: 'warn', text: `${actionLabel}処理中` });
    addLog('Jobs', `${holding.ticker} を${actionLabel}として台帳に残します。削除も実注文もしません。`);
    try {
      const result = await api(`/portfolio/positions/${encodeURIComponent(holding.ticker)}/lifecycle`, {
        method: 'POST',
        timeout: 12000,
        body: JSON.stringify({
          action,
          price: Number(holding.currentPrice || holding.avgCost || 0),
          reason,
        }),
      });
      addLog('PORT', result?.message || `${holding.ticker} を${actionLabel}にしました。`);
      await hydrate(true);
      setStatus({ tone: 'good', text: `${actionLabel}完了` });
    } catch (error) {
      addLog('SYS', `${holding.ticker} の台帳状態更新に失敗しました: ${error.message}`);
      setStatus({ tone: 'bad', text: `${actionLabel}失敗` });
    } finally {
      setBusy('');
    }
  }

  const jquantsConfigured = Boolean(jquantsResearch?.configured);
  const jquantsStatusLabel = jquantsConfigured ? 'J-Quants 接続済み' : 'J-Quants 未接続';
  const jquantsStatusTone = jquantsConfigured ? 'good' : 'neutral';
  const jquantsModeLabel = jquantsConfigured ? jquantsResearch?.mode : 'トークン未設定';
  const jquantsTargetLabel = jquantsResearch?.issue?.name || jquantsResearch?.code || jquantsCode;
  const jquantsLatestClose = jquantsConfigured && jquantsResearch?.latestQuote?.close ? yen(jquantsResearch.latestQuote.close) : '未取得';
  const jquantsEpsBps = jquantsConfigured
    ? `${jquantsResearch?.latestStatement?.earningsPerShare || '-'} / ${jquantsResearch?.latestStatement?.bookValuePerShare || '-'}`
    : '未取得';
  const jquantsNote = jquantsResearch?.summary || jquantsResearch?.nextStep || 'J-Quants APIトークンを設定すると、銘柄マスタ・日足・財務データを読み取り専用で取得できます。未設定でもアプリ本体は利用できます。';
  const prophetGateApplies = selectedTicker === PROPHET_PRO_RESULT.pick.ticker || detail?.ticker === PROPHET_PRO_RESULT.pick.ticker;
  const prophetValidated = prophetGateApplies
    && advancedReport?.verdict === 'ADVANCED_READY'
    && Number(advancedReport?.walkForward?.edgePct || 0) > 0
    && advancedReport?.guardrails?.every((item) => item.ok);
  const tradeStrategyTitle = prophetValidated
    ? `デイトレ買い候補 ${PROPHET_PRO_RESULT.pick.ticker} ${PROPHET_PRO_RESULT.pick.name}`
    : `見送り・監視 ${PROPHET_PRO_RESULT.pick.ticker} ${PROPHET_PRO_RESULT.pick.name}`;
  const tradeStrategyTone = prophetValidated ? 'buy' : 'warn';

  return (
    <div className="app-shell">
      <header className="command-bar">
        <div className="brand-block">
          <div className="brand-mark"><Sparkles size={22} /></div>
          <div>
            <h1>Zen Stock Prophet Pro</h1>
            <p>AI投資シミュレーター / ジョブズ管理</p>
          </div>
        </div>
        <div className="command-actions">
          <StatusPill label={status.text} tone={status.tone} />
          <button className="icon-button" title="更新" onClick={() => hydrate(false)} disabled={busy === 'sync'}>
            {busy === 'sync' ? <Loader2 size={18} className="spin" /> : <RefreshCcw size={18} />}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className={`jobs-brief actionable-insights ${prophetValidated ? 'ready' : 'watch'}`}>
          <div>
            <div className="section-title"><Zap size={18} /><span>Jobs Decision</span></div>
            <h2>{tradeStrategyTitle}</h2>
            <p>
              <strong>ジョブズ判断:</strong> {prophetValidated
                ? '高精度ゲートを通過。板厚・スプレッド・VWAP付近を確認できる場合だけ、手入力候補にします。'
                : '過去検証が市場全体平均に勝っていないため、今は昇格させません。監視に留め、条件が改善したら再評価します。'}
            </p>
            <div className="decision-pill-row">
              <StatusPill label={`実行: ${prophetValidated ? '候補' : '見送り・監視'}`} tone={tradeStrategyTone} />
              <StatusPill label={`高精度 ${advancedReport?.compositeScore ?? '-'} / 100`} tone={scoreTone(advancedReport?.compositeScore)} />
              <StatusPill label={`過去エッジ ${pct(advancedReport?.walkForward?.edgePct)}`} tone={Number(advancedReport?.walkForward?.edgePct || 0) > 0 ? 'good' : 'warn'} />
              <StatusPill label="実注文オフ" tone="warn" />
            </div>
          </div>
          <div className="brief-score">
            <strong>{advancedReport?.compositeScore ?? '-'}</strong>
            <span>Final Gate</span>
          </div>
        </section>

        <section className="advanced-analysis-panel" aria-label="高度分析">
          <div className="advanced-analysis-head">
            <div>
              <div className="section-title"><BrainCircuit size={18} /><span>高度分析エンジン</span></div>
              <h2>{advancedReport?.actionLabel || '銘柄選択に連動して確率分析を準備中'}</h2>
              <p>
                1年分の日足から、トレンド整列、モメンタム、流動性、変動率、5営業日シナリオ、過去条件一致のウォークフォワード検証、100株単位の損失許容を同時に確認します。
                実注文は作成せず、判断補助だけを表示します。
              </p>
            </div>
            <StatusPill
              label={advancedReport ? `総合 ${advancedReport.compositeScore}/100` : '取得待ち'}
              tone={scoreTone(advancedReport?.compositeScore)}
            />
          </div>
          <div className="advanced-score-grid">
            {[
              ['トレンド', advancedReport?.factors?.trend?.score, advancedReport?.factors?.trend?.state || '-'],
              ['勢い', advancedReport?.factors?.momentumScore, `5日 ${pct(advancedReport?.factors?.momentum5Pct)} / 20日 ${pct(advancedReport?.factors?.momentum20Pct)}`],
              ['流動性', advancedReport?.factors?.liquidityScore, `出来高 ${ratioLabel(advancedReport?.factors?.volumeRatio)}`],
              ['守備力', advancedReport?.factors?.riskControlScore, `ATR ${pct(advancedReport?.factors?.atrPct)} / DD ${pct(advancedReport?.factors?.maxDrawdown60Pct)}`],
              ['検証力', advancedReport?.walkForward?.score, `一致 ${advancedReport?.walkForward?.sampleCount ?? 0}件 / エッジ ${pct(advancedReport?.walkForward?.edgePct)}`],
              ['データ品質', advancedReport?.dataQuality?.score, `${advancedReport?.dataQuality?.bars ?? 0}本 / ${advancedReport?.dataQuality?.verdict || '-'}`],
            ].map(([label, value, note]) => (
              <div key={label} className={`advanced-factor ${scoreTone(value)}`}>
                <span>{label}</span>
                <strong>{value != null ? `${Number(value).toFixed(1)}` : '-'}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>
          <div className="advanced-detail-grid">
            <div className="scenario-tape">
              <span>5営業日シナリオ</span>
              <div>
                {(advancedReport?.scenarios || [
                  { name: '強気', returnPct: 0, price: 0 },
                  { name: '標準', returnPct: 0, price: 0 },
                  { name: '弱気', returnPct: 0, price: 0 },
                ]).map((scenario) => (
                  <article key={scenario.name}>
                    <b>{scenario.name}</b>
                    <strong>{pct(scenario.returnPct)}</strong>
                    <small>{scenario.price ? yen(scenario.price) : '-'}</small>
                  </article>
                ))}
              </div>
            </div>
            <div className="probability-panel">
              <span>確率レンジ</span>
              <strong>{advancedReport ? `${advancedReport.monteCarlo.probabilityUpPct.toFixed(1)}%` : '-'}</strong>
              <small>
                上昇確率 / 期待リターン {advancedReport ? pct(advancedReport.monteCarlo.expectedReturnPct) : '-'} /
                標本 {advancedReport?.monteCarlo?.sampleCount || 0}
              </small>
            </div>
            <div className="position-plan-panel">
              <span>1%リスクの建玉</span>
              <strong>{advancedReport ? `${advancedReport.positionPlan.suggestedShares}株` : '-'}</strong>
              <small>
                入口 {yen(advancedReport?.positionPlan?.entryPrice)} / 損切 {yen(advancedReport?.positionPlan?.stopPrice)} /
                RR 1:{advancedReport?.positionPlan?.riskReward || '-'}
              </small>
            </div>
            <div className="probability-panel">
              <span>過去検証</span>
              <strong>{advancedReport ? `${advancedReport.walkForward.hitRatePct.toFixed(1)}%` : '-'}</strong>
              <small>
                勝率 / 平均 {advancedReport ? pct(advancedReport.walkForward.avgReturnPct) : '-'} /
                全体比 {advancedReport ? pct(advancedReport.walkForward.edgePct) : '-'}
              </small>
            </div>
          </div>
          <div className="advanced-guardrails">
            {(advancedReport?.guardrails || []).map((item) => (
              <div key={item.label} className={item.ok ? 'pass' : 'block'}>
                <b>{item.ok ? 'PASS' : 'STOP'}</b>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="advanced-explainability">
            {(advancedReport?.explainability || []).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </section>

        {jquantsConfigured ? (
        <section className="jquants-panel">
          <div className="jquants-head">
            <div>
              <div className="section-title"><Activity size={18} /><span>J-Quantsリサーチ</span></div>
              <h2>日本株の公式ヒストリカル / 財務データ補助</h2>
              <p>JPX系のJ-Quants APIを読み取り専用で使います。楽天証券やMarketSpeedには接続せず、売買判断の根拠確認だけに使います。</p>
            </div>
            <StatusPill label={jquantsStatusLabel} tone={jquantsStatusTone} />
          </div>
          <div className="jquants-controls">
            <input
              value={jquantsCode}
              onChange={(event) => setJquantsCode(event.target.value)}
              placeholder="4980.T"
              aria-label="J-Quants銘柄コード"
            />
            <button className="treasure-button" onClick={loadJquantsResearch} disabled={!!busy}>
              {busy === 'jquants' ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
              <span>確認</span>
            </button>
          </div>
          <div className="jquants-grid">
            <div className="metric">
              <span>接続状態</span>
              <strong>{jquantsModeLabel || '確認中'}</strong>
            </div>
            <div className="metric">
              <span>対象</span>
              <strong>{jquantsTargetLabel}</strong>
            </div>
            <div className="metric">
              <span>最新終値</span>
              <strong>{jquantsLatestClose}</strong>
            </div>
            <div className="metric">
              <span>EPS / BPS</span>
              <strong>{jquantsEpsBps}</strong>
            </div>
          </div>
          <div className="jquants-note">
            <ShieldCheck size={16} />
            <span>{jquantsNote}</span>
          </div>
        </section>
        ) : null}

        {showOpeningGapDesk && (
        <section className="daytrade-panel">
          <div className="daytrade-head">
            <div>
              <div className="section-title"><Activity size={18} /><span>Opening Gap Desk</span></div>
              <h2>ローカル短期シミュレーション</h2>
              <p>{daytradePlan?.premise}</p>
            </div>
            <div className="daytrade-actions">
              <StatusPill label={daytradeRisk?.liveOrderMode === 'disabled' ? '実注文オフ' : '実行前確認'} tone={daytradeRisk?.liveOrderMode === 'disabled' ? 'warn' : 'good'} />
              <button className="icon-button" title="ペーパー検証更新" onClick={scanDaytradeSignals} disabled={!!busy}>
                {busy === 'daytrade' ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
              </button>
              <button className="icon-button" title={autopilotStatus?.running ? 'オートパイロット停止' : 'オートパイロット開始'} onClick={toggleAutopilot} disabled={!!busy}>
                {busy === 'autopilot' ? <Loader2 size={18} className="spin" /> : autopilotStatus?.running ? <RotateCcw size={18} /> : <Play size={18} />}
              </button>
            </div>
          </div>
          <div className="sim-status-row">
            <span>Data source: <b>{daytradeSource}</b></span>
            <span>Broker link: <b>DISABLED</b></span>
            <span>オートパイロット: <b>{autopilotStatus?.running ? '稼働中' : '停止中'}</b></span>
            <span>Cycles: <b>{autopilotStatus?.cycles || 0}</b></span>
            <span>{brokerStatus?.message}</span>
          </div>
          <div className="daytrade-grid">
            <div className="daytrade-rules">
              {[
                ['Gap', `±${daytradePlan?.rules?.gapAbsPct || 3}%以上`],
                ['流動性倍率', `${daytradePlan?.rules?.minBookRatio || 1.5}倍以上`],
                ['スプレッド', `${daytradePlan?.rules?.maxSpreadPct || 0.15}%以下`],
                ['利確/損切り', `+${daytradePlan?.rules?.takeProfitPct || 1}% / -${daytradePlan?.rules?.stopLossPct || 0.5}%`],
                ['リスク', `${daytradePlan?.rules?.riskPerTradePct || 2}% / 最大${daytradePlan?.rules?.maxPositions || 3}建玉`],
              ].map(([label, value]) => (
                <div className="metric" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="signal-stack">
              {(daytradeSignals || []).slice(0, 3).map((signal) => (
                <article className={`signal-ticket ${signal.state === 'READY' ? 'ready' : 'rejected'}`} key={`${signal.ticker}-${signal.strategy}`}>
                  <div>
                    <StatusPill label={signal.state === 'READY' ? '準備完了' : '見送り'} tone={signal.state === 'READY' ? 'buy' : 'warn'} />
                    <strong>{signal.ticker} {signal.name}</strong>
                    <span>{signal.strategy} / 機械判定 {Math.round(Number(signal.mlProbability || 0) * 100)}%</span>
                  </div>
                  <div className="ticket-order">
                    <b>{signal.side}</b>
                    <span>指値 {yen(signal.limitPrice)} x {signal.shares}株</span>
                    <span>利確 {yen(signal.takeProfit)} / 損切り {yen(signal.stopLoss)}</span>
                    <span>期限 {signal.expiresAt}</span>
                  </div>
                  <p>{signal.reason}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="daytrade-verdict">
            <ShieldCheck size={16} />
            <span>{daytradeRisk?.jobsVerdict}</span>
            <strong>準備完了 {readyDaytradeSignals.length}</strong>
          </div>
        </section>
        )}

        <section className="hero-panel">
          <div className="market-list">
            <div className="watchlist-header">
              <div className="watchlist-title">
                <span><Layers3 size={16} /> AI発掘</span>
                <strong>お宝銘柄ウォッチリスト</strong>
              </div>
              <button className="treasure-button" onClick={() => runAction('screen')} disabled={busy === 'screen'} title="お宝銘柄を発掘">
                {busy === 'screen' ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
                <span>発掘</span>
              </button>
            </div>
            {busy === 'screen' && screenProgress && (
              <div style={{ padding: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '6px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#10b981', fontWeight: 'bold' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Loader2 size={14} className="spin" /> {screenProgress.message}
                  </span>
                  {screenProgress.total > 0 && <span>{Math.round((screenProgress.progress / screenProgress.total) * 100)}%</span>}
                </div>
                {screenProgress.total > 0 && (
                  <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${(screenProgress.progress / screenProgress.total) * 100}%`, height: '100%', background: '#10b981', transition: 'width 0.3s ease-out' }}></div>
                  </div>
                )}
              </div>
            )}
            <div className="stock-rail">
              {rankedStocks.map((stock) => (
                <button
                  key={stock.ticker}
                  className={`stock-card ${stock.ticker === selectedTicker ? 'active' : ''} ${stock.mustInclude ? 'pinned' : ''} ${stockDecisionTone(stock.decision)}`}
                  onClick={() => setSelectedTicker(stock.ticker)}
                >
                  <span className="candidate-badge">
                    {stock.decision === 'DAYTRADE_ENTRY_OK' ? 'デイトレ可' : stock.decision === 'BUY_LIMIT_OK' ? '買い検討' : stock.decision === 'REPRICE_FOR_DAYTRADE' ? '再計算' : stock.decision === 'BUY_ON_PULLBACK' ? '押し目買い' : stock.mustInclude ? '固定観察' : '観察'}
                  </span>
                  <span className="stock-emoji">{stock.emoji || 'JP'}</span>
                  <span className="stock-name">{stock.name || stock.ticker}</span>
                  <span className="stock-meta">{stock.ticker}</span>
                  <span className="candidate-score">AI確度 {stock.confidence ?? Math.round(stock.candidateScore)}%</span>
                  {stock.buyLimit && <span className="candidate-score">上限 {yen(stock.buyLimit)} / {pct(stock.entryGapPct)}</span>}
                  <span className="candidate-reason">{stock.candidateReason}</span>
                  <strong>{yen(stock.price)}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="focus-card">
            <div className="focus-head">
              <div>
                <small>{selectedStock?.ticker}</small>
                <h2>{selectedStock?.emoji || 'JP'} {selectedStock?.name || selectedTicker}</h2>
              </div>
              <div className="price-block">
                <strong>{yen(detail?.price || selectedStock?.price)}</strong>
                <span className={Number(detail?.changePct || 0) >= 0 ? 'up' : 'down'}>
                  {Number(detail?.changePct || 0) >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  {pct(detail?.changePct)}
                </span>
              </div>
            </div>

            <div className="ai-strip">
              <StatusPill label={tradePlan.label} tone={tradePlan.tone} />
              <p>{tradePlan.plainReason || 'API応答前でも、キャッシュとデモデータで画面を一時表示します。'}</p>
            </div>

            <div className="tab-row">
              {[
                ['plan', Sparkles, '判断'],
                ['chart', LineChartIcon, '値動き'],
                ['risk', ShieldCheck, 'リスク'],
                ['allocation', BarChart3, '配分'],
              ].map(([id, Icon, label]) => (
                <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
                  {React.createElement(Icon, { size: 15 })} {label}
                </button>
              ))}
            </div>

            {activeTab === 'plan' && (
              <div className="decision-lab">
                <div className="decision-hero">
                  <StatusPill label={tradePlan.label} tone={tradePlan.tone} />
                  <h3>{tradePlan.headline}</h3>
                  <p>{tradePlan.plainReason}</p>
                </div>
                <div className="decision-grid">
                  <div className="decision-card primary">
                    <span>明日買う上限価格</span>
                    <strong>{yen(tradePlan.entry)}以下</strong>
                    <p>現在値から {pct(tradePlan.entryGapPct)}。深い押し目待ちではなく、買える範囲の上限指値です。</p>
                  </div>
                  <div className="decision-card">
                    <span>利確 / 損切り</span>
                    <strong>{yen(tradePlan.target)} / {yen(tradePlan.stop)}</strong>
                    <p>RR 1:{tradePlan.rr}。損切り価格を先に決め、利確は後から欲張りません。</p>
                  </div>
                  <div className="decision-card">
                    <span>株数目安</span>
                    <strong>{tradePlan.suggestedShares > 0 ? `${tradePlan.suggestedShares}株` : '今回は見送り'}</strong>
                    <p>想定損失 {yen(tradePlan.suggestedRiskJpy)} / 上限 {yen(tradePlan.maxRiskJpy)}。100株の余力確認も必要。</p>
                  </div>
                  <div className="decision-card danger">
                    <span>買わない条件</span>
                    <strong>撤退条件</strong>
                    <p>{tradePlan.avoidCondition}</p>
                  </div>
                </div>
                <div className="evidence-panel">
                  <div>
                    <span>翌日パターン検証</span>
                    <p>{backtestLabel(selectedQuality?.backtest)} / 品質 {selectedQuality?.qualityScore ?? '-'}%。買える価格帯、出来高、過熱、RRを同じゲートで確認します。</p>
                  </div>
                  <div>
                    <span>通過ゲート</span>
                    <p>
                      {(selectedQuality?.gates || []).slice(0, 5).map((gate) => `${gate.ok ? 'OK' : 'NG'} ${gate.label}`).join(' / ') || '検証データを取得中です。'}
                    </p>
                  </div>
                  <div>
                    <span>買ってよい条件</span>
                    <p>{tradePlan.entryCondition}</p>
                  </div>
                  <div>
                    <span>候補に残した根拠</span>
                    <p>{selectedStock?.candidateReason || detail?.analysis?.technicalSummary || '候補理由を取得中です。'}</p>
                  </div>
                  <div>
                    <span>テクニカル補足</span>
                    <ul>
                      {(detail?.analysis?.details || []).slice(0, 4).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                  <div>
                    <span>直近ニュース</span>
                    <p>
                      {detail?.news?.items?.[0]?.title
                        ? `${detail.news.items[0].title} (${shortDate(detail.news.items[0].publishedAt)} / ${detail?.freshness?.newsOk ? '直近材料' : '古い材料'})`
                        : '取得できるニュースがありません。材料未確認として扱います。'}
                    </p>
                  </div>
                </div>
                <div className="order-prep-panel">
                  <div className="order-prep-head">
                    <div>
                      <span>Order Prep Ticket</span>
                      <h3>証券会社で手入力する前の確認票</h3>
                    </div>
                    <StatusPill label={decisionGate.label} tone={decisionGate.ready ? 'good' : 'warn'} />
                  </div>
                  <div className="order-prep-grid">
                    <div><span>注文種別</span><strong>{tradePlan.marketAllowed ? '近い指値 / 成行許容' : '近い指値'}</strong><small>成行は板条件OK時のみ</small></div>
                    <div><span>銘柄</span><strong>{selectedStock?.ticker}</strong><small>{selectedStock?.name}</small></div>
                    <div><span>上限価格</span><strong>{yen(tradePlan.entry)}</strong><small>届かなければ見送り</small></div>
                    <div><span>株数上限</span><strong>{tradePlan.suggestedShares > 0 ? `${tradePlan.suggestedShares}株` : '0株'}</strong><small>最大損失 {yen(tradePlan.suggestedRiskJpy)}</small></div>
                  </div>
                  <div className="gate-list">
                    {decisionGate.items.map((item) => (
                      <div key={item.label} className={item.ok ? 'pass' : 'block'}>
                        <b>{item.ok ? 'PASS' : 'STOP'}</b>
                        <span>{item.label}</span>
                        <small>{item.detail}</small>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="provenance-grid">
                  {dataProvenance.map((source) => (
                    <div key={source.label}>
                      <span>{source.label}</span>
                      <strong>{source.value}</strong>
                      <p>{source.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'chart' && (
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={330}>
                  <ComposedChart data={chartData} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="price" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16f1a4" stopOpacity={0.34} />
                        <stop offset="100%" stopColor="#16f1a4" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(148,163,184,.12)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="price" domain={['dataMin - 80', 'dataMax + 80']} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `¥${Math.round(v)}`} tickLine={false} axisLine={false} width={68} />
                    <YAxis yAxisId="volume" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={46} />
                    <Tooltip content={<ProTooltip />} />
                    <Bar yAxisId="volume" dataKey="volume" name="出来高" fill="rgba(56,189,248,.16)" radius={[3, 3, 0, 0]} />
                    <Area yAxisId="price" type="monotone" dataKey="close" name="終値" stroke="#16f1a4" strokeWidth={3} fill="url(#price)" dot={false} />
                    <Line yAxisId="price" type="monotone" dataKey="sma25" name="SMA25" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {activeTab === 'risk' && (
              <div className="risk-stack">
                <div className="risk-grid">
                  {[
                    ['RSI', detail?.analysis?.indicators?.rsi?.toFixed?.(1) || '-'],
                    ['MACD', detail?.analysis?.indicators?.macd?.macd?.toFixed?.(2) || '-'],
                    ['年率変動', `${portfolioHealth.volatility.toFixed(1)}%`],
                    ['最大下落', `${portfolioHealth.drawdown.toFixed(1)}%`],
                    ['集中度', `${portfolioHealth.maxHoldingPct.toFixed(1)}%`],
                    ['現金比率', `${portfolioHealth.cashPct.toFixed(1)}%`],
                    ['利確目安', yen(detail?.analysis?.strategy?.sell_limit)],
                    ['損切り目安', yen(detail?.analysis?.strategy?.stop_loss)],
                  ].map(([label, value]) => (
                    <div className="metric" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="checklist">
                  {portfolioHealth.checklist.map((item) => (
                    <div key={item.label} className={item.done ? 'done' : ''}>
                      <span>{item.done ? 'OK' : '!'}</span>
                      <p>{item.label}</p>
                    </div>
                  ))}
                </div>
                <div className="risk-psychology">
                  <div>
                    <strong>FOMO防止</strong>
                    <p>急騰・出来高増加時ほど「今すぐ買う」ではなく、指値・損切り・最大損失が揃うまで待機します。</p>
                  </div>
                  <div>
                    <strong>AI過信防止</strong>
                    <p>AIスコアは候補抽出の補助です。反証条件と買わない条件が未確認なら、実注文の根拠にしません。</p>
                  </div>
                  <div>
                    <strong>成行警戒</strong>
                    <p>初心者は緑色や上昇率に引っ張られやすいため、この画面では成行注文を推奨しません。</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'allocation' && (
              <div className="allocation-grid">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={72} outerRadius={108} paddingAngle={3}>
                      {allocation.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value) => yen(value)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

          </div>
        </section>

        <section className="portfolio-manager">
          <div className="portfolio-manager-head">
            <div>
              <div className="section-title"><BriefcaseBusiness size={18} /><span>保有台帳と売却判断</span></div>
              <h2>買った銘柄を保存し、売るタイミングを毎回見直す</h2>
              <p>買値・株数を手入力すると、現在値、含み損益、地合い、値動きから利確・撤退・保有継続の目安を出します。注文は出しません。</p>
            </div>
            <StatusPill label={portfolio?.marketContext?.tone || 'MARKET'} tone={portfolio?.marketContext?.riskOff ? 'warn' : 'info'} />
          </div>

          <form className="position-form" onSubmit={saveManualPosition}>
            <label>
              <span>銘柄コード</span>
              <input value={positionForm.ticker} onChange={(event) => updatePositionForm('ticker', event.target.value)} placeholder="4980.T" />
            </label>
            <label>
              <span>銘柄名</span>
              <input value={positionForm.name} onChange={(event) => updatePositionForm('name', event.target.value)} placeholder="デクセリアルズ" />
            </label>
            <label>
              <span>買値</span>
              <input type="number" min="1" step="0.1" value={positionForm.entryPrice} onChange={(event) => updatePositionForm('entryPrice', event.target.value)} />
            </label>
            <label>
              <span>株数</span>
              <input type="number" min="1" step="1" value={positionForm.shares} onChange={(event) => updatePositionForm('shares', event.target.value)} />
            </label>
            <label className="position-note">
              <span>メモ</span>
              <input value={positionForm.note} onChange={(event) => updatePositionForm('note', event.target.value)} placeholder="買付理由や材料" />
            </label>
            <div className="position-actions">
              <button type="button" className="ghost-action" onClick={() => setPositionForm((current) => ({
                ...current,
                ticker: selectedStock?.ticker || current.ticker,
                name: selectedStock?.name || current.name,
                entryPrice: String(Math.round(Number(detail?.price || selectedStock?.price || current.entryPrice))),
              }))}>
                <Target size={15} />
                <span>表示銘柄を使う</span>
              </button>
              <button type="submit" className="treasure-button" disabled={busy === 'position'}>
                {busy === 'position' ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                <span>保有に保存</span>
              </button>
            </div>
          </form>

          <div className="exit-coach-grid">
            {(portfolio?.holdings || []).length ? (portfolio.holdings || []).map((holding) => {
              const plan = holding.exitPlan || {};
              const research = plan.marketResearch || [];
              return (
                <article className={`exit-card ${exitPlanTone(plan.action)}`} key={`exit-${holding.ticker}`}>
                  <div className="exit-card-head">
                    <div>
                      <span>{holding.ticker}</span>
                      <strong>{holding.name || holding.ticker}</strong>
                    </div>
                    <StatusPill label={plan.label || '確認中'} tone={exitPlanTone(plan.action)} />
                  </div>
                  <div className="exit-price-grid">
                    <div><span>売却確認価格</span><strong>{yen(plan.reviewPrice)}</strong><small>{plan.sellReviewShares || holding.shares}株</small></div>
                    <div><span>利確目標</span><strong>{yen(plan.targetPrice)}</strong><small>伸び目標 {yen(plan.stretchTargetPrice)}</small></div>
                    <div><span>保護ライン</span><strong>{yen(plan.stopLoss)}</strong><small>終値割れで再確認</small></div>
                    <div><span>損益</span><strong className={Number(holding.pnl || 0) >= 0 ? 'up' : 'down'}>{pct(holding.pnlPct)}</strong><small>{yen(holding.pnl)}</small></div>
                  </div>
                  <p className="exit-timing">{plan.timing}</p>
                  <div className="exit-research">
                    {research.slice(0, 4).map((item) => (
                      <div key={`${holding.ticker}-${item.label}`}>
                        <span>{item.label}</span>
                        <strong>{item.value ?? '-'}{item.unit}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="exit-market">
                    <ShieldCheck size={15} />
                    <span>{plan.marketSummary || '地合い確認中'}</span>
                  </div>
                  <div className="holding-lifecycle-actions" aria-label={`${holding.ticker} 台帳操作`}>
                    <button type="button" onClick={() => closePortfolioPosition(holding, 'SOLD')} disabled={!!busy} title="売却済みにして通常ポートフォリオから外す">
                      <CheckCircle2 size={14} />
                      <span>売却済み</span>
                    </button>
                    <button type="button" onClick={() => closePortfolioPosition(holding, 'VOIDED')} disabled={!!busy} title="入力ミスとして訂正履歴に残す">
                      <XCircle size={14} />
                      <span>入力ミス</span>
                    </button>
                    <button type="button" onClick={() => closePortfolioPosition(holding, 'ARCHIVED')} disabled={!!busy} title="削除せず通常表示から外す">
                      <Archive size={14} />
                      <span>非表示</span>
                    </button>
                  </div>
                </article>
              );
            }) : (
              <div className="exit-empty">
                <Target size={22} />
                <strong>保有銘柄はまだありません</strong>
                <span>例: 4980.T / 2,648円 / 100株を入力すると、デクセリアルズの売却判断カードがここに出ます。</span>
              </div>
            )}
          </div>
        </section>

        <section className="table-panel">
          <div className="section-title">
            <BriefcaseBusiness size={18} />
            <span>Portfolio</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>銘柄</th>
                  <th>保有</th>
                  <th>平均</th>
                  <th>現在値</th>
                  <th>評価額</th>
                  <th>損益</th>
                  <th>台帳</th>
                </tr>
              </thead>
              <tbody>
                {(portfolio?.holdings || []).map((holding) => (
                  <tr key={holding.ticker}>
                    <td><b>{holding.emoji || 'JP'} {holding.name || holding.ticker}</b><small>{holding.ticker}</small></td>
                    <td>{holding.shares} 株</td>
                    <td>{yen(holding.avgCost)}</td>
                    <td>{yen(holding.currentPrice)}</td>
                    <td>{yen(holding.value)}</td>
                    <td className={Number(holding.pnl || 0) >= 0 ? 'up' : 'down'}>{yen(holding.pnl)} / {pct(holding.pnlPct)}</td>
                    <td><StatusPill label={holding.status || 'ACTIVE'} tone="good" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {(portfolio?.archivedHoldings || []).length ? (
          <section className="table-panel ledger-panel">
            <div className="section-title">
              <Archive size={18} />
              <span>Portfolio Ledger</span>
            </div>
            <p className="ledger-note">削除はせず、売却済み・入力ミス・非表示として残した銘柄です。通常の損益計算からは外しています。</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>銘柄</th>
                    <th>状態</th>
                    <th>最終株数</th>
                    <th>平均</th>
                    <th>理由</th>
                    <th>処理日</th>
                  </tr>
                </thead>
                <tbody>
                  {(portfolio.archivedHoldings || []).map((holding) => (
                    <tr key={`ledger-${holding.ticker}-${holding.status}`}>
                      <td><b>{holding.emoji || 'JP'} {holding.name || holding.ticker}</b><small>{holding.ticker}</small></td>
                      <td><StatusPill label={holding.status} tone={holding.status === 'SOLD' ? 'info' : 'neutral'} /></td>
                      <td>{holding.shares} 株</td>
                      <td>{yen(holding.avgCost)}</td>
                      <td>{holding.lifecycleReason || '-'}</td>
                      <td>{holding.closedAt ? new Date(holding.closedAt).toLocaleString('ja-JP') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </main>

      <aside className="ops-panel">
        <div className="section-title">
          <Bot size={18} />
          <span>Jobs Control</span>
        </div>
        <button className="primary-action" onClick={() => runAction('screen')} disabled={!!busy}>
          {busy === 'screen' ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
          AI再分析
        </button>
        <div className="ops-grid">
          <button onClick={() => runAction('screen')} disabled={!!busy}><Search size={16} /> 探索</button>
          <button onClick={() => runAction('learn')} disabled={!!busy}><BrainCircuit size={16} /> 学習</button>
          <button onClick={() => runAction('reset')} disabled={!!busy}><RotateCcw size={16} /> 初期化</button>
        </div>
        <div className="log-feed">
          {log.map((entry, index) => (
            <div key={`${entry.tag}-${index}`}>
              <span>{entry.tag}</span>
              <p>{entry.text}</p>
            </div>
          ))}
        </div>
        <div className="recent-box">
          <h3><ShieldCheck size={16} /> Jobs Verdict</h3>
          <div className="verdict-row"><span>健全性</span><strong>{portfolioHealth.score}/100</strong></div>
          <div className="verdict-row"><span>最大集中</span><strong>{portfolioHealth.maxHoldingPct.toFixed(1)}%</strong></div>
          <div className="verdict-row"><span>現金比率</span><strong>{portfolioHealth.cashPct.toFixed(1)}%</strong></div>
          <p className="verdict-copy">
            {tradePlan.headline}
          </p>
        </div>
        <div className="notice">
          <AlertTriangle size={15} />
          投資助言ではなく、ローカルの投資シミュレーションです。
        </div>
      </aside>
    </div>
  );
}

