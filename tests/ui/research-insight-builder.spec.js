import { expect, test } from '@playwright/test';
import {
  FORBIDDEN_RESEARCH_TERMS,
  buildSingleStockResearchInsight,
  buildWatchlistResearchInsights,
  calculateResearchConfidence,
} from '../../src/utils/researchInsightBuilder';
import {
  buildSingleStockResearchPrompt,
  buildWatchlistResearchPrompt,
} from '../../src/utils/chatGptPromptBuilder';

const basePayload = {
  stock: { ticker: '4980.T', name: 'デクセリアルズ' },
  businessWindow: { periodLabel: '2026-06-26 15:00 - 2026-06-29 09:00' },
  disclosureEvents: [{ date: '2026-06-26', classification: '臨時報告書', title: '臨時報告書', source: 'EDINET' }],
  earningsItems: [{ ticker: '4980.T', companyName: 'デクセリアルズ', date: '2026-06-29', fiscalPeriod: '1Q', scheduledTime: '15:00', source: 'J-Quants' }],
  preopenCheck: { risk: 'high', periodLabel: '2026-06-26 15:00 - 2026-06-29 09:00' },
  sourceStatus: {
    edinet: { label: '実取得済み' },
    earnings: { label: 'J-Quants実取得済み' },
    businessCalendar: { label: '祝日データあり' },
    tdnet: { label: '未取得' },
  },
};

test('単一銘柄の重要材料サマリーに根拠とデータ充足度を含める', () => {
  const insight = buildSingleStockResearchInsight(basePayload);
  expect(insight.conclusion).toBe('重要材料あり');
  expect(insight.positiveMaterials.join('\n')).toContain('EDINET');
  expect(insight.negativeMaterials.join('\n')).toContain('決算発表予定');
  expect(insight.evidence.join('\n')).toContain('EDINET');
  expect(insight.evidence.join('\n')).toContain('J-Quants');
  expect(insight.evidence.join('\n')).toContain('営業日');
  expect(insight.missingInformation.join('\n')).toContain('TDnet相当データ');
  expect(insight.confidenceScore).toBeGreaterThanOrEqual(0);
  expect(insight.confidenceScore).toBeLessThanOrEqual(100);
});

test('未取得、取得失敗、キャッシュ、手動データを不足情報と注意点に反映する', () => {
  const weakPayload = {
    ...basePayload,
    disclosureEvents: [],
    earningsItems: [],
    unknownInputs: ['照合不可'],
    sourceStatus: {
      edinet: { label: 'API未設定' },
      earnings: { label: '取得失敗' },
      businessCalendar: { label: '簡易判定' },
      tdnet: { label: '未実装' },
      cache: { label: 'キャッシュ利用' },
    },
  };
  const insight = buildSingleStockResearchInsight(weakPayload);
  expect(insight.missingInformation.join('\n')).toContain('API未設定');
  expect(insight.missingInformation.join('\n')).toContain('取得失敗');
  expect(insight.missingInformation.join('\n')).toContain('キャッシュ利用');
  expect(insight.negativeMaterials.join('\n')).toContain('未取得または取得失敗');
  expect(calculateResearchConfidence(weakPayload)).toBeLessThan(calculateResearchConfidence(basePayload));
});

test('ウォッチリスト全体の材料サマリーを重要、確認推奨、データ不足に分類できる', () => {
  const insights = buildWatchlistResearchInsights({
    businessWindow: basePayload.businessWindow,
    watchlistResults: [
      {
        ticker: '4980.T',
        companyName: 'デクセリアルズ',
        risk: 'high',
        edinetDocuments: basePayload.disclosureEvents,
        earnings: basePayload.earningsItems,
        sourceStatus: basePayload.sourceStatus,
        periodLabel: basePayload.businessWindow.periodLabel,
      },
      {
        ticker: '7203.T',
        companyName: 'トヨタ自動車',
        risk: 'medium',
        edinetDocuments: [],
        earnings: [],
        sourceStatus: { earnings: { label: '手動データ' } },
        periodLabel: basePayload.businessWindow.periodLabel,
      },
      {
        ticker: '8306.T',
        companyName: '三菱UFJフィナンシャル・グループ',
        risk: 'unknown',
        edinetDocuments: [],
        earnings: [],
        sourceStatus: { earnings: { label: '取得失敗' } },
        unknownInputs: ['決算予定データ未取得'],
        periodLabel: basePayload.businessWindow.periodLabel,
      },
    ],
  });
  expect(insights.importantTickers).toHaveLength(1);
  expect(insights.reviewTickers).toHaveLength(1);
  expect(insights.missingTickers).toHaveLength(1);
  expect(insights.evidence.join('\n')).toContain('ウォッチリスト一括チェック');
});

test('ChatGPT相談用プロンプトに重要材料サマリーと根拠を含め、禁止表現を出さない', () => {
  const singlePrompt = buildSingleStockResearchPrompt(basePayload);
  const watchlistPrompt = buildWatchlistResearchPrompt({
    watchlistResults: [{
      ticker: '4980.T',
      companyName: 'デクセリアルズ',
      risk: 'high',
      edinetDocuments: basePayload.disclosureEvents,
      earnings: basePayload.earningsItems,
      sourceStatus: basePayload.sourceStatus,
      periodLabel: basePayload.businessWindow.periodLabel,
    }],
    watchlistSummary: { total: 1, checked: 1, important: 1, review: 0, missing: 0, errors: 0 },
    businessWindow: basePayload.businessWindow,
    sourceStatus: basePayload.sourceStatus,
  });
  for (const prompt of [singlePrompt, watchlistPrompt]) {
    expect(prompt).toContain('重要材料サマリー');
    expect(prompt).toContain('強材料');
    expect(prompt).toContain('弱材料');
    expect(prompt).toContain('不足情報');
    expect(prompt).toContain('根拠');
    for (const term of FORBIDDEN_RESEARCH_TERMS) {
      expect(prompt).not.toContain(term);
    }
  }
});
