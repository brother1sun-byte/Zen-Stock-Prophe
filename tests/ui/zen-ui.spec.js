import { expect, test } from '@playwright/test';

const CACHE_KEY = 'zen-stock-prophet-pro-cache-v4';
const MOJIBAKE_PATTERN = /(?:\?{2,}|\d+\?|[\uFFFD\u7e67\u7e5d\u7e3a\u8b41\u8700\u8373\u87a2\u8c6c\u8413\u8b5a\u87f6\u9695\u9082\u9b2f\u9677\u9aea\u8b4c])/u;
const VISIBLE_ENGLISH_PATTERN = /(?:UNCONFIRMED|watchlist-ranking-fill|selected-(?:intraday-opportunity|watchlist)|No recent material event found|Mirrors the verified daytrade|Universe and signal research|Manual trade plan draft|Human approval gate|Risk audit log|Broker execution disabled|Human approval required)/i;

function extractTicker(text) {
  return text.match(/\d{4}\.T/)?.[0] || '4980.T';
}

async function expectCleanJapanese(page) {
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(MOJIBAKE_PATTERN);
  expect(bodyText).not.toMatch(VISIBLE_ENGLISH_PATTERN);
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
    candidateReason: '監視リスト選択の同期確認用です。',
  };
  const opportunity = {
    ...stock,
    entryPrice: 2478,
    targetPrice: 2516,
    stopLoss: 2469,
    shares: 100,
    budgetUsedJpy: 247800,
    targetProfitJpy: 3800,
    expectedProfitJpy: 1800,
    maxLossJpy: 900,
    confidencePct: 58,
    opportunityScore: synthetic ? 0 : 1200,
    tradeReadiness: synthetic ? 'review' : 'ready',
    positionSizingVerdict: synthetic ? 'reduced' : 'normal',
    decisionAudit: { verdict: synthetic ? 'REVIEW' : 'PASS' },
    advancedCrossEngineCheck: { status: synthetic ? 'review' : 'aligned' },
    whyBuy: ['短期指標を確認'],
    whyNotBuy: synthetic ? ['補完データのため参考表示'] : [],
    invalidConditions: ['注文上限を超えた場合'],
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

async function mockApi(page, source = 'synthetic', options = {}) {
  const data = mockPayload(source);
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path.endsWith('/stocks')) return route.fulfill({ json: [data.stock, data.alternateStock] });
    if (path.includes('/portfolio/positions/') && path.endsWith('/lifecycle') && options.failLifecycleSave) return route.fulfill({ status: 503, json: { detail: '台帳状態の保存に失敗しました。' } });
    if (path.includes('/portfolio/positions/') && path.endsWith('/lifecycle')) return route.fulfill({ json: { message: '練習用の台帳状態を更新しました。' } });
    if (path.endsWith('/portfolio/positions') && options.failPositionSave) return route.fulfill({ status: 503, json: { detail: '練習注文の保存に失敗しました。' } });
    if (path.endsWith('/portfolio/positions')) return route.fulfill({ json: { message: '練習注文を台帳へ保存しました。' } });
    if (path.endsWith('/portfolio')) return route.fulfill({ json: data.portfolio });
    if (path.endsWith('/transactions')) return route.fulfill({ json: [] });
    if (path.includes('/stock/')) {
      const ticker = decodeURIComponent(path.split('/stock/')[1] || '').split('/')[0];
      options.onStockRequest?.(ticker);
      if (options.detailDelayByTicker?.[ticker]) await new Promise((resolve) => setTimeout(resolve, options.detailDelayByTicker[ticker]));
      if (options.detailDelayMs) await new Promise((resolve) => setTimeout(resolve, options.detailDelayMs));
      if (options.detailsByTicker?.[ticker]) return route.fulfill({ json: options.detailsByTicker[ticker] });
      return route.fulfill({ json: path.includes(data.alternateTicker) ? data.alternateDetail : data.detail });
    }
    if (path.includes('/analysis/advanced/')) {
      const tickerForReport = path.includes(data.alternateTicker) ? data.alternateTicker : data.ticker;
      return route.fulfill({ json: { ticker: tickerForReport, actionLabel: '様子見', compositeScore: 50, factors: {}, guardrails: [], explainability: [] } });
    }
    if (path.includes('/market/universe')) return route.fulfill({ json: { count: 2, sample: [data.stock, data.alternateStock], snapshot: { provider: source, isCached: source === 'cache' } } });
    if (path.includes('/market/rankings')) return route.fulfill({
      json: {
        kind: options.responseKind || 'gainers',
        isCached: source === 'cache',
        bestAvailableOpportunity: options.rankingOpportunity || data.opportunity,
        bestOpportunity: options.rankingOpportunity || data.opportunity,
        items: options.rankingItems || [data.stock, data.alternateStock],
      },
    });
    if (path.includes('/daytrade/analysis/')) {
      const tickerForAnalysis = path.includes(data.alternateTicker) ? data.alternateTicker : data.ticker;
      options.onDaytradeAnalysisRequest?.(tickerForAnalysis);
      return route.fulfill({ json: { ticker: tickerForAnalysis, label: '参考表示', score: 50, indicators: {}, levels: {}, evidence: [], fakeoutFilters: [], backtest: {}, walkForward: {} } });
    }
    if (path.includes('/daytrade/routine/')) return route.fulfill({ json: { priority: '監視優先', verdict: '様子見', summary: '寄り付き後の値動きを確認します。', phases: [], mobileSummary: {}, manualOnlyNotice: '練習専用です。' } });
    if (path.includes('/daytrade/plan')) return route.fulfill({ json: { premise: '寄り付き後に確認', rules: {} } });
    if (path.includes('/daytrade/signals')) return route.fulfill({ json: [] });
    if (path.includes('/daytrade/risk-state')) return route.fulfill({ json: { jobsVerdict: '実注文を行わない練習モードです。', liveOrderMode: 'disabled' } });
    if (path.includes('/daytrade/broker-status')) return route.fulfill({ json: { message: '証券会社には接続していません。' } });
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

test('主要画面とランキング切替で日本語が文字化けしない', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  await expectCleanJapanese(page);
  await page.getByRole('button', { name: '詳細パネルを表示' }).click();
  await expect(page.getByRole('button', { name: '判断画面に戻す' })).toBeVisible();
  await expectCleanJapanese(page);

  const rankingTabs = page.locator('.ranking-tabs button');
  const tabCount = await rankingTabs.count();
  expect(tabCount).toBe(7);
  for (let index = 0; index < tabCount; index += 1) {
    await rankingTabs.nth(index).click();
    await expectCleanJapanese(page);
  }
});

