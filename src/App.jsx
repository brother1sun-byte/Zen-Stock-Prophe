import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { api, readFreshCache, writeCache } from './api/apiClient';
import { DataSourceBadge, DataSourceWarning } from './components/DataSourceBadge';
import DetailPanels from './components/DetailPanels';
import PortfolioLedger from './components/PortfolioLedger';
import PracticeDashboard from './components/PracticeDashboard';
import TopCandidateCard from './components/TopCandidateCard';
import WatchlistPanel from './components/WatchlistPanel';
import { useMarketData } from './hooks/useMarketData';
import {
  buildDisplayStocks,
  buildJobsCandidate,
  buildMarketCachePayload,
  buildRankedStocks,
  deriveDaytradeTopPick,
  priceSourcePayload,
  rankingMetricDisplay,
} from './hooks/useMarketDataHelpers';
import { useDashboardViewModel } from './hooks/useDashboardViewModel';
import { portfolioStatusLabel, usePortfolioLedger } from './hooks/usePortfolioLedger';
import { PRACTICE_ORDER_STATUS, practiceOrderStatusLabel, usePracticeOrder } from './hooks/usePracticeOrder';
import { useSelectedStock } from './hooks/useSelectedStock';
import { buildChatGptConsultationPrompt } from './utils/chatGptPrompt';
import { buildDisclosureEventSummary } from './utils/disclosureEvents';
import { fetchEdinetDocumentsByDateRange } from './utils/edinetClient';
import { buildPreopenCheckSummary, fetchEarningsCalendarByDateRange } from './utils/earningsCalendarClient';
import { buildMorningCheckWindow } from './utils/japanBusinessCalendar';
import { buildResearchCoverage } from './utils/researchCoverage';
import { displayStockName } from './utils/stockNames';
import {
  buildWatchlistPreopenCheck,
  filterPreopenCheckResults,
  summarizeWatchlistPreopenCheck,
} from './utils/watchlistPreopenCheck';
import './index.css';

