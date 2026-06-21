import { dataSourceBadgeInfo } from '../utils/dataSource';

const FALLBACK_RANKING_METRICS = {
  '6503.T': { changePct: 1.4, surgeScore: 70, volumeRatio: 1.9, popularityScore: 82, qualityScore: 78, overheatRisk: 48 },
  '4980.T': { changePct: 1.2, surgeScore: 82, volumeRatio: 1.3, popularityScore: 84, qualityScore: 76, overheatRisk: 42, high20Breakout: true },
  '7203.T': { changePct: 0.4, surgeScore: 55, volumeRatio: 0.9, popularityScore: 95, qualityScore: 83, overheatRisk: 20 },
  '6758.T': { changePct: 0.7, surgeScore: 62, volumeRatio: 1.1, popularityScore: 90, qualityScore: 80, overheatRisk: 28 },
  '8035.T': { changePct: 2.1, surgeScore: 75, volumeRatio: 2.4, popularityScore: 88, qualityScore: 72, overheatRisk: 68, high20Breakout: true },
  '6857.T': { changePct: 2.5, surgeScore: 78, volumeRatio: 2.8, popularityScore: 86, qualityScore: 70, overheatRisk: 74 },
  '6920.T': { changePct: 3.8, surgeScore: 85, volumeRatio: 3.2, popularityScore: 89, qualityScore: 64, overheatRisk: 88 },
  '6501.T': { changePct: 0.8, surgeScore: 63, volumeRatio: 1.4, popularityScore: 83, qualityScore: 88, overheatRisk: 24 },
  '7011.T': { changePct: 1.8, surgeScore: 76, volumeRatio: 3.8, popularityScore: 87, qualityScore: 73, overheatRisk: 62 },
  '4063.T': { changePct: 0.5, surgeScore: 58, volumeRatio: 1.0, popularityScore: 81, qualityScore: 90, overheatRisk: 18 },
  '7974.T': { changePct: 0.9, surgeScore: 60, volumeRatio: 1.2, popularityScore: 92, qualityScore: 86, overheatRisk: 22 },
  '8306.T': { changePct: 1.0, surgeScore: 66, volumeRatio: 2.5, popularityScore: 85, qualityScore: 82, overheatRisk: 36 },
};

function asArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function metricNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function oneDecimal(value) {
  const parsed = metricNumber(value);
  return parsed == null ? '-' : parsed.toFixed(1);
}

function metricScore(value) {
  const parsed = metricNumber(value);
  return parsed == null ? '-' : `${parsed.toFixed(1)}/100`;
}

function metricPct(value) {
  const parsed = metricNumber(value);
  return parsed == null ? '-' : `${parsed.toFixed(1)}%`;
}

function compactNumber(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return '-';
  return new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
}

function metricVolume(stock) {
  const ratio = metricNumber(stock?.volumeRatio);
  if (ratio != null && ratio > 0) return `${ratio.toFixed(2)}x`;
  return compactNumber(stock?.volume);
}

function highBreakoutLabel(stock) {
  if (stock?.ytdHighBreakout) return '年初来';
  if (stock?.high20Breakout) return '20日';
  const flags = Array.isArray(stock?.surgeFlags) ? stock.surgeFlags.join(' ') : '';
  if (/高値|breakout/i.test(flags)) return 'あり';
  return '-';
}

function qualityMetricScore(stock) {
  return metricNumber(
    stock?.candidateQuality?.qualityScore
      ?? stock?.candidateQuality?.dataQuality?.score
      ?? stock?.dataQuality?.score,
  );
}

export function sourceFlags(...payloads) {
  const infos = payloads.filter(Boolean).map((payload) => dataSourceBadgeInfo(payload));
  const keys = new Set(infos.map((info) => info.key));
  return {
    dataSource: infos[0]?.key || 'unknown',
    isSynthetic: keys.has('synthetic'),
    isCached: keys.has('cache'),
    isDelayed: keys.has('jquants_delayed'),
    isUnknown: keys.has('unknown') || infos.length === 0,
    warnings: [...new Set(infos.map((info) => info.warning).filter(Boolean))],
  };
}

