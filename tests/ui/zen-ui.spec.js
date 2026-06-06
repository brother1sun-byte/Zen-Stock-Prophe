import { expect, test } from '@playwright/test';

const CACHE_KEY = 'zen-stock-prophet-pro-cache-v4';

function extractTicker(text) {
  return text.match(/\d{4}\.T/)?.[0] || '4980.T';
}

function mockPayload(source = 'synthetic') {
  const synthetic = source === 'synthetic';
  const cached = source === 'cache';
  const ticker = '4980.T';
  const alternateTicker = '7203.T';
  const stock = {
    ticker,
    name: 'デクセリアルズ',
    emoji: 'DX',
    price: 2478,
    candidateScore: 72,
    candidateReason: 'UI回帰テスト用の候補です。',
    priceSource: source,
    source,
    synthetic,
    isSynthetic: synthetic,
    is_synthetic: synthetic,
    cache: cached,
    isCached: cached,
    is_cached: cached,
    dataQuality: { source, synthetic, score: synthetic ? 10 : 70 },
  };
  const alternateStock = {
    ...stock,
    ticker: alternateTicker,
    name: 'トヨタ自動車',
    emoji: 'TY',
    price: 3000,
    candidateScore: 64,
    candidateReason: '監視リスト選択の同期確認用候補です。',
  };
  const opportunity = {
    ...stock,
    entryPrice: 2478,
    targetPrice: 2516,
    stopLoss: 2469,
    shares: 100,
    expectedProfitJpy: 1800,
    maxLossJpy: 900,
    confidencePct: 58,
    opportunityScore: synthetic ? 0 : 1200,
    tradeReadiness: synthetic ? 'review' : 'ready',
    whyBuy: ['練習用の表示確認'],
    whyNotBuy: synthetic ? ['補完データのため参考表示'] : [],
    invalidConditions: ['条件悪化時は見送り'],
    dataFreshness: {
      source,
      priceSource: source,
      synthetic,
      isSynthetic: synthetic,
      is_synthetic: synthetic,
      cache: cached,
      isCached: cached,
      is_cached: cached,
    },
  };
  return {
    ticker,
    stock,
    alternateTicker,
    alternateStock,
    opportunity,
    portfolio: {
      cash: 500000,
      holdings: [{
        ticker: alternateTicker,
        name: 'トヨタ自動車',
        emoji: 'TY',
        shares: 100,
        avgCost: 2950,
        currentPrice: 3000,
        value: 300000,
        pnl: 5000,
        pnlPct: 1.69,
        status: 'ACTIVE',
        dataQuality: { source, synthetic, score: synthetic ? 10 : 70 },
        exitPlan: {
          action: 'HOLD',
          label: '保有確認',
          reviewPrice: 3000,
          targetPrice: 3050,
          stretchTargetPrice: 3070,
          stopLoss: 2920,
          timing: '練習用の売却判断です。',
          marketSummary: '地合い確認中',
          marketResearch: [],
        },
      }],
      archivedHoldings: [],
      transactions: [],
      totalAssets: 800000,
      totalPnl: 5000,
      totalPnlPct: 0.63,
      history: [],
    },
    detail: {
      ...stock,
      changePct: 0.3,
      chart: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-05-${String(index + 1).padStart(2, '0')}`,
        open: 2400 + index,
        high: 2410 + index,
        low: 2390 + index,
        close: 2405 + index,
        volume: 100000 + index * 1000,
      })),
      analysis: { signal: 'HOLD', confidence: 50, strategy: {}, details: [], indicators: {} },
      dataQuality: stock.dataQuality,
      intradayOpportunity: opportunity,
      externalLinks: [],
    },
    alternateDetail: {
      ...alternateStock,
      changePct: 0.1,
      chart: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-05-${String(index + 1).padStart(2, '0')}`,
        open: 2900 + index,
        high: 2910 + index,
        low: 2890 + index,
        close: 2905 + index,
        volume: 120000 + index * 1000,
      })),
      analysis: { signal: 'HOLD', confidence: 48, strategy: {}, details: [], indicators: {} },
      dataQuality: alternateStock.dataQuality,
      intradayOpportunity: {
        ...opportunity,
        ticker: alternateTicker,
        name: 'トヨタ自動車',
        entryPrice: 3000,
        targetPrice: 3050,
        stopLoss: 2980,
      },
      externalLinks: [],
    },
  };
}

