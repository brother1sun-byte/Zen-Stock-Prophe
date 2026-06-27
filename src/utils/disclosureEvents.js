const EVENT_TYPES = [
  { type: '業績修正', keywords: ['業績予想の修正', '業績修正', '上方修正', '下方修正', '通期業績予想'] },
  { type: '配当修正', keywords: ['配当予想の修正', '配当修正', '増配', '減配', '無配'] },
  { type: '自社株買い', keywords: ['自己株式取得', '自己株式の取得', '自社株買い'] },
  { type: '決算短信', keywords: ['決算短信'] },
  { type: '決算発表', keywords: ['決算発表', '決算説明', '決算'] },
  { type: '大量保有報告', keywords: ['大量保有報告', '変更報告書'] },
  { type: '有価証券報告書', keywords: ['有価証券報告書'] },
  { type: '四半期報告書', keywords: ['四半期報告書'] },
  { type: '臨時報告書', keywords: ['臨時報告書'] },
  { type: 'その他重要開示', keywords: ['適時開示', '開示', '重要', 'TOB', '公開買付', '不正', '訂正', '調査'] },
];

const RISK_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
  unknown: '不明',
};

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeStockCode(code) {
  const text = String(code || '').trim().toUpperCase();
  const match = text.match(/\d{4}/);
  return match ? `${match[0]}.T` : text;
}

export function classifyEventType(event) {
  const haystack = `${event?.title || ''} ${event?.summary || ''} ${event?.kind || ''}`.toLowerCase();
  const matched = EVENT_TYPES.find((entry) => entry.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())));
  if (matched) return matched.type;
  if (!haystack.trim()) return 'データ取得不可';
  return 'その他重要開示';
}

function normalizeEvent(raw, fallbackSource = '出所未確認') {
  const title = compactText(raw?.title || raw?.name || raw?.headline || raw?.summary);
  if (!title) return null;
  const classification = raw?.classification || raw?.category || classifyEventType(raw);
  return {
    date: raw?.date || raw?.publishedAt || raw?.published_at || raw?.disclosedDate || raw?.disclosed_at || '-',
    classification,
    title,
    source: raw?.source || fallbackSource,
    url: raw?.url || raw?.link || '',
    summary: compactText(raw?.summary || raw?.note || raw?.description || title),
    tone: raw?.tone || 'unknown',
    kind: raw?.kind || '',
    cached: Boolean(raw?.cached || raw?.isCached || raw?.is_cached),
  };
}

function materialEventsFromDetail(stock) {
  const material = stock?.material || {};
  const items = [
    ...(material.items || []),
    ...((stock?.news?.items || []).map((item) => ({ ...item, kind: item.kind || 'news' }))),
  ];
  if (!items.length && material.summary) {
    items.push({
      title: material.summary,
      source: material.source || material.sources?.[0] || '材料サマリー',
      publishedAt: material.latestPublishedAt,
      kind: 'summary',
      tone: material.tone,
    });
  }
  return items.map((item) => normalizeEvent(item, item.source || '材料イベント')).filter(Boolean);
}

function jquantsEventsFromResearch(jquantsResearch, jquantsView) {
  const statement = jquantsResearch?.latestStatement || {};
  if (!statement.disclosedDate && !statement.disclosedTime && !statement.type) return [];
  const extras = [
    statement.earningsPerShare ? `EPS ${statement.earningsPerShare}` : null,
    statement.bookValuePerShare ? `BPS ${statement.bookValuePerShare}` : null,
    statement.forecastDividendPerShareAnnual ? `年間配当予想 ${statement.forecastDividendPerShareAnnual}` : null,
  ].filter(Boolean);
  return [normalizeEvent({
    date: statement.disclosedDate || statement.disclosedTime,
    title: `J-Quants財務・決算情報 ${statement.type || ''}`.trim(),
    source: jquantsView?.latestSource || 'J-Quants',
    summary: extras.length ? extras.join(' / ') : 'J-Quantsで財務・決算情報を確認できます。',
    kind: 'earnings',
    classification: '決算発表',
  }, 'J-Quants')].filter(Boolean);
}

