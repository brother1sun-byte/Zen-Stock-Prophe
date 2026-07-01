const NIGHT_RANKS = [
  { min: 78, label: 'A：翌朝必ず確認' },
  { min: 62, label: 'B：条件次第で確認' },
  { min: 45, label: 'C：監視のみ' },
  { min: 0, label: 'D：見送り' },
];

const DATA_SOURCE_FALLBACK = {
  label: 'データ取得状況',
  value: '取得不可',
  detail: '取得できない項目は手入力または一次情報確認で補ってください。',
};

const KNOWN_JP_STOCK_NAMES = {
  '4151.T': '協和キリン',
  '4980.T': 'デクセリアルズ',
  '6501.T': '日立製作所',
  '6503.T': '三菱電機',
  '6758.T': 'ソニーグループ',
  '6857.T': 'アドバンテスト',
  '6920.T': 'レーザーテック',
  '7011.T': '三菱重工業',
  '7203.T': 'トヨタ自動車',
  '7974.T': '任天堂',
  '8035.T': '東京エレクトロン',
  '8306.T': '三菱UFJフィナンシャル・グループ',
  '9984.T': 'ソフトバンクグループ',
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function roundPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number);
}

function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTicker(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/(\d{4})/);
  return match ? `${match[1]}.T` : text;
}

function stockName(stock = {}) {
  const ticker = normalizeTicker(stock.ticker || stock.stockCode);
  return KNOWN_JP_STOCK_NAMES[ticker] || stock.companyName || stock.name || stock.displayName || stock.ticker || '銘柄名未取得';
}

function latestChartPoint(detail = {}) {
  const chart = Array.isArray(detail.chart) ? detail.chart : [];
  return chart[chart.length - 1] || {};
}

function previousChartPoint(detail = {}) {
  const chart = Array.isArray(detail.chart) ? detail.chart : [];
  return chart.length >= 2 ? chart[chart.length - 2] : {};
}

function volumeScore(detail = {}, stock = {}) {
  const chart = Array.isArray(detail.chart) ? detail.chart : [];
  const latestVolume = safeNumber(stock.volume, safeNumber(latestChartPoint(detail).volume, 0));
  if (!chart.length || !latestVolume) return 45;
  const previous = chart.slice(Math.max(0, chart.length - 8), Math.max(0, chart.length - 1));
  const average = previous.length
    ? previous.reduce((sum, item) => sum + Number(item.volume || 0), 0) / previous.length
    : latestVolume;
  if (!average) return 45;
  return clamp(50 + ((latestVolume / average) - 1) * 55);
}

function trendScore(detail = {}, stock = {}) {
  const chart = Array.isArray(detail.chart) ? detail.chart : [];
  if (Number.isFinite(Number(stock.trendScore))) return clamp(stock.trendScore);
  if (Number.isFinite(Number(stock.candidateScore))) return clamp(stock.candidateScore);
  if (chart.length < 3) return 50;
  const first = safeNumber(chart[Math.max(0, chart.length - 8)]?.close, safeNumber(chart[0]?.close, 0));
  const last = safeNumber(latestChartPoint(detail).close, first);
  if (!first) return 50;
  return clamp(50 + ((last - first) / first) * 420);
}

function rangeScore(price, lines) {
  if (!price || !lines?.resistance?.value) return 45;
  return clamp(((lines.resistance.value - price) / price) * 4000);
}

function riskPenalty(preopen = {}) {
  if (preopen.risk === 'high') return 18;
  if (preopen.risk === 'medium') return 8;
  if (preopen.risk === 'unknown') return 12;
  if ((preopen.unknownInputs || []).length) return 10;
  return 0;
}

function percentLabel(value) {
  const number = safeNumber(value, null);
  return number === null ? '取得不可' : `${Number(number).toFixed(1)}%`;
}

function scoreLabel(score) {
  const number = safeNumber(score, null);
  return number === null ? '未取得' : `${Math.round(clamp(number))}/100`;
}

function advancedReportForTicker(ticker, reports = {}) {
  const normalized = normalizeTicker(ticker);
  return reports[normalized] || reports[normalized.replace('.T', '')] || reports[ticker] || {};
}