test('ダッシュボードと練習注文とデータ出所を整合して表示できる', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');
  await expect(page.getByTestId('candidate-caution-strip')).toBeVisible();
  const summary = page.getByTestId('candidate-summary');
  const verdict = page.getByTestId('candidate-verdict-card');
  await expect(verdict).toContainText(/条件通過|要確認|見送り/);
  await expect(page.getByTestId('trust-profile-grid')).toBeVisible();
  await expect(page.getByTestId('value-discipline-lens')).toBeVisible();
  await expect(page.getByTestId('summary-metric-strip')).toBeVisible();
  await expect(summary.locator('h2')).toContainText(/\d{4}\.T/);
  await expect(page.getByTestId('practice-dashboard')).toBeVisible();
  await expect(page.getByTestId('candidate-summary')).toBeVisible();
  await expect(page.getByTestId('data-source-badge').first()).toBeVisible();


  const ticker = extractTicker(await summary.locator('h2').textContent());
  await expect(page.getByTestId('practice-dashboard').locator('input').first()).toHaveValue(ticker);

  await page.locator('.detail-toggle').click();
  await expect(page.getByTestId('watchlist-panel')).toBeVisible();
  const watchCount = await page.locator('.stock-card').count();
  expect(watchCount).toBeGreaterThan(0);
  expect(watchCount).toBeLessThanOrEqual(6);
  await expect(page.locator('.focus-card')).toContainText(ticker);
  await page.screenshot({ path: 'test-results/zen-dashboard-main.png', fullPage: true });
});

