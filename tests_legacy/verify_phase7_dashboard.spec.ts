
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const ARTIFACTS_DIR = String.raw`C:\Users\BRB33\.gemini\antigravity\brain\03b8cffd-9a5a-4df8-a649-32cc52a8c74a`;
const DASHBOARD_URL = 'http://localhost:3000/dashboard';

test.use({
    viewport: { width: 1280, height: 800 }, // Desktop view
    baseURL: 'http://localhost:3000',
});

test('Phase 7: Learning Dashboard Verification', async ({ page }) => {
    console.log('Navigating to Dashboard...');
    await page.goto('/dashboard');

    // 1. Verify Page Title (Critical check)
    await expect(page.getByText('Learning Process Visualization')).toBeVisible({ timeout: 10000 });
    console.log('Title verified.');

    // 2. Wait for Loading to finish
    // Check if Loading spinner is present, if so wait for it to disappear
    const loading = page.locator('text=Loading Analytics');
    if (await loading.isVisible()) {
        console.log('Waiting for loading to complete...');
        await loading.waitFor({ state: 'hidden', timeout: 5000 });
    }

    // 3. Verify Charts Presence (Relaxed check, just ensure container isn't empty)
    // We check for "Dominant Reasons" and "Score & Confidence Trend" headers
    await expect(page.getByText('Dominant Reasons (Top 3)')).toBeVisible();
    await expect(page.getByText('Score & Confidence Trend')).toBeVisible();
    await expect(page.getByText('Market Phase Performance')).toBeVisible();
    console.log('Chart Sections verified.');

    // 4. Capture Screenshot
    // Wait a bit for charts to fully render since animations are OFF but rendering tick might take ms
    await page.waitForTimeout(1000);

    // Check if we have "No Data" or data
    const noData = await page.getByText('No Data').count() > 0;
    const filename = noData ? 'phase7_dashboard_empty.png' : 'phase7_dashboard.png';
    const savePath = path.join(ARTIFACTS_DIR, filename);

    await page.screenshot({ path: savePath, fullPage: true });
    console.log(`Saved proof to: ${savePath}`);

});