export function buildAdvancedConnectionSummary(report = {}) {
  report = report || {};
  if (!report || !Object.keys(report).length) {
    return {
      status: '高度分析未取得',
      score: null,
      items: ['既存高度分析との接続データは未取得です。'],
      warnings: ['データ不足のため、価格ラインと手入力確認を優先してください。'],
    };
  }

  const factors = report.factors || {};
  const reliability = report.analysisReliability || {};
  const dataQuality = report.dataQuality || {};
  const items = [
    `トレンド ${scoreLabel(factors.trend?.score)} ${factors.trend?.state || ''}`.trim(),
    `流動性 ${scoreLabel(factors.liquidityScore)} / 出来高 ${safeNumber(factors.volumeRatio, null) === null ? '取得不可' : `${Number(factors.volumeRatio).toFixed(2)}倍`}`,
    `リスク管理 ${scoreLabel(factors.riskControlScore)} / ATR ${percentLabel(factors.atrPct)}`,
    `分析信頼度 ${scoreLabel(reliability.score)} ${reliability.label || reliability.grade || ''}`.trim(),
    `データ品質 ${scoreLabel(dataQuality.score)} ${dataQuality.source || ''}`.trim(),
  ];
  const warnings = [];
  if ((report.walkForward?.sampleCount || 0) < 10) warnings.push('ウォークフォワード検証の標本数が少ないため、確認材料として扱います。');
  if ((dataQuality.score || 0) < 60) warnings.push('データ品質が十分でないため、手入力価格と一次情報確認を併用してください。');

  return {
    status: '高度分析接続済み',
    score: safeNumber(report.compositeScore, reliability.score ?? dataQuality.score ?? null),
    items,
    warnings,
  };
}

export function buildLifestyleBacktestSummary(report = {}) {
  report = report || {};
  const backtest = report.backtest || report.validation || {};
  const walkForward = report.walkForward || {};
  const hasBacktest = Object.keys(backtest).length > 0;
  const hasWalkForward = Object.keys(walkForward).length > 0;
  return {
    status: hasBacktest || hasWalkForward ? '検証材料あり' : '検証材料未取得',
    sampleCount: safeNumber(walkForward.sampleCount ?? backtest.sampleCount, 0),
    walkForwardScore: safeNumber(walkForward.score, null),
    hitRatePct: safeNumber(walkForward.hitRatePct ?? backtest.winRatePct, null),
    profitFactor: safeNumber(backtest.profitFactor, null),
    maxDrawdownPct: safeNumber(backtest.maxDrawdownPct, null),
    summary: hasBacktest || hasWalkForward
      ? `標本 ${safeNumber(walkForward.sampleCount ?? backtest.sampleCount, 0)}件 / 検証 ${scoreLabel(walkForward.score)} / 勝率 ${percentLabel(walkForward.hitRatePct ?? backtest.winRatePct)}`
      : '同条件の検証材料は未取得です。',
    notice: '検証結果は利益保証ではなく、判断材料の再確認用です。',
  };
}

export function buildVolumeSeasonality(detail = {}, report = {}) {
  detail = detail || {};
  report = report || {};
  const chart = Array.isArray(detail.chart) ? detail.chart : [];
  if (chart.length < 4) {
    return {
      status: '出来高季節性は取得不可',
      label: '日中出来高不足',
      source: '取得不可',
      estimated: true,
      notice: '前場・後場別の実出来高は無料データでは不足しています。必要に応じて証券アプリで確認してください。',
    };
  }

  const recent = chart.slice(-8);
  const midpoint = Math.max(1, Math.floor(recent.length / 2));
  const firstHalfAvg = recent.slice(0, midpoint).reduce((sum, item) => sum + Number(item.volume || 0), 0) / midpoint;
  const secondHalf = recent.slice(midpoint);
  const secondHalfAvg = secondHalf.reduce((sum, item) => sum + Number(item.volume || 0), 0) / Math.max(1, secondHalf.length);
  const ratio = secondHalfAvg && firstHalfAvg ? secondHalfAvg / firstHalfAvg : safeNumber(report.factors?.volumeRatio, 1);
  const label = ratio >= 1.25 ? '後半増加傾向' : ratio <= 0.8 ? '後半鈍化傾向' : '横ばい傾向';
  return {
    status: '出来高季節性は推定',
    label,
    ratio,
    source: '日足または短期足から推定',
    estimated: true,
    notice: '前場・後場別の厳密な出来高ではなく、取得済み足データからの推定です。',
  };
}