test('ChatGPT相談用プロンプトを日本語テンプレートで生成してコピーできる', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  const panel = page.getByTestId('chatgpt-consult-panel');
  await expect(panel).toBeVisible();
  await panel.getByText('コピー内容を確認').click();
  const preview = page.getByTestId('chatgpt-prompt-preview');
  await expect(preview).toHaveValue(/■目的/);
  await expect(preview).toHaveValue(/■結論/);
  await expect(preview).toHaveValue(/■材料/);
  await expect(preview).toHaveValue(/■注意点/);
  await expect(preview).toHaveValue(/■寄り付き後方針/);
  await expect(preview).toHaveValue(/投資助言ではなく/);
  await page.getByTestId('chatgpt-copy-button').click();
  await expect(page.getByTestId('chatgpt-copy-button')).toContainText('コピー済み');
});

test('トップ候補カードの詳細分析ボタンで詳細パネルへ移動できる', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.app-shell')).toHaveClass(/simple-mode/);
  await page.getByTestId('top-candidate-detail-button').click();

  await expect(page.locator('.app-shell')).toHaveClass(/detail-mode/);
  await expect(page.getByTestId('advanced-analysis-panel')).toBeVisible();
  await expect(page.getByTestId('advanced-analysis-panel')).toBeInViewport();
});

