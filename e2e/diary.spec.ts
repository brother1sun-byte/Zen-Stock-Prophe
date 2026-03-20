import { test, expect } from '@playwright/test';

test.describe('Trade Diary E2E', () => {
    test.beforeEach(async ({ page }) => {
        // Freeze JST Date (Phase 2.1 compatible)
        await page.addInitScript(() => {
            const mockDate = new Date('2026-02-08T10:00:00+09:00');
            const OriginalDate = Date;
            // @ts-ignore
            globalThis.Date = class extends OriginalDate {
                constructor(...args: any[]) {
                    super(...(args as [any]));
                    if (args.length === 0) return new OriginalDate(mockDate.getTime());
                    // @ts-ignore
                    return new OriginalDate(...args);
                }
                static now() { return mockDate.getTime(); }
            };
        });

        // CSS Injection (Phase B/G) - Aggressive animation and overlay disabling
        await page.addStyleTag({
            content: `
*,
*::before,
*::after {
  transition: none !important;
  animation: none !important;
  scroll-behavior: auto !important;
}
[data-overlay], .fixed, .absolute { 
  pointer-events: none !important; 
  z-index: -1 !important; 
}
[data-testid="diary-form"], 
[data-testid="weekend-plan-toggle"], 
[data-testid="weekend-plan-tab-diary"],
[data-testid="diary-save"],
[data-testid="weekend-plan-diary"] {
  pointer-events: auto !important;
  z-index: 9999 !important;
}
`
        });

        // Mock Predict API - Sync with stable format (Phase E)
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
                    chart_data: [{ name: '02/08', base: 2500, growth: 0 }],
                    technical_analysis: {
                        market_phase: { label: '上昇', is_open: false, detail: 'Test', volatility: 'LOW' }
                    },
                    day_trading: {
                        decision: 'BUY',
                        super_score: 85,
                        reasoning_list: ['Test'],
                        explanations: { technical_reasons: ['Test'] }
                    },
                    evolution_stats: { total_count: 50, ticker_count: 10, current_bias: 0.01, correction_applied: 0 },
                    asof: '2026-02-08',
                    last_sync: '2026-02-08 10:00:00'
                })
            });
        });

        await page.route('**/api/hot-picks*', async r => r.fulfill({ body: JSON.stringify({ picks: [] }) }));
        await page.route('**/api/diary?ticker=7203*', async r => r.fulfill({ body: JSON.stringify({ ok: true, items: [] }) }));
        await page.route('**/api/diary', async route => {
            if (route.request().method() === 'POST') {
                await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, entry: { id: 'm1' } }) });
            } else {
                await route.continue();
            }
        });

        // Mock Additional APIs (Phase 4.4 compatible)
        await page.route('**/api/scenario*', async r => r.fulfill({ body: JSON.stringify({ ok: true }) }));
        await page.route('**/api/macro_snapshot*', async r => r.fulfill({ body: JSON.stringify({ ok: true }) }));
        await page.route('**/api/scoring/aggregate*', async r => r.fulfill({ body: JSON.stringify({ ok: true, total_entries: 0 }) }));
        await page.route('**/api/scoring/rules*', async r => r.fulfill({ body: JSON.stringify({ ok: true, rules: {} }) }));
        await page.route('**/api/portfolio*', async r => r.fulfill({ body: JSON.stringify({ ok: true, tickers: [] }) }));

        await page.goto('/?ticker=7203');
    });

    /**
     * Helper to ensure the WeekendPlanSection is expanded (Phase D/G)
     */
    const openWeekendPlan = async (page: import('@playwright/test').Page) => {
        const toggle = page.getByTestId('weekend-plan-toggle');
        await toggle.waitFor({ state: 'attached' });
        await toggle.scrollIntoViewIfNeeded();

        const expanded = await toggle.getAttribute('aria-expanded');
        if (expanded !== 'true') {
            await toggle.click({ force: true });
        }

        const diaryRoot = page.getByTestId('weekend-plan-diary');
        await diaryRoot.waitFor({ state: 'attached' });
        await diaryRoot.scrollIntoViewIfNeeded();
    };

    /**
     * Helper to switch to the Diary tab (Phase D/F)
     */
    const openDiaryTab = async (page: import('@playwright/test').Page) => {
        const tab = page.getByTestId('weekend-plan-tab-diary');
        await tab.waitFor({ state: 'attached' });
        await tab.scrollIntoViewIfNeeded();
        await tab.click({ force: true });

        const form = page.getByTestId('diary-form');
        await form.waitFor({ state: 'attached' });
        await form.scrollIntoViewIfNeeded();
    };

    test('should show diary section and save entry', async ({ page }) => {
        await openWeekendPlan(page);
        await openDiaryTab(page);

        // Fill Form
        await page.getByTestId('diary-date').fill('2026-02-08');
        await page.getByTestId('diary-planned-action').fill('wait');
        await page.getByTestId('diary-actual-action').fill('wait');

        // Remock for list refresh (Phase E)
        await page.route('**/api/diary?ticker=7203*', async r => {
            await r.fulfill({
                body: JSON.stringify({
                    ok: true,
                    items: [{
                        id: 'm1',
                        date: '2026-02-08',
                        ticker: '7203',
                        scenario_type: 'range',
                        planned_action: 'wait',
                        actual_action: 'wait',
                        result: 'win'
                    }]
                })
            });
        });

        const saveBtn = page.getByTestId('diary-save');
        await saveBtn.scrollIntoViewIfNeeded();
        // Trial click for stability (Phase G)
        await saveBtn.click({ trial: true });
        await saveBtn.click({ force: true });

        // Verify status and list entry (Phase G)
        const statusMsg = page.getByTestId('diary-save-status');
        await statusMsg.waitFor({ state: 'attached' });
        await expect(statusMsg).toContainText('保存');

        const item = page.getByTestId('diary-item');
        await item.waitFor({ state: 'attached' });
        await expect(item).toContainText('wait');
    });

    test('should prevent double submission during save', async ({ page }) => {
        await openWeekendPlan(page);
        await openDiaryTab(page);

        await page.getByTestId('diary-planned-action').fill('Double');
        await page.getByTestId('diary-actual-action').fill('Double');

        // Delay POST
        await page.route('**/api/diary', async route => {
            if (route.request().method() === 'POST') {
                await new Promise(r => setTimeout(r, 4000));
                await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
            }
        });

        const btn = page.getByTestId('diary-save');
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ force: true });

        await expect(btn).toBeDisabled();
        await expect(btn).toContainText('保存中...');
    });
});
