const TICKER_NAME_LABELS = {
  '4151.T': '協和キリン',
  '4980.T': 'デクセリアルズ',
  '6501.T': '日立製作所',
  '6503.T': '三菱電機',
  '6758.T': 'ソニーグループ',
  '6857.T': 'アドバンテスト',
  '6920.T': 'レーザーテック',
  '7011.T': '三菱重工業',
  '7203.T': 'トヨタ自動車',
  '7974.T': '任天堂',
  '8035.T': '東京エレクトロン',
  '8306.T': '三菱UFJフィナンシャル・グループ',
};

const RAW_NAME_LABELS = {
  Advantest: 'アドバンテスト',
  'Dexerials Corporation': 'デクセリアルズ',
  Hitachi: '日立製作所',
  'Kyowa Kirin': '協和キリン',
  'Kyowa Kirin Co.,Ltd.': '協和キリン',
  Lasertec: 'レーザーテック',
  Nintendo: '任天堂',
  'Shin-Etsu Chemical': '信越化学工業',
  'Sony Group': 'ソニーグループ',
  'Tokyo Electron': '東京エレクトロン',
  Toyota: 'トヨタ自動車',
  'Toyota Motor': 'トヨタ自動車',
};

function normalizeTicker(value) {
  return String(value || '').trim().toUpperCase();
}

export function displayStockName(stockOrTicker, maybeName = '') {
  const stock = typeof stockOrTicker === 'object' && stockOrTicker !== null ? stockOrTicker : null;
  const ticker = normalizeTicker(stock?.ticker || stockOrTicker);
  const rawName = String(stock?.name || maybeName || '').trim();
  if (ticker && TICKER_NAME_LABELS[ticker]) return TICKER_NAME_LABELS[ticker];
  if (rawName && RAW_NAME_LABELS[rawName]) return RAW_NAME_LABELS[rawName];
  return rawName || ticker;
}

export function stockDisplayLabel(stockOrTicker, maybeName = '') {
  const stock = typeof stockOrTicker === 'object' && stockOrTicker !== null ? stockOrTicker : null;
  const ticker = normalizeTicker(stock?.ticker || stockOrTicker);
  const name = displayStockName(stock || ticker, maybeName || stock?.name);
  return ticker ? `${ticker} ${name}` : name;
}

export function localizeVisibleMarketText(value) {
  if (!value) return value;
  return String(value)
    .replace(/\bKyowa Kirin Co\.,Ltd\./g, '協和キリン')
    .replace(/\bKyowa Kirin\b/g, '協和キリン')
    .replace(/\bToyota Motor\b/g, 'トヨタ自動車')
    .replace(/\bToyota\b/g, 'トヨタ自動車')
    .replace(/\bDexerials Corporation\b/g, 'デクセリアルズ')
    .replace(/\bSony Group\b/g, 'ソニーグループ')
    .replace(/\bTokyo Electron\b/g, '東京エレクトロン')
    .replace(/\bAdvantest\b/g, 'アドバンテスト')
    .replace(/\bLasertec\b/g, 'レーザーテック')
    .replace(/\bHitachi\b/g, '日立製作所')
    .replace(/\bNintendo\b/g, '任天堂')
    .replace(/\bShin-Etsu Chemical\b/g, '信越化学工業')
    .replace(/\(TSE:(\d{4})\)/g, '（東証:$1）')
    .replace(/Valuation Check After Recent Mixed Share Price Performance/gi, '株価変動後のバリュエーション確認')
    .replace(/Recent Mixed Share Price Performance/gi, '直近の方向感が不安定な株価推移');
}
