import { expect, test } from '@playwright/test';
import { buildAfterCloseReviewExport } from '../../src/utils/afterCloseReviewExport';
import { loadAfterCloseReviewLog } from '../../src/utils/lifestyleDaytradeModes';
import { filterReviewHistory, parseReviewBackup, summarizeReviewOutcomes } from '../../src/utils/reviewHistory';

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

test('After Close Review backup can be validated, searched, and compared before local restore', () => {
  const records = [
    { ticker: '7203.T', createdAt: '2026-07-02T15:00:00+09:00', decisionResult: 'verified candidate', pnl: 4000 },
    { ticker: '6758.T', createdAt: '2026-07-01T15:00:00+09:00', decisionResult: 'research-only', pnl: -1000 },
    { ticker: '9984.T', createdAt: '2026-06-30T15:00:00+09:00', decisionResult: '見送り', pnl: 0 },
  ];
  expect(parseReviewBackup(JSON.stringify(records))).toMatchObject({ ok: true, records });
  expect(parseReviewBackup('{broken')).toMatchObject({ ok: false, records: [] });
  expect(filterReviewHistory(records, { query: '7203', result: 'verified' })).toHaveLength(1);
  expect(summarizeReviewOutcomes(records)).toMatchObject({ total: 3, verified: 1, researchOnly: 1, skipped: 1 });
});

test('After Close Review UI exposes history search, comparison, and local restore', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('lifestyle-mode-review').click();
  await expect(page.getByTestId('after-close-review-history')).toBeVisible();
  await expect(page.getByTestId('after-close-review-history')).toContainText('履歴検索');
  await expect(page.getByTestId('after-close-review-history')).toContainText('結果比較');
  await page.getByText('JSON/CSVバックアップを復元').click();
  await expect(page.getByTestId('after-close-review-restore')).toBeVisible();
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
