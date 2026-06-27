import { buildDisclosureEventSummary, normalizeStockCode } from './disclosureEvents';
import { buildPreopenCheckSummary } from './earningsCalendarClient';

const RISK_ORDER = { high: 0, medium: 1, unknown: 2, low: 3 };
const STATUS_ORDER = {
  重要予定あり: 0,
  確認推奨: 1,
  データ未取得: 2,
  照合不可: 3,
  目立つ材料なし: 4,
};

function stockName(stock = {}) {
  try {
    return stock.name || stock.companyName || stock.displayName || stock.ticker || '会社名未取得';
  } catch {
    return '会社名未取得';
  }
}

function safeTicker(stock = {}) {
  try {
    return normalizeStockCode(stock?.ticker || stock?.stockCode || '');
  } catch {
    return '';
  }
}

function disclosureEvents(summary = {}) {
  return (summary.events || []).filter((event) => event.source === 'EDINET' || event.kind === 'edinet');
}

function sourceStatus(summary = {}, preopen = {}) {
  return {
    edinet: summary.sourceStatus?.edinet || { label: '未取得', tone: 'warn', detail: 'EDINET提出書類を確認できていません。' },
    tdnet: summary.sourceStatus?.tdnet || { label: '未取得', tone: 'warn', detail: 'TDnet相当データは未取得です。' },
    jquants: summary.sourceStatus?.jquants || { label: '未取得', tone: 'warn', detail: 'J-Quantsデータは未取得です。' },
    cache: summary.sourceStatus?.cache || { label: '通常取得', tone: 'neutral', detail: 'キャッシュ依存の表示ではありません。' },
    earnings: preopen.earningsSourceStatus || { label: '未取得', tone: 'warn', detail: '決算予定データは未取得です。' },
    businessCalendar: {
      label: preopen.businessWindow?.businessDay?.holidayDataStatus?.label || '営業日判定不可',
      tone: preopen.businessWindow?.businessDay?.holidayDataStatus?.configured ? 'neutral' : 'warn',
      detail: preopen.businessWindow?.businessDay?.holidayDataStatus?.detail || '営業日カレンダーを確認できません。',
    },
  };
}

function statusFromPreopen(stock, preopen) {
  if (!normalizeStockCode(stock?.ticker || stock?.stockCode || '')) return '照合不可';
  if (preopen.risk === 'high') return '重要予定あり';
  if (preopen.risk === 'medium') return '確認推奨';
  if (preopen.risk === 'unknown') return 'データ未取得';
  return '目立つ材料なし';
}

function buildOne(stock, context) {
  const ticker = normalizeStockCode(stock?.ticker || stock?.stockCode || '');
  const disclosureSummary = buildDisclosureEventSummary({ ...stock, ticker }, {
    jquantsResearch: context.jquantsResearch,
    jquantsView: context.jquantsView,
    cached: context.cached,
    env: context.env,
    edinetDisclosure: context.edinetDisclosure,
    morningCheck: context.businessWindow,
  });
  const preopen = buildPreopenCheckSummary({
    stock: { ...stock, ticker },
    businessWindow: context.businessWindow,
    earningsCalendar: context.earningsCalendar,
    disclosureSummary,
  });
  const edinetEvents = disclosureEvents(disclosureSummary);
  const status = statusFromPreopen({ ...stock, ticker }, preopen);
  return {
    ticker: ticker || '',
    companyName: stockName(stock),
    status,
    risk: status === '照合不可' ? 'unknown' : preopen.risk,
    riskLabel: status === '照合不可' ? '不明' : preopen.riskLabel,
    hasEdinetDocuments: edinetEvents.length > 0,
    edinetDocuments: edinetEvents,
    hasEarnings: preopen.earnings.length > 0,
    earnings: preopen.earnings,
    periodLabel: preopen.businessWindow?.periodLabel || '確認対象期間未設定',
    sourceStatus: sourceStatus(disclosureSummary, preopen),
    matchMethod: disclosureSummary.edinetMeta?.matchMethod || '照合不可',
    fetchedAt: context.fetchedAt || context.earningsCalendar?.fetchedAt || context.edinetDisclosure?.fetchedAt || '',
    unknownInputs: preopen.unknownInputs || [],
    caution: '本機能はウォッチリストの開示・決算材料を確認する補助です。売買を推奨するものではありません。必ず一次情報をご確認ください。',
  };
}

