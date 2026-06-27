import { buildPreopenCheckPromptPayload } from './watchlistPreopenCheck';
import {
  buildSingleStockResearchInsight,
  buildWatchlistResearchInsights,
} from './researchInsightBuilder';

const PROHIBITED_TERMS = [
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
];

function safeText(value, fallback = '未取得') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTicker(value) {
  const raw = safeText(value, '').replace(/\.T$/i, '');
  return raw ? `${raw}.T` : '銘柄コード未取得';
}

function yesNo(value) {
  return value ? 'あり' : 'なし';
}

function riskLabel(risk) {
  if (risk === 'high') return '高';
  if (risk === 'medium') return '中';
  if (risk === 'low') return '低';
  return '不明';
}

function statusLabel(item = {}) {
  if (!item?.ticker) return '照合不可';
  if (item.risk === 'high') return '重要予定あり';
  if (item.risk === 'medium') return '確認推奨';
  if (item.risk === 'low') return '目立つ材料なし';
  return 'データ未取得';
}

function sourceLabel(value, fallback = '未取得') {
  if (typeof value === 'string') return safeText(value, fallback);
  return safeText(value?.label || value?.status || value?.source || value?.detail, fallback);
}

function sourceDetail(value) {
  if (!value || typeof value === 'string') return '';
  return safeText(value.detail || value.message || value.reason, '');
}

function sourceStatusLines(sourceStatus = {}) {
  const status = sourceStatus || {};
  const rows = [
    ['EDINET', status.edinet],
    ['J-Quants決算予定', status.earnings || status.jquants],
    ['日本営業日カレンダー', status.businessCalendar],
    ['TDnet相当', status.tdnet],
    ['キャッシュ', status.cache],
  ];
  return rows.map(([label, value]) => {
    const detail = sourceDetail(value);
    return `- ${label}: ${sourceLabel(value)}${detail ? ` (${detail})` : ''}`;
  });
}

function sanitizePrompt(text) {
  return PROHIBITED_TERMS.reduce((current, term) => current.replaceAll(term, '確認'), text);
}

function bulletLines(items = [], fallback = '該当なし') {
  const rows = safeArray(items).filter(Boolean);
  if (!rows.length) return `- ${fallback}`;
  return rows.map((item) => {
    if (typeof item === 'string') return `- ${item}`;
    return `- ${safeText(item.ticker)} ${safeText(item.companyName)} / 結論: ${safeText(item.conclusion)} / データ充足度: ${safeText(item.confidenceScore)}%`;
  }).join('\n');
}

function formatResearchInsightForPrompt(insight = {}) {
  if (!insight || !Object.keys(insight).length) {
    return [
      '■重要材料サマリー',
      '- 材料整理: 未取得',
      '- データ充足度: 未取得',
    ].join('\n');
  }
  return [
    '■重要材料サマリー',
    `- 結論: ${safeText(insight.conclusion)}`,
    `- 理由: ${safeText(insight.reason)}`,
    `- 注意度: ${safeText(insight.attentionLevel || insight.attention)}`,
    `- データ充足度: ${safeText(insight.confidenceScore)}% (${safeText(insight.confidenceLabel, '材料整理としてのデータ充足度')})`,
    '',
    '■強材料',
    bulletLines(insight.positiveMaterials, '強材料は限定的です。'),
    '',
    '■弱材料・注意点',
    bulletLines(insight.negativeMaterials, '弱材料または注意材料は限定的です。'),
    '',
    '■不足情報',
    bulletLines(insight.missingInformation, '明確な不足情報は限定的です。'),
    '',
    '■根拠',
    bulletLines(insight.evidence, '根拠データは未取得です。'),
  ].join('\n');
}