async function mockApi(page, source = 'synthetic') {
  const data = mockPayload(source);
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path.endsWith('/stocks')) return route.fulfill({ json: [data.stock, data.alternateStock] });
    if (path.includes('/portfolio/positions/') && path.endsWith('/lifecycle')) return route.fulfill({ json: { message: '練習台帳の状態を更新しました。実注文は行っていません。' } });
    if (path.endsWith('/portfolio/positions')) return route.fulfill({ json: { message: '練習注文を保存しました。実注文は行っていません。' } });
    if (path.endsWith('/portfolio')) return route.fulfill({ json: data.portfolio });
    if (path.endsWith('/transactions')) return route.fulfill({ json: [] });
    if (path.includes('/stock/')) return route.fulfill({ json: path.includes(data.alternateTicker) ? data.alternateDetail : data.detail });
    if (path.includes('/analysis/advanced/')) {
      const tickerForReport = path.includes(data.alternateTicker) ? data.alternateTicker : data.ticker;
      return route.fulfill({ json: { ticker: tickerForReport, actionLabel: '様子見', compositeScore: 50, factors: {}, guardrails: [], explainability: [] } });
    }
    if (path.includes('/market/universe')) return route.fulfill({ json: { count: 2, sample: [data.stock, data.alternateStock], snapshot: { provider: source, isCached: source === 'cache' } } });
    if (path.includes('/market/rankings')) return route.fulfill({ json: { kind: 'gainers', isCached: source === 'cache', bestAvailableOpportunity: data.opportunity, bestOpportunity: data.opportunity, items: [data.stock, data.alternateStock] } });
    if (path.includes('/daytrade/analysis/')) {
      const tickerForAnalysis = path.includes(data.alternateTicker) ? data.alternateTicker : data.ticker;
      return route.fulfill({ json: { ticker: tickerForAnalysis, label: '参考表示', score: 50, indicators: {}, levels: {}, evidence: [], fakeoutFilters: [], backtest: {}, walkForward: {} } });
    }
    if (path.includes('/daytrade/routine/')) return route.fulfill({ json: { priority: '参考', verdict: '手動確認', summary: '練習用の確認です。', phases: [], mobileSummary: {}, manualOnlyNotice: '実注文ではありません。' } });
    if (path.includes('/daytrade/plan')) return route.fulfill({ json: { premise: '練習用です。', rules: {} } });
    if (path.includes('/daytrade/signals')) return route.fulfill({ json: [] });
    if (path.includes('/daytrade/risk-state')) return route.fulfill({ json: { jobsVerdict: '実注文ではなく練習用です。', liveOrderMode: 'disabled' } });
    if (path.includes('/daytrade/broker-status')) return route.fulfill({ json: { message: '実注文連携は無効です。' } });
    if (path.includes('/daytrade/autopilot/status')) return route.fulfill({ json: { running: false, mode: 'BROKER_DISABLED' } });
    if (path.includes('/ai-fund/desk')) return route.fulfill({ json: { liveBrokerOrdersEnabled: false, summary: {}, workflow: [], guardrails: [], auditTrail: {} } });
    if (path.includes('/alerts/watchlist')) return route.fulfill({ json: {} });
    if (path.includes('/research/jquants/status')) return route.fulfill({ json: { configured: false } });
    return route.fulfill({ json: {} });
  });
}

async function mockFailingApi(page) {
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    return route.fulfill({ status: 503, json: { detail: 'テスト用API停止' } });
  });
}

test('ダッシュボード、練習注文、トップ候補の整合性を表示できる', async ({ page }) => {
  await page.goto('/');
  const summary = page.getByTestId('candidate-summary');
  await expect(summary).toContainText('本日の最有力候補');
  await expect(page.getByTestId('practice-dashboard')).toContainText('練習注文');
  await expect(page.getByText('実注文なし')).toBeVisible();
  await expect(page.getByTestId('data-source-badge').first()).toContainText('データ出所');

  const ticker = extractTicker(await summary.locator('h2').textContent());
  await expect(page.getByTestId('practice-dashboard').locator('input').first()).toHaveValue(ticker);

  await page.getByRole('button', { name: /詳細パネルを表示/ }).click();
  await expect(page.getByTestId('watchlist-panel')).toBeVisible();
  const watchCount = await page.locator('.stock-card').count();
  expect(watchCount).toBeGreaterThan(0);
  expect(watchCount).toBeLessThanOrEqual(6);
  await expect(page.locator('.focus-card')).toContainText(ticker);
  await page.screenshot({ path: 'test-results/zen-dashboard-main.png', fullPage: true });
});

