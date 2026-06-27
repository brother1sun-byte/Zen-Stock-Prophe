export const TDNET_UNAVAILABLE_STATUS = {
  label: 'TDnet相当データ未取得',
  tone: 'warn',
  detail: '規約リスクのあるスクレイピングは行いません。TDnet APIまたはJ-Quantsアドオン利用時に拡張可能です。',
  source: 'not_configured',
  isAvailable: false,
};

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function normalizeTdnetEvent(raw = {}) {
  const title = safeText(raw.title || raw.headline || raw.documentTitle);
  const date = safeText(raw.date || raw.disclosedAt || raw.publishedAt);
  if (!title && !date) return null;
  return {
    date,
    ticker: safeText(raw.ticker || raw.code || raw.stockCode),
    companyName: safeText(raw.companyName || raw.name),
    classification: safeText(raw.classification || raw.category, 'その他重要開示'),
    title: title || 'タイトル未取得',
    source: safeText(raw.source, '手動TDnet相当データ'),
    url: safeText(raw.url),
    summary: safeText(raw.summary, '手動またはキャッシュ由来のTDnet相当データです。一次情報をご確認ください。'),
  };
}

export function classifyTdnetEventRisk(event = {}) {
  const text = `${event.classification || ''} ${event.title || ''}`;
  if (/業績|配当|決算|公開買付|TOB|上場廃止|監理|特設|訂正/i.test(text)) return 'high';
  if (/適時開示|自己株|株式|人事|子会社|譲渡|取得/i.test(text)) return 'medium';
  return 'low';
}

export function buildTdnetUnavailableNotice() {
  return 'TDnet相当データは未取得です。TDnet APIまたはJ-Quantsアドオン利用時に拡張可能です。規約リスクのあるスクレイピングは行いません。適時開示の最終確認は一次情報をご確認ください。';
}

export function getTdnetSourceStatus(options = {}) {
  const manualEvents = (Array.isArray(options.manualEvents) ? options.manualEvents : [])
    .map(normalizeTdnetEvent)
    .filter(Boolean);
  if (manualEvents.length) {
    return {
      label: '手動TDnet相当データ',
      tone: 'warn',
      detail: '手動CSV/JSONまたはキャッシュ由来のTDnet相当データです。一次情報確認が必要です。',
      source: 'manual',
      isAvailable: true,
      events: manualEvents,
    };
  }
  if (options.addonEnabled) {
    return {
      label: 'TDnetアドオン未取得',
      tone: 'warn',
      detail: '有料アドオンの利用余地がありますが、この画面では実取得していません。',
      source: 'addon_not_fetched',
      isAvailable: false,
      events: [],
    };
  }
  return { ...TDNET_UNAVAILABLE_STATUS, events: [] };
}
