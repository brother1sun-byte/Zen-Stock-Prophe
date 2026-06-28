import { expect, test } from '@playwright/test';

function buildMockData() {
  const ticker = '4980.T';
  const alternateTicker = '7203.T';
  const stock = {
    ticker,
    name: 'デクセリアルズ',
    emoji: 'DX',
    price: 4869,
    candidateScore: 72,
    candidateReason: '材料確認テスト用の候補です。',
    source: 'yfinance',
    priceSource: 'yfinance',
    dataQuality: { source: 'yfinance', score: 80 },
  };
  const alternateStock = {
    ...stock,
    ticker: alternateTicker,
    name: 'トヨタ自動車',
    emoji: 'TY',
    price: 2973,
    candidateScore: 61,
  };
  const opportunity = {
    ...stock,
    entryPrice: 4860,
    targetPrice: 4920,
    stopLoss: 4820,
    shares: 100,
    budgetUsedJpy: 486000,
    targetProfitJpy: 6000,
    expectedProfitJpy: 3000,
    maxLossJpy: 4000,
    confidencePct: 58,
    opportunityScore: 1200,
    tradeReadiness: 'review',
    positionSizingVerdict: 'normal',
    decisionAudit: { verdict: 'PASS' },
    advancedCrossEngineCheck: { status: 'aligned' },
    whyBuy: ['材料確認用の根拠'],
    whyNotBuy: [],
    invalidConditions: ['一次情報確認前は判断保留'],
    dataFreshness: { source: 'yfinance', priceSource: 'yfinance' },
  };
  const chart = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    open: 4800 + index,
    high: 4820 + index,
    low: 4780 + index,
    close: 4810 + index,
    volume: 100000 + index * 1000,
  }));
  return {
    ticker,
    alternateTicker,
    stock,
    alternateStock,
    opportunity,
    detail: {
      ...stock,
      changePct: 0.4,
      chart,
      analysis: { signal: 'HOLD', confidence: 50, indicators: {} },
      intradayOpportunity: opportunity,
      advancedReport: { ticker, actionLabel: '材料確認', compositeScore: 50, factors: {}, guardrails: [], explainability: [] },
    },
    alternateDetail: {
      ...alternateStock,
      changePct: 0.1,
      chart,
      analysis: { signal: 'HOLD', confidence: 50, indicators: {} },
      advancedReport: { ticker: alternateTicker, actionLabel: '材料確認', compositeScore: 50, factors: {}, guardrails: [], explainability: [] },
    },
  };
}

