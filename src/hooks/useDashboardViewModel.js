import { useMemo } from 'react';
import { priceSourcePayload, rankRankingItemsForKind, suppressSyntheticAction } from './useMarketDataHelpers';
import { displayStockName, localizeVisibleMarketText, stockDisplayLabel } from '../utils/stockNames';

const RANKING_METRIC_BY_KIND = {
  surge: 'surge',
  gainers: 'change',
  breakout: 'breakout',
  popular: 'popularity',
  volume: 'volume',
  quality: 'quality',
  overheat: 'overheat',
};

function buildTopCandidateMetrics(daytradeTopPick, compactNumber, rankingKind = 'surge') {
  if (!daytradeTopPick) return [];
  const surgeValue = Number(daytradeTopPick.surgeScore ?? daytradeTopPick.score ?? 0);
  const changeValue = Number(daytradeTopPick.changePct ?? 0);
  const popularityValue = Number(daytradeTopPick.popularityScore ?? 0);
  const volumeRatio = Number(daytradeTopPick.volumeRatio ?? 0);
  const qualityValue = Number(
    daytradeTopPick.candidateQuality?.qualityScore
      ?? daytradeTopPick.dataQuality?.score
      ?? 0,
  );
  const overheatValue = Number(daytradeTopPick.overheatRisk ?? 0);
  const breakoutLabel = daytradeTopPick.ytdHighBreakout
    ? '年初来高値'
    : daytradeTopPick.high20Breakout
      ? '20日'
      : '-';

  const activeMetricId = RANKING_METRIC_BY_KIND[rankingKind] || 'surge';
  return [
    { id: 'surge', label: '短期上昇', value: `${surgeValue.toFixed(1)}/100`, tone: surgeValue >= 70 ? 'good' : 'neutral' },
    { id: 'change', label: '値上がり率', value: `${changeValue >= 0 ? '+' : ''}${changeValue.toFixed(2)}%`, tone: changeValue > 0 ? 'good' : 'neutral' },
    { id: 'breakout', label: '高値更新', value: breakoutLabel, tone: breakoutLabel === '-' ? 'neutral' : 'good' },
    { id: 'popularity', label: '人気', value: `${popularityValue.toFixed(1)}/100`, tone: 'neutral' },
    { id: 'volume', label: '出来高', value: volumeRatio > 0 ? `${volumeRatio.toFixed(2)}x` : compactNumber(daytradeTopPick.volume), tone: volumeRatio >= 1.5 ? 'good' : 'neutral' },
    { id: 'quality', label: '品質', value: `${qualityValue.toFixed(1)}/100`, tone: qualityValue >= 65 ? 'good' : 'warn' },
    { id: 'overheat', label: '過熱注意', value: overheatValue > 0 ? overheatValue.toFixed(1) : '-', tone: overheatValue >= 70 ? 'danger' : overheatValue >= 55 ? 'warn' : 'neutral' },
  ].map((metric) => ({
    ...metric,
    active: metric.id === activeMetricId,
  }));
}

function buildOpeningScenarioPlan(daytradeTopPick, isReviewTopPick) {
  if (!daytradeTopPick || !isReviewTopPick) return [];
  return [
    {
      name: '寄り付き後の方針',
      action: '監視を優先',
      detail: '寄り直後の気配、出来高、VWAPを確認してから判断します。',
    },
    {
      name: '強く始まる',
      action: '追わずに待つ',
      detail: '上に飛んだ直後は追わず、出来高を保った押し目だけ確認します。',
    },
    {
      name: '弱めに始まる',
      action: '反発確認',
      detail: 'VWAP回復や出来高の戻りが出るまでは様子見にします。',
    },
    {
      name: '見送り確認',
      action: '見送り優先',
      detail: 'スプレッド拡大、出来高不足、材料不明なら当日は見送ります。',
    },
  ];
}