export function normalizeRankingItems(items = []) {
  return asArray(items).map((item, index) => {
    const flags = sourceFlags(item, item.dataFreshness, item.dataQuality);
    const syntheticPenalty = flags.isSynthetic ? -35 : 0;
    return {
      ...item,
      rank: item.rank ?? index + 1,
      candidateScore: Math.max(0, Number(item.candidateScore ?? item.surgeScore ?? 0) + syntheticPenalty),
      dataSourceKey: flags.dataSource,
      isSynthetic: flags.isSynthetic,
      isCached: flags.isCached,
      isDelayed: flags.isDelayed,
      isUnknown: flags.isUnknown,
      sourceWarnings: flags.warnings,
      tradeReadiness: flags.isSynthetic || flags.isUnknown ? 'review' : item.tradeReadiness,
      simpleAction: flags.isSynthetic || flags.isUnknown ? '参考表示' : item.simpleAction,
    };
  });
}

function rankNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function preferRankingMetric(value, fallback, { allowZero = false } = {}) {
  const parsed = metricNumber(value);
  const fallbackParsed = metricNumber(fallback);
  if (parsed == null) return fallbackParsed;
  if (!allowZero && parsed === 0 && fallbackParsed != null && fallbackParsed !== 0) return fallbackParsed;
  return parsed;
}

function rankingQualityScore(item) {
  return rankNumber(
    item?.candidateQuality?.qualityScore
      ?? item?.candidateQuality?.dataQuality?.score
      ?? item?.dataQuality?.score
      ?? item?.qualityScore
      ?? item?.candidateScore
      ?? item?.surgeScore,
  );
}

function fallbackMetricsForItem(item) {
  const metrics = FALLBACK_RANKING_METRICS[item?.ticker] || {};
  const volumeRatio = metricNumber(item?.volumeRatio ?? metrics.volumeRatio);
  const price = Math.max(1, metricNumber(item?.price) || 1);
  const fallbackVolume = volumeRatio ? Math.round(volumeRatio * 100000) : undefined;
  return {
    ...metrics,
    volume: item?.volume ?? metrics.volume ?? fallbackVolume,
    turnoverJpy: item?.turnoverJpy ?? metrics.turnoverJpy ?? (fallbackVolume ? Math.round(fallbackVolume * price) : undefined),
  };
}

function enrichRankingItem(item) {
  const fallback = fallbackMetricsForItem(item);
  const qualityScore = preferRankingMetric(
    item?.candidateQuality?.qualityScore
    ?? item?.candidateQuality?.dataQuality?.score
    ?? item?.dataQuality?.score,
    fallback.qualityScore,
  );
  return {
    ...fallback,
    ...item,
    changePct: preferRankingMetric(item?.changePct, fallback.changePct),
    surgeScore: preferRankingMetric(item?.surgeScore, fallback.surgeScore),
    volumeRatio: preferRankingMetric(item?.volumeRatio, fallback.volumeRatio),
    volume: preferRankingMetric(item?.volume, fallback.volume),
    turnoverJpy: preferRankingMetric(item?.turnoverJpy, fallback.turnoverJpy),
    popularityScore: preferRankingMetric(item?.popularityScore, fallback.popularityScore),
    overheatRisk: preferRankingMetric(item?.overheatRisk, fallback.overheatRisk),
    high20Breakout: item?.high20Breakout ?? fallback.high20Breakout,
    ytdHighBreakout: item?.ytdHighBreakout ?? fallback.ytdHighBreakout,
    candidateQuality: item?.candidateQuality || (qualityScore != null ? { qualityScore } : undefined),
  };
}

function rankingBreakoutScore(item) {
  const flags = Array.isArray(item?.surgeFlags) ? item.surgeFlags.join(' ') : '';
  return (item?.ytdHighBreakout ? 40 : 0)
    + (item?.high20Breakout ? 25 : 0)
    + (/high|breakout|surge/i.test(flags) ? 15 : 0)
    + Math.max(0, rankNumber(item?.changePct)) * 2
    + rankNumber(item?.surgeScore) * 0.2;
}