test('監視リストで選んだ銘柄が詳細、チャート、練習注文フォームへ同期される', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  const summary = page.getByTestId('candidate-summary');
  const topTicker = extractTicker(await summary.locator('h2').textContent());
  await expect(page.getByTestId('practice-order-ticker')).toHaveValue(topTicker);

  const selectedTicker = '7203.T';
  await page.getByRole('button', { name: /詳細パネルを表示/ }).click();
  await page.getByTestId('watchlist-stock-card').filter({ hasText: selectedTicker }).click();

  await expect(page.getByTestId('practice-order-ticker')).toHaveValue(selectedTicker);
  await expect(page.getByTestId('ledger-order-ticker')).toHaveValue(selectedTicker);
  await expect(page.getByTestId('practice-chart-symbol')).toContainText(selectedTicker);
  await expect(page.getByTestId('selected-focus-card')).toContainText(selectedTicker);
  await expect(page.getByTestId('practice-order-ticker')).not.toHaveValue(topTicker);
  await page.screenshot({ path: 'test-results/selection-linkage-watchlist.png', fullPage: true });
});

test('補完データの場合は日本語警告と参考表示になる', async ({ page }) => {
  await mockApi(page, 'synthetic');
  await page.goto('/');
  await expect(page.getByText('この価格は実際の市場データではなく、欠損時の補完データです。投資判断には使わないでください。').first()).toBeVisible();
  await expect(page.getByText('参考表示').first()).toBeVisible();
  await expect(page.getByTestId('candidate-summary').getByText(/^買い候補$/)).toHaveCount(0);
  await expect(page.getByTestId('data-source-badge').first()).toContainText('補完データ');
});

test('一時保存データの場合は日本語警告が表示される', async ({ page }) => {
  const data = mockPayload('cache');
  await page.addInitScript(({ key, payload }) => {
    localStorage.setItem(key, JSON.stringify({
      cacheVersion: 4,
      cachedAt: Date.now(),
      selectedTicker: payload.ticker,
      stocks: [payload.stock],
      portfolio: payload.portfolio,
      transactions: [],
      detail: payload.detail,
      marketRankings: { isCached: true, bestAvailableOpportunity: payload.opportunity, items: [payload.stock] },
    }));
  }, { key: CACHE_KEY, payload: data });
  await mockApi(page, 'cache');
  await page.goto('/');
  await expect(page.getByText('この価格は一時保存されたデータです。最新の市場価格と異なる可能性があります。').first()).toBeVisible();
  await expect(page.getByTestId('data-source-badge').first()).toContainText('一時保存データ');
});

test('出所不明データの場合は参考値として表示される', async ({ page }) => {
  await mockApi(page, 'unknown');
  await page.goto('/');
  await expect(page.getByText('データ出所を確認できません。参考値として扱ってください。').first()).toBeVisible();
  await expect(page.getByTestId('data-source-badge').first()).toContainText('出所不明');
});

test('API取得失敗時も画面が壊れず日本語の注意を表示する', async ({ page }) => {
  await mockFailingApi(page);
  await page.goto('/');
  await expect(page.getByTestId('candidate-summary')).toContainText('本日の最有力候補');
  await expect(page.getByText(/一部データ不足|オフライン高速表示|データ不足/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/market-data-api-failure.png', fullPage: true });
});

test('練習注文を保存すると履歴へ約定済みとして反映され、取消済みも記録できる', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  const selectedTicker = '7203.T';
  await page.getByRole('button', { name: /詳細パネルを表示/ }).click();
  await page.getByTestId('watchlist-stock-card').filter({ hasText: selectedTicker }).click();
  await page.getByRole('button', { name: /判断画面に戻す/ }).click();

  await expect(page.getByTestId('practice-order-ticker')).toHaveValue(selectedTicker);
  await page.locator('[data-testid="practice-order-price"]:visible').fill('2990');
  await page.locator('[data-testid="practice-order-shares"]:visible').fill('100');
  await page.locator('[data-testid="practice-order-save"]:visible').click();

  const history = page.getByTestId('practice-history-list');
  await expect(history).toContainText(selectedTicker);
  await expect(history).toContainText('約定済み');
  await expect(page.getByText('実注文なし').first()).toBeVisible();

  await page.locator('[data-testid="practice-order-cancel-current"]:visible').click();
  await expect(history).toContainText('取消済み');
  await page.screenshot({ path: 'test-results/practice-order-saved.png', fullPage: true });
});

test('保有銘柄から選んだ銘柄がフォームへ同期され、台帳状態を更新できる', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  const holdingTicker = '7203.T';
  await page.getByRole('button', { name: /詳細パネルを表示/ }).click();
  await page.getByTestId('holding-row').filter({ hasText: holdingTicker }).click();
  await expect(page.getByTestId('ledger-order-ticker')).toHaveValue(holdingTicker);
  await expect(page.getByTestId('practice-order-ticker')).toHaveValue(holdingTicker);

  await page.getByRole('button', { name: /^非表示$/ }).first().click();
  await expect(page.getByText(/非表示.*完了/).first()).toBeVisible();
});
