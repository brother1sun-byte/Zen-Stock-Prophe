const { chromium } = require('@playwright/test');

(async () => {
    console.log('Starting Playwright...');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`[CONSOLE ERROR] ${msg.text()}`);
        } else if (msg.type() === 'warning') {
            console.log(`[CONSOLE WARN] ${msg.text()}`);
        } else {
            console.log(`[CONSOLE LOG] ${msg.text()}`);
        }
    });
    
    page.on('pageerror', exception => {
        console.log(`[PAGE ERROR] ${exception.message}`);
        console.log(`[PAGE STACK] ${exception.stack}`);
    });
    
    console.log('Navigating to http://localhost:3000...');
    try {
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
        console.log('Navigation complete. Waiting 2 seconds for client hydration to throw errors if any...');
        await page.waitForTimeout(2000);
    } catch (e) {
        console.error('Error during navigation:', e);
    }
    
    await browser.close();
    console.log('Done.');
})();
