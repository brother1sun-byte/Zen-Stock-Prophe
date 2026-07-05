const ACTIONABLE_LABEL = '検証済み候補';
const RESEARCH_ONLY_LABEL = '調査のみ';

function normalizeTicker(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\.T$/, '');
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function pickOpportunity(input = {}) {
  return input.intradayOpportunity || input.opportunity || input.daytradeOpportunity || input || {};
}

function pickDecisionAudit(input = {}, opportunity = {}) {
  return opportunity.decisionAudit || input.decisionAudit || {};
}

function pickCrossEngine(input = {}, opportunity = {}) {
  return opportunity.advancedCrossEngineCheck || input.advancedCrossEngineCheck || input.crossEngineCheck || {};
}

export function hasActionableSize(input = {}) {
  const opportunity = pickOpportunity(input);
  const shares = positiveNumber(opportunity.shares ?? opportunity.recommendedShares ?? opportunity.actionableShares);
  const budget = positiveNumber(
    opportunity.budgetUsedJpy
      ?? opportunity.recommendedBudgetUsedJpy
      ?? opportunity.positionValueJpy
      ?? opportunity.notionalJpy,
  );
  const risk = positiveNumber(opportunity.riskJpy ?? opportunity.maxLossJpy ?? opportunity.plannedRiskJpy);
  return shares > 0 && (budget > 0 || risk > 0);
}

export function buildVerificationGate(input = {}, options = {}) {
  const opportunity = pickOpportunity(input);
  const audit = pickDecisionAudit(input, opportunity);
  const crossEngine = pickCrossEngine(input, opportunity);
  const tradeReadiness = String(opportunity.tradeReadiness || input.tradeReadiness || '').toLowerCase();
  const auditVerdict = String(audit.verdict || '').toUpperCase();
  const crossStatus = String(crossEngine.status || crossEngine.verdict || '').toLowerCase();
  const crossRequired = Boolean(
    options.requireCrossEngine
      ?? opportunity.requireCrossEngineConfirmation
      ?? input.requireCrossEngineConfirmation
      ?? crossEngine.required,
  );
  const checks = [
    {
      id: 'tradeReadiness',
      ok: tradeReadiness === 'ready',
      label: 'tradeReadiness == ready',
      failReason: 'tradeReadiness が ready ではありません',
    },
    {
      id: 'decisionAudit',
      ok: auditVerdict === 'PASS',
      label: 'decisionAudit.verdict == PASS',
      failReason: 'decisionAudit が PASS ではありません',
    },
    {
      id: 'actionableSize',
      ok: hasActionableSize(opportunity),
      label: 'actionable size あり',
      failReason: '検証済みサイズがありません',
    },
    {
      id: 'crossEngine',
      ok: !crossRequired || crossStatus === 'aligned',
      label: crossRequired ? 'cross-engine confirmation aligned' : 'cross-engine confirmation not required',
      failReason: 'cross-engine confirmation が aligned ではありません',
    },
  ];
  const ready = checks.every((check) => check.ok);
  return {
    status: ready ? 'actionable' : 'research-only',
    label: ready ? ACTIONABLE_LABEL : RESEARCH_ONLY_LABEL,
    isActionable: ready,
    tradeReadiness: tradeReadiness || 'unknown',
    decisionAuditVerdict: auditVerdict || 'UNKNOWN',
    actionableSize: checks.find((check) => check.id === 'actionableSize')?.ok || false,
    crossEngine: {
      required: crossRequired,
      status: crossStatus || (crossRequired ? 'unknown' : 'not_required'),
      aligned: !crossRequired || crossStatus === 'aligned',
    },
    checks,
    researchOnlyReasons: checks.filter((check) => !check.ok).map((check) => check.failReason),
  };
}

function buildCandidateThesis(candidate = {}) {
  const ticker = candidate.ticker || candidate.symbol || candidate.code || '';
  const name = candidate.name || candidate.companyName || '';
  const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
  const riskFactors = Array.isArray(candidate.riskFactors) ? candidate.riskFactors : [];
  const priceLines = candidate.priceLines || {};
  return {
    ticker,
    name,
    bullishReasons: [
      candidate.candidateReason,
      candidate.trendDirection ? `トレンド確認: ${candidate.trendDirection}` : '',
      candidate.preopenStatus ? `寄り付き前確認: ${candidate.preopenStatus}` : '',
      ...reasons,
    ].filter(Boolean).slice(0, 5),
    bearishReasons: [
      candidate.skipReason,
      candidate.spreadRisk?.notice,
      candidate.volumeSeasonality?.notice,
      ...riskFactors,
    ].filter(Boolean).slice(0, 5),
    entryConditions: [
      priceLines.orderLimit?.value ? `上限目安 ${Math.round(priceLines.orderLimit.value).toLocaleString('ja-JP')}円以下を確認` : '',
      candidate.morningConditions?.[0],
      '一次情報と手入力価格を確認できること',
    ].filter(Boolean).slice(0, 4),
    invalidationConditions: [
      priceLines.invalidLine?.value ? `無効化目安 ${Math.round(priceLines.invalidLine.value).toLocaleString('ja-JP')}円` : '',
      candidate.skipConditions?.[0],
      '検証ゲート未達またはデータ不足の場合は調査のみ',
    ].filter(Boolean).slice(0, 4),
    riskRewardComment: candidate.riskRewardComment || 'リスク/リワードは手動判断前の確認材料です。断定的な判断には使いません。',
  };
}

