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
import { api, readFreshCache, writeCache } from './api/apiClient';
import CandidateSummary from './components/CandidateSummary';
import { DataSourceBadge, DataSourceWarning } from './components/DataSourceBadge';
import DetailPanels from './components/DetailPanels';
import PortfolioLedger from './components/PortfolioLedger';
import PracticeDashboard from './components/PracticeDashboard';
import WatchlistPanel from './components/WatchlistPanel';
import { useMarketData } from './hooks/useMarketData';
import { portfolioStatusLabel, usePortfolioLedger } from './hooks/usePortfolioLedger';
import { PRACTICE_ORDER_STATUS, practiceOrderStatusLabel, usePracticeOrder } from './hooks/usePracticeOrder';
import { useSelectedStock } from './hooks/useSelectedStock';
import { dataSourceBadgeInfo } from './utils/dataSource';
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
      { ticker: '7203.T', name: 'Toyota', emoji: 'TY', shares: 80, avgCost: 2850, currentPrice: 3000, value: 240000, pnl: 12000, pnlPct: 5.3 },
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

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function ratioLabel(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '-';
  return `${number.toFixed(2)}x`;
}

function lotSharesForBudget(entry, budget = JOBS_SIM_BUDGET_JPY) {
  const price = Number(entry || 0);
  if (!price) return 0;
  return Math.floor(budget / price);
}

function scoreTone(value) {
  const number = Number(value || 0);
  if (number >= 72) return 'good';
  if (number >= 55) return 'info';
  return 'warn';
}

function normalizeIntradayOpportunity(opportunity, source) {
  if (!opportunity?.ticker) return null;
  const maxLoss = Number(opportunity.maxLossJpy || 0);
  const targetProfit = Number(opportunity.targetProfitJpy || 0);
  return {
    ticker: opportunity.ticker,
    name: opportunity.name,
    siteRank: opportunity.siteRank,
    candidateRank: opportunity.candidateRank,
    rank: opportunity.rank,
    entry: Number(opportunity.entryPrice || 0),
    target: Number(opportunity.targetPrice || 0),
    stop: Number(opportunity.stopLoss || 0),
    shares: Number(opportunity.shares || 0),
    budgetUsed: Number(opportunity.budgetUsedJpy || 0),
    expectedProfit: targetProfit,
    probabilityAdjustedProfit: Number(opportunity.expectedProfitJpy || 0),
    maxLoss,
    score: Number(opportunity.confidencePct || 0),
    opportunityScore: Number(opportunity.opportunityScore || 0),
    confidencePct: Number(opportunity.confidencePct || 0),
    changePct: opportunity.changePct,
    surgeScore: opportunity.surgeScore,
    overheatRisk: opportunity.overheatRisk,
    candidateReason: `短期スコア ${Number(opportunity.surgeScore || 0).toFixed(1)}、前日比 ${pct(opportunity.changePct)}、過熱リスク ${Number(opportunity.overheatRisk || 0).toFixed(1)} を加味して、50万円枠の期待損益を比較しています。`,
    whyBuy: opportunity.whyBuy || [],
    whyNotBuy: opportunity.whyNotBuy || [],
    invalidConditions: opportunity.invalidConditions || [],
    decisionAudit: opportunity.decisionAudit || null,
    advancedCrossEngineCheck: opportunity.advancedCrossEngineCheck || null,
    advancedReportSummary: opportunity.advancedReportSummary || null,
    scoreBreakdown: opportunity.scoreBreakdown || null,
    dataFreshness: opportunity.dataFreshness || {},
    material: opportunity.material || {},
    setupQualityGrade: opportunity.setupQualityGrade || opportunity.scoreBreakdown?.setupQualityGrade || '-',
    expertRiskLevel: opportunity.expertRiskLevel || opportunity.scoreBreakdown?.expertRiskLevel || 'unknown',
    tradeReadiness: opportunity.tradeReadiness || opportunity.scoreBreakdown?.tradeReadiness || 'review',
    positionSizingVerdict: opportunity.positionSizingVerdict || opportunity.scoreBreakdown?.positionSizingVerdict || 'reduced',
    expertWarnings: opportunity.expertWarnings || [],
    expertChecklist: opportunity.expertChecklist || [],
    availabilityMode: opportunity.availabilityMode || 'STRICT_MATCH',
    isFallbackCandidate: Boolean(opportunity.isFallbackCandidate),
    displayDecision: opportunity.displayDecision || null,
    simpleAction: opportunity.simpleAction || null,
    primaryWarning: opportunity.primaryWarning || null,
    disclaimer: opportunity.disclaimer,
    rr: maxLoss > 0 ? (targetProfit / maxLoss).toFixed(2) : '-',
    affordable: Number(opportunity.shares || 0) > 0,
    source,
  };
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
  if (text.includes('finance.yahoo.co.jp')) return 'Yahoo Finance';
  if (text === 'yfinance') return 'yfinance';
  if (text === 'yahoo_chart') return 'Yahoo chart';
  if (text === 'stooq') return 'Stooq';
  if (text === 'JPX_MASTER') return 'JPX銘柄マスタ';
  return text.length > 36 ? `${text.slice(0, 34)}...` : text;
}

function priceSourcePayload(...items) {
  const merged = {};
  items.filter(Boolean).forEach((item) => {
    if (typeof item === 'string') {
      if (!merged.source) merged.source = item;
      return;
    }
    Object.assign(merged, item);
  });
  return merged;
}

