const CODE_KEYS = ['code', 'symbol', 'stockCode', 'ticker', '銘柄コード'];
const NAME_KEYS = ['name', 'companyName', 'company', '銘柄名', '会社名'];

function safeText(value) {
  return String(value ?? '').trim();
}

function splitCsvLine(line = '') {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, '').trim());
}

function pick(row = {}, keys = []) {
  for (const key of keys) {
    if (safeText(row[key])) return safeText(row[key]);
  }
  return '';
}

export function normalizeWatchlistCode(value) {
  const raw = safeText(value).replace(/\.T$/i, '');
  if (/^\d{4}$/.test(raw)) return raw;
  return '';
}

export function parseWatchlistCsv(text = '') {
  const rows = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!rows.length) return [];
  const firstCells = splitCsvLine(rows[0]);
  const hasHeader = firstCells.some((cell) => [...CODE_KEYS, ...NAME_KEYS, 'market', 'sector', 'memo'].includes(cell));
  const headers = hasHeader ? firstCells : ['code', 'name', 'market', 'sector', 'memo'];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows.map((line, index) => {
    const cells = splitCsvLine(line);
    return {
      lineNumber: (hasHeader ? 2 : 1) + index,
      raw: line,
      values: headers.reduce((acc, header, cellIndex) => {
        acc[header] = safeText(cells[cellIndex]);
        return acc;
      }, {}),
    };
  });
}

export function normalizeWatchlistImportRow(row = {}) {
  const values = row.values || row;
  const code = normalizeWatchlistCode(pick(values, CODE_KEYS));
  const ticker = code ? `${code}.T` : '';
  return {
    ticker,
    stockCode: code,
    name: pick(values, NAME_KEYS) || (ticker ? ticker : ''),
    companyName: pick(values, NAME_KEYS) || (ticker ? ticker : ''),
    market: safeText(values.market || values.市場),
    sector: safeText(values.sector || values.industry || values.業種),
    memo: safeText(values.memo || values.note || values.メモ),
    source: 'csv-import',
    dataQuality: { source: 'manual-import', score: 45 },
    candidateScore: 50,
    candidateReason: 'CSVインポートで追加された監視銘柄です。一次情報確認の対象として扱います。',
    price: Number(values.price || values.currentPrice || 0) || 0,
    importLineNumber: row.lineNumber,
  };
}

export function validateWatchlistImportRow(row = {}) {
  const normalized = normalizeWatchlistImportRow(row);
  const reasons = [];
  if (!normalized.ticker) reasons.push('4桁の銘柄コードを確認できません');
  return {
    ok: reasons.length === 0,
    reasons,
    item: normalized,
    lineNumber: row.lineNumber,
    raw: row.raw || '',
  };
}

export function dedupeWatchlistItems(items = []) {
  const byTicker = new Map();
  const duplicates = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const ticker = normalizeWatchlistImportRow(item).ticker || item.ticker;
    if (!ticker) return;
    const normalized = { ...normalizeWatchlistImportRow(item), ...item, ticker };
    if (byTicker.has(ticker)) {
      duplicates.push(normalized);
      const current = byTicker.get(ticker);
      byTicker.set(ticker, {
        ...current,
        ...normalized,
        name: current.name || normalized.name,
        companyName: current.companyName || normalized.companyName,
        memo: [current.memo, normalized.memo].filter(Boolean).join(' / '),
      });
    } else {
      byTicker.set(ticker, normalized);
    }
  });
  return { items: [...byTicker.values()], duplicates };
}

export function mergeWatchlistItems(existingItems = [], importedItems = []) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const imported = Array.isArray(importedItems) ? importedItems : [];
  const existingTickers = new Set(existing.map((item) => item.ticker).filter(Boolean));
  const duplicateItems = imported.filter((item) => existingTickers.has(item.ticker));
  const merged = dedupeWatchlistItems([...existing, ...imported]).items;
  return {
    items: merged,
    addedCount: imported.filter((item) => !existingTickers.has(item.ticker)).length,
    duplicateCount: duplicateItems.length,
    duplicateItems,
  };
}

export function buildImportPreview(text = '', existingItems = []) {
  const parsed = parseWatchlistCsv(text);
  const validations = parsed.map(validateWatchlistImportRow);
  const validItems = validations.filter((row) => row.ok).map((row) => row.item);
  const deduped = dedupeWatchlistItems(validItems);
  const existingTickers = new Set((Array.isArray(existingItems) ? existingItems : []).map((item) => item.ticker).filter(Boolean));
  const duplicates = deduped.items.filter((item) => existingTickers.has(item.ticker));
  const errors = validations
    .filter((row) => !row.ok)
    .map((row) => ({ lineNumber: row.lineNumber, raw: row.raw, reason: row.reasons.join(' / ') }));
  return {
    rows: parsed.length,
    validItems: deduped.items,
    validCount: deduped.items.length,
    skipCount: errors.length,
    duplicateCount: deduped.duplicates.length + duplicates.length,
    duplicates,
    errors,
    mergePreview: mergeWatchlistItems(existingItems, deduped.items),
  };
}
