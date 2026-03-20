import { test, expect } from '@playwright/test';

test.describe('Portfolio Management (Phase 4.4)', () => {
    test.beforeEach(async ({ page }) => {
        // Mock Portfolio API
        await page.route('**/api/portfolio*', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        ok: true,
                        tickers: ['7203', '9984'],
                        updated_at: '2026-02-08T10:00:00'
                    })
                });
            } else if (route.request().method() === 'POST') {
                const postData = route.request().postDataJSON();
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        ok: true,
                        tickers: postData.tickers,
                        updated_at: new Date().toISOString()
                    })
                });
            }
        });

        // Mock Predict API for context
        await page.route('**/api/predict*', async route => {
            await route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ticker: '7203',
                    current_price: 2500,
                    forecasts: { '1d': 2550 },
                    asof: '2026-02-08'
                })
            });
        });

        await page.goto('/');

        // Open Weekend Plan
        const toggle = page.getByTestId('weekend-plan-toggle');
        await toggle.waitFor({ state: 'attached' });
        const expanded = await toggle.getAttribute('aria-expanded');
        if (expanded !== 'true') await toggle.click({ force: true });
    });

    test('should load and display portfolio tab', async ({ page }) => {
        const tab = page.getByTestId('tab-portfolio');
        await expect(tab).toBeVisible();
        await tab.click();

        const input = page.getByTestId('portfolio-input');
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('7203, 9984');
    });

    test('should save new tickers', async ({ page }) => {
        const tab = page.getByTestId('tab-portfolio');
        await tab.click();

        const input = page.getByTestId('portfolio-input');
        await input.fill('7203, 9984, 6758');

        const saveBtn = page.getByTestId('portfolio-save');
        await saveBtn.click();

        // Verify updated timestamp appears
        const updatedAt = page.getByTestId('portfolio-updated-at');
        await expect(updatedAt).toBeVisible();
    });
});