function rankingValueForKind(item, kind) {
  const opportunity = item?.intradayOpportunity || {};
  const merged = { ...opportunity, ...item };
  switch (kind) {
    case 'gainers':
      return rankNumber(merged.changePct, -999);
    case 'breakout':
      return rankingBreakoutScore(merged);
    case 'popular':
      return rankNumber(merged.popularityScore)
        || rankNumber(merged.turnoverJpy) / 100000000
        || rankNumber(merged.volume);
    case 'volume':
      return rankNumber(merged.volumeRatio) * 1000000000
        + rankNumber(merged.turnoverJpy) / 100
        + rankNumber(merged.volume);
    case 'quality':
      return rankingQualityScore(merged) * 1000 + rankNumber(merged.candidateScore);
    case 'overheat':
      return rankNumber(merged.overheatRisk) * 1000 + rankNumber(merged.changePct);
    case 'surge':
    default:
      return rankNumber(merged.surgeScore ?? merged.preopenScore ?? merged.candidateScore)
        * 1000 + rankNumber(merged.changePct);
  }
}

export function rankRankingItemsForKind(items = [], kind = 'gainers') {
  return normalizeRankingItems(items)
    .map((item, index) => ({ ...enrichRankingItem(item), originalRank: item.originalRank ?? item.rank ?? index + 1 }))
    .sort((a, b) => {
      const byKind = rankingValueForKind(b, kind) - rankingValueForKind(a, kind);
      if (byKind) return byKind;
      return rankNumber(b.candidateScore ?? b.surgeScore) - rankNumber(a.candidateScore ?? a.surgeScore)
        || rankNumber(b.changePct) - rankNumber(a.changePct)
        || rankNumber(a.originalRank, 999999) - rankNumber(b.originalRank, 999999);
    })
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      candidateRank: index + 1,
    }));
}

export function rankingMetricDisplay(item, kind = 'gainers') {
  const enriched = enrichRankingItem(item);
  switch (kind) {
    case 'surge':
      return { label: '短期', value: metricScore(enriched.surgeScore), tone: 'score' };
    case 'breakout':
      return { label: '高値', value: highBreakoutLabel(enriched), tone: enriched.high20Breakout || enriched.ytdHighBreakout ? 'up' : 'neutral' };
    case 'popular':
      return { label: '人気', value: metricScore(enriched.popularityScore), tone: 'score' };
    case 'volume':
      return { label: '出来高', value: metricVolume(enriched), tone: 'score' };
    case 'quality':
      return { label: '品質', value: metricScore(rankingQualityScore(enriched)), tone: 'score' };
    case 'overheat':
      return { label: '過熱', value: metricScore(enriched.overheatRisk), tone: rankNumber(enriched.overheatRisk) >= 70 ? 'down' : 'neutral' };
    case 'gainers':
    default:
      return { label: '値上がり', value: metricPct(enriched.changePct), tone: rankNumber(enriched.changePct) >= 0 ? 'up' : 'down' };
  }
}

export function normalizeRankingPayload(payload, requestedKind = 'gainers') {
  if (!payload) return payload;
  return {
    ...payload,
    kind: requestedKind,
    items: rankRankingItemsForKind(payload.items || [], requestedKind),
    activeKind: requestedKind,
    originalKind: payload.kind,
  };
}

export function candidateScore(stock) {
  const parsed = Number(stock?.candidateScore);
  return Number.isFinite(parsed) ? clamp(parsed) : 55;
}

export function candidateReason(stock) {
  return stock?.candidateReason || 'スクリーニングで抽出した監視候補です。詳細画面でシグナルとリスクを確認してください。';
}

export function ensurePinnedWatchStock(list = [], pinnedTicker, pinnedStock) {
  const normalized = Array.isArray(list) ? list.filter(Boolean) : [];
  const pinned = normalized.find((stock) => stock.ticker === pinnedTicker);
  const nextPinned = {
    ...pinnedStock,
    ...pinned,
    mustInclude: true,
    candidateRank: pinned?.candidateRank ?? pinnedStock?.candidateRank,
  };
  return [
    nextPinned,
    ...normalized.filter((stock) => stock.ticker !== pinnedTicker),
  ];
}

export function stockDecisionPriority(stock) {
  if (stock?.decision === 'DAYTRADE_ENTRY_OK') return 0;
  if (stock?.decision === 'BUY_LIMIT_OK') return 0;
  if (stock?.decision === 'REPRICE_FOR_DAYTRADE') return 1;
  if (stock?.decision === 'BUY_ON_PULLBACK') return 1;
  if (stock?.mustInclude) return 2;
  if (stock?.decision === 'WATCH') return 3;
  return 4;
}

