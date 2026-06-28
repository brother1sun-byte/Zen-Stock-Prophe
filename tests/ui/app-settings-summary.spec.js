import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildAppSettingsSummary,
  summarizeApiConfigurationStatus,
  summarizeDataSourceReadiness,
} from '../../src/utils/appSettingsSummary';
import { buildImportPreview } from '../../src/utils/watchlistCsvImporter';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const restrictedTerms = [
  '買い',
  '売り',
  '今すぐ買うべき',
  'エントリー推奨',
  '利確推奨',
  '損切り推奨',
  '急騰確定',
  '暴落確定',
  '上がる',
  '下がる',
  '儲かる',
  '勝てる',
  '投資妙味',
  '狙い目',
  '仕込み',
  '反発期待',
];

function expectNoRestrictedTerms(text) {
  for (const term of restrictedTerms) {
    expect(text).not.toContain(term);
  }
}

test('設定サマリーを安全な表示項目へ変換できる', () => {
  const summary = buildAppSettingsSummary({
    edinetStatus: { status: 'success' },
    earningsStatus: { status: 'api_key_missing' },
    tdnetStatus: { label: 'TDnet相当データ未取得', source: 'not_configured' },
    cacheStatus: { enabled: true },
  });

  expect(summary.title).toBe('データ設定');
  expect(summary.apiItems).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'EDINET', status: '設定済み' }),
    expect.objectContaining({ name: 'J-Quants', status: '未設定' }),
    expect.objectContaining({ name: 'TDnet相当データ', status: '未取得' }),
  ]));
  expect(summary.guardrails.join('\n')).toContain('ChatGPT APIへ送信しません');
  expect(summary.guardrails.join('\n')).toContain('実注文機能はありません');
  expect(summary.quickStartSteps).toEqual([
    '操作マニュアルを確認する',
    'サンプルCSVを取り込む',
    'ウォッチリスト一括チェックを確認する',
    '重要材料サマリーを見る',
    'ChatGPT相談用プロンプトをコピーする',
  ]);
  expect(summary.sampleLinks.map((item) => item.path)).toContain('docs/samples/watchlist-sample.csv');
  expect(summary.sampleLinks.map((item) => item.path)).toContain('docs/user-manual.md');
  expectNoRestrictedTerms(JSON.stringify(summary));
});

test('release docs are linked and keep safety boundaries visible', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const releaseNotes = fs.readFileSync(path.join(repoRoot, 'docs/release-notes.md'), 'utf8');
  const finalQa = fs.readFileSync(path.join(repoRoot, 'docs/final-qa-report.md'), 'utf8');
  const releaseChecklist = fs.readFileSync(path.join(repoRoot, 'docs/release-checklist.md'), 'utf8');
  const plan = fs.readFileSync(path.join(repoRoot, 'docs/free-japan-stock-research-plan.md'), 'utf8');
  const p24PlanSection = plan.split('## 追加実装: P2.4')[1]?.split('## 追加実装: P2.3')[0] ?? '';

  for (const docPath of [
    'docs/user-manual.md',
    'docs/release-checklist.md',
    'docs/release-notes.md',
    'docs/final-qa-report.md',
    'docs/samples/watchlist-sample.csv',
  ]) {
    expect(readme).toContain(docPath);
  }

  expect(p24PlanSection).toContain('リリースノート');
  expect(p24PlanSection).toContain('最終QA記録');

  for (const text of [releaseNotes, finalQa, releaseChecklist, p24PlanSection]) {
    expect(text).toContain('ChatGPT API');
    expect(text).toContain('実注文機能');
    expect(text).toContain('証券会社API');
    expect(text).not.toMatch(/APIキー.*(表示|記載).*your_|sk-|password/i);
    expectNoRestrictedTerms(text);
  }
});

test('API設定状態とデータ取得元の状態を統一表示できる', () => {
  const api = summarizeApiConfigurationStatus({
    edinetStatus: { status: 'api_key_missing' },
    earningsStatus: { status: 'auth_failed' },
    tdnetStatus: { source: 'not_configured' },
  });
  const readiness = summarizeDataSourceReadiness({
    holidayYears: ['2026'],
    manualData: { earnings: true, tdnet: false },
    cacheStatus: { enabled: false },
  });

  expect(api.map((item) => item.status)).toEqual(['未設定', '認証失敗', '未取得']);
  expect(readiness).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: '日本祝日データ', status: '2026年分あり' }),
    expect.objectContaining({ name: '手動データ', status: '一部あり' }),
    expect.objectContaining({ name: 'キャッシュ', status: 'データ未取得' }),
  ]));
  expectNoRestrictedTerms(`${JSON.stringify(api)}\n${JSON.stringify(readiness)}`);
});

test('サンプルCSVをパースし不正サンプルのスキップ理由を返せる', () => {
  const validCsv = fs.readFileSync(path.join(repoRoot, 'docs/samples/watchlist-sample.csv'), 'utf8');
  const invalidCsv = fs.readFileSync(path.join(repoRoot, 'docs/samples/watchlist-sample-invalid.csv'), 'utf8');
  const validPreview = buildImportPreview(validCsv, []);
  const invalidPreview = buildImportPreview(invalidCsv, [{ ticker: '7203.T' }]);

  expect(validPreview.validItems.map((item) => item.ticker)).toEqual(['7203.T', '6758.T', '9984.T']);
  expect(invalidPreview.skipCount).toBeGreaterThan(0);
  expect(invalidPreview.duplicateCount).toBeGreaterThan(0);
  expect(invalidPreview.errors.map((item) => item.reason).join('\n')).toContain('4');
  expectNoRestrictedTerms(`${validCsv}\n${invalidCsv}`);
});

test('READMEからサンプルとリリース前チェックリストへ移動できる', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const userManual = fs.readFileSync(path.join(repoRoot, 'docs/user-manual.md'), 'utf8');
  const releaseChecklist = fs.readFileSync(path.join(repoRoot, 'docs/release-checklist.md'), 'utf8');
  const p23Section = readme.split('## P2.3 操作マニュアルと初回利用ガイド')[1].split('## P2.2')[0];
  expect(readme).toContain('docs/user-manual.md');
  expect(readme).toContain('docs/samples/watchlist-sample.csv');
  expect(readme).toContain('docs/samples/manual-tdnet-events-sample.json');
  expect(readme).toContain('docs/release-checklist.md');
  expect(userManual).toContain('初回セットアップ');
  expect(userManual).toContain('ChatGPT APIへ直接送信しません');
  expect(releaseChecklist).toContain('操作マニュアル');
  expect(releaseChecklist).toContain('README導線');
  expectNoRestrictedTerms(p23Section);
  expectNoRestrictedTerms(userManual);
  expectNoRestrictedTerms(releaseChecklist);
});
