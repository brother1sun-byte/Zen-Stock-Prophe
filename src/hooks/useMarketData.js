import { useCallback, useMemo, useState } from 'react';
import { api, writeCache } from '../api/apiClient';
import { dataSourceBadgeInfo } from '../utils/dataSource';

function asArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function sourceFlags(...payloads) {
  const infos = payloads.filter(Boolean).map((payload) => dataSourceBadgeInfo(payload));
  const keys = new Set(infos.map((info) => info.key));
  return {
    dataSource: infos[0]?.key || 'unknown',
    isSynthetic: keys.has('synthetic'),
    isCached: keys.has('cache'),
    isDelayed: keys.has('jquants_delayed'),
    isUnknown: keys.has('unknown') || infos.length === 0,
    warnings: [...new Set(infos.map((info) => info.warning).filter(Boolean))],
  };
}

function normalizeRankingItems(items = []) {
  return asArray(items).map((item, index) => {
    const flags = sourceFlags(item, item.dataFreshness, item.dataQuality);
    const syntheticPenalty = flags.isSynthetic ? -35 : 0;
    return {
      ...item,
      rank: item.rank ?? index + 1,
      candidateScore: Math.max(0, Number(item.candidateScore ?? item.surgeScore ?? 0) + syntheticPenalty),
      dataSourceKey: flags.dataSource,
      isSynthetic: flags.isSynthetic,
      isCached: flags.isCached,
      isDelayed: flags.isDelayed,
      isUnknown: flags.isUnknown,
      sourceWarnings: flags.warnings,
      tradeReadiness: flags.isSynthetic || flags.isUnknown ? 'review' : item.tradeReadiness,
      simpleAction: flags.isSynthetic || flags.isUnknown ? '参考表示' : item.simpleAction,
    };
  });
}

