import { expect, test } from '@playwright/test';
import { buildAfterCloseReviewExport } from '../../src/utils/afterCloseReviewExport';
import { loadAfterCloseReviewLog } from '../../src/utils/lifestyleDaytradeModes';

test('After Close Review export creates local JSON and CSV payloads', () => {
  const exportBundle = buildAfterCloseReviewExport([
    {
      ticker: '7203.T',
      companyName: 'トヨタ自動車',
      entryPrice: 3000,
      exitPrice: 3040,
      shares: 100,
      pnl: 4000,
      initialScore: 78,
      improvementMemo: 'VWAP確認を次回も使う',
      createdAt: '2026-07-02T15:00:00+09:00',
    },
  ], { now: new Date('2026-07-02T00:00:00+09:00') });

  expect(exportBundle.count).toBe(1);
  expect(exportBundle.jsonFilename).toBe('zen-after-close-reviews-2026-07-01.json');
  expect(exportBundle.csvFilename).toBe('zen-after-close-reviews-2026-07-01.csv');
  expect(exportBundle.json).toContain('7203.T');
  expect(exportBundle.csv).toContain('"トヨタ自動車"');
  expect(exportBundle.notice).toContain('外部API');
});

test('After Close Review export stays safe with empty or broken localStorage data', () => {
  const brokenStorage = {
    getItem() { return '{broken json'; },
    setItem() {},
  };

  expect(loadAfterCloseReviewLog(brokenStorage)).toEqual([]);
  const exportBundle = buildAfterCloseReviewExport(loadAfterCloseReviewLog(brokenStorage));
  expect(exportBundle.count).toBe(0);
  expect(exportBundle.csv.split('\n')[0]).toContain('ticker');
});