function buildSelectedSourceEvidence({
  selectedDetail,
  selectedFreshness,
  jobsCandidate,
  sourceShortLabel,
}) {
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
  const selectedRankingFetchDate = selectedFreshness.sourceFetchedDate
    || jobsCandidate?.sourceFetchedDate
    || selectedDetail?.sourceFetchedDate;
  const selectedRankingSource = selectedFreshness.rankingSource
    || jobsCandidate?.source
    || selectedFreshness.source
    || selectedDetail?.source;

  return {
    selectedPriceSource,
    selectedSourceEvidence: [
      selectedPriceDate ? `価格日付 ${selectedPriceDate}` : '価格日付 未確認',
      selectedPriceSource ? `価格ソース ${sourceShortLabel(selectedPriceSource)}` : null,
      selectedRankingFetchDate ? `ランキング取得 ${selectedRankingFetchDate}` : null,
      selectedRankingSource ? `ランキング元 ${sourceShortLabel(selectedRankingSource)}` : null,
    ].filter(Boolean),
  };
}

function buildPracticeViewModel({
  userSelectedTicker,
  daytradeTopPick,
  selectedStock,
  selectedTicker,
  selectedDetail,
  selectedSourceContext,
  topPickSource,
  tradePlan,
  positionForm,
  holdings,
  transactions,
  practiceOrders,
  getPracticeOrderValidation,
  tradeActionLabel,
}) {
  const practiceCandidate = userSelectedTicker && userSelectedTicker !== daytradeTopPick?.ticker
    ? selectedStock
    : (selectedStock?.ticker === daytradeTopPick?.ticker ? daytradeTopPick : selectedStock || daytradeTopPick);
  const practiceTicker = practiceCandidate?.ticker || selectedStock?.ticker || selectedTicker;
  const practiceName = displayStockName(practiceCandidate || selectedStock || practiceTicker);
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

  return {
    practiceCandidate,
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
  };
}

