import React, { useMemo, useState } from 'react';
import { buildAfterCloseReviewExport } from '../utils/afterCloseReviewExport';
import {
  buildAfterCloseReviewDraft,
  buildDecisionSupportBrief,
  buildMorningGate,
  buildNightScanRows,
  buildPreTradeChecklist,
  buildReviewDrivenInsights,
  buildWorkMonitorRows,
  classifyAfterCloseReview,
  loadAfterCloseReviewLog,
  saveAfterCloseReviewDraft,
} from '../utils/lifestyleDaytradeModes';
import { buildZenLoopDeskPayload } from '../utils/zenLoopDesk';
import { filterReviewHistory, restoreReviewBackup, summarizeReviewOutcomes } from '../utils/reviewHistory';

const MODES = [
  { id: 'night', label: 'Night Scan', caption: '帰宅後' },
  { id: 'morning', label: 'Morning Gate', caption: '翌朝' },
  { id: 'work', label: 'Work Monitor', caption: '仕事中' },
  { id: 'review', label: 'After Close Review', caption: '引け後' },
];

function yen(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '取得不可';
  return `¥${Math.round(number).toLocaleString('ja-JP')}`;
}

function numberInputValue(value) {
  return value === null || value === undefined ? '' : value;
}

function conciseReason(reason) {
  const text = String(reason || '').trim();
  const firstSentence = text.split('。')[0];
  return firstSentence ? `${firstSentence}。` : '根拠は詳細データで確認してください。';
}

