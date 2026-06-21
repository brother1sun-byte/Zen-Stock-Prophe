import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function resolveEntryPrice(candidate, fallbackPrice) {
  const value = candidate?.entry ?? candidate?.entryPrice ?? candidate?.buyLimit ?? candidate?.price ?? fallbackPrice;
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? String(Math.round(number)) : '';
}

function selectedFromMarketItem(item) {
  if (!item) return null;
  return {
    ...item,
    emoji: item.emoji || 'JP',
    candidateScore: item.candidateScore ?? item.surgeScore ?? 0,
    candidateReason: item.reason || item.surgeStage || '検索・ランキングから選択した銘柄です。',
  };
}

function selectedFromDetail(detail) {
  if (!detail) return null;
  return {
    ticker: detail.ticker,
    name: detail.name || detail.ticker,
    emoji: 'JP',
    price: detail.price,
    candidateScore: detail.preopenScore || detail.analysis?.confidence || 0,
    candidateReason: detail.analysis?.technicalSummary || detail.analysis?.reason || '詳細分析から表示しています。',
  };
}

export function useSelectedStock({
  initialTicker,
  selectedTicker: controlledSelectedTicker,
  setSelectedTicker: controlledSetSelectedTicker,
  topPick,
  topPickSyncKey,
  stocks = [],
  marketSearch,
  marketRankings,
  marketUniverse,
  detail,
  advancedReport,
  advancedReportsByTicker,
  setDetail,
  setAdvancedReport,
  setDaytradeAnalysis,
  setDaytradeRoutine,
  setJquantsCode,
  setSearchQuery,
  setPositionForm,
  addLog,
}) {
  const [internalSelectedTicker, setInternalSelectedTicker] = useState(initialTicker);
  const selectedTicker = controlledSelectedTicker ?? internalSelectedTicker;
  const setSelectedTicker = controlledSetSelectedTicker ?? setInternalSelectedTicker;
  const [userSelectedTicker, setUserSelectedTicker] = useState('');
  const lastSyncedTopPickRef = useRef('');

  const syncSelection = useCallback((candidate, { source = 'manual', note, force = false } = {}) => {
    const ticker = candidate?.ticker || candidate;
    if (!ticker) return;
    if (source !== 'top-pick') {
      setUserSelectedTicker(ticker);
    }
    setDetail((current) => (current?.ticker === ticker ? current : null));
    setAdvancedReport(null);
    setDaytradeAnalysis(null);
    setDaytradeRoutine(null);
    setSelectedTicker(ticker);
    setJquantsCode(ticker);
    if (source !== 'watchlist' || force) {
      setSearchQuery(ticker);
    }
    setPositionForm((current) => {
      const entryPrice = resolveEntryPrice(candidate, current.entryPrice);
      return {
        ...current,
        ticker,
        name: candidate?.name || current.name || ticker,
        entryPrice: entryPrice || current.entryPrice,
        shares: candidate?.shares ? String(candidate.shares) : current.shares,
        note: note || current.note,
      };
    });
  }, [
    setAdvancedReport,
    setDaytradeAnalysis,
    setDaytradeRoutine,
    setDetail,
    setJquantsCode,
    setPositionForm,
    setSearchQuery,
    setSelectedTicker,
  ]);

  useEffect(() => {
    if (!topPick?.ticker || !topPickSyncKey) return;
    if (userSelectedTicker && userSelectedTicker !== topPick.ticker) return;
    if (lastSyncedTopPickRef.current === topPickSyncKey) return;
    lastSyncedTopPickRef.current = topPickSyncKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    syncSelection(topPick, { source: 'top-pick', note: '本日の最有力候補を反映' });
  }, [syncSelection, topPick, topPickSyncKey, userSelectedTicker]);

  const selectedMarketItem = useMemo(() => {
    const pools = [
      ...(marketSearch?.items || []),
      ...(marketRankings?.items || []),
      ...(marketUniverse?.sample || []),
    ];
    return pools.find((item) => item.ticker === selectedTicker) || null;
  }, [marketRankings, marketSearch, marketUniverse, selectedTicker]);

  const selectedStock = useMemo(() => {
    const watchStock = stocks.find((stock) => stock.ticker === selectedTicker);
    return watchStock
      || selectedFromMarketItem(selectedMarketItem)
      || (detail?.ticker === selectedTicker ? selectedFromDetail(detail) : null)
      || { ticker: selectedTicker, name: selectedTicker, emoji: 'JP', price: 0, candidateScore: 0 };
  }, [detail, selectedMarketItem, selectedTicker, stocks]);

  const selectedDetail = detail?.ticker === selectedTicker ? detail : null;
  const selectedAdvancedReport = advancedReportsByTicker?.[selectedTicker]
    || (advancedReport?.ticker === selectedTicker ? advancedReport : null);

  const chooseTicker = useCallback((tickerOrCandidate, options = {}) => {
    syncSelection(tickerOrCandidate, {
      source: options.source || 'watchlist',
      note: options.note,
      force: options.force,
    });
  }, [syncSelection]);

  const selectMarketTicker = useCallback((item) => {
    if (!item?.ticker) return;
    syncSelection(item, { source: 'market', note: '検索・ランキング銘柄を反映', force: true });
    addLog?.('Market', `${item.ticker} ${item.name || ''} を詳細分析に送りました。`);
  }, [addLog, syncSelection]);

  const focusTopPick = useCallback(() => {
    if (!topPick?.ticker) return;
    setUserSelectedTicker('');
    lastSyncedTopPickRef.current = '';
    syncSelection(topPick, { source: 'top-pick', note: '本日の最有力候補を反映', force: true });
    addLog?.('Market', `${topPick.ticker} ${topPick.name || ''} を条件一致トップとして詳細分析に送りました。`);
  }, [addLog, syncSelection, topPick]);

  return {
    selectedTicker,
    setSelectedTicker,
    userSelectedTicker,
    selectedMarketItem,
    selectedStock,
    selectedDetail,
    selectedAdvancedReport,
    chooseTicker,
    selectMarketTicker,
    focusTopPick,
  };
}