export function estimateSpreadRisk({ stock = {}, detail = {}, manualPrice, report = {} } = {}) {
  stock = stock || {};
  detail = detail || {};
  report = report || {};
  const price = roundPrice(manualPrice || stock.price || detail.price || latestChartPoint(detail).close);
  const volume = safeNumber(stock.volume || latestChartPoint(detail).volume, 0);
  const liquidityScore = safeNumber(report.factors?.liquidityScore ?? stock.liquidityScore, null);
  let risk = '不明';
  let estimatedSpreadPct = null;
  if (price && (volume || liquidityScore !== null)) {
    const liquidityBase = liquidityScore !== null ? liquidityScore : clamp(Math.log10(Math.max(1, volume)) * 13);
    estimatedSpreadPct = Number(Math.max(0.03, (100 - liquidityBase) / 900).toFixed(2));
    risk = estimatedSpreadPct >= 0.09 ? '高' : estimatedSpreadPct >= 0.06 ? '中' : '低';
  }
  return {
    status: risk === '不明' ? 'スプレッド推定不可' : `スプレッド警戒 ${risk}`,
    risk,
    estimatedSpreadPct,
    source: '板情報なしの推定',
    estimated: true,
    notice: '板厚・気配値は取得不可のため、流動性と出来高からの推定です。実際の発注前に証券アプリで確認してください。',
  };
}

function sourceSummary(stock = {}, detail = {}, extra = {}) {
  const value = stock.priceSource || stock.source || detail.priceSource || detail.source || extra.source || extra.label;
  if (!value) return DATA_SOURCE_FALLBACK;
  return {
    label: 'データ取得状況',
    value,
    detail: stock.updatedAt || detail.updatedAt || extra.detail || '取得時刻は画面上の最終確認時刻も確認してください。',
  };
}

