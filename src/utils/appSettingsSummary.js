import { getTdnetSourceStatus } from './tdnetSourceStatus';

const SAMPLE_LINKS = [
  { label: '操作マニュアル', path: 'docs/user-manual.md' },
  { label: 'ウォッチリスト正常サンプル', path: 'docs/samples/watchlist-sample.csv' },
  { label: 'ウォッチリスト不正行サンプル', path: 'docs/samples/watchlist-sample-invalid.csv' },
  { label: '手動決算予定JSON', path: 'docs/samples/manual-earnings-calendar-sample.json' },
  { label: '手動TDnet相当JSON', path: 'docs/samples/manual-tdnet-events-sample.json' },
  { label: 'リリース前チェックリスト', path: 'docs/release-checklist.md' },
];

const QUICK_START_STEPS = [
  '操作マニュアルを確認する',
  'サンプルCSVを取り込む',
  'ウォッチリスト一括チェックを確認する',
  '重要材料サマリーを見る',
  'ChatGPT相談用プロンプトをコピーする',
];

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function statusValue(input = {}) {
  return safeText(input.status || input.source || input.label || input.state || input.configured);
}

export function normalizeReadinessStatus(input = {}) {
  const raw = statusValue(input).toLowerCase();
  if (input.configured === true || ['success', 'configured', 'ready', '実取得済み', '設定済み'].includes(raw)) return '設定済み';
  if (['api_key_missing', 'missing', 'not_configured', '未設定', 'false'].includes(raw) || input.configured === false) return '未設定';
  if (['auth_failed', '認証失敗'].includes(raw)) return '認証失敗';
  if (['fetch_failed', 'error', '取得失敗'].includes(raw)) return '取得失敗';
  if (['no_data', 'データなし'].includes(raw)) return 'データなし';
  if (['cache_used', 'cache', 'キャッシュ利用'].includes(raw)) return 'キャッシュ利用';
  if (['manual_data', 'manual', '手動データ'].includes(raw)) return '手動データ';
  if (raw.includes('未取得')) return '未取得';
  if (raw.includes('照合不可')) return '照合不可';
  if (raw.includes('未実装')) return '未実装';
  return 'データ未取得';
}

function toneForStatus(status) {
  if (['設定済み', '実取得済み', '2026年分あり'].includes(status)) return 'good';
  if (['手動データ', 'キャッシュ利用', '一部あり'].includes(status)) return 'warn';
  if (['認証失敗', '取得失敗'].includes(status)) return 'danger';
  return 'neutral';
}

export function summarizeApiConfigurationStatus(context = {}) {
  const tdnetStatus = context.tdnetStatus || getTdnetSourceStatus();
  const items = [
    { name: 'EDINET', status: normalizeReadinessStatus(context.edinetStatus || context.edinetDisclosure || {}) },
    { name: 'J-Quants', status: normalizeReadinessStatus(context.earningsStatus || context.jquantsStatus || context.jquantsView || {}) },
    { name: 'TDnet相当データ', status: normalizeReadinessStatus(tdnetStatus) === '未設定' ? '未取得' : normalizeReadinessStatus(tdnetStatus) },
  ];
  return items.map((item) => ({ ...item, tone: toneForStatus(item.status) }));
}

function holidayYearLabels(years = []) {
  const normalized = years.map(String).filter(Boolean).sort();
  if (!normalized.length) return '祝日データ未設定';
  return `${normalized.join('・')}年分あり`;
}

function resolveHolidayYears(context = {}) {
  if (Array.isArray(context.holidayYears)) return context.holidayYears;
  return ['2026'];
}

function hasManualEarnings(context = {}) {
  if (typeof context.manualData?.earnings === 'boolean') return context.manualData.earnings;
  return false;
}

function hasManualTdnet(context = {}) {
  if (typeof context.manualData?.tdnet === 'boolean') return context.manualData.tdnet;
  return false;
}

export function summarizeDataSourceReadiness(context = {}) {
  const years = resolveHolidayYears(context);
  const manualEarnings = hasManualEarnings(context);
  const manualTdnet = hasManualTdnet(context);
  const manualStatus = manualEarnings && manualTdnet ? '手動データ' : manualEarnings || manualTdnet ? '一部あり' : 'データなし';
  const cacheStatus = context.cacheStatus?.enabled || context.cached ? 'キャッシュ利用' : 'データ未取得';
  const items = [
    { name: '日本祝日データ', status: holidayYearLabels(years) },
    { name: '手動データ', status: manualStatus },
    { name: 'キャッシュ', status: cacheStatus },
    { name: 'ChatGPT連携', status: 'コピー用プロンプトのみ' },
    { name: '実注文', status: '未対応' },
    { name: '証券会社API', status: '未接続' },
  ];
  return items.map((item) => ({ ...item, tone: toneForStatus(item.status) }));
}

export function buildAppSettingsSummary(context = {}) {
  const apiItems = summarizeApiConfigurationStatus(context);
  const dataItems = summarizeDataSourceReadiness(context);
  return {
    title: 'データ設定',
    description: 'APIキーは画面に表示せず、取得状態だけを確認できます。',
    apiItems,
    dataItems,
    guardrails: [
      'ChatGPT APIへ送信しません。コピー用テキストを作成するだけです。',
      '実注文機能はありません。',
      '証券会社APIには接続しません。',
      'TDnet相当データは未取得で、規約リスクのあるスクレイピングは行いません。',
    ],
    quickStartSteps: QUICK_START_STEPS,
    sampleLinks: SAMPLE_LINKS,
  };
}
