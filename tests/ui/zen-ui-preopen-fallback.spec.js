import { expect, test } from '@playwright/test';

async function mockFallbackApi(page) {
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path.endsWith('/stocks')) {
      return route.fulfill({
        json: [
          {
            ticker: '4980.T',
            name: 'Dexerials Corporation',
            emoji: 'DX',
            price: 2478,
            decision: 'DAYTRADE_ENTRY_OK',
            preopenDecision: '監視候補',
            preopenScore: 78,
            candidateScore: 72,
            surgeScore: 81.2,
            changePct: 4.56,
            high20Breakout: true,
            ytdHighBreakout: false,
            popularityScore: 73.4,
            volumeRatio: 2.35,
            volume: 1280000,
            overheatRisk: 61.2,
            candidateQuality: { qualityScore: 88.8 },
            candidateReason: '前日終値ベースで強さを維持しています。',
            preopenReport: {
              watchPoints: ['寄り付き後の出来高とVWAPを確認してください。'],
              riskFlags: [{ label: '材料確認', detail: '重要材料の再確認が必要です。' }],
            },
            dataQuality: { source: 'yfinance', synthetic: false, score: 100 },
          },
        ],
      });
    }
    if (path.endsWith('/portfolio')) {
      return route.fulfill({
        json: {
          cash: 500000,
          holdings: [],
          archivedHoldings: [],
          transactions: [],
          totalAssets: 500000,
          totalPnl: 0,
          totalPnlPct: 0,
          history: [],
        },
      });
    }
    if (path.endsWith('/transactions')) return route.fulfill({ json: [] });
    if (path.includes('/market/universe')) return route.fulfill({ status: 503, json: { detail: 'unavailable' } });
    if (path.includes('/market/rankings')) return route.fulfill({ status: 503, json: { detail: 'ranking temporarily unavailable' } });
    if (path.includes('/stock/4980.T')) {
      return route.fulfill({
        json: {
          ticker: '4980.T',
          name: 'Dexerials Corporation',
          price: 2478,
          priceSource: 'yfinance',
          chart: [],
          analysis: { signal: 'HOLD', confidence: 50, strategy: {}, details: [], indicators: {} },
          preopenReport: {
            watchPoints: ['寄り付き後の出来高とVWAPを確認してください。'],
            riskFlags: [{ label: '材料確認', detail: '重要材料の再確認が必要です。' }],
          },
          preopenDecision: '監視候補',
          preopenScore: 78,
          dataQuality: { source: 'yfinance', synthetic: false, score: 100 },
        },
      });
    }
    if (path.includes('/analysis/advanced/')) return route.fulfill({ json: { ticker: '4980.T', actionLabel: '様子見', compositeScore: 50, factors: {}, guardrails: [], explainability: [] } });
    if (path.includes('/daytrade/analysis/')) return route.fulfill({ json: { ticker: '4980.T', label: '監視候補', score: 50, indicators: {}, levels: {}, evidence: [], fakeoutFilters: [], backtest: {}, walkForward: {} } });
    if (path.includes('/daytrade/routine/')) return route.fulfill({ json: { priority: '監視', verdict: '様子見', summary: '寄り付き後に確認します。', phases: [], mobileSummary: {}, manualOnlyNotice: '練習用です。' } });
    if (path.includes('/daytrade/plan')) return route.fulfill({ json: { premise: '練習用です。', rules: {} } });
    if (path.includes('/daytrade/signals')) return route.fulfill({ json: [] });
    if (path.includes('/daytrade/risk-state')) return route.fulfill({ json: { jobsVerdict: '練習用です。', liveOrderMode: 'disabled' } });
    if (path.includes('/daytrade/broker-status')) return route.fulfill({ json: { message: '実注文は無効です。' } });
    if (path.includes('/daytrade/autopilot/status')) return route.fulfill({ json: { running: false, mode: 'BROKER_DISABLED' } });
    if (path.includes('/ai-fund/desk')) return route.fulfill({ json: { liveBrokerOrdersEnabled: false, summary: {}, workflow: [], guardrails: [], auditTrail: {} } });
    if (path.includes('/alerts/watchlist')) return route.fulfill({ json: {} });
    if (path.includes('/research/jquants/status')) return route.fulfill({ json: { configured: false } });
    return route.fulfill({ json: {} });
  });
}

test('ランキング未取得でも寄り前候補をトップカードへ表示する', async ({ page }) => {
  await mockFallbackApi(page);
  await page.goto('/');

  const summary = page.getByTestId('candidate-summary');
  await expect(summary.locator('h2')).toContainText('4980.T');
  await expect(summary.locator('h2')).not.toContainText('全市場スキャン中');
  await expect(page.getByTestId('opening-scenario-plan')).toBeVisible();
});

test('トップ候補に短期上昇と出来高などの候補指標が反映される', async ({ page }) => {
  await mockFallbackApi(page);
  await page.goto('/');

  const summary = page.getByTestId('candidate-summary');
  await expect(summary).toBeVisible();
  await expect(summary.getByTestId('summary-metric-strip')).toBeVisible();

  await expect(summary.getByTestId('summary-metric-surge')).toContainText('短期上昇');
  await expect(summary.getByTestId('summary-metric-surge')).toContainText('81.2/100');
  await expect(summary.getByTestId('summary-metric-change')).toContainText('値上がり率');
  await expect(summary.getByTestId('summary-metric-change')).toContainText('+4.56%');
  await expect(summary.getByTestId('summary-metric-breakout')).toContainText('高値更新');
  await expect(summary.getByTestId('summary-metric-breakout')).toContainText('20日');
  await expect(summary.getByTestId('summary-metric-popularity')).toContainText('人気');
  await expect(summary.getByTestId('summary-metric-popularity')).toContainText('73.4/100');
  await expect(summary.getByTestId('summary-metric-volume')).toContainText('出来高');
  await expect(summary.getByTestId('summary-metric-volume')).toContainText('2.35x');
  await expect(summary.getByTestId('summary-metric-quality')).toContainText('品質');
  await expect(summary.getByTestId('summary-metric-quality')).toContainText('88.8/100');
  await expect(summary.getByTestId('summary-metric-overheat')).toContainText('過熱注意');
  await expect(summary.getByTestId('summary-metric-overheat')).toContainText('61.2');
});
