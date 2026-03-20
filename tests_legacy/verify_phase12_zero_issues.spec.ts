import { test, expect } from '@playwright/test';

const ARTIFACT_DIR = 'C:/Users/BRB33/.gemini/antigravity/brain/03b8cffd-9a5a-4df8-a649-32cc52a8c74a';

test.use({
    viewport: { width: 1280, height: 720 },
    launchOptions: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

test('Capture Home Page Zero Issues Evidence', async ({ page }) => {
    console.log('Navigating to Home...');
    await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Assert NO Critical Alert banner to satisfy Zero Issues Protocol
    const alert = page.locator('text=System Critical Alert');
    const alertCount = await alert.count();
    console.log(`Alert count: ${alertCount}`);
    expect(alertCount).toBe(0);

    await page.screenshot({
        path: `${ARTIFACT_DIR}/phase12_zero_issues_home.png`,
        fullPage: true
    });
    console.log(`[PASS] Home Page screenshot saved.`);
});

test('Capture Dashboard Page Zero Issues Evidence', async ({ page }) => {
    console.log('Navigating to Dashboard...');
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Look for any heading to confirm page load
    const heading = page.locator('h2, h3').first();
    await expect(heading).toBeVisible({ timeout: 15000 });
    console.log('Dashboard heading visible.');

    await page.screenshot({
        path: `${ARTIFACT_DIR}/phase12_zero_issues_dashboard.png`,
        fullPage: true
    });
    console.log(`[PASS] Dashboard Page screenshot saved.`);
});