export function buildDaytradePriceLines({ stock = {}, detail = {}, candidate = {}, manualPrice } = {}) {
  const latest = latestChartPoint(detail);
  const previous = previousChartPoint(detail);
  const strategy = detail.analysis?.strategy || {};
  const indicators = detail.analysis?.indicators || {};
  const basePrice = roundPrice(
    manualPrice
    || candidate.entryPrice
    || candidate.limitPrice
    || detail.price
    || stock.price
    || latest.close,
  );
  const previousHigh = roundPrice(stock.previousHigh || detail.previousHigh || previous.high || latest.high);
  const previousLow = roundPrice(stock.previousLow || detail.previousLow || previous.low || latest.low);
  const dayHigh = roundPrice(detail.dayHigh || latest.high || previousHigh);
  const dayLow = roundPrice(detail.dayLow || latest.low || previousLow);
  const range = Math.max(5, Math.round((basePrice || 1000) * 0.008));
  const support = roundPrice(candidate.supportLine || detail.supportLine || strategy.support || previousLow || (basePrice ? basePrice - range : null));
  const resistance = roundPrice(candidate.resistanceLine || detail.resistanceLine || strategy.resistance || previousHigh || (basePrice ? basePrice + range * 2 : null));
  const orderCandidate = roundPrice(candidate.entryPrice || stock.buyLimit || strategy.buy_limit || basePrice);
  const orderLimit = roundPrice(candidate.limitPrice || candidate.buyLimit || stock.buyLimit || strategy.buy_limit || (orderCandidate ? orderCandidate + Math.max(1, Math.round(orderCandidate * 0.003)) : null));
  const firstTakeProfit = roundPrice(candidate.targetPrice || strategy.take_profit || (resistance && basePrice ? Math.max(resistance, basePrice + range) : basePrice ? basePrice + range : null));
  const secondTakeProfit = roundPrice(candidate.stretchTargetPrice || strategy.stretch_target || (firstTakeProfit ? firstTakeProfit + Math.max(2, Math.round((basePrice || firstTakeProfit) * 0.006)) : null));
  const exitLine = roundPrice(candidate.stopLoss || strategy.stop_loss || support || (basePrice ? basePrice - range : null));
  const invalidLine = roundPrice(candidate.invalidLine || (exitLine ? exitLine - Math.max(1, Math.round((basePrice || exitLine) * 0.003)) : null));
  const vwap = roundPrice(candidate.vwap || detail.vwap || indicators.vwap || stock.vwap);

  return {
    currentPrice: {
      label: manualPrice ? '手入力価格' : '参考価格',
      value: basePrice,
      reason: manualPrice ? '証券アプリ等で確認した価格を手入力値として反映しています。' : '取得できた価格または直近足を参考値として使っています。',
      estimated: !manualPrice && !detail.price && !stock.price,
    },
    orderCandidate: {
      label: '注文候補価格',
      value: orderCandidate,
      reason: '既存の候補価格、分析上限、または参考価格を起点にしています。',
      estimated: !candidate.entryPrice && !strategy.buy_limit,
    },
    orderLimit: {
      label: '注文上限価格',
      value: orderLimit,
      reason: '候補価格からの許容乖離を小さく抑えた上限です。',
      estimated: !candidate.limitPrice && !candidate.buyLimit && !stock.buyLimit && !strategy.buy_limit,
    },
    firstTakeProfit: {
      label: '初回利確候補',
      value: firstTakeProfit,
      reason: '直近抵抗線または参考価格からの短期値幅を目安にしています。',
      estimated: !candidate.targetPrice && !strategy.take_profit,
    },
    secondTakeProfit: {
      label: '第二利確候補',
      value: secondTakeProfit,
      reason: '初回利確候補を超えた場合の追加確認ラインです。',
      estimated: !candidate.stretchTargetPrice && !strategy.stretch_target,
    },
    exitLine: {
      label: '撤退ライン',
      value: exitLine,
      reason: '支持線または既存のリスク管理ラインを割り込むか確認する価格です。',
      estimated: !candidate.stopLoss && !strategy.stop_loss,
    },
    invalidLine: {
      label: '無効化ライン',
      value: invalidLine,
      reason: '想定シナリオをいったん取り下げる確認ラインです。',
      estimated: !candidate.invalidLine,
    },
    resistance: {
      label: '抵抗線',
      value: resistance,
      reason: '直近高値または分析上の上値目安です。',
      estimated: !candidate.resistanceLine && !detail.resistanceLine && !strategy.resistance,
    },
    support: {
      label: '支持線',
      value: support,
      reason: '直近安値または分析上の下値目安です。',
      estimated: !candidate.supportLine && !detail.supportLine && !strategy.support,
    },
    vwap: {
      label: 'VWAP',
      value: vwap,
      reason: vwap ? '取得済みまたは計算済みのVWAPです。' : 'VWAPは取得不可です。必要に応じて証券アプリで確認してください。',
      estimated: !vwap,
    },
    previousHigh: {
      label: '前日高値',
      value: previousHigh,
      reason: '直近日足または前営業日の高値です。',
      estimated: !stock.previousHigh && !detail.previousHigh,
    },
    previousLow: {
      label: '前日安値',
      value: previousLow,
      reason: '直近日足または前営業日の安値です。',
      estimated: !stock.previousLow && !detail.previousLow,
    },
    dayHigh: {
      label: '当日高値',
      value: dayHigh,
      reason: '取得できた当日または直近足の高値です。',
      estimated: !detail.dayHigh,
    },
    dayLow: {
      label: '当日安値',
      value: dayLow,
      reason: '取得できた当日または直近足の安値です。',
      estimated: !detail.dayLow,
    },
  };
}

function rankLabel(score) {
  return NIGHT_RANKS.find((item) => score >= item.min)?.label || 'D：見送り';
}

function matchPreopen(ticker, results = []) {
  const normalized = normalizeTicker(ticker);
  return (Array.isArray(results) ? results : []).find((item) => normalizeTicker(item.ticker) === normalized) || {};
}

