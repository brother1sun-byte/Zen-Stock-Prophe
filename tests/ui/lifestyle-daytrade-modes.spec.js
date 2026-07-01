import { expect, test } from '@playwright/test';
import {
  buildAfterCloseReviewDraft,
  buildMorningGate,
  buildNightScanRows,
  buildWorkMonitorRows,
} from '../../src/utils/lifestyleDaytradeModes';

const sampleStock = {
  ticker: '7203.T',
  name: 'トヨタ自動車',
  price: 3000,
  candidateScore: 74,
  volume: 1800000,
  previousClose: 2960,
};

const sampleDetail = {
  ...sampleStock,
  chart: [
    { date: '2026-06-24', high: 2920, low: 2860, close: 2900, volume: 700000 },
    { date: '2026-06-25', high: 2960, low: 2890, close: 2940, volume: 820000 },
    { date: '2026-06-26', high: 3020, low: 2945, close: 3000, volume: 1800000 },
  ],
  analysis: {
    strategy: {
      buy_limit: 3010,
      take_profit: 3060,
      stop_loss: 2970,
      rr_ratio: 1.8,
    },
    indicators: {
      vwap: 2992,
    },
  },
};

test('生活導線の夜チェックは翌朝確認候補を安全な表現で分類できる', () => {
  const rows = buildNightScanRows({
    stocks: [sampleStock],
    detailsByTicker: { '7203.T': sampleDetail },
    watchlistResults: [{
      ticker: '7203.T',
      status: '確認推奨',
      risk: 'medium',
      hasEarnings: false,
      hasEdinetDocuments: false,
      unknownInputs: [],
    }],
  });

  expect(rows).toHaveLength(1);
  expect(rows[0].phaseLabel).toBe('翌朝確認候補');
  expect(['A：翌朝必ず確認', 'B：条件次第で確認', 'C：監視のみ', 'D：見送り']).toContain(rows[0].rankLabel);
  expect(rows[0].priceLines.orderLimit.label).toBe('注文上限価格');
  expect(rows[0].priceLines.exitLine.label).toBe('撤退ライン');
});

test('朝チェックは手入力価格で注文上限との差を再計算できる', () => {
  const gate = buildMorningGate({
    stock: sampleStock,
    detail: sampleDetail,
    preopenResult: { status: '確認推奨', risk: 'medium', unknownInputs: [] },
    manualPrice: 3005,
  });

  expect(gate.modeLabel).toBe('Morning Gate');
  expect(gate.manualPriceUsed).toBe(true);
  expect(gate.orderLimitDistance.value).toBeCloseTo(5, 5);
  expect(['条件付きで手動注文候補', '寄り付き後まで待機', '見送り優先', '待機']).toContain(gate.decision);
  expect(gate.lines.exitLine.label).toBe('撤退ライン');
});

test('仕事中チェックは保有継続、利確検討、撤退検討の3区分で返す', () => {
  const rows = buildWorkMonitorRows({
    holdings: [{
      ticker: '7203.T',
      name: 'トヨタ自動車',
      shares: 100,
      avgCost: 2980,
      currentPrice: 3058,
      exitPlan: { targetPrice: 3060, stopLoss: 2970 },
    }],
    manualPrices: { '7203.T': 3058 },
  });

  expect(rows).toHaveLength(1);
  expect(['保有継続', '利確検討', '撤退検討']).toContain(rows[0].status);
  expect(rows[0].takeProfitDistance.label).toBe('利確候補まで');
  expect(rows[0].exitDistance.label).toBe('撤退ラインまで');
});

test('引け後レビューは記録用JSONと改善メモを作れる', () => {
  const draft = buildAfterCloseReviewDraft({
    ticker: '7203.T',
    entryPrice: 3000,
    exitPrice: 3040,
    shares: 100,
    originalReason: 'VWAP上と出来高増を確認',
    workedReason: '出来高増',
    missedSignal: '前場後半の伸び悩み',
    improvementMemo: '次回は大引け前の変化も確認',
  });

  expect(draft.ok).toBe(true);
  expect(draft.record.pnl).toBe(4000);
  expect(draft.record.reviewPurpose).toContain('判断材料');
  expect(draft.json).toContain('次回は大引け前');
});