function formatWatchlistInsightForPrompt(insights = {}) {
  if (!insights || !Object.keys(insights).length) return formatResearchInsightForPrompt({});
  const positiveMaterials = [...new Set(safeArray(insights.items).flatMap((item) => safeArray(item.positiveMaterials)))];
  const negativeMaterials = [...new Set(safeArray(insights.items).flatMap((item) => safeArray(item.negativeMaterials)))];
  return [
    '■重要材料サマリー',
    `- 結論: ${safeText(insights.conclusion)}`,
    `- 理由: ${safeText(insights.reason)}`,
    `- データ充足度: ${safeText(insights.confidenceScore)}% (${safeText(insights.confidenceLabel, '材料整理としてのデータ充足度')})`,
    '',
    '■強材料',
    bulletLines(positiveMaterials, '強材料は限定的です。'),
    '',
    '■弱材料・注意点',
    bulletLines(negativeMaterials, '弱材料または注意材料は限定的です。'),
    '',
    '■朝一で一次情報確認を優先する候補',
    bulletLines(insights.importantTickers, '重要材料ありの銘柄は表示されていません。'),
    '',
    '■確認推奨の銘柄',
    bulletLines(insights.reviewTickers, '確認推奨の銘柄は表示されていません。'),
    '',
    '■データ不足の銘柄',
    bulletLines(insights.missingTickers, 'データ不足の銘柄は表示されていません。'),
    '',
    '■不足情報',
    bulletLines(insights.missingInformation, '明確な不足情報は限定的です。'),
    '',
    '■根拠',
    bulletLines(insights.evidence, '根拠データは未取得です。'),
  ].join('\n');
}

export function formatDisclosureEventsForPrompt(events = []) {
  const rows = safeArray(events);
  if (!rows.length) return '- EDINET提出書類: 対象期間内の表示はありません。';
  return rows.map((event) => [
    `- ${safeText(event.date || event.submitDateTime)}`,
    safeText(event.classification || event.category || event.type, '分類未取得'),
    safeText(event.title || event.docDescription, 'タイトル未取得'),
    `ソース: ${safeText(event.source, 'EDINET')}`,
    event.url ? `URL: ${event.url}` : 'URL未取得',
  ].join(' / ')).join('\n');
}

export function formatEarningsCalendarForPrompt(items = []) {
  const rows = safeArray(items);
  if (!rows.length) return '- J-Quants決算予定: 対象期間内の表示はありません。';
  return rows.map((item) => [
    `- ${safeText(item.date)}`,
    `銘柄: ${normalizeTicker(item.ticker || item.code)}`,
    `会社名: ${safeText(item.companyName)}`,
    `決算期: ${safeText(item.fiscalPeriod)}`,
    `予定時刻: ${safeText(item.scheduledTime)}`,
    `ソース: ${safeText(item.source, 'J-Quants')}`,
    item.url ? `URL: ${item.url}` : 'URL未取得',
  ].join(' / ')).join('\n');
}

export function formatPreopenCheckForPrompt(check = {}) {
  if (!check) return '- 寄り付き前チェック: 未取得';
  const lines = [
    `- 総合ステータス: ${safeText(check.statusLabel || check.overallStatus || check.summaryStatus, statusLabel(check))}`,
    `- 注意度: ${safeText(check.riskLabel, riskLabel(check.risk))}`,
    `- 確認対象期間: ${safeText(check.periodLabel || check.businessWindow?.periodLabel)}`,
    `- EDINET提出書類: ${yesNo(check.hasEdinetDocuments || safeArray(check.edinetDocuments).length)}`,
    `- J-Quants決算予定: ${yesNo(check.hasEarnings || safeArray(check.earnings).length)}`,
  ];
  if (safeArray(check.unknownInputs).length) {
    lines.push(`- 不足情報: ${check.unknownInputs.join(' / ')}`);
  }
  return lines.join('\n');
}

export function formatWatchlistCheckForPrompt(results = []) {
  const rows = safeArray(results);
  if (!rows.length) return '- ウォッチリスト一括チェック: 対象銘柄がありません。';
  return rows.map((item) => [
    `- ${normalizeTicker(item.ticker)} ${safeText(item.companyName, '会社名未取得')}`,
    `ステータス: ${statusLabel(item)}`,
    `注意度: ${riskLabel(item.risk)}`,
    `EDINET: ${yesNo(item.hasEdinetDocuments || safeArray(item.edinetDocuments).length)}`,
    `J-Quants決算予定: ${yesNo(item.hasEarnings || safeArray(item.earnings).length)}`,
    `確認対象期間: ${safeText(item.periodLabel)}`,
  ].join(' / ')).join('\n');
}

