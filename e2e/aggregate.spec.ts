import { test, expect } from '@playwright/test';

test.describe('Aggregate Scoring (Phase 4.3)', () => {
    test.beforeEach(async ({ page }) => {
        // Disable animations
        await page.addStyleTag({
            content: `
                *,
                *::before,
                *::after {
                    transition: none !important;
                    animation: none !important;
                    scroll-behavior: auto !important;
                }
            `
        });

        // Mock predict API
        await page.route('**/api/predict*', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ticker: '7203',
                    company_name: 'トヨタ自動車',
                    current_price: 2500,
                    price_change_percent: 0.1,
                    forecasts: { '1d': 2550 },
                    chart_data: [{ name: '02/08', base: 2500 }],
                    technical_analysis: { market_phase: { label: '上昇', is_open: false, detail: 'Test' } },
                    day_trading: { decision: 'BUY', super_score: 85, reasoning_list: ['Test'], explanations: { technical_reasons: ['Test'] } },
                    evolution_stats: { total_count: 50, ticker_count: 10, current_bias: 0.01, correction_applied: 0 },
                    asof: '2026-02-08'
                })
            });
        });

        // Mock hot-picks API
        await page.route('**/api/hot-picks*', async route => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, picks: [] }) });
        });

        // Mock diary API
        await page.route('**/api/diary*', async route => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, items: [], total_found: 0 }) });
        });

        // Mock single scoring API
        await page.route('**/api/scoring?ticker=7203*', async route => {
            await route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    ticker: '7203',
                    total_entries: 0,
                    total_trades: 0,
                    win_rate: 0,
                    execution_rate: 0,
                    skip_rate: 0
                })
            });
        });
    });

    test('should display aggregate scoring with multiple tickers', async ({ page }) => {
        // Mock aggregate scoring API
        await page.route('**/api/scoring/aggregate*', async route => {
            await route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    period: 'weekly',
                    period_start: '2026-02-02',
                    period_end: '2026-02-08',
                    tickers_count: 3,
                    total_entries: 15,
                    total_trades: 12,
                    win_count: 8,
                    win_rate: 0.6667,
                    execution_rate: 0.8,
                    skip_rate: 0.2,
                    per_ticker: [
                        { ticker: '7203', total_trades: 5, win_rate: 0.6, execution_rate: 0.83 },
                        { ticker: '9101', total_trades: 4, win_rate: 0.75, execution_rate: 0.8 },
                        { ticker: '6758', total_trades: 3, win_rate: 0.67, execution_rate: 0.75 }
                    ],
                    updated_at: '2026-02-08T12:00:00'
                })
            });
        });

        await page.goto('/');

        // Open Weekend Plan
        const toggle = page.getByTestId('weekend-plan-toggle');
        await toggle.waitFor({ state: 'attached' });
        await toggle.scrollIntoViewIfNeeded();
        const expanded = await toggle.getAttribute('aria-expanded');
        if (expanded !== 'true') {
            await toggle.click({ force: true });
        }

        // Switch to Diary tab
        const diaryTab = page.getByTestId('weekend-plan-tab-diary');
        await diaryTab.waitFor({ state: 'attached' });
        await diaryTab.scrollIntoViewIfNeeded();
        await diaryTab.click({ force: true });

        // Wait for aggregate section
        const aggregateSection = page.getByTestId('weekend-plan-aggregate');
        await aggregateSection.waitFor({ state: 'attached', timeout: 10000 });

        // Verify aggregate summary
        const summary = page.getByTestId('aggregate-summary');
        await expect(summary).toBeAttached();
        await expect(summary).toContainText('12件'); // total_trades
        await expect(summary).toContainText('66.7%'); // win_rate
        await expect(summary).toContainText('3銘柄'); // tickers_count

        // Verify top 3 tickers
        const top3 = page.getByTestId('aggregate-top3');
        await expect(top3).toBeAttached();
        await expect(top3).toContainText('7203');
        await expect(top3).toContainText('9101');
        await expect(top3).toContainText('6758');
    });

    test('should show empty state when no aggregate data', async ({ page }) => {
        // Mock empty aggregate scoring
        await page.route('**/api/scoring/aggregate*', async route => {
            await route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    total_entries: 0,
                    total_trades: 0,
                    win_rate: 0,
                    execution_rate: 0,
                    skip_rate: 0,
                    tickers_count: 0,
                    per_ticker: []
                })
            });
        });

        await page.goto('/');

        const toggle = page.getByTestId('weekend-plan-toggle');
        await toggle.waitFor({ state: 'attached' });
        const expanded = await toggle.getAttribute('aria-expanded');
        if (expanded !== 'true') {
            await toggle.click({ force: true });
        }

        const diaryTab = page.getByTestId('weekend-plan-tab-diary');
        await diaryTab.click({ force: true });

        // Should show empty message
        await expect(page.locator('text=複数銘柄のデータを入力して集計してください')).toBeVisible();
    });
});