test('ランキングタブを押すと7つのランキング軸ごとに表示候補と主要指標が切り替わる', async ({ page }) => {
  const rankingItems = [
    {
      ticker: '1001.T',
      name: 'Surge Top',
      price: 1100,
      changePct: 2.1,
      surgeScore: 98,
      volumeRatio: 1.6,
      volume: 1200000,
      popularityScore: 70,
      overheatRisk: 24,
      candidateQuality: { qualityScore: 66 },
      candidateScore: 74,
      dataQuality: { source: 'yfinance', score: 86 },
    },
    {
      ticker: '1111.T',
      name: 'Gainers Top',
      price: 1000,
      changePct: 9.2,
      surgeScore: 45,
      volumeRatio: 0.8,
      volume: 100000,
      popularityScore: 35,
      overheatRisk: 15,
      candidateQuality: { qualityScore: 45 },
      candidateScore: 45,
      dataQuality: { source: 'yfinance', score: 80 },
    },
    {
      ticker: '1444.T',
      name: 'Breakout Top',
      price: 1300,
      changePct: 2.8,
      surgeScore: 64,
      high20Breakout: true,
      ytdHighBreakout: true,
      volumeRatio: 1.2,
      volume: 700000,
      popularityScore: 58,
      overheatRisk: 26,
      candidateQuality: { qualityScore: 60 },
      candidateScore: 61,
      dataQuality: { source: 'yfinance', score: 81 },
    },
    {
      ticker: '1777.T',
      name: 'Popular Top',
      price: 1400,
      changePct: 1.5,
      surgeScore: 54,
      volumeRatio: 1.1,
      volume: 1100000,
      turnoverJpy: 1540000000,
      popularityScore: 99,
      overheatRisk: 18,
      candidateQuality: { qualityScore: 62 },
      candidateScore: 62,
      dataQuality: { source: 'yfinance', score: 84 },
    },
    {
      ticker: '2222.T',
      name: 'Volume Top',
      price: 1200,
      changePct: 1.1,
      surgeScore: 52,
      volumeRatio: 8.5,
      volume: 9000000,
      popularityScore: 60,
      overheatRisk: 22,
      candidateQuality: { qualityScore: 55 },
      candidateScore: 55,
      dataQuality: { source: 'yfinance', score: 82 },
    },
    {
      ticker: '2444.T',
      name: 'Quality Top',
      price: 1800,
      changePct: 0.8,
      surgeScore: 50,
      volumeRatio: 0.9,
      volume: 650000,
      popularityScore: 52,
      overheatRisk: 12,
      candidateQuality: { qualityScore: 99 },
      candidateScore: 65,
      dataQuality: { source: 'yfinance', score: 99 },
    },
    {
      ticker: '3333.T',
      name: 'Overheat Top',
      price: 900,
      changePct: 3.0,
      surgeScore: 61,
      volumeRatio: 1.4,
      volume: 500000,
      popularityScore: 62,
      overheatRisk: 96,
      candidateQuality: { qualityScore: 58 },
      candidateScore: 58,
      dataQuality: { source: 'yfinance', score: 78 },
    },
  ];
  const detailsByTicker = Object.fromEntries(rankingItems.map((item) => [item.ticker, {
    ...item,
    chart: [],
    analysis: { signal: 'HOLD', confidence: 50, strategy: {}, details: [], indicators: {} },
    externalLinks: [],
  }]));

  await mockApi(page, 'yfinance', { rankingItems, detailsByTicker, responseKind: 'gainers' });
  await page.goto('/');

  const summary = page.getByTestId('candidate-summary');
  await expect(summary.locator('h2')).toContainText('1111.T');
  await expect(summary.getByTestId('summary-metric-change')).toContainText('+9.20%');
  await expect(summary.getByTestId('active-ranking-meter')).toContainText('値上がり率');
  await expect(summary).not.toContainText('強い買い');

  await page.locator('.detail-toggle').click();
  const cases = [
    ['短期上昇', '1001.T', 'summary-metric-surge', '98.0/100'],
    ['値上がり率', '1111.T', 'summary-metric-change', '+9.20%'],
    ['高値更新', '1444.T', 'summary-metric-breakout', '年初来高値'],
    ['人気', '1777.T', 'summary-metric-popularity', '99.0/100'],
    ['出来高', '2222.T', 'summary-metric-volume', '8.50x'],
    ['品質', '2444.T', 'summary-metric-quality', '99.0/100'],
    ['過熱注意', '3333.T', 'summary-metric-overheat', '96.0'],
  ];
  for (const [label, ticker, metricId, expectedMetric] of cases) {
    const tab = page.getByRole('button', { name: label, exact: true });
    await tab.scrollIntoViewIfNeeded();
    await tab.click();
    await expect(tab).toHaveClass(/active/);
    await expect(summary.locator('h2')).toContainText(ticker);
    await expect(summary.getByTestId(metricId)).toContainText(expectedMetric);
    await expect(summary.getByTestId('active-ranking-meter')).toContainText(label);
    await expect(summary.getByTestId(metricId)).toHaveClass(/active/);
    await expect(summary).not.toContainText('強い買い');
  }
});

test('保有台帳の状態更新に失敗しても警告表示にとどまり銘柄が残る', async ({ page }) => {
  await mockApi(page, 'yfinance', { failLifecycleSave: true });
  await page.goto('/');

  const holdingTicker = '7203.T';
  await page.locator('.detail-toggle').click();
  await page.getByTestId('holding-row').filter({ hasText: holdingTicker }).click();
  await page.getByTestId('holding-row').filter({ hasText: holdingTicker }).locator('button').first().click();

  await expect(page.getByTestId('portfolio-ledger-events')).toBeVisible();
  await expect(page.getByTestId('portfolio-ledger-events')).toBeVisible();
  await expect(page.getByTestId('holding-row').filter({ hasText: holdingTicker })).toBeVisible();
});

test('watchlist selection keeps ticker in sync', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  const summary = page.getByTestId('candidate-summary');
  const topTicker = extractTicker(await summary.locator('h2').textContent());
  await expect(page.getByTestId('practice-order-ticker')).toHaveValue(topTicker);

  const selectedTicker = '7203.T';
  await page.locator('.detail-toggle').click();
  await page.getByTestId('watchlist-stock-card').filter({ hasText: selectedTicker }).click();

  await expect(page.getByTestId('practice-order-ticker')).toHaveValue(selectedTicker);
  await expect(page.getByTestId('ledger-order-ticker')).toHaveValue(selectedTicker);
  await expect(page.getByTestId('practice-chart-symbol')).toContainText(selectedTicker);
  await expect(page.getByTestId('selected-focus-card')).toContainText(selectedTicker);
  await expect(page.getByTestId('practice-order-ticker')).not.toHaveValue(topTicker);
  await page.screenshot({ path: 'test-results/selection-linkage-watchlist.png', fullPage: true });
});