async function mockPromptApi(page) {
  const data = buildMockData();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path.includes('/research/edinet/documents')) {
      return route.fulfill({
        json: {
          status: 'success',
          startDate: '2026-06-26',
          endDate: '2026-06-29',
          fetchedAt: '2026-06-29T08:30:00+09:00',
          documents: [{
            docID: 'S100P18',
            submitDateTime: '2026-06-26 16:00',
            filerName: 'デクセリアルズ',
            secCode: '49800',
            docDescription: '臨時報告書',
          }],
        },
      });
    }
    if (path.includes('/research/earnings-calendar')) {
      return route.fulfill({
        json: {
          status: 'manual_data',
          source: 'manual',
          startDate: '2026-06-26',
          endDate: '2026-06-29',
          fetchedAt: '2026-06-29T08:31:00+09:00',
          items: [{
            code: '4980',
            companyName: 'デクセリアルズ',
            date: '2026-06-29',
            fiscalPeriod: '1Q',
            scheduledTime: '15:00',
            source: 'J-Quants',
          }],
          sourceStatus: { label: '手動データ', tone: 'warn', detail: 'テスト用の手動データです。' },
        },
      });
    }
    if (path.endsWith('/stocks')) return route.fulfill({ json: [data.stock, data.alternateStock] });
    if (path.includes('/market/rankings')) {
      return route.fulfill({ json: { kind: 'gainers', isCached: false, bestAvailableOpportunity: data.opportunity, bestOpportunity: data.opportunity, items: [data.stock, data.alternateStock] } });
    }
    if (path.includes('/stock/')) {
      return route.fulfill({ json: path.includes(data.alternateTicker) ? data.alternateDetail : data.detail });
    }
    if (path.includes('/analysis/advanced/')) return route.fulfill({ json: { ticker: data.ticker, actionLabel: '材料確認', compositeScore: 50, factors: {}, guardrails: [], explainability: [] } });
    if (path.includes('/portfolio')) return route.fulfill({ json: { cash: 500000, holdings: [], transactions: [], totalAssets: 500000, totalPnl: 0, history: [] } });
    if (path.includes('/transactions')) return route.fulfill({ json: [] });
    if (path.includes('/market/universe')) return route.fulfill({ json: { count: 2, sample: [data.stock, data.alternateStock], snapshot: { provider: 'yfinance' } } });
    if (path.includes('/daytrade/analysis/')) return route.fulfill({ json: { ticker: data.ticker, label: '材料確認', score: 50, indicators: {}, levels: {}, evidence: [], fakeoutFilters: [], backtest: {}, walkForward: {} } });
    if (path.includes('/daytrade/routine/')) return route.fulfill({ json: { priority: '確認', verdict: '材料確認', summary: '一次情報を確認します。', phases: [], mobileSummary: {} } });
    if (path.includes('/daytrade/plan')) return route.fulfill({ json: { premise: '材料確認', rules: {} } });
    if (path.includes('/daytrade/signals')) return route.fulfill({ json: [] });
    if (path.includes('/daytrade/risk-state')) return route.fulfill({ json: { jobsVerdict: '実注文は行いません。', liveOrderMode: 'disabled' } });
    if (path.includes('/daytrade/broker-status')) return route.fulfill({ json: { message: '証券会社には接続しません。' } });
    if (path.includes('/daytrade/autopilot/status')) return route.fulfill({ json: { running: false, mode: 'BROKER_DISABLED' } });
    if (path.includes('/ai-fund/desk')) return route.fulfill({ json: { liveBrokerOrdersEnabled: false, summary: {}, workflow: [], guardrails: [], auditTrail: {} } });
    if (path.includes('/alerts/watchlist')) return route.fulfill({ json: {} });
    if (path.includes('/research/jquants/status')) return route.fulfill({ json: { configured: false } });
    return route.fulfill({ json: {} });
  });
}

test('ウォッチリストのChatGPT相談用プロンプトを作成してコピーできる', async ({ page }) => {
  await page.addInitScript(() => {
    const fixedNow = new Date('2026-06-29T08:30:00+09:00').valueOf();
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]));
      }
      static now() {
        return fixedNow;
      }
    }
    MockDate.UTC = RealDate.UTC;
    MockDate.parse = RealDate.parse;
    window.Date = MockDate;
  });
  await mockPromptApi(page);
  await page.goto('/');
  await page.locator('.detail-toggle').click();

  const singleInsight = page.getByTestId('single-research-insight-panel');
  await expect(singleInsight).toBeVisible();
  await expect(singleInsight).toContainText('根拠付きリサーチ要約');
  await expect(singleInsight).toContainText('データ充足度');
  await expect(singleInsight).toContainText('強材料');
  await expect(singleInsight).toContainText('弱材料');
  await expect(singleInsight).toContainText('不足情報');
  await expect(singleInsight).toContainText('根拠');

  const watchlistInsight = page.getByTestId('watchlist-research-insight-panel');
  await expect(watchlistInsight).toBeVisible();
  await expect(watchlistInsight).toContainText('重要材料サマリー');
  await expect(watchlistInsight).toContainText('データ充足度');
  await expect(watchlistInsight).toContainText('不足情報');
  await expect(watchlistInsight).toContainText('根拠');

  const panel = page.getByTestId('watchlist-chatgpt-prompt-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('ChatGPT APIへ送信しません');
  await expect(panel).toContainText('未取得データ');

  await page.getByTestId('watchlist-prompt-create-button').click();
  const textarea = page.getByTestId('watchlist-prompt-textarea');
  await expect(textarea).toBeVisible();
  await expect(textarea).toContainText('■目的');
  await expect(textarea).toContainText('EDINET');
  await expect(textarea).toContainText('J-Quants');
  await expect(textarea).toContainText('日本営業日');
  await expect(textarea).toContainText('ウォッチリスト一括チェック結果');
  await expect(textarea).toContainText('重要材料サマリー');
  await expect(textarea).toContainText('強材料');
  await expect(textarea).toContainText('弱材料');
  await expect(textarea).toContainText('不足情報');
  await expect(textarea).toContainText('根拠');
  await expect(textarea).toContainText('手動データ');

  await page.getByTestId('watchlist-prompt-copy-button').click();
  await expect(page.getByTestId('watchlist-prompt-copy-status')).toContainText('コピーしました');
  await expect(panel).not.toContainText(/今すぐ買うべき|エントリー推奨|利確推奨|損切り推奨|急騰確定|暴落確定|儲かる|勝てる/);
  await expect(singleInsight).not.toContainText(/今すぐ買うべき|エントリー推奨|利確推奨|損切り推奨|急騰確定|暴落確定|儲かる|勝てる|投資妙味|狙い目|仕込み|反発期待/);
  await expect(watchlistInsight).not.toContainText(/今すぐ買うべき|エントリー推奨|利確推奨|損切り推奨|急騰確定|暴落確定|儲かる|勝てる|投資妙味|狙い目|仕込み|反発期待/);
});

