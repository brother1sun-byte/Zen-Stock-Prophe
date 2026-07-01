import { expect, test } from '@playwright/test';
import {
  buildAdvancedConnectionSummary,
  buildAfterCloseReviewDraft,
  buildLifestyleBacktestSummary,
  buildMorningGate,
  buildNightScanRows,
  buildVolumeSeasonality,
  estimateSpreadRisk,
  loadAfterCloseReviewLog,
  saveAfterCloseReviewDraft,
} from '../../src/utils/lifestyleDaytradeModes';

const sampleStock = {
  ticker: '7203.T',
  name: 'トヨタ自動車',
  price: 3000,
  candidateScore: 74,
  volume: 1800000,
  liquidityScore: 78,
};

const sampleDetail = {
  ...sampleStock,
  chart: [
    { date: '2026-06-22', high: 2880, low: 2820, close: 2860, volume: 620000 },
    { date: '2026-06-23', high: 2920, low: 2860, close: 2900, volume: 700000 },
    { date: '2026-06-24', high: 2960, low: 2890, close: 2940, volume: 820000 },
    { date: '2026-06-25', high: 3020, low: 2945, close: 3000, volume: 1800000 },
  ],
  analysis: {
    strategy: {
      buy_limit: 3010,
      take_profit: 3060,
      stop_loss: 2970,
    },
    indicators: { vwap: 2992 },
  },
};

const sampleAdvancedReport = {
  ticker: '7203.T',
  compositeScore: 68,
  factors: {
    trend: { score: 66, state: '確認推奨' },
    liquidityScore: 82,
    riskControlScore: 61,
    volumeRatio: 1.42,
    atrPct: 2.1,
  },
  walkForward: {
    score: 63,
    sampleCount: 24,
    hitRatePct: 58.3,
  },
  backtest: {
    sampleCount: 42,
    winRatePct: 55.2,
    profitFactor: 1.18,
    maxDrawdownPct: 6.4,
  },
  analysisReliability: { score: 70, label: '検証材料あり' },
  dataQuality: { score: 76, source: 'yfinance取得' },
};

test('生活導線Night Scanは既存高度分析と検証材料を接続する', () => {
  const rows = buildNightScanRows({
    stocks: [sampleStock],
    detailsByTicker: { '7203.T': sampleDetail },
    advancedReportsByTicker: { '7203.T': sampleAdvancedReport },
    watchlistResults: [{ ticker: '7203.T', status: '確認推奨', risk: 'low', unknownInputs: [] }],
  });

  expect(rows).toHaveLength(1);
  expect(rows[0].advancedSummary.status).toBe('高度分析接続済み');
  expect(rows[0].backtestSummary.status).toBe('検証材料あり');
  expect(rows[0].volumeSeasonality.status).toContain('推定');
  expect(rows[0].spreadRisk.status).toContain('スプレッド');
});

test('Morning Gateは手入力価格と高度分析証拠を同時に扱う', () => {
  const gate = buildMorningGate({
    stock: sampleStock,
    detail: sampleDetail,
    advancedReport: sampleAdvancedReport,
    preopenResult: { status: '確認推奨', risk: 'low', unknownInputs: [] },
    manualPrice: 3005,
  });

  expect(gate.advancedSummary.status).toBe('高度分析接続済み');
  expect(gate.backtestSummary.summary).toContain('検証');
  expect(gate.spreadRisk.estimated).toBe(true);
  expect(gate.volumeSeasonality.estimated).toBe(true);
});

test('高度分析・出来高季節性・スプレッド推定は単独でも安全に返る', () => {
  expect(buildAdvancedConnectionSummary(sampleAdvancedReport).items.join(' ')).toContain('流動性');
  expect(buildLifestyleBacktestSummary(sampleAdvancedReport).notice).toContain('利益保証ではなく');
  expect(buildVolumeSeasonality(sampleDetail, sampleAdvancedReport).notice).toContain('推定');
  expect(estimateSpreadRisk({ stock: sampleStock, detail: sampleDetail, report: sampleAdvancedReport }).notice).toContain('板厚');
});

test('After Close Reviewはローカル改善ログとして保存できる', () => {
  const memoryStorage = {
    value: '',
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
  };
  const draft = buildAfterCloseReviewDraft({
    ticker: '7203.T',
    entryPrice: 3000,
    exitPrice: 3040,
    shares: 100,
    improvementMemo: '次回は寄り付き後の出来高確認を待つ',
  });
  const result = saveAfterCloseReviewDraft(draft, memoryStorage);

  expect(result.ok).toBe(true);
  expect(result.records).toHaveLength(1);
  expect(loadAfterCloseReviewLog(memoryStorage)[0].improvementMemo).toContain('出来高確認');
});