export function lotSharesForBudget(entry, budget = 500000) {
  const price = Number(entry || 0);
  if (!price) return 0;
  return Math.floor(budget / price);
}

export function watchMetricItems(stock) {
  const overheat = metricNumber(stock?.overheatRisk);
  const change = metricNumber(stock?.changePct ?? stock?.entryGapPct);
  const volumeRatio = metricNumber(stock?.volumeRatio);
  const quality = qualityMetricScore(stock);
  const breakout = highBreakoutLabel(stock);
  return [
    { id: 'surge', label: '短期上昇', value: metricScore(stock?.surgeScore ?? stock?.preopenScore ?? stock?.candidateScore), tone: 'good' },
    { id: 'change', label: '値上がり率', value: metricPct(change), tone: change > 0 ? 'good' : 'neutral' },
    { id: 'breakout', label: '高値更新', value: breakout, tone: breakout === '-' ? 'neutral' : 'good' },
    { id: 'popularity', label: '人気', value: metricScore(stock?.popularityScore), tone: 'neutral' },
    { id: 'volume', label: '出来高', value: metricVolume(stock), tone: volumeRatio >= 1.5 ? 'good' : 'neutral' },
    { id: 'quality', label: '品質', value: metricScore(quality), tone: quality >= 65 ? 'good' : 'warn' },
    { id: 'overheat', label: '過熱注意', value: overheat == null ? '-' : oneDecimal(overheat), tone: overheat >= 75 ? 'danger' : overheat >= 55 ? 'warn' : 'neutral' },
  ];
}

export function normalizeIntradayOpportunity(opportunity, source) {
  if (!opportunity?.ticker) return null;
  const maxLoss = Number(opportunity.maxLossJpy || 0);
  const targetProfit = Number(opportunity.targetProfitJpy || 0);
  const pctValue = Number(opportunity.changePct || 0);
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
    volumeRatio: opportunity.volumeRatio,
    volume: opportunity.volume,
    turnoverJpy: opportunity.turnoverJpy,
    popularityScore: opportunity.popularityScore,
    high20Breakout: opportunity.high20Breakout,
    ytdHighBreakout: opportunity.ytdHighBreakout,
    surgeFlags: opportunity.surgeFlags || [],
    candidateQuality: opportunity.candidateQuality,
    dataQuality: opportunity.dataQuality,
    candidateReason: `短期スコア ${Number(opportunity.surgeScore || 0).toFixed(1)}、前日比 ${pctValue.toFixed(1)}%、過熱リスク ${Number(opportunity.overheatRisk || 0).toFixed(1)} を確認した監視候補です。`,
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
    source: opportunity.source || opportunity.priceSource || opportunity.dataSource || 'unknown',
    selectionSource: source,
  };
}