test('CSVインポートでウォッチリストへ追加しTDnet未取得を表示できる', async ({ page }) => {
  await page.addInitScript(() => {
    const fixedNow = new Date('2026-06-29T08:30:00+09:00').valueOf();
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]));
      }
      static now() {
        return fixedNow;
      }
    }
    MockDate.UTC = RealDate.UTC;
    MockDate.parse = RealDate.parse;
    window.Date = MockDate;
  });
  await mockPromptApi(page);
  await page.goto('/');
  await page.locator('.detail-toggle').click();

  const importPanel = page.getByTestId('watchlist-csv-import-panel');
  await expect(importPanel).toBeVisible();
  await expect(importPanel).toContainText('CSVからウォッチリストを追加');
  await page.getByTestId('watchlist-csv-textarea').fill('code,name,market,sector,memo\n6758,ソニーグループ,東証,電気機器,材料確認\nabc,不正行\n7203.T,トヨタ自動車');
  await expect(page.getByTestId('watchlist-import-preview')).toContainText('正常件数');
  await expect(page.getByTestId('watchlist-import-preview')).toContainText('2');
  await expect(page.getByTestId('watchlist-import-preview')).toContainText('スキップ件数');
  await expect(page.getByTestId('watchlist-import-errors')).toContainText('4桁の銘柄コード');

  await page.getByTestId('watchlist-import-apply-button').click();
  await expect(page.getByTestId('watchlist-import-message')).toContainText('ウォッチリストへ');
  await expect(page.getByTestId('watchlist-preopen-panel')).toContainText('6758.T');
  await expect(page.getByTestId('watchlist-research-insight-panel')).toContainText('TDnet相当データ');

  const tdnetPanel = page.getByTestId('tdnet-source-status-panel');
  await expect(tdnetPanel).toBeVisible();
  await expect(tdnetPanel).toContainText('TDnet相当データ未取得');
  await expect(tdnetPanel).toContainText('スクレイピングは行いません');
  await expect(importPanel).not.toContainText(/今すぐ買うべき|エントリー推奨|利確推奨|損切り推奨|急騰確定|暴落確定|儲かる|勝てる|投資妙味|狙い目|仕込み|反発期待/);
});

test('データ設定パネルでAPI状態とサンプル導線を確認できる', async ({ page }) => {
  await page.addInitScript(() => {
    const fixedNow = new Date('2026-06-29T08:30:00+09:00').valueOf();
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]));
      }
      static now() {
        return fixedNow;
      }
    }
    MockDate.UTC = RealDate.UTC;
    MockDate.parse = RealDate.parse;
    window.Date = MockDate;
  });
  await mockPromptApi(page);
  await page.goto('/');
  await page.locator('.detail-toggle').click();

  const panel = page.getByTestId('app-settings-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('データ設定');
  await expect(panel).toContainText('EDINET');
  await expect(panel).toContainText('J-Quants');
  await expect(panel).toContainText('TDnet相当データ');
  await expect(panel).toContainText('日本祝日データ');
  await expect(panel).toContainText('ChatGPT APIへ送信しません');
  await expect(panel).toContainText('実注文機能はありません');
  await expect(panel).toContainText('証券会社APIには接続しません');
  await expect(page.getByTestId('sample-data-links')).toContainText('docs/samples/watchlist-sample.csv');
  await expect(page.getByTestId('sample-data-links')).toContainText('docs/release-checklist.md');
  await expect(panel).not.toContainText(/今すぐ買うべき|エントリー推奨|利確推奨|損切り推奨|急騰確定|暴落確定|儲かる|勝てる|投資妙味|狙い目|仕込み|反発期待/);
});
