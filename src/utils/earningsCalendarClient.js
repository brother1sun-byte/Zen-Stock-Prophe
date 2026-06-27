import { api } from '../api/apiClient';
import { normalizeSecurityCode, normalizeStockCode } from './disclosureEvents';

const FAILURE_STATUSES = new Set(['api_key_missing', 'auth_failed', 'fetch_failed']);
const FALLBACK_STATUSES = new Set(['manual_data', 'cache_used']);

function cleanText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

export function normalizeEarningsCalendarItem(raw = {}) {
  const stockCode = normalizeSecurityCode(
    raw.ticker
    || raw.code
    || raw.stockCode
    || raw.LocalCode
    || raw.Code,
  );
  const source = cleanText(raw.source || raw.Source, raw.status === 'cache_used' || raw.cached ? 'キャッシュ利用' : 'J-Quants');
  return {
    date: raw.date || raw.announcementDate || raw.scheduledDate || raw.DisclosedDate || raw.Date || raw.EarningsDate || '',
    ticker: stockCode ? `${stockCode}.T` : '',
    stockCode,
    companyName: cleanText(raw.companyName || raw.name || raw.CompanyName, '会社名未取得'),
    fiscalPeriod: cleanText(raw.fiscalPeriod || raw.period || raw.TypeOfCurrentPeriod || raw.FiscalPeriod, '未取得'),
    scheduledTime: cleanText(raw.scheduledTime || raw.time || raw.DisclosedTime || raw.ScheduledTime, '未定'),
    source,
    status: raw.status || raw.Status || 'success',
    cached: Boolean(raw.cached || raw.isCached || raw.is_cached || raw.status === 'cache_used'),
    url: raw.url || raw.link || raw.URL || '',
    summary: cleanText(raw.summary || raw.note, '決算発表予定を一次情報で確認してください。'),
  };
}

export function matchEarningsToStock(stockCode, earningsItems = []) {
  const target = normalizeSecurityCode(stockCode);
  if (!target || !Array.isArray(earningsItems)) return [];
  return earningsItems
    .map((item) => normalizeEarningsCalendarItem(item))
    .filter((item) => item.stockCode === target);
}

export function getEarningsCalendarSourceStatus(payload = {}) {
  const safePayload = payload || {};
  if (safePayload.sourceStatus) return safePayload.sourceStatus;
  const itemCount = Array.isArray(safePayload.items) ? safePayload.items.length : 0;
  const statusMap = {
    success: {
      label: 'J-Quants実取得済み',
      tone: 'good',
      detail: itemCount ? 'J-Quantsの決算発表予定日APIから取得しました。' : '決算予定データを取得しました。',
    },
    no_data: {
      label: 'データなし',
      tone: 'neutral',
      detail: '対象期間に決算発表予定は見つかりませんでした。',
    },
    manual_data: {
      label: '手動データ',
      tone: 'warn',
      detail: '手動JSONの決算予定を表示しています。一次情報を確認してください。',
    },
    cache_used: {
      label: 'キャッシュ利用',
      tone: 'warn',
      detail: '一時保存された決算予定を表示しています。最新情報と異なる可能性があります。',
    },
    api_key_missing: {
      label: 'J-Quants API未設定',
      tone: 'warn',
      detail: 'JQUANTS_API_KEY が未設定のため、決算予定データは未取得です。',
    },
    auth_failed: {
      label: '認証失敗',
      tone: 'danger',
      detail: 'J-Quants APIの認証に失敗しました。環境変数と契約プランを確認してください。',
    },
    fetch_failed: {
      label: '取得失敗',
      tone: 'warn',
      detail: '決算予定データを取得できませんでした。',
    },
  };
  const resolved = statusMap[safePayload.status] || statusMap.api_key_missing;
  return {
    ...resolved,
    detail: safePayload.message || resolved.detail,
    itemCount,
  };
}

export async function fetchEarningsCalendarByDateRange(startDate, endDate, options = {}) {
  try {
    const payload = await api(`/research/earnings-calendar?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`, {
      timeout: options.timeout || 12000,
    });
    return {
      ...payload,
      items: (payload.items || []).map((item) => normalizeEarningsCalendarItem(item)),
      sourceStatus: getEarningsCalendarSourceStatus(payload),
    };
  } catch (error) {
    return {
      status: 'fetch_failed',
      startDate,
      endDate,
      fetchedAt: new Date().toISOString(),
      items: [],
      sourceStatus: {
        label: '取得失敗',
        tone: 'warn',
        detail: `決算予定データを取得できませんでした。${error?.message || '通信エラー'}`,
      },
      message: '決算予定データは未取得です。',
    };
  }
}

export function fetchEarningsCalendarByDate(date, options = {}) {
  return fetchEarningsCalendarByDateRange(date, date, options);
}

function isNextBusinessDayEarnings(item, businessWindow) {
  return item.date && item.date === businessWindow?.nextBusinessDay;
}

export function buildPreopenCheckSummary({
  stock,
  businessWindow,
  earningsCalendar,
  disclosureSummary,
} = {}) {
  const ticker = normalizeStockCode(stock?.ticker || stock?.stockCode || '');
  const matchedEarnings = matchEarningsToStock(ticker, earningsCalendar?.items || []);
  const today = businessWindow?.targetDate || '';
  const hasTodayEarnings = matchedEarnings.some((item) => item.date === today);
  const hasNextBusinessDayEarnings = matchedEarnings.some((item) => isNextBusinessDayEarnings(item, businessWindow));
  const hasNearEarnings = matchedEarnings.length > 0;
  const disclosureRisk = disclosureSummary?.risk || 'unknown';
  const sourceStatus = getEarningsCalendarSourceStatus(earningsCalendar);
  const earningsStatus = earningsCalendar?.status || '';
  const unknownInputs = [
    !businessWindow?.businessDay?.holidayDataStatus?.configured ? '祝日データ未設定' : null,
    FAILURE_STATUSES.has(earningsStatus) ? '決算予定データ未取得' : null,
    disclosureSummary?.edinetMeta?.status === 'api_key_missing' ? 'EDINET APIキー未設定' : null,
  ].filter(Boolean);

  let risk = 'low';
  if (hasTodayEarnings || hasNextBusinessDayEarnings || disclosureRisk === 'high') risk = 'high';
  else if (hasNearEarnings || disclosureRisk === 'medium' || FALLBACK_STATUSES.has(earningsStatus)) risk = 'medium';
  else if (unknownInputs.length) risk = 'unknown';

  const status = risk === 'high'
    ? '重要予定あり'
    : risk === 'medium'
      ? '確認推奨'
      : risk === 'unknown'
        ? 'データ未取得'
        : '目立つ予定なし';

  return {
    ticker,
    status: businessWindow?.targetDate ? status : '営業日判定不可',
    risk,
    riskLabel: { high: '高', medium: '中', low: '低', unknown: '不明' }[risk] || '不明',
    businessWindow,
    earnings: matchedEarnings,
    earningsSourceStatus: sourceStatus,
    unknownInputs,
    caution: '本パネルは寄り付き前の開示・決算材料の確認補助です。売買を推奨するものではありません。必ず一次情報をご確認ください。',
  };
}
