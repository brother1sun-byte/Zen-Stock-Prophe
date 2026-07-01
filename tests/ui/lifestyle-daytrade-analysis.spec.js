import { expect, test } from '@playwright/test';
import {
  buildAdvancedConnectionSummary,
  buildAfterCloseReviewDraft,
  buildLifestyleBacktestSummary,
  buildMorningGate,
  buildNightScanRows,
  buildReviewDrivenInsights,
  buildVolumeSeasonality,
  classifyAfterCloseReview,
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

test('出来高季節性は時間帯別の推定精度と証拠を返す', () => {
  const seasonality = buildVolumeSeasonality({
    ...sampleDetail,
    chart: Array.from({ length: 12 }, (_, index) => ({
      close: 3000 + index,
      high: 3010 + index,
      low: 2990 + index,
      volume: index < 3 ? 1800000 : index > 8 ? 1400000 : 700000,
    })),
  }, sampleAdvancedReport);

  expect(seasonality.precision).toContain('推定精度');
  expect(seasonality.sessions.open).toBe('高い');
  expect(seasonality.evidence.join(' ')).toContain('寄り直後');
});

test('スプレッド推定は流動性と値幅の根拠を返す', () => {
  const spread = estimateSpreadRisk({
    stock: { ...sampleStock, liquidityScore: 30, turnoverJpy: 30000000 },
    detail: sampleDetail,
    report: { factors: { liquidityScore: 30, atrPct: 4.5 } },
  });

  expect(spread.estimated).toBe(true);
  expect(spread.evidence.join(' ')).toContain('流動性');
  expect(spread.orderCaution).toContain('証券アプリ');
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

test('After Close Reviewの結果分類は高スコア失敗と早すぎた利確候補を検出できる', () => {
  expect(classifyAfterCloseReview({
    ticker: '7203.T',
    pnl: -3000,
    initialScore: 82,
    missedSignal: '寄り付き直後の急騰後に高値掴み',
  }).label).toBe('高値掴み候補');

  expect(classifyAfterCloseReview({
    ticker: '7203.T',
    pnl: 5000,
    initialScore: 74,
    improvementMemo: '利確が早すぎた。もう少し出来高を確認すべきだった',
  }).label).toBe('利確候補が早すぎた候補');

  expect(classifyAfterCloseReview({
    ticker: '7203.T',
    pnl: -2000,
    initialScore: 80,
    missedSignal: '材料不足を見落とした',
  }).label).toBe('高スコア失敗候補');
});

test('保存レビューの傾向は翌朝と仕事中の注意として使える', () => {
  const insights = buildReviewDrivenInsights([
    {
      ticker: '7203.T',
      pnl: -2000,
      initialScore: 80,
      missedSignal: 'VWAP割れ後も保有継続した',
      improvementMemo: '次回は撤退ライン接近を早めに確認',
      createdAt: '2026-07-01T15:00:00+09:00',
    },
    {
      ticker: '6758.T',
      pnl: 3000,
      initialScore: 48,
      improvementMemo: '利確が早すぎた',
      createdAt: '2026-07-01T15:10:00+09:00',
    },
  ], { ticker: '7203.T' });

  expect(insights.total).toBe(2);
  expect(insights.scoreSummary.summary).toContain('高スコア失敗');
  expect(insights.improvementHints.join(' ')).toContain('VWAP');

  const rows = buildNightScanRows({
    stocks: [sampleStock],
    detailsByTicker: { '7203.T': sampleDetail },
    advancedReportsByTicker: { '7203.T': sampleAdvancedReport },
    reviewInsights: insights,
  });
  expect(rows[0].reviewCaution.cautions.join(' ')).toContain('過去レビュー');

  const gate = buildMorningGate({
    stock: sampleStock,
    detail: sampleDetail,
    advancedReport: sampleAdvancedReport,
    reviewInsights: insights,
    manualPrice: 3005,
  });
  expect(gate.cautions.join(' ')).toContain('過去レビュー');
});
