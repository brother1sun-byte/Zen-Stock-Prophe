import { test, expect } from '@playwright/test';
import * as path from 'path';

// Artifact storage for walkthrough
const ART_DIR = 'C:/Users/BRB33/.gemini/antigravity/brain/b78f2627-9519-4f15-8296-57af27e80c2b';

test.describe('Phase 3.2: Macro Snapshot Verification', () => {

    test('I: Macro Snapshot Grid Display (Success)', async ({ page }) => {
        // Mock Macro Snapshot Success
        await page.route(/\/api\/macro_snapshot(\?.*)?$/, async (route) => {
            const body = {
                asof: "2026-02-08",
                nikkei: 38000.5,
                topix: 2600.2,
                usdjpy: 148.5,
                us10y: 4.25,
                vix: 14.5,
                risk_sentiment: "Risk On (Greed/Calm)",
                partial: false,
                missing_fields: []
            };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        });

        // Mock Predict/Scenario to avoid noise
        await page.route(/\/api\/predict(\?.*)?$/, async (route) => {
            await route.fulfill({
                status: 200, contentType: "application/json", body: JSON.stringify({
                    ticker: "7203",
                    company_name: "トヨタ",
                    current_price: 2500,
                    asof: "2026-02-08",
                    last_sync: "2026-02-06 15:00:00"
                })
            });
        });
        await page.route(/\/api\/scenario(\?.*)?$/, async (route) => {
            await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
        });

        await page.goto('http://localhost:3000/?ticker=7203');

        // Open Weekend Plan if closed
        const section = page.getByTestId('weekend-plan-diary');
        const header = page.getByTestId('weekend-plan-toggle');

        // Wait for hydration
        await expect(header).toBeVisible();

        // Check if content is visible
        const isVisible = await page.getByTestId('tab-snapshot').isVisible().catch(() => false);
        if (!isVisible) {
            await header.click();
        }

        // Check Tab Name
        const macroTab = page.getByTestId('tab-snapshot');
        await expect(macroTab).toContainText('IX マクロスナップショット');
        await macroTab.click();

        // Verify Macro Grid
        const grid = page.getByTestId('weekend-plan-macro');
        await expect(grid).toBeVisible();

        const items = page.getByTestId('weekend-plan-macro-item');
        await expect(items).toHaveCount(6);

        // Verify Sentiment Text
        await expect(grid).toContainText('Risk On (Greed/Calm)');

        await page.screenshot({ path: path.join(ART_DIR, 'I_MacroDisplay_Refined.png') });
    });

    test('J: Macro Snapshot Partial Data Handling', async ({ page }) => {
        // Mock Partial Data (VIX missing)
        await page.route(/\/api\/macro_snapshot(\?.*)?$/, async (route) => {
            const body = {
                asof: "2026-02-08",
                nikkei: 38000.5,
                topix: 2600.2,
                usdjpy: 148.5,
                us10y: 4.25,
                vix: null,
                risk_sentiment: "Unknown",
                partial: true,
                missing_fields: ["vix", "risk_sentiment"]
            };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        });

        await page.goto('http://localhost:3000/?ticker=7203');

        const header = page.getByTestId('weekend-plan-toggle');
        await expect(header).toBeVisible();
        const isVisible = await page.getByTestId('tab-snapshot').isVisible().catch(() => false);
        if (!isVisible) {
            await header.click();
        }

        // Verify Partial Banner for Macro
        const banner = page.getByTestId('weekend-plan-macro-partial');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('マクロ情報: 取得失敗項目があります');

        const missingText = page.getByTestId('macro-missing-fields');
        await expect(missingText).toContainText('VIX恐怖指数');

        await page.screenshot({ path: path.join(ART_DIR, 'J_MacroPartial_Refined.png') });
    });
});