function mergeCandidates({ stocks = [], nightRows = [], daytradeSignals = [] }) {
  const byTicker = new Map();
  [...stocks, ...nightRows, ...daytradeSignals].forEach((candidate) => {
    const normalized = normalizeTicker(candidate?.ticker || candidate?.symbol || candidate?.code);
    if (!normalized) return;
    byTicker.set(normalized, {
      ...(byTicker.get(normalized) || {}),
      ...candidate,
      ticker: candidate.ticker || candidate.symbol || candidate.code,
    });
  });
  return Array.from(byTicker.values()).slice(0, 8);
}

function buildAlertOnlyMode(alertReport = {}) {
  const alerts = Array.isArray(alertReport.alerts) ? alertReport.alerts : [];
  const status = alertReport.status || (alerts.length ? 'READY' : 'NO_ACTION');
  const sendAllowed = alerts.length > 0 && status !== 'NO_ACTION';
  return {
    status,
    alertCount: alerts.length,
    sendAllowed,
    mode: 'alert-only',
    notice: sendAllowed
      ? '条件到達は通知対象です。外部注文や自動実行は行いません。'
      : 'alerts=0 または status=NO_ACTION のため送信/実行しません。',
  };
}

function buildWeeklyReview(reviewInsights = {}) {
  const cautions = Array.isArray(reviewInsights.cautions) ? reviewInsights.cautions : [];
  const hints = Array.isArray(reviewInsights.improvementHints) ? reviewInsights.improvementHints : [];
  return {
    reviewedCount: positiveNumber(reviewInsights.reviewCount ?? reviewInsights.count),
    cautions: cautions.slice(0, 5),
    improvements: (hints.length ? hints : ['検証ゲート未達の理由を週次で確認し、次週の調査条件を絞り込みます。']).slice(0, 5),
    purpose: '次週の調査改善に使うレビューです。売買指示ではありません。',
  };
}

export function buildZenLoopDeskPayload({
  stocks = [],
  nightRows = [],
  daytradeSignals = [],
  alertReport = {},
  reviewInsights = {},
  marketPhase = {},
  fetchedAt = '',
} = {}) {
  const candidates = mergeCandidates({ stocks, nightRows, daytradeSignals }).map((candidate) => {
    const gate = buildVerificationGate(candidate);
    return {
      ticker: candidate.ticker || candidate.symbol || candidate.code || '',
      name: candidate.name || candidate.companyName || '',
      mode: gate.status,
      gate,
      thesis: buildCandidateThesis(candidate),
      source: candidate.source || candidate.dataSource || 'local-ui-json',
    };
  });
  const actionableCandidates = candidates.filter((candidate) => candidate.gate.isActionable);
  const researchOnlyCandidates = candidates.filter((candidate) => !candidate.gate.isActionable);
  const alertOnly = buildAlertOnlyMode(alertReport);
  const marketPhaseLabel = marketPhase.label || marketPhase.phase || marketPhase.status || '取得不可';
  return {
    sourceOfTruth: 'zen-loop-desk-json',
    generatedAt: new Date().toISOString(),
    fetchedAt,
    manualDecisionSupportOnly: true,
    marketBrief: {
      marketPhase: marketPhaseLabel,
      majorRisks: [
        actionableCandidates.length ? '' : '検証済み候補がないため、候補を無理に作りません。',
        researchOnlyCandidates.length ? '調査のみの候補は根拠確認に限定します。' : '',
        alertOnly.sendAllowed ? '' : '通知対象はありません。',
      ].filter(Boolean),
      candidates: candidates.map((candidate) => ({
        ticker: candidate.ticker,
        name: candidate.name,
        mode: candidate.mode,
        gateReasons: candidate.gate.researchOnlyReasons,
      })),
      skipReasons: researchOnlyCandidates.flatMap((candidate) => (
        candidate.gate.researchOnlyReasons.map((reason) => `${candidate.ticker}: ${reason}`)
      )).slice(0, 8),
      doNotDoToday: [
        'verification gate 未達の候補を実行対象として扱わない',
        'cache / synthetic / fallback のみで短絡判断しない',
        '手入力価格と一次情報を確認できない場合は待機する',
      ],
    },
    candidates,
    alertOnly,
    weeklyReview: buildWeeklyReview(reviewInsights),
    verificationPolicy: {
      required: [
        'tradeReadiness == ready',
        'decisionAudit.verdict == PASS',
        'actionable size あり',
        'cross-engine confirmation が必要な場合は aligned',
      ],
      boundary: '条件未達は research-only として表示します。',
    },
  };
}
