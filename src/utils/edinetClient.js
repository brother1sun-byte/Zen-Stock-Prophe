import { api } from '../api/apiClient';

const EDINET_DOCUMENTS_ENDPOINT = 'https://disclosure.edinet-fsa.go.jp/api/v2/documents.json';
const MAX_RANGE_DAYS = 5;

function dateToYmd(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function datesBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < MAX_RANGE_DAYS) {
    days.push(dateToYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function normalizeSecCode(value) {
  const match = String(value || '').match(/\d{4}/);
  return match ? match[0] : '';
}

export function getEdinetApiKey(env = {}) {
  const testEnv = typeof globalThis !== 'undefined' ? globalThis.__ZEN_TEST_ENV__ || {} : {};
  const processEnv = typeof globalThis !== 'undefined' ? globalThis.process?.env || {} : {};
  return String(
    env.VITE_EDINET_API_KEY
      || env.EDINET_API_KEY
      || testEnv.VITE_EDINET_API_KEY
      || testEnv.EDINET_API_KEY
      || processEnv.VITE_EDINET_API_KEY
      || processEnv.EDINET_API_KEY
      || ''
  ).trim();
}

export function normalizeEdinetDocument(raw = {}) {
  const docID = raw.docID || raw.docId || raw.documentId || '';
  const title = raw.docDescription || raw.title || raw.documentType || '';
  return {
    docID,
    submitDateTime: raw.submitDateTime || raw.submitDate || raw.date || '',
    filerName: raw.filerName || raw.submitterName || raw.companyName || '',
    edinetCode: raw.edinetCode || raw.filerEdinetCode || '',
    secCode: normalizeSecCode(raw.secCode || raw.securityCode || raw.stockCode),
    docDescription: title,
    formCode: raw.formCode || '',
    ordinanceCode: raw.ordinanceCode || '',
    documentType: raw.documentType || title,
    source: 'EDINET',
    raw,
    url: docID ? `https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx?docID=${encodeURIComponent(docID)}` : '',
  };
}

function normalizeFetchResult(date, payload, fetchedAt) {
  const documents = Array.isArray(payload?.results)
    ? payload.results.map((item) => normalizeEdinetDocument(item)).filter((item) => item.docID || item.docDescription)
    : [];
  return {
    status: 'success',
    date,
    fetchedAt,
    documents,
    message: documents.length ? 'EDINET提出書類を取得しました。' : 'EDINET提出書類は見つかりませんでした。',
  };
}

export async function fetchEdinetDocumentsByDate(date, options = {}) {
  const apiKey = getEdinetApiKey(options.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const fetchedAt = new Date().toISOString();
  if (!apiKey) {
    return {
      status: 'api_key_missing',
      date,
      fetchedAt,
      documents: [],
      message: 'EDINET APIキー未設定です。',
    };
  }
  if (!fetchImpl) {
    return {
      status: 'fetch_failed',
      date,
      fetchedAt,
      documents: [],
      message: 'この環境ではEDINET APIを呼び出せません。',
    };
  }

  try {
    const url = `${EDINET_DOCUMENTS_ENDPOINT}?date=${encodeURIComponent(date)}&type=2`;
    const response = await fetchImpl(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
      },
    });
    if (!response.ok) {
      return {
        status: 'fetch_failed',
        date,
        fetchedAt,
        documents: [],
        message: `EDINET API取得に失敗しました。HTTP ${response.status}`,
      };
    }
    const payload = await response.json();
    return normalizeFetchResult(date, payload, fetchedAt);
  } catch (error) {
    return {
      status: 'fetch_failed',
      date,
      fetchedAt,
      documents: [],
      message: `EDINET API取得に失敗しました。${error?.message || '通信エラー'}`,
    };
  }
}

export async function fetchEdinetDocumentsByDateRange(startDate, endDate, options = {}) {
  if (!options.fetchImpl && !options.forceDirect) {
    try {
      return await api(`/research/edinet/documents?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`, {
        timeout: options.timeout || 15000,
      });
    } catch (error) {
      const apiKey = getEdinetApiKey(options.env);
      if (!apiKey) {
        return {
          status: 'api_key_missing',
          startDate,
          endDate,
          fetchedAt: new Date().toISOString(),
          documents: [],
          days: [],
          message: 'EDINET APIキー未設定です。',
        };
      }
      return {
        status: 'fetch_failed',
        startDate,
        endDate,
        fetchedAt: new Date().toISOString(),
        documents: [],
        days: [],
        message: `EDINET確認APIに接続できませんでした。${error?.message || '通信エラー'}`,
      };
    }
  }

  const dates = datesBetween(startDate, endDate);
  const fetchedAt = new Date().toISOString();
  if (!dates.length) {
    return {
      status: 'fetch_failed',
      startDate,
      endDate,
      fetchedAt,
      documents: [],
      days: [],
      message: 'EDINET取得対象期間を作成できませんでした。',
    };
  }

  const results = [];
  for (const date of dates) {
    // EDINET day requests are intentionally sequential to avoid quota spikes.
    results.push(await fetchEdinetDocumentsByDate(date, options));
  }

  const documents = results.flatMap((result) => result.documents || []);
  const failed = results.find((result) => result.status === 'fetch_failed');
  const missingKey = results.every((result) => result.status === 'api_key_missing');
  const status = missingKey ? 'api_key_missing' : failed ? 'fetch_failed' : 'success';
  const message = missingKey
    ? 'EDINET APIキー未設定です。'
    : failed
      ? failed.message
      : documents.length
        ? 'EDINET提出書類を取得しました。'
        : '対象期間に照合できるEDINET提出書類はありません。';

  return {
    status,
    startDate,
    endDate,
    fetchedAt,
    days: results,
    documents,
    message,
  };
}

export function buildEdinetClientDateRange(now = new Date()) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  if (Number.isNaN(current.getTime())) {
    const today = dateToYmd(new Date());
    return { startDate: today, endDate: today };
  }
  const end = new Date(current);
  const start = new Date(current);
  const day = current.getDay();
  start.setDate(current.getDate() - (day === 1 ? 3 : 1));
  return {
    startDate: dateToYmd(start),
    endDate: dateToYmd(end),
  };
}
