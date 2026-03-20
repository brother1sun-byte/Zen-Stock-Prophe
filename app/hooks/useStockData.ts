import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { PredictionResponse, ChartDataPoint } from '../types';
import { safeFetchJson } from '../lib/safeFetchJson';

export function useStockData(initialTicker: string = '7203') {
    const [ticker, setTicker] = useState(initialTicker);
    const [inputTicker, setInputTicker] = useState(initialTicker);
    const [period, setPeriod] = useState('1d');
    const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [chartLoading, setChartLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorDetails, setErrorDetails] = useState<{ msg: string, lastValid: string, nextAction: string } | null>(null);
    const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
    const [mounted, setMounted] = useState(false);
    const [lastRefreshed, setLastRefreshed] = useState<string>('');
    const [marketPhase, setMarketPhase] = useState<{ label?: string, detail?: string, is_open: boolean, risk?: string } | null>(null);
    const lastSyncRef = useRef('');
    const [maxLossInput, setMaxLossInput] = useState<number>(5000);
    const [isLiveMode, setIsLiveMode] = useState<boolean>(true);
    const [modalContent, setModalContent] = useState<{ isOpen: boolean, title: string, message: string, action?: () => void, actionLabel?: string }>({ isOpen: false, title: '', message: '' });
    const [hotPicks, setHotPicks] = useState<any[]>([]);
    const [isLoadingPicks, setIsLoadingPicks] = useState(false);
    const [dataStatus, setDataStatus] = useState<'fresh' | 'stale' | 'missing'>('missing');

    useEffect(() => {
        setMounted(true);
    }, []);

    // 重複フェッチ防止：fetchDataをuseCallbackで安定化
    const fetchData = useCallback(async (isAuto = false, periodOverride?: string) => {
        if (!isAuto) {
            if (periodOverride) setChartLoading(true);
            else setLoading(true);
        }
        const targetPeriod = periodOverride || period;
        try {
            const result = await safeFetchJson<PredictionResponse>('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker, period: targetPeriod, capital: 500000 })
            });

            if (!result.ok) {
                throw new Error(result.error?.message || "Failed to fetch prediction");
            }

            const pred = result.data!;
            setPrediction(pred);
            if (pred.chart_data) setChartData(pred.chart_data);
            if (pred.technical_analysis?.market_phase) {
                setMarketPhase(pred.technical_analysis.market_phase);
            }
            const nowStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            lastSyncRef.current = nowStr;
            setLastRefreshed(nowStr);
            setDataStatus('fresh');
            setErrorDetails(null);
            setError(null);
        } catch (err: unknown) {
            console.error('[frontend-recovery] Caught Error:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);

            setErrorDetails({
                msg: "System Critical Alert",
                lastValid: lastSyncRef.current,
                nextAction: errorMessage
            });
            setError("データ取得に失敗しました。");
            setDataStatus('missing');
        } finally {
            if (!isAuto) {
                setLoading(false);
                setChartLoading(false);
            }
        }
    }, [ticker, period]);

    const fetchHotPicks = useCallback(async () => {
        setIsLoadingPicks(true);
        try {
            const result = await safeFetchJson<any>('/api/hot-picks');
            if (result.ok && result.data?.status === 'success') {
                setHotPicks(result.data.picks);
            } else {
                console.error(`[Hot Picks Error] Status: ${result.status}, Error: ${result.error?.message}`);
            }
        } catch (err) {
            console.error('[Hot Picks Error] Fetch Failure', err);
        } finally {
            setIsLoadingPicks(false);
        }
    }, []);

    // 重複フェッチ防止：mountedがtrueの時のみ初回フェッチ＋polling
    useEffect(() => {
        if (!mounted) return;
        fetchData();
        fetchHotPicks();
        const interval = setInterval(() => fetchData(true), 10000);
        return () => clearInterval(interval);
    }, [fetchData, fetchHotPicks, mounted]);

    const handleSearch = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const val = inputTicker.trim().toUpperCase();
        if (val) {
            setTicker(val);
            setPrediction(null);
        }
    }, [inputTicker]);

    // 再レンダ防止：actionsをuseMemoで参照安定化
    const actions = useMemo(() => ({
        refresh: fetchData,
        refreshHotPicks: fetchHotPicks,
        search: handleSearch,
        setTicker,
        setInputTicker,
        setPeriod,
        setMaxLossInput,
        setIsLiveMode,
        setModalContent,
        setError
    }), [fetchData, fetchHotPicks, handleSearch]);

    // 再レンダ防止：dataをuseMemoで参照安定化
    const data = useMemo(() => ({
        prediction,
        chartData,
        hotPicks,
        marketPhase
    }), [prediction, chartData, hotPicks, marketPhase]);

    // status計算（useMemo）
    const status = useMemo<'ok' | 'degraded' | 'failed'>(() => {
        if (error) return 'failed';
        if (dataStatus === 'stale') return 'degraded';
        return 'ok';
    }, [error, dataStatus]);

    return {
        // Data
        data,

        // Status
        status,
        dataStatus,
        loading,
        chartLoading,
        isLoadingPicks,
        error,
        errorDetails,

        // State
        ticker,
        inputTicker,
        period,
        lastRefreshed,
        maxLossInput,
        isLiveMode,
        modalContent,

        // Actions
        actions
    };
}