export function buildPromptMissingDataNotice(sourceStatus = {}) {
  const lines = sourceStatusLines(sourceStatus);
  const joined = lines.join('\n');
  const hasNotice = /未設定|未取得|取得失敗|認証失敗|キャッシュ|手動データ|簡易判定/.test(joined);
  return [
    '■データ取得状況',
    joined || '- データ取得状況: 未取得',
    '',
    '■未取得データ',
    hasNotice
      ? '- API未設定、取得失敗、キャッシュ利用、手動データ利用、簡易判定が含まれる場合は、一次情報確認前の参考材料として扱ってください。'
      : '- 主要データは取得済み表示です。ただし一次情報確認は省略しないでください。',
  ].join('\n');
}

export function buildPromptDataSummary(payload = {}) {
  const watchlistResults = safeArray(payload.watchlistResults);
  const watchlistPayload = buildPreopenCheckPromptPayload(watchlistResults);
  const summary = payload.watchlistSummary || watchlistPayload.summary || {};
  return {
    ticker: normalizeTicker(payload.stock?.ticker || payload.stock?.stockCode || payload.selectedStock?.ticker),
    companyName: safeText(payload.stock?.name || payload.stock?.companyName || payload.selectedStock?.name || payload.selectedStock?.companyName, '会社名未取得'),
    market: safeText(payload.stock?.market || payload.stock?.sector || payload.selectedStock?.market || payload.selectedStock?.sector),
    price: safeText(payload.stock?.price || payload.selectedStock?.price),
    sourceStatus: payload.sourceStatus || payload.preopenCheck?.sourceStatus || {},
    disclosureEvents: safeArray(payload.disclosureEvents || payload.preopenCheck?.edinetDocuments),
    earningsItems: safeArray(payload.earningsItems || payload.preopenCheck?.earnings),
    preopenCheck: payload.preopenCheck || {},
    watchlistResults,
    watchlistSummary: summary,
    watchlistPromptPayload: watchlistPayload,
    businessWindow: payload.businessWindow || payload.preopenCheck?.businessWindow || {},
  };
}

export function buildSingleStockResearchPrompt(payload = {}) {
  const data = buildPromptDataSummary(payload);
  const researchInsight = payload.researchInsight || buildSingleStockResearchInsight({
    stock: payload.stock || payload.selectedStock,
    disclosureEvents: data.disclosureEvents,
    earningsItems: data.earningsItems,
    preopenCheck: data.preopenCheck,
    businessWindow: data.businessWindow,
    sourceStatus: data.sourceStatus,
  });
  const prompt = [
    '■目的',
    '選択中の銘柄について、調査前に確認すべき開示、決算予定、営業日上の注意点を整理します。',
    '',
    '■前提',
    'この文章はChatGPTへ貼り付ける相談材料です。ChatGPT APIへ直接送信していません。',
    '投資判断の推奨ではなく、一次情報確認、材料確認、リスク確認のために使います。',
    '',
    '■相談したいこと',
    '以下の材料をもとに、一次情報確認・材料確認・リスク確認の観点で整理してください。判断に不足している情報があれば、不足情報として明示してください。',
    '',
    '■対象銘柄',
    `- 銘柄コード: ${data.ticker}`,
    `- 会社名: ${data.companyName}`,
    `- 市場または業種: ${data.market}`,
    `- 参考価格: ${data.price}`,
    '',
    '■日本営業日・確認対象期間',
    `- ${safeText(data.businessWindow.periodLabel || data.preopenCheck.periodLabel)}`,
    '',
    '■EDINET提出書類',
    formatDisclosureEventsForPrompt(data.disclosureEvents),
    '',
    '■J-Quants決算予定',
    formatEarningsCalendarForPrompt(data.earningsItems),
    '',
    '■寄り付き前チェック結果',
    formatPreopenCheckForPrompt(data.preopenCheck),
    '',
    formatResearchInsightForPrompt(researchInsight),
    '',
    buildPromptMissingDataNotice(data.sourceStatus),
    '',
    '■注意点',
    '- データ未取得、API未設定、取得失敗、キャッシュ利用、手動データ利用がある場合は、その前提で確認してください。',
    '- 企業IR、EDINET、J-Quantsなどの一次情報確認を前提にしてください。',
    '',
    '■ChatGPTへの依頼内容',
    '材料確認、リスク確認、不足情報の洗い出しに限定して、日本語で整理してください。',
  ].join('\n');
  return sanitizePrompt(prompt);
}

