import { test, expect } from '@playwright/test';

test.describe('Rule-Based Scoring (Phase 4.3)', () => {
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

        // Mock aggregate scoring API
        await page.route('**/api/scoring/aggregate*', async route => {
            await route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    total_entries: 10,
                    total_trades: 8,
                    win_rate: 0.625,
                    execution_rate: 0.8,
                    skip_rate: 0.2,
                    tickers_count: 2,
                    per_ticker: []
                })
            });
        });
    });

    test('should display rule-based scoring breakdown', async ({ page }) => {
        // Mock rule-based scoring API
        await page.route('**/api/scoring/by_rule*', async route => {
            await route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    period: 'weekly',
                    period_start: '2026-02-02',
                    period_end: '2026-02-08',
                    rules: {
                        gap_up: {
                            total_entries: 5,
                            total_trades: 4,
                            win_count: 3,
                            win_rate: 0.75,
                            execution_rate: 0.8,
                            skip_rate: 0.2
                        },
                        gap_down: {
                            total_entries: 3,
                            total_trades: 2,
                            win_count: 1,
                            win_rate: 0.5,
                            execution_rate: 0.67,
                            skip_rate: 0.33
                        },
                        range: {
                            total_entries: 7,
                            total_trades: 6,
                            win_count: 5,
                            win_rate: 0.833,
                            execution_rate: 0.857,
                            skip_rate: 0.143
                        }
                    },
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

        // Wait for rule-based section
        const ruleSection = page.getByTestId('weekend-plan-by-rule');
        await ruleSection.waitFor({ state: 'attached', timeout: 10000 });

        // Verify gap_up metrics
        const gapUp = page.getByTestId('by-rule-gap-up');
        await expect(gapUp).toBeAttached();
        await expect(gapUp).toContainText('75.0%'); // win_rate
        await expect(gapUp).toContainText('80.0%'); // execution_rate

        // Verify gap_down metrics
        const gapDown = page.getByTestId('by-rule-gap-down');
        await expect(gapDown).toBeAttached();
        await expect(gapDown).toContainText('50.0%'); // win_rate

        // Verify range metrics
        const range = page.getByTestId('by-rule-range');
        await expect(range).toBeAttached();
        await expect(range).toContainText('83.3%'); // win_rate
        await expect(range).toContainText('85.7%'); // execution_rate
    });

    test('should display recommendation based on rule performance', async ({ page }) => {
        // Mock rule-based scoring with low gap_up execution
        await page.route('**/api/scoring/by_rule*', async route => {
            await route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    period: 'weekly',
                    period_start: '2026-02-02',
                    period_end: '2026-02-08',
                    rules: {
                        gap_up: {
                            total_entries: 10,
                            total_trades: 3,
                            win_count: 2,
                            win_rate: 0.67,
                            execution_rate: 0.3,
                            skip_rate: 0.7
                        },
                        gap_down: {
                            total_entries: 2,
                            total_trades: 2,
                            win_count: 1,
                            win_rate: 0.5,
                            execution_rate: 1.0,
                            skip_rate: 0
                        },
                        range: {
                            total_entries: 5,
                            total_trades: 4,
                            win_count: 3,
                            win_rate: 0.75,
                            execution_rate: 0.8,
                            skip_rate: 0.2
                        }
                    },
                    updated_at: '2026-02-08T12:00:00'
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

        // Wait for recommendation section
        const recommendation = page.getByTestId('weekend-plan-recommendation');
        await recommendation.waitFor({ state: 'attached', timeout: 10000 });

        // Should contain recommendation about gap_up execution rate
        await expect(recommendation).toContainText('上窓');
        await expect(recommendation).toContainText('実行率が低い');
    });
});
