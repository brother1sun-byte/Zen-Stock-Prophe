const FORBIDDEN_RESEARCH_TERMS = [
  '買い',
  '売り',
  '今すぐ買うべき',
  'エントリー推奨',
  '利確推奨',
  '損切り推奨',
  '急騰確定',
  '暴落確定',
  '上がる',
  '下がる',
  '儲かる',
  '勝てる',
  '投資妙味',
  '狙い目',
  '仕込み',
  '反発期待',
];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value, fallback = '未取得') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function sourceLabel(value, fallback = '未取得') {
  if (typeof value === 'string') return safeText(value, fallback);
  return safeText(value?.label || value?.status || value?.source || value?.detail, fallback);
}

function hasAny(text, fragments) {
  return fragments.some((fragment) => String(text || '').includes(fragment));
}

function normalizeSourceStatus(payload = {}) {
  const status = payload.sourceStatus || payload.preopenCheck?.sourceStatus || {};
  return {
    edinet: status.edinet || payload.edinetSourceStatus,
    earnings: status.earnings || status.jquants || payload.earningsSourceStatus,
    businessCalendar: status.businessCalendar || payload.businessCalendarSourceStatus,
    tdnet: status.tdnet || payload.tdnetSourceStatus || { label: '未取得', detail: 'TDnet相当データは未実装です。' },
    cache: status.cache || payload.cacheSourceStatus,
    watchlist: status.watchlist || payload.watchlistSourceStatus,
  };
}

function sourceStatusText(sourceStatus = {}) {
  return Object.values(sourceStatus)
    .map((status) => `${sourceLabel(status)} ${safeText(status?.detail, '')}`)
    .join(' ');
}

function sanitizeText(text) {
  return FORBIDDEN_RESEARCH_TERMS.reduce((current, term) => current.replaceAll(term, '根拠確認'), String(text ?? ''));
}

function sanitizeList(items = []) {
  return safeArray(items).map((item) => sanitizeText(item)).filter(Boolean);
}

function disclosureEvents(payload = {}) {
  return safeArray(payload.disclosureEvents || payload.preopenCheck?.edinetDocuments || payload.edinetDocuments);
}

function earningsEvents(payload = {}) {
  return safeArray(payload.earningsItems || payload.preopenCheck?.earnings || payload.earnings);
}

function unknownInputs(payload = {}) {
  return [
    ...safeArray(payload.unknownInputs),
    ...safeArray(payload.preopenCheck?.unknownInputs),
  ].filter(Boolean);
}

export function summarizeKeyMaterials(payload = {}) {
  const materials = [];
  const edinet = disclosureEvents(payload);
  const earnings = earningsEvents(payload);
  if (edinet.length) materials.push(`EDINET提出書類 ${edinet.length}件を確認対象に含めています。`);
  if (earnings.length) materials.push(`J-Quants決算予定 ${earnings.length}件を確認対象に含めています。`);
  const period = payload.businessWindow?.periodLabel || payload.preopenCheck?.periodLabel || payload.periodLabel;
  if (period) materials.push(`確認対象期間は ${period} です。`);
  const risk = payload.risk || payload.preopenCheck?.risk;
  if (risk === 'high') materials.push('重要材料ありとして一次情報確認が必要です。');
  if (risk === 'medium') materials.push('確認推奨として材料確認が必要です。');
  return sanitizeList(materials.length ? materials : ['目立つ材料は限定的です。']);
}

export function summarizePositiveMaterials(payload = {}) {
  const positives = [];
  const sourceStatus = normalizeSourceStatus(payload);
  if (hasAny(sourceLabel(sourceStatus.edinet), ['実取得済み', '取得済み', 'success'])) positives.push('EDINET提出書類の取得状態を確認済みです。');
  if (hasAny(sourceLabel(sourceStatus.earnings), ['実取得済み', 'J-Quants', '手動データ', 'キャッシュ'])) positives.push('決算予定データの取得状態を確認対象に含めています。');
  if (hasAny(sourceLabel(sourceStatus.businessCalendar), ['祝日データあり', '営業日', '平日'])) positives.push('日本営業日カレンダーを確認対象に含めています。');
  if (disclosureEvents(payload).length || earningsEvents(payload).length) positives.push('開示または決算予定の材料が整理されています。');
  return sanitizeList(positives.length ? positives : ['取得済み材料は限定的です。']);
}

