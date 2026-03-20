import { test, expect } from "@playwright/test";
import path from "path";

const ART_DIR = path.join(process.cwd(), "artifacts", "e2e");

test.describe("Data Freshness Status Indicator", () => {
    const basePrediction = {
        ticker: "7203.T",
        company_name: "Toyota Motor Corp",
        current_price: 2500,
        price_change_percent: 1.2,
        asof: "2026-02-09",
        last_sync: "", // To be set per test
        chart_data: [{ name: "02/09", base: 2500 }],
        day_trading: { decision: "BUY" },
        technical_analysis: { market_phase: { is_open: true } },
        long_term_snapshot: {},
        event_risk: { upcoming_events: [], warnings: [] },
        concentration_risk: { correlation_report: [], sector_distribution: {} },
        playbook_references: []
    };

    test.beforeEach(async ({ page }) => {
        // Mock all required core APIs
        await page.route("**/api/scenario*", route => route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }));
        await page.route("**/api/macro_snapshot*", route => route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }));
    });

    test("Status OK: Recent sync during market hours", async ({ page }) => {
        const now = new Date();
        const recentSync = new Date(now.getTime() - 10 * 60 * 1000); // 10 min ago
        const syncStr = recentSync.toISOString().replace('T', ' ').substring(0, 19);

        await page.route("**/api/predict", async (route) => {
            const resp = { ...basePrediction, last_sync: syncStr, partial: false };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        await page.goto("/");
        const indicator = page.getByTestId("data-status-indicator");
        await expect(indicator).toBeVisible();
        await expect(indicator).toContainText("OK");
        await expect(indicator).toHaveClass(/text-emerald-400/);
    });

    test("Status PARTIAL: Recent sync but has partial flag", async ({ page }) => {
        const syncStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

        await page.route("**/api/predict", async (route) => {
            const resp = { ...basePrediction, last_sync: syncStr, partial: true };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        await page.goto("/");
        const indicator = page.getByTestId("data-status-indicator");
        await expect(indicator).toContainText("PARTIAL");
        await expect(indicator).toHaveClass(/text-amber-400/);
    });

    test("Status STALE: Old sync (more than 30 min during day)", async ({ page }) => {
        // Force time to a weekday afternoon (e.g., Monday 14:00)
        // Note: The UI uses new Date() so mock if possible or just use a very old date
        const oldSync = new Date(Date.now() - 60 * 60 * 1000); // 60 min ago
        const syncStr = oldSync.toISOString().replace('T', ' ').substring(0, 19);

        await page.route("**/api/predict", async (route) => {
            const resp = { ...basePrediction, last_sync: syncStr };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        await page.goto("/");
        const indicator = page.getByTestId("data-status-indicator");

        // If the test runner runs at night/weekend, it might still be OK due to 24h threshold.
        // We checking for either behavior based on current env time
        const hour = new Date().getHours();
        const day = new Date().getDay();
        const isMarketClosed = day === 0 || day === 6 || hour < 9 || hour >= 15;

        if (!isMarketClosed) {
            await expect(indicator).toContainText("STALE");
            await expect(indicator).toHaveClass(/text-rose-400/);
        } else {
            // At night/weekend, 60 min is still OK
            await expect(indicator).toContainText("OK");
        }
    });
});
