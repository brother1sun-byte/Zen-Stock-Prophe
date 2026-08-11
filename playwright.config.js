import { defineConfig } from '@playwright/test';

const reuseExistingServer = globalThis.process?.env?.ZEN_PLAYWRIGHT_REUSE_EXISTING !== '0';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'python backend/server.py',
      url: 'http://127.0.0.1:8889/api/stocks',
      reuseExistingServer,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer,
      timeout: 120_000,
    },
  ],
});
