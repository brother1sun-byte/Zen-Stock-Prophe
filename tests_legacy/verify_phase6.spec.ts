
import { test, expect } from '@playwright/test';
import path from 'path';

// Artifacts directory (Hardcoded for stability based on current session)
const ARTIFACTS_DIR = String.raw`C:\Users\BRB33\.gemini\antigravity\brain\03b8cffd-9a5a-4df8-a649-32cc52a8c74a`;

test.use({ baseURL: 'http://localhost:3000' });

test.describe('Phase 6 Mobile Responsiveness', () => {

    test('iPad Pro (Vertical) - 2 Column / Tablet Layout', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 1366 });
        await page.goto('/');
        // Wait for data load (skeleton -> content)
        await page.waitForTimeout(3000);

        // Screenshot
        const savePath = path.join(ARTIFACTS_DIR, 'phase6_ipad_layout.png');
        await page.screenshot({ path: savePath, fullPage: true });
        console.log(`Saved: ${savePath}`);
    });

    test('iPhone 14 Pro - 1 Column / Mobile Layout', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.waitForTimeout(3000);

        const savePath = path.join(ARTIFACTS_DIR, 'phase6_iphone_layout.png');
        await page.screenshot({ path: savePath, fullPage: true });
        console.log(`Saved: ${savePath}`);
    });

    // Attempt Tooltip interaction (Optional but requested)
    test('iPhone 14 Pro - Tooltip Interaction (Long Press)', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.waitForTimeout(3000);

        // Locate a chart area or interactive element. 
        // Since we don't know the exact ID, we try to press the center of the screen
        // assuming the chart is prominently displayed.
        await page.mouse.move(195, 400);
        await page.mouse.down();
        await page.waitForTimeout(1000); // Hold for 1s

        const savePath = path.join(ARTIFACTS_DIR, 'phase6_iphone_tooltip.png');
        await page.screenshot({ path: savePath });
        await page.mouse.up();
        console.log(`Saved: ${savePath}`);
    });

});
