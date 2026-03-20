import { test, expect, Page } from '@playwright/test';

// 2026-02-08 (Sunday)
const mockDate = new Date('2026-02-08T12:00:00+09:00');

test.beforeEach(async ({ page }) => {
    // 1. Freeze Date
    await page.addInitScript((mDateStr) => {
        const mDate = new Date(mDateStr);
        const OriginalDate = window.Date;
        class MockDate extends OriginalDate {
            constructor(...args: any[]) {
                super(...(args as [any]));
                if (args.length === 0) return new OriginalDate(mDate.getTime());
                // @ts-ignore
                return new (OriginalDate as any)(...args);
            }
            static now() { return mDate.getTime(); }
        }
        window.Date = MockDate as any;
    }, mockDate.toISOString());

    // 2. Disable Animations
    await page.addStyleTag({
        content: `
            *, *::before, *::after {
                transition: none !important;
                animation: none !important;
                scroll-behavior: auto !important;
            }
            [data-overlay] { pointer-events: none !important; }
        `
    });

    // 3. Mock Base Predict API
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
                asof: '2026-02-08',
                last_sync: new Date().toISOString()
            })
        });

        // 4. Mock Additional APIs (Phase 4.4 compatible)
        await page.route('**/api/scenario*', async r => r.fulfill({ body: JSON.stringify({ ok: true }) }));
        await page.route('**/api/macro_snapshot*', async r => r.fulfill({ body: JSON.stringify({ ok: true }) }));
        await page.route('**/api/portfolio*', async r => r.fulfill({ body: JSON.stringify({ ok: true, tickers: [] }) }));
        await page.route('**/api/scoring/aggregate*', async r => r.fulfill({ body: JSON.stringify({ ok: true, total_entries: 0 }) }));
        await page.route('**/api/scoring/rules*', async r => r.fulfill({ body: JSON.stringify({ ok: true, rules: {} }) }));
        await page.route('**/api/diary*', async r => r.fulfill({ body: JSON.stringify({ ok: true, items: [] }) }));
    });
});

async function openWeekendPlanScoring(page: Page) {
    const toggle = page.getByTestId('weekend-plan-toggle');
    await toggle.waitFor({ state: 'attached' });
    const expanded = await toggle.getAttribute('aria-expanded');
    if (expanded !== 'true') await toggle.click({ force: true });

    const tab = page.getByTestId('weekend-plan-tab-diary');
    await tab.waitFor({ state: 'attached' });
    await tab.scrollIntoViewIfNeeded();
    await tab.click({ force: true });

    const scoring = page.getByTestId('weekend-plan-scoring');
    await scoring.waitFor({ state: 'attached' });
    await scoring.scrollIntoViewIfNeeded();
}

test('should show scoring summary with valid data', async ({ page }) => {
    // Mock Scoring API
    await page.route('**/api/scoring?ticker=7203*', async route => {
        await route.fulfill({
            status: 200,
            body: JSON.stringify({
                ok: true,
                ticker: '7203',
                total_entries: 5,
                total_trades: 4,
                win_count: 3,
                win_rate: 0.75,
                execution_rate: 0.8,
                skip_rate: 0.2,
                updated_at: '2026-02-08T12:00:00'
            })
        });
    });

    await page.goto('/');
    await openWeekendPlanScoring(page);

    const summary = page.getByTestId('scoring-summary');
    await expect(summary).toBeAttached();
    await expect(summary).toContainText('4件'); // total_trades
    await expect(summary).toContainText('5件'); // total_entries
    await expect(summary).toContainText('75.0%'); // win_rate
    await expect(summary).toContainText('80.0%'); // execution_rate
});

test('should show empty state when no data exists', async ({ page }) => {
    // Mock Empty Scoring
    await page.route('**/api/scoring?ticker=7203*', async route => {
        await route.fulfill({
            status: 200,
            body: JSON.stringify({
                ok: true,
                total_entries: 0,
                total_trades: 0,
                win_rate: 0,
                execution_rate: 0,
                skip_rate: 0
            })
        });
    });

    await page.goto('/');
    await openWeekendPlanScoring(page);

    const empty = page.getByTestId('scoring-empty');
    await expect(empty).toBeAttached();
    await expect(empty).toContainText('データがありません');
});
