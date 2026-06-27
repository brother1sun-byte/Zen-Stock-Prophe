import { expect, test } from '@playwright/test';
import {
  PROHIBITED_TERMS,
  buildPromptMissingDataNotice,
  buildSingleStockResearchPrompt,
  buildWatchlistResearchPrompt,
  formatDisclosureEventsForPrompt,
  formatEarningsCalendarForPrompt,
  formatPreopenCheckForPrompt,
  formatWatchlistCheckForPrompt,
} from '../../src/utils/chatGptPromptBuilder';

test('単一銘柄用プロンプトに開示、決算予定、寄り付き前チェックを含められる', () => {
  const prompt = buildSingleStockResearchPrompt({
    stock: { ticker: '4980.T', name: 'デクセリアルズ', price: 4869, sector: '電子部品' },
    businessWindow: { periodLabel: '2026-06-26 15:00 - 2026-06-29 09:00' },
    disclosureEvents: [{
      date: '2026-06-26',
      classification: '大量保有報告',
      title: '大量保有報告書',
      source: 'EDINET',
      url: 'https://example.test/edinet',
    }],
    earningsItems: [{
      ticker: '4980.T',
      companyName: 'デクセリアルズ',
      date: '2026-06-29',
      fiscalPeriod: '1Q',
      scheduledTime: '15:00',
      source: 'J-Quants',
    }],
    preopenCheck: {
      risk: 'high',
      riskLabel: '高',
      periodLabel: '2026-06-26 15:00 - 2026-06-29 09:00',
      hasEdinetDocuments: true,
      hasEarnings: true,
      unknownInputs: ['J-Quants API未設定'],
      sourceStatus: {
        edinet: { label: '実取得済み' },
        earnings: { label: 'J-Quants API未設定' },
        businessCalendar: { label: '祝日データあり' },
        cache: { label: 'キャッシュ利用' },
      },
    },
  });

  expect(prompt).toContain('■目的');
  expect(prompt).toContain('デクセリアルズ');
  expect(prompt).toContain('大量保有報告書');
  expect(prompt).toContain('J-Quants');
  expect(prompt).toContain('寄り付き前チェック結果');
  expect(prompt).toContain('J-Quants API未設定');
  expect(prompt).toContain('キャッシュ利用');
  for (const term of PROHIBITED_TERMS) {
    expect(prompt).not.toContain(term);
  }
});

test('ウォッチリスト用プロンプトに一括チェック結果と未取得注意を含められる', () => {
  const results = [
    {
      ticker: '4980.T',
      companyName: 'デクセリアルズ',
      risk: 'high',
      periodLabel: '2026-06-26 15:00 - 2026-06-29 09:00',
      hasEdinetDocuments: true,
      hasEarnings: true,
      edinetDocuments: [{ date: '2026-06-26', classification: '臨時報告書', title: '臨時報告書', source: 'EDINET' }],
      earnings: [{ ticker: '4980.T', companyName: 'デクセリアルズ', date: '2026-06-29', fiscalPeriod: '1Q', scheduledTime: '15:00', source: 'J-Quants' }],
      sourceStatus: {
        edinet: { label: '実取得済み' },
        earnings: { label: 'J-Quants実取得済み' },
        businessCalendar: { label: '祝日データあり' },
      },
      unknownInputs: [],
    },
    {
      ticker: '7203.T',
      companyName: 'トヨタ自動車',
      risk: 'unknown',
      periodLabel: '2026-06-26 15:00 - 2026-06-29 09:00',
      hasEdinetDocuments: false,
      hasEarnings: false,
      edinetDocuments: [],
      earnings: [],
      sourceStatus: { earnings: { label: '取得失敗' } },
      unknownInputs: ['決算予定データ未取得'],
    },
  ];
  const prompt = buildWatchlistResearchPrompt({
    watchlistResults: results,
    watchlistSummary: { total: 2, checked: 2, important: 1, review: 0, missing: 1, errors: 0 },
    businessWindow: { periodLabel: '2026-06-26 15:00 - 2026-06-29 09:00' },
    sourceStatus: {
      edinet: { label: '実取得済み' },
      earnings: { label: '手動データ' },
      businessCalendar: { label: '簡易判定' },
      cache: { label: 'キャッシュ利用' },
    },
  });

  expect(formatDisclosureEventsForPrompt(results[0].edinetDocuments)).toContain('臨時報告書');
  expect(formatEarningsCalendarForPrompt(results[0].earnings)).toContain('J-Quants');
  expect(formatPreopenCheckForPrompt(results[0])).toContain('J-Quants決算予定');
  expect(formatWatchlistCheckForPrompt(results)).toContain('7203.T');
  expect(buildPromptMissingDataNotice(results[1].sourceStatus)).toContain('取得失敗');
  expect(prompt).toContain('対象銘柄数: 2');
  expect(prompt).toContain('重要予定あり件数: 1');
  expect(prompt).toContain('データ未取得件数: 1');
  expect(prompt).toContain('デクセリアルズ');
  expect(prompt).toContain('トヨタ自動車');
  expect(prompt).toContain('手動データ');
  expect(prompt).toContain('キャッシュ利用');
  for (const term of PROHIBITED_TERMS) {
    expect(prompt).not.toContain(term);
  }
});
