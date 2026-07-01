import React, { useMemo, useState } from 'react';
import {
  buildAfterCloseReviewDraft,
  buildMorningGate,
  buildNightScanRows,
  buildWorkMonitorRows,
} from '../utils/lifestyleDaytradeModes';

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
            <small>{line.estimated ? '推定: ' : ''}{line.reason}</small>
          </div>
        );
      })}
    </div>
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
            </div>
          </article>
        )) : (
          <div className="lifestyle-empty">保有中チェックの対象はまだありません。必要に応じて練習台帳に登録してください。</div>
        )}
      </div>
    </div>
  );
}

function ReviewView({ form, setForm, draft }) {
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="lifestyle-mode-body" data-testid="lifestyle-after-close-review">
      <div className="lifestyle-review-grid">
        {[
          ['ticker', '銘柄コード', '7203.T'],
          ['entryPrice', 'エントリー価格', '3000'],
          ['exitPrice', '売却価格', '3040'],
          ['shares', '株数', '100'],
        ].map(([key, label, placeholder]) => (
          <label key={key}>
            <span>{label}</span>
            <input value={form[key] || ''} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} />
          </label>
        ))}
        {[
          ['originalReason', '当初の根拠'],
          ['workedReason', '実際に効いた根拠'],
          ['missedSignal', '見送るべきだったサイン'],
          ['improvementMemo', '次回改善メモ'],
        ].map(([key, label]) => (
          <label key={key} className="wide">
            <span>{label}</span>
            <textarea value={form[key] || ''} onChange={(event) => update(key, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="lifestyle-review-output">
        <strong>ローカル記録JSON</strong>
        {draft.errors.length ? <p>{draft.errors.join(' / ')}</p> : <p>損益: {yen(draft.record.pnl)} / 今後の判断材料として保存できます。</p>}
        <textarea readOnly value={draft.json} data-testid="after-close-review-json" />
      </div>
    </div>
  );
}

export default function LifestyleDaytradePanel({
  stocks = [],
  selectedStock,
  selectedDetail,
  holdings = [],
  watchlistPreopenResults = [],
  fetchedAt = '',
  marketFreshnessLabel = '',
}) {
  const [activeMode, setActiveMode] = useState('night');
  const [morningManualPrice, setMorningManualPrice] = useState('');
  const [monitorPrices, setMonitorPrices] = useState({});
  const [reviewForm, setReviewForm] = useState({});

  const detailsByTicker = useMemo(() => {
    if (!selectedDetail?.ticker) return {};
    return { [selectedDetail.ticker]: selectedDetail };
  }, [selectedDetail]);

  const nightRows = useMemo(() => buildNightScanRows({
    stocks,
    detailsByTicker,
    watchlistResults: watchlistPreopenResults,
    fetchedAt,
  }), [detailsByTicker, fetchedAt, stocks, watchlistPreopenResults]);

  const selectedTicker = selectedStock?.ticker || selectedDetail?.ticker || nightRows[0]?.ticker;
  const selectedPreopen = useMemo(() => {
    const normalized = String(selectedTicker || '').replace('.T', '');
    return watchlistPreopenResults.find((item) => String(item.ticker || '').includes(normalized)) || {};
  }, [selectedTicker, watchlistPreopenResults]);

  const morningGate = useMemo(() => buildMorningGate({
    stock: selectedStock || nightRows[0] || {},
    detail: selectedDetail || {},
    preopenResult: selectedPreopen,
    manualPrice: morningManualPrice,
  }), [morningManualPrice, nightRows, selectedDetail, selectedPreopen, selectedStock]);

  const workRows = useMemo(() => buildWorkMonitorRows({
    holdings,
    manualPrices: monitorPrices,
  }), [holdings, monitorPrices]);

  const reviewDraft = useMemo(() => buildAfterCloseReviewDraft({
    ticker: reviewForm.ticker || selectedTicker || '',
    companyName: selectedStock?.name || selectedDetail?.name || '',
    ...reviewForm,
  }), [reviewForm, selectedDetail, selectedStock, selectedTicker]);

  const updateMonitorPrice = (ticker, value) => {
    setMonitorPrices((current) => ({ ...current, [ticker]: value }));
  };

  return (
    <section className="lifestyle-daytrade-panel" data-testid="lifestyle-daytrade-panel">
      <div className="lifestyle-panel-head">
        <div>
          <span>生活導線デイトレ確認</span>
          <strong>帰宅後・翌朝・仕事中・引け後を1画面で整理</strong>
          <small>手動判断のための材料整理です。実注文、自動売却、証券会社API接続は行いません。</small>
        </div>
        <div className="lifestyle-source">
          <span>{marketFreshnessLabel || 'データ取得時刻は取得元表示を確認'}</span>
          <small>{fetchedAt ? `最終確認: ${fetchedAt}` : '取得不可の項目は手入力してください'}</small>
        </div>
      </div>
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
        <ReviewView form={reviewForm} setForm={setReviewForm} draft={reviewDraft} />
      ) : null}
    </section>
  );
}