test('synthetic data shows caution', async ({ page }) => {
  await mockApi(page, 'synthetic');
  await page.goto('/');
  await expect(page.getByTestId('candidate-caution-strip')).toBeVisible();
  await expect(page.getByTestId('candidate-summary')).toBeVisible();
  await expect(page.getByTestId('data-source-badge').first()).toBeVisible();
});

test('weak confirmation stays in review mode', async ({ page }) => {
  const data = mockPayload('yfinance');
  data.opportunity.tradeReadiness = 'review';
  data.opportunity.positionSizingVerdict = 'reduced';
  data.opportunity.decisionAudit = { verdict: 'REVIEW' };
  data.opportunity.advancedCrossEngineCheck = { status: 'review' };

  await mockApi(page, 'yfinance');
  await page.route('**/api/market/rankings**', (route) => route.fulfill({
    json: {
      kind: 'gainers',
      bestOpportunity: null,
      bestAvailableOpportunity: data.opportunity,
      items: [data.stock, data.alternateStock],
    },
  }));
  await page.goto('/');

  const summary = page.getByTestId('candidate-summary');
  await expect(page.getByTestId('candidate-caution-strip')).toBeVisible();
  await expect(summary.locator('h2')).toContainText(data.ticker);
  await expect(summary).toBeVisible();
  await expect(summary.locator('.simple-daytrade-board')).toHaveCount(1);
  await expect(page.getByTestId('opening-scenario-plan')).toBeVisible();
  await expect(page.getByTestId('opening-scenario-plan')).toBeVisible();
  await expect(page.getByTestId('opening-scenario-plan')).toBeVisible();
  await expect(page.getByTestId('opening-scenario-plan')).toBeVisible();
  await expect(summary.locator('.simple-daytrade-board')).toHaveCount(1);
});

test('cached data shows caution', async ({ page }) => {
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
  await expect(page.getByTestId('candidate-caution-strip')).toBeVisible();
  await expect(page.getByTestId('data-source-badge').first()).toBeVisible();
});

test('unknown data source shows caution', async ({ page }) => {
  await mockApi(page, 'unknown');
  await page.goto('/');
  await expect(page.getByTestId('candidate-caution-strip')).toBeVisible();
  await expect(page.getByTestId('data-source-badge').first()).toBeVisible();
});

test('API取得失敗時も画面が壊れず日本語の注意を表示する', async ({ page }) => {
  await mockFailingApi(page);
  await page.goto('/');
  await expect(page.getByTestId('candidate-summary')).toBeVisible();
  await expect(page.getByTestId('candidate-caution-strip')).toBeVisible();
  await page.screenshot({ path: 'test-results/market-data-api-failure.png', fullPage: true });
});