export function buildWatchlistResearchPrompt(payload = {}) {
  const data = buildPromptDataSummary(payload);
  const summary = data.watchlistSummary || {};
  const highRows = data.watchlistResults.filter((item) => item.risk === 'high');
  const reviewRows = data.watchlistResults.filter((item) => item.risk === 'medium');
  const missingRows = data.watchlistResults.filter((item) => item.risk === 'unknown');
  const sourceStatus = payload.sourceStatus || {
    edinet: payload.edinetSourceStatus,
    earnings: payload.earningsSourceStatus,
    businessCalendar: payload.businessCalendarSourceStatus,
    cache: payload.cacheSourceStatus,
  };
  const researchInsights = payload.researchInsights || buildWatchlistResearchInsights({
    watchlistResults: data.watchlistResults,
    businessWindow: payload.businessWindow || data.businessWindow,
  });
  const prompt = [
    '■目的',
    'ウォッチリスト全体について、今日の寄り付き前に一次情報確認を優先すべき材料を整理します。',
    '',
    '■前提',
    'この文章はChatGPTへ貼り付ける相談材料です。ChatGPT APIへ直接送信していません。',
    '投資判断の推奨ではなく、一次情報確認、材料確認、リスク確認のために使います。',
    '',
    '■相談したいこと',
    '以下のウォッチリスト一括チェック結果をもとに、今日の寄り付き前に一次情報確認を優先すべき銘柄を、材料確認の観点で整理してください。',
    '',
    '■対象ウォッチリスト',
    `- 対象銘柄数: ${summary.total ?? data.watchlistResults.length}`,
    `- 確認済み銘柄数: ${summary.checked ?? 0}`,
    `- 重要予定あり件数: ${summary.important ?? highRows.length}`,
    `- 確認推奨件数: ${summary.review ?? reviewRows.length}`,
    `- データ未取得件数: ${summary.missing ?? missingRows.length}`,
    `- エラー件数: ${summary.errors ?? 0}`,
    '',
    '■日本営業日・確認対象期間',
    `- ${safeText(payload.businessWindow?.periodLabel || data.watchlistResults[0]?.periodLabel)}`,
    '',
    '■注意度 高 の銘柄一覧',
    formatWatchlistCheckForPrompt(highRows),
    '',
    '■確認推奨の銘柄一覧',
    formatWatchlistCheckForPrompt(reviewRows),
    '',
    '■データ未取得の銘柄一覧',
    formatWatchlistCheckForPrompt(missingRows),
    '',
    '■ウォッチリスト一括チェック結果',
    formatWatchlistCheckForPrompt(data.watchlistResults),
    '',
    formatWatchlistInsightForPrompt(researchInsights),
    '',
    buildPromptMissingDataNotice(sourceStatus),
    '',
    '■注意点',
    '- API未設定、取得失敗、キャッシュ利用、手動データ利用がある場合は、最新または完全な情報ではない可能性があります。',
    '- EDINET提出書類、J-Quants決算予定、企業IRなどの一次情報確認を前提にしてください。',
    '- この文章は投資助言ではなく、材料確認とリスク確認の相談材料です。',
    '',
    '■ChatGPTへの依頼内容',
    '重要予定あり、確認推奨、データ未取得を分けて、一次情報確認の優先順と不足情報を日本語で整理してください。',
  ].join('\n');
  return sanitizePrompt(prompt);
}

export { PROHIBITED_TERMS };