function suppressSyntheticAction(action, source) {
  return dataSourceBadgeInfo(source).key === 'synthetic' ? '参考表示' : action;
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
  const [jquantsCode, setJquantsCode] = useState(cached?.jquantsCode || PINNED_WATCH_TICKER);
  const [rankingKind, setRankingKind] = useState('gainers');
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

  const {
    stocks,
    portfolio,
    transactions,
    detail,
    setDetail,
    advancedReport,
    setAdvancedReport,
    marketUniverse,
    marketRankings,
    marketSearch,
    marketFreshness,
    hydrateMarketData,
    loadDetail,
    loadMarketRankings,
    searchMarket: searchMarketData,
  } = useMarketData({
    cached,
    fallback: demo,
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

  const hydrate = useCallback(async (background = false) => {
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
      writeCache({
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
        jquantsCode,
        selectedTicker,
        detail,
      });
    } catch (error) {
      setStatus({ tone: 'warn', text: 'オフライン高速表示' });
      addLog('SYS', `API応答を短縮: ${error.message}`);
    } finally {
      setBusy('');
    }
  }, [addLog, advancedReport, aiFundDesk, alertReport, autopilotStatus, brokerStatus, daytradePlan, daytradeRisk, daytradeRoutine, daytradeSignals, daytradeSource, detail, hydrateMarketData, jquantsCode, jquantsResearch, marketRankings, marketSearch, marketUniverse, portfolio, rankingKind, searchQuery, selectedTicker, stocks, transactions]);

  const loadDaytradeAnalysis = useCallback(async (ticker, interval = daytradeInterval) => {
    if (!ticker) return;
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
      writeCache({
        stocks, portfolio, transactions, daytradePlan, daytradeSignals, daytradeSource, daytradeRisk,
        daytradeInterval: interval, daytradeAnalysis: result, daytradeRoutine: nextDaytradeRoutine, brokerStatus, autopilotStatus, alertReport,
        jquantsResearch, advancedReport, jquantsCode, selectedTicker: ticker, detail,
      });
      addLog('SIM', `${ticker} ${interval} の短期スコアを更新しました。`);
    } catch (error) {
      addLog('SYS', `${ticker} ${interval} の短期分析は未取得: ${error.message}`);
    }
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
      .slice(0, WATCHLIST_DISPLAY_LIMIT);
  }, [stocks]);

  const browserMarketStatus = useMemo(() => currentTokyoMarketStatus(), []);
  const marketStatus = marketRankings?.marketStatus || browserMarketStatus;
  const isRegularSession = marketStatus?.isOpen !== false;
  const marketStatusTopLabel = isRegularSession ? '取引時間中' : '時間外';
  const marketFreshnessLabel = marketFreshness?.lastUpdated
    ? `${marketFreshness.isCached || marketFreshness.stale ? '参考更新' : 'データ更新'} ${marketFreshness.lastUpdated.toLocaleTimeString('ja-JP')}`
    : 'データ更新 未確認';

  const daytradeTopPick = useMemo(() => {
    const strictPick = marketRankings?.bestOpportunity;
    const fallbackPick = marketRankings?.bestAvailableOpportunity;
    if (!strictPick && !fallbackPick && rankedStocks?.length) {
      const candidate = rankedStocks[0];
      const entry = Number(candidate.buyLimit || candidate.price || 0);
      const target = Number(candidate.sellLimit || (entry ? entry * 1.018 : 0));
      const stop = Number(candidate.stopLoss || (entry ? entry * 0.992 : 0));
      const shares = lotSharesForBudget(entry);
      const targetProfit = Math.max(0, (target - entry) * shares);
      const maxLoss = Math.max(0, (entry - stop) * shares);
      return normalizeIntradayOpportunity({
        ticker: candidate.ticker,
        name: candidate.name,
        entryPrice: entry,
        targetPrice: target,
        stopLoss: stop,
        shares,
        budgetUsedJpy: entry * shares,
        targetProfitJpy: targetProfit,
        expectedProfitJpy: targetProfit * 0.55,
        maxLossJpy: maxLoss,
        confidencePct: Number(candidate.confidence || candidate.candidateScore || 50),
        changePct: candidate.entryGapPct || 0,
        surgeScore: candidate.preopenScore || candidate.candidateScore || 0,
        overheatRisk: candidate.overheatRisk || 0,
        availabilityMode: 'WATCHLIST_FALLBACK',
        isFallbackCandidate: true,
        simpleAction: '暫定候補',
        displayDecision: 'WAIT_FOR_RANKING',
        primaryWarning: 'ランキング更新中です。正式候補が出るまでは価格・材料確認用の暫定表示です。',
        whyBuy: [candidate.candidateReason || 'ウォッチリスト内で最上位の候補です。'],
        whyNotBuy: ['ランキング更新完了後に最終確認してください。'],
        invalidConditions: ['価格が注文上限を超える', '材料や流動性が確認できない'],
        expertRiskLevel: 'medium',
        tradeReadiness: 'review',
        positionSizingVerdict: shares > 0 ? 'reduced' : 'skip',
      }, 'watchlist-fallback-candidate');
    }
    return normalizeIntradayOpportunity(
      strictPick || fallbackPick,
      strictPick ? 'global-best-intraday-opportunity' : 'best-available-daytrade-candidate',
    );
  }, [marketRankings, rankedStocks]);

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

  const displayStocks = useMemo(() => {
    const syncTopPickIntoWatchlist = (items) => {
      if (!daytradeTopPick?.ticker) return items;
      const topPickStock = {
        ticker: daytradeTopPick.ticker,
        name: daytradeTopPick.name || daytradeTopPick.ticker,
        emoji: 'JP',
        price: daytradeTopPick.entry,
        candidateScore: daytradeTopPick.score,
        candidateRank: 0,
        candidateReason: `デイトレ候補レビューと同じ条件一致トップです。${daytradeTopPick.candidateReason}`,
        buyLimit: daytradeTopPick.entry,
        sellLimit: daytradeTopPick.target,
        stopLoss: daytradeTopPick.stop,
        entryGapPct: daytradeTopPick.changePct || 0,
        confidence: daytradeTopPick.confidencePct,
        preopenScore: daytradeTopPick.score,
        preopenDecision: '条件一致',
        decision: 'DAYTRADE_ENTRY_OK',
        source: daytradeTopPick.source,
      };
      const existingIndex = items.findIndex((stock) => stock.ticker === daytradeTopPick.ticker);
      if (existingIndex === -1) return [topPickStock, ...items].slice(0, WATCHLIST_DISPLAY_LIMIT);
      return items.map((stock, index) => (
        index === existingIndex
          ? { ...stock, ...topPickStock, mustInclude: stock.mustInclude }
          : stock
      ));
    };

    const fillFromRankings = (items) => {
      const next = [...items];
      const seen = new Set(next.map((stock) => stock.ticker));
      const fillerItems = [
        ...(marketRankings?.items || []),
        ...(marketSearch?.items || []),
        ...(marketUniverse?.sample || []),
        ...WATCHLIST_FALLBACK_CANDIDATES,
      ];
      for (const item of fillerItems) {
        if (next.length >= WATCHLIST_DISPLAY_LIMIT) break;
        if (!item?.ticker || seen.has(item.ticker)) continue;
        const opportunity = normalizeIntradayOpportunity(item.intradayOpportunity || item, 'watchlist-ranking-fill');
        next.push({
          ticker: item.ticker,
          name: item.name || item.ticker,
          emoji: 'JP',
          price: opportunity?.entry || item.price || 0,
          candidateScore: opportunity?.score || item.candidateScore || item.surgeScore || 0,
          candidateRank: item.candidateRank || item.rank,
          candidateReason: opportunity?.candidateReason || item.reason || item.surgeStage || 'ランキング候補から補完表示しています。',
          buyLimit: opportunity?.entry || item.price,
          sellLimit: opportunity?.target,
          stopLoss: opportunity?.stop,
          entryGapPct: item.changePct || 0,
          confidence: opportunity?.confidencePct || item.confidence || item.candidateScore || 0,
          preopenScore: opportunity?.score || item.surgeScore || item.candidateScore || 0,
          preopenDecision: opportunity?.simpleAction || item.surgeStage || '候補',
          decision: opportunity?.tradeReadiness === 'avoid' ? 'AVOID' : 'DAYTRADE_ENTRY_OK',
          source: item.source || opportunity?.source,
        });
        seen.add(item.ticker);
      }
      return next.slice(0, WATCHLIST_DISPLAY_LIMIT);
    };

    return fillFromRankings(syncTopPickIntoWatchlist(rankedStocks)).map((stock) => {
      if (!detail || detail.ticker !== stock.ticker) return stock;
      return {
        ...stock,
        price: detail.price ?? stock.price,
        buyLimit: detail.analysis?.strategy?.buy_limit ?? stock.buyLimit,
        sellLimit: detail.analysis?.strategy?.sell_limit ?? stock.sellLimit,
        stopLoss: detail.analysis?.strategy?.stop_loss ?? stock.stopLoss,
        entryGapPct: detail.analysis?.execution?.entryGapPct ?? stock.entryGapPct,
        decision: detail.analysis?.execution?.decision ?? stock.decision,
        candidateQuality: detail.candidateQuality ?? stock.candidateQuality,
        preopenReport: detail.preopenReport ?? stock.preopenReport,
        preopenScore: detail.preopenScore ?? stock.preopenScore,
        preopenDecision: detail.preopenDecision || stock.preopenDecision,
        candidateReason: detail.analysis?.technicalSummary || stock.candidateReason,
      };
    });
  }, [daytradeTopPick, detail, marketRankings, marketSearch, marketUniverse, rankedStocks]);

  const jobsCandidate = useMemo(() => {
    const selectedRankingItem = (marketRankings?.items || []).find((item) => item.ticker === selectedTicker);
    const opportunity = selectedRankingItem?.intradayOpportunity
      || (marketRankings?.bestOpportunity?.ticker === selectedTicker ? marketRankings.bestOpportunity : null)
      || (marketRankings?.bestAvailableOpportunity?.ticker === selectedTicker ? marketRankings.bestAvailableOpportunity : null);
    if (opportunity?.ticker) {
      return normalizeIntradayOpportunity(opportunity, 'selected-intraday-opportunity');
    }
    const candidate = selectedStock || rankedStocks.find((stock) => stock.ticker === selectedTicker) || null;
    if (!candidate) return null;
    const entry = Number(candidate.buyLimit || candidate.price || 0);
    const target = Number(candidate.sellLimit || (entry ? entry * 1.018 : 0));
    const stop = Number(candidate.stopLoss || (entry ? entry * 0.992 : 0));
    const shares = lotSharesForBudget(entry);
    const budgetUsed = shares * entry;
    const expectedProfit = Math.max(0, (target - entry) * shares);
    const maxLoss = Math.max(0, (entry - stop) * shares);
    const score = Number(candidate.preopenScore ?? candidate.candidateScore ?? candidate.confidence ?? 0);
    return {
      ...candidate,
      entry,
      target,
      stop,
      shares,
      budgetUsed,
      expectedProfit,
      probabilityAdjustedProfit: expectedProfit * Math.max(0.01, Math.min(0.95, score / 100)),
      maxLoss,
      score,
      rr: candidate.rrRatio || (maxLoss > 0 ? (expectedProfit / maxLoss).toFixed(2) : '-'),
      affordable: shares > 0,
      whyBuy: [candidateReason(candidate)],
      whyNotBuy: ['根拠データが不足する場合、または板・ニュースを確認できない場合は見送り'],
      invalidConditions: ['損切り価格を下回る', '出来高が細る', '重要ニュースが未確認'],
      dataFreshness: {
        latestBarDate: candidate.latestBarDate,
        priceAsOfDate: candidate.priceAsOfDate || candidate.latestBarDate,
        source: candidate.source,
        priceSource: candidate.priceSource || candidate.dataQuality?.source || candidate.source,
        rankingSource: candidate.source,
        sourceFetchedDate: candidate.sourceFetchedDate,
        sourceFetchedAt: candidate.sourceFetchedAt,
      },
      material: candidate.material || selectedDetail?.material || {},
      disclaimer: 'これは売買指示ではなく、条件一致に基づく投資シミュレーションです。',
      source: 'selected-watchlist',
    };
  }, [selectedDetail, marketRankings, rankedStocks, selectedStock, selectedTicker]);

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
  const jobsVerdictHeadline = useMemo(() => {
    if (!daytradeTopPick?.ticker) return tradePlan.headline;
    const action = daytradeTopPick.simpleAction || (daytradeTopPick.isFallbackCandidate ? '買い候補' : '承認待ち候補');
    const entryText = daytradeTopPick.entry ? `指値 ${yen(daytradeTopPick.entry)}` : '指値確認中';
    const riskText = daytradeTopPick.primaryWarning || tradePlan.headline;
    return `${daytradeTopPick.ticker} ${action} / ${entryText}. ${riskText}`;
  }, [daytradeTopPick, tradePlan.headline]);

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
        ok: Boolean(selectedDetail?.freshness?.priceOk),
        detail: '最新日足の日付が古い場合は実注文判断に使いません。',
      },
      {
        label: 'デイトレ監視候補の判定である',
        ok: ['DAYTRADE_ENTRY_OK', 'BUY_LIMIT_OK'].includes(tradePlan.decision),
        detail: '押し目待ちや観察銘柄を、監視候補には混ぜません。',
      },
      {
        label: 'ランキングと高度分析が矛盾しない',
        ok: crossEngineCheck.status === 'aligned',
        detail: crossEngineCheck.detail,
      },
      {
        label: '直近ニュース鮮度を確認済み',
        ok: Boolean(selectedDetail?.freshness?.newsOk),
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
      label: passed === items.length ? '手入力前チェック通過' : '待機 / 再確認',
    };
  }, [brokerStatus, crossEngineCheck, selectedDetail, tradePlan]);

  const dataProvenance = useMemo(() => {
    const policy = jquantsResearch?.dataPolicy;
    return [
      {
        label: '価格データ',
        value: selectedDetail?.latestBarDate ? `${selectedDetail.latestBarDate} 更新` : jquantsResearch?.latestQuote?.source || selectedDetail?.source || '未確認',
        note: selectedDetail?.latestBarAgeDays != null
          ? `最新日足は${selectedDetail.latestBarAgeDays}日前。直近12週間はyfinance補完、リアルタイム板ではありません。`
          : '価格鮮度を確認できない場合は実注文判断に使いません。',
      },
      {
        label: '直近値動き',
        value: selectedDetail?.recentWindow?.priceChangePct != null ? pct(selectedDetail.recentWindow.priceChangePct) : '-',
        note: selectedDetail?.recentWindow?.from
          ? `${selectedDetail.recentWindow.from}〜${selectedDetail.recentWindow.to} / ${selectedDetail.recentWindow.tradingDays}営業日`
          : '直近2週間相当の終値変化を取得できません。',
      },
      {
        label: '決算・開示・ニュース',
        value: selectedDetail?.news?.count ? `${selectedDetail.news.count}件 / ${selectedDetail?.material?.tone || '確認'}` : '未取得',
        note: selectedDetail?.news?.latestPublishedAt
          ? `最新: ${shortDate(selectedDetail.news.latestPublishedAt)} / ${selectedDetail?.news?.summary || '材料確認済み'}`
          : '決算・適時開示・重要ニュースが取得できない場合は、材料未確認として扱います。',
      },
      {
        label: '公式履歴',
        value: jquantsResearch?.configured ? 'J-Quants API' : '未接続',
        note: policy ? `${policy.recentWindowDays}日以内は補完、古い履歴はJ-Quants` : 'J-Quants設定後に公式履歴を確認できます。',
      },
    ];
  }, [selectedDetail, jquantsResearch]);

  function safeStageLabel(label) {
    if (!label) return '';
    if (label.includes('本命')) return '短期上昇シグナル強';
    if (label.includes('高騰')) return '短期上昇シグナル';
    return label;
  }

  const rankingTabs = [
    { id: 'surge', label: '短期上昇' },
    { id: 'gainers', label: '値上がり率' },
    { id: 'breakout', label: '高値更新' },
    { id: 'popular', label: '人気' },
    { id: 'volume', label: '出来高' },
    { id: 'quality', label: '品質' },
    { id: 'overheat', label: '過熱注意' },
  ];

  const rankingItems = marketRankings?.items?.length
    ? marketRankings.items
    : rankedStocks.map((stock, index) => ({
      rank: index + 1,
      ticker: stock.ticker,
      name: stock.name,
      price: stock.price,
      changePct: stock.entryGapPct || 0,
      volume: 0,
      turnoverJpy: 0,
      candidateScore: stock.candidateScore,
      surgeScore: stock.candidateScore,
      overheatRisk: 0,
      surgeStage: stock.decision === 'AVOID' ? '過熱注意' : '上昇監視',
      reason: stock.candidateReason,
    }));

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
    addLog('J-Quants', `${code} の日本株リサーチ補助データを確認します。発注は行いません。`);
    try {
      const result = await api(`/research/jquants/${encodeURIComponent(code)}`, { timeout: 12000 });
      setJquantsResearch(result);
      addLog('J-Quants', result?.summary || 'J-Quantsリサーチ補助データを読み込みました。');
      writeCache({ stocks, portfolio, transactions, daytradePlan, daytradeSignals, daytradeSource, daytradeRisk, brokerStatus, autopilotStatus, alertReport, jquantsResearch: result, advancedReport, jquantsCode: code, selectedTicker, detail });
    } catch (error) {
      addLog('J-Quants', `J-Quantsリサーチを利用できません: ${error.message}`);
    } finally {
      setBusy('');
    }
  }

  async function saveManualPosition(event) {
    event.preventDefault();
    const result = await submitPracticeOrder({
      source: practicePriceSource,
      referencePrice: practicePrice,
      onBeforePersist: (payload) => {
        setBusy('position');
        addLog('Jobs', `${payload.ticker} ${payload.entryPrice}円 ${payload.shares}株を練習注文として保有台帳へ記録します。実注文は出しません。`);
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
        addLog('SYS', `保有台帳の更新に失敗しました。練習履歴には未約定として残します: ${error.message}`);
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

  const jquantsConfigured = Boolean(jquantsResearch?.configured);
  const selectedJquantsCode = (jquantsCode || selectedTicker || '').replace(/\.T$/i, '');
  const researchCode = String(jquantsResearch?.code || '').replace(/\.T$/i, '');
  const jquantsResearchMatchesSelection = !researchCode || researchCode === selectedJquantsCode;
  const jquantsIntegrity = jquantsResearchMatchesSelection ? jquantsResearch?.sourceIntegrity : null;
  const jquantsStatusLabel = jquantsConfigured ? 'J-Quants 接続済み' : 'J-Quants 未接続';
  const jquantsStatusTone = jquantsConfigured ? 'good' : 'neutral';
  const jquantsIntegrityTone = jquantsIntegrity?.verdict === 'PASS'
    ? 'good'
    : jquantsIntegrity?.verdict === 'REVIEW'
      ? 'warn'
      : 'neutral';
  const jquantsIntegrityLabel = jquantsIntegrity?.label || (jquantsResearchMatchesSelection ? (jquantsConfigured ? '接続確認のみ' : '未接続') : '銘柄未確認');
  const jquantsModeLabel = jquantsConfigured ? jquantsResearch?.mode : 'トークン未設定';
  const jquantsTargetLabel = jquantsResearchMatchesSelection
    ? (jquantsResearch?.issue?.name || jquantsResearch?.code || jquantsCode)
    : jquantsCode;
  const jquantsLatestClose = jquantsConfigured && jquantsResearchMatchesSelection && jquantsResearch?.latestQuote?.close ? yen(jquantsResearch.latestQuote.close) : '未取得';
  const jquantsLatestSource = jquantsResearchMatchesSelection ? (jquantsIntegrity?.latestQuoteSource || jquantsResearch?.latestQuote?.source || '未取得') : '未確認';
  const jquantsEpsBps = jquantsConfigured && jquantsResearchMatchesSelection
    ? `${jquantsResearch?.latestStatement?.earningsPerShare || '-'} / ${jquantsResearch?.latestStatement?.bookValuePerShare || '-'}`
    : '未取得';
  const jquantsOfficialStatus = jquantsIntegrity?.officialHistoryUsable
    ? `${jquantsIntegrity.officialHistorySource || 'official'} / ${jquantsIntegrity.officialHistoryAgeDays ?? '-'}日`
    : '未確認';
  const jquantsNote = jquantsConfigured && !jquantsResearchMatchesSelection
    ? `${jquantsCode} はまだJ-Quants確認を実行していません。選択銘柄に連動してコードは更新済みです。必要なら確認ボタンで読み取り専用チェックを行います。`
    : jquantsConfigured && jquantsResearch?.jquantsError
    ? `J-Quants APIキーは適用済みですが、現在は ${jquantsResearch.jquantsError} のため公式遅延データを取得できません。直近日足は補完データとして表示しています。`
    : jquantsIntegrity?.detail
    ? jquantsIntegrity.detail
    : jquantsConfigured
    ? `J-Quantsは読み取り専用で確認しています。日足の最新値は ${jquantsResearch?.latestQuote?.date || '未取得'}、リアルタイム板ではありません。`
    : jquantsResearch?.message || jquantsResearch?.nextStep || 'J-Quants APIトークンを設定すると、銘柄マスタ・日足・財務データを読み取り専用で取得できます。未設定でもアプリ本体は利用できます。';
  const prophetValidated = selectedAdvancedReport?.verdict === 'ADVANCED_READY'
    && Number(selectedAdvancedReport?.walkForward?.edgePct || 0) > 0
    && selectedAdvancedReport?.guardrails?.every((item) => item.ok);
  const hasRankingItems = Boolean(marketRankings?.items?.length);
  const hasNoActionableTopPick = Boolean(marketRankings) && hasRankingItems && !daytradeTopPick;
  const isFallbackTopPick = Boolean(daytradeTopPick?.isFallbackCandidate);
  const topPickSource = priceSourcePayload(
    cached ? { isCached: true, source: 'cache' } : null,
    daytradeTopPick?.dataFreshness,
    daytradeTopPick,
    daytradeTopPick?.dataQuality,
    marketRankings?.isCached ? { isCached: true, source: 'cache' } : null,
  );
  const simpleTopPickActionRaw = daytradeTopPick?.simpleAction
    || (daytradeTopPick?.tradeReadiness === 'ready' ? '買い候補' : daytradeTopPick ? '待つ' : 'スキャン中');
  const simpleTopPickAction = suppressSyntheticAction(simpleTopPickActionRaw, topPickSource);
  const monitoredTickerLabel = jobsCandidate ? `${jobsCandidate.ticker} ${jobsCandidate.name}` : '国内市場スキャン中';
  const topPickTickerLabel = daytradeTopPick
    ? `${daytradeTopPick.ticker} ${daytradeTopPick.name || ''}`
    : hasNoActionableTopPick
      ? '候補抽出待ち'
      : '全市場スキャン中';
  const rankingPayloadKind = marketRankings?.kind || rankingKind;
  const selectedRankingLabel = rankingTabs.find((tab) => tab.id === rankingPayloadKind)?.label || 'ランキング';
  const marketProviderLabel = marketRankings?.provider || marketUniverse?.snapshot?.provider || '未取得';
  const marketUniverseCount = marketUniverse?.count || marketRankings?.universeCount || 3800;
  const isYahooGainersRanking = rankingPayloadKind === 'gainers' && (
    marketRankings?.provider === 'Yahoo Finance Japan gainers ranking'
    || String(marketRankings?.source || '').includes('finance.yahoo.co.jp/stocks/ranking/up')
  );
  const marketScopeLabel = isYahooGainersRanking ? 'Yahoo掲載' : '分析済み';
  const marketScopeCount = isYahooGainersRanking
    ? compactNumber(marketRankings?.analyzedCount || marketRankings?.items?.length || 0)
    : compactNumber(marketRankings?.analyzedCount || marketUniverse?.snapshot?.analyzedCount || 0);
  const marketPanelTitle = isYahooGainersRanking
    ? 'Yahoo Finance値上がり率ランキングと銘柄検索'
    : `約${marketUniverseCount.toLocaleString('ja-JP')}銘柄の独自スクリーニングと詳細検索`;
  const marketPanelDescription = isYahooGainersRanking
    ? '値上がり率タブはYahoo Finance Japanの掲載順位を優先表示します。Zen内部評価は候補品質の比較に分離し、地合い判定はJPX+yfinanceのフル市場スナップショットが新鮮な時だけ使います。'
    : 'JPX上場銘柄マスタを母集団にし、日足価格、出来高、売買代金、勢い、候補品質、過熱リスクで候補を並べ替えます。検索した銘柄は高度分析へ渡し、実注文は作成しません。';
  const marketSignalLabel = isYahooGainersRanking ? '公式順位 / 出来高' : '短期スコア / 過熱リスク';
  const marketContextIntegrity = marketRankings?.marketContextIntegrity;
  const marketContextCount = marketContextIntegrity?.contextCount ?? marketRankings?.marketContextCount ?? 0;
  const marketContextAge = marketContextIntegrity?.ageDays ?? marketRankings?.marketContextAgeDays;
  const marketContextAgeLabel = marketContextAge == null ? '不明' : `${marketContextAge}日`;
  const marketContextUsable = Boolean(marketContextIntegrity?.usable);
  const marketContextReasonLabel = marketContextUsable
    ? 'フル市場地合い 有効'
    : marketContextIntegrity?.reason === 'stale_snapshot'
      ? '地合い要確認'
      : marketContextIntegrity?.reason === 'empty_context'
        ? '地合いデータ空'
        : marketContextIntegrity?.reason === 'missing_snapshot'
          ? '地合い未取得'
          : '地合い未確認';
  const marketContextTone = marketContextUsable ? 'good' : 'warn';
  const marketContextDetail = marketContextUsable
    ? `JPX+yfinance ${compactNumber(marketContextCount)}銘柄 / 鮮度 ${marketContextAgeLabel}。市場・セクター判定に使用します。`
    : `フル市場データが古い、または未取得です。Yahoo上昇銘柄だけから地合いを推定せず、候補監査では要確認にします。`;
  const usesIntradayOpportunity = jobsCandidate?.source === 'selected-intraday-opportunity';
  const tradeStrategyTitle = jobsCandidate
    ? usesIntradayOpportunity
      ? `選択銘柄の50万円シミュレーション ${monitoredTickerLabel}`
      : `選択銘柄の条件一致シミュレーション ${monitoredTickerLabel}`
    : '本日の条件一致候補を計算中';
  const tradeStrategyReason = usesIntradayOpportunity
    ? '選択中の銘柄について、50万円を1株単位で投入した場合の利確シナリオ・期待損益・損失シナリオを同時比較しています。売買指示ではなく、根拠確認用のシミュレーションです。'
    : prophetValidated
    ? '検証ゲートを通過。板厚・スプレッド・ニュースを確認できる場合だけ、自己判断の参考にします。'
    : `${monitoredTickerLabel} を50万円シミュレーションの上位条件一致として表示します。最終判断ではなく、価格・リスク・見送り条件を確認するための分析支援です。`;
  const decisionScoreLabel = usesIntradayOpportunity ? '条件一致' : prophetValidated ? '検証済み' : '候補スコア';
  const selectedRankContext = isYahooGainersRanking && jobsCandidate?.siteRank
    ? `Yahoo #${jobsCandidate.siteRank} / Zen #${jobsCandidate.candidateRank || '-'}`
    : jobsCandidate?.candidateRank
      ? `Zen #${jobsCandidate.candidateRank}`
      : null;
  const selectedDecisionSourceLabel = usesIntradayOpportunity
    ? '市場ランキング内の短期売買監査'
    : selectedDetail?.crossEngineCheck?.source === 'backend-cross-engine'
      ? '詳細APIの統合判定'
      : 'ウォッチリスト候補';
  const selectedFreshness = jobsCandidate?.dataFreshness || {};
  const selectedPriceDate = selectedDetail?.priceAsOfDate
    || selectedDetail?.dataQuality?.latestBarDate
    || selectedFreshness.priceAsOfDate
    || selectedFreshness.latestBarDate
    || jobsCandidate?.priceAsOfDate
    || jobsCandidate?.latestBarDate;
  const selectedPriceSource = selectedDetail?.priceSource
    || selectedDetail?.dataQuality?.source
    || selectedFreshness.priceSource
    || selectedFreshness.source
    || jobsCandidate?.priceSource;
  const selectedSourceContext = priceSourcePayload(
    cached ? { isCached: true, source: 'cache' } : null,
    selectedDetail,
    selectedDetail?.dataQuality,
    selectedFreshness,
    jobsCandidate,
    jobsCandidate?.dataQuality,
    selectedPriceSource,
  );
  const selectedRankingFetchDate = selectedFreshness.sourceFetchedDate
    || jobsCandidate?.sourceFetchedDate
    || selectedDetail?.sourceFetchedDate;
  const selectedRankingSource = selectedFreshness.rankingSource
    || jobsCandidate?.source
    || selectedFreshness.source
    || selectedDetail?.source;
  const selectedSourceEvidence = [
    selectedPriceDate ? `価格日付 ${selectedPriceDate}` : '価格日付 未確認',
    selectedPriceSource ? `価格ソース ${sourceShortLabel(selectedPriceSource)}` : null,
    selectedRankingFetchDate ? `ランキング取得 ${selectedRankingFetchDate}` : null,
    selectedRankingSource ? `ランキング元 ${sourceShortLabel(selectedRankingSource)}` : null,
  ].filter(Boolean);
  const offHoursAnalysisPrefix = !isRegularSession
    ? '現在は時間外です。翌営業日の候補として表示しています。'
    : '';
  const topPickReason = daytradeTopPick
    ? `${offHoursAnalysisPrefix}${isFallbackTopPick ? '今日見る候補です。' : '条件に近い候補です。'}まず見るのは、注文上限・利確・撤退・買わない条件だけです。`
    : hasNoActionableTopPick
      ? `${isYahooGainersRanking ? 'Yahoo掲載順は表示していますが、' : ''}候補計算中です。ランキング行から確認できます。`
      : 'ランキング更新後に、今日見る候補をここへ表示します。';
  const topPickMaterial = daytradeTopPick?.material?.summary || '決算・適時開示・重要ニュースは未確認です。取引前に無料確認リンクで必ず確認してください。';
  const practiceCandidate = userSelectedTicker && userSelectedTicker !== daytradeTopPick?.ticker
    ? selectedStock
    : (selectedStock?.ticker === daytradeTopPick?.ticker ? daytradeTopPick : selectedStock || daytradeTopPick);
  const practiceTicker = practiceCandidate?.ticker || selectedStock?.ticker || selectedTicker;
  const practiceName = practiceCandidate?.name || selectedStock?.name || practiceTicker;
  const practicePrice = Number(practiceCandidate?.entry || practiceCandidate?.entryPrice || selectedDetail?.price || selectedStock?.price || 0);
  const practicePriceSource = priceSourcePayload(
    selectedSourceContext,
    practiceCandidate?.dataFreshness,
    practiceCandidate,
    selectedDetail,
    userSelectedTicker && userSelectedTicker !== daytradeTopPick?.ticker ? null : topPickSource,
  );
  const practiceEntry = Number(practiceCandidate?.entry || practiceCandidate?.entryPrice || tradePlan.entry || practicePrice || 0);
  const practiceTarget = Number(practiceCandidate?.target || practiceCandidate?.targetPrice || tradePlan.target || 0);
  const practiceStop = Number(practiceCandidate?.stop || practiceCandidate?.stopLoss || tradePlan.stop || 0);
  const practiceShares = Number(practiceCandidate?.shares || positionForm.shares || 0);
  const practiceHoldings = holdings.filter((holding) => holding.ticker === practiceTicker);
  const practiceOrderValidation = getPracticeOrderValidation({ source: practicePriceSource, referencePrice: practicePrice });
  const localPracticeTransactions = practiceOrders.filter((order) => order.ticker === practiceTicker);
  const apiPracticeTransactions = (transactions || []).filter((tx) => tx.ticker === practiceTicker).map((tx) => ({
    ...tx,
    statusLabel: tradeActionLabel(tx.action),
  }));
  const practiceTransactions = [...localPracticeTransactions, ...apiPracticeTransactions].slice(0, 5);
  const practicePnl = practiceHoldings.reduce((sum, item) => sum + Number(item.pnl || 0), 0);
  const aiFundSummary = aiFundDesk?.summary || aiFundDeskFallback.summary;
  const aiFundDraft = aiFundDesk?.draftOrder;
  const aiFundWorkflow = aiFundDesk?.workflow?.length ? aiFundDesk.workflow : aiFundDeskFallback.workflow;
  const aiFundGuardrails = aiFundDesk?.guardrails?.length ? aiFundDesk.guardrails : aiFundDeskFallback.guardrails;
  const aiFundAudit = aiFundDesk?.auditTrail || aiFundDeskFallback.auditTrail;
  const aiFundReady = aiFundSummary.state === 'APPROVAL_REQUIRED';

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
        <CandidateSummary ready={Boolean(daytradeTopPick)}>
          <div>
            <div className="section-title"><ShieldCheck size={18} /><span>デイトレ候補レビュー</span></div>
            <h2>本日の最有力候補 {topPickTickerLabel}</h2>
            <p>
              <strong>分析結果:</strong> {topPickReason}
            </p>
            <div className="decision-pill-row">
              {daytradeTopPick ? <StatusPill label={simpleTopPickAction} tone={isFallbackTopPick ? 'warn' : scoreTone(daytradeTopPick.score)} /> : null}
              {daytradeTopPick ? <StatusPill label={`短期スコア ${daytradeTopPick.score?.toFixed?.(1) ?? '-'} / 100`} tone={scoreTone(daytradeTopPick.score)} /> : null}
              <StatusPill label={`期待損益 ${daytradeTopPick ? yen(daytradeTopPick.probabilityAdjustedProfit) : '-'}`} tone="info" />
              <StatusPill label={marketStatusTopLabel} tone={isRegularSession ? 'good' : 'warn'} />
              <StatusPill label={marketFreshnessLabel} tone={marketFreshness?.isSynthetic || marketFreshness?.isCached || marketFreshness?.isUnknown ? 'warn' : 'info'} />
              <DataSourceBadge source={topPickSource} />
            </div>
            <DataSourceWarning source={topPickSource} />
            {daytradeTopPick && (
              <div className="simple-daytrade-board">
                <div className="simple-decision-card main">
                  <span>判断</span>
                  <strong>{simpleTopPickAction}</strong>
                  <small>{isFallbackTopPick ? '厳格条件未達。価格と材料を見てから判断。' : '条件に近い候補。上限厳守で確認。'}</small>
                </div>
                <div className="simple-decision-card">
                  <span>注文上限</span>
                  <strong>{yen(daytradeTopPick.entry)}以下</strong>
                  <small>届かなければ見送り</small>
                  <DataSourceBadge source={topPickSource} compact />
                </div>
                <div className="simple-decision-card">
                  <span>利確</span>
                  <strong>{yen(daytradeTopPick.target)}</strong>
                  <small>想定利益 {yen(daytradeTopPick.expectedProfit)}</small>
                </div>
                <div className="simple-decision-card danger">
                  <span>撤退</span>
                  <strong>{yen(daytradeTopPick.stop)}</strong>
                  <small>最大損失 {yen(daytradeTopPick.maxLoss)}</small>
                </div>
                <div className="simple-decision-card">
                  <span>株数</span>
                  <strong>{daytradeTopPick.affordable ? `${daytradeTopPick.shares}株` : '0株'}</strong>
                  <small>使用額 {yen(daytradeTopPick.budgetUsed)}</small>
                </div>
              </div>
            )}
            {daytradeTopPick && (
              <div className="simple-reason-grid">
                <div>
                  <span>なぜ候補</span>
                  <strong>期待損益 {yen(daytradeTopPick.probabilityAdjustedProfit)} / RR {daytradeTopPick.rr}</strong>
                  {(daytradeTopPick.whyBuy?.length ? daytradeTopPick.whyBuy : [daytradeTopPick.candidateReason]).slice(0, 2).map((item, index) => <small key={`simple-buy-${index}-${item}`}>{simpleOpportunityText(item)}</small>)}
                </div>
                <div>
                  <span>買わない条件</span>
                  {[
                    daytradeTopPick.primaryWarning,
                    ...(daytradeTopPick.invalidConditions || []),
                    ...(daytradeTopPick.whyNotBuy || []),
                  ].filter(Boolean).slice(0, 3).map((item, index) => <small key={`simple-stop-${index}-${item}`}>{simpleOpportunityText(item)}</small>)}
                </div>
                <div>
                  <span>今見る数字</span>
                  <small>短期スコア {daytradeTopPick.score?.toFixed?.(1) ?? '-'} / 100、リスク {riskLevelLabel(daytradeTopPick.expertRiskLevel)}</small>
                  <small>材料確認: {topPickMaterial}</small>
                  <button className="inline-action" type="button" onClick={focusTopPick}>
                    <Target size={14} />
                    詳細分析へ
                  </button>
                </div>
              </div>
            )}
            <div className="selected-simulation-summary">
              <div>
                <span>選択中銘柄の確認</span>
                <strong>{tradeStrategyTitle}</strong>
                <small>{tradeStrategyReason}</small>
                <small>判定ソース: {selectedDecisionSourceLabel}{selectedRankContext ? ` / ${selectedRankContext}` : ''}</small>
                {selectedSourceEvidence.length > 0 && (
                  <div className="source-evidence-strip" aria-label="価格とランキングソース">
                    {selectedSourceEvidence.map((item) => <small key={item}>{item}</small>)}
                  </div>
                )}
                <small>{crossEngineCheck.detail}</small>
                {crossEngineGatePreview.length > 0 && (
                  <div className="cross-engine-gates" aria-label="クロスチェック内訳">
                    {crossEngineGatePreview.map((gate) => (
                      <small key={gate.id} className={gate.ok ? 'pass' : 'block'} title={gate.detail}>
                        {gate.ok ? 'OK' : 'NG'} {crossEngineGateLabel(gate)}
                      </small>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <StatusPill label={crossEngineCheck.label} tone={crossEngineTone(crossEngineCheck.status)} />
                <StatusPill label={`${decisionScoreLabel} ${jobsCandidate?.score?.toFixed?.(1) ?? selectedAdvancedReport?.compositeScore ?? '-'} / 100`} tone={scoreTone(jobsCandidate?.score ?? selectedAdvancedReport?.compositeScore)} />
              </div>
            </div>
          </div>
          <div className="brief-score">
            <strong>{daytradeTopPick?.probabilityAdjustedProfit ? yen(daytradeTopPick.probabilityAdjustedProfit) : '-'}</strong>
            <span>シミュレーション期待損益</span>
            {daytradeTopPick && <small>利確 {yen(daytradeTopPick.expectedProfit)}</small>}
          </div>
        </CandidateSummary>

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
              <StatusPill label={`${practiceHoldings.length}件`} tone="info" />
            </div>
            <div className="practice-pnl-strip">
              <div><span>{practiceTicker}評価</span><strong>{yen(practiceHoldings.reduce((sum, item) => sum + Number(item.value || 0), 0))}</strong><DataSourceBadge source={practicePriceSource} compact /></div>
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
              {!practiceHoldings.length && <small>{practiceTicker}の練習保有を保存すると、ここに損益が表示されます。</small>}
            </div>
          </div>

          <div className="practice-history-panel">
            <div className="practice-panel-head">
              <div>
                <span>練習注文履歴</span>
                <strong>履歴</strong>
              </div>
              <StatusPill label={`${practiceTicker} 最新5件`} tone="neutral" />
            </div>
            <div className="practice-history-list" data-testid="practice-history-list">
              {practiceTransactions.map((tx) => (
                <div data-testid="practice-history-item" key={`practice-tx-${tx.id || tx.createdAt || `${tx.ticker}-${tx.action}`}`}>
                  <span>{tx.statusLabel || tradeActionLabel(tx.action)}</span>
                  <strong>{tx.ticker} {tx.shares}株</strong>
                  <small>{yen(tx.price)} / {yen(tx.total)}</small>
                  {tx.sourceLabel && <small>データ出所: {tx.sourceLabel}</small>}
                  {tx.isPracticeOrder && tx.practiceStatus === PRACTICE_ORDER_STATUS.PENDING && (
                    <div className="practice-history-actions">
                      <button type="button" onClick={() => markPracticeOrderFilled(tx.id)}>約定済みにする</button>
                      <button type="button" onClick={() => cancelPracticeOrder(tx.id)}>取消</button>
                    </div>
                  )}
                </div>
              ))}
              {!practiceTransactions.length && <small>{practiceTicker}の練習注文を保存すると、履歴に残ります。</small>}
            </div>
          </div>
        </PracticeDashboard>

        <DetailPanels>
        <section className={`ai-fund-panel ${aiFundReady ? 'ready' : 'watch'}`} aria-label="AIファンドデスク">
          <div className="ai-fund-head">
            <div>
              <div className="section-title"><Bot size={18} /><span>ローカル分析デスク</span></div>
              <h2>根拠とリスクの管制塔</h2>
              <p>
                「リサーチ、売買案、運用監視、決済判断」を、ローカルのシミュレーションと承認待ち確認票だけに限定して回します。
                実注文API、証券会社、RPAには接続しません。
              </p>
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
              <small>保有監視 {aiFundSummary.activeHoldingCount || 0}件 / 予算 {yen(aiFundDesk?.budgetJpy || JOBS_SIM_BUDGET_JPY)}</small>
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
                <div>
                  {(lane.evidence || []).slice(0, 3).map((item, index) => <small key={`${lane.id}-evidence-${index}-${item}`}>{item}</small>)}
                </div>
              </article>
            ))}
          </div>
          <div className="ai-fund-bottom">
            <div className="draft-order-panel">
              <div className="section-title"><BriefcaseBusiness size={16} /><span>確認票下書き</span></div>
              {aiFundDraft ? (
                <div className="draft-ticket">
                  <div><span>銘柄</span><strong>{aiFundDraft.ticker} {aiFundDraft.name}</strong></div>
                  <div><span>下書き</span><strong>{aiFundOrderSideLabel(aiFundDraft.side)} {aiFundDraft.shares}株</strong></div>
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
                  disabled={busy === 'market'}
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
                <span>{isYahooGainersRanking ? 'Yahoo掲載順トップ' : `${selectedRankingLabel}トップ`}</span>
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
                  ? `${audit.verdict} ${Number(item.intradayOpportunity?.opportunityScore || 0).toFixed(0)}`
                  : Number(item.surgeScore ?? item.candidateScore ?? 0).toFixed(0);

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
                    <span className={Number(item.changePct || 0) >= 0 ? 'market-up' : 'market-down'}>{pct(item.changePct)}</span>
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
                <small>{marketSearch?.items?.length ? `${marketSearch.count}件` : '検索待ち'}</small>
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

        <section className="advanced-analysis-panel" aria-label="高度分析">
          <div className="advanced-analysis-head">
            <div>
              <div className="section-title"><BrainCircuit size={18} /><span>高度分析エンジン</span></div>
              <h2>{selectedAdvancedReport?.actionLabel || '銘柄選択に連動して確率分析を準備中'}</h2>
              <p>
                1年分の日足から、トレンド整列、モメンタム、流動性、変動率、5営業日シナリオ、過去条件一致のウォークフォワード検証、1株単位の損失許容を同時に確認します。
                実注文は作成せず、判断補助だけを表示します。
              </p>
            </div>
            <StatusPill
              label={selectedAdvancedReport ? `総合 ${selectedAdvancedReport.compositeScore}/100` : '取得待ち'}
              tone={scoreTone(selectedAdvancedReport?.compositeScore)}
            />
          </div>
          <div className="advanced-score-grid">
            {[
              ['トレンド', selectedAdvancedReport?.factors?.trend?.score, selectedAdvancedReport?.factors?.trend?.state || '-'],
              ['勢い', selectedAdvancedReport?.factors?.momentumScore, `5日 ${pct(selectedAdvancedReport?.factors?.momentum5Pct)} / 20日 ${pct(selectedAdvancedReport?.factors?.momentum20Pct)}`],
              ['流動性', selectedAdvancedReport?.factors?.liquidityScore, `出来高 ${ratioLabel(selectedAdvancedReport?.factors?.volumeRatio)}`],
              ['守備力', selectedAdvancedReport?.factors?.riskControlScore, `ATR ${pct(selectedAdvancedReport?.factors?.atrPct)} / DD ${pct(selectedAdvancedReport?.factors?.maxDrawdown60Pct)}`],
              ['検証力', selectedAdvancedReport?.walkForward?.score, `一致 ${selectedAdvancedReport?.walkForward?.sampleCount ?? 0}件 / エッジ ${pct(selectedAdvancedReport?.walkForward?.edgePct)}`],
              ['分析信頼度', selectedAdvancedReport?.analysisReliability?.score, selectedAdvancedReport?.analysisReliability?.label || '-'],
              ['データ品質', selectedAdvancedReport?.dataQuality?.score, `${selectedAdvancedReport?.dataQuality?.bars ?? 0}本 / ${selectedAdvancedReport?.dataQuality?.priceFreshnessVerdict || '-'} / ${selectedAdvancedReport?.dataQuality?.source || '-'}`],
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
                {(selectedAdvancedReport?.scenarios || [
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
              <strong>{selectedAdvancedReport?.monteCarlo?.probabilityUpPct != null ? `${selectedAdvancedReport.monteCarlo.probabilityUpPct.toFixed(1)}%` : '-'}</strong>
              <small>
                上昇確率 / 期待リターン {selectedAdvancedReport?.monteCarlo ? pct(selectedAdvancedReport.monteCarlo.expectedReturnPct) : '-'} /
                標本 {selectedAdvancedReport?.monteCarlo?.sampleCount || 0}
              </small>
            </div>
            <div className="position-plan-panel">
              <span>1%リスクの建玉</span>
              <strong>{selectedAdvancedReport?.positionPlan ? `${selectedAdvancedReport.positionPlan.suggestedShares}株` : '-'}</strong>
              <small>
                入口 {yen(selectedAdvancedReport?.positionPlan?.entryPrice)} / 損切 {yen(selectedAdvancedReport?.positionPlan?.stopPrice)} /
                RR 1:{selectedAdvancedReport?.positionPlan?.riskReward || '-'}
              </small>
            </div>
            <div className="probability-panel">
              <span>過去検証</span>
              <strong>{selectedAdvancedReport?.walkForward?.hitRatePct != null ? `${selectedAdvancedReport.walkForward.hitRatePct.toFixed(1)}%` : '-'}</strong>
              <small>
                勝率 / 平均 {selectedAdvancedReport?.walkForward ? pct(selectedAdvancedReport.walkForward.avgReturnPct) : '-'} /
                全体比 {selectedAdvancedReport?.walkForward ? pct(selectedAdvancedReport.walkForward.edgePct) : '-'}
              </small>
            </div>
          </div>
          <div className="advanced-guardrails">
            {(selectedAdvancedReport?.guardrails || []).map((item, index) => (
              <div key={`advanced-guard-${index}-${item.label}`} className={item.ok ? 'pass' : 'block'}>
                <b>{item.ok ? '通過' : '停止'}</b>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="advanced-explainability">
            {(selectedAdvancedReport?.explainability || []).map((item, index) => (
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
              <StatusPill label={jquantsStatusLabel} tone={jquantsStatusTone} />
              <StatusPill label={jquantsIntegrityLabel} tone={jquantsIntegrityTone} />
            </div>
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
            <div className="metric">
              <span>価格ソース</span>
              <strong>{jquantsLatestSource}</strong>
            </div>
            <div className="metric">
              <span>公式履歴</span>
              <strong>{jquantsOfficialStatus}</strong>
            </div>
            <div className="metric">
              <span>品質判定</span>
              <strong>{jquantsIntegrity?.verdict || '-'}</strong>
            </div>
          </div>
          <div className="jquants-note">
            <ShieldCheck size={16} />
            <span>{jquantsResearch?.message || jquantsNote}</span>
          </div>
        </section>

        {showOpeningGapDesk && (
        <section className="daytrade-panel">
          <div className="daytrade-head">
            <div>
              <div className="section-title"><Activity size={18} /><span>寄り付きギャップ確認</span></div>
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
            <span>データ取得元: <b>{daytradeSource}</b></span>
            <span>証券連携: <b>無効</b></span>
            <span>オートパイロット: <b>{autopilotStatus?.running ? '稼働中' : '停止中'}</b></span>
            <span>確認回数: <b>{autopilotStatus?.cycles || 0}</b></span>
            <span>{brokerStatus?.message}</span>
          </div>
          <div className="intraday-analysis-card">
            <div className="intraday-analysis-head">
              <div>
                <span>{selectedTicker} / 短期強弱</span>
                <strong>{daytradeAnalysis ? `${daytradeAnalysis.label} ${Number(daytradeAnalysis.score || 0).toFixed(1)} / 100` : '分析取得中'}</strong>
                <p>{daytradeAnalysis?.explanations?.[0] || 'VWAP、出来高、RSI、MACD、ボリンジャーバンド、サポレジをまとめて確認します。'}</p>
              </div>
              <div className="interval-switcher" aria-label="時間足">
                {['1m', '5m', '15m', '1d'].map((interval) => (
                  <button
                    key={interval}
                    type="button"
                    className={daytradeInterval === interval ? 'active' : ''}
                    onClick={() => setDaytradeInterval(interval)}
                    disabled={busy === 'detail'}
                    title={`${interval}で短期分析`}
                  >
                    {interval}
                  </button>
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
                    ['出来高', `${Number(daytradeAnalysis.indicators?.volumeRatio || 0).toFixed(2)}x`],
                    ['季節性', `${Number(daytradeAnalysis.indicators?.volumeSeasonality?.seasonalRatio || 1).toFixed(2)}x`],
                    ['ATR', pct(daytradeAnalysis.indicators?.atrPct)],
                    ['Gap', pct(daytradeAnalysis.indicators?.gapPct)],
                    ['スプレッド', pct(daytradeAnalysis.indicators?.microstructure?.spreadPct)],
                    ['板/気配', daytradeAnalysis.indicators?.microstructure?.depthSource === 'QUOTE' ? `${Number(daytradeAnalysis.indicators?.microstructure?.bookRatio || 0).toFixed(2)}x` : '推定'],
                    ['材料', daytradeAnalysis.indicators?.eventRisk?.verdict || '未確認'],
                    ['データ', `${cacheStatusLabel(daytradeAnalysis.cacheStatus)} ${Number(daytradeAnalysis.cacheAgeSec || 0).toFixed(0)}秒`],
                    ['支持線', yen(daytradeAnalysis.indicators?.support)],
                    ['抵抗線', yen(daytradeAnalysis.indicators?.resistance)],
                  ].map(([label, value]) => (
                    <div className="metric" key={`intraday-${label}`}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="intraday-levels">
                  <div><span>エントリー候補</span><strong>{yen(daytradeAnalysis.levels?.entryCandidate)}</strong></div>
                  <div><span>利確候補</span><strong>{yen(daytradeAnalysis.levels?.takeProfitCandidate)}</strong></div>
                  <div><span>撤退ライン</span><strong>{yen(daytradeAnalysis.levels?.stopLossCandidate)}</strong></div>
                  <div><span>RR</span><strong>{Number(daytradeAnalysis.levels?.riskReward || 0).toFixed(2)}</strong></div>
                </div>
                <div className="intraday-evidence-grid">
                  <div>
                    <span>根拠</span>
                    {(daytradeAnalysis.evidence || []).slice(0, 6).map((item) => (
                      <small key={item.id} className={item.ok ? 'pass' : 'block'}>{item.ok ? 'OK' : 'NG'} {item.label}: {item.detail}</small>
                    ))}
                  </div>
                  <div>
                    <span>騙し除外</span>
                    {(daytradeAnalysis.fakeoutFilters || []).length
                      ? daytradeAnalysis.fakeoutFilters.map((item) => <small className="block" key={item}>{item}</small>)
                      : <small className="pass">主要な騙しフィルターは未検出</small>}
                  </div>
                  <div>
                    <span>バックテスト</span>
                    <small>件数 {daytradeAnalysis.backtest?.trades || 0} / 勝率 {Number(daytradeAnalysis.backtest?.winRatePct || 0).toFixed(1)}%</small>
                    <small>平均 {pct(daytradeAnalysis.backtest?.avgReturnPct)} / PF {Number(daytradeAnalysis.backtest?.profitFactor || 0).toFixed(2)}</small>
                    <small>最大DD {pct(daytradeAnalysis.backtest?.maxDrawdownPct)} / {daytradeAnalysis.backtest?.verdict}</small>
                  </div>
                  <div>
                    <span>ウォークフォワード</span>
                    <small>安定 {pct(daytradeAnalysis.walkForward?.stabilityPct)} / {daytradeAnalysis.walkForward?.verdict || '未検証'}</small>
                    <small>件数 {daytradeAnalysis.walkForward?.trades || 0} / 勝率 {Number(daytradeAnalysis.walkForward?.winRatePct || 0).toFixed(1)}%</small>
                    <small>平均 {pct(daytradeAnalysis.walkForward?.avgReturnPct)} / PF {Number(daytradeAnalysis.walkForward?.profitFactor || 0).toFixed(2)}</small>
                  </div>
                  <div>
                    <span>イベント除外</span>
                    <small>{daytradeAnalysis.indicators?.eventRisk?.latestTitle || '直近材料・決算イベントは未確認'}</small>
                    <small>{daytradeAnalysis.indicators?.eventRisk?.source || 'UNCONFIRMED'} / {daytradeAnalysis.indicators?.eventRisk?.tone || 'unknown'}</small>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-note">短期分析を取得できませんでした。時間足を切り替えるか、詳細データの取得状態を確認してください。</div>
            )}
          </div>
          <div className="commute-routine-panel">
            <div className="commute-routine-head">
              <div>
                <span>{selectedTicker} / 生活導線</span>
                <strong>{daytradeRoutine ? `${daytradeRoutine.priority} / ${daytradeRoutine.verdict}` : 'ルーティン作成中'}</strong>
                <p>{daytradeRoutine?.summary || '帰宅後、翌朝の電車、仕事中の確認項目を短く整理します。'}</p>
              </div>
              <div className="manual-only-badge">手動判断のみ</div>
            </div>
            {daytradeRoutine ? (
              <>
                <div className="commute-price-strip">
                  {[
                    ['注文上限', yen(daytradeRoutine.mobileSummary?.orderUpperLimit)],
                    ['利確', yen(daytradeRoutine.mobileSummary?.takeProfit)],
                    ['撤退', yen(daytradeRoutine.mobileSummary?.stopLoss)],
                    ['接近通知', yen(daytradeRoutine.mobileSummary?.warningPrice)],
                    ['スコア', `${Number(daytradeRoutine.mobileSummary?.score || 0).toFixed(1)}/100`],
                    ['RR', Number(daytradeRoutine.mobileSummary?.riskReward || 0).toFixed(2)],
                  ].map(([label, value]) => (
                    <div key={`routine-${label}`}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="commute-phase-grid">
                  {(daytradeRoutine.phases || []).map((phase) => (
                    <article className="commute-phase-card" key={phase.id}>
                      <div>
                        <span>{phase.label}</span>
                        <strong>{phase.purpose}</strong>
                      </div>
                      {(phase.checks || []).slice(0, 5).map((check) => (
                        <small className={check.ok ? 'pass' : 'block'} key={`${phase.id}-${check.label}`}>
                          {check.ok ? 'OK' : 'NG'} {check.label}: {check.detail}
                        </small>
                      ))}
                    </article>
                  ))}
                </div>
                <p className="manual-only-note">{daytradeRoutine.manualOnlyNotice}</p>
              </>
            ) : (
              <div className="empty-note">生活導線を取得できませんでした。短期分析の更新後に再表示します。</div>
            )}
          </div>
          <div className="daytrade-grid">
            <div className="daytrade-rules">
              {[
                ['窓開け幅', `±${daytradePlan?.rules?.gapAbsPct || 3}%以上`],
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
                    <b>{tradeActionLabel(signal.side)}</b>
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
                    {stock.preopenDecision || (stock.decision === 'DAYTRADE_ENTRY_OK' ? '監視候補' : stock.decision === 'BUY_LIMIT_OK' ? '条件確認' : stock.decision === 'REPRICE_FOR_DAYTRADE' ? '再計算' : stock.decision === 'BUY_ON_PULLBACK' ? '押し目監視' : stock.mustInclude ? '固定観察' : '観察')}
                  </span>
                  <span className="stock-emoji">{stock.emoji || 'JP'}</span>
                  <span className="stock-name">{stock.name || stock.ticker}</span>
                  <span className="stock-meta">{stock.ticker}</span>
                  <span className="candidate-score">上昇期待 {Math.round(stock.preopenScore ?? stock.candidateScore ?? stock.confidence)} / 100</span>
                  {candidateDataQuality(stock) && (
                    <span className={`candidate-data-quality ${dataQualityTone(candidateDataQuality(stock))}`}>
                      {dataQualitySummary(candidateDataQuality(stock))}
                    </span>
                  )}
                  {preopenRiskLabels(stock.preopenReport) && <span className="candidate-risk">{preopenRiskLabels(stock.preopenReport)}</span>}
                  {stock.buyLimit && <span className="candidate-score">指値上限 {yen(stock.buyLimit)} / 現在値比 {pct(stock.entryGapPct)}</span>}
                  <span className="candidate-reason">{stock.candidateReason}</span>
                  <span className="current-price-label">現在値</span>
                  <strong>{yen(stock.price)}</strong>
                  <DataSourceBadge source={priceSourcePayload(marketRankings?.isCached ? { isCached: true, source: 'cache' } : null, stock, stock.dataQuality)} compact />
                </button>
              ))}
            </div>
          </WatchlistPanel>

          <div className="focus-card" data-testid="selected-focus-card">
            <div className="focus-head">
              <div>
                <small>{selectedStock?.ticker}</small>
                <h2>{selectedStock?.emoji || 'JP'} {selectedStock?.name || selectedTicker}</h2>
              </div>
              <div className="price-block">
                <strong>{yen(selectedDetail?.price || selectedStock?.price)}</strong>
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
                    <strong>{yen(tradePlan.entry)}以下</strong>
                    <p>現在値から {pct(tradePlan.entryGapPct)}。深い押し目待ちではなく、監視レンジの上限価格です。</p>
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
                {selectedPreopen && (
                  <div className="preopen-panel">
                    <div className="preopen-head">
                      <div>
                        <span>Pre-Open Score</span>
                        <h3>{selectedPreopen.decisionLabel} {selectedPreopen.score} / 100</h3>
                      </div>
                      <StatusPill label="分析支援" tone={selectedPreopen.score >= 55 ? 'warn' : 'neutral'} />
                    </div>
                    <div className="score-breakdown-grid">
                      {[
                        ['材料', selectedPreopen.scoreBreakdown?.material],
                        ['出来高', selectedPreopen.scoreBreakdown?.volume],
                        ['PTS/気配', selectedPreopen.scoreBreakdown?.indicationPts],
                        ['テクニカル', selectedPreopen.scoreBreakdown?.technical],
                        ['地合い', selectedPreopen.scoreBreakdown?.marketSector],
                        ['流動性', selectedPreopen.scoreBreakdown?.liquidity],
                        ['リスク控除', selectedPreopen.scoreBreakdown?.riskDeduction],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <span>{label}</span>
                          <strong>{Number(value ?? 0).toFixed(1)}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="preopen-evidence">
                      <p>{(selectedPreopen.keyReasons || []).join(' / ')}</p>
                      <p>{(selectedPreopen.riskFlags || []).slice(0, 3).map((risk) => risk.label).join(' / ') || '重大なリスクフラグなし'}</p>
                    </div>
                  </div>
                )}
                <div className="evidence-panel">
                  <div>
                    <span>翌日パターン検証</span>
                    <p>{backtestLabel(selectedQuality?.backtest)} / 品質 {selectedQuality?.qualityScore ?? '-'}%。買える価格帯、出来高、過熱、RRを同じゲートで確認します。</p>
                  </div>
                  <div>
                    <span>価格データ品質</span>
                    <p>
                      {selectedDataQuality
                        ? `${Math.round(Number(selectedDataQuality.score || 0))}/100 / ${selectedDataQuality.priceFreshnessVerdict || '-'} / ${selectedDataQuality.source || '-'} / ${selectedDataQuality.latestBarAgeDays ?? '-'}日前`
                        : '価格履歴の鮮度と出所を確認中です。'}
                    </p>
                  </div>
                  <div>
                    <span>通過ゲート</span>
                    <p>
                      {priorityChecklistItems((selectedQuality?.gates || []).map((gate) => ({ label: gate.label, ok: gate.ok, detail: '' })), 6)
                        .map((gate) => `${gate.ok ? 'OK' : 'NG'} ${gate.label}`)
                        .join(' / ') || '検証データを取得中です。'}
                    </p>
                  </div>
                  <div>
                    <span>検討に進める条件</span>
                    <p>{tradePlan.entryCondition}</p>
                  </div>
                  <div>
                    <span>候補に残した根拠</span>
                    <p>{selectedStock?.candidateReason || selectedDetail?.analysis?.technicalSummary || '候補理由を取得中です。'}</p>
                  </div>
                  <div>
                    <span>テクニカル補足</span>
                    <ul>
                      {(selectedDetail?.analysis?.details || []).slice(0, 4).map((item, index) => <li key={`detail-${index}-${item}`}>{item}</li>)}
                    </ul>
                  </div>
                  <div>
                    <span>直近ニュース</span>
                    <p>
                      {selectedDetail?.news?.items?.[0]?.title
                        ? `${selectedDetail.news.items[0].title} (${shortDate(selectedDetail.news.items[0].publishedAt)} / ${selectedDetail?.freshness?.newsOk ? '直近材料' : '古い材料'})`
                        : '取得できるニュースがありません。材料未確認として扱います。'}
                    </p>
                  </div>
                  <div className="external-research-card">
                    <span>無料確認リンク</span>
                    <p>売買判断前に、無料で確認できる外部情報だけを別窓で照合します。</p>
                    <div className="external-link-list">
                      {(selectedDetail?.externalLinks || []).slice(0, 5).map((link) => (
                        <a key={link.label} href={link.url} target="_blank" rel="noreferrer">
                          {link.label}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="order-prep-panel">
                  <div className="order-prep-head">
                    <div>
                      <span>手入力前チェック</span>
                      <h3>手入力を検討する前の確認票</h3>
                    </div>
                    <StatusPill label={decisionGate.label} tone={decisionGate.ready ? 'good' : 'warn'} />
                  </div>
                  <div className="order-prep-grid">
                    <div><span>確認方式</span><strong>{tradePlan.marketAllowed ? '近い指値中心' : '近い指値'}</strong><small>成行判断はこの画面では推奨しません</small></div>
                    <div><span>銘柄</span><strong>{selectedStock?.ticker}</strong><small>{selectedStock?.name}</small></div>
                    <div><span>上限価格</span><strong>{yen(tradePlan.entry)}</strong><small>届かなければ見送り</small></div>
                    <div><span>株数上限</span><strong>{tradePlan.suggestedShares > 0 ? `${tradePlan.suggestedShares}株` : '0株'}</strong><small>最大損失 {yen(tradePlan.suggestedRiskJpy)}</small></div>
                  </div>
                  <div className="gate-list">
                    {decisionGate.items.map((item, index) => (
                      <div key={`decision-${index}-${item.label}`} className={item.ok ? 'pass' : 'block'}>
                        <b>{item.ok ? '通過' : '停止'}</b>
                        <span>{item.label}</span>
                        <small>{item.detail}</small>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="provenance-grid">
                  {dataProvenance.map((source, index) => (
                    <div key={`provenance-${index}-${source.label}`}>
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
                    ['年率変動', `${portfolioHealth.volatility.toFixed(1)}%`],
                    ['最大下落', `${portfolioHealth.drawdown.toFixed(1)}%`],
                    ['集中度', `${portfolioHealth.maxHoldingPct.toFixed(1)}%`],
                    ['現金比率', `${portfolioHealth.cashPct.toFixed(1)}%`],
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
            <label>
              <span>銘柄コード</span>
              <input data-testid="ledger-order-ticker" value={positionForm.ticker} onChange={(event) => updatePositionForm('ticker', event.target.value)} placeholder="4980.T" />
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
              <button type="button" className="ghost-action" onClick={() => applyPracticeCandidate({
                ticker: practiceTicker || positionForm.ticker,
                name: practiceName || positionForm.name,
                entryPrice: practiceEntry,
              })}>
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
            {holdings.length ? holdings.map((holding) => {
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
                    <div><span>売却確認価格</span><strong>{yen(plan.reviewPrice)}</strong><DataSourceBadge source={priceSourcePayload(holding, holding.dataQuality)} compact /><small>{plan.sellReviewShares || holding.shares}株</small></div>
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
            <span>保有銘柄</span>
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
                {holdings.map((holding) => (
                  <tr
                    key={holding.ticker}
                    data-testid="holding-row"
                    data-ticker={holding.ticker}
                    onClick={() => chooseTicker({
                      ticker: holding.ticker,
                      name: holding.name || holding.ticker,
                      price: holding.currentPrice,
                      entryPrice: holding.currentPrice,
                    }, { source: 'holding', note: '保有銘柄を反映' })}
                  >
                    <td><b>{holding.emoji || 'JP'} {holding.name || holding.ticker}</b><small>{holding.ticker}</small></td>
                    <td>{holding.shares} 株</td>
                    <td>{yen(holding.avgCost)}</td>
                    <td>{yen(holding.currentPrice)} <DataSourceBadge source={priceSourcePayload(holding, holding.dataQuality)} compact /></td>
                    <td>{yen(holding.value)}</td>
                    <td className={Number(holding.pnl || 0) >= 0 ? 'up' : 'down'}>{yen(holding.pnl)} / {pct(holding.pnlPct)}</td>
                    <td><StatusPill label={portfolioStatusLabel(holding.status)} tone="good" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {archivedHoldings.length ? (
          <section className="table-panel ledger-panel">
            <div className="section-title">
              <Archive size={18} />
              <span>保有履歴</span>
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
                  {archivedHoldings.map((holding) => (
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
        </PortfolioLedger>
      </main>

      <aside className="ops-panel">
        <div className="section-title">
          <Bot size={18} />
          <span>操作ログ</span>
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
            {jobsVerdictHeadline}
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

