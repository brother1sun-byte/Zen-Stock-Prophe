import { expect, test } from '@playwright/test';

test('After Close Review export UI survives an empty or broken review log', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('zen_lifestyle_after_close_reviews_v1', '{broken json');
  });
  await page.goto('/');

  await expect(page.getByTestId('lifestyle-daytrade-panel')).toBeVisible();
  await page.getByTestId('lifestyle-mode-review').click();
  await expect(page.getByTestId('lifestyle-after-close-review')).toBeVisible();
  await expect(page.getByTestId('after-close-review-export')).toBeVisible();
  await expect(page.getByTestId('after-close-review-export-count')).toContainText('0件');
  await expect(page.getByTestId('after-close-review-export-json')).toBeVisible();
  await expect(page.getByTestId('after-close-review-export-csv')).toBeVisible();
  await expect(page.getByTestId('after-close-review-export')).toContainText('外部API');
});

test('Lifestyle daytrade workflow remains readable at common mobile widths', async ({ page }) => {
  for (const width of [390, 430, 768]) {
    await page.setViewportSize({ width, height: 1200 });
    await page.goto('/');

    await expect(page.getByTestId('lifestyle-daytrade-panel')).toBeVisible();
    await expect(page.getByTestId('lifestyle-night-card').first()).toBeVisible();
    await page.getByTestId('lifestyle-mode-morning').click();
    await expect(page.getByTestId('lifestyle-morning-card')).toBeVisible();
    await page.getByTestId('morning-manual-price').fill('2480');
    await expect(page.getByTestId('morning-manual-price')).toHaveValue('2480');
    await page.getByTestId('lifestyle-mode-work').click();
    await expect(page.getByTestId('lifestyle-work-monitor')).toBeVisible();
    await page.getByTestId('lifestyle-mode-review').click();
    await expect(page.getByTestId('after-close-review-export-json')).toBeVisible();
    await expect(page.getByTestId('after-close-review-export-csv')).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(hasHorizontalOverflow).toBe(false);
  }
});
