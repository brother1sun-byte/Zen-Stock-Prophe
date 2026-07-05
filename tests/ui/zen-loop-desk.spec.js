import { expect, test } from '@playwright/test';
import {
  buildVerificationGate,
  buildZenLoopDeskPayload,
} from '../../src/utils/zenLoopDesk';

const sampleStock = {
  ticker: '7203.T',
  name: 'トヨタ自動車',
  price: 3000,
  candidateScore: 74,
  candidateReason: '出来高とトレンドを確認する候補',
};

test('Zen Loop Desk gate requires readiness, PASS audit, actionable size, and aligned cross-engine confirmation', () => {
  const readyGate = buildVerificationGate({
    tradeReadiness: 'ready',
    decisionAudit: { verdict: 'PASS' },
    shares: 100,
    riskJpy: 12000,
    advancedCrossEngineCheck: { required: true, status: 'aligned' },
  });
  const weakGate = buildVerificationGate({
    tradeReadiness: 'review',
    decisionAudit: { verdict: 'REVIEW' },
    shares: 0,
    advancedCrossEngineCheck: { required: true, status: 'diverged' },
  });

  expect(readyGate.status).toBe('actionable');
  expect(readyGate.isActionable).toBe(true);
  expect(weakGate.status).toBe('research-only');
  expect(weakGate.isActionable).toBe(false);
  expect(weakGate.researchOnlyReasons).toContain('tradeReadiness が ready ではありません');
  expect(weakGate.researchOnlyReasons).toContain('decisionAudit が PASS ではありません');
  expect(weakGate.researchOnlyReasons).toContain('検証済みサイズがありません');
  expect(weakGate.researchOnlyReasons).toContain('cross-engine confirmation が aligned ではありません');
});

test('Zen Loop Desk does not manufacture actionable candidates when verified signals are absent', () => {
  const payload = buildZenLoopDeskPayload({
    stocks: [sampleStock],
    nightRows: [{
      ...sampleStock,
      reasons: ['出来高確認'],
      morningConditions: ['一次情報確認'],
      skipConditions: ['検証ゲート未達'],
    }],
    daytradeSignals: [],
    alertReport: { status: 'NO_ACTION', alerts: [] },
    reviewInsights: { improvementHints: ['検証理由を週次で確認'] },
    marketPhase: { label: '時間外' },
    fetchedAt: '2026-07-05T08:00:00+09:00',
  });

  expect(payload.sourceOfTruth).toBe('zen-loop-desk-json');
  expect(payload.manualDecisionSupportOnly).toBe(true);
  expect(payload.candidates).toHaveLength(1);
  expect(payload.candidates[0].mode).toBe('research-only');
  expect(payload.alertOnly.sendAllowed).toBe(false);
  expect(payload.marketBrief.majorRisks.join(' ')).toContain('検証済み候補がない');
  expect(payload.marketBrief.doNotDoToday.join(' ')).toContain('verification gate 未達');
  expect(JSON.stringify(payload)).not.toContain('actionable trade board');
});

test('Zen Loop Desk UI shows no actionable board when verified candidates are absent', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('zen-loop-desk-panel')).toBeVisible();
  await expect(page.getByTestId('zen-loop-no-actionable')).toContainText('検証済み候補はありません');
  await expect(page.getByTestId('zen-loop-desk-panel')).toContainText('手動判断支援のみ');
  await expect(page.getByTestId('zen-loop-desk-panel')).toContainText('調査のみ');
  await expect(page.getByTestId('zen-loop-json')).toContainText('zen-loop-desk-json');
  await expect(page.locator('body')).not.toContainText('actionable trade board');
});
