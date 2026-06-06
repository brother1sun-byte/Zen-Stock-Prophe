const SOURCE_LABELS = {
  yfinance: 'yfinance取得',
  yahoo_chart: 'Yahooチャート取得',
  yahoo: 'Yahooチャート取得',
  stooq: 'Stooq取得',
  'j-quants delayed': 'J-Quants遅延データ',
  jquants_delayed: 'J-Quants遅延データ',
  synthetic: '補完データ',
  cache: '一時保存データ',
  unknown: '出所不明',
};

const SOURCE_WARNINGS = {
  synthetic: 'この価格は実際の市場データではなく、欠損時の補完データです。投資判断には使わないでください。',
  cache: 'この価格は一時保存されたデータです。最新の市場価格と異なる可能性があります。',
  jquants_delayed: 'この価格は遅延データです。リアルタイム価格ではありません。',
  unknown: 'データ出所を確認できません。参考値として扱ってください。',
};

function rawSource(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return payload.dataSource
    || payload.data_source
    || payload.priceSource
    || payload.price_source
    || payload.source
    || payload.provider
    || '';
}

export function normalizeDataSource(payload) {
  const source = rawSource(payload);
  const lower = String(source || '').toLowerCase();
  const synthetic = Boolean(
    payload?.synthetic
    || payload?.isSynthetic
    || payload?.is_synthetic
    || payload?.dataQuality?.synthetic
    || payload?.data_quality?.synthetic
    || lower.includes('synthetic')
  );
  const cached = Boolean(payload?.cache || payload?.isCached || payload?.is_cached || lower === 'cache' || lower.includes('cache'));
  const delayed = lower.includes('j-quants') || lower.includes('jquants') || lower.includes('delayed');
  if (synthetic) return 'synthetic';
  if (cached) return 'cache';
  if (delayed) return 'jquants_delayed';
  if (lower.includes('finance.yahoo.co.jp') || lower.includes('yahoo_chart') || lower.includes('yahoo chart')) return 'yahoo_chart';
  if (lower.includes('yfinance')) return 'yfinance';
  if (lower.includes('stooq')) return 'stooq';
  if (!lower || lower === 'unknown') return 'unknown';
  return lower;
}

export function dataSourceBadgeInfo(payload) {
  const key = normalizeDataSource(payload);
  return {
    key,
    label: SOURCE_LABELS[key] || rawSource(payload) || SOURCE_LABELS.unknown,
    warning: SOURCE_WARNINGS[key] || '',
    tone: key === 'synthetic' || key === 'unknown' ? 'danger' : key === 'cache' || key === 'jquants_delayed' ? 'warn' : 'normal',
  };
}