export function buildNightScanRows({
  stocks = [],
  detailsByTicker = {},
  watchlistResults = [],
  advancedReportsByTicker = {},
  fetchedAt = '',
} = {}) {
  return (Array.isArray(stocks) ? stocks : []).map((stock) => {
    const ticker = normalizeTicker(stock.ticker || stock.stockCode);
    const detail = detailsByTicker[ticker] || detailsByTicker[stock.ticker] || {};
    const preopen = matchPreopen(ticker, watchlistResults);
    const advancedReport = advancedReportForTicker(ticker, advancedReportsByTicker);
    const advancedSummary = buildAdvancedConnectionSummary(advancedReport);
    const backtestSummary = buildLifestyleBacktestSummary(advancedReport);
    const volumeSeasonality = buildVolumeSeasonality(detail, advancedReport);
    const spreadRisk = estimateSpreadRisk({ stock, detail, report: advancedReport });
    const priceLines = buildDaytradePriceLines({ stock, detail, candidate: stock });
    const price = priceLines.currentPrice.value || roundPrice(stock.price);
    const advancedScore = safeNumber(advancedSummary.score, stock.candidateScore ?? stock.preopenScore ?? 50);
    const validationScore = safeNumber(backtestSummary.walkForwardScore, 50);
    const spreadPenalty = spreadRisk.risk === '高' ? 10 : spreadRisk.risk === '中' ? 4 : 0;
    const score = clamp(
      (trendScore(detail, stock) * 0.28)
      + (volumeScore(detail, stock) * 0.18)
      + (rangeScore(price, priceLines) * 0.16)
      + (clamp(stock.liquidityScore ?? (stock.volume ? 70 : 45)) * 0.14)
      + (clamp(stock.materialScore ?? (preopen.hasEdinetDocuments || preopen.hasEarnings ? 72 : 48)) * 0.12)
      + (clamp(advancedScore) * 0.08)
      + (clamp(validationScore) * 0.04)
      - riskPenalty(preopen)
      - spreadPenalty,
    );
    const rank = rankLabel(score);
    const morningConditions = [
      priceLines.vwap.value ? `VWAP ${priceLines.vwap.value}円付近を維持しているか確認` : 'VWAPは取得不可のため証券アプリで確認',
      priceLines.orderLimit.value ? `${priceLines.orderLimit.value}円以下なら候補条件を維持` : '注文上限は手入力で確認',
      preopen.status ? `材料状態: ${preopen.status}` : '開示・決算材料は一次情報で確認',
    ];
    const skipConditions = [
      priceLines.orderLimit.value ? `注文上限価格を大きく超えた場合は見送り優先` : '注文上限を確認できない場合は待機',
      preopen.risk === 'high' ? '重要予定があるため一次情報確認前は判断保留' : '出来高が伴わない場合は見送り優先',
    ];

    return {
      ticker,
      companyName: stockName(stock),
      phaseLabel: '翌朝確認候補',
      rankLabel: rank,
      score: Math.round(score),
      shortStrengthScore: Math.round(trendScore(detail, stock)),
      volumeScore: Math.round(volumeScore(detail, stock)),
      trendDirection: trendScore(detail, stock) >= 58 ? '上向き確認' : trendScore(detail, stock) <= 42 ? '弱含み確認' : '横ばい確認',
      preopenStatus: preopen.status || 'データ未取得',
      risk: preopen.risk || 'unknown',
      priceLines,
      morningConditions,
      skipConditions,
      reasons: [
        `短期強弱 ${Math.round(trendScore(detail, stock))}/100`,
        `出来高 ${Math.round(volumeScore(detail, stock))}/100`,
        `値幅余地 ${Math.round(rangeScore(price, priceLines))}/100`,
        `高度分析 ${advancedSummary.status}`,
        `検証材料 ${backtestSummary.status}`,
      ],
      advancedSummary,
      backtestSummary,
      volumeSeasonality,
      spreadRisk,
      dataSource: sourceSummary(stock, detail, preopen.sourceStatus?.earnings),
      fetchedAt,
    };
  }).sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker, 'ja'));
}

function scoreMorningGate({ price, lines, preopen = {}, advancedSummary = {}, backtestSummary = {}, spreadRisk = {} }) {
  if (!price || !lines?.orderLimit?.value) return 35;
  let score = 50;
  if (price <= lines.orderLimit.value) score += 18;
  else score -= Math.min(25, ((price - lines.orderLimit.value) / price) * 1400);
  if (lines.vwap.value && price >= lines.vwap.value) score += 10;
  if (lines.resistance.value && lines.resistance.value > price) score += Math.min(12, ((lines.resistance.value - price) / price) * 1200);
  if (lines.exitLine.value && price > lines.exitLine.value) score += 8;
  if (preopen.risk === 'high') score -= 12;
  if (preopen.risk === 'unknown' || (preopen.unknownInputs || []).length) score -= 10;
  if (safeNumber(advancedSummary.score, null) !== null) score += Math.min(8, Math.max(-8, (advancedSummary.score - 50) / 6));
  if (safeNumber(backtestSummary.walkForwardScore, null) !== null) score += Math.min(6, Math.max(-6, (backtestSummary.walkForwardScore - 50) / 8));
  if (spreadRisk.risk === '高') score -= 10;
  if (spreadRisk.risk === '中') score -= 4;
  return clamp(score);
}