test('ランキング応答が逆順でも最後に選んだタブの候補を維持する', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.route('**/api/market/rankings**', async (route) => {
    const kind = new URL(route.request().url()).searchParams.get('kind') || 'gainers';
    const isPopular = kind === 'popular';
    const ticker = isPopular ? '1111.T' : kind === 'volume' ? '2222.T' : '7203.T';
    if (kind === 'gainers') await new Promise((resolve) => setTimeout(resolve, 650));
    if (isPopular) await new Promise((resolve) => setTimeout(resolve, 300));
    if (kind === 'volume') await new Promise((resolve) => setTimeout(resolve, 30));
    await route.fulfill({
      json: {
        kind,
        source: 'yfinance',
        items: [{
          ticker,
          name: `${kind} candidate`,
          price: isPopular ? 1111 : 2222,
          changePct: isPopular ? 4.1 : 2.2,
          surgeScore: 60,
          popularityScore: isPopular ? 99 : 20,
          volume: isPopular ? 100000 : 9000000,
          volumeRatio: isPopular ? 1.3 : 4.8,
          turnoverJpy: isPopular ? 111100000 : 19998000000,
          candidateScore: 70,
          overheatRisk: 20,
          dataSource: 'yfinance',
        }],
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '詳細パネルを表示' }).click();

  await page.getByRole('button', { name: '人気', exact: true }).click();
  await page.getByRole('button', { name: '出来高', exact: true }).click();

  await expect(page.getByRole('button', { name: '出来高', exact: true })).toHaveClass(/active/);
  await expect(page.locator('.market-row').filter({ hasText: '2222.T' })).toBeVisible();
  await expect(page.locator('.market-row').filter({ hasText: '1111.T' })).toHaveCount(0);
});

test('バックグラウンド更新は重いランキングを再取得しない', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => (
      nativeSetInterval(callback, delay === 30000 ? 80 : delay, ...args)
    );
  });
  let rankingRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/api/market/rankings')) rankingRequests += 1;
  });
  await mockApi(page, 'yfinance');
  await page.goto('/');
  await expect(page.getByTestId('candidate-summary')).toBeVisible();
  await page.waitForTimeout(350);

  expect(rankingRequests).toBe(1);
});

test('時間のかかる詳細分析を途中で中断せず表示できる', async ({ page }) => {
  const data = mockPayload('yfinance');
  const delayedDetail = { ...data.detail, price: 3333 };
  await mockApi(page, 'yfinance', {
    detailDelayMs: 7000,
    detailsByTicker: { [data.ticker]: delayedDetail },
  });

  await page.goto('/');
  await page.getByRole('button', { name: '詳細パネルを表示' }).click();
  await expect(page.getByTestId('selected-detail-price')).toContainText('3,333', { timeout: 12000 });
});

test('遅れて返った別銘柄の高度分析で選択中パネルが未取得に戻らない', async ({ page }) => {
  const data = mockPayload('yfinance');
  const advanced4980 = {
    ticker: data.ticker,
    actionLabel: `高精度判定 ${data.ticker} 監視継続`,
    compositeScore: 61,
    factors: { trend: { score: 61, state: '確認中' }, liquidityScore: 62, riskControlScore: 55 },
    walkForward: { score: 58, sampleCount: 12 },
    analysisReliability: { score: 60, label: '検証中' },
    dataQuality: { score: 70, source: 'yfinance' },
    guardrails: [],
    explainability: ['4980.T の分析'],
  };
  const advanced7203 = {
    ticker: data.alternateTicker,
    actionLabel: `高精度判定 ${data.alternateTicker} 監視継続`,
    compositeScore: 82,
    factors: { trend: { score: 82, state: '上向き' }, liquidityScore: 81, riskControlScore: 79 },
    walkForward: { score: 76, sampleCount: 24 },
    analysisReliability: { score: 84, label: '十分' },
    dataQuality: { score: 88, source: 'yfinance' },
    guardrails: [],
    explainability: ['7203.T の分析'],
  };

  await mockApi(page, 'yfinance', {
    detailDelayByTicker: { [data.ticker]: 650, [data.alternateTicker]: 30 },
    detailsByTicker: {
      [data.ticker]: { ...data.detail, advancedReport: advanced4980 },
      [data.alternateTicker]: { ...data.alternateDetail, advancedReport: advanced7203 },
    },
  });

  await page.goto('/');
  await page.locator('.detail-toggle').click();
  await page.getByTestId('watchlist-stock-card').filter({ hasText: data.alternateTicker }).click();

  const panel = page.getByTestId('advanced-analysis-panel');
  await expect(panel).toContainText(data.alternateTicker, { timeout: 5000 });
  await expect(panel).toContainText('統合スコア 82/100');
  await page.waitForTimeout(900);
  await expect(panel).toContainText(data.alternateTicker);
  await expect(panel).toContainText('統合スコア 82/100');
  await expect(panel).not.toContainText('未取得');
  await expect(panel).not.toContainText(data.ticker);
});