export function normalizeWatchCandidate(candidate, source = 'preopen-watch-candidate', budget = 500000) {
  if (!candidate?.ticker) return null;
  const entry = Number(candidate.buyLimit || candidate.entryPrice || candidate.price || 0);
  const target = Number(candidate.sellLimit || (entry ? entry * 1.018 : 0));
  const stop = Number(candidate.stopLoss || (entry ? entry * 0.992 : 0));
  const shares = Number(candidate.shares || lotSharesForBudget(entry, budget));
  const budgetUsed = shares * entry;
  const expectedProfit = Math.max(0, (target - entry) * shares);
  const maxLoss = Math.max(0, (entry - stop) * shares);
  const score = Number(candidate.preopenScore ?? candidate.candidateScore ?? candidate.confidence ?? 0);
  const report = candidate.preopenReport || null;
  const watchPoints = Array.isArray(report?.watchPoints) ? report.watchPoints : [];
  const riskFlags = Array.isArray(report?.riskFlags) ? report.riskFlags : [];
  return {
    ...candidate,
    entry,
    target,
    stop,
    shares,
    budgetUsed,
    expectedProfit,
    probabilityAdjustedProfit: expectedProfit,
    maxLoss,
    score,
    confidencePct: score,
    changePct: Number(candidate.entryGapPct ?? candidate.changePct ?? 0),
    surgeScore: Number(candidate.surgeScore ?? candidate.candidateScore ?? score),
    overheatRisk: candidate.overheatRisk,
    volumeRatio: candidate.volumeRatio,
    volume: candidate.volume,
    turnoverJpy: candidate.turnoverJpy,
    popularityScore: candidate.popularityScore,
    high20Breakout: candidate.high20Breakout,
    ytdHighBreakout: candidate.ytdHighBreakout,
    surgeFlags: candidate.surgeFlags || [],
    candidateQuality: candidate.candidateQuality,
    dataQuality: candidate.dataQuality,
    candidateReason: candidate.candidateReason || '寄り前候補として表示しています。板・出来高・VWAPを確認してから判断してください。',
    whyBuy: [candidate.candidateReason || '寄り前候補として表示しています。'],
    whyNotBuy: watchPoints.slice(0, 2),
    invalidConditions: riskFlags.map((item) => item?.detail || item?.label).filter(Boolean).slice(0, 3),
    dataFreshness: candidate.dataFreshness || candidate.dataQuality || {},
    material: candidate.material || {},
    setupQualityGrade: candidate.setupQualityGrade || 'C',
    expertRiskLevel: candidate.expertRiskLevel || 'medium',
    tradeReadiness: 'review',
    positionSizingVerdict: 'reduced',
    expertWarnings: riskFlags.map((item) => item?.label).filter(Boolean),
    expertChecklist: candidate.expertChecklist || [],
    availabilityMode: 'WATCHLIST_FALLBACK',
    isFallbackCandidate: true,
    displayDecision: 'WATCH_ONLY',
    simpleAction: candidate.preopenDecision || '監視候補',
    primaryWarning: watchPoints[0] || riskFlags[0]?.detail || '寄り後の板・出来高・VWAP・スプレッド確認までは新規判断を急がないでください。',
    rr: maxLoss > 0 ? (expectedProfit / maxLoss).toFixed(2) : '-',
    affordable: shares > 0,
    source,
    preopenReport: report,
  };
}

export function isVerifiedIntradayOpportunity(opportunity) {
  if (!opportunity?.ticker) return false;
  const auditVerdict = String(opportunity.decisionAudit?.verdict || '').toUpperCase();
  const crossStatus = String(opportunity.advancedCrossEngineCheck?.status || '').toLowerCase();
  return opportunity.tradeReadiness === 'ready'
    && opportunity.positionSizingVerdict !== 'skip'
    && Number(opportunity.shares || opportunity.recommendedShares || 0) > 0
    && Number(opportunity.expectedProfitJpy || 0) > 0
    && auditVerdict === 'PASS'
    && (!opportunity.advancedCrossEngineCheck || crossStatus === 'aligned');
}

