import { useCallback, useMemo, useRef, useState } from 'react';
import { api, writeCache } from '../api/apiClient';
import {
  buildMarketCachePayload,
  buildHydratedMarketState,
  buildMarketFreshness,
  buildMarketStatusView,
  normalizeRankingPayload,
} from './useMarketDataHelpers';

export function useMarketData({
  cached,
  fallback,
  browserMarketStatus,
  selectedTicker,
  setSelectedTicker,
  rankingKind,
  setRankingKind,
  ensureStocks,
  cacheExtras,
  addLog,
  setBusy,
  setStatus,
}) {
  const detailRequestsRef = useRef(new Map());
  const rankingRequestIdRef = useRef(0);
  const [stocks, setStocks] = useState(ensureStocks(cached?.stocks || fallback.stocks));
  const [portfolio, setPortfolio] = useState(cached?.portfolio || fallback.portfolio);
  const [transactions, setTransactions] = useState(cached?.transactions || fallback.transactions);
  const [detail, setDetail] = useState(cached?.detail?.ticker === selectedTicker ? cached.detail : null);
  const [advancedReport, setAdvancedReport] = useState(cached?.advancedReport?.ticker === selectedTicker ? cached.advancedReport : null);
  const [advancedReportsByTicker, setAdvancedReportsByTicker] = useState(() => {
    const reports = { ...(cached?.advancedReportsByTicker || {}) };
    if (cached?.advancedReport?.ticker) reports[cached.advancedReport.ticker] = cached.advancedReport;
    return reports;
  });
  const [marketUniverse, setMarketUniverse] = useState(cached?.marketUniverse || null);
  const [marketRankings, setMarketRankings] = useState(() => (
    cached?.marketRankings ? normalizeRankingPayload(cached.marketRankings, cached.rankingKind || rankingKind) : null
  ));
  const [marketSearch, setMarketSearch] = useState(cached?.marketSearch || { items: [] });
  const [marketError, setMarketError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(cached?.cachedAt ? new Date(cached.cachedAt) : null);

  const marketFreshness = useMemo(() => {
    return buildMarketFreshness({
      cached,
      lastUpdated,
      marketError,
      marketRankings,
      stocks,
    });
  }, [cached, lastUpdated, marketError, marketRankings, stocks]);

  const marketStatusView = useMemo(() => buildMarketStatusView({
    marketRankings,
    browserMarketStatus,
    marketFreshness,
  }), [browserMarketStatus, marketFreshness, marketRankings]);

  const writeMarketCache = useCallback((overrides = {}) => {
    writeCache(buildMarketCachePayload({
      stocks,
      portfolio,
      transactions,
      detail,
      advancedReport,
      advancedReportsByTicker,
      marketUniverse,
      marketRankings,
      rankingKind,
      marketSearch,
      selectedTicker,
      ...cacheExtras,
    }, overrides));
  }, [advancedReport, advancedReportsByTicker, cacheExtras, detail, marketRankings, marketSearch, marketUniverse, portfolio, rankingKind, selectedTicker, stocks, transactions]);

  const hydrateMarketData = useCallback(async (background = false) => {
    if (!background) setBusy?.('sync');
    const now = new Date();
    const rankingRequestId = background
      ? rankingRequestIdRef.current
      : ++rankingRequestIdRef.current;
    const [stockResult, portfolioResult, txResult, universeResult, rankingResult] = await Promise.allSettled([
      api('/stocks'),
      api('/portfolio'),
      api('/transactions'),
      background
        ? Promise.resolve(marketUniverse)
        : api('/market/universe', { timeout: 12000 }),
      background
        ? Promise.resolve(marketRankings)
        : api(`/market/rankings?kind=${rankingKind}&limit=30`, { timeout: 90000 }),
    ]);

    const {
      errors,
      nextStocks,
      nextPortfolio,
      nextTransactions,
      nextMarketUniverse,
      nextMarketRankings,
      nextSelectedTicker,
    } = buildHydratedMarketState({
      stockResult,
      portfolioResult,
      txResult,
      universeResult,
      rankingResult,
      ensureStocks,
      stocks,
      portfolio,
      transactions,
      marketUniverse,
      marketRankings,
      selectedTicker,
    });

    setStocks(nextStocks);
    setPortfolio(nextPortfolio);
    setTransactions(nextTransactions);
    setMarketUniverse(nextMarketUniverse);
    const normalizedRankings = normalizeRankingPayload(nextMarketRankings, rankingKind);
    const rankingIsCurrent = rankingRequestId === rankingRequestIdRef.current;
    const activeRankings = rankingIsCurrent ? normalizedRankings : marketRankings;
    if (rankingIsCurrent) setMarketRankings(normalizedRankings);
    setLastUpdated(now);
    setMarketError(errors.length ? errors.join(' / ') : null);

    if (rankingIsCurrent && nextSelectedTicker !== selectedTicker) {
      setSelectedTicker?.(nextSelectedTicker);
    }

    setStatus?.({
      tone: errors.length ? 'warn' : 'good',
      text: errors.length ? '一部データ不足' : `ライブ ${now.toLocaleTimeString('ja-JP')}`,
    });
    if (errors.length) addLog?.('SYS', `取得できないデータがあります: ${errors[0]}`);

    writeMarketCache({
      stocks: nextStocks,
      portfolio: nextPortfolio,
      transactions: nextTransactions,
      marketUniverse: nextMarketUniverse,
      marketRankings: activeRankings,
      selectedTicker: rankingIsCurrent ? nextSelectedTicker : selectedTicker,
    });

    if (!background) setBusy?.('');
    return { stocks: nextStocks, portfolio: nextPortfolio, transactions: nextTransactions, marketUniverse: nextMarketUniverse, marketRankings: activeRankings, errors };
  }, [addLog, ensureStocks, marketRankings, marketUniverse, portfolio, rankingKind, selectedTicker, setBusy, setSelectedTicker, setStatus, stocks, transactions, writeMarketCache]);

  const loadDetail = useCallback((ticker) => {
    if (!ticker) return Promise.resolve(null);
    const activeRequest = detailRequestsRef.current.get(ticker);
    if (activeRequest) return activeRequest;

    setBusy?.('detail');
    const task = (async () => {
      try {
        const data = await api(`/stock/${encodeURIComponent(ticker)}`, { timeout: 30000 });
        let nextAdvancedReport = data.advancedReport || null;
        let advancedError = null;
        if (nextAdvancedReport && !nextAdvancedReport.ticker) {
          nextAdvancedReport = { ...nextAdvancedReport, ticker };
        }
        if (nextAdvancedReport?.ticker && nextAdvancedReport.ticker !== ticker) {
          nextAdvancedReport = null;
        }
        if (!nextAdvancedReport) {
          try {
            nextAdvancedReport = await api(`/analysis/advanced/${encodeURIComponent(ticker)}`, { timeout: 12000 });
            if (nextAdvancedReport && !nextAdvancedReport.ticker) {
              nextAdvancedReport = { ...nextAdvancedReport, ticker };
            }
            if (nextAdvancedReport?.ticker && nextAdvancedReport.ticker !== ticker) {
              nextAdvancedReport = null;
            }
          } catch (error) {
            advancedError = error;
          }
        }
        setDetail(data);
        if (nextAdvancedReport?.ticker === ticker) {
          setAdvancedReportsByTicker((current) => ({
            ...current,
            [ticker]: nextAdvancedReport,
          }));
          setAdvancedReport(nextAdvancedReport);
        }
        setLastUpdated(new Date());
        setStatus?.({ tone: nextAdvancedReport ? 'good' : 'warn', text: nextAdvancedReport ? `高度分析 ${ticker}` : `分析更新 ${ticker}` });
        if (advancedError) addLog?.('SYS', `${ticker} の高度分析は未取得: ${advancedError.message || '不明なエラー'}`);
        const cachedReports = nextAdvancedReport?.ticker === ticker
          ? { ...advancedReportsByTicker, [ticker]: nextAdvancedReport }
          : advancedReportsByTicker;
        writeMarketCache({
          selectedTicker: ticker,
          detail: data,
          advancedReport: nextAdvancedReport,
          advancedReportsByTicker: cachedReports,
        });
        return data;
      } catch (error) {
        setMarketError(error.message);
        addLog?.('SYS', `${ticker} の詳細取得をスキップ: ${error.message}`);
        setStatus?.({ tone: 'warn', text: '詳細データ不足' });
        return null;
      } finally {
        detailRequestsRef.current.delete(ticker);
        setBusy?.('');
      }
    })();

    detailRequestsRef.current.set(ticker, task);
    return task;
  }, [addLog, advancedReportsByTicker, setBusy, setStatus, writeMarketCache]);

  const loadMarketRankings = useCallback(async (kind = rankingKind) => {
    const requestId = ++rankingRequestIdRef.current;
    setRankingKind?.(kind);
    setMarketRankings((current) => (current ? normalizeRankingPayload(current, kind) : current));
    setBusy?.('market');
    try {
      const result = await api(`/market/rankings?kind=${kind}&limit=30`, { timeout: 30000 });
      const nextRankings = normalizeRankingPayload(result, kind);
      if (requestId !== rankingRequestIdRef.current) return null;
      setMarketRankings(nextRankings);
      setLastUpdated(new Date());
      writeMarketCache({ rankingKind: kind, marketRankings: nextRankings });
      return nextRankings;
    } catch (error) {
      if (requestId !== rankingRequestIdRef.current) return null;
      setMarketError(error.message);
      addLog?.('市場', `ランキング更新に失敗しました: ${error.message}`);
      setStatus?.({ tone: 'warn', text: 'ランキング取得失敗' });
      return null;
    } finally {
      if (requestId === rankingRequestIdRef.current) setBusy?.('');
    }
  }, [addLog, rankingKind, setBusy, setRankingKind, setStatus, writeMarketCache]);

  const searchMarket = useCallback(async (query) => {
    setBusy?.('market-search');
    try {
      const result = await api(`/market/search?q=${encodeURIComponent(query)}&limit=60`, { timeout: 12000 });
      setMarketSearch(result);
      setLastUpdated(new Date());
      addLog?.('市場', `${result.count}件の東証銘柄を検索しました。`);
      writeMarketCache({ searchQuery: query, marketSearch: result });
      return result;
    } catch (error) {
      setMarketError(error.message);
      addLog?.('市場', `銘柄検索に失敗しました: ${error.message}`);
      setStatus?.({ tone: 'warn', text: '銘柄検索失敗' });
      return null;
    } finally {
      setBusy?.('');
    }
  }, [addLog, setBusy, setStatus, writeMarketCache]);

  return {
    stocks,
    setStocks,
    portfolio,
    setPortfolio,
    transactions,
    setTransactions,
    detail,
    setDetail,
    advancedReport,
    setAdvancedReport,
    advancedReportsByTicker,
    setAdvancedReportsByTicker,
    marketUniverse,
    setMarketUniverse,
    marketRankings,
    setMarketRankings,
    marketSearch,
    setMarketSearch,
    marketFreshness,
    marketStatusView,
    hydrateMarketData,
    loadDetail,
    loadMarketRankings,
    searchMarket,
  };
}
