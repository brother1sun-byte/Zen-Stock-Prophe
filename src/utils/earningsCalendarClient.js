import { api } from '../api/apiClient';
import { normalizeSecurityCode, normalizeStockCode } from './disclosureEvents';

function cleanText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

export function normalizeEarningsCalendarItem(raw = {}) {
  const stockCode = normalizeSecurityCode(raw.ticker || raw.code || raw.stockCode || raw.LocalCode);
  return {
    date: raw.date || raw.announcementDate || raw.scheduledDate || raw.DisclosedDate || '',
    ticker: stockCode ? `${stockCode}.T` : '',
    stockCode,
    companyName: cleanText(raw.companyName || raw.name || raw.CompanyName, '会社名未取得'),
    fiscalPeriod: cleanText(raw.fiscalPeriod || raw.period || raw.TypeOfCurrentPeriod, '未取得'),
    scheduledTime: cleanText(raw.scheduledTime || raw.time || raw.DisclosedTime, '未定'),
    source: cleanText(raw.source, '手動データ'),
    status: raw.status || 'manual',
    cached: Boolean(raw.cached || raw.isCached || raw.is_cached),
    url: raw.url || raw.link || '',
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
  if (safePayload.status === 'success') {
    return {
      label: safePayload.items?.length ? '取得済み' : 'データなし',
      tone: safePayload.items?.length ? 'good' : 'neutral',
      detail: safePayload.items?.length ? '決算予定データを取得しました。' : '対象期間に決算予定はありません。',
    };
  }
  if (safePayload.status === 'fetch_failed') {
    return {
      label: '取得失敗',
      tone: 'warn',
      detail: safePayload.message || '決算予定データを取得できませんでした。',
    };
  }
  return {
    label: 'J-Quants API未設定',
    tone: 'warn',
    detail: safePayload.message || '決算予定データは未取得です。',
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
  const hasNearEarnings = matchedEarnings.length > 0;
  const disclosureRisk = disclosureSummary?.risk || 'unknown';
  const sourceStatus = getEarningsCalendarSourceStatus(earningsCalendar);
  const unknownInputs = [
    !businessWindow?.businessDay?.holidayDataStatus?.configured ? '祝日データ未設定' : null,
    earningsCalendar?.status && earningsCalendar.status !== 'success' ? '決算予定データ未取得' : null,
    disclosureSummary?.edinetMeta?.status === 'api_key_missing' ? 'EDINET APIキー未設定' : null,
  ].filter(Boolean);

  let risk = 'low';
  if (hasTodayEarnings || disclosureRisk === 'high') risk = 'high';
  else if (hasNearEarnings || disclosureRisk === 'medium' || sourceStatus.label === '手動データ') risk = 'medium';
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