export function useMarketData({
  cached,
  fallback,
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
  const [stocks, setStocks] = useState(ensureStocks(cached?.stocks || fallback.stocks));
  const [portfolio, setPortfolio] = useState(cached?.portfolio || fallback.portfolio);
  const [transactions, setTransactions] = useState(cached?.transactions || fallback.transactions);
  const [detail, setDetail] = useState(cached?.detail?.ticker === selectedTicker ? cached.detail : null);
  const [advancedReport, setAdvancedReport] = useState(cached?.advancedReport?.ticker === selectedTicker ? cached.advancedReport : null);
  const [marketUniverse, setMarketUniverse] = useState(cached?.marketUniverse || null);
  const [marketRankings, setMarketRankings] = useState(cached?.marketRankings || null);
  const [marketSearch, setMarketSearch] = useState(cached?.marketSearch || { items: [] });
  const [marketError, setMarketError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(cached?.cachedAt ? new Date(cached.cachedAt) : null);

  const marketFreshness = useMemo(() => {
    const rankingFlags = sourceFlags(marketRankings, marketRankings?.snapshot, marketRankings?.bestOpportunity, marketRankings?.bestAvailableOpportunity);
    const stockFlags = sourceFlags(...stocks.slice(0, 3));
    return {
      dataSource: rankingFlags.dataSource !== 'unknown' ? rankingFlags.dataSource : stockFlags.dataSource,
      isSynthetic: rankingFlags.isSynthetic || stockFlags.isSynthetic,
      isCached: Boolean(cached?.isCached || cached?.is_cached || rankingFlags.isCached || stockFlags.isCached),
      isDelayed: rankingFlags.isDelayed || stockFlags.isDelayed,
      isUnknown: rankingFlags.isUnknown && stockFlags.isUnknown,
      stale: lastUpdated ? Date.now() - lastUpdated.getTime() > 15 * 60 * 1000 : true,
      warnings: [...new Set([...rankingFlags.warnings, ...stockFlags.warnings])],
      lastUpdated,
      error: marketError,
    };
  }, [cached, lastUpdated, marketError, marketRankings, stocks]);

  const writeMarketCache = useCallback((overrides = {}) => {
    writeCache({
      stocks,
      portfolio,
      transactions,
      detail,
      advancedReport,
      marketUniverse,
      marketRankings,
      rankingKind,
      marketSearch,
      selectedTicker,
      ...cacheExtras,
      ...overrides,
    });
  }, [advancedReport, cacheExtras, detail, marketRankings, marketSearch, marketUniverse, portfolio, rankingKind, selectedTicker, stocks, transactions]);

  const hydrateMarketData = useCallback(async (background = false) => {
    if (!background) setBusy?.('sync');
    const now = new Date();
    const [stockResult, portfolioResult, txResult, universeResult, rankingResult] = await Promise.allSettled([
      api('/stocks'),
      api('/portfolio'),
      api('/transactions'),
      api('/market/universe', { timeout: 12000 }),
      api(`/market/rankings?kind=${rankingKind}&limit=30`, { timeout: 90000 }),
    ]);

    const errors = [stockResult, portfolioResult, txResult, universeResult, rankingResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || '取得失敗');

    const nextStocks = ensureStocks(stockResult.status === 'fulfilled' && stockResult.value?.length ? stockResult.value : stocks);
    const nextPortfolio = portfolioResult.status === 'fulfilled' && portfolioResult.value ? portfolioResult.value : portfolio;
    const nextTransactions = txResult.status === 'fulfilled' && txResult.value?.length ? txResult.value : transactions;
    const nextMarketUniverse = universeResult.status === 'fulfilled' && universeResult.value ? universeResult.value : marketUniverse;
    const nextMarketRankings = rankingResult.status === 'fulfilled' && rankingResult.value ? {
      ...rankingResult.value,
      items: normalizeRankingItems(rankingResult.value.items || []),
    } : marketRankings;

    setStocks(nextStocks);
    setPortfolio(nextPortfolio);
    setTransactions(nextTransactions);
    setMarketUniverse(nextMarketUniverse);
    setMarketRankings(nextMarketRankings);
    setLastUpdated(now);
    setMarketError(errors.length ? errors.join(' / ') : null);

    const topBuy = nextStocks.find((stock) => ['DAYTRADE_ENTRY_OK', 'BUY_LIMIT_OK', 'BUY_ON_PULLBACK'].includes(stock.decision))
      || nextStocks[0];
    const nextSelectedTicker = selectedTicker || topBuy?.ticker || '4980.T';
    if (nextSelectedTicker !== selectedTicker) {
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
      marketRankings: nextMarketRankings,
      selectedTicker: nextSelectedTicker,
    });

    if (!background) setBusy?.('');
    return { stocks: nextStocks, portfolio: nextPortfolio, transactions: nextTransactions, marketUniverse: nextMarketUniverse, marketRankings: nextMarketRankings, errors };
  }, [addLog, ensureStocks, marketRankings, marketUniverse, portfolio, rankingKind, selectedTicker, setBusy, setSelectedTicker, setStatus, stocks, transactions, writeMarketCache]);

  const loadDetail = useCallback(async (ticker) => {
    if (!ticker) return null;
    setBusy?.('detail');
    try {
      const data = await api(`/stock/${encodeURIComponent(ticker)}`);
      let nextAdvancedReport = data.advancedReport || null;
      let advancedError = null;
      if (!nextAdvancedReport) {
        try {
          nextAdvancedReport = await api(`/analysis/advanced/${encodeURIComponent(ticker)}`, { timeout: 12000 });
        } catch (error) {
          advancedError = error;
        }
      }
      setDetail(data);
      setAdvancedReport(nextAdvancedReport);
      setLastUpdated(new Date());
      setStatus?.({ tone: nextAdvancedReport ? 'good' : 'warn', text: nextAdvancedReport ? `高度分析 ${ticker}` : `分析更新 ${ticker}` });
      if (advancedError) addLog?.('SYS', `${ticker} の高度分析は未取得: ${advancedError.message || 'unknown error'}`);
      writeMarketCache({ selectedTicker: ticker, detail: data, advancedReport: nextAdvancedReport });
      return data;
    } catch (error) {
      setMarketError(error.message);
      addLog?.('SYS', `${ticker} の詳細取得をスキップ: ${error.message}`);
      setStatus?.({ tone: 'warn', text: '詳細データ不足' });
      return null;
    } finally {
      setBusy?.('');
    }
  }, [addLog, setBusy, setStatus, writeMarketCache]);

  const loadMarketRankings = useCallback(async (kind = rankingKind) => {
    setRankingKind?.(kind);
    setBusy?.('market');
    try {
      const result = await api(`/market/rankings?kind=${kind}&limit=30`, { timeout: 30000 });
      const nextRankings = { ...result, items: normalizeRankingItems(result.items || []) };
      setMarketRankings(nextRankings);
      setLastUpdated(new Date());
      writeMarketCache({ rankingKind: kind, marketRankings: nextRankings });
      return nextRankings;
    } catch (error) {
      setMarketError(error.message);
      addLog?.('Market', `ランキング更新に失敗しました: ${error.message}`);
      setStatus?.({ tone: 'warn', text: 'ランキング取得失敗' });
      return null;
    } finally {
      setBusy?.('');
    }
  }, [addLog, rankingKind, setBusy, setRankingKind, setStatus, writeMarketCache]);

  const searchMarket = useCallback(async (query) => {
    setBusy?.('market-search');
    try {
      const result = await api(`/market/search?q=${encodeURIComponent(query)}&limit=60`, { timeout: 12000 });
      setMarketSearch(result);
      setLastUpdated(new Date());
      addLog?.('Market', `${result.count}件の東証銘柄を検索しました。`);
      writeMarketCache({ searchQuery: query, marketSearch: result });
      return result;
    } catch (error) {
      setMarketError(error.message);
      addLog?.('Market', `銘柄検索に失敗しました: ${error.message}`);
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
    marketUniverse,
    setMarketUniverse,
    marketRankings,
    setMarketRankings,
    marketSearch,
    setMarketSearch,
    marketFreshness,
    hydrateMarketData,
    loadDetail,
    loadMarketRankings,
    searchMarket,
  };
}
