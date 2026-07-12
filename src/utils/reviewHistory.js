import { AFTER_CLOSE_REVIEW_KEY } from './lifestyleDaytradeModes';

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function parseCsv(text) {
  const [headers = [], ...rows] = parseCsvRows(text.trim());
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function validRecords(records) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record === 'object' && /^\d{4}\.T$/.test(String(record.ticker || '').toUpperCase()))
    .map((record) => ({ ...record, ticker: String(record.ticker).toUpperCase() }))
    .slice(0, 200);
}

export function parseReviewBackup(text) {
  try {
    const trimmed = String(text || '').trim();
    const looksLikeJson = trimmed.startsWith('[') || trimmed.startsWith('{');
    const parsed = looksLikeJson ? JSON.parse(trimmed) : parseCsv(trimmed);
    const records = validRecords(parsed);
    if (!records.length && (Array.isArray(parsed) ? parsed.length : 0)) return { ok: false, records: [], message: '復元できる銘柄コードがありません。' };
    return { ok: true, records, message: `${records.length}件を復元できます。` };
  } catch {
    return { ok: false, records: [], message: 'JSONまたはCSV形式を確認してください。' };
  }
}

export function restoreReviewBackup(text, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  const parsed = parseReviewBackup(text);
  if (!parsed.ok || !storage?.setItem) return parsed;
  storage.setItem(AFTER_CLOSE_REVIEW_KEY, JSON.stringify(parsed.records));
  return { ...parsed, message: `${parsed.records.length}件をこの端末へ復元しました。外部送信はありません。` };
}

function resultBucket(record = {}) {
  const result = String(record.decisionResult || record.classification?.label || '').toLowerCase();
  if (result.includes('verified') || result.includes('検証済み')) return 'verified';
  if (result.includes('research') || result.includes('調査')) return 'research-only';
  if (result.includes('見送り') || result.includes('skip')) return 'skipped';
  return 'other';
}

export function filterReviewHistory(records = [], { query = '', result = 'all', date = '' } = {}) {
  const needle = String(query).trim().toLowerCase();
  return validRecords(records).filter((record) => {
    const matchesQuery = !needle || `${record.ticker} ${record.companyName || ''}`.toLowerCase().includes(needle);
    const matchesResult = result === 'all' || resultBucket(record) === result;
    const matchesDate = !date || String(record.createdAt || '').startsWith(date);
    return matchesQuery && matchesResult && matchesDate;
  });
}

export function summarizeReviewOutcomes(records = []) {
  const safe = validRecords(records);
  const summary = { total: safe.length, verified: 0, researchOnly: 0, skipped: 0, other: 0, positive: 0, negative: 0 };
  safe.forEach((record) => {
    const bucket = resultBucket(record);
    if (bucket === 'research-only') summary.researchOnly += 1;
    else summary[bucket] += 1;
    if (Number(record.pnl) > 0) summary.positive += 1;
    if (Number(record.pnl) < 0) summary.negative += 1;
  });
  return summary;
}
