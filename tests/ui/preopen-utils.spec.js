import { expect, test } from '@playwright/test';
import {
  buildBusinessDayStatus,
  buildMorningCheckWindow,
  getNextBusinessDay,
  getPreviousBusinessDay,
  isBusinessDay,
  isJapaneseHoliday,
  isWeekend,
} from '../../src/utils/japanBusinessCalendar';
import {
  buildPreopenCheckSummary,
  getEarningsCalendarSourceStatus,
  matchEarningsToStock,
  normalizeEarningsCalendarItem,
} from '../../src/utils/earningsCalendarClient';
import {
  buildPreopenCheckPromptPayload,
  buildWatchlistPreopenCheck,
  filterPreopenCheckResults,
  rankPreopenCheckResults,
  summarizeWatchlistPreopenCheck,
} from '../../src/utils/watchlistPreopenCheck';

test('日本営業日カレンダーは土日と平日を判定できる', () => {
  expect(isWeekend('2026-06-27')).toBe(true);
  expect(isBusinessDay('2026-06-27')).toBe(false);
  expect(isWeekend('2026-06-26')).toBe(false);
  expect(isBusinessDay('2026-06-26')).toBe(true);
});

test('祝日JSONに含まれる日付を休場日として判定できる', () => {
  expect(isJapaneseHoliday('2026-02-23')).toBe(true);
  const status = buildBusinessDayStatus('2026-02-23');
  expect(status.isBusinessDay).toBe(false);
  expect(status.reason).toBe('祝日');
});

test('前営業日と次営業日を土日と祝日を避けて返せる', () => {
  expect(getPreviousBusinessDay('2026-06-29')).toBe('2026-06-26');
  expect(getPreviousBusinessDay('2026-02-24')).toBe('2026-02-20');
  expect(getNextBusinessDay('2026-02-20')).toBe('2026-02-24');
});

test('buildMorningCheckWindow は前営業日引け後から当日朝までの対象期間を作る', () => {
  const window = buildMorningCheckWindow(new Date('2026-06-29T08:30:00+09:00'));
  expect(window.targetDate).toBe('2026-06-29');
  expect(window.previousBusinessDay).toBe('2026-06-26');
  expect(window.periodLabel).toContain('2026-06-26 15:00');
  expect(window.periodLabel).toContain('2026-06-29 09:00');
});

test('決算予定データを正規化し銘柄コードで紐づけできる', () => {
  const item = normalizeEarningsCalendarItem({
    code: '4980',
    companyName: 'デクセリアルズ',
    announcementDate: '2026-06-29',
    fiscalPeriod: '第1四半期',
    scheduledTime: '15:00',
    source: '手動データ',
  });
  expect(item.ticker).toBe('4980.T');
  expect(item.companyName).toBe('デクセリアルズ');
  expect(matchEarningsToStock('4980.T', [item, { code: '7203', date: '2026-06-29' }])).toHaveLength(1);
});

test('API未設定時の決算予定ステータスを安全に返す', () => {
  const status = getEarningsCalendarSourceStatus({ status: 'api_key_missing', items: [] });
  expect(status.label).toContain('J-Quants');
  expect(status.detail).toContain('未取得');
});

test('寄り付き前チェックは当日決算と重要EDINETを重要予定として扱う', () => {
  const businessWindow = buildMorningCheckWindow(new Date('2026-06-29T08:30:00+09:00'));
  const summary = buildPreopenCheckSummary({
    stock: { ticker: '4980.T' },
    businessWindow,
    earningsCalendar: {
      status: 'success',
      items: [{ code: '4980', companyName: 'デクセリアルズ', date: '2026-06-29', fiscalPeriod: '第1四半期', source: '手動データ' }],
      sourceStatus: { label: '手動データ', tone: 'warn', detail: '手動JSONの決算予定です。' },
    },
    disclosureSummary: { risk: 'high', edinetMeta: { status: 'success' } },
  });
  expect(summary.status).toBe('重要予定あり');
  expect(summary.risk).toBe('high');
  expect(summary.earnings).toHaveLength(1);
});