const COLORS = ['#16f1a4', '#38bdf8', '#f59e0b', '#fb7185', '#a78bfa', '#22c55e'];
const PINNED_WATCH_TICKER = '4980.T';
const WATCHLIST_DISPLAY_LIMIT = 6;
const JOBS_SIM_BUDGET_JPY = 500000;
const WATCHLIST_FALLBACK_CANDIDATES = [
  { ticker: '6503.T', name: '三菱電機', price: 0, candidateScore: 50, reason: 'ランキング取得前の補完候補です。更新後に実データへ置き換わります。' },
  { ticker: '8035.T', name: '東京エレクトロン', price: 0, candidateScore: 50, reason: 'ランキング取得前の補完候補です。更新後に実データへ置き換わります。' },
  { ticker: '7011.T', name: '三菱重工業', price: 0, candidateScore: 50, reason: 'ランキング取得前の補完候補です。更新後に実データへ置き換わります。' },
  { ticker: '8306.T', name: '三菱UFJフィナンシャル・グループ', price: 0, candidateScore: 50, reason: 'ランキング取得前の補完候補です。更新後に実データへ置き換わります。' },
];
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
const aiFundDeskFallback = {
  mode: 'LOCAL_AI_HEDGE_FUND_DESK',
  liveBrokerOrdersEnabled: false,
  summary: {
    state: 'WAIT',
    headline: 'AIファンドデスクを準備中',
    expectedProfitJpy: 0,
    maxLossJpy: 0,
    confidencePct: 0,
    activeHoldingCount: 0,
    portfolioCashJpy: 0,
  },
  workflow: [
    { id: 'research', label: 'リサーチ', status: 'WAIT', summary: 'マーケットランキングを取得中です。', evidence: ['JPX銘柄母集団', '日足・出来高', '材料確認'] },
    { id: 'plan', label: '売買案', status: 'WAIT', summary: '条件一致後に確認票下書きを作成します。', evidence: [] },
    { id: 'approval', label: '承認ゲート', status: 'WAIT', summary: '人間の確認前に実行へ進みません。', evidence: ['実注文オフ'] },
    { id: 'audit', label: '監査ログ', status: 'WAIT', summary: '判断理由を保存する準備中です。', evidence: [] },
  ],
  draftOrder: null,
  guardrails: [
    { label: '実注文書き込み無効', ok: true, detail: '実注文は送信しません。' },
    { label: '承認前は下書きのみ', ok: false, detail: '候補確定後に下書き化します。' },
  ],
  researchQueue: [],
  auditTrail: { whyBuy: [], whyNotBuy: [], invalidConditions: [], dataFreshness: {}, material: {} },
  disclaimer: 'リサーチと下書き確認票のみです。実注文は送信されません。',
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
      { ticker: '7203.T', name: 'トヨタ自動車', emoji: 'TY', shares: 80, avgCost: 2850, currentPrice: 3000, value: 240000, pnl: 12000, pnlPct: 5.3 },
    ],
    history: Array.from({ length: 22 }, (_, i) => ({
      date: `${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
      value: 1000000 + Math.round(Math.sin(i / 2) * 18000 + i * 4200),
    })),
  },
  transactions: [
    { id: 1, ticker: '4980.T', name: 'デクセリアルズ', action: 'BUY', shares: 20, price: 2481, total: 49620, reason: 'デモ注文', createdAt: 'オフライン' },
  ],
};

function yen(value) {
  return `¥${Math.round(Number(value || 0)).toLocaleString('ja-JP')}`;
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '-';
  return new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

function pct(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function simpleOpportunityText(value) {
  if (!value) return '';
  return String(value)
    .replace(/Break below stop loss ([\d.]+) JPY/i, '撤退ライン ¥$1 を下回る')
    .replace(/Cannot reach target ([\d.]+) JPY with acceptable liquidity/i, '流動性を見ても利確目標 ¥$1 に届きにくい')
    .replace(/Target profit ([\d,]+) JPY \/ Expected profit ([\d,]+) JPY/i, '利確利益 ¥$1 / 期待損益 ¥$2')
    .replace(/JPY/g, '円')
    .replace(/Out of session/gi, '時間外')
    .replace(/Regular session/gi, '取引時間中');
}

function riskLevelLabel(level) {
  if (level === 'low') return '低';
  if (level === 'medium') return '中';
  if (level === 'high') return '高';
  if (level === 'critical') return '危険';
  return '要確認';
}

function marketToneLabel(tone) {
  const labels = {
    MARKET: '市場確認',
    RISK_OFF: '地合い注意',
    RISK_ON: '地合い良好',
    NEUTRAL: '中立',
  };
  return labels[tone] || tone || '市場確認';
}

function materialToneLabel(tone) {
  const labels = {
    positive: '好材料',
    negative: '悪材料',
    important: '重要材料',
    neutral: '中立',
    unconfirmed: '未確認',
    unknown: '未確認',
  };
  return labels[String(tone || '').toLowerCase()] || tone || '未確認';
}

function operationLogTagLabel(tag) {
  if (tag === 'Jobs') return '分析担当';
  if (tag === 'SIM') return 'シミュレーション';
  if (tag === 'SYS') return 'システム';
  if (tag === 'Market') return '市場データ';
  return tag;
}

function cacheStatusLabel(status) {
  const labels = {
    LIVE: '取得',
    MISS: '取得',
    HIT: '一時保存',
    STALE: '古いデータ',
  };
  return labels[status] || status || '取得';
}

function shortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
}

function currentTokyoMarketStatus() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const getPart = (type) => parts.find((part) => part.type === type)?.value || '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(getPart('weekday'));
  const minutes = Number(getPart('hour')) * 60 + Number(getPart('minute'));
  const isWeekend = weekday >= 5;
  const isSession = (minutes >= 9 * 60 && minutes < 11 * 60 + 30) || (minutes >= 12 * 60 + 30 && minutes < 15 * 60 + 30);
  if (isWeekend) {
    return {
      isOpen: false,
      phase: 'WEEKEND_CLOSED',
      label: '休場日',
      message: '本日は土日で株式市場が開いていないため、前日終値・日足推移・時間外の材料ニュースを使って候補を分析します。',
    };
  }
  if (!isSession) {
    return {
      isOpen: false,
      phase: 'OUT_OF_SESSION',
      label: '取引時間外',
      message: '現在は東証の通常取引時間外のため、前日終値・日足推移・時間外の材料ニュースを使って候補を分析します。',
    };
  }
  return {
    isOpen: true,
    phase: 'REGULAR_SESSION',
    label: '取引中',
    message: '東証の通常取引時間内です。デイトレ候補を更新できます。',
  };
}

function aiFundStatusLabel(status) {
  const labels = {
    COMPLETE: '完了',
    READY: '下書きあり',
    WAIT: '待機',
    APPROVAL_REQUIRED: '承認待ち',
    RESEARCH_ONLY: '調査のみ',
    LOGGED: '記録済み',
  };
  return labels[status] || status || '-';
}

function aiFundOrderSideLabel(side) {
  const labels = { BUY: '買い', SELL: '売り' };
  return labels[side] || side || '-';
}

function verificationStatusLabel(status) {
  const labels = {
    PASS: '通過',
    REVIEW: '要確認',
    REJECT: '見送り',
    BLOCK: '見送り',
    UNKNOWN: '未確認',
  };
  return labels[String(status || '').toUpperCase()] || status || '-';
}

function tradeActionLabel(action) {
  const labels = {
    BUY: '買い練習',
    SELL: '売り検討',
    HOLD: '様子見',
    AVOID: '見送り',
    TAKE_PROFIT: '利確検討',
    STOP_LOSS_ALERT: '損切り警戒',
    INSUFFICIENT_DATA: 'データ不足',
    WATCH_ONLY: '監視のみ',
    MANUAL_BUY: '手入力の買い練習',
    MANUAL_SELL: '手入力の売り記録',
  };
  return labels[action] || action || '-';
}

function candidateQuality(stock, detail) {
  if (detail?.candidateQuality) return detail.candidateQuality;
  if (stock?.candidateQuality) return stock.candidateQuality;
  return null;
}

function candidateDataQuality(stock, detail) {
  return detail?.dataQuality || detail?.candidateQuality?.dataQuality || stock?.dataQuality || stock?.candidateQuality?.dataQuality || null;
}

function dataQualityTone(quality) {
  if (!quality) return 'neutral';
  if (quality.sourceOk && quality.priceOk && Number(quality.score || 0) >= 65) return 'good';
  if (Number(quality.score || 0) >= 45) return 'warn';
  return 'bad';
}

function dataQualitySummary(quality) {
  if (!quality) return '価格品質 未確認';
  const verdict = quality.priceFreshnessVerdict || quality.verdict || '-';
  const age = quality.latestBarAgeDays == null ? '-' : `${quality.latestBarAgeDays}日前`;
  return `価格品質 ${Math.round(Number(quality.score || 0))}/100 / ${verdict} / ${age}`;
}

function preopenReport(stock, detail) {
  return detail?.preopenReport || stock?.preopenReport || null;
}

function preopenRiskLabels(report) {
  return (report?.riskFlags || [])
    .slice(0, 3)
    .map((item) => item.label)
    .join(' / ');
}

function priorityChecklistItems(items = [], limit = 6) {
  const priority = {
    検証強度: 0,
    市場地合い: 1,
    材料裏取り: 2,
    価格鮮度: 3,
    流動性: 4,
    損益比: 5,
    Yahoo掲載順位: 6,
  };
  return [...items]
    .filter(Boolean)
    .sort((a, b) => {
      if (Boolean(a.ok) !== Boolean(b.ok)) return a.ok ? 1 : -1;
      return (priority[a.label] ?? 99) - (priority[b.label] ?? 99);
    })
    .slice(0, limit);
}

function backtestLabel(backtest) {
  if (!backtest?.sampleCount) return '検証不足';
  const sign = Number(backtest.avgNextDayReturnPct || 0) >= 0 ? '+' : '';
  const strength = backtest.evidenceStrength?.label ? ` / ${backtest.evidenceStrength.label}` : '';
  return `勝率 ${backtest.winRate}% / 平均 ${sign}${backtest.avgNextDayReturnPct}%${strength}`;
}

function ensurePinnedWatchStock(list = []) {
  const normalized = Array.isArray(list) ? list.filter(Boolean) : [];
  const pinned = normalized.find((stock) => stock.ticker === PINNED_WATCH_TICKER);
  const pinnedStock = {
    ...PINNED_WATCH_STOCK,
    ...pinned,
    mustInclude: true,
    candidateRank: pinned?.candidateRank ?? PINNED_WATCH_STOCK.candidateRank,
  };
  return [
    pinnedStock,
    ...normalized.filter((stock) => stock.ticker !== PINNED_WATCH_TICKER),
  ];
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

function mlPredictionTone(status) {
  if (status === 'usable') return 'good';
  if (status === 'contradiction' || status === 'reference_only') return 'warn';
  if (status === 'review') return 'info';
  return 'neutral';
}

function crossEngineTone(status) {
  if (status === 'aligned') return 'good';
  if (status === 'blocked') return 'bad';
  if (status === 'review') return 'warn';
  return 'neutral';
}

function crossEngineStatusLabel(status) {
  if (status === 'aligned') return '一致';
  if (status === 'blocked') return '見送り';
  if (status === 'review') return '要確認';
  if (status === 'pending') return '待ち';
  return '未確認';
}

function rankingCrossEngineLabel(check) {
  if (!check?.status || check.status === 'pending') return null;
  return `高度分析: ${crossEngineStatusLabel(check.status)}`;
}

function crossEngineGateLabel(gate) {
  const labels = {
    ticker_match: '銘柄一致',
    candidate_strength: '候補強度',
    price_data_quality: '価格品質',
    opportunity_readiness: '短期準備',
    advanced_verdict: '高度判定',
    analysis_reliability: '分析信頼度',
    advanced_guardrails: '高度条件',
  };
  return labels[gate?.id] || gate?.label || '確認項目';
}

function sourceShortLabel(value) {
  if (!value) return '';
  const text = String(value);
  const lower = text.toLowerCase();
  if (lower.includes('finance.yahoo.co.jp')) return 'Yahooファイナンス取得';
  if (lower.includes('yfinance')) return 'yfinance取得';
  if (lower.includes('yahoo_chart') || lower.includes('yahoo chart')) return 'Yahooチャート取得';
  if (lower.includes('stooq')) return 'Stooq取得';
  if (text === 'JPX_MASTER') return 'JPX銘柄マスタ';
  return text.length > 36 ? `${text.slice(0, 34)}...` : text;
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

function signalMeta(signal = 'HOLD') {
  const map = {
    STRONG_BUY: ['強い監視候補', 'buy'],
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

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-fallback" role="alert">
          <strong>画面を復旧できませんでした</strong>
          <p>データ取得または表示処理で問題が起きました。更新しても直らない場合は、バックエンドの起動状態を確認してください。</p>
          <small>{this.state.error.message}</small>
        </div>
      );
    }
    return this.props.children;
  }
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
  const advancedAnalysisRef = useRef(null);
  const hydrateInFlightRef = useRef(null);
  const daytradeAnalysisRequestsRef = useRef(new Map());
  const [chatGptPromptCopied, setChatGptPromptCopied] = useState(false);
  const cached = useMemo(() => {
    return readFreshCache();
  }, []);
  const cachedSelectedTicker = cached?.selectedTicker || PINNED_WATCH_TICKER;
  const cachedDaytradeAnalysis = cached?.daytradeAnalysis?.ticker === cachedSelectedTicker ? cached.daytradeAnalysis : null;
  const cachedDaytradeRoutine = cached?.daytradeRoutine?.ticker === cachedSelectedTicker ? cached.daytradeRoutine : null;

  const [selectedTicker, setSelectedTicker] = useState(cachedSelectedTicker);
  const [daytradePlan, setDaytradePlan] = useState(cached?.daytradePlan || daytradeFallback.plan);
  const [daytradeSignals, setDaytradeSignals] = useState(cached?.daytradeSignals || daytradeFallback.signals);
  const [daytradeRisk, setDaytradeRisk] = useState(cached?.daytradeRisk || daytradeFallback.risk);
  const [daytradeSource, setDaytradeSource] = useState(cached?.daytradeSource || 'CSV_TEMPLATE');
  const [daytradeInterval, setDaytradeInterval] = useState(cached?.daytradeInterval || '5m');
  const [daytradeAnalysis, setDaytradeAnalysis] = useState(cachedDaytradeAnalysis);
  const [daytradeRoutine, setDaytradeRoutine] = useState(cachedDaytradeRoutine);
  const [brokerStatus, setBrokerStatus] = useState(cached?.brokerStatus || daytradeFallback.brokerStatus);
  const [autopilotStatus, setAutopilotStatus] = useState(cached?.autopilotStatus || daytradeFallback.autopilot);
  const [aiFundDesk, setAiFundDesk] = useState(cached?.aiFundDesk || aiFundDeskFallback);
  const [alertReport, setAlertReport] = useState(cached?.alertReport || null);
  const [jquantsResearch, setJquantsResearch] = useState(cached?.jquantsResearch || null);
  const [edinetDisclosure, setEdinetDisclosure] = useState(null);
  const [earningsCalendar, setEarningsCalendar] = useState(null);
  const [jquantsCode, setJquantsCode] = useState(cached?.jquantsCode || PINNED_WATCH_TICKER);
  const [rankingKind, setRankingKind] = useState('gainers');
  const [watchlistPreopenFilter, setWatchlistPreopenFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(cached?.searchQuery || '');
  const [activeTab, setActiveTab] = useState('plan');
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState('');
  const [screenProgress, setScreenProgress] = useState(null);
  const [status, setStatus] = useState({ tone: cached ? 'warn' : 'neutral', text: cached ? 'キャッシュ表示中' : '初期化中' });
  const {
    positionForm,
    setPositionForm,
    updatePositionForm,
    applyPracticeCandidate,
    practiceOrders,
    getPracticeOrderValidation,
    submitPracticeOrder,
    markPracticeOrderFilled,
    cancelPracticeOrder,
    cancelCurrentPracticeOrder,
  } = usePracticeOrder({
    initialForm: {
      ticker: PINNED_WATCH_TICKER,
      name: 'デクセリアルズ',
      entryPrice: '2648',
      shares: '100',
      side: 'BUY',
      note: '手入力の買付記録',
    },
  });
  const [log, setLog] = useState([
    { tag: 'Jobs', text: 'Pro版を起動。安全境界を保持し、独立ポートで運用します。' },
  ]);

  const addLog = useCallback((tag, text) => {
    setLog((items) => [{ tag, text }, ...items].slice(0, 12));
  }, []);

  const browserMarketStatus = useMemo(() => currentTokyoMarketStatus(), []);
  const morningCheckWindow = useMemo(() => buildMorningCheckWindow(new Date()), []);

  const {
    stocks,
    portfolio,
    transactions,
    detail,
    setDetail,
    advancedReport,
    setAdvancedReport,
    advancedReportsByTicker,
    marketUniverse,
    marketRankings,
    marketSearch,
    marketFreshness,
    marketStatusView,
    hydrateMarketData,
    loadDetail,
    loadMarketRankings,
    searchMarket: searchMarketData,
  } = useMarketData({
    cached,
    fallback: demo,
    browserMarketStatus,
    selectedTicker,
    setSelectedTicker,
    rankingKind,
    setRankingKind,
    ensureStocks: ensurePinnedWatchStock,
    cacheExtras: {
      daytradePlan,
      daytradeSignals,
      daytradeSource,
      daytradeRisk,
      daytradeInterval,
      daytradeAnalysis,
      daytradeRoutine,
      brokerStatus,
      autopilotStatus,
      aiFundDesk,
      alertReport,
      jquantsResearch,
      jquantsCode,
      searchQuery,
    },
    addLog,
    setBusy,
    setStatus,
  });

  const hydrate = useCallback((background = false) => {
    if (hydrateInFlightRef.current) return hydrateInFlightRef.current;

    const task = (async () => {
      try {
      const marketResult = await hydrateMarketData(background);
      const [daytradePlanResult, daytradeSignalsResult, daytradeRiskResult, brokerStatusResult, autopilotResult, aiFundDeskResult, alertResult, jquantsResult] = await Promise.allSettled([
        api('/daytrade/plan'),
        api(`/daytrade/signals?kind=${encodeURIComponent(rankingKind)}`),
        api('/daytrade/risk-state'),
        api('/daytrade/broker-status'),
        api('/daytrade/autopilot/status'),
        api(`/ai-fund/desk?kind=${encodeURIComponent(rankingKind)}`, { timeout: 30000 }),
        api('/alerts/watchlist', { timeout: 12000 }),
        api('/research/jquants/status'),
      ]);
      const nextDaytradePlan = daytradePlanResult.status === 'fulfilled' && daytradePlanResult.value ? daytradePlanResult.value : daytradePlan;
      const signalPayload = daytradeSignalsResult.status === 'fulfilled' ? daytradeSignalsResult.value : null;
      const nextDaytradeSignals = signalPayload?.signals?.length ? signalPayload.signals : Array.isArray(signalPayload) && signalPayload.length ? signalPayload : daytradeSignals;
      const nextDaytradeSource = signalPayload?.source || daytradeSource;
      const nextDaytradeRisk = daytradeRiskResult.status === 'fulfilled' && daytradeRiskResult.value ? daytradeRiskResult.value : daytradeRisk;
      const nextBrokerStatus = brokerStatusResult.status === 'fulfilled' && brokerStatusResult.value ? brokerStatusResult.value : brokerStatus;
      const nextAutopilotStatus = autopilotResult.status === 'fulfilled' && autopilotResult.value ? autopilotResult.value : autopilotStatus;
      const nextAiFundDesk = aiFundDeskResult.status === 'fulfilled' && aiFundDeskResult.value ? aiFundDeskResult.value : aiFundDesk;
      const nextAlertReport = alertResult.status === 'fulfilled' && alertResult.value ? alertResult.value : alertReport;
      const nextJquantsResearch = jquantsResult.status === 'fulfilled' && jquantsResult.value ? jquantsResult.value : jquantsResearch;
      setDaytradePlan(nextDaytradePlan);
      setDaytradeSignals(nextDaytradeSignals);
      setDaytradeSource(nextDaytradeSource);
      setDaytradeRisk(nextDaytradeRisk);
      setBrokerStatus(nextBrokerStatus);
      setAutopilotStatus(nextAutopilotStatus);
      setAiFundDesk(nextAiFundDesk);
      setAlertReport(nextAlertReport);
      setJquantsResearch(nextJquantsResearch);
      writeCache(buildMarketCachePayload({
        stocks: marketResult?.stocks || stocks,
        portfolio: marketResult?.portfolio || portfolio,
        transactions: marketResult?.transactions || transactions,
        daytradePlan: nextDaytradePlan,
        daytradeSignals: nextDaytradeSignals,
        daytradeSource: nextDaytradeSource,
        daytradeRisk: nextDaytradeRisk,
        daytradeRoutine,
        brokerStatus: nextBrokerStatus,
        autopilotStatus: nextAutopilotStatus,
        aiFundDesk: nextAiFundDesk,
        alertReport: nextAlertReport,
        jquantsResearch: nextJquantsResearch,
        marketUniverse: marketResult?.marketUniverse || marketUniverse,
        marketRankings: marketResult?.marketRankings || marketRankings,
        rankingKind,
        searchQuery,
        marketSearch,
        advancedReport,
        advancedReportsByTicker,
        jquantsCode,
        selectedTicker,
        detail,
      }));
      } catch (error) {
        setStatus({ tone: 'warn', text: 'オフライン補完表示' });
        addLog('SYS', `API応答を短縮: ${error.message}`);
      } finally {
        hydrateInFlightRef.current = null;
        setBusy('');
      }
    })();

    hydrateInFlightRef.current = task;
    return task;
  }, [addLog, advancedReport, advancedReportsByTicker, aiFundDesk, alertReport, autopilotStatus, brokerStatus, daytradePlan, daytradeRisk, daytradeRoutine, daytradeSignals, daytradeSource, detail, hydrateMarketData, jquantsCode, jquantsResearch, marketRankings, marketSearch, marketUniverse, portfolio, rankingKind, searchQuery, selectedTicker, stocks, transactions]);

  const loadDaytradeAnalysis = useCallback((ticker, interval = daytradeInterval) => {
    if (!ticker) return Promise.resolve(null);
    const requestKey = `${ticker}:${interval}`;
    const activeRequest = daytradeAnalysisRequestsRef.current.get(requestKey);
    if (activeRequest) return activeRequest;

    const task = (async () => {
      try {
        const result = await api(`/daytrade/analysis/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}`, { timeout: 30000 });
        setDaytradeAnalysis(result);
        let nextDaytradeRoutine = daytradeRoutine;
        try {
          nextDaytradeRoutine = await api(`/daytrade/routine/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}`, { timeout: 30000 });
          setDaytradeRoutine(nextDaytradeRoutine);
        } catch (routineError) {
          addLog('SYS', `${ticker} ${interval} の生活導線は未取得: ${routineError.message}`);
        }
        writeCache(buildMarketCachePayload({
          stocks, portfolio, transactions, daytradePlan, daytradeSignals, daytradeSource, daytradeRisk,
          daytradeInterval: interval, daytradeAnalysis: result, daytradeRoutine: nextDaytradeRoutine, brokerStatus, autopilotStatus, alertReport,
          jquantsResearch, advancedReport, jquantsCode, selectedTicker: ticker, detail,
        }));
        addLog('SIM', `${ticker} ${interval} の短期スコアを更新しました。`);
        return result;
      } catch (error) {
        addLog('SYS', `${ticker} ${interval} の短期分析は未取得: ${error.message}`);
        return null;
      } finally {
        daytradeAnalysisRequestsRef.current.delete(requestKey);
      }
    })();

    daytradeAnalysisRequestsRef.current.set(requestKey, task);
    return task;
  }, [addLog, advancedReport, alertReport, autopilotStatus, brokerStatus, daytradeInterval, daytradePlan, daytradeRisk, daytradeRoutine, daytradeSignals, daytradeSource, detail, jquantsCode, jquantsResearch, portfolio, stocks, transactions]);

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

  useEffect(() => {
    if (selectedTicker) loadDaytradeAnalysis(selectedTicker, daytradeInterval);
    // Short-term analysis follows the active ticker/interval only; other dashboard state should not refetch it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicker, daytradeInterval]);

  useEffect(() => {
    if (!selectedTicker) {
      setEdinetDisclosure(null);
      return undefined;
    }
    let active = true;
    const morningCheck = {
      ticker: selectedTicker,
      startDate: morningCheckWindow.startDate,
      endDate: morningCheckWindow.endDate,
      periodLabel: morningCheckWindow.periodLabel,
      note: morningCheckWindow.note,
    };
    setEdinetDisclosure({
      status: 'loading',
      configured: Boolean(import.meta.env.VITE_EDINET_API_KEY || import.meta.env.EDINET_API_KEY || globalThis.__ZEN_TEST_ENV__?.VITE_EDINET_API_KEY),
      documents: [],
      morningCheck,
      message: 'EDINET提出書類を確認中です。',
    });
    fetchEdinetDocumentsByDateRange(morningCheck.startDate, morningCheck.endDate, { env: import.meta.env })
      .then((result) => {
        if (!active) return;
        setEdinetDisclosure({ ...result, morningCheck });
      })
      .catch((error) => {
        if (!active) return;
        setEdinetDisclosure({
          status: 'fetch_failed',
          configured: Boolean(import.meta.env.VITE_EDINET_API_KEY || import.meta.env.EDINET_API_KEY || globalThis.__ZEN_TEST_ENV__?.VITE_EDINET_API_KEY),
          documents: [],
          fetchedAt: new Date().toISOString(),
          morningCheck,
          message: `EDINET確認に失敗しました。${error?.message || '通信エラー'}`,
        });
      });
    return () => {
      active = false;
    };
  }, [morningCheckWindow.endDate, morningCheckWindow.note, morningCheckWindow.periodLabel, morningCheckWindow.startDate, selectedTicker]);

  useEffect(() => {
    let active = true;
    setEarningsCalendar({
      status: 'loading',
      items: [],
      sourceStatus: {
        label: '確認中',
        tone: 'neutral',
        detail: '決算予定データを確認中です。',
      },
      message: '決算予定データを確認中です。',
    });
    fetchEarningsCalendarByDateRange(morningCheckWindow.startDate, morningCheckWindow.endDate)
      .then((result) => {
        if (!active) return;
        setEarningsCalendar(result);
      })
      .catch((error) => {
        if (!active) return;
        setEarningsCalendar({
          status: 'fetch_failed',
          items: [],
          fetchedAt: new Date().toISOString(),
          sourceStatus: {
            label: '取得失敗',
            tone: 'warn',
            detail: `決算予定データを取得できませんでした。${error?.message || '通信エラー'}`,
          },
          message: '決算予定データは未取得です。',
        });
      });
    return () => {
      active = false;
    };
  }, [morningCheckWindow.endDate, morningCheckWindow.startDate]);

  const rankedStocks = useMemo(() => buildRankedStocks({
    stocks,
    pinnedTicker: PINNED_WATCH_TICKER,
    pinnedStock: PINNED_WATCH_STOCK,
    watchlistLimit: WATCHLIST_DISPLAY_LIMIT,
  }), [stocks]);

  const daytradeTopPick = useMemo(() => deriveDaytradeTopPick({
    marketRankings,
    rankedStocks,
    rankingKind,
    budget: JOBS_SIM_BUDGET_JPY,
  }), [marketRankings, rankedStocks, rankingKind]);

  const topPickSyncKey = daytradeTopPick?.ticker
    ? `${daytradeTopPick.ticker}|${daytradeTopPick.entry || ''}|${daytradeTopPick.shares || ''}`
    : '';

  const {
    userSelectedTicker,
    selectedStock,
    selectedDetail,
    selectedAdvancedReport,
    chooseTicker,
    selectMarketTicker,
    focusTopPick,
  } = useSelectedStock({
    initialTicker: cachedSelectedTicker,
    selectedTicker,
    setSelectedTicker,
    topPick: daytradeTopPick,
    topPickSyncKey,
    stocks,
    marketSearch,
    marketRankings,
    marketUniverse,
    detail,
    advancedReport,
    advancedReportsByTicker,
    setDetail,
    setAdvancedReport,
    setDaytradeAnalysis,
    setDaytradeRoutine,
    setJquantsCode,
    setSearchQuery,
    setPositionForm,
    addLog,
  });

  const selectedQuality = useMemo(
    () => candidateQuality(selectedStock, selectedDetail),
    [selectedDetail, selectedStock],
  );
  const openTopPickDetails = useCallback(() => {
    focusTopPick?.();
    setShowDetails(true);
    const scrollToAnalysis = () => {
      advancedAnalysisRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    };
    window.requestAnimationFrame(scrollToAnalysis);
    window.setTimeout(scrollToAnalysis, 450);
  }, [focusTopPick]);
  const selectedDataQuality = useMemo(
    () => candidateDataQuality(selectedStock, selectedDetail),
    [selectedDetail, selectedStock],
  );
  const selectedPreopen = useMemo(
    () => preopenReport(selectedStock, selectedDetail),
    [selectedDetail, selectedStock],
  );

  const chartData = useMemo(() => {
    const source = selectedDetail?.chart?.length ? selectedDetail.chart : demo.portfolio.history.map((point, i) => ({
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
      sma25: selectedDetail?.analysis?.indicators?.sma25 || null,
    }));
  }, [selectedDetail]);

  const {
    holdings,
    archivedHoldings,
    allocation,
    portfolioHealth,
    lifecycleFeed,
    riskMetrics,
    verdictRows,
    pendingLifecycle,
    closePortfolioPosition,
  } = usePortfolioLedger({
    portfolio,
    chartData,
    selectedDetail,
    persistLifecycle: (holding, action, reason) => api(`/portfolio/positions/${encodeURIComponent(holding.ticker)}/lifecycle`, {
      method: 'POST',
      timeout: 12000,
      body: JSON.stringify({
        action,
        price: Number(holding.currentPrice || holding.avgCost || 0),
        reason,
      }),
    }),
    hydrate,
    addLog,
    setBusy,
    setStatus,
  });

  const displayStocks = useMemo(() => buildDisplayStocks({
    rankedStocks,
    daytradeTopPick,
    marketRankings,
    marketSearch,
    marketUniverse,
    detail,
    watchlistLimit: WATCHLIST_DISPLAY_LIMIT,
    fallbackCandidates: WATCHLIST_FALLBACK_CANDIDATES,
  }), [daytradeTopPick, detail, marketRankings, marketSearch, marketUniverse, rankedStocks]);

  const jobsCandidate = useMemo(() => buildJobsCandidate({
    selectedTicker,
    selectedStock,
    selectedDetail,
    marketRankings,
    rankedStocks,
    budget: JOBS_SIM_BUDGET_JPY,
  }), [selectedDetail, marketRankings, rankedStocks, selectedStock, selectedTicker]);

  const crossEngineCheck = useMemo(() => {
    if (selectedDetail?.crossEngineCheck?.status && selectedDetail.crossEngineCheck.status !== 'pending') {
      return selectedDetail.crossEngineCheck;
    }
    if (jobsCandidate?.advancedCrossEngineCheck?.status && jobsCandidate.advancedCrossEngineCheck.status !== 'pending') {
      return jobsCandidate.advancedCrossEngineCheck;
    }
    if (!jobsCandidate?.ticker || !selectedAdvancedReport?.ticker || jobsCandidate.ticker !== selectedAdvancedReport.ticker) {
      return {
        status: 'pending',
        label: 'クロスチェック待ち',
        detail: '選択銘柄を高度分析へ渡すと、ランキング評価と高度分析を照合します。',
      };
    }
    const readiness = jobsCandidate.tradeReadiness || 'review';
    const advancedVerdict = selectedAdvancedReport.verdict || 'UNKNOWN';
    const reliabilityGrade = selectedAdvancedReport.analysisReliability?.grade || 'insufficient';
    const guardrailsOk = selectedAdvancedReport.guardrails?.every((item) => item.ok) || false;
    if (readiness === 'avoid' || advancedVerdict === 'DEFENSIVE' || reliabilityGrade === 'insufficient') {
      return {
        status: 'blocked',
        label: 'クロスチェック不一致',
        detail: `ランキング候補ですが、高度分析は ${selectedAdvancedReport.actionLabel || advancedVerdict} / ${selectedAdvancedReport.analysisReliability?.label || reliabilityGrade} です。新規判断は見送り寄りです。`,
      };
    }
    if (readiness === 'review' || advancedVerdict === 'WATCHLIST' || !guardrailsOk || reliabilityGrade === 'weak') {
      return {
        status: 'review',
        label: 'クロスチェック要確認',
        detail: `ランキング評価と高度分析の一部条件が未通過です。${selectedAdvancedReport.analysisReliability?.label || '検証強度未確認'}。`,
      };
    }
    return {
      status: 'aligned',
      label: 'クロスチェック一致',
      detail: 'ランキング候補、専門家チェック、高度分析の方向性が一致しています。',
    };
  }, [jobsCandidate, selectedAdvancedReport, selectedDetail]);
  const crossEngineGatePreview = useMemo(() => {
    const severityRank = { high: 0, medium: 1, low: 2 };
    return [...(crossEngineCheck.gates || [])]
      .sort((a, b) => Number(a.ok) - Number(b.ok) || (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3))
      .slice(0, 4);
  }, [crossEngineCheck]);

  const readyDaytradeSignals = useMemo(
    () => (daytradeSignals || []).filter((signal) => signal.state === 'READY'),
    [daytradeSignals],
  );
  const showOpeningGapDesk = true;

  const [signalLabel] = signalMeta(selectedDetail?.analysis?.signal);
  const tradePlan = useMemo(() => {
    const strategy = selectedDetail?.analysis?.strategy || {};
    const execution = selectedDetail?.analysis?.execution || {};
    const price = Number(selectedDetail?.price || selectedStock?.price || 0);
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
      headline: execution.headline || selectedDetail?.analysis?.reason || '分析結果を取得中です。',
      plainReason: execution.plainReason || selectedDetail?.analysis?.technicalSummary || selectedDetail?.analysis?.reason || '',
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
  }, [selectedDetail, portfolio, selectedStock, signalLabel]);
  const rankingTabs = [
    { id: 'surge', label: '短期上昇' },
    { id: 'gainers', label: '値上がり率' },
    { id: 'breakout', label: '高値更新' },
    { id: 'popular', label: '人気' },
    { id: 'volume', label: '出来高' },
    { id: 'quality', label: '品質' },
    { id: 'overheat', label: '過熱注意' },
  ];

  const {
    isFallbackTopPick,
    topPickSource,
    simpleTopPickAction,
    topPickTickerLabel,
    selectedRankingLabel,
    marketProviderLabel,
    marketUniverseCount,
    isYahooGainersRanking,
    marketScopeLabel,
    marketScopeCount,
    marketPanelTitle,
    marketPanelDescription,
    marketSignalLabel,
    marketContextReasonLabel,
    marketContextTone,
    marketContextUsable,
    marketContextDetail,
    tradeStrategyTitle,
    tradeStrategyReason,
    decisionScoreLabel,
    selectedRankContext,
    selectedDecisionSourceLabel,
    selectedSourceContext,
    selectedSourceEvidence,
    topPickReason,
    topPickMaterial,
    topCandidateMetrics,
    selectedRankingMetric,
    openingScenarioPlan,
    decisionGate,
    dataProvenance,
    jquantsView,
    valueDisciplineLens,
    jobsVerdictHeadline,
    rankingItems,
    practiceTicker,
    practiceName,
    practicePrice,
    practicePriceSource,
    practiceEntry,
    practiceTarget,
    practiceStop,
    practiceShares,
    practiceHoldings,
    practiceOrderValidation,
    practiceTransactions,
    practicePnl,
  } = useDashboardViewModel({
    brokerStatus,
    cached,
    crossEngineCheck,
    jquantsCode,
    jquantsResearch,
    marketRankings,
    marketUniverse,
    rankingKind,
    rankingTabs,
    rankedStocks,
    daytradeTopPick,
    jobsCandidate,
    selectedDetail,
    selectedStock,
    selectedAdvancedReport,
    selectedTicker,
    userSelectedTicker,
    tradePlan,
    positionForm,
    holdings,
    transactions,
    practiceOrders,
    marketStatusView,
    getPracticeOrderValidation,
    compactNumber,
    pct,
    sourceShortLabel,
    shortDate,
    tradeActionLabel,
    yen,
  });

  const researchCoverageItems = useMemo(() => buildResearchCoverage({
    selectedDetail,
    selectedAdvancedReport,
    selectedSourceContext,
    jquantsView,
    marketRankings,
  }), [jquantsView, marketRankings, selectedAdvancedReport, selectedDetail, selectedSourceContext]);

  const disclosureEventSummary = useMemo(() => buildDisclosureEventSummary(selectedDetail || selectedStock, {
    jquantsResearch,
    jquantsView,
    cached,
    env: import.meta.env,
    edinetDisclosure,
    morningCheck: edinetDisclosure?.morningCheck,
  }), [cached, edinetDisclosure, jquantsResearch, jquantsView, selectedDetail, selectedStock]);

  const preopenCheckSummary = useMemo(() => buildPreopenCheckSummary({
    stock: selectedDetail || selectedStock,
    businessWindow: morningCheckWindow,
    earningsCalendar,
    disclosureSummary: disclosureEventSummary,
  }), [disclosureEventSummary, earningsCalendar, morningCheckWindow, selectedDetail, selectedStock]);

  const watchlistPreopenResults = useMemo(() => buildWatchlistPreopenCheck(displayStocks, {
    businessWindow: morningCheckWindow,
    earningsCalendar,
    edinetDisclosure,
    jquantsResearch,
    jquantsView,
    cached,
    env: import.meta.env,
  }), [cached, displayStocks, earningsCalendar, edinetDisclosure, jquantsResearch, jquantsView, morningCheckWindow]);

  const watchlistPreopenSummary = useMemo(
    () => summarizeWatchlistPreopenCheck(watchlistPreopenResults),
    [watchlistPreopenResults],
  );

  const filteredWatchlistPreopenResults = useMemo(
    () => filterPreopenCheckResults(watchlistPreopenResults, watchlistPreopenFilter),
    [watchlistPreopenFilter, watchlistPreopenResults],
  );

  const chatGptConsultationPrompt = useMemo(() => buildChatGptConsultationPrompt({
    topPickTickerLabel,
    daytradeTopPick,
    simpleTopPickAction,
    topPickReason,
    topPickMaterial,
    topCandidateMetrics,
    openingScenarioPlan,
    selectedDetail,
    selectedAdvancedReport,
    crossEngineCheck,
    selectedSourceEvidence,
    tradeStrategyTitle,
    tradeStrategyReason,
    jobsVerdictHeadline,
    marketStatusTopLabel: marketStatusView.topLabel,
    marketFreshnessLabel: marketStatusView.freshnessLabel,
    yen,
    pct,
  }), [
    crossEngineCheck,
    daytradeTopPick,
    jobsVerdictHeadline,
    marketStatusView.freshnessLabel,
    marketStatusView.topLabel,
    openingScenarioPlan,
    selectedAdvancedReport,
    selectedDetail,
    selectedSourceEvidence,
    simpleTopPickAction,
    topCandidateMetrics,
    topPickMaterial,
    topPickReason,
    topPickTickerLabel,
    tradeStrategyReason,
    tradeStrategyTitle,
  ]);

  const copyChatGptPrompt = useCallback(async () => {
    if (!chatGptConsultationPrompt) return;
    const fallbackCopy = () => {
      const textarea = document.createElement('textarea');
      textarea.value = chatGptConsultationPrompt;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(chatGptConsultationPrompt);
      } else {
        fallbackCopy();
      }
    } catch {
      fallbackCopy();
    }
    setChatGptPromptCopied(true);
    window.setTimeout(() => setChatGptPromptCopied(false), 1800);
  }, [chatGptConsultationPrompt]);

  function safeStageLabel(label) {
    if (!label) return '';
    if (label.includes('本命')) return '短期上昇シグナル強';
    if (label.includes('高騰')) return '短期上昇シグナル';
    return label;
  }

  function searchMarket(event) {
    event?.preventDefault?.();
    searchMarketData(searchQuery);
  }

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
      const result = await api(`/daytrade/scan?kind=${encodeURIComponent(rankingKind)}`, { method: 'POST', timeout: 9000 });
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
    addLog('J-Quants', 'J-Quantsデータを確認しています。');
    try {
      const result = await api('/research/jquants/' + encodeURIComponent(code), { timeout: 12000 });
      setJquantsResearch(result);
      addLog('J-Quants', result?.summary || 'J-Quantsリサーチ補助データを読み込みました。');
      writeCache(buildMarketCachePayload({ stocks, portfolio, transactions, daytradePlan, daytradeSignals, daytradeSource, daytradeRisk, brokerStatus, autopilotStatus, alertReport, jquantsResearch: result, advancedReport, jquantsCode: code, selectedTicker, detail }));
    } catch (error) {
      addLog('J-Quants', error?.message || 'J-Quantsデータを取得できませんでした。');
    } finally {
      setBusy('');
    }
  }

  async function saveManualPosition(event) {
    event.preventDefault();
    const result = await submitPracticeOrder({
      source: practicePriceSource,
      referencePrice: practicePrice,
      onBeforePersist: () => {
        setBusy('position');
        addLog('Jobs', '練習注文を台帳へ保存しました。');
      },
      persistPortfolio: (payload) => api('/portfolio/positions', {
        method: 'POST',
        timeout: 12000,
        body: JSON.stringify(payload),
      }),
      onSaved: async (response) => {
        addLog('PORT', response?.message || '練習注文を約定済みとして台帳へ保存しました。');
        await hydrate(true);
      },
      onError: (error) => {
        addLog('SYS', error?.message || '練習注文の保存に失敗しました。');
      },
    });
    if (!result.ok && result.validation?.errors?.length) {
      addLog('SAFE', result.validation.errors[0]);
      return;
    }
    if (!result.ok && result.error) {
      setBusy('');
      return;
    }
    setBusy('');
  }

  const aiFundSummary = aiFundDesk?.summary || aiFundDeskFallback.summary;
  const aiFundDraft = aiFundDesk?.draftOrder;
  const aiFundWorkflow = aiFundDesk?.workflow?.length ? aiFundDesk.workflow : aiFundDeskFallback.workflow;
  const aiFundGuardrails = aiFundDesk?.guardrails?.length ? aiFundDesk.guardrails : aiFundDeskFallback.guardrails;
  const aiFundAudit = aiFundDesk?.auditTrail || aiFundDeskFallback.auditTrail;
  const aiFundReady = aiFundSummary.state === 'APPROVAL_REQUIRED';
  void portfolioStatusLabel;
  void priorityChecklistItems;
  void backtestLabel;
  void exitPlanTone;
  void selectedQuality;
  void selectedDataQuality;
  void archivedHoldings;
  void dataProvenance;
  return (
    <div className={`app-shell ${showDetails ? 'detail-mode' : 'simple-mode'}`}>
      <header className="command-bar">
        <div className="brand-block">
          <div className="brand-mark"><Sparkles size={22} /></div>
          <div>
            <h1>Zen Stock Prophet Pro</h1>
            <p>株式分析シミュレーター / リスク確認</p>
          </div>
        </div>
        <div className="command-actions">
          <StatusPill label={status.text} tone={status.tone} />
          <button className="detail-toggle" type="button" onClick={() => setShowDetails((value) => !value)}>
            <Layers3 size={16} />
            {showDetails ? '判断画面に戻す' : '詳細パネルを表示'}
          </button>
          <button className="icon-button" title="更新" onClick={() => hydrate(false)} disabled={busy === 'sync'}>
            {busy === 'sync' ? <Loader2 size={18} className="spin" /> : <RefreshCcw size={18} />}
          </button>
        </div>
      </header>

      <main className="workspace">
        <TopCandidateCard
          ready={Boolean(daytradeTopPick)}
          topPickTickerLabel={topPickTickerLabel}
          topPickReason={topPickReason}
          daytradeTopPick={daytradeTopPick}
          simpleTopPickAction={simpleTopPickAction}
          isFallbackTopPick={isFallbackTopPick}
          scoreTone={scoreTone}
          marketStatusTopLabel={marketStatusView.topLabel}
          marketFreshnessLabel={marketStatusView.freshnessLabel}
          marketFreshness={marketFreshness}
          topPickSource={topPickSource}
          topCandidateMetrics={topCandidateMetrics}
          selectedRankingLabel={selectedRankingLabel}
          selectedRankingMetric={selectedRankingMetric}
          topPickMaterial={topPickMaterial}
          focusTopPick={openTopPickDetails}
          openingScenarioPlan={openingScenarioPlan}
          briefScore={daytradeTopPick?.probabilityAdjustedProfit ? yen(daytradeTopPick.probabilityAdjustedProfit) : '-'}
          StatusPill={StatusPill}
          yen={yen}
          simpleOpportunityText={simpleOpportunityText}
          riskLevelLabel={riskLevelLabel}
          crossEngineCheck={crossEngineCheck}
          crossEngineGatePreview={crossEngineGatePreview}
          crossEngineGateLabel={crossEngineGateLabel}
          crossEngineTone={crossEngineTone}
          decisionScoreLabel={decisionScoreLabel}
          selectedDecisionSourceLabel={selectedDecisionSourceLabel}
          selectedRankContext={selectedRankContext}
          selectedSourceEvidence={selectedSourceEvidence}
          tradeStrategyTitle={tradeStrategyTitle}
          tradeStrategyReason={tradeStrategyReason}
          jobsCandidate={jobsCandidate}
          selectedAdvancedReport={selectedAdvancedReport}
          decisionGate={decisionGate}
          jobsVerdictHeadline={jobsVerdictHeadline}
          selectedDetail={selectedDetail}
          valueDisciplineLens={valueDisciplineLens}
          chatGptPrompt={chatGptConsultationPrompt}
          chatGptPromptCopied={chatGptPromptCopied}
          onCopyChatGptPrompt={copyChatGptPrompt}
        />

        <PracticeDashboard>
          <div className="practice-chart-panel" data-testid="practice-chart-panel">
            <div className="practice-panel-head">
              <div>
                <span>価格と出来高</span>
                <strong data-testid="practice-chart-symbol">{practiceTicker} {practiceName}</strong>
              </div>
              <StatusPill label="シミュレーション専用" tone="warn" />
              <DataSourceBadge source={practicePriceSource} />
            </div>
            <DataSourceWarning source={practicePriceSource} />
            <div className="practice-chart">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,.12)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="price" domain={['dataMin - 80', 'dataMax + 80']} tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => `¥${Math.round(v)}`} tickLine={false} axisLine={false} width={58} />
                  <YAxis yAxisId="volume" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
                  <Tooltip content={<ProTooltip />} />
                  <Bar yAxisId="volume" dataKey="volume" name="出来高" fill="rgba(96,165,250,.22)" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="price" type="monotone" dataKey="close" name="終値" stroke="#10b981" strokeWidth={3} dot={false} />
                  <Line yAxisId="price" type="monotone" dataKey="sma25" name="SMA25" stroke="#d97706" strokeWidth={2} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="practice-chart-metrics">
              <div><span>現在値</span><strong>{yen(practicePrice)}</strong><DataSourceBadge source={practicePriceSource} compact /></div>
              <div><span>注文上限</span><strong>{yen(practiceEntry)}</strong></div>
              <div><span>利確</span><strong>{yen(practiceTarget)}</strong></div>
              <div><span>撤退</span><strong>{yen(practiceStop)}</strong></div>
            </div>
          </div>

          <form className="practice-order-panel" onSubmit={saveManualPosition}>
            <div className="practice-panel-head">
              <div>
                <span>練習注文</span>
                <strong>手入力前チェック</strong>
              </div>
              <StatusPill label="実注文なし" tone="warn" />
            </div>
            <DataSourceWarning source={practicePriceSource} />
            <div className="practice-order-grid">
              <label>
                <span>銘柄</span>
                <input data-testid="practice-order-ticker" value={positionForm.ticker} onChange={(event) => updatePositionForm('ticker', event.target.value)} placeholder="4980.T" />
              </label>
              <label>
                <span>買値</span>
                <input data-testid="practice-order-price" type="number" min="1" step="0.1" value={positionForm.entryPrice} onChange={(event) => updatePositionForm('entryPrice', event.target.value)} />
              </label>
              <label>
                <span>株数</span>
                <input data-testid="practice-order-shares" type="number" min="1" step="1" value={positionForm.shares} onChange={(event) => updatePositionForm('shares', event.target.value)} />
              </label>
            </div>
            <div className="practice-order-status" data-testid="practice-order-status">
              <StatusPill label={practiceOrderValidation.ok ? practiceOrderStatusLabel(PRACTICE_ORDER_STATUS.DRAFT) : practiceOrderStatusLabel(PRACTICE_ORDER_STATUS.INSUFFICIENT_DATA)} tone={practiceOrderValidation.ok ? 'neutral' : 'warn'} />
              <span>{practiceOrderValidation.ok ? '入力内容を確認してから練習台帳に保存します。' : practiceOrderValidation.errors[0]}</span>
            </div>
            {practiceOrderValidation.warnings.length > 0 && (
              <div className="practice-order-warning" data-testid="practice-order-warning">
                {practiceOrderValidation.warnings.slice(0, 2).map((message) => <small key={message}>{message}</small>)}
              </div>
            )}
            <div className="practice-order-actions">
              <button type="button" className="ghost-action" onClick={() => applyPracticeCandidate({
                ticker: practiceTicker || positionForm.ticker,
                name: practiceName || positionForm.name,
                entryPrice: practiceEntry,
                shares: practiceShares,
                note: '練習注文メモ',
              })}>
                <Target size={15} />
                候補を反映
              </button>
              <button data-testid="practice-order-save" type="submit" className="treasure-button" disabled={busy === 'position'}>
                {busy === 'position' ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                台帳に保存
              </button>
              <button data-testid="practice-order-cancel-current" type="button" className="ghost-action" onClick={() => cancelCurrentPracticeOrder({ source: practicePriceSource, referencePrice: practicePrice })}>
                <XCircle size={15} />
                取消として記録
              </button>
            </div>
            <p className="practice-disclaimer">この保存は練習用の保有台帳です。証券会社への注文、投資助言、利益保証ではありません。</p>
          </form>

          <div className="practice-ledger-panel">
            <div className="practice-panel-head">
              <div>
                <span>保有と損益</span>
                <strong>保有と損益</strong>
              </div>
              <StatusPill label={practiceHoldings.length + '件'} tone="info" />
            </div>
            <div className="practice-pnl-strip">
              <div><span>{practiceTicker} 評価額</span><strong>{yen(practiceHoldings.reduce((sum, item) => sum + Number(item.value || 0), 0))}</strong><DataSourceBadge source={practicePriceSource} compact /></div>
              <div><span>現金</span><strong>{yen(portfolio?.cash)}</strong></div>
              <div><span>含み損益</span><strong className={practicePnl >= 0 ? 'up' : 'down'}>{yen(practicePnl)}</strong></div>
            </div>
            <div className="practice-position-list">
              {practiceHoldings.slice(0, 3).map((holding) => (
                <div key={`practice-holding-${holding.ticker}`}>
                  <span>{holding.ticker}</span>
                  <strong>{holding.shares}株 / {yen(holding.currentPrice)}</strong>
                  <small className={Number(holding.pnl || 0) >= 0 ? 'up' : 'down'}>{yen(holding.pnl)} / {pct(holding.pnlPct)}</small>
                </div>
              ))}
              {!practiceHoldings.length && <small>{practiceTicker} の練習保有を保存すると、ここに損益が表示されます。</small>}
            </div>
          </div>

          <div className="practice-history-panel">
            <div className="practice-panel-head">
              <div>
                <span>練習注文履歴</span>
                <strong>履歴</strong>
              </div>
              <StatusPill label={practiceTicker + ' 最新5件'} tone="neutral" />
            </div>
            <div className="practice-history-list" data-testid="practice-history-list">
              {practiceTransactions.map((tx) => (
                <div data-testid="practice-history-item" key={'practice-tx-' + (tx.id || tx.createdAt || tx.ticker + '-' + tx.action)}>
                  <span>{tx.statusLabel || tradeActionLabel(tx.action)}</span>
                  <strong>{tx.ticker} {tx.shares}株</strong>
                  <small>{yen(tx.price)} / {yen(tx.total)}</small>
                  {tx.sourceLabel && <small>データ出所: {tx.sourceLabel}</small>}
                  {tx.saveError && <small className="down">保存失敗: {tx.saveError}</small>}
                  {tx.isPracticeOrder && tx.practiceStatus === PRACTICE_ORDER_STATUS.PENDING && (
                    <div className="practice-history-actions">
                      <button type="button" onClick={() => markPracticeOrderFilled(tx.id)}>約定済みにする</button>
                      <button type="button" onClick={() => cancelPracticeOrder(tx.id)}>取消</button>
                    </div>
                  )}
                </div>
              ))}
              {!practiceTransactions.length && <small>{practiceTicker} の練習注文を保存すると、履歴に残ります。</small>}
            </div>
          </div>
        </PracticeDashboard>

        <DetailPanels>
        <section className={`ai-fund-panel ${aiFundReady ? 'ready' : 'watch'}`} aria-label="AIファンドデスク">
          <div className="ai-fund-head">
            <div>
              <div className="section-title"><Bot size={18} /><span>ローカル分析デスク</span></div>
              <h2>根拠とリスクの管制塔</h2>
              <p>売買案、運用監視、決済判断をローカルのシミュレーションと承認待ち確認票だけに限定します。実注文API、証券会社、RPAには接続しません。</p>
            </div>
            <div className="ai-fund-status">
              <StatusPill label={aiFundReady ? '承認待ち下書きあり' : '監視中'} tone={aiFundReady ? 'warn' : 'info'} />
              <StatusPill label={aiFundDesk?.liveBrokerOrdersEnabled ? '実注文ON' : '実注文OFF'} tone={aiFundDesk?.liveBrokerOrdersEnabled ? 'bad' : 'good'} />
            </div>
          </div>
          <div className="ai-fund-summary">
            <div>
              <span>現在の分析</span>
              <strong>{aiFundSummary.headline}</strong>
              <small>信頼度 {Number(aiFundSummary.confidencePct || 0).toFixed(1)}% / 期待損益 {yen(aiFundSummary.expectedProfitJpy)} / 最大損失 {yen(aiFundSummary.maxLossJpy)}</small>
            </div>
            <div>
              <span>口座風ビュー</span>
              <strong>現金 {yen(aiFundSummary.portfolioCashJpy)}</strong>
              <small>保有銘柄 {aiFundSummary.activeHoldingCount || 0}件 / 予算 {yen(aiFundDesk?.budgetJpy || JOBS_SIM_BUDGET_JPY)}</small>
            </div>
            <div>
              <span>データ範囲</span>
              <strong>株式中心</strong>
              <small>この実装は国内株シミュレーターに限定。暗号資産、為替、商品、外部取引所操作は未接続です。</small>
            </div>
          </div>
          <div className="ai-fund-workflow">
            {aiFundWorkflow.map((lane) => (
              <article key={lane.id} className={`ai-lane ${lane.status?.toLowerCase?.() || 'wait'}`}>
                <span>{lane.label}</span>
                <strong>{aiFundStatusLabel(lane.status)}</strong>
                <p>{lane.summary}</p>
                <div>{(lane.evidence || []).slice(0, 3).map((item, index) => <small key={`${lane.id}-evidence-${index}-${item}`}>{item}</small>)}</div>
              </article>
            ))}
          </div>
          <div className="ai-fund-bottom">
            <div className="draft-order-panel">
              <div className="section-title"><BriefcaseBusiness size={16} /><span>確認票下書き</span></div>
              {aiFundDraft ? (
                <div className="draft-ticket">
                  <div><span>銘柄</span><strong>{aiFundDraft.ticker} {aiFundDraft.name}</strong></div>
                  <div><span>売買</span><strong>{aiFundOrderSideLabel(aiFundDraft.side)} {aiFundDraft.shares}株</strong></div>
                  <div><span>指値</span><strong>{yen(aiFundDraft.entryPrice)}</strong></div>
                  <div><span>利確 / 損切</span><strong>{yen(aiFundDraft.takeProfit)} / {yen(aiFundDraft.stopLoss)}</strong></div>
                </div>
              ) : (
                <p className="empty-note">承認対象の確認票はまだありません。ランキング更新後に候補が出た場合だけ表示します。</p>
              )}
              <div className="audit-mini-list">
                {(aiFundAudit.whyBuy || []).slice(0, 3).map((item, index) => <small key={`fund-why-buy-${index}-${item}`}><CheckCircle2 size={13} />{item}</small>)}
                {(aiFundAudit.whyNotBuy || []).slice(0, 2).map((item, index) => <small key={`fund-why-not-${index}-${item}`}><AlertTriangle size={13} />{item}</small>)}
              </div>
            </div>
            <div className="guardrail-panel">
              <div className="section-title"><ShieldCheck size={16} /><span>暴走防止</span></div>
              {aiFundGuardrails.map((item, index) => (
                <div key={`fund-guard-${index}-${item.label}`} className={item.ok ? 'guard-pass' : 'guard-warn'}>
                  {item.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="portfolio-ledger-events" data-testid="ai-portfolio-ledger-events">
            <div className="section-title"><Archive size={16} /><span>{pendingLifecycle ? '台帳更新中' : '保有履歴'}</span></div>
            {lifecycleFeed.length ? lifecycleFeed.map((event) => (
              <div key={event.id} className={`portfolio-ledger-event ${event.ok ? 'success' : 'error'}`} data-testid="ai-portfolio-ledger-event">
                <strong>{event.title}</strong>
                <span>{event.subtitle}</span>
                <small>{event.message}</small>
              </div>
            )) : <small>保有銘柄の更新履歴はまだありません。</small>}
          </div>
        </section>

        <section className="market-intel-panel" aria-label="東証マーケット">
          <div className="market-intel-head">
            <div>
              <div className="section-title"><BarChart3 size={18} /><span>東証マーケット</span></div>
              <h2>{marketPanelTitle}</h2>
              <p>{marketPanelDescription}</p>
            </div>
            <div className="market-meta">
              <StatusPill label={`${marketScopeLabel} ${marketScopeCount}`} tone="info" />
              {isYahooGainersRanking ? <StatusPill label={marketContextReasonLabel} tone={marketContextTone} /> : null}
              <StatusPill label="実注文オフ" tone="warn" />
            </div>
          </div>
          <div className="market-kpi-row">
            <div className="metric">
              <span>対象銘柄</span>
              <strong>{isYahooGainersRanking ? 'Yahoo掲載分' : marketUniverseCount.toLocaleString('ja-JP')}</strong>
            </div>
            <div className="metric">
              <span>ランキング更新</span>
              <strong>{marketRankings?.generatedAt ? new Date(marketRankings.generatedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未スキャン'}</strong>
            </div>
            <div className="metric">
              <span>データ元</span>
              <strong>{marketProviderLabel}</strong>
            </div>
            <div className="metric">
              <span>判定軸</span>
              <strong>{marketSignalLabel}</strong>
            </div>
            {isYahooGainersRanking && (
              <div className="metric">
                <span>地合い品質</span>
                <strong>{marketContextReasonLabel}</strong>
              </div>
            )}
          </div>
          {isYahooGainersRanking && (
            <div className={`market-context-note ${marketContextUsable ? 'usable' : 'review'}`}>
              <span>市場コンテキスト</span>
              <strong>{marketContextReasonLabel}</strong>
              <small>{marketContextDetail}</small>
            </div>
          )}
          <div className="market-controls">
            <div className="ranking-tabs" role="tablist" aria-label="ランキング種別">
              {rankingTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={rankingKind === tab.id ? 'active' : ''}
                  onClick={() => loadMarketRankings(tab.id)}
                  aria-busy={busy === 'market' && rankingKind === tab.id}
                >
                  {busy === 'market' && rankingKind === tab.id ? <Loader2 size={14} className="spin" /> : null}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
            <form className="market-search" onSubmit={searchMarket}>
              <Search size={16} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="コード・銘柄名・業種で検索 例: 7203 / semiconductor"
                aria-label="東証銘柄検索"
              />
              <button type="submit" disabled={busy === 'market-search'}>
                {busy === 'market-search' ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
                <span>検索</span>
              </button>
            </form>
          </div>
          <div className="market-content-grid">
            <div className="ranking-table">
              <div className="table-title">
                <span>{isYahooGainersRanking ? 'Yahoo掲載順位' : selectedRankingLabel + '候補'}</span>
                <small>{marketRankings?.provider || 'ウォッチリスト即時表示'}</small>
              </div>
              {rankingItems.slice(0, 12).map((item) => {
                const audit = item.intradayOpportunity?.decisionAudit;
                const yahooRank = item.siteRank || item.rank;
                const rankLabel = isYahooGainersRanking
                  ? (yahooRank ? `Yahoo #${yahooRank}` : '-')
                  : (item.candidateRank || item.rank || '-');
                const rankDetail = isYahooGainersRanking && yahooRank
                  ? `Zen #${item.candidateRank || '-'}`
                  : item.candidateRank && item.rank && item.candidateRank !== item.rank
                    ? `元順位 #${item.rank}`
                    : null;
                const stageLabel = item.surgeStage ? safeStageLabel(item.surgeStage) : null;
                const crossCheck = item.advancedCrossEngineCheck || item.intradayOpportunity?.advancedCrossEngineCheck;
                const rowSubLabel = [item.name, stageLabel, audit?.label, rankingCrossEngineLabel(crossCheck)].filter(Boolean).join(' / ');
                const scoreLabel = audit?.verdict
                  ? `${verificationStatusLabel(audit.verdict)} ${Number(item.intradayOpportunity?.opportunityScore || 0).toFixed(0)}`
                  : Number(item.surgeScore ?? item.candidateScore ?? 0).toFixed(0);
                const activeMetric = rankingMetricDisplay(item, rankingKind);

                return (
                  <button className="market-row" key={`${rankingKind}-${item.ticker}`} onClick={() => selectMarketTicker(item)}>
                    <b className="market-rank-cell">
                      <strong>{rankLabel}</strong>
                      {rankDetail ? <small>{rankDetail}</small> : null}
                    </b>
                    <span>
                      <strong>{item.ticker}</strong>
                      <small>{rowSubLabel || item.name}</small>
                    </span>
                    <span className={activeMetric.tone === 'down' ? 'market-down' : activeMetric.tone === 'up' ? 'market-up' : ''}>
                      <small>{activeMetric.label}</small>
                      <strong>{activeMetric.value}</strong>
                    </span>
                    <span>{yen(item.price)}</span>
                    <span>{item.turnoverJpy ? yen(item.turnoverJpy) : compactNumber(item.volume)}</span>
                    <span className={audit?.verdict ? `audit-verdict ${audit.verdict.toLowerCase()}` : ''}>{scoreLabel}</span>
                  </button>
                );
              })}
            </div>
            <div className="search-results-panel">
              <div className="table-title">
                <span>詳細検索</span>
                <small>{marketSearch?.items?.length ? marketSearch.count + '件' : '未検索'}</small>
              </div>
              {(marketSearch?.items?.length ? marketSearch.items : marketUniverse?.sample || []).slice(0, 12).map((item) => (
                <button className="search-result-row" key={`search-${item.ticker}`} onClick={() => selectMarketTicker(item)}>
                  <span>
                    <strong>{item.ticker} {item.name}</strong>
                    <small>{item.marketSection || '市場区分未取得'} / {item.sector || '業種未取得'}</small>
                  </span>
                  <span>{item.price ? yen(item.price) : '価格未取得'}</span>
                  <span className={Number(item.changePct || 0) >= 0 ? 'market-up' : 'market-down'}>
                    {item.changePct != null ? pct(item.changePct) : '-'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section ref={advancedAnalysisRef} className="advanced-analysis-panel" data-testid="advanced-analysis-panel" aria-label="高度分析">
          <div className="advanced-analysis-head">
            <div>
              <div className="section-title"><BrainCircuit size={18} /><span>高度分析エンジン</span></div>
              <h2>{selectedAdvancedReport?.actionLabel || '銘柄選択に連動して確率分析を準備中'}</h2>
              <p>トレンド、出来高、リスク、ウォークフォワード検証を総合して表示します。投資助言ではありません。</p>
            </div>
            <StatusPill label={selectedAdvancedReport ? '統合スコア ' + selectedAdvancedReport.compositeScore + '/100' : '未取得'} tone={scoreTone(selectedAdvancedReport?.compositeScore)} />
          </div>
          <div className="advanced-score-grid">
            {[
              ['トレンド', selectedAdvancedReport?.factors?.trend?.score, selectedAdvancedReport?.factors?.trend?.state || '-'],
              ['勢い', selectedAdvancedReport?.factors?.momentumScore, '5日 ' + pct(selectedAdvancedReport?.factors?.momentum5Pct) + ' / 20日 ' + pct(selectedAdvancedReport?.factors?.momentum20Pct)],
              ['流動性', selectedAdvancedReport?.factors?.liquidityScore, '出来高 ' + ratioLabel(selectedAdvancedReport?.factors?.volumeRatio)],
              ['リスク管理', selectedAdvancedReport?.factors?.riskControlScore, 'ATR ' + pct(selectedAdvancedReport?.factors?.atrPct)],
              ['検証', selectedAdvancedReport?.walkForward?.score, '標本数 ' + (selectedAdvancedReport?.walkForward?.sampleCount ?? 0)],
              ['分析信頼度', selectedAdvancedReport?.analysisReliability?.score, selectedAdvancedReport?.analysisReliability?.label || '-'],
              ['データ品質', selectedAdvancedReport?.dataQuality?.score, (selectedAdvancedReport?.dataQuality?.source || '-')],
            ].map(([label, value, note]) => (
              <div key={label} className={`advanced-factor ${scoreTone(value)}`}>
                <span>{label}</span>
                <strong>{Number.isFinite(Number(value)) ? Number(value).toFixed(0) + '/100' : '-'}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>
          <div className="research-coverage-panel" data-testid="research-coverage-panel">
            <div className="research-coverage-head">
              <div>
                <span>無料リサーチ網羅度</span>
                <strong>判断材料の揃い具合</strong>
              </div>
              <small>無料API・公開データ・ローカル検証の取得状況です。未確認項目は取引前の確認候補として扱ってください。</small>
            </div>
            <div className="research-coverage-grid">
              {researchCoverageItems.map((item) => (
                <div key={item.id} className={`research-coverage-item ${item.tone}`}>
                  <div>
                    <span>{item.label}</span>
                    <strong>{item.status}</strong>
                  </div>
                  <small>{item.source}</small>
                  <p>{item.detail}</p>
                  <em>{item.action}</em>
                </div>
              ))}
            </div>
          </div>
          <div className={`preopen-check-panel ${preopenCheckSummary.risk}`} data-testid="preopen-check-panel">
            <div className="preopen-check-head">
              <div>
                <span>寄り付き前チェック</span>
                <strong>{preopenCheckSummary.status}</strong>
              </div>
              <StatusPill label={`注意度 ${preopenCheckSummary.riskLabel}`} tone={preopenCheckSummary.risk === 'high' ? 'danger' : preopenCheckSummary.risk === 'medium' ? 'warn' : preopenCheckSummary.risk === 'low' ? 'good' : 'neutral'} />
            </div>
            <p className="preopen-check-caution">{preopenCheckSummary.caution}</p>
            <div className="preopen-check-grid">
              <div>
                <span>対象日</span>
                <strong>{preopenCheckSummary.businessWindow.targetDate || '未設定'}</strong>
                <small>{preopenCheckSummary.businessWindow.businessDay.label}</small>
              </div>
              <div>
                <span>営業日判定</span>
                <strong>{preopenCheckSummary.businessWindow.businessDay.reason}</strong>
                <small>{preopenCheckSummary.businessWindow.businessDay.holidayDataStatus.label}</small>
              </div>
              <div>
                <span>前営業日</span>
                <strong>{preopenCheckSummary.businessWindow.previousBusinessDay || '判定不可'}</strong>
                <small>次営業日 {preopenCheckSummary.businessWindow.nextBusinessDay || '判定不可'}</small>
              </div>
              <div>
                <span>確認対象期間</span>
                <strong>{preopenCheckSummary.businessWindow.periodLabel}</strong>
                <small>前営業日引け後から当日寄り付き前まで</small>
              </div>
              <div>
                <span>EDINET確認</span>
                <strong>{disclosureEventSummary.sourceStatus.edinet.label}</strong>
                <small>{disclosureEventSummary.edinetMeta.matchMethod}</small>
              </div>
              <div>
                <span>決算予定確認</span>
                <strong>{preopenCheckSummary.earningsSourceStatus.label}</strong>
                <small>{preopenCheckSummary.earningsSourceStatus.detail}</small>
              </div>
            </div>
            <div className="preopen-earnings-list">
              {preopenCheckSummary.earnings.length ? preopenCheckSummary.earnings.map((item, index) => (
                <div className="preopen-earnings-row" key={`${item.date}-${item.ticker}-${index}`}>
                  <div>
                    <span>{item.date || '-'}</span>
                    <strong>{item.ticker || preopenCheckSummary.ticker} {item.companyName}</strong>
                    <small>{item.fiscalPeriod} / {item.scheduledTime} / {item.source}{item.cached ? ' / キャッシュ利用' : ''}</small>
                  </div>
                  <div>
                    <StatusPill label={item.date === preopenCheckSummary.businessWindow.targetDate ? '重要予定あり' : '予定確認'} tone={item.date === preopenCheckSummary.businessWindow.targetDate ? 'danger' : 'warn'} />
                    {item.url ? <a href={item.url} target="_blank" rel="noreferrer">一次情報</a> : <small>URLなし</small>}
                  </div>
                </div>
              )) : (
                <div className="preopen-empty">
                  <strong>決算予定データは未取得です</strong>
                  <span>{preopenCheckSummary.earningsSourceStatus.detail}</span>
                </div>
              )}
            </div>
            {preopenCheckSummary.unknownInputs.length ? (
              <div className="preopen-check-note">
                <strong>確認不足</strong>
                <span>{preopenCheckSummary.unknownInputs.join(' / ')}</span>
              </div>
            ) : null}
          </div>
          <div className={`disclosure-check-panel ${disclosureEventSummary.risk}`} data-testid="disclosure-check-panel">
            <div className="disclosure-check-head">
              <div>
                <span>開示・決算チェック</span>
                <strong>{disclosureEventSummary.status}</strong>
              </div>
              <StatusPill label={`注意度 ${disclosureEventSummary.riskLabel}`} tone={disclosureEventSummary.risk === 'high' ? 'danger' : disclosureEventSummary.risk === 'medium' ? 'warn' : disclosureEventSummary.risk === 'low' ? 'good' : 'neutral'} />
            </div>
            <p className="disclosure-check-caution">{disclosureEventSummary.caution}</p>
            <div className="disclosure-meta-grid">
              <div>
                <span>対象期間</span>
                <strong>{disclosureEventSummary.edinetMeta.periodLabel}</strong>
              </div>
              <div>
                <span>EDINET最終確認</span>
                <strong>{disclosureEventSummary.edinetMeta.fetchedAt ? shortDate(disclosureEventSummary.edinetMeta.fetchedAt) : '未確認'}</strong>
              </div>
              <div>
                <span>照合方法</span>
                <strong>{disclosureEventSummary.edinetMeta.matchMethod}</strong>
              </div>
            </div>
            <div className="disclosure-source-grid">
              {Object.entries(disclosureEventSummary.sourceStatus).map(([key, status]) => (
                <div key={key} className={`disclosure-source ${status.tone}`}>
                  <span>{key === 'edinet' ? 'EDINET' : key === 'tdnet' ? 'TDnet' : key === 'jquants' ? 'J-Quants' : 'キャッシュ'}</span>
                  <strong>{status.label}</strong>
                  <small>{status.detail}</small>
                </div>
              ))}
            </div>
            <div className="disclosure-event-list">
              {disclosureEventSummary.events.length ? disclosureEventSummary.events.map((event, index) => (
                <div className="disclosure-event-row" key={`${event.date}-${event.title}-${index}`}>
                  <div className="disclosure-event-main">
                    <span>{event.date || '-'}</span>
                    <strong>{event.classification}</strong>
                    <p>{event.title}</p>
                    <small>{event.summary}</small>
                  </div>
                  <div className="disclosure-event-source">
                    <span>{event.source}</span>
                    {event.url ? <a href={event.url} target="_blank" rel="noreferrer">一次情報</a> : <small>URLなし</small>}
                  </div>
                </div>
              )) : (
                <div className="disclosure-empty">
                  <strong>直近イベントは表示できていません</strong>
                  <span>EDINET、TDnet、J-Quants、公式開示の一次情報を取引前に確認してください。</span>
                </div>
              )}
            </div>
          </div>
          {selectedAdvancedReport?.mlPrediction ? (
            <div className={`ml-verification-card ${selectedAdvancedReport.mlPrediction.status || 'insufficient'}`} data-testid="ml-verification-card">
              <div className="ml-verification-head">
                <div>
                  <span>{selectedAdvancedReport.mlPrediction.roleLabel || 'AI検証補助'}</span>
                  <strong>{selectedAdvancedReport.mlPrediction.label || '参考不足'}</strong>
                </div>
                <StatusPill
                  label={`補助判定 ${selectedAdvancedReport.mlPrediction.confidenceLabel || selectedAdvancedReport.mlPrediction.label || '参考不足'}`}
                  tone={mlPredictionTone(selectedAdvancedReport.mlPrediction.status)}
                />
              </div>
              <div className="ml-verification-grid">
                <div>
                  <span>{selectedAdvancedReport.mlPrediction.horizonDays || 5}営業日上昇確率</span>
                  <strong>{Number(selectedAdvancedReport.mlPrediction.probabilityUpPct || 0).toFixed(1)}%</strong>
                </div>
                <div>
                  <span>検証精度</span>
                  <strong>{Number(selectedAdvancedReport.mlPrediction.walkForwardHitRatePct || 0).toFixed(1)}%</strong>
                </div>
                <div>
                  <span>単純基準との差</span>
                  <strong>{Number(selectedAdvancedReport.mlPrediction.edgePct || 0).toFixed(1)}pt</strong>
                </div>
                <div>
                  <span>検証標本</span>
                  <strong>{selectedAdvancedReport.mlPrediction.sampleCount || 0}件</strong>
                </div>
              </div>
              <div className="ml-verification-note">
                <ShieldCheck size={15} />
                <span>{selectedAdvancedReport.mlPrediction.disclaimer || 'AI検証補助は投資助言ではありません。候補を疑うための参考材料として扱ってください。'}</span>
              </div>
              {(selectedAdvancedReport.mlPrediction.warnings || []).slice(0, 3).map((warning, index) => (
                <div className="ml-verification-warning" key={`ml-warning-${index}-${warning}`}>{warning}</div>
              ))}
              {selectedAdvancedReport.mlPrediction.topFeatures?.length ? (
                <div className="ml-feature-list">
                  {selectedAdvancedReport.mlPrediction.topFeatures.slice(0, 4).map((feature) => (
                    <span key={feature.feature}>{feature.label}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="advanced-analysis-body">
            <div>
              <h3>根拠</h3>
              <p>{selectedAdvancedReport?.reason || selectedDetail?.analysis?.reason || '分析根拠を取得中です。'}</p>
            </div>
            <div>
              <h3>リスク</h3>
              <p>{selectedAdvancedReport?.riskNote || '価格変動、流動性、材料イベントを確認してから判断してください。'}</p>
            </div>
          </div>
          <div className="advanced-explainability">
            {(selectedAdvancedReport?.explainability || []).slice(0, 8).map((item, index) => (
              <span key={`explain-${index}-${item}`}>{item}</span>
            ))}
          </div>
        </section>

        <section className="jquants-panel">
          <div className="jquants-head">
            <div>
              <div className="section-title"><Activity size={18} /><span>J-Quantsリサーチ</span></div>
              <h2>日本株の公式ヒストリカル / 財務データ補助</h2>
              <p>J-Quantsは日次提供でリアルタイム板ではありません。公式履歴・財務の根拠確認として使い、直近価格は補完データと分けて表示します。</p>
            </div>
            <div className="jquants-status-pills">
              <StatusPill label={jquantsView.statusLabel} tone={jquantsView.statusTone} />
              <StatusPill label={jquantsView.integrityLabel} tone={jquantsView.integrityTone} />
            </div>
          </div>
          <div className="jquants-controls">
            <input value={jquantsCode} onChange={(event) => setJquantsCode(event.target.value)} placeholder="4980.T" aria-label="J-Quants銘柄コード" />
            <button className="treasure-button" onClick={loadJquantsResearch} disabled={!!busy}>
              {busy === 'jquants' ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
              <span>確認</span>
            </button>
          </div>
          <div className="jquants-grid">
            <div className="metric"><span>接続モード</span><strong>{jquantsView.modeLabel || '未接続'}</strong></div>
            <div className="metric"><span>対象</span><strong>{jquantsView.targetLabel}</strong></div>
            <div className="metric"><span>終値</span><strong>{jquantsView.latestClose}</strong></div>
            <div className="metric"><span>EPS / BPS</span><strong>{jquantsView.epsBps}</strong></div>
            <div className="metric"><span>出所</span><strong>{jquantsView.latestSource}</strong></div>
            <div className="metric"><span>公式履歴</span><strong>{jquantsView.officialStatus}</strong></div>
            <div className="metric"><span>整合性</span><strong>{verificationStatusLabel(jquantsView.integrity?.verdict)}</strong></div>
          </div>
          <div className="jquants-note"><ShieldCheck size={16} /><span>{jquantsView.note}</span></div>
        </section>

        {showOpeningGapDesk && (
        <section className="daytrade-panel">
          <div className="daytrade-head">
            <div>
              <div className="section-title"><Activity size={18} /><span>寄り付きギャップ確認</span></div>
              <h2>ローカル短期シミュレーション</h2>
              <p>{daytradePlan?.premise || '寄り付き後の値動き、出来高、VWAPを確認してから方針を判断します。'}</p>
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
            <span>データ取得元: <b>{daytradeSource}</b></span>
            <span>証券連携: <b>無効</b></span>
            <span>オートパイロット: <b>{autopilotStatus?.running ? '稼働中' : '停止中'}</b></span>
            <span>確認回数: <b>{autopilotStatus?.cycles || 0}</b></span>
            <span>{brokerStatus?.message}</span>
          </div>
          <div className="intraday-analysis-card">
            <div className="intraday-analysis-head">
              <div>
                <span>{selectedTicker} / 短期分析</span>
                <strong>{daytradeAnalysis ? `${daytradeAnalysis.label} ${Number(daytradeAnalysis.score || 0).toFixed(1)} / 100` : '分析取得中'}</strong>
                <p>{daytradeAnalysis?.explanations?.[0] || 'VWAP、出来高、RSI、MACD、ボリンジャーバンド、サポレジをまとめて確認します。'}</p>
              </div>
              <div className="interval-switcher" aria-label="時間足">
                {['1m', '5m', '15m', '1d'].map((interval) => (
                  <button key={interval} type="button" className={daytradeInterval === interval ? 'active' : ''} onClick={() => setDaytradeInterval(interval)} disabled={busy === 'detail'} title={interval + '時間軸'}>{interval}</button>
                ))}
              </div>
            </div>
            {daytradeAnalysis ? (
              <>
                <div className="intraday-metric-grid">
                  {[
                    ['VWAP', yen(daytradeAnalysis.indicators?.vwap)],
                    ['RSI', Number(daytradeAnalysis.indicators?.rsi || 0).toFixed(1)],
                    ['MACD', Number(daytradeAnalysis.indicators?.macd?.histogram || 0).toFixed(2)],
                    ['出来高倍率', Number(daytradeAnalysis.indicators?.volumeRatio || 0).toFixed(2) + 'x'],
                    ['ATR', pct(daytradeAnalysis.indicators?.atrPct)],
                    ['支持線', yen(daytradeAnalysis.indicators?.support)],
                    ['抵抗線', yen(daytradeAnalysis.indicators?.resistance)],
                    ['キャッシュ', cacheStatusLabel(daytradeAnalysis.cacheStatus) + ' ' + Number(daytradeAnalysis.cacheAgeSec || 0).toFixed(0) + '秒'],
                  ].map(([label, value]) => (
                    <div className="metric" key={`intraday-${label}`}><span>{label}</span><strong>{value}</strong></div>
                  ))}
                </div>
                <div className="intraday-levels">
                  <div><span>エントリー候補</span><strong>{yen(daytradeAnalysis.levels?.entryCandidate)}</strong></div>
                  <div><span>利確候補</span><strong>{yen(daytradeAnalysis.levels?.takeProfitCandidate)}</strong></div>
                  <div><span>撤退ライン</span><strong>{yen(daytradeAnalysis.levels?.stopLossCandidate)}</strong></div>
                  <div><span>RR</span><strong>{Number(daytradeAnalysis.levels?.riskReward || 0).toFixed(2)}</strong></div>
                </div>
                <div className="intraday-evidence-grid">
                  <div><span>根拠</span>{(daytradeAnalysis.evidence || []).slice(0, 6).map((item) => <small key={item.id} className={item.ok ? 'pass' : 'block'}>{item.ok ? 'OK' : 'NG'} {item.label}: {item.detail}</small>)}</div>
                  <div><span>騙し除外</span>{(daytradeAnalysis.fakeoutFilters || []).length ? daytradeAnalysis.fakeoutFilters.map((item) => <small className="block" key={item}>{item}</small>) : <small className="pass">目立つ騙し条件なし</small>}</div>
                  <div><span>バックテスト</span><small>取引 {daytradeAnalysis.backtest?.trades || 0}件 / 勝率 {Number(daytradeAnalysis.backtest?.winRatePct || 0).toFixed(1)}%</small><small>平均 {pct(daytradeAnalysis.backtest?.avgReturnPct)} / PF {Number(daytradeAnalysis.backtest?.profitFactor || 0).toFixed(2)}</small></div>
                  <div><span>材料イベント</span><small>{daytradeAnalysis.indicators?.eventRisk?.latestTitle || 'イベント未確認'}</small><small>{daytradeAnalysis.indicators?.eventRisk?.source || '出所未確認'} / {materialToneLabel(daytradeAnalysis.indicators?.eventRisk?.tone)}</small></div>
                </div>
              </>
            ) : (
              <div className="empty-note">短期分析を取得できませんでした。時間足を切り替えるか、詳細データの取得状態を確認してください。</div>
            )}
          </div>
          <div className="commute-routine-panel">
            <div className="commute-routine-head">
              <div><span>{selectedTicker} / 寄り付き後方針</span><strong>{daytradeRoutine ? `${daytradeRoutine.priority} / ${daytradeRoutine.verdict}` : '待機'}</strong><p>{daytradeRoutine?.summary || '寄り付き後の価格、出来高、VWAPを確認してから方針を表示します。'}</p></div>
              <div className="manual-only-badge">手動判断のみ</div>
            </div>
            {daytradeRoutine ? (
              <div className="commute-price-strip">
                {[
                    ['注文上限', yen(daytradeRoutine.mobileSummary?.orderUpperLimit)],
                    ['利確', yen(daytradeRoutine.mobileSummary?.takeProfit)],
                    ['撤退', yen(daytradeRoutine.mobileSummary?.stopLoss)],
                    ['接近通知', yen(daytradeRoutine.mobileSummary?.warningPrice)],
                  ['スコア', Number(daytradeRoutine.mobileSummary?.score || 0).toFixed(1) + '/100'],
                    ['RR', Number(daytradeRoutine.mobileSummary?.riskReward || 0).toFixed(2)],
                ].map(([label, value]) => <div key={`routine-${label}`}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
            ) : <div className="empty-note">寄り付き後方針は未取得です。</div>}
          </div>
          <div className="daytrade-verdict"><ShieldCheck size={16} /><span>{daytradeRisk?.jobsVerdict}</span><strong>準備完了 {readyDaytradeSignals.length}</strong></div>
        </section>
        )}
        </DetailPanels>

        <section className="hero-panel">
          <WatchlistPanel>
            <div className="watchlist-header">
              <div className="watchlist-title">
                <span><Layers3 size={16} /> AI補助</span>
                <strong>条件一致ウォッチリスト</strong>
              </div>
              <button className="treasure-button" onClick={() => runAction('screen')} disabled={busy === 'screen'} title="全市場スクリーニングを更新">
                {busy === 'screen' ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
                <span>更新</span>
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
              {displayStocks.map((stock) => (
                <button
                  key={stock.ticker}
                  data-testid="watchlist-stock-card"
                  data-ticker={stock.ticker}
                  className={`stock-card ${stock.ticker === selectedTicker ? 'active' : ''} ${stock.mustInclude ? 'pinned' : ''} ${stockDecisionTone(stock.decision)}`}
                  onClick={() => chooseTicker(stock, { source: 'watchlist', note: '監視リスト銘柄を反映' })}
                >
                  <span className="candidate-badge">
                    {stock.preopenDecision || (
                      stock.decision === 'DAYTRADE_ENTRY_OK' ? '買い候補'
                        : stock.decision === 'BUY_LIMIT_OK' ? '買い候補'
                          : stock.decision === 'REPRICE_FOR_DAYTRADE' ? '価格待ち'
                            : stock.decision === 'BUY_ON_PULLBACK' ? '押し目待ち'
                              : stock.mustInclude ? '固定観察'
                                : '観察'
                    )}
                  </span>
                  <span className="stock-emoji">{stock.emoji || 'JP'}</span>
                  <span className="stock-name">{displayStockName(stock)}</span>
                  <span className="stock-meta">{stock.ticker}</span>
                  <span className="candidate-score">候補スコア {Math.round(stock.preopenScore ?? stock.candidateScore ?? stock.confidence)} / 100</span>
                  {candidateDataQuality(stock) && (
                    <span className={`candidate-data-quality ${dataQualityTone(candidateDataQuality(stock))}`}>
                      {dataQualitySummary(candidateDataQuality(stock))}
                    </span>
                  )}
                  {preopenRiskLabels(stock.preopenReport) && <span className="candidate-risk">{preopenRiskLabels(stock.preopenReport)}</span>}
                  {stock.buyLimit && <span className="candidate-score">注文上限 {yen(stock.buyLimit)} / 現在値乖離 {pct(stock.entryGapPct)}</span>}
                  <span className="candidate-reason">{stock.candidateReason}</span>
                  <span className="current-price-label">現在値</span>
                  <strong>{yen(stock.price)}</strong>
                  <DataSourceBadge source={priceSourcePayload(marketRankings?.isCached ? { isCached: true, source: 'cache' } : null, stock, stock.dataQuality)} compact />
                </button>
              ))}
            </div>
            <div className="watchlist-preopen-panel" data-testid="watchlist-preopen-panel">
              <div className="watchlist-preopen-head">
                <div>
                  <span>寄り付き前材料確認</span>
                  <strong>ウォッチリスト一括チェック</strong>
                  <small>{morningCheckWindow.periodLabel} / 最終確認 {shortDate(edinetDisclosure?.fetchedAt || earningsCalendar?.fetchedAt || new Date().toISOString())}</small>
                </div>
                <StatusPill
                  label={watchlistPreopenSummary.important ? `重要予定あり ${watchlistPreopenSummary.important}件` : '材料確認'}
                  tone={watchlistPreopenSummary.important ? 'danger' : watchlistPreopenSummary.review ? 'warn' : watchlistPreopenSummary.missing ? 'neutral' : 'good'}
                />
              </div>
              <p className="watchlist-preopen-caution">
                ウォッチリスト全銘柄の寄り付き前材料を確認しました。本機能は売買を推奨するものではありません。必ず一次情報をご確認ください。
              </p>
              <div className="watchlist-preopen-summary">
                <div><span>対象銘柄数</span><strong>{watchlistPreopenSummary.total}</strong></div>
                <div><span>確認済み</span><strong>{watchlistPreopenSummary.checked}</strong></div>
                <div><span>重要予定あり</span><strong>{watchlistPreopenSummary.important}</strong></div>
                <div><span>確認推奨</span><strong>{watchlistPreopenSummary.review}</strong></div>
                <div><span>データ未取得</span><strong>{watchlistPreopenSummary.missing}</strong></div>
                <div><span>目立つ材料なし</span><strong>{watchlistPreopenSummary.quiet}</strong></div>
                <div><span>エラー</span><strong>{watchlistPreopenSummary.errors}</strong></div>
              </div>
              <div className="watchlist-preopen-filters" data-testid="watchlist-preopen-filters">
                {[
                  ['all', 'すべて'],
                  ['important', '重要予定あり'],
                  ['review', '確認推奨'],
                  ['missing', 'データ未取得'],
                  ['quiet', '目立つ材料なし'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={watchlistPreopenFilter === value ? 'active' : ''}
                    onClick={() => setWatchlistPreopenFilter(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="watchlist-preopen-list" data-testid="watchlist-preopen-list">
                {filteredWatchlistPreopenResults.length ? filteredWatchlistPreopenResults.map((item) => (
                  <details className={`watchlist-preopen-row ${item.risk}`} key={`${item.ticker}-${item.status}`} data-testid="watchlist-preopen-row">
                    <summary>
                      <span className="watchlist-preopen-ticker">{item.ticker || '照合不可'}</span>
                      <span className="watchlist-preopen-name">{item.companyName}</span>
                      <StatusPill label={item.status} tone={item.risk === 'high' ? 'danger' : item.risk === 'medium' ? 'warn' : item.risk === 'low' ? 'good' : 'neutral'} />
                      <span>注意度 {item.riskLabel}</span>
                      <span>EDINET {item.hasEdinetDocuments ? `${item.edinetDocuments.length}件` : 'なし'}</span>
                      <span>決算予定 {item.hasEarnings ? `${item.earnings.length}件` : 'なし'}</span>
                    </summary>
                    <div className="watchlist-preopen-detail">
                      <div>
                        <strong>確認対象期間</strong>
                        <span>{item.periodLabel}</span>
                      </div>
                      <div>
                        <strong>照合方法</strong>
                        <span>{item.matchMethod}</span>
                      </div>
                      <div>
                        <strong>データ取得状況</strong>
                        <span>EDINET {item.sourceStatus.edinet.label} / 決算 {item.sourceStatus.earnings.label} / 営業日 {item.sourceStatus.businessCalendar.label}</span>
                      </div>
                      <div className="watchlist-preopen-events">
                        <strong>EDINET提出書類</strong>
                        {item.edinetDocuments.length ? item.edinetDocuments.map((event, index) => (
                          <p key={`${event.docID || event.title}-${index}`}>{event.date} / {event.classification} / {event.title}</p>
                        )) : <p>対象期間のEDINET提出書類は表示されていません。</p>}
                      </div>
                      <div className="watchlist-preopen-events">
                        <strong>決算予定</strong>
                        {item.earnings.length ? item.earnings.map((event, index) => (
                          <p key={`${event.date}-${event.ticker}-${index}`}>{event.date} / {event.fiscalPeriod} / {event.scheduledTime} / {event.source}</p>
                        )) : <p>決算予定データは未取得、または対象予定がありません。</p>}
                      </div>
                      <p className="watchlist-preopen-detail-caution">{item.caution}</p>
                      {item.unknownInputs.length ? <p className="watchlist-preopen-missing">確認不足: {item.unknownInputs.join(' / ')}</p> : null}
                    </div>
                  </details>
                )) : (
                  <div className="watchlist-preopen-empty">選択中のフィルターに該当する銘柄はありません。</div>
                )}
              </div>
            </div>
          </WatchlistPanel>

          <div className="focus-card" data-testid="selected-focus-card">
            <div className="focus-head">
              <div>
                <small>{selectedStock?.ticker}</small>
                <h2>{selectedStock?.emoji || 'JP'} {displayStockName(selectedStock || selectedTicker)}</h2>
              </div>
              <div className="price-block">
                <strong data-testid="selected-detail-price">{yen(selectedDetail?.price || selectedStock?.price)}</strong>
                <DataSourceBadge source={selectedSourceContext} compact />
                <span className={Number(selectedDetail?.changePct || 0) >= 0 ? 'up' : 'down'}>
                  {Number(selectedDetail?.changePct || 0) >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  {pct(selectedDetail?.changePct)}
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
                    <span>監視する上限価格</span>
                    <strong>{yen(tradePlan.entry)}</strong>
                    <p>現在値と注文上限の差を確認し、寄り付き直後は価格を追わずに待ちます。</p>
                  </div>
                  <div className="decision-card">
                    <span>利確 / 損切り</span>
                    <strong>{yen(tradePlan.target)} / {yen(tradePlan.stop)}</strong>
                    <p>RRと損切り目安を先に確認し、許容損失を超える場合は見送ります。</p>
                  </div>
                  <div className="decision-card">
                    <span>株数目安</span>
                    <strong>{tradePlan.suggestedShares > 0 ? `${tradePlan.suggestedShares}株` : '今回は見送り'}</strong>
                    <p>資金と損失上限に収まる株数だけを練習注文へ反映します。</p>
                  </div>
                  <div className="decision-card danger">
                    <span>買わない条件</span>
                    <strong>撤退条件</strong>
                    <p>{tradePlan.avoidCondition}</p>
                  </div>
                </div>
                {selectedPreopen && (
                  <div className="preopen-panel">
                    <div className="preopen-head">
                      <div><span>寄り付き前判定</span><h3>{selectedPreopen.decisionLabel} {selectedPreopen.score} / 100</h3></div>
                      <StatusPill label="分析支援" tone={selectedPreopen.score >= 55 ? 'warn' : 'neutral'} />
                    </div>
                    <div className="score-breakdown-grid">
                      {[
                        ['材料', selectedPreopen.scoreBreakdown?.material],
                        ['需給', selectedPreopen.scoreBreakdown?.flow],
                        ['安全性', selectedPreopen.scoreBreakdown?.safety],
                        ['過熱', selectedPreopen.scoreBreakdown?.overheat],
                      ].map(([label, value]) => <span key={label}>{label}: {Number(value || 0).toFixed(0)}</span>)}
                    </div>
                    <p>{selectedPreopen.summary}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'chart' && (
              <div className="chart-box">
                <div className="chart-source-row">
                  <span>チャート表示価格</span>
                  <DataSourceBadge source={selectedSourceContext} />
                </div>
                <DataSourceWarning source={selectedSourceContext} />
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
                    ['RSI', selectedDetail?.analysis?.indicators?.rsi?.toFixed?.(1) || '-'],
                    ['MACD', selectedDetail?.analysis?.indicators?.macd?.macd?.toFixed?.(2) || '-'],
                    ...riskMetrics,
                    ['利確目安', yen(selectedDetail?.analysis?.strategy?.sell_limit)],
                    ['損切り目安', yen(selectedDetail?.analysis?.strategy?.stop_loss)],
                  ].map(([label, value]) => (
                    <div className="metric" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="checklist">
                  {portfolioHealth.checklist.map((item, index) => (
                    <div key={`portfolio-health-${index}-${item.label}`} className={item.done ? 'done' : ''}>
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

        <PortfolioLedger>
        <section className="portfolio-manager">
          <div className="portfolio-manager-head">
            <div>
              <div className="section-title"><BriefcaseBusiness size={18} /><span>保有台帳と売却判断</span></div>
              <h2>買った銘柄を保存し、売るタイミングを毎回見直す</h2>
              <p>買値・株数を手入力すると、現在値、含み損益、地合い、値動きから利確・撤退・保有継続の目安を出します。注文は出しません。</p>
            </div>
            <StatusPill label={marketToneLabel(portfolio?.marketContext?.tone)} tone={portfolio?.marketContext?.riskOff ? 'warn' : 'info'} />
          </div>
          <form className="position-form" onSubmit={saveManualPosition}>
            <label><span>銘柄コード</span><input data-testid="ledger-order-ticker" value={positionForm.ticker} onChange={(event) => updatePositionForm('ticker', event.target.value)} placeholder="4980.T" /></label>
            <label><span>銘柄名</span><input value={positionForm.name} onChange={(event) => updatePositionForm('name', event.target.value)} placeholder="銘柄名" /></label>
            <label><span>参考価格</span><input type="number" min="1" step="0.1" value={positionForm.entryPrice} onChange={(event) => updatePositionForm('entryPrice', event.target.value)} /></label>
            <label><span>株数</span><input type="number" min="1" step="1" value={positionForm.shares} onChange={(event) => updatePositionForm('shares', event.target.value)} /></label>
            <button data-testid="ledger-order-save" className="treasure-button" type="submit" disabled={busy === 'position'}>{busy === 'position' ? <Loader2 size={15} className="spin" /> : <Save size={15} />}練習台帳へ保存</button>
          </form>
          <div className="portfolio-grid">
            <div className="metric"><span>総資産</span><strong>{yen(portfolio?.totalAssets)}</strong></div>
            <div className="metric"><span>現金</span><strong>{yen(portfolio?.cash)}</strong></div>
            <div className="metric"><span>含み損益</span><strong>{yen(portfolio?.unrealizedPnl)}</strong></div>
            <div className="metric"><span>データ出所</span><strong>{selectedSourceContext?.label || selectedSourceContext?.source || '-'}</strong></div>
          </div>
          <div className="holdings-list">
            {(portfolio?.holdings || []).map((holding) => (
              <article key={holding.ticker} data-testid="holding-row" className="holding-card" onClick={() => chooseTicker(holding, { source: 'portfolio', note: '保有銘柄から選択' })}>
                <div><strong>{holding.ticker}</strong><span>{displayStockName(holding)}</span></div>
                <div><span>{holding.shares}株</span><strong>{yen(holding.currentPrice || holding.price)}</strong></div>
                <small className={Number(holding.pnl || 0) >= 0 ? 'up' : 'down'}>{yen(holding.pnl)} / {pct(holding.pnlPct)}</small>
                <div className="holding-lifecycle-actions" aria-label={holding.ticker + ' 台帳操作'}>
                  <button type="button" onClick={(event) => { event.stopPropagation(); closePortfolioPosition(holding, 'SOLD'); }}>売却済み</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); closePortfolioPosition(holding, 'VOIDED'); }}>非表示</button>
                </div>
              </article>
            ))}
            {!(portfolio?.holdings || []).length && <small className="empty-note">保有銘柄はありません。</small>}
          </div>
          <div className="portfolio-ledger-events" data-testid="portfolio-ledger-events">
            <div className="section-title"><Archive size={16} /><span>{pendingLifecycle ? '台帳更新中' : '保有履歴'}</span></div>
            {lifecycleFeed.length ? lifecycleFeed.map((event) => (
              <div key={event.id} className={`portfolio-ledger-event ${event.ok ? 'success' : 'error'}`} data-testid="portfolio-ledger-event">
                <strong>{event.title}</strong><span>{event.subtitle}</span><small>{event.message}</small>
              </div>
            )) : <small>保有銘柄の更新履歴はまだありません。</small>}
          </div>
          <div className="activity-log">
            <div className="section-title"><Archive size={16} /><span>操作履歴</span></div>
            {log.slice(0, 8).map((log, index) => <small key={`log-${index}-${log.time || ''}`}>{log.time} {log.type}: {log.message}</small>)}
          </div>
        </section>
        </PortfolioLedger>
      </main>

      <aside className="ops-panel">
        <div className="section-title"><Bot size={18} /><span>操作ログ</span></div>
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
            <div key={`${entry.tag}-${index}`}><span>{operationLogTagLabel(entry.tag)}</span><p>{entry.text}</p></div>
          ))}
        </div>
        <div className="recent-box">
          <h3><ShieldCheck size={16} /> 品質評価</h3>
          {verdictRows.map((row) => <div className="verdict-row" key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
          <p className="verdict-copy">{jobsVerdictHeadline}</p>
        </div>
        <div className="notice"><AlertTriangle size={15} />このツールは学習・分析・シミュレーション専用です。実注文や投資助言は行いません。</div>
      </aside>
    </div>
  );
}