export function buildWatchlistPreopenCheck(watchlist = [], context = {}) {
  const items = Array.isArray(watchlist) ? watchlist : [];
  const results = items.map((stock) => {
    try {
      return buildOne(stock, context);
    } catch (error) {
      const ticker = safeTicker(stock);
      return {
        ticker,
        companyName: stockName(stock),
        status: 'データ未取得',
        risk: 'unknown',
        riskLabel: '不明',
        hasEdinetDocuments: false,
        edinetDocuments: [],
        hasEarnings: false,
        earnings: [],
        periodLabel: context.businessWindow?.periodLabel || '確認対象期間未設定',
        sourceStatus: sourceStatus({}, { businessWindow: context.businessWindow }),
        matchMethod: ticker ? '取得失敗' : '照合不可',
        unknownInputs: ['銘柄別チェック失敗'],
        error: error?.message || '銘柄別チェックで問題が発生しました。',
        caution: 'この銘柄はデータ未取得として扱います。一次情報をご確認ください。',
      };
    }
  });
  return rankPreopenCheckResults(results);
}

export function summarizeWatchlistPreopenCheck(results = []) {
  const safeResults = Array.isArray(results) ? results : [];
  return safeResults.reduce((summary, item) => {
    summary.total += 1;
    summary.checked += item.error ? 0 : 1;
    if (item.status === '重要予定あり') summary.important += 1;
    else if (item.status === '確認推奨') summary.review += 1;
    else if (item.status === '目立つ材料なし') summary.quiet += 1;
    else if (item.status === 'データ未取得' || item.status === '照合不可') summary.missing += 1;
    if (item.error) summary.errors += 1;
    return summary;
  }, {
    total: 0,
    checked: 0,
    important: 0,
    review: 0,
    quiet: 0,
    missing: 0,
    errors: 0,
  });
}

export function rankPreopenCheckResults(results = []) {
  return [...(Array.isArray(results) ? results : [])].sort((a, b) => {
    const riskDiff = (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9);
    if (riskDiff) return riskDiff;
    const statusDiff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (statusDiff) return statusDiff;
    return String(a.ticker || '').localeCompare(String(b.ticker || ''), 'ja');
  });
}

export function filterPreopenCheckResults(results = [], filter = 'all') {
  const safeResults = Array.isArray(results) ? results : [];
  if (filter === 'important') return safeResults.filter((item) => item.status === '重要予定あり');
  if (filter === 'review') return safeResults.filter((item) => item.status === '確認推奨');
  if (filter === 'missing') return safeResults.filter((item) => item.status === 'データ未取得' || item.status === '照合不可');
  if (filter === 'quiet') return safeResults.filter((item) => item.status === '目立つ材料なし');
  return safeResults;
}

export function buildPreopenCheckPromptPayload(results = []) {
  const ranked = rankPreopenCheckResults(results);
  return {
    purpose: 'ウォッチリスト全銘柄の寄り付き前材料確認',
    caution: '投資助言ではなく、一次情報確認のための材料です。',
    summary: summarizeWatchlistPreopenCheck(ranked),
    items: ranked.map((item) => ({
      ticker: item.ticker,
      companyName: item.companyName,
      status: item.status,
      risk: item.riskLabel,
      period: item.periodLabel,
      edinetDocuments: item.edinetDocuments.map((event) => ({
        date: event.date,
        classification: event.classification,
        title: event.title,
        source: event.source,
        url: event.url,
      })),
      earnings: item.earnings.map((event) => ({
        date: event.date,
        fiscalPeriod: event.fiscalPeriod,
        scheduledTime: event.scheduledTime,
        source: event.source,
        url: event.url,
      })),
      unknownInputs: item.unknownInputs,
    })),
  };
}