test('ウォッチリスト複数銘柄の寄り付き前チェック結果を作れる', () => {
  const businessWindow = buildMorningCheckWindow(new Date('2026-06-29T08:30:00+09:00'));
  const results = buildWatchlistPreopenCheck([
    { ticker: '4980.T', name: 'デクセリアルズ' },
    { ticker: '7203.T', name: 'トヨタ自動車' },
  ], {
    businessWindow,
    earningsCalendar: {
      status: 'success',
      items: [{ code: '4980', date: '2026-06-29', companyName: 'デクセリアルズ', fiscalPeriod: '第1四半期' }],
      sourceStatus: { label: '手動データ', tone: 'warn', detail: '手動JSONです。' },
    },
    edinetDisclosure: {
      status: 'success',
      documents: [{ secCode: '72030', docDescription: '大量保有報告書', submitDateTime: '2026-06-26 15:30', docID: 'S100A' }],
      morningCheck: businessWindow,
    },
  });
  expect(results).toHaveLength(2);
  expect(results.map((item) => item.ticker)).toEqual(['4980.T', '7203.T']);
  expect(results[0].status).toBe('重要予定あり');
  expect(results[1].hasEdinetDocuments).toBe(true);
});

test('注意度とステータス順で並び替えとフィルターができる', () => {
  const ranked = rankPreopenCheckResults([
    { ticker: '9000.T', status: '目立つ材料なし', risk: 'low' },
    { ticker: '7203.T', status: '確認推奨', risk: 'medium' },
    { ticker: '4980.T', status: '重要予定あり', risk: 'high' },
    { ticker: '6503.T', status: 'データ未取得', risk: 'unknown' },
  ]);
  expect(ranked.map((item) => item.ticker)).toEqual(['4980.T', '7203.T', '6503.T', '9000.T']);
  expect(filterPreopenCheckResults(ranked, 'important')).toHaveLength(1);
  expect(filterPreopenCheckResults(ranked, 'missing')[0].ticker).toBe('6503.T');
});

test('一括チェックのサマリーと相談用材料を生成できる', () => {
  const results = [
    { ticker: '4980.T', companyName: 'デクセリアルズ', status: '重要予定あり', risk: 'high', riskLabel: '高', periodLabel: '2026-06-26 15:00〜2026-06-29 09:00', edinetDocuments: [], earnings: [{ date: '2026-06-29', fiscalPeriod: '第1四半期', scheduledTime: '15:00', source: '手動データ' }], unknownInputs: [] },
    { ticker: '7203.T', companyName: 'トヨタ自動車', status: 'データ未取得', risk: 'unknown', riskLabel: '不明', periodLabel: '2026-06-26 15:00〜2026-06-29 09:00', edinetDocuments: [], earnings: [], unknownInputs: ['EDINET APIキー未設定'] },
  ];
  const summary = summarizeWatchlistPreopenCheck(results);
  expect(summary.total).toBe(2);
  expect(summary.important).toBe(1);
  expect(summary.missing).toBe(1);
  const payload = buildPreopenCheckPromptPayload(results);
  expect(payload.summary.total).toBe(2);
  expect(payload.items[0].ticker).toBe('4980.T');
  expect(payload.caution).toContain('投資助言ではなく');
});

test('1銘柄のチェック失敗で一括結果全体は落ちない', () => {
  const businessWindow = buildMorningCheckWindow(new Date('2026-06-29T08:30:00+09:00'));
  const badStock = {};
  Object.defineProperty(badStock, 'ticker', {
    get() {
      throw new Error('broken ticker');
    },
  });
  const results = buildWatchlistPreopenCheck([
    { ticker: '4980.T', name: 'デクセリアルズ' },
    badStock,
  ], { businessWindow });
  expect(results).toHaveLength(2);
  expect(results.some((item) => item.status === 'データ未取得')).toBe(true);
});
