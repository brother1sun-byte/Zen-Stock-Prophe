import { useCallback, useMemo, useState } from 'react';

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function maxDrawdown(values) {
  let peak = values[0] || 0;
  let worst = 0;
  values.forEach((value) => {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, (value - peak) / peak);
  });
  return worst * 100;
}

function lifecycleLabel(action) {
  return {
    SOLD: '売却済み',
    VOIDED: '入力ミス訂正',
    ARCHIVED: '非表示保管',
  }[action] || action;
}

function lifecycleReason(action) {
  return {
    SOLD: '売却したため通常ポートフォリオから外す',
    VOIDED: '入力ミスのため訂正として通常ポートフォリオから外す',
    ARCHIVED: '現在の確認対象ではないため通常表示から外す',
  }[action] || 'portfolio lifecycle update';
}

export function portfolioStatusLabel(status) {
  const labels = {
    ACTIVE: '保有中',
    SOLD: '売却済み',
    VOIDED: '入力ミス',
    ARCHIVED: '非表示',
  };
  return labels[status] || status || '保有中';
}

export function usePortfolioLedger({
  portfolio,
  chartData = [],
  selectedDetail,
  persistLifecycle,
  hydrate,
  addLog,
  setBusy,
  setStatus,
}) {
  const [lifecycleEvents, setLifecycleEvents] = useState([]);
  const [pendingLifecycle, setPendingLifecycle] = useState(null);
  const holdings = useMemo(() => portfolio?.holdings || [], [portfolio]);
  const archivedHoldings = useMemo(() => portfolio?.archivedHoldings || [], [portfolio]);

  const allocation = useMemo(() => {
    const holdingRows = holdings.map((item) => ({ name: item.name || item.ticker, value: item.value || 0 }));
    return [...holdingRows, { name: '現金', value: portfolio?.cash || 0 }].filter((item) => item.value > 0);
  }, [holdings, portfolio]);

  const portfolioHealth = useMemo(() => {
    const totalAssets = Number(portfolio?.totalAssets || 0);
    const cash = Number(portfolio?.cash || 0);
    const values = holdings.map((holding) => Number(holding.value || 0));
    const maxHoldingPct = totalAssets ? (Math.max(0, ...values) / totalAssets) * 100 : 0;
    const cashPct = totalAssets ? (cash / totalAssets) * 100 : 0;
    const closeValues = chartData.map((point) => Number(point.close || 0)).filter(Boolean);
    const returns = closeValues.slice(1).map((value, index) => (value - closeValues[index]) / closeValues[index]);
    const volatility = standardDeviation(returns) * Math.sqrt(252) * 100;
    const drawdown = maxDrawdown(closeValues);

    const diversificationScore = clamp((holdings.length / 5) * 55 + (100 - maxHoldingPct) * 0.45);
    const cashScore = cashPct >= 5 && cashPct <= 35 ? 100 : cashPct < 5 ? cashPct * 12 : Math.max(35, 100 - (cashPct - 35) * 1.3);
    const disciplineScore = selectedDetail?.analysis?.strategy?.stop_loss ? 88 : 52;
    const riskScore = clamp(100 - Math.max(0, volatility - 18) - Math.max(0, Math.abs(drawdown) - 12) * 1.5);
    const score = Math.round(diversificationScore * 0.34 + cashScore * 0.2 + disciplineScore * 0.22 + riskScore * 0.24);
    const strategy = selectedDetail?.analysis?.strategy || {};
    const entry = Number(strategy.buy_limit || 0);
    const rr = Number(strategy.rr_ratio || 0);

    const checklist = [
      { label: '明日買える上限価格を確認する', done: Boolean(entry) },
      { label: '損切り価格を先に決める', done: Boolean(strategy.stop_loss) },
      { label: '利確が損切り幅より十分大きい', done: rr >= 2 },
      { label: '100株を買う余力が残る', done: entry > 0 && cash >= entry * 100 },
      { label: '1銘柄の集中を50%以下に抑える', done: maxHoldingPct <= 50 },
      { label: '成行は板条件OK時だけにする', done: selectedDetail?.analysis?.execution?.marketAllowed || selectedDetail?.analysis?.execution?.decision !== 'BUY_NOW' },
    ];

    return {
      score,
      grade: score >= 82 ? 'A' : score >= 68 ? 'B' : score >= 52 ? 'C' : 'D',
      maxHoldingPct,
      cashPct,
      volatility,
      drawdown,
      checklist,
      completed: checklist.filter((item) => item.done).length,
    };
  }, [chartData, holdings, portfolio, selectedDetail]);

  const latestLifecycleByTicker = useMemo(() => lifecycleEvents.reduce((acc, event) => {
    if (event?.ticker && !acc[event.ticker]) acc[event.ticker] = event;
    return acc;
  }, {}), [lifecycleEvents]);

  const lifecycleFeed = useMemo(() => lifecycleEvents.map((event) => ({
    ...event,
    title: event.ok ? '台帳更新完了' : '台帳更新失敗',
    subtitle: event.ok ? `${event.actionLabel}完了` : event.actionLabel,
  })), [lifecycleEvents]);

  const riskMetrics = useMemo(() => ([
    ['年率変動', `${portfolioHealth.volatility.toFixed(1)}%`],
    ['最大下落', `${portfolioHealth.drawdown.toFixed(1)}%`],
    ['集中度', `${portfolioHealth.maxHoldingPct.toFixed(1)}%`],
    ['現金比率', `${portfolioHealth.cashPct.toFixed(1)}%`],
  ]), [portfolioHealth]);

  const verdictRows = useMemo(() => ([
    { label: '健全性', value: `${portfolioHealth.score}/100` },
    { label: '最大集中', value: `${portfolioHealth.maxHoldingPct.toFixed(1)}%` },
    { label: '現金比率', value: `${portfolioHealth.cashPct.toFixed(1)}%` },
  ]), [portfolioHealth]);

  const recordLifecycleEvent = useCallback((event) => {
    setLifecycleEvents((current) => [{
      id: `${event.ticker}-${event.action}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      ...event,
    }, ...current].slice(0, 8));
  }, []);

  const closePortfolioPosition = useCallback(async (holding, action) => {
    const actionLabel = lifecycleLabel(action);
    const reason = lifecycleReason(action);
    const ticker = holding?.ticker;
    if (!ticker) {
      const error = new Error('銘柄コードが不明なため台帳状態を更新できません。');
      recordLifecycleEvent({
        ok: false,
        ticker: 'UNKNOWN',
        action,
        actionLabel,
        message: error.message,
      });
      setStatus?.({ tone: 'bad', text: `${actionLabel}失敗` });
      return { ok: false, error };
    }

    setPendingLifecycle({ ticker, action, actionLabel });
    setBusy?.(`position-${ticker}-${action}`);
    setStatus?.({ tone: 'warn', text: `${actionLabel}処理中` });
    addLog?.('Jobs', `${ticker} を${actionLabel}として台帳に残します。削除も実注文もしません。`);
    try {
      const result = await persistLifecycle?.(holding, action, reason);
      const message = result?.message || `${ticker} を${actionLabel}にしました。`;
      addLog?.('PORT', message);
      recordLifecycleEvent({
        ok: true,
        ticker,
        action,
        actionLabel,
        message,
      });
      await hydrate?.(true);
      setStatus?.({ tone: 'good', text: `${actionLabel}完了` });
      return { ok: true, result };
    } catch (error) {
      const message = `${ticker} の台帳状態更新に失敗しました: ${error.message}`;
      addLog?.('SYS', message);
      recordLifecycleEvent({
        ok: false,
        ticker,
        action,
        actionLabel,
        message,
      });
      setStatus?.({ tone: 'bad', text: `${actionLabel}失敗` });
      return { ok: false, error };
    } finally {
      setPendingLifecycle(null);
      setBusy?.('');
    }
  }, [addLog, hydrate, persistLifecycle, recordLifecycleEvent, setBusy, setStatus]);

  return {
    holdings,
    archivedHoldings,
    allocation,
    portfolioHealth,
    lifecycleEvents,
    lifecycleFeed,
    riskMetrics,
    verdictRows,
    latestLifecycleByTicker,
    pendingLifecycle,
    closePortfolioPosition,
  };
}