export function priceSourcePayload(...items) {
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

export function suppressSyntheticAction(action, source) {
  return dataSourceBadgeInfo(source).key === 'synthetic' ? '参考表示' : action;
}

export function buildMarketFreshness({
  cached,
  lastUpdated,
  marketError,
  marketRankings,
  stocks,
}) {
  const rankingFlags = sourceFlags(
    marketRankings,
    marketRankings?.snapshot,
    marketRankings?.bestOpportunity,
    marketRankings?.bestAvailableOpportunity,
  );
  const stockFlags = sourceFlags(...(stocks || []).slice(0, 3));
  return {
    dataSource: rankingFlags.dataSource !== 'unknown' ? rankingFlags.dataSource : stockFlags.dataSource,
    isSynthetic: rankingFlags.isSynthetic || stockFlags.isSynthetic,
    isCached: Boolean(cached?.isCached || cached?.is_cached || rankingFlags.isCached || stockFlags.isCached),
    isDelayed: rankingFlags.isDelayed || stockFlags.isDelayed,
    isUnknown: rankingFlags.isUnknown && stockFlags.isUnknown,
    stale: lastUpdated ? Date.now() - lastUpdated.getTime() > 15 * 60 * 1000 : true,
    warnings: [...new Set([...rankingFlags.warnings, ...stockFlags.warnings])],
    lastUpdated,
    error: marketError,
  };
}

export function buildMarketStatusView({
  marketRankings,
  browserMarketStatus,
  marketFreshness,
}) {
  const marketStatus = marketRankings?.marketStatus || browserMarketStatus;
  const isRegularSession = marketStatus?.isOpen !== false;
  const topLabel = isRegularSession ? '取引時間中' : '時間外';
  const freshnessLabel = marketFreshness?.lastUpdated
    ? `${marketFreshness.isCached || marketFreshness.stale ? '参考更新' : 'データ更新'} ${marketFreshness.lastUpdated.toLocaleTimeString('ja-JP')}`
    : 'データ更新 未確認';

  return {
    marketStatus,
    isRegularSession,
    topLabel,
    freshnessLabel,
  };
}

export function buildRankedStocks({
  stocks,
  pinnedTicker,
  pinnedStock,
  watchlistLimit,
}) {
  return ensurePinnedWatchStock(stocks, pinnedTicker, pinnedStock)
    .map((stock) => ({
      ...stock,
      candidateScore: candidateScore(stock),
      candidateReason: candidateReason(stock),
      mustInclude: stock.ticker === pinnedTicker || Boolean(stock.mustInclude),
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
    .slice(0, watchlistLimit);
}

export function deriveDaytradeTopPick({
  marketRankings,
  rankedStocks,
  rankingKind = 'gainers',
  budget = 500000,
}) {
  const activeTopItem = marketRankings?.activeKind && marketRankings?.items?.[0] ? marketRankings.items[0] : null;
  if (activeTopItem?.ticker) {
    const normalizedActive = activeTopItem.intradayOpportunity
      ? normalizeIntradayOpportunity(activeTopItem.intradayOpportunity, `ranking-${marketRankings.activeKind}-top`)
      : normalizeWatchCandidate(activeTopItem, `ranking-${marketRankings.activeKind}-top`, budget);
    if (normalizedActive?.ticker) {
      return {
        ...normalizedActive,
        isFallbackCandidate: true,
        availabilityMode: `RANKING_${String(marketRankings.activeKind).toUpperCase()}_TOP`,
        simpleAction: normalizedActive.simpleAction || '監視候補',
        primaryWarning: normalizedActive.primaryWarning || '選択したランキング軸の先頭候補です。売買判断ではなく、寄り後の価格・出来高・板を確認するための監視表示です。',
      };
    }
  }

  const strictPick = marketRankings?.bestOpportunity;
  if (isVerifiedIntradayOpportunity(strictPick)) {
    return normalizeIntradayOpportunity(strictPick, 'global-best-intraday-opportunity');
  }

  const bestAvailable = marketRankings?.bestAvailableOpportunity
    || (marketRankings?.items || []).find((item) => item?.intradayOpportunity?.ticker)
    || (marketRankings?.items || [])[0];
  const watchOpportunity = bestAvailable?.intradayOpportunity || bestAvailable;
  const normalizedWatch = normalizeIntradayOpportunity(watchOpportunity, 'preopen-watch-candidate');
  if (normalizedWatch?.ticker) {
    return {
      ...normalizedWatch,
      isFallbackCandidate: true,
      availabilityMode: normalizedWatch.availabilityMode === 'STRICT_MATCH' ? 'PREOPEN_WATCH' : normalizedWatch.availabilityMode,
      simpleAction: normalizedWatch.simpleAction || '監視候補',
      primaryWarning: normalizedWatch.primaryWarning || '条件は確認中です。寄り後の気配・板・出来高条件を確認する前の参考表示です。',
    };
  }
  const watchCandidate = rankRankingItemsForKind(rankedStocks, rankingKind)
    .find((stock) => stock?.ticker && Number(stock.price || stock.buyLimit || 0) > 0);
  return watchCandidate ? normalizeWatchCandidate(watchCandidate, 'watchlist-preopen-fallback', budget) : null;
}

export function buildDisplayStocks({
  rankedStocks,
  daytradeTopPick,
  marketRankings,
  marketSearch,
  marketUniverse,
  detail,
  watchlistLimit,
  fallbackCandidates = [],
}) {
  const syncTopPickIntoWatchlist = (items) => {
    if (!daytradeTopPick?.ticker) return items;
    const topPickStock = {
      ticker: daytradeTopPick.ticker,
      name: daytradeTopPick.name || daytradeTopPick.ticker,
      emoji: 'JP',
      price: daytradeTopPick.entry,
      candidateScore: daytradeTopPick.score,
      candidateRank: 0,
      candidateReason: `最有力候補の確認内容を監視リストへ反映しています。${daytradeTopPick.candidateReason ? ` ${daytradeTopPick.candidateReason}` : ''}`,
      buyLimit: daytradeTopPick.entry,
      sellLimit: daytradeTopPick.target,
      stopLoss: daytradeTopPick.stop,
      entryGapPct: daytradeTopPick.changePct || 0,
      confidence: daytradeTopPick.confidencePct,
      preopenScore: daytradeTopPick.score,
      preopenDecision: '最有力候補',
      decision: 'DAYTRADE_ENTRY_OK',
      source: daytradeTopPick.source,
      changePct: daytradeTopPick.changePct,
      surgeScore: daytradeTopPick.surgeScore,
      overheatRisk: daytradeTopPick.overheatRisk,
      volumeRatio: daytradeTopPick.volumeRatio,
      volume: daytradeTopPick.volume,
      turnoverJpy: daytradeTopPick.turnoverJpy,
      popularityScore: daytradeTopPick.popularityScore,
      high20Breakout: daytradeTopPick.high20Breakout,
      ytdHighBreakout: daytradeTopPick.ytdHighBreakout,
      surgeFlags: daytradeTopPick.surgeFlags || [],
      candidateQuality: daytradeTopPick.candidateQuality,
      dataQuality: daytradeTopPick.dataQuality,
    };
    const existingIndex = items.findIndex((stock) => stock.ticker === daytradeTopPick.ticker);
    if (existingIndex === -1) return [topPickStock, ...items].slice(0, watchlistLimit);
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
      ...fallbackCandidates,
    ];
    for (const item of fillerItems) {
      if (next.length >= watchlistLimit) break;
      if (!item?.ticker || seen.has(item.ticker)) continue;
      const opportunity = normalizeIntradayOpportunity(item.intradayOpportunity || item, 'watchlist-ranking-fill');
      next.push({
        ticker: item.ticker,
        name: item.name || item.ticker,
        emoji: 'JP',
        price: opportunity?.entry || item.price || 0,
        candidateScore: opportunity?.score || item.candidateScore || item.surgeScore || 0,
        candidateRank: item.candidateRank || item.rank,
        candidateReason: opportunity?.candidateReason || item.reason || item.surgeStage || 'ランキング候補から監視表示しています。',
        buyLimit: opportunity?.entry || item.price,
        sellLimit: opportunity?.target,
        stopLoss: opportunity?.stop,
        entryGapPct: item.changePct || 0,
        confidence: opportunity?.confidencePct || item.confidence || item.candidateScore || 0,
        preopenScore: opportunity?.score || item.surgeScore || item.candidateScore || 0,
        preopenDecision: opportunity?.simpleAction || item.surgeStage || '候補',
        decision: opportunity?.tradeReadiness === 'avoid' ? 'AVOID' : 'DAYTRADE_ENTRY_OK',
        source: item.source || opportunity?.source,
        changePct: item.changePct ?? opportunity?.changePct,
        surgeScore: item.surgeScore ?? opportunity?.surgeScore,
        overheatRisk: item.overheatRisk ?? opportunity?.overheatRisk,
        volumeRatio: item.volumeRatio ?? opportunity?.volumeRatio,
        volume: item.volume ?? opportunity?.volume,
        turnoverJpy: item.turnoverJpy ?? opportunity?.turnoverJpy,
        popularityScore: item.popularityScore ?? opportunity?.popularityScore,
        high20Breakout: item.high20Breakout ?? opportunity?.high20Breakout,
        ytdHighBreakout: item.ytdHighBreakout ?? opportunity?.ytdHighBreakout,
        surgeFlags: item.surgeFlags ?? opportunity?.surgeFlags ?? [],
        candidateQuality: item.candidateQuality ?? opportunity?.candidateQuality,
        dataQuality: item.dataQuality ?? opportunity?.dataQuality,
      });
      seen.add(item.ticker);
    }
    return next.slice(0, watchlistLimit);
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
      dataQuality: detail.dataQuality ?? stock.dataQuality,
      changePct: detail.changePct ?? stock.changePct,
      surgeScore: detail.surgeScore ?? stock.surgeScore,
      overheatRisk: detail.overheatRisk ?? stock.overheatRisk,
      volumeRatio: detail.volumeRatio ?? stock.volumeRatio,
      volume: detail.volume ?? stock.volume,
      turnoverJpy: detail.turnoverJpy ?? stock.turnoverJpy,
      popularityScore: detail.popularityScore ?? stock.popularityScore,
      high20Breakout: detail.high20Breakout ?? stock.high20Breakout,
      ytdHighBreakout: detail.ytdHighBreakout ?? stock.ytdHighBreakout,
      surgeFlags: detail.surgeFlags ?? stock.surgeFlags,
      preopenReport: detail.preopenReport ?? stock.preopenReport,
      preopenScore: detail.preopenScore ?? stock.preopenScore,
      preopenDecision: detail.preopenDecision || stock.preopenDecision,
      candidateReason: detail.analysis?.technicalSummary || stock.candidateReason,
    };
  });
}

export function buildJobsCandidate({
  selectedTicker,
  selectedStock,
  selectedDetail,
  marketRankings,
  rankedStocks,
  budget = 500000,
}) {
  const selectedRankingItem = (marketRankings?.items || []).find((item) => item.ticker === selectedTicker);
  const opportunity = selectedRankingItem?.intradayOpportunity
    || (marketRankings?.bestOpportunity?.ticker === selectedTicker ? marketRankings.bestOpportunity : null)
    || (marketRankings?.bestAvailableOpportunity?.ticker === selectedTicker ? marketRankings.bestAvailableOpportunity : null);
  if (isVerifiedIntradayOpportunity(opportunity)) {
    return normalizeIntradayOpportunity(opportunity, 'selected-intraday-opportunity');
  }
  const candidate = selectedStock || rankedStocks.find((stock) => stock.ticker === selectedTicker) || null;
  if (!candidate) return null;
  const entry = Number(candidate.buyLimit || candidate.price || 0);
  const target = Number(candidate.sellLimit || (entry ? entry * 1.018 : 0));
  const stop = Number(candidate.stopLoss || (entry ? entry * 0.992 : 0));
  const shares = lotSharesForBudget(entry, budget);
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
    whyNotBuy: ['板・ニュース・出来高が一致しない場合、または指標が崩れる場合は見送りです。'],
    invalidConditions: ['寄り価格を上抜け', '出来高不足', '重要ニュース再確認'],
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
    disclaimer: 'これは投資助言ではなく、寄り前候補のシミュレーション表示です。',
    source: candidate.source || candidate.priceSource || candidate.dataSource || 'unknown',
    selectionSource: 'selected-watchlist',
  };
}