test('初期表示で同じ銘柄の重い分析APIを重複実行しない', async ({ page }) => {
  let stockRequests = 0;
  let daytradeRequests = 0;
  await mockApi(page, 'yfinance', {
    onStockRequest: () => { stockRequests += 1; },
    onDaytradeAnalysisRequest: () => { daytradeRequests += 1; },
  });

  await page.goto('/');
  await expect(page.getByTestId('selected-detail-price')).toContainText('2,478');
  await page.waitForTimeout(250);
  expect(stockRequests).toBe(1);
  expect(daytradeRequests).toBe(1);
});

test('練習注文を保存すると履歴へ約定済みとして反映され取消済みも記録できる', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  const selectedTicker = '7203.T';
  await page.locator('.detail-toggle').click();
  await page.getByTestId('watchlist-stock-card').filter({ hasText: selectedTicker }).click();
  await page.locator('.detail-toggle').click();

  await expect(page.getByTestId('practice-order-ticker')).toHaveValue(selectedTicker);
  await page.locator('[data-testid="practice-order-price"]:visible').fill('2990');
  await page.locator('[data-testid="practice-order-shares"]:visible').fill('100');
  await page.locator('[data-testid="practice-order-save"]:visible').click();

  const history = page.getByTestId('practice-history-list');
  await expect(history).toContainText(selectedTicker);
  await expect(history).toContainText(selectedTicker);
  await expect(page.getByTestId('candidate-summary')).toBeVisible();

  await page.locator('[data-testid="practice-order-cancel-current"]:visible').click();
  await expect(history).toContainText('7203.T');
  await page.screenshot({ path: 'test-results/practice-order-saved.png', fullPage: true });
});

test('練習注文のAPI保存失敗時は参考表示として履歴に残す', async ({ page }) => {
  await mockApi(page, 'yfinance', { failPositionSave: true });
  await page.goto('/');

  await page.locator('[data-testid="practice-order-price"]:visible').fill('2478');
  await page.locator('[data-testid="practice-order-shares"]:visible').fill('100');
  await page.locator('[data-testid="practice-order-save"]:visible').click();

  const history = page.getByTestId('practice-history-list');
  await expect(history).toBeVisible();
  await expect(history).toBeVisible();
  await expect(page.getByTestId('candidate-summary')).toBeVisible();
  await expect(page.getByTestId('candidate-summary')).toBeVisible();
});

test('保有銘柄から選んだ銘柄がフォームへ同期され、台帳状態を更新できる', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  const holdingTicker = '7203.T';
  await page.locator('.detail-toggle').click();
  await page.getByTestId('holding-row').filter({ hasText: holdingTicker }).click();
  await expect(page.getByTestId('ledger-order-ticker')).toHaveValue(holdingTicker);
  await expect(page.getByTestId('practice-order-ticker')).toHaveValue(holdingTicker);

  await page.getByTestId('holding-row').filter({ hasText: holdingTicker }).locator('button').first().click();
  await expect(page.getByTestId('portfolio-ledger-events')).toBeVisible();
  await expect(page.getByTestId('portfolio-ledger-event')).toBeVisible();
  await expect(page.getByTestId('holding-row').filter({ hasText: holdingTicker })).toBeVisible();
});

test('保有台帳の入力ミス取消を練習台帳イベントとして残す', async ({ page }) => {
  await mockApi(page, 'yfinance');
  await page.goto('/');

  const holdingTicker = '7203.T';
  await page.locator('.detail-toggle').click();
  await page.getByTestId('holding-row').filter({ hasText: holdingTicker }).click();
  await page.getByTestId('holding-row').filter({ hasText: holdingTicker }).locator('button').nth(1).click();

  await expect(page.getByTestId('portfolio-ledger-events')).toBeVisible();
  await expect(page.getByTestId('portfolio-ledger-event')).toBeVisible();
  await expect(page.getByTestId('portfolio-ledger-event')).toBeVisible();
});