export function buildMorningGate({
  stock = {},
  detail = {},
  preopenResult = {},
  advancedReport = {},
  manualPrice,
} = {}) {
  const lines = buildDaytradePriceLines({ stock, detail, candidate: stock, manualPrice });
  const price = lines.currentPrice.value;
  const advancedSummary = buildAdvancedConnectionSummary(advancedReport);
  const backtestSummary = buildLifestyleBacktestSummary(advancedReport);
  const volumeSeasonality = buildVolumeSeasonality(detail, advancedReport);
  const spreadRisk = estimateSpreadRisk({ stock, detail, manualPrice, report: advancedReport });
  const score = scoreMorningGate({ price, lines, preopen: preopenResult, advancedSummary, backtestSummary, spreadRisk });
  const overLimit = price && lines.orderLimit.value ? price - lines.orderLimit.value : null;
  let decision = '待機';
  if (!price) decision = '待機';
  else if (score >= 72 && overLimit <= 0) decision = '条件付きで手動注文候補';
  else if (score >= 54) decision = '寄り付き後まで待機';
  else decision = '見送り優先';

  return {
    modeLabel: 'Morning Gate',
    ticker: normalizeTicker(stock.ticker || detail.ticker),
    companyName: stockName(stock.ticker ? stock : detail),
    decision,
    score: Math.round(score),
    manualPriceUsed: Boolean(manualPrice),
    currentPrice: price,
    orderLimitDistance: {
      label: '注文上限との差',
      value: overLimit === null ? null : Math.round(lines.orderLimit.value - price),
      pct: overLimit === null || !price ? null : Number((((lines.orderLimit.value - price) / price) * 100).toFixed(2)),
    },
    lines,
    advancedSummary,
    backtestSummary,
    volumeSeasonality,
    spreadRisk,
    reasons: [
      lines.vwap.value && price ? (price >= lines.vwap.value ? 'VWAPより上を確認' : 'VWAPより下のため待機寄り') : 'VWAPは取得不可',
      lines.resistance.value && price ? `抵抗線まで ${Math.max(0, lines.resistance.value - price)}円` : '抵抗線は推定または取得不可',
      preopenResult.status ? `材料状態: ${preopenResult.status}` : '材料状態はデータ未取得',
    ],
    cautions: [
      overLimit > 0 ? '注文上限を超えています。見送り優先で確認してください。' : '寄り付き直後の急な失速に注意してください。',
      preopenResult.risk === 'high' ? '重要予定があるため一次情報確認を優先してください。' : 'スプレッドと出来高は証券アプリで確認してください。',
    ],
    skipConditions: [
      '出来高が伴わない場合',
      'VWAPを明確に下回る場合',
      '注文上限価格を超える場合',
    ],
    dataSource: sourceSummary(stock, detail, preopenResult.sourceStatus?.earnings),
  };
}

