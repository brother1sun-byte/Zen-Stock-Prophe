import { test, expect } from "@playwright/test";

function freezeJst(page: any, iso: string) {
    return page.addInitScript((t: string) => {
        const fixed = new Date(t).getTime();
        const OriginalDate = Date;
        // @ts-expect-error - Mocking Date globally
        window.Date = function (...args: any[]) {
            if (args.length === 0) {
                return new OriginalDate(fixed);
            }
            // @ts-expect-error - Spread args
            return new OriginalDate(...args);
        };
        window.Date.now = () => fixed;
        Object.setPrototypeOf(window.Date, OriginalDate);
    }, iso);
}

test.describe("Phase 4.5: Weekly Review & Portfolio Automation", () => {
    test.beforeEach(async ({ page }) => {
        await freezeJst(page, "2026-02-08T10:00:00.000Z");

        await page.route("**/api/scenario*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
        });
        await page.route("**/api/macro_snapshot*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
        });
        await page.route("**/api/portfolio*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, tickers: ["7203", "9984"], updated_at: new Date().toISOString() }) });
        });
        await page.route("**/api/predict", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, ticker: "7203", current_price: 2500, technical_analysis: { market_phase: { is_open: false } } }) });
        });
        await page.route("**/api/scoring*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, total_entries: 0, total_trades: 0, win_rate: 0, execution_rate: 0, skip_rate: 0, updated_at: new Date().toISOString() }) });
        });
        await page.route("**/api/diary*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, entries: [] }) });
        });
        await page.route("**/api/review*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, executed_trades: 0, win_rate: 0, execution_rate: 0, notes: [], is_partial: false }) });
        });
    });

    test("Weekly Review section displays data and partial warning", async ({ page }) => {
        await page.route("**/api/review*", async (route) => {
            await route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    total_entries: 5,
                    executed_trades: 2,
                    win_rate: 0.5,
                    execution_rate: 0.4,
                    best_trade: 5000,
                    worst_trade: -2000,
                    notes: ["良好な勝率を維持しています。"],
                    is_partial: true
                })
            });
        });

        await page.goto("/?ticker=7203");
        await expect(page.getByTestId("weekend-plan-section")).toBeVisible({ timeout: 20000 });

        // Open Diary tab (using specific click that waits for visibility)
        await page.getByTestId("weekend-plan-tab-diary").click();

        await expect(page.getByTestId("weekend-plan-weekly-review")).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId("review-partial-warning")).toBeVisible();
        await expect(page.getByTestId("weekend-plan-weekly-review")).toContainText("50.0%");
    });

    test("Reflect Portfolio button updates ticker inputs", async ({ page }) => {
        await page.goto("/?ticker=7203");
        await expect(page.getByTestId("weekend-plan-section")).toBeVisible({ timeout: 20000 });

        // Switch to Diary directly (portfolio data should be loaded on mount)
        await page.getByTestId("weekend-plan-tab-diary").click();

        // Wait for Section XII input (aggregate-portfolio-input)
        const xiiInput = page.getByTestId("aggregate-portfolio-input");
        await expect(xiiInput).toBeVisible({ timeout: 20000 });

        // Click Reflect button
        const reflectBtn = page.getByTestId("reflect-portfolio-btn");
        await expect(reflectBtn).toBeVisible({ timeout: 15000 });
        await reflectBtn.click();

        // Verify value
        await expect(xiiInput).toHaveValue("7203, 9984");
    });
});
