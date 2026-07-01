function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildAfterCloseReviewExport(records = [], { now = new Date() } = {}) {
  const safeRecords = Array.isArray(records)
    ? records.filter((record) => record && typeof record === 'object')
    : [];
  const stamp = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.toISOString().slice(0, 10)
    : 'manual';
  const columns = [
    'createdAt',
    'ticker',
    'companyName',
    'entryPrice',
    'exitPrice',
    'shares',
    'pnl',
    'initialScore',
    'decisionMode',
    'decisionResult',
    'originalReason',
    'workedReason',
    'exitReason',
    'missedSignal',
    'improvementMemo',
  ];
  const csv = [
    columns.join(','),
    ...safeRecords.map((record) => columns.map((key) => csvCell(record[key])).join(',')),
  ].join('\n');

  return {
    count: safeRecords.length,
    json: JSON.stringify(safeRecords, null, 2),
    csv,
    jsonFilename: `zen-after-close-reviews-${stamp}.json`,
    csvFilename: `zen-after-close-reviews-${stamp}.csv`,
    notice: 'レビュー改善ログはブラウザ内でJSON/CSV化します。外部API、証券会社API、GitHubには送信しません。',
  };
}