export function buildWorkMonitorRows({ holdings = [], manualPrices = {}, advancedReportsByTicker = {} } = {}) {
  return (Array.isArray(holdings) ? holdings : []).map((holding) => {
    const ticker = normalizeTicker(holding.ticker || holding.stockCode);
    const advancedReport = advancedReportForTicker(ticker, advancedReportsByTicker);
    const advancedSummary = buildAdvancedConnectionSummary(advancedReport);
    const backtestSummary = buildLifestyleBacktestSummary(advancedReport);
    const spreadRisk = estimateSpreadRisk({ stock: holding, report: advancedReport });
    const manualPrice = manualPrices[ticker] ?? manualPrices[holding.ticker];
    const currentPrice = roundPrice(manualPrice || holding.currentPrice || holding.price);
    const target = roundPrice(holding.exitPlan?.targetPrice || holding.targetPrice || holding.takeProfit);
    const exitLine = roundPrice(holding.exitPlan?.stopLoss || holding.exitLine || holding.stopLoss);
    let status = '保有継続';
    if (target && currentPrice && currentPrice >= target * 0.995) status = '利確検討';
    if (exitLine && currentPrice && currentPrice <= exitLine * 1.005) status = '撤退検討';
    const takeProfitDistance = target && currentPrice ? target - currentPrice : null;
    const exitDistance = exitLine && currentPrice ? currentPrice - exitLine : null;
    const score = clamp(
      58
      + (takeProfitDistance !== null && takeProfitDistance >= 0 ? Math.min(14, takeProfitDistance / Math.max(1, currentPrice) * 1200) : 8)
      + (exitDistance !== null && exitDistance > 0 ? Math.min(16, exitDistance / Math.max(1, currentPrice) * 1600) : -18)
      + (status === '保有継続' ? 10 : status === '利確検討' ? 4 : -16),
    );
    return {
      ticker,
      companyName: stockName(holding),
      status,
      score: Math.round(score),
      currentPrice,
      manualPriceUsed: Boolean(manualPrice),
      takeProfitDistance: {
        label: '利確候補まで',
        value: takeProfitDistance,
        target,
      },
      exitDistance: {
        label: '撤退ラインまで',
        value: exitDistance,
        target: exitLine,
      },
      reasons: status === '保有継続'
        ? ['利確候補と撤退ラインの間で推移しています。', '次の確認時間まで価格ラインを維持できるか確認します。']
        : status === '利確検討'
          ? ['利確候補に接近しています。', '出来高とVWAP維持を短時間で確認してください。']
          : ['撤退ラインに接近しています。', 'シナリオ無効化の可能性を確認してください。'],
      nextCheck: status === '保有継続' ? '後場寄りまたは大引け前' : 'できるだけ早く価格ラインを再確認',
      advancedSummary,
      backtestSummary,
      spreadRisk,
      dataSource: sourceSummary(holding),
    };
  });
}

export function buildAfterCloseReviewDraft(input = {}) {
  const ticker = normalizeTicker(input.ticker);
  const entryPrice = safeNumber(input.entryPrice, 0);
  const exitPrice = safeNumber(input.exitPrice, 0);
  const shares = safeNumber(input.shares, 0);
  const errors = [];
  if (!ticker || !ticker.match(/\d{4}\.T/)) errors.push('銘柄コードを確認してください。');
  if (entryPrice <= 0) errors.push('エントリー価格を入力してください。');
  if (exitPrice <= 0) errors.push('売却価格を入力してください。');
  if (shares <= 0) errors.push('株数を入力してください。');
  const pnl = Math.round((exitPrice - entryPrice) * shares);
  const record = {
    ticker,
    companyName: input.companyName || '',
    entryPrice,
    exitPrice,
    shares,
    pnl,
    originalReason: input.originalReason || '',
    workedReason: input.workedReason || '',
    missedReason: input.missedReason || '',
    missedSignal: input.missedSignal || '',
    improvementMemo: input.improvementMemo || '',
    reviewPurpose: '今後の判断材料を改善するためのローカル記録です。投資助言ではありません。',
    createdAt: input.createdAt || new Date().toISOString(),
  };
  return {
    ok: errors.length === 0,
    errors,
    record,
    json: JSON.stringify(record, null, 2),
  };
}

const AFTER_CLOSE_REVIEW_KEY = 'zen_lifestyle_after_close_reviews_v1';

function storageAvailable(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

export function loadAfterCloseReviewLog(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storageAvailable(storage)) return [];
  try {
    const parsed = JSON.parse(storage.getItem(AFTER_CLOSE_REVIEW_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAfterCloseReviewDraft(draft, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!draft?.ok || !draft.record) {
    return { ok: false, message: '入力内容を確認してください。', records: loadAfterCloseReviewLog(storage) };
  }
  if (!storageAvailable(storage)) {
    return { ok: false, message: 'ローカル保存を利用できません。JSONを手動で保存してください。', records: [] };
  }
  const records = [draft.record, ...loadAfterCloseReviewLog(storage)].slice(0, 200);
  storage.setItem(AFTER_CLOSE_REVIEW_KEY, JSON.stringify(records));
  return { ok: true, message: '振り返りログをこの端末に保存しました。', records };
}