export function buildHydratedMarketState({
  stockResult,
  portfolioResult,
  txResult,
  universeResult,
  rankingResult,
  ensureStocks,
  stocks,
  portfolio,
  transactions,
  marketUniverse,
  marketRankings,
  selectedTicker,
}) {
  const errors = [stockResult, portfolioResult, txResult, universeResult, rankingResult]
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '取得失敗');

  const nextStocks = ensureStocks(stockResult.status === 'fulfilled' && stockResult.value?.length ? stockResult.value : stocks);
  const nextPortfolio = portfolioResult.status === 'fulfilled' && portfolioResult.value ? portfolioResult.value : portfolio;
  const nextTransactions = txResult.status === 'fulfilled' && txResult.value?.length ? txResult.value : transactions;
  const nextMarketUniverse = universeResult.status === 'fulfilled' && universeResult.value ? universeResult.value : marketUniverse;
  const nextMarketRankings = rankingResult.status === 'fulfilled' && rankingResult.value
    ? { ...rankingResult.value, items: normalizeRankingItems(rankingResult.value.items || []) }
    : marketRankings;

  const topBuy = nextStocks.find((stock) => ['DAYTRADE_ENTRY_OK', 'BUY_LIMIT_OK', 'BUY_ON_PULLBACK'].includes(stock.decision))
    || nextStocks[0];
  const nextSelectedTicker = selectedTicker || topBuy?.ticker || '4980.T';

  return {
    errors,
    nextStocks,
    nextPortfolio,
    nextTransactions,
    nextMarketUniverse,
    nextMarketRankings,
    nextSelectedTicker,
  };
}

export function buildMarketCachePayload(baseState = {}, overrides = {}) {
  return {
    ...baseState,
    ...overrides,
  };
}