export function summarizeNegativeMaterials(payload = {}) {
  const negatives = [];
  const sourceStatus = normalizeSourceStatus(payload);
  const statusText = sourceStatusText(sourceStatus);
  if (disclosureEvents(payload).some((event) => hasAny(event.classification || event.title, ['大量保有', '変更報告', '臨時報告', '公開買付']))) {
    negatives.push('重要性の高い可能性があるEDINET提出書類があります。');
  }
  if (earningsEvents(payload).length) negatives.push('決算発表予定があるため、発表予定日と時刻の確認が必要です。');
  if (hasAny(statusText, ['キャッシュ'])) negatives.push('一部データはキャッシュ利用です。');
  if (hasAny(statusText, ['手動データ'])) negatives.push('一部データは手動データです。');
  if (hasAny(statusText, ['未取得', '未設定', '取得失敗', '認証失敗'])) negatives.push('未取得または取得失敗のデータがあります。');
  return sanitizeList(negatives.length ? negatives : ['弱材料または注意材料は限定的です。']);
}

export function summarizeMissingInformation(payload = {}) {
  const missing = [...unknownInputs(payload)];
  const sourceStatus = normalizeSourceStatus(payload);
  const rows = [
    ['EDINET', sourceStatus.edinet],
    ['J-Quants決算予定', sourceStatus.earnings],
    ['日本営業日カレンダー', sourceStatus.businessCalendar],
    ['TDnet相当データ', sourceStatus.tdnet],
    ['キャッシュ', sourceStatus.cache],
  ];
  rows.forEach(([label, status]) => {
    const text = `${sourceLabel(status)} ${safeText(status?.detail, '')}`;
    if (hasAny(text, ['API未設定', '未設定', '未取得', '取得失敗', '認証失敗', '照合不可'])) {
      missing.push(`${label}: ${sourceLabel(status)}`);
    }
    if (hasAny(text, ['キャッシュ'])) missing.push(`${label}: キャッシュ利用`);
    if (hasAny(text, ['手動データ'])) missing.push(`${label}: 手動データ利用`);
    if (hasAny(text, ['簡易判定'])) missing.push(`${label}: 簡易判定`);
  });
  return sanitizeList([...new Set(missing)].length ? [...new Set(missing)] : ['明確な不足情報は限定的です。']);
}

export function buildEvidenceList(payload = {}) {
  const evidence = [];
  disclosureEvents(payload).forEach((event) => {
    evidence.push(`EDINET: ${safeText(event.classification || event.title, '提出書類')}が確認対象です。`);
  });
  earningsEvents(payload).forEach((event) => {
    evidence.push(`J-Quants: ${safeText(event.date)} ${safeText(event.fiscalPeriod)} の決算予定を確認対象に含めています。`);
  });
  const period = payload.businessWindow?.periodLabel || payload.preopenCheck?.periodLabel || payload.periodLabel;
  if (period) evidence.push(`営業日: ${period} を確認対象にしています。`);
  const sourceStatus = normalizeSourceStatus(payload);
  evidence.push(`データ状態: EDINET ${sourceLabel(sourceStatus.edinet)} / J-Quants ${sourceLabel(sourceStatus.earnings)} / 営業日 ${sourceLabel(sourceStatus.businessCalendar)} / TDnet相当 ${sourceLabel(sourceStatus.tdnet)}`);
  return sanitizeList(evidence);
}

