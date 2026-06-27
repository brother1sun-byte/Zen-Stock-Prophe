const VITE_ENV = import.meta.env || {};
const EXPLICIT_API_BASE = VITE_ENV.VITE_ZEN_API_BASE;
const API_PORT = VITE_ENV.VITE_ZEN_API_PORT || '8889';

export const CACHE_VERSION = 4;
export const CACHE_KEY = `zen-stock-prophet-pro-cache-v${CACHE_VERSION}`;
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

function normalizeApiBase(base) {
  return String(base || '').replace(/\/+$/, '');
}

function inferredBackendApiBase() {
  if (typeof window === 'undefined') return '/api';
  const { protocol, hostname } = window.location;
  if (protocol === 'file:') return `http://127.0.0.1:${API_PORT}/api`;
  if (!hostname || hostname.includes('trycloudflare.com') || hostname.includes('ngrok-free.app') || hostname.includes('loca.lt')) {
    return '/api';
  }
  return `${protocol}//${hostname}:${API_PORT}/api`;
}

const API_BASES = Array.from(new Set([
  EXPLICIT_API_BASE,
  '/api',
  inferredBackendApiBase(),
].filter(Boolean).map(normalizeApiBase)));

function normalizeResponse(data) {
  return Array.isArray(data?.value) ? data.value : data;
}

async function fetchApi(base, path, options, signal) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    signal,
  });
  if (!response.ok) {
    let detail = '';
    let parsedJson = false;
    try {
      const payload = await response.json();
      parsedJson = true;
      detail = payload?.detail ? `: ${payload.detail}` : '';
    } catch {
      detail = '';
    }
    const error = new Error(`HTTP ${response.status}${detail}`);
    error.status = response.status;
    error.base = base;
    error.parsedJson = parsedJson;
    throw error;
  }
  return normalizeResponse(await response.json());
}

export async function api(path, options = {}) {
  let lastError = null;
  for (const base of API_BASES) {
    const controller = new AbortController();
    const timerApi = typeof window !== 'undefined' ? window : globalThis;
    const timeoutMs = options.timeout ?? 6500;
    const timeout = timerApi.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchApi(base, path, options, controller.signal);
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`API応答が${Math.ceil(timeoutMs / 1000)}秒以内に完了しませんでした: ${path}`);
        timeoutError.name = 'ApiTimeoutError';
        timeoutError.path = path;
        timeoutError.timeoutMs = timeoutMs;
        throw timeoutError;
      }
      const likelyMissingSameOriginProxy = base === '/api' && [404, 405].includes(error.status) && !error.parsedJson;
      const likelyProxyFailure = base === '/api' && [502, 504].includes(error.status);
      const recoverableConnectionError = error.name === 'TypeError';
      if (!likelyMissingSameOriginProxy && !likelyProxyFailure && !recoverableConnectionError) {
        throw error;
      }
    } finally {
      timerApi.clearTimeout(timeout);
    }
  }
  const attempted = API_BASES.join(', ');
  throw new Error(`${lastError?.message || 'API connection failed'} (tried ${attempted})`);
}

export function readFreshCache() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!data || data.cacheVersion !== CACHE_VERSION) return null;
    if (!data.cachedAt || Date.now() - Number(data.cachedAt) > CACHE_MAX_AGE_MS) return null;
    return {
      ...data,
      isCached: true,
      is_cached: true,
      source: data.source || 'cache',
      dataSource: data.dataSource || 'cache',
    };
  } catch {
    return null;
  }
}

export function writeCache(payload) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ...payload,
      cacheVersion: CACHE_VERSION,
      cachedAt: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}
