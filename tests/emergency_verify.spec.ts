import { test, expect } from '@playwright/test';

test('Verify UI Perfect v1 and Legacy Restore', async ({ page }) => {
    // 1. Visit main page with UI Perfect v1 (default)
    await page.goto('http://127.0.0.1:3000/');
    await page.waitForLoadState('networkidle');

    // Screenshot of the new UI Perfect v1
    await page.screenshot({ path: 'c:/Users/BRB33/.gemini/antigravity/brain/03b8cffd-9a5a-4df8-a649-32cc52a8c74a/phase18_ui_perfect_v1.png', fullPage: true });

    // Verify Title (h1)
    const title = page.locator('h1:has-text("MINATOMIRAI")');
    await expect(title).toBeVisible({ timeout: 15000 });

    // 2. Perform a search to verify API functionality
    const input = page.locator('input[placeholder*="7203"]');
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill('7203');
    await page.keyboard.press('Enter');

    // Wait for result cards to appear
    await page.waitForTimeout(7000);
    await page.screenshot({ path: 'c:/Users/BRB33/.gemini/antigravity/brain/03b8cffd-9a5a-4df8-a649-32cc52a8c74a/phase18_ui_perfect_v1_result.png', fullPage: true });

    // Verify specifically for Neural Score (new UI element)
    const neuralScoreLabel = page.locator('text=Neural Score');
    await expect(neuralScoreLabel).toBeVisible({ timeout: 10000 });

    // 3. Verify Legacy route
    await page.goto('http://127.0.0.1:3000/legacy');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'c:/Users/BRB33/.gemini/antigravity/brain/03b8cffd-9a5a-4df8-a649-32cc52a8c74a/phase18_legacy_full_ui.png', fullPage: true });

    // Legacy UI check (v7.5 style subtitle)
    await expect(page.locator('text=Cybernetic Neural Engine')).toBeVisible({ timeout: 10000 });
});
