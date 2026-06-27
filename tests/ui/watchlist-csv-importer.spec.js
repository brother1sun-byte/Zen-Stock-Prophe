import { expect, test } from '@playwright/test';
import {
  buildImportPreview,
  mergeWatchlistItems,
  normalizeWatchlistCode,
  parseWatchlistCsv,
} from '../../src/utils/watchlistCsvImporter';
import {
  buildTdnetUnavailableNotice,
  getTdnetSourceStatus,
  normalizeTdnetEvent,
} from '../../src/utils/tdnetSourceStatus';
import { buildWatchlistResearchPrompt } from '../../src/utils/chatGptPromptBuilder';
import { buildSingleStockResearchInsight } from '../../src/utils/researchInsightBuilder';

const bannedTerms = [
  '今すぐ買うべき',
  'エントリー推奨',
  '利確推奨',
  '損切り推奨',
  '急騰確定',
  '暴落確定',
  '儲かる',
  '勝てる',
  '投資妙味',
  '狙い目',
  '仕込み',
  '反発期待',
];

test('CSVテキストをパースしコードを正規化できる', () => {
  const rows = parseWatchlistCsv('code,name,market,sector,memo\n7203,トヨタ自動車,東証,輸送用機器,確認\n9984.T,ソフトバンクグループ');
  expect(rows).toHaveLength(2);
  expect(normalizeWatchlistCode('7203.T')).toBe('7203');
  const preview = buildImportPreview('code,name\n7203,トヨタ自動車\n9984.T,ソフトバンクグループ');
  expect(preview.validCount).toBe(2);
  expect(preview.validItems[0].ticker).toBe('7203.T');
});

test('不正行と重複銘柄をプレビューで分けて表示できる', () => {
  const preview = buildImportPreview('code,name\n7203,トヨタ自動車\nabc,不正\n7203.T,重複', [{ ticker: '7203.T', name: '既存' }]);
  expect(preview.validCount).toBe(1);
  expect(preview.skipCount).toBe(1);
  expect(preview.duplicateCount).toBeGreaterThanOrEqual(1);
  expect(preview.errors[0].reason).toContain('4桁');
});

test('既存ウォッチリストとインポート銘柄をマージできる', () => {
  const merged = mergeWatchlistItems(
    [{ ticker: '7203.T', name: 'トヨタ自動車', memo: '既存' }],
    [{ ticker: '6758.T', name: 'ソニーグループ' }, { ticker: '7203.T', name: 'トヨタ自動車', memo: '追加' }],
  );
  expect(merged.items.map((item) => item.ticker)).toEqual(['7203.T', '6758.T']);
  expect(merged.addedCount).toBe(1);
  expect(merged.duplicateCount).toBe(1);
});

test('TDnet未取得ステータスと手動イベントを安全に扱える', () => {
  const unavailable = getTdnetSourceStatus();
  expect(unavailable.label).toBe('TDnet相当データ未取得');
  expect(buildTdnetUnavailableNotice()).toContain('スクレイピングは行いません');
  const manual = getTdnetSourceStatus({ manualEvents: [{ date: '2026-06-29', title: '決算短信', code: '7203' }] });
  expect(manual.label).toBe('手動TDnet相当データ');
  expect(normalizeTdnetEvent({ title: '決算短信', code: '7203' }).ticker).toBe('7203');
});

test('TDnet未取得が不足情報とChatGPT相談用プロンプトに含まれ禁止表現を出さない', () => {
  const tdnet = getTdnetSourceStatus();
  const insight = buildSingleStockResearchInsight({
    stock: { ticker: '7203.T', name: 'トヨタ自動車' },
    sourceStatus: {
      edinet: { label: '実取得済み' },
      earnings: { label: 'J-Quants実取得済み' },
      businessCalendar: { label: '祝日データあり' },
      tdnet,
    },
  });
  const prompt = buildWatchlistResearchPrompt({
    watchlistResults: [{
      ticker: '7203.T',
      companyName: 'トヨタ自動車',
      risk: 'unknown',
      periodLabel: '2026-06-26 15:00〜2026-06-29 09:00',
      edinetDocuments: [],
      earnings: [],
      sourceStatus: { tdnet },
      unknownInputs: ['TDnet相当データ未取得'],
    }],
    sourceStatus: { tdnet },
  });
  expect(insight.missingInformation.join('\n')).toContain('TDnet相当データ');
  expect(prompt).toContain('TDnet相当データ未取得');
  for (const term of bannedTerms) {
    expect(prompt).not.toContain(term);
  }
});