export function calculateResearchConfidence(payload = {}) {
  let score = 90;
  const sourceStatus = normalizeSourceStatus(payload);
  const statusText = sourceStatusText(sourceStatus);
  const missing = summarizeMissingInformation(payload);
  if (hasAny(statusText, ['API未設定', '未設定'])) score -= 18;
  if (hasAny(statusText, ['取得失敗', '認証失敗'])) score -= 22;
  if (hasAny(statusText, ['未取得', 'データなし'])) score -= 12;
  if (hasAny(statusText, ['キャッシュ'])) score -= 8;
  if (hasAny(statusText, ['手動データ'])) score -= 10;
  if (hasAny(statusText, ['簡易判定', '祝日データ未設定'])) score -= 8;
  if (unknownInputs(payload).length) score -= Math.min(20, unknownInputs(payload).length * 5);
  if (missing.length > 3) score -= 8;
  if (!disclosureEvents(payload).length && !earningsEvents(payload).length) score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function classifyResearchAttentionLevel(payload = {}) {
  const risk = payload.risk || payload.preopenCheck?.risk;
  if (risk === 'high') return '高';
  if (risk === 'medium') return '中';
  if (risk === 'low') return '低';
  const confidence = calculateResearchConfidence(payload);
  if (confidence < 40) return '不明';
  if (disclosureEvents(payload).length || earningsEvents(payload).length) return '中';
  return confidence >= 70 ? '低' : '不明';
}

function conclusionFor(payload = {}) {
  const attention = classifyResearchAttentionLevel(payload);
  const confidence = calculateResearchConfidence(payload);
  if (attention === '高') return '重要材料あり';
  if (attention === '中') return '確認推奨';
  if (confidence < 45) return 'データ不足';
  if (attention === '低') return '目立つ材料なし';
  return '判断保留';
}

function reasonFor(payload = {}) {
  const keyMaterials = summarizeKeyMaterials(payload);
  const missing = summarizeMissingInformation(payload);
  if (keyMaterials.some((item) => !item.includes('限定的'))) return keyMaterials[0];
  if (missing.some((item) => !item.includes('限定的'))) return '未取得または確認不足のデータがあり、一次情報確認が必要です。';
  return '目立つ材料は限定的ですが、一次情報確認は必要です。';
}

export function buildSingleStockResearchInsight(payload = {}) {
  const sourceStatus = normalizeSourceStatus(payload);
  const insight = {
    ticker: safeText(payload.stock?.ticker || payload.ticker || payload.preopenCheck?.ticker, '銘柄未取得'),
    companyName: safeText(payload.stock?.name || payload.stock?.companyName || payload.companyName || payload.preopenCheck?.companyName, '会社名未取得'),
    conclusion: conclusionFor(payload),
    attentionLevel: classifyResearchAttentionLevel(payload),
    reason: reasonFor(payload),
    positiveMaterials: summarizePositiveMaterials(payload),
    negativeMaterials: summarizeNegativeMaterials(payload),
    cautions: summarizeNegativeMaterials(payload).filter((item) => !item.includes('限定的')),
    missingInformation: summarizeMissingInformation(payload),
    evidence: buildEvidenceList(payload),
    dataSources: [
      `EDINET: ${sourceLabel(sourceStatus.edinet)}`,
      `J-Quants: ${sourceLabel(sourceStatus.earnings)}`,
      `日本営業日: ${sourceLabel(sourceStatus.businessCalendar)}`,
      `TDnet相当: ${sourceLabel(sourceStatus.tdnet)}`,
      `キャッシュ: ${sourceLabel(sourceStatus.cache)}`,
    ],
    confidenceScore: calculateResearchConfidence(payload),
    confidenceLabel: '材料整理としてのデータ充足度',
    primaryInfoMessage: '本表示は投資判断ではありません。必ずEDINET、J-Quants、企業IRなどの一次情報をご確認ください。',
  };
  return JSON.parse(sanitizeText(JSON.stringify(insight)));
}

export function buildWatchlistResearchInsights(payload = {}) {
  const results = safeArray(payload.watchlistResults || payload.results);
  const itemInsights = results.map((item) => buildSingleStockResearchInsight({
    ...item,
    preopenCheck: item,
    sourceStatus: item.sourceStatus,
    disclosureEvents: item.edinetDocuments,
    earningsItems: item.earnings,
    businessWindow: payload.businessWindow,
  }));
  const high = itemInsights.filter((item) => item.attentionLevel === '高');
  const review = itemInsights.filter((item) => item.attentionLevel === '中');
  const missing = itemInsights.filter((item) => item.conclusion === 'データ不足' || item.attentionLevel === '不明');
  const averageConfidence = itemInsights.length
    ? Math.round(itemInsights.reduce((sum, item) => sum + item.confidenceScore, 0) / itemInsights.length)
    : 0;
  const globalMissing = [...new Set(itemInsights.flatMap((item) => item.missingInformation))];
  return {
    conclusion: high.length ? '重要材料あり' : review.length ? '確認推奨' : missing.length ? 'データ不足' : '目立つ材料なし',
    reason: high.length
      ? '重要材料ありの銘柄があるため、朝一で一次情報確認を優先してください。'
      : review.length
        ? '確認推奨の銘柄があるため、材料確認を行ってください。'
        : missing.length
          ? 'データ不足の銘柄があるため、取得状態の確認が必要です。'
          : '目立つ材料は限定的ですが、一次情報確認は継続してください。',
    confidenceScore: averageConfidence,
    confidenceLabel: '材料整理としてのデータ充足度',
    importantTickers: high,
    reviewTickers: review,
    missingTickers: missing,
    missingInformation: globalMissing.length ? sanitizeList(globalMissing) : ['明確な不足情報は限定的です。'],
    evidence: sanitizeList([
      `ウォッチリスト一括チェック: ${results.length}銘柄を確認対象にしています。`,
      `重要材料あり: ${high.length}件 / 確認推奨: ${review.length}件 / データ不足: ${missing.length}件`,
      `確認対象期間: ${safeText(payload.businessWindow?.periodLabel || results[0]?.periodLabel)}`,
    ]),
    dataSources: itemInsights[0]?.dataSources || [],
    items: itemInsights,
    primaryInfoMessage: '本表示は一次情報確認の優先順位を整理するためのものです。投資判断ではありません。',
  };
}

export { FORBIDDEN_RESEARCH_TERMS };
