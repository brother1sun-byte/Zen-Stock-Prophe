function safeText(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeNumber(value, fallback = '-') {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function bulletList(items = [], fallback = '確認できる材料が不足しています。') {
  const lines = items
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (!lines.length) return `- ${fallback}`;
  return lines.map((item) => `- ${item}`).join('\n');
}

function metricLines(metrics = []) {
  const lines = metrics
    .filter((metric) => metric?.label)
    .map((metric) => `- ${metric.label}: ${safeText(metric.value)}`);
  return lines.length ? lines.join('\n') : '- 候補指標は未取得です。';
}

function scenarioLines(openingScenarioPlan = []) {
  if (!openingScenarioPlan.length) {
    return '- 寄り付き後の出来高、VWAP、気配値、スプレッドを確認してから判断してください。';
  }
  return openingScenarioPlan
    .map((scenario) => {
      const detail = safeText(scenario.detail, '');
      return `- ${safeText(scenario.name)}: ${safeText(scenario.action)}。${detail}`;
    })
    .join('\n');
}

export function buildChatGptConsultationPrompt({
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
  marketStatusTopLabel,
  marketFreshnessLabel,
  yen,
  pct,
}) {
  const tickerLabel = safeText(topPickTickerLabel, '銘柄未選択');
  const action = safeText(simpleTopPickAction, '判定待ち');
  const score = safeNumber(daytradeTopPick?.score);
  const entry = daytradeTopPick?.entry ? yen(daytradeTopPick.entry) : '未計算';
  const target = daytradeTopPick?.target ? yen(daytradeTopPick.target) : '未計算';
  const stop = daytradeTopPick?.stop ? yen(daytradeTopPick.stop) : '未計算';
  const expectedProfit = daytradeTopPick?.probabilityAdjustedProfit
    ? yen(daytradeTopPick.probabilityAdjustedProfit)
    : '未計算';
  const changePct = selectedDetail?.changePct != null ? pct(selectedDetail.changePct) : '未取得';
  const indicators = selectedDetail?.analysis?.indicators || {};
  const rsi = indicators.rsi != null ? Number(indicators.rsi).toFixed(1) : '未取得';
  const macd = indicators.macd?.macd != null ? Number(indicators.macd.macd).toFixed(2) : '未取得';
  const advancedLabel = selectedAdvancedReport?.actionLabel || selectedAdvancedReport?.verdict || '未取得';
  const mlPrediction = selectedAdvancedReport?.mlPrediction;
  const mlLabel = mlPrediction
    ? `${safeText(mlPrediction.roleLabel, 'AI検証補助')}: ${safeText(mlPrediction.label)} / 上昇確率 ${safeNumber(mlPrediction.probabilityUpPct, 0)}% / 検証差 ${safeNumber(mlPrediction.edgePct, 0)}pt`
    : 'AI検証補助: 未取得';
  const sourceEvidence = selectedSourceEvidence?.length
    ? selectedSourceEvidence.map((item) => `- ${item}`).join('\n')
    : '- 価格・ランキングの出所は画面上のデータ出所バッジを確認してください。';
  const goodPoints = [
    topPickReason,
    daytradeTopPick?.candidateReason,
    ...(daytradeTopPick?.whyBuy || []),
  ];
  const cautions = [
    'これは投資助言ではなく、学習・分析・シミュレーション用の相談メモです。',
    topPickMaterial,
    crossEngineCheck?.detail,
    ...(daytradeTopPick?.whyNotBuy || []),
    ...(daytradeTopPick?.invalidConditions || []),
  ];

  return [
    '■目的',
    `${tickerLabel} について、短期売買で見るべきポイントをChatGPTに整理してもらうための材料です。`,
    '',
    '■結論',
    `${action}。短期スコアは ${score} / 100、期待損益目安は ${expectedProfit} です。`,
    '最終的な売買判断ではなく、寄り付き前後に確認する条件を整理するための参考情報として扱ってください。',
    '',
    '■判断範囲',
    'Zen Stock Prophet Proの現在画面に表示されている価格、出来高、材料、リスク、バックテスト系の確認情報に基づきます。',
    `市場状態: ${safeText(marketStatusTopLabel)} / データ鮮度: ${safeText(marketFreshnessLabel)}`,
    '',
    '■材料',
    `銘柄: ${tickerLabel}`,
    `現在変化率: ${changePct}`,
    `参考エントリー価格: ${entry}`,
    `利確目安: ${target}`,
    `損切り目安: ${stop}`,
    `RSI: ${rsi}`,
    `MACD: ${macd}`,
    `高度分析: ${safeText(advancedLabel)}`,
    mlLabel,
    metricLines(topCandidateMetrics),
    '',
    '■良い点',
    bulletList(goodPoints, '明確な強材料はまだ確認できていません。'),
    '',
    '■注意点',
    bulletList(cautions),
    '',
    '■寄り付き後方針',
    scenarioLines(openingScenarioPlan),
    '',
    '■データ出所・確認状態',
    sourceEvidence,
    '',
    '■アプリ側の補足',
    safeText(tradeStrategyTitle),
    safeText(tradeStrategyReason),
    safeText(jobsVerdictHeadline),
    '',
    '■ChatGPTへの依頼',
    '上記をもとに、短期売買で見るべき確認ポイント、見送り条件、寄り付き後の観察手順を日本語で整理してください。',
    '断定的な売買推奨や利益保証ではなく、リスクと不確実性を明示した分析支援として回答してください。',
  ].join('\n');
}
