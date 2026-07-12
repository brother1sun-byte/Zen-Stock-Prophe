import { expect, test } from '@playwright/test';
import {
  buildPersonalWorkspaceBackup,
  filterAndSortWatchlist,
  loadPersonalWorkspace,
  parseManualDataText,
  savePersonalWorkspace,
} from '../../src/utils/personalWorkspace';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('個人ワークスペースはウォッチリストと今日の確認を市場キャッシュから分離して保存する', () => {
  const storage = memoryStorage();
  const payload = {
    watchlistItems: [{ ticker: '7203.T', name: 'トヨタ', tags: ['大型株'] }],
    todayTickers: ['7203.T'],
    manualData: { earnings: [{ ticker: '7203.T', date: '2026-07-13' }], tdnet: [] },
  };
  expect(savePersonalWorkspace(payload, storage)).toBe(true);
  expect(loadPersonalWorkspace(storage)).toMatchObject(payload);
});

test('ウォッチリストはタグ・検索・並び順で絞り込める', () => {
  const items = [
    { ticker: '6758.T', name: 'ソニー', tags: ['大型株'], candidateScore: 62 },
    { ticker: '7203.T', name: 'トヨタ', tags: ['輸送'], candidateScore: 78 },
  ];
  expect(filterAndSortWatchlist(items, { query: '7203', sort: 'score-desc' }).map((item) => item.ticker)).toEqual(['7203.T']);
  expect(filterAndSortWatchlist(items, { tag: '大型株' }).map((item) => item.ticker)).toEqual(['6758.T']);
});

test('手動JSONは配列だけを受け入れ、壊れた入力を安全に拒否する', () => {
  expect(parseManualDataText('[{"ticker":"7203.T"}]')).toMatchObject({ ok: true, items: [{ ticker: '7203.T' }] });
  expect(parseManualDataText('{broken')).toMatchObject({ ok: false, items: [] });
  expect(parseManualDataText('{"ticker":"7203.T"}')).toMatchObject({ ok: false, items: [] });
});

test('個人設定バックアップは端末内JSONとして生成する', () => {
  const backup = buildPersonalWorkspaceBackup({ todayTickers: ['7203.T'] });
  expect(backup.filename).toMatch(/^zen-personal-workspace-\d{4}-\d{2}-\d{2}\.json$/);
  expect(JSON.parse(backup.text)).toMatchObject({ kind: 'zen-personal-workspace', workspace: { todayTickers: ['7203.T'] } });
});

test('日常利用パネルで今日の確認・手動データ・キャッシュ状態を操作できる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('daily-workspace-panel')).toBeVisible();
  await expect(page.getByTestId('daily-workspace-panel')).toContainText('今日確認する銘柄');
  await expect(page.getByTestId('daily-workspace-panel')).toContainText('手動データ');
  await expect(page.getByTestId('daily-workspace-panel')).toContainText('キャッシュ');
  await expect(page.getByTestId('daily-workspace-panel')).toContainText('最終更新');
  await expect(page.getByRole('button', { name: 'APIデータを再取得' })).toBeVisible();
  await expect(page.getByRole('button', { name: '設定と手動データを保存' })).toBeVisible();
});
