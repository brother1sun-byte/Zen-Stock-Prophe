import { expect, test } from '@playwright/test';

const WIDTHS = [390, 430, 768, 1440];

test('v1.2 personal dashboard stays readable across target widths', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1200 });
    await page.goto('/');
    await expect(page.getByTestId('today-check-dashboard')).toBeVisible();
    await expect(page.getByTestId('daily-workspace-panel')).toBeVisible();
    await expect(page.getByTestId('zen-loop-actionable-board')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `test-results/v1.2-dashboard-${width}.png`, fullPage: true });
  }
});

test('v1.2 falls back safely when APIs and local data are unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('zen_personal_workspace_v1', '{broken');
    localStorage.setItem('zen_lifestyle_after_close_reviews_v1', '{broken');
  });
  await page.route('**/*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return pathname.startsWith('/api/') ? route.abort() : route.continue();
  });
  await page.goto('/');
  await expect(page.getByTestId('today-check-dashboard')).toBeVisible();
  await expect(page.getByTestId('today-check-dashboard')).toContainText(/判断保留|データ不足|検証済み候補なし/);
  await expect(page.getByTestId('zen-loop-actionable-board')).toHaveCount(0);
  await expect(page.getByTestId('daily-workspace-panel')).toContainText('外部送信なし');
});
