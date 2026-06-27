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
