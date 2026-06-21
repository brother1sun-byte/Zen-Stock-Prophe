import { Loader2, Save, Target, XCircle } from 'lucide-react';
import { DataSourceBadge, DataSourceWarning } from './DataSourceBadge';

function PanelStatusPill({ label, tone = 'neutral' }) {
  return <span className={`pill ${tone}`}>{label}</span>;
}

export function PracticeOrderForm({
  positionForm,
  updatePositionForm,
  validation,
  statusLabel,
  busy,
  practicePriceSource,
  onSubmit,
  onApplyCandidate,
  onCancelCurrent,
}) {
  return (
    <form className="practice-order-panel" onSubmit={onSubmit}>
      <div className="practice-panel-head">
        <div>
          <span>練習注文</span>
          <strong>手入力前チェック</strong>
        </div>
        <PanelStatusPill label="実注文なし" tone="warn" />
      </div>
      <DataSourceWarning source={practicePriceSource} />
      <div className="practice-order-grid">
        <label>
          <span>銘柄</span>
          <input data-testid="practice-order-ticker" value={positionForm.ticker} onChange={(event) => updatePositionForm('ticker', event.target.value)} placeholder="4980.T" />
        </label>
        <label>
          <span>買値</span>
          <input data-testid="practice-order-price" type="number" min="1" step="0.1" value={positionForm.entryPrice} onChange={(event) => updatePositionForm('entryPrice', event.target.value)} />
        </label>
        <label>
          <span>株数</span>
          <input data-testid="practice-order-shares" type="number" min="1" step="1" value={positionForm.shares} onChange={(event) => updatePositionForm('shares', event.target.value)} />
        </label>
      </div>
      <div className="practice-order-status" data-testid="practice-order-status">
        <PanelStatusPill label={statusLabel} tone={validation.ok ? 'neutral' : 'warn'} />
        <span>{validation.ok ? '入力内容を確認してから練習台帳に保存します。' : validation.errors[0]}</span>
      </div>
      {validation.warnings.length > 0 && (
        <div className="practice-order-warning" data-testid="practice-order-warning">
          {validation.warnings.slice(0, 2).map((message) => <small key={message}>{message}</small>)}
        </div>
      )}
      <div className="practice-order-actions">
        <button type="button" className="ghost-action" onClick={onApplyCandidate}>
          <Target size={15} />
          候補を反映
        </button>
        <button data-testid="practice-order-save" type="submit" className="treasure-button" disabled={busy === 'position'}>
          {busy === 'position' ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
          台帳に保存
        </button>
        <button data-testid="practice-order-cancel-current" type="button" className="ghost-action" onClick={onCancelCurrent}>
          <XCircle size={15} />
          取消として記録
        </button>
      </div>
      <p className="practice-disclaimer">この保存は練習用の保有台帳です。証券会社への注文、投資助言、利益保証ではありません。</p>
    </form>
  );
}

export function PracticeLedgerSummary({
  practiceTicker,
  practiceHoldings,
  practicePriceSource,
  portfolio,
  practicePnl,
  yen,
  pct,
}) {
  const holdingValue = practiceHoldings.reduce((sum, item) => sum + Number(item.value || 0), 0);
  return (
    <div className="practice-ledger-panel">
      <div className="practice-panel-head">
        <div>
          <span>保有と損益</span>
          <strong>保有と損益</strong>
        </div>
        <PanelStatusPill label={`${practiceHoldings.length}件`} tone="info" />
      </div>
      <div className="practice-pnl-strip">
        <div><span>{practiceTicker}評価</span><strong>{yen(holdingValue)}</strong><DataSourceBadge source={practicePriceSource} compact /></div>
        <div><span>現金</span><strong>{yen(portfolio?.cash)}</strong></div>
        <div><span>含み損益</span><strong className={practicePnl >= 0 ? 'up' : 'down'}>{yen(practicePnl)}</strong></div>
      </div>
      <div className="practice-position-list">
        {practiceHoldings.slice(0, 3).map((holding) => (
          <div key={`practice-holding-${holding.ticker}`}>
            <span>{holding.ticker}</span>
            <strong>{holding.shares}株 / {yen(holding.currentPrice)}</strong>
            <small className={Number(holding.pnl || 0) >= 0 ? 'up' : 'down'}>{yen(holding.pnl)} / {pct(holding.pnlPct)}</small>
          </div>
        ))}
        {!practiceHoldings.length && <small>{practiceTicker}の練習保有を保存すると、ここに損益が表示されます。</small>}
      </div>
    </div>
  );
}

export function PracticeOrderHistory({
  practiceTicker,
  practiceTransactions,
  pendingStatus,
  tradeActionLabel,
  markPracticeOrderFilled,
  cancelPracticeOrder,
  yen,
}) {
  return (
    <div className="practice-history-panel">
      <div className="practice-panel-head">
        <div>
          <span>練習注文履歴</span>
          <strong>履歴</strong>
        </div>
        <PanelStatusPill label={`${practiceTicker} 最新5件`} tone="neutral" />
      </div>
      <div className="practice-history-list" data-testid="practice-history-list">
        {practiceTransactions.map((tx) => (
          <div data-testid="practice-history-item" key={`practice-tx-${tx.id || tx.createdAt || `${tx.ticker}-${tx.action}`}`}>
            <span>{tx.statusLabel || tradeActionLabel(tx.action)}</span>
            <strong>{tx.ticker} {tx.shares}株</strong>
            <small>{yen(tx.price)} / {yen(tx.total)}</small>
            {tx.sourceLabel && <small>データ出所: {tx.sourceLabel}</small>}
            {tx.saveError && <small className="down">保存失敗: {tx.saveError}</small>}
            {tx.isPracticeOrder && tx.practiceStatus === pendingStatus && (
              <div className="practice-history-actions">
                <button type="button" onClick={() => markPracticeOrderFilled(tx.id)}>約定済みにする</button>
                <button type="button" onClick={() => cancelPracticeOrder(tx.id)}>取消</button>
              </div>
            )}
          </div>
        ))}
        {!practiceTransactions.length && <small>{practiceTicker}の練習注文を保存すると、履歴に残ります。</small>}
      </div>
    </div>
  );
}