export function classifyDisclosureRisk(events) {
  if (!events?.length) return 'unknown';
  if (events.some((event) => ['業績修正', '臨時報告書'].includes(event.classification))) return 'high';
  if (events.some((event) => ['配当修正', '決算短信', '大量保有報告', 'その他重要開示'].includes(event.classification))) return 'medium';
  return 'low';
}

export function getDisclosureSourceStatus(sources = {}) {
  const env = sources.env || {};
  const material = sources.stock?.material || {};
  const events = materialEventsFromDetail(sources.stock);
  const hasTdnet = events.some((event) => /tdnet/i.test(event.source));
  const hasEdinet = events.some((event) => /edinet/i.test(event.source) || ['大量保有報告', '有価証券報告書', '四半期報告書', '臨時報告書'].includes(event.classification));
  const jquantsConfigured = Boolean(sources.jquantsView?.configured && sources.jquantsView?.matchesSelection);
  const hasJquantsEvent = jquantsEventsFromResearch(sources.jquantsResearch, sources.jquantsView).length > 0;
  const cached = Boolean(sources.cached || material.cached || material.isCached || material.is_cached);

  return {
    edinet: {
      label: hasEdinet ? '取得済み' : env.EDINET_API_KEY || env.VITE_EDINET_API_KEY ? 'データなし' : 'API未設定',
      tone: hasEdinet ? 'good' : 'warn',
      detail: hasEdinet ? 'EDINET由来の提出書類を検出しました。' : 'EDINET APIキー未設定、または提出書類を取得していません。',
    },
    tdnet: {
      label: hasTdnet ? '取得済み' : events.length ? '該当なし' : 'データ未取得',
      tone: hasTdnet ? 'good' : events.length ? 'neutral' : 'warn',
      detail: hasTdnet ? 'TDnet相当の適時開示を検出しました。' : 'TDnetデータは取得できていないか、該当イベントがありません。',
    },
    jquants: {
      label: hasJquantsEvent ? '取得済み' : jquantsConfigured ? 'データなし' : '未取得',
      tone: hasJquantsEvent ? 'good' : 'warn',
      detail: hasJquantsEvent ? 'J-Quants財務・決算情報を確認できます。' : 'J-Quants未接続、または財務・決算情報がありません。',
    },
    cache: {
      label: cached ? 'キャッシュ利用' : '通常取得',
      tone: cached ? 'warn' : 'neutral',
      detail: cached ? '一時保存データを含む可能性があります。一次情報を確認してください。' : 'キャッシュ依存の表示ではありません。',
    },
  };
}

export function buildDisclosureEventSummary(stock, sources = {}) {
  const ticker = normalizeStockCode(stock?.ticker || sources?.ticker);
  const materialEvents = materialEventsFromDetail(stock);
  const jquantsEvents = jquantsEventsFromResearch(sources.jquantsResearch, sources.jquantsView);
  const manualEvents = (sources.manualEvents || sources.cachedEvents || []).map((event) => normalizeEvent(event, event.source || '手動データ')).filter(Boolean);
  const events = [...manualEvents, ...materialEvents, ...jquantsEvents].slice(0, 8);
  const risk = classifyDisclosureRisk(events);
  const sourceStatus = getDisclosureSourceStatus({ ...sources, stock });
  const hasHighOrMedium = risk === 'high' || risk === 'medium';
  const status = events.length
    ? hasHighOrMedium
      ? '確認推奨'
      : '目立つ材料なし'
    : 'データ未取得';

  return {
    ticker,
    status,
    risk,
    riskLabel: RISK_LABELS[risk],
    events,
    sourceStatus,
    caution: '本パネルは開示・決算材料の確認補助です。売買を推奨するものではありません。必ず一次情報をご確認ください。',
  };
}
