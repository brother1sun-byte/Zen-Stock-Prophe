export const PERSONAL_WORKSPACE_KEY = 'zen_personal_workspace_v1';

const EMPTY_WORKSPACE = Object.freeze({
  schemaVersion: 1,
  watchlistItems: [],
  todayTickers: [],
  manualData: { earnings: [], tdnet: [] },
  updatedAt: '',
});

function normalizeTicker(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (/^\d{4}$/.test(raw)) return `${raw}.T`;
  return /^\d{4}\.T$/.test(raw) ? raw : '';
}

function normalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 8);
}

export function normalizeWorkspaceItem(item = {}) {
  const ticker = normalizeTicker(item.ticker || item.stockCode);
  if (!ticker) return null;
  return { ...item, ticker, stockCode: ticker.replace('.T', ''), tags: normalizeTags(item.tags) };
}

export function loadPersonalWorkspace(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    const parsed = JSON.parse(storage?.getItem(PERSONAL_WORKSPACE_KEY) || 'null');
    if (!parsed || parsed.schemaVersion !== 1) return { ...EMPTY_WORKSPACE, manualData: { ...EMPTY_WORKSPACE.manualData } };
    return {
      ...EMPTY_WORKSPACE,
      ...parsed,
      watchlistItems: (Array.isArray(parsed.watchlistItems) ? parsed.watchlistItems : []).map(normalizeWorkspaceItem).filter(Boolean),
      todayTickers: (Array.isArray(parsed.todayTickers) ? parsed.todayTickers : []).map(normalizeTicker).filter(Boolean),
      manualData: {
        earnings: Array.isArray(parsed.manualData?.earnings) ? parsed.manualData.earnings : [],
        tdnet: Array.isArray(parsed.manualData?.tdnet) ? parsed.manualData.tdnet : [],
      },
    };
  } catch {
    return { ...EMPTY_WORKSPACE, manualData: { ...EMPTY_WORKSPACE.manualData } };
  }
}

export function savePersonalWorkspace(workspace = {}, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    if (!storage) return false;
    storage.setItem(PERSONAL_WORKSPACE_KEY, JSON.stringify({
      ...EMPTY_WORKSPACE,
      ...workspace,
      schemaVersion: 1,
      watchlistItems: (workspace.watchlistItems || []).map(normalizeWorkspaceItem).filter(Boolean),
      todayTickers: (workspace.todayTickers || []).map(normalizeTicker).filter(Boolean),
      manualData: {
        earnings: Array.isArray(workspace.manualData?.earnings) ? workspace.manualData.earnings : [],
        tdnet: Array.isArray(workspace.manualData?.tdnet) ? workspace.manualData.tdnet : [],
      },
      updatedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function mergeWorkspaceWatchlist(current = [], incoming = []) {
  const byTicker = new Map((current || []).map((item) => [normalizeTicker(item.ticker), normalizeWorkspaceItem(item)]));
  (incoming || []).forEach((item) => {
    const normalized = normalizeWorkspaceItem(item);
    if (!normalized) return;
    const existing = byTicker.get(normalized.ticker) || {};
    byTicker.set(normalized.ticker, { ...existing, ...normalized, tags: normalizeTags(normalized.tags?.length ? normalized.tags : existing.tags) });
  });
  return [...byTicker.values()].filter(Boolean);
}

export function filterAndSortWatchlist(items = [], { query = '', tag = '', sort = 'score-desc' } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();
  const filtered = (Array.isArray(items) ? items : []).filter((item) => {
    const matchesQuery = !normalizedQuery || `${item.ticker} ${item.name || item.companyName || ''}`.toLowerCase().includes(normalizedQuery);
    const matchesTag = !tag || normalizeTags(item.tags).includes(tag);
    return matchesQuery && matchesTag;
  });
  return [...filtered].sort((a, b) => {
    if (sort === 'ticker') return String(a.ticker).localeCompare(String(b.ticker), 'ja');
    if (sort === 'name') return String(a.name || a.companyName || '').localeCompare(String(b.name || b.companyName || ''), 'ja');
    return Number(b.candidateScore || b.preopenScore || 0) - Number(a.candidateScore || a.preopenScore || 0);
  });
}

export function parseManualDataText(text) {
  try {
    const parsed = JSON.parse(String(text || '[]'));
    if (!Array.isArray(parsed)) return { ok: false, items: [], message: 'JSON配列を入力してください。' };
    return { ok: true, items: parsed.filter((item) => item && typeof item === 'object'), message: `${parsed.length}件を確認しました。` };
  } catch {
    return { ok: false, items: [], message: 'JSON形式を確認してください。' };
  }
}

export function buildPersonalWorkspaceBackup(workspace = {}) {
  return {
    filename: `zen-personal-workspace-${new Date().toISOString().slice(0, 10)}.json`,
    text: JSON.stringify({ kind: 'zen-personal-workspace', exportedAt: new Date().toISOString(), workspace }, null, 2),
  };
}