function smallLine(label, value) {
  return (
    <div className="lifestyle-mini-line" key={label}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PriceLineList({ lines }) {
  const keys = ['orderCandidate', 'orderLimit', 'firstTakeProfit', 'secondTakeProfit', 'exitLine', 'invalidLine', 'resistance', 'support', 'vwap'];
  return (
    <div className="lifestyle-price-lines">
      {keys.map((key) => {
        const line = lines?.[key];
        if (!line) return null;
        return (
          <div className="lifestyle-price-line" key={key}>
            <span>{line.label}</span>
            <strong>{yen(line.value)}</strong>
            <small>{line.estimated ? '推定: ' : ''}{conciseReason(line.reason)}</small>
          </div>
        );
      })}
    </div>
  );
}

function DataQualityLegend({ notices = [] }) {
  const text = notices.join(' ');
  const items = [
    ['推定', text.includes('推定')],
    ['遅延', text.includes('遅延') || text.includes('鮮度')],
    ['キャッシュ', text.includes('キャッシュ')],
    ['補完データ', text.includes('補完')],
    ['データ不足', notices.length > 2],
  ];
  return (
    <div className="lifestyle-data-quality" data-testid="lifestyle-data-quality" aria-label="データ品質">
      <strong>データ品質</strong>
      {items.map(([label, active]) => <span key={label} className={active ? 'active' : ''}>{label}: {active ? '要確認' : '該当なし'}</span>)}
    </div>
  );
}

function EvidenceStrip({ advancedSummary, backtestSummary, volumeSeasonality, spreadRisk }) {
  const items = [
    ['高度分析', advancedSummary?.status || '未取得'],
    ['ウォークフォワード', backtestSummary?.summary || '検証材料未取得'],
    ['出来高季節性', `${volumeSeasonality?.label || volumeSeasonality?.status || '取得不可'}${volumeSeasonality?.precision ? ` / ${volumeSeasonality.precision}` : ''}`],
    ['スプレッド推定', spreadRisk?.status || '推定不可'],
  ];
  return (
    <div className="lifestyle-evidence-strip" data-testid="lifestyle-evidence-strip">
      {items.map(([label, value]) => (
        <div className="lifestyle-evidence-item" key={`${label}-${value}`}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ReviewCautionCard({ title, cautions = [], testId }) {
  const visible = (Array.isArray(cautions) ? cautions : []).filter(Boolean).slice(0, 3);
  return (
    <div className="lifestyle-review-caution" data-testid={testId}>
      <strong>{title}</strong>
      {visible.length ? visible.map((item, index) => (
        <span key={`${title}-${index}-${item}`}>注意: {item}</span>
      )) : <span>過去レビューはまだありません。</span>}
    </div>
  );
}

function DecisionSupportBrief({ brief, checklist }) {
  return (
    <div className="lifestyle-decision-brief" data-testid="lifestyle-decision-brief">
      <div className="lifestyle-brief-main">
        <span>今日見るべきポイント</span>
        <strong>{brief.conclusion}</strong>
        <p>{brief.purpose}</p>
        <small>{brief.scope}</small>
      </div>
      <div className="lifestyle-brief-next">
        <span>次の確認</span>
        <strong>{brief.nextAction}</strong>
        <small>{brief.safetyNotice}</small>
      </div>
      <div className="lifestyle-material-grid" aria-label="判断材料カテゴリ">
        {brief.materials.map((item) => (
          <div className="lifestyle-material-card" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </div>
        ))}
      </div>
      <div className="lifestyle-pretrade-checklist" data-testid="lifestyle-pretrade-checklist">
        <strong>手動判断前チェック</strong>
        {checklist.map((item) => (
          <div className="lifestyle-check-row" key={item.label}>
            <span>{item.label}</span>
            <b>{item.status}</b>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
      <div className="lifestyle-data-notices" data-testid="lifestyle-data-notices">
        {brief.dataNotices.map((notice) => <span key={notice}>{notice}</span>)}
      </div>
      <DataQualityLegend notices={brief.dataNotices} />
    </div>
  );
}

function TodayCheckDashboard({ brief, checklist, zenLoopDesk, showVerification, onToggleVerification }) {
  const verifiedCount = zenLoopDesk.candidates.filter((candidate) => candidate.gate.isActionable).length;
  const researchOnlyCount = zenLoopDesk.candidates.length - verifiedCount;
  const skipReasons = zenLoopDesk.candidates
    .flatMap((candidate) => candidate.gate.researchOnlyReasons || [])
    .filter(Boolean);
  const dataNotices = Array.isArray(brief.dataNotices) ? brief.dataNotices : [];

  return (
    <section className="today-check-dashboard" data-testid="today-check-dashboard" aria-labelledby="today-check-title">
      <div className="today-check-head">
        <div>
          <span>最初にここを確認</span>
          <strong id="today-check-title">今日の確認</strong>
          <p>{brief.purpose}</p>
        </div>
        <button type="button" className="secondary-button" onClick={onToggleVerification} data-testid="today-check-detail-toggle">
          {showVerification ? '要点表示に戻す' : '検証詳細を表示'}
        </button>
      </div>
      <div className="today-check-grid">
        <div className="today-check-item primary">
          <span>結論</span>
          <strong>{brief.conclusion}</strong>
          <small>{brief.nextAction}</small>
        </div>
        <div className="today-check-item">
          <span>候補</span>
          <strong>{verifiedCount ? `検証済み ${verifiedCount}件` : '検証済み候補なし'}</strong>
          <small>調査のみ {researchOnlyCount}件</small>
        </div>
        <div className="today-check-item warning">
          <span>見送り理由</span>
          <strong>{skipReasons[0] || zenLoopDesk.marketBrief.majorRisks[0] || '目立つ見送り理由なし'}</strong>
          <small>条件未達はresearch-onlyを維持します。</small>
        </div>
        <div className="today-check-item muted">
          <span>データ不足</span>
          <strong>{dataNotices.length ? `${dataNotices.length}項目を確認` : '目立つ不足なし'}</strong>
          <small>{dataNotices[0] || '取得元と更新時刻を確認してください。'}</small>
        </div>
      </div>
      <DecisionSupportBrief brief={brief} checklist={checklist} />
    </section>
  );
}

function ZenLoopDeskPanel({ payload }) {
  const visibleCandidates = payload.candidates.slice(0, 4);
  const actionableCount = payload.candidates.filter((candidate) => candidate.gate.isActionable).length;
  const researchOnlyCount = payload.candidates.length - actionableCount;
  return (
    <section className="zen-loop-desk" data-testid="zen-loop-desk-panel" aria-label="Zen Loop Desk">
      <div className="zen-loop-head">
        <div>
          <span>Research → Thesis → Verification → Alert → Review</span>
          <strong>Zen Loop Desk</strong>
          <p>手動判断支援のみ。外部注文・自動実行は行いません。</p>
        </div>
        <div className="zen-loop-json-badge">JSON source of truth</div>
      </div>
      <div className="zen-loop-summary">
        <div>
          <span>market phase</span>
          <strong>{payload.marketBrief.marketPhase}</strong>
        </div>
        <div>
          <span>検証済み候補</span>
          <strong>{actionableCount}件</strong>
        </div>
        <div>
          <span>調査のみ</span>
          <strong>{researchOnlyCount}件</strong>
        </div>
        <div>
          <span>alert-only</span>
          <strong>{payload.alertOnly.alertCount}件</strong>
        </div>
      </div>
      {actionableCount === 0 ? (
        <div className="zen-loop-no-action" data-testid="zen-loop-no-actionable">
          検証済み候補はありません。無理に候補を作らず、Research / Thesis の確認に限定します。
        </div>
      ) : null}
      <div className="zen-loop-brief-grid">
        <div>
          <strong>今日の主要リスク</strong>
          {payload.marketBrief.majorRisks.map((item) => <span key={item}>{item}</span>)}
        </div>
        <div>
          <strong>今日やってはいけない取引</strong>
          {payload.marketBrief.doNotDoToday.map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
      <div className="zen-loop-candidates">
        {visibleCandidates.map((candidate) => (
          <article className="zen-loop-candidate" data-testid="zen-loop-candidate" key={`${candidate.ticker}-${candidate.mode}`}>
            <div className="zen-loop-candidate-head">
              <strong>{candidate.ticker} {candidate.name}</strong>
              <b className={candidate.gate.isActionable ? 'is-ready' : 'is-research'}>{candidate.gate.label}</b>
            </div>
            <div className="zen-loop-thesis">
              <div>
                <span>bullish thesis</span>
                {(candidate.thesis.bullishReasons.length ? candidate.thesis.bullishReasons : ['根拠は未取得です']).slice(0, 2).map((item) => <small key={item}>{item}</small>)}
              </div>
              <div>
                <span>bearish thesis</span>
                {(candidate.thesis.bearishReasons.length ? candidate.thesis.bearishReasons : ['未検証のため調査のみです']).slice(0, 2).map((item) => <small key={item}>{item}</small>)}
              </div>
            </div>
            <details className="zen-loop-details">
              <summary>検証ゲートと条件を見る</summary>
              <div>
                {candidate.gate.checks.map((check) => (
                  <p key={`${candidate.ticker}-${check.id}`}>{check.ok ? 'OK' : '未達'}: {check.label}</p>
                ))}
                <strong>entry条件</strong>
                {candidate.thesis.entryConditions.map((item) => <p key={`entry-${candidate.ticker}-${item}`}>{item}</p>)}
                <strong>invalidation条件</strong>
                {candidate.thesis.invalidationConditions.map((item) => <p key={`invalid-${candidate.ticker}-${item}`}>{item}</p>)}
                <strong>risk/reward短評</strong>
                <p>{candidate.thesis.riskRewardComment}</p>
              </div>
            </details>
          </article>
        ))}
      </div>
      <div className="zen-loop-alert-review">
        <span>{payload.alertOnly.notice}</span>
        <span>{payload.weeklyReview.purpose}</span>
      </div>
      <details className="zen-loop-json">
        <summary>JSONソースを確認</summary>
        <pre data-testid="zen-loop-json">{JSON.stringify(payload, null, 2)}</pre>
      </details>
    </section>
  );
}

function NightScanView({ rows }) {
  const topRows = rows.slice(0, 5);
  return (
    <div className="lifestyle-mode-body" data-testid="lifestyle-night-scan">
      <div className="lifestyle-summary-strip">
        {smallLine('翌朝確認候補', `${rows.length}銘柄`)}
        {smallLine('A候補', `${rows.filter((row) => row.rankLabel.startsWith('A')).length}銘柄`)}
        {smallLine('見送り優先', `${rows.filter((row) => row.rankLabel.startsWith('D')).length}銘柄`)}
      </div>
      <div className="lifestyle-card-list">
        {topRows.map((row) => (
          <article className="lifestyle-card" key={row.ticker} data-testid="lifestyle-night-card">
            <div className="lifestyle-card-head">
              <div>
                <span>{row.phaseLabel}</span>
                <strong>{row.ticker} {row.companyName}</strong>
              </div>
              <b>{row.rankLabel}</b>
            </div>
            <div className="lifestyle-score-row">
              <span>翌日候補スコア</span>
              <strong>{row.score}/100</strong>
              <small>{row.trendDirection} / {row.preopenStatus}</small>
            </div>
            <div className="lifestyle-bullets">
              {row.reasons.map((item, index) => <span key={`night-reason-${row.ticker}-${index}-${item}`}>{item}</span>)}
              {row.morningConditions.slice(0, 2).map((item, index) => <span key={`night-condition-${row.ticker}-${index}-${item}`}>{item}</span>)}
            </div>
            <EvidenceStrip
              advancedSummary={row.advancedSummary}
              backtestSummary={row.backtestSummary}
              volumeSeasonality={row.volumeSeasonality}
              spreadRisk={row.spreadRisk}
            />
            <ReviewCautionCard
              title="過去レビューからの翌朝注意"
              cautions={row.reviewCaution?.cautions}
              testId="night-review-caution"
            />
            <PriceLineList lines={row.priceLines} />
            <details className="lifestyle-details">
              <summary>翌朝確認すべき条件と見送り条件</summary>
              <div>
                <strong>翌朝確認</strong>
                {row.morningConditions.map((item, index) => <p key={`night-morning-${row.ticker}-${index}-${item}`}>{item}</p>)}
                <strong>見送り条件</strong>
                {row.skipConditions.map((item, index) => <p key={`night-skip-${row.ticker}-${index}-${item}`}>{item}</p>)}
              </div>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}

function MorningGateView({ gate, value, onChange }) {
  return (
    <div className="lifestyle-mode-body" data-testid="lifestyle-morning-gate">
      <div className="lifestyle-manual-input">
        <label>
          <span>証券アプリで確認した現在価格</span>
          <input
            data-testid="morning-manual-price"
            type="number"
            inputMode="decimal"
            min="0"
            value={numberInputValue(value)}
            onChange={(event) => onChange(event.target.value)}
            placeholder="手入力価格"
          />
        </label>
        <small>無料データが遅延または取得不可の場合は、ここに手入力して差分を再計算します。</small>
      </div>
      <article className={`lifestyle-card decision-${gate.decision}`} data-testid="lifestyle-morning-card">
        <div className="lifestyle-card-head">
          <div>
            <span>今日の手動注文候補か</span>
            <strong>{gate.ticker} {gate.companyName}</strong>
          </div>
          <b>{gate.decision}</b>
        </div>
        <div className="lifestyle-morning-core">
          {smallLine('スコア', `${gate.score}/100`)}
          {smallLine('現在価格', yen(gate.currentPrice))}
          {smallLine('注文上限との差', gate.orderLimitDistance.value === null ? '取得不可' : `${gate.orderLimitDistance.value}円`)}
        </div>
        <div className="lifestyle-bullets">
          {gate.reasons.map((item, index) => <span key={`morning-reason-${index}-${item}`}>根拠: {item}</span>)}
          {gate.cautions.map((item, index) => <span key={`morning-caution-${index}-${item}`}>注意: {item}</span>)}
        </div>
        <EvidenceStrip
          advancedSummary={gate.advancedSummary}
          backtestSummary={gate.backtestSummary}
          volumeSeasonality={gate.volumeSeasonality}
          spreadRisk={gate.spreadRisk}
        />
        <ReviewCautionCard
          title="過去レビューからの手動注文前チェック"
          cautions={gate.reviewCaution?.cautions}
          testId="morning-review-caution"
        />
        <PriceLineList lines={gate.lines} />
        <div className="lifestyle-skip-box">
          <strong>見送り条件</strong>
          {gate.skipConditions.map((item, index) => <span key={`morning-skip-${index}-${item}`}>{item}</span>)}
        </div>
      </article>
    </div>
  );
}

function WorkMonitorView({ rows, manualPrices, onChange }) {
  return (
    <div className="lifestyle-mode-body" data-testid="lifestyle-work-monitor">
      <p className="lifestyle-short-note">仕事中は、保有継続・利確検討・撤退検討の3区分だけを確認します。</p>
      <div className="lifestyle-card-list">
        {rows.length ? rows.map((row) => (
          <article className={`lifestyle-card work-${row.status}`} key={row.ticker} data-testid="lifestyle-work-row">
            <div className="lifestyle-card-head">
              <div>
                <span>{row.status}</span>
                <strong>{row.ticker} {row.companyName}</strong>
              </div>
              <b>{row.score}/100</b>
            </div>
            <label className="lifestyle-inline-input">
              <span>現在価格を手入力</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={numberInputValue(manualPrices[row.ticker])}
                onChange={(event) => onChange(row.ticker, event.target.value)}
                placeholder={yen(row.currentPrice)}
              />
            </label>
            <div className="lifestyle-morning-core">
              {smallLine('現在価格', yen(row.currentPrice))}
              {smallLine(row.takeProfitDistance.label, row.takeProfitDistance.value === null ? '取得不可' : `${row.takeProfitDistance.value}円`)}
              {smallLine(row.exitDistance.label, row.exitDistance.value === null ? '取得不可' : `${row.exitDistance.value}円`)}
            </div>
            <div className="lifestyle-bullets">
              {row.reasons.slice(0, 2).map((item, index) => <span key={`work-reason-${row.ticker}-${index}-${item}`}>{item}</span>)}
              <span>次に確認: {row.nextCheck}</span>
              <span>高度分析: {row.advancedSummary?.status || '未取得'} / {row.spreadRisk?.status || '推定不可'}</span>
              {(row.reviewCaution?.cautions || []).slice(0, 2).map((item, index) => (
                <span key={`work-review-${row.ticker}-${index}-${item}`}>過去レビュー注意: {item}</span>
              ))}
            </div>
          </article>
        )) : (
          <div className="lifestyle-empty">保有中チェックの対象はまだありません。必要に応じて練習台帳に登録してください。</div>
        )}
      </div>
    </div>
  );
}

function ReviewInsightPanel({ reviewInsights }) {
  const records = reviewInsights?.classifiedRecords || [];
  return (
    <div className="lifestyle-review-insights" data-testid="after-close-review-insights">
      <div className="lifestyle-card-head">
        <div>
          <span>過去レビューの傾向</span>
          <strong>{reviewInsights?.scoreSummary?.summary || '保存済みレビューはまだありません。'}</strong>
        </div>
        <b>{reviewInsights?.total || 0}件</b>
      </div>
      <div className="lifestyle-bullets">
        {(reviewInsights?.improvementHints?.length ? reviewInsights.improvementHints : [reviewInsights?.emptyMessage || 'レビュー保存後に改善ヒントを表示します。']).map((item, index) => (
          <span key={`review-hint-${index}-${item}`}>改善: {item}</span>
        ))}
      </div>
      <div className="lifestyle-review-log" data-testid="after-close-review-classified-log">
        <strong>保存済みログ分類</strong>
        {records.length ? records.slice(0, 6).map((record) => (
          <span key={`${record.ticker}-${record.createdAt}-classified`}>
            {record.ticker} / {record.classification.label} / 損益 {yen(record.pnl)} / 初期スコア {record.classification.score ?? '未入力'}
          </span>
        )) : <span>分類できる保存ログはまだありません。</span>}
      </div>
    </div>
  );
}

function downloadTextFile(filename, text, mimeType) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const blob = new Blob([text], { type: mimeType });
  const url = window.URL?.createObjectURL?.(blob);
  if (!url) return false;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return true;
}

function ReviewExportPanel({ reviewLog }) {
  const [message, setMessage] = useState('');
  const exportBundle = useMemo(() => buildAfterCloseReviewExport(reviewLog), [reviewLog]);
  const runExport = (format) => {
    const ok = format === 'csv'
      ? downloadTextFile(exportBundle.csvFilename, exportBundle.csv, 'text/csv;charset=utf-8')
      : downloadTextFile(exportBundle.jsonFilename, exportBundle.json, 'application/json;charset=utf-8');
    setMessage(ok ? `${format.toUpperCase()}エクスポートを作成しました。外部送信はありません。` : 'エクスポートを作成できませんでした。表示中のJSONを手動で保存してください。');
  };
  return (
    <div className="lifestyle-review-export" data-testid="after-close-review-export">
      <div>
        <strong>After Close Reviewエクスポート</strong>
        <span data-testid="after-close-review-export-count">保存レビュー: {exportBundle.count}件</span>
        <small>{exportBundle.notice}</small>
      </div>
      <div className="lifestyle-export-actions">
        <button type="button" className="secondary-button" onClick={() => runExport('json')} data-testid="after-close-review-export-json">JSONエクスポート</button>
        <button type="button" className="secondary-button" onClick={() => runExport('csv')} data-testid="after-close-review-export-csv">CSVエクスポート</button>
      </div>
      {message ? <small data-testid="after-close-review-export-message">{message}</small> : null}
    </div>
  );
}

function ReviewHistoryPanel({ reviewLog, onRestore }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('all');
  const [date, setDate] = useState('');
  const [restoreText, setRestoreText] = useState('');
  const [message, setMessage] = useState('');
  const filtered = useMemo(() => filterReviewHistory(reviewLog, { query, result, date }), [date, query, result, reviewLog]);
  const summary = useMemo(() => summarizeReviewOutcomes(reviewLog), [reviewLog]);

  const restore = () => {
    const restored = restoreReviewBackup(restoreText);
    setMessage(restored.message);
    if (restored.ok) onRestore(restored.records);
  };

  const loadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setRestoreText(await file.text());
    setMessage(`${file.name} を読み込みました。内容を確認して復元してください。`);
  };

  return (
    <div className="review-history-panel" data-testid="after-close-review-history">
      <div className="review-history-head"><div><span>履歴検索</span><strong>保存済みレビューを絞り込む</strong></div><b>{filtered.length}/{summary.total}件</b></div>
      <div className="review-history-controls">
        <input aria-label="レビュー銘柄検索" placeholder="銘柄コード・名称" value={query} onChange={(event) => setQuery(event.target.value)} />
        <input aria-label="レビュー日付" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <select aria-label="レビュー結果" value={result} onChange={(event) => setResult(event.target.value)}><option value="all">すべての結果</option><option value="verified">verified candidate</option><option value="research-only">research-only</option><option value="skipped">見送り</option></select>
      </div>
      <div className="review-outcome-grid" aria-label="結果比較">
        <div><span>結果比較</span><strong>全体 {summary.total}</strong></div>
        <div><span>verified candidate</span><strong>{summary.verified}</strong></div>
        <div><span>research-only</span><strong>{summary.researchOnly}</strong></div>
        <div><span>見送り</span><strong>{summary.skipped}</strong></div>
        <div><span>改善傾向</span><strong>プラス {summary.positive} / マイナス {summary.negative}</strong></div>
      </div>
      <div className="review-history-list">
        {filtered.slice(0, 20).map((record) => <span key={`${record.ticker}-${record.createdAt}`}>{String(record.createdAt || '').slice(0, 10) || '日付なし'} / {record.ticker} / {record.decisionResult || '判断結果未入力'} / 損益 {yen(record.pnl)}</span>)}
        {!filtered.length ? <span>条件に一致する履歴はありません。</span> : null}
      </div>
      <details className="review-restore-panel">
        <summary>JSON/CSVバックアップを復元</summary>
        <input type="file" accept=".json,.csv,application/json,text/csv" onChange={loadFile} />
        <textarea aria-label="レビュー復元データ" value={restoreText} onChange={(event) => setRestoreText(event.target.value)} />
        <button type="button" className="secondary-button" onClick={restore} data-testid="after-close-review-restore">端末内へ復元</button>
        <small>復元は現在のローカル履歴を置き換えます。外部送信はありません。</small>
        {message ? <p>{message}</p> : null}
      </details>
    </div>
  );
}

function ReviewView({ form, setForm, draft, reviewLog, reviewInsights, onSave, onRestore, saveMessage }) {
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="lifestyle-mode-body" data-testid="lifestyle-after-close-review">
      <div className="lifestyle-review-grid">
        {[
          ['ticker', '銘柄コード', '7203.T'],
          ['entryPrice', 'エントリー価格', '3000'],
          ['exitPrice', '売却価格', '3040'],
          ['shares', '株数', '100'],
          ['initialScore', '当初スコア', '70'],
          ['decisionMode', '判断モード', 'Morning Gate'],
          ['decisionResult', '判断結果', '確認推奨'],
        ].map(([key, label, placeholder]) => (
          <label key={key}>
            <span>{label}</span>
            <input data-testid={`after-close-review-${key}`} value={form[key] || ''} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} />
          </label>
        ))}
        {[
          ['originalReason', '当初の根拠'],
          ['workedReason', '実際に効いた根拠'],
          ['exitReason', '売却・撤退理由'],
          ['missedSignal', '見送るべきだったサイン'],
          ['improvementMemo', '次回改善メモ'],
        ].map(([key, label]) => (
          <label key={key} className="wide">
            <span>{label}</span>
            <textarea data-testid={`after-close-review-${key}`} value={form[key] || ''} onChange={(event) => update(key, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="lifestyle-review-output">
        <strong>ローカル記録JSON</strong>
        {draft.errors.length ? <p>{draft.errors.join(' / ')}</p> : <p>損益: {yen(draft.record.pnl)} / 今後の判断材料として保存できます。</p>}
        <button type="button" className="secondary-button" onClick={onSave} data-testid="after-close-review-save">振り返りログに保存</button>
        {saveMessage ? <p data-testid="after-close-review-save-message">{saveMessage}</p> : null}
        <textarea readOnly value={draft.json} data-testid="after-close-review-json" />
        <div className="lifestyle-review-log" data-testid="after-close-review-log">
          <strong>保存済み改善ログ</strong>
          {reviewLog.length ? reviewLog.slice(0, 5).map((record) => (
            <span key={`${record.ticker}-${record.createdAt}`}>
              {record.ticker} / {classifyAfterCloseReview(record).label} / 損益 {yen(record.pnl)} / {record.improvementMemo || '改善メモ未入力'}
            </span>
          )) : <span>この端末の保存ログはまだありません。</span>}
          <small>このログはローカル保存のみです。実注文や外部送信は行いません。</small>
        </div>
      </div>
      <ReviewExportPanel reviewLog={reviewLog} />
      <ReviewHistoryPanel reviewLog={reviewLog} onRestore={onRestore} />
      <ReviewInsightPanel reviewInsights={reviewInsights} />
    </div>
  );
}

export default function LifestyleDaytradePanel({
  stocks = [],
  selectedStock,
  selectedDetail,
  holdings = [],
  watchlistPreopenResults = [],
  selectedAdvancedReport = {},
  advancedReportsByTicker = {},
  daytradeSignals = [],
  daytradeSource = '',
  alertReport = {},
  marketPhase = {},
  fetchedAt = '',
  marketFreshnessLabel = '',
}) {
  const [activeMode, setActiveMode] = useState('night');
  const [morningManualPrice, setMorningManualPrice] = useState('');
  const [monitorPrices, setMonitorPrices] = useState({});
  const [reviewForm, setReviewForm] = useState({});
  const [reviewLog, setReviewLog] = useState(() => loadAfterCloseReviewLog());
  const [reviewSaveMessage, setReviewSaveMessage] = useState('');
  const [showVerification, setShowVerification] = useState(false);
  const reviewInsights = useMemo(() => buildReviewDrivenInsights(reviewLog), [reviewLog]);

  const detailsByTicker = useMemo(() => {
    if (!selectedDetail?.ticker) return {};
    return { [selectedDetail.ticker]: selectedDetail };
  }, [selectedDetail]);

  const nightRows = useMemo(() => buildNightScanRows({
    stocks,
    detailsByTicker,
    watchlistResults: watchlistPreopenResults,
    advancedReportsByTicker,
    reviewInsights,
    fetchedAt,
  }), [advancedReportsByTicker, detailsByTicker, fetchedAt, reviewInsights, stocks, watchlistPreopenResults]);

  const selectedTicker = selectedStock?.ticker || selectedDetail?.ticker || nightRows[0]?.ticker;
  const selectedPreopen = useMemo(() => {
    const normalized = String(selectedTicker || '').replace('.T', '');
    return watchlistPreopenResults.find((item) => String(item.ticker || '').includes(normalized)) || {};
  }, [selectedTicker, watchlistPreopenResults]);

  const morningGate = useMemo(() => buildMorningGate({
    stock: selectedStock || nightRows[0] || {},
    detail: selectedDetail || {},
    preopenResult: selectedPreopen,
    advancedReport: selectedAdvancedReport,
    reviewInsights,
    manualPrice: morningManualPrice,
  }), [morningManualPrice, nightRows, reviewInsights, selectedAdvancedReport, selectedDetail, selectedPreopen, selectedStock]);

  const workRows = useMemo(() => buildWorkMonitorRows({
    holdings,
    manualPrices: monitorPrices,
    advancedReportsByTicker,
    reviewInsights,
  }), [advancedReportsByTicker, holdings, monitorPrices, reviewInsights]);

  const decisionBrief = useMemo(() => buildDecisionSupportBrief({
    nightRows,
    morningGate,
    workRows,
    fetchedAt,
    marketFreshnessLabel,
  }), [fetchedAt, marketFreshnessLabel, morningGate, nightRows, workRows]);

  const preTradeChecklist = useMemo(() => buildPreTradeChecklist({
    gate: morningGate,
    topRow: nightRows[0] || {},
  }), [morningGate, nightRows]);

  const zenLoopDesk = useMemo(() => buildZenLoopDeskPayload({
    stocks,
    nightRows,
    daytradeSignals,
    alertReport: {
      ...alertReport,
      source: daytradeSource,
    },
    reviewInsights,
    marketPhase,
    fetchedAt,
  }), [alertReport, daytradeSignals, daytradeSource, fetchedAt, marketPhase, nightRows, reviewInsights, stocks]);

  const reviewDraft = useMemo(() => buildAfterCloseReviewDraft({
    ticker: reviewForm.ticker || selectedTicker || '',
    companyName: selectedStock?.name || selectedDetail?.name || '',
    ...reviewForm,
  }), [reviewForm, selectedDetail, selectedStock, selectedTicker]);

  const updateMonitorPrice = (ticker, value) => {
    setMonitorPrices((current) => ({ ...current, [ticker]: value }));
  };

  const saveReviewDraft = () => {
    const result = saveAfterCloseReviewDraft(reviewDraft);
    setReviewLog(result.records);
    setReviewSaveMessage(result.message);
  };

  return (
    <section className="lifestyle-daytrade-panel" data-testid="lifestyle-daytrade-panel">
      <div className="lifestyle-panel-head">
        <div>
          <span>生活導線デイトレ確認</span>
          <strong>今日の確認から必要な時間帯へ進む</strong>
          <small>手動判断のための材料整理です。実注文、自動売却、証券会社API接続は行いません。</small>
        </div>
        <div className="lifestyle-source">
          <span>{marketFreshnessLabel || 'データ取得時刻は取得元表示を確認'}</span>
          <small>{fetchedAt ? `最終確認: ${fetchedAt}` : '取得不可の項目は手入力してください'}</small>
        </div>
      </div>
      <TodayCheckDashboard
        brief={decisionBrief}
        checklist={preTradeChecklist}
        zenLoopDesk={zenLoopDesk}
        showVerification={showVerification}
        onToggleVerification={() => setShowVerification((current) => !current)}
      />
      {showVerification ? <ZenLoopDeskPanel payload={zenLoopDesk} /> : null}
      <div className="lifestyle-mode-tabs" role="tablist" aria-label="生活導線モード">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={activeMode === mode.id ? 'active' : ''}
            onClick={() => setActiveMode(mode.id)}
            data-testid={`lifestyle-mode-${mode.id}`}
          >
            <strong>{mode.label}</strong>
            <span>{mode.caption}</span>
          </button>
        ))}
      </div>
      {activeMode === 'night' ? <NightScanView rows={nightRows} /> : null}
      {activeMode === 'morning' ? (
        <MorningGateView gate={morningGate} value={morningManualPrice} onChange={setMorningManualPrice} />
      ) : null}
      {activeMode === 'work' ? (
        <WorkMonitorView rows={workRows} manualPrices={monitorPrices} onChange={updateMonitorPrice} />
      ) : null}
      {activeMode === 'review' ? (
        <ReviewView
          form={reviewForm}
          setForm={setReviewForm}
          draft={reviewDraft}
          reviewLog={reviewLog}
          reviewInsights={reviewInsights}
          onSave={saveReviewDraft}
          onRestore={setReviewLog}
          saveMessage={reviewSaveMessage}
        />
      ) : null}
    </section>
  );
}