function clampScore(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function parseFinancialNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function buildValueDisciplineLens({
  daytradeTopPick,
  jquantsResearch,
  selectedDetail,
  selectedStock,
  tradePlan,
}) {
  const price = Number(selectedDetail?.price || selectedStock?.price || daytradeTopPick?.entry || 0);
  const entry = Number(tradePlan?.entry || daytradeTopPick?.entry || 0);
  const entryDiscountPct = price > 0 && entry > 0 ? ((price - entry) / price) * 100 : 0;
  const qualityScore = Number(
    selectedStock?.candidateQuality?.qualityScore
      ?? daytradeTopPick?.candidateQuality?.qualityScore
      ?? selectedDetail?.candidateQuality?.qualityScore
      ?? selectedDetail?.dataQuality?.score
      ?? daytradeTopPick?.dataQuality?.score
      ?? 50,
  );
  const dataScore = Number(
    selectedDetail?.dataQuality?.score
      ?? selectedStock?.dataQuality?.score
      ?? daytradeTopPick?.dataQuality?.score
      ?? 45,
  );
  const popularityScore = Number(selectedStock?.popularityScore ?? daytradeTopPick?.popularityScore ?? 50);
  const overheatRisk = Number(selectedStock?.overheatRisk ?? daytradeTopPick?.overheatRisk ?? 50);
  const statement = jquantsResearch?.latestStatement || {};
  const eps = parseFinancialNumber(
    statement.earningsPerShare
      ?? statement.eps
      ?? statement.EarningsPerShare,
  );
  const bps = parseFinancialNumber(
    statement.bookValuePerShare
      ?? statement.bps
      ?? statement.BookValuePerShare,
  );
  const pe = price > 0 && eps ? price / eps : null;
  const pb = price > 0 && bps ? price / bps : null;
  const valuationScore = pe && pb
    ? clampScore(92 - Math.max(0, pe - 15) * 2.2 - Math.max(0, pb - 1.5) * 18 + (pe <= 12 ? 5 : 0) + (pb <= 1.2 ? 5 : 0))
    : clampScore(dataScore * 0.35 + 28);
  const moatScore = clampScore(qualityScore * 0.55 + popularityScore * 0.18 + dataScore * 0.27);
  const marginScore = clampScore(55 + entryDiscountPct * 6 - Math.max(0, overheatRisk - 55) * 0.85);
  const patienceScore = clampScore(
    64
      + (entryDiscountPct > 0 ? 12 : -10)
      + (tradePlan?.decision === 'WATCH' ? 8 : 0)
      - Math.max(0, overheatRisk - 55) * 0.75,
  );
  const understandabilityScore = clampScore(
    (selectedDetail?.analysis?.details?.length ? 18 : 0)
      + (selectedDetail?.news?.items?.length ? 14 : 0)
      + dataScore * 0.68,
  );
  const score = Math.round(
    moatScore * 0.26
      + marginScore * 0.24
      + valuationScore * 0.2
      + patienceScore * 0.16
      + understandabilityScore * 0.14,
  );
  const verdict = score >= 75
    ? '複利候補として監視'
    : score >= 60
      ? '待ちながら精査'
      : '今は見送り';
  const tone = score >= 75 ? 'good' : score >= 60 ? 'warn' : 'bad';
  const valuationLabel = pe && pb
    ? `PER ${pe.toFixed(1)}x / PBR ${pb.toFixed(1)}x`
    : 'PER/PBR未確認';
  const summary = score >= 75
    ? '事業品質と忍耐条件は長期確認に値します。ただし表示はシミュレーション専用です。'
    : score >= 60
      ? '事業は調べる価値がありますが、より大きな安全余裕か、さらに明確な根拠が必要です。'
      : '価値投資チェックでは待機です。短期の勢いだけでは、品質・根拠・価格規律を満たしません。';
  const checks = [
    {
      label: '堀の代理指標',
      value: Math.round(moatScore),
      ok: moatScore >= 65,
      detail: '候補品質、人気の持続性、データ品質を事業の堀の代理指標として確認します。',
    },
    {
      label: '安全余裕',
      value: Math.round(marginScore),
      ok: marginScore >= 60,
      detail: entry > 0 && price > 0
        ? `指値目安は現在値より${entryDiscountPct.toFixed(2)}%低い水準です。`
        : '注文目安と現在値の両方を確認できていません。',
    },
    {
      label: '割安度確認',
      value: Math.round(valuationScore),
      ok: valuationScore >= 58,
      detail: valuationLabel,
    },
    {
      label: '忍耐フィルター',
      value: Math.round(patienceScore),
      ok: patienceScore >= 62,
      detail: overheatRisk >= 70
        ? '過熱リスクが高いため、待機を優先します。'
        : '極端な過熱シグナルは優勢ではありません。',
    },
    {
      label: '理解できる根拠',
      value: Math.round(understandabilityScore),
      ok: understandabilityScore >= 58,
      detail: selectedDetail?.news?.items?.length
        ? 'テクニカル状況と直近ニュースの根拠が見えています。'
        : '事業・ニュース根拠がまだ不足しています。',
    },
  ];

  return {
    label: 'バフェット流・価値投資チェック',
    score,
    verdict,
    tone,
    summary,
    valuationLabel,
    checks,
    metrics: [
      { label: '堀', value: Math.round(moatScore), tone: moatScore >= 65 ? 'good' : 'warn' },
      { label: '安全余裕', value: Math.round(marginScore), tone: marginScore >= 60 ? 'good' : 'warn' },
      { label: '割安度', value: Math.round(valuationScore), tone: valuationScore >= 58 ? 'good' : 'warn' },
      { label: '忍耐', value: Math.round(patienceScore), tone: patienceScore >= 62 ? 'good' : 'warn' },
    ],
  };
}

function buildDecisionGate({
  brokerStatus,
  crossEngineCheck,
  selectedDetail,
  tradePlan,
}) {
  const rr = Number(tradePlan.rr || 0);
  const crossStatus = crossEngineCheck?.status || 'pending';
  const crossDetail = crossEngineCheck?.detail || '高度分析とランキングの照合結果を確認中です。';
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
      ok: crossStatus === 'aligned',
      detail: crossDetail,
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
}

function buildDataProvenance({
  jquantsResearch,
  pct,
  selectedDetail,
  shortDate,
}) {
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
}

function buildJquantsView({
  jquantsCode,
  jquantsResearch,
  selectedTicker,
  yen,
}) {
  const configured = Boolean(jquantsResearch?.configured);
  const selectedCode = (jquantsCode || selectedTicker || '').replace(/\.T$/i, '');
  const researchCode = String(jquantsResearch?.code || '').replace(/\.T$/i, '');
  const matchesSelection = !researchCode || researchCode === selectedCode;
  const integrity = matchesSelection ? jquantsResearch?.sourceIntegrity : null;
  const statusLabel = configured ? 'J-Quants 接続済み' : 'J-Quants 未接続';
  const statusTone = configured ? 'good' : 'neutral';
  const integrityTone = integrity?.verdict === 'PASS'
    ? 'good'
    : integrity?.verdict === 'REVIEW'
      ? 'warn'
      : 'neutral';
  const integrityLabel = integrity?.label || (matchesSelection ? (configured ? '接続確認のみ' : '未接続') : '銘柄未確認');
  const modeLabel = configured ? jquantsResearch?.mode : 'トークン未設定';
  const targetLabel = matchesSelection
    ? (jquantsResearch?.issue?.name || jquantsResearch?.code || jquantsCode)
    : jquantsCode;
  const latestClose = configured && matchesSelection && jquantsResearch?.latestQuote?.close ? yen(jquantsResearch.latestQuote.close) : '未取得';
  const latestSource = matchesSelection ? (integrity?.latestQuoteSource || jquantsResearch?.latestQuote?.source || '未取得') : '未確認';
  const epsBps = configured && matchesSelection
    ? `${jquantsResearch?.latestStatement?.earningsPerShare || '-'} / ${jquantsResearch?.latestStatement?.bookValuePerShare || '-'}`
    : '未取得';
  const officialStatus = integrity?.officialHistoryUsable
    ? `${integrity.officialHistorySource || 'official'} / ${integrity.officialHistoryAgeDays ?? '-'}日`
    : '未確認';
  const note = configured && !matchesSelection
    ? `${jquantsCode} はまだJ-Quants確認を実行していません。選択銘柄に連動してコードは更新済みです。必要なら確認ボタンで読み取り専用チェックを行います。`
    : configured && jquantsResearch?.jquantsError
      ? `J-Quants APIキーは適用済みですが、現在は ${jquantsResearch.jquantsError} のため公式遅延データを取得できません。直近日足は補完データとして表示しています。`
      : integrity?.detail
        ? integrity.detail
        : configured
          ? `J-Quantsは読み取り専用で確認しています。日足の最新値は ${jquantsResearch?.latestQuote?.date || '未取得'}、リアルタイム板ではありません。`
          : jquantsResearch?.message || jquantsResearch?.nextStep || 'J-Quants APIトークンを設定すると、銘柄マスタ・日足・財務データを読み取り専用で取得できます。未設定でもアプリ本体は利用できます。';

  return {
    configured,
    selectedCode,
    researchCode,
    matchesSelection,
    integrity,
    statusLabel,
    statusTone,
    integrityTone,
    integrityLabel,
    modeLabel,
    targetLabel,
    latestClose,
    latestSource,
    epsBps,
    officialStatus,
    note,
  };
}

export function useDashboardViewModel({
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
}) {
  return useMemo(() => {
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
    const monitoredTickerLabel = jobsCandidate ? stockDisplayLabel(jobsCandidate) : '国内市場スキャン中';
    const topPickTickerLabel = daytradeTopPick
      ? stockDisplayLabel(daytradeTopPick)
      : hasNoActionableTopPick
        ? '候補抽出待ち'
        : '全市場スキャン中';
    const rankingPayloadKind = rankingKind || marketRankings?.kind;
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
      : 'フル市場データが古い、または未取得です。Yahoo上昇銘柄だけから地合いを推定せず、候補監査では要確認にします。';

    const usesIntradayOpportunity = jobsCandidate?.selectionSource === 'selected-intraday-opportunity';
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
    const selectedSourceContext = priceSourcePayload(
      cached ? { isCached: true, source: 'cache' } : null,
      selectedDetail,
      selectedDetail?.dataQuality,
      selectedFreshness,
      jobsCandidate,
      jobsCandidate?.dataQuality,
    );
    const { selectedSourceEvidence } = buildSelectedSourceEvidence({
      selectedDetail,
      selectedFreshness,
      jobsCandidate,
      sourceShortLabel,
    });

    const isReviewTopPick = Boolean(daytradeTopPick) && (
      isFallbackTopPick
      || daytradeTopPick?.tradeReadiness === 'review'
      || daytradeTopPick?.positionSizingVerdict === 'reduced'
      || daytradeTopPick?.decisionAudit?.verdict === 'REVIEW'
      || daytradeTopPick?.advancedCrossEngineCheck?.status === 'review'
    );
    const offHoursAnalysisPrefix = !marketStatusView?.isRegularSession
      ? '現在は時間外です。翌営業日の候補として表示しています。'
      : '';
    const topPickReason = daytradeTopPick
      ? `${offHoursAnalysisPrefix}${isReviewTopPick ? '翌朝の監視候補です。' : isFallbackTopPick ? '今日見る候補です。' : '条件に近い候補です。'}まず見るのは、注文上限・利確・撤退・買わない条件だけです。`
      : hasNoActionableTopPick
        ? `${isYahooGainersRanking ? 'Yahoo掲載順は表示していますが、' : ''}候補計算中です。ランキング行から確認できます。`
        : 'ランキング更新後に、今日見る候補をここへ表示します。';
    const topPickMaterial = localizeVisibleMarketText(daytradeTopPick?.material?.summary)
      || '決算・適時開示・重要ニュースは未確認です。取引前に無料確認リンクで必ず確認してください。';
    const topCandidateMetrics = buildTopCandidateMetrics(daytradeTopPick, compactNumber, rankingPayloadKind);
    const selectedRankingMetric = topCandidateMetrics.find((metric) => metric.active) || null;
    const openingScenarioPlan = buildOpeningScenarioPlan(daytradeTopPick, isReviewTopPick);
    const decisionGate = buildDecisionGate({
      brokerStatus,
      crossEngineCheck,
      selectedDetail,
      tradePlan,
    });
    const dataProvenance = buildDataProvenance({
      jquantsResearch,
      pct,
      selectedDetail,
      shortDate,
    });
    const jquantsView = buildJquantsView({
      jquantsCode,
      jquantsResearch,
      selectedTicker,
      yen,
    });
    const valueDisciplineLens = buildValueDisciplineLens({
      daytradeTopPick,
      jquantsResearch,
      selectedDetail,
      selectedStock,
      tradePlan,
    });

    const practiceView = buildPracticeViewModel({
      userSelectedTicker,
      daytradeTopPick,
      selectedStock,
      selectedTicker,
      selectedDetail,
      selectedSourceContext,
      topPickSource,
      tradePlan,
      positionForm,
      holdings,
      transactions,
      practiceOrders,
      getPracticeOrderValidation,
      tradeActionLabel,
    });

    const jobsVerdictHeadline = !daytradeTopPick?.ticker
      ? tradePlan.headline
      : `${daytradeTopPick.ticker} ${daytradeTopPick.simpleAction || (daytradeTopPick.isFallbackCandidate ? '買い候補' : '承認待ち候補')} / ${daytradeTopPick.entry ? `指値 ${Math.round(daytradeTopPick.entry).toLocaleString('ja-JP')}円` : '指値確認中'}. ${daytradeTopPick.primaryWarning || tradePlan.headline}`;

    const baseRankingItems = marketRankings?.items?.length
      ? marketRankings.items
      : rankedStocks.map((stock, index) => ({
        rank: index + 1,
        ticker: stock.ticker,
        name: displayStockName(stock),
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
    const rankingItems = rankRankingItemsForKind(baseRankingItems, rankingPayloadKind);

    return {
      prophetValidated,
      hasRankingItems,
      hasNoActionableTopPick,
      isFallbackTopPick,
      topPickSource,
      simpleTopPickAction,
      monitoredTickerLabel,
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
      usesIntradayOpportunity,
      tradeStrategyTitle,
      tradeStrategyReason,
      decisionScoreLabel,
      selectedRankContext,
      selectedDecisionSourceLabel,
      selectedSourceContext,
      selectedSourceEvidence,
      isReviewTopPick,
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
      ...practiceView,
    };
  }, [
    brokerStatus,
    cached,
    compactNumber,
    crossEngineCheck,
    daytradeTopPick,
    getPracticeOrderValidation,
    holdings,
    jquantsCode,
    jquantsResearch,
    jobsCandidate,
    marketRankings,
    marketStatusView,
    marketUniverse,
    positionForm,
    practiceOrders,
    pct,
    rankedStocks,
    rankingKind,
    rankingTabs,
    selectedAdvancedReport,
    selectedDetail,
    selectedStock,
    selectedTicker,
    sourceShortLabel,
    shortDate,
    tradeActionLabel,
    tradePlan,
    transactions,
    userSelectedTicker,
    yen,
  ]);
}
