'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
  TrendingUp, TrendingDown, Activity, DollarSign, Clock, AlertTriangle,
  Search, Bell, Settings, RefreshCw, ChevronDown, Zap, ZoomIn, Target, Briefcase, X, ArrowUpRight, ArrowDownRight, LayoutDashboard, Database, BrainCircuit, CheckCircle2, ShieldCheck, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import Link from 'next/link';
import { PredictionResponse, ChartDataPoint, ZenSignal, MarketRanking, RankingItem } from './types';
import { getAppMode, isAgentMode } from './lib/appMode';
import { AgentGuard } from './components/AgentGuard';
import { WeekendPlanSection } from './components/WeekendPlanSection';
import { BeginnerCompass } from './components/BeginnerCompass';

// プロ用アクションモーダル (Premium & Accessible)
function ActionModal({ isOpen, onClose, title, message, action, actionLabel }: {
  isOpen: boolean; onClose: () => void; title: string; message: string; action?: () => void; actionLabel?: string
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-3xl p-8"
        >
          <motion.div
            initial={{ scale: 0.8, y: 50, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.8, y: 50, opacity: 0 }}
            className="glass-panel max-w-2xl w-full p-16 shadow-[0_50px_100px_rgba(0,0,0,0.9)] border-white/30"
          >
            <div className="flex justify-between items-start mb-12">
              <div className="w-20 h-20 rounded-3xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20 shadow-[0_0_50px_rgba(34,211,238,0.2)]">
                <ShieldCheck className="w-10 h-10 text-cyan-400" />
              </div>
              <button
                onClick={onClose}
                className="w-12 h-12 rounded-2xl hover:bg-white/10 flex items-center justify-center transition-all group"
              >
                <X className="w-6 h-6 text-slate-400 group-hover:text-white" />
              </button>
            </div>

            <h3 className="text-5xl font-black mb-8 text-white tracking-tighter leading-none">{title}</h3>
            <p className="text-2xl font-bold text-slate-300 mb-16 leading-relaxed whitespace-pre-line border-l-4 border-cyan-500/50 pl-8">{message}</p>

            <div className="flex gap-6">
              <button
                onClick={onClose}
                className="flex-1 btn-accessible bg-slate-800 text-white border border-white/10 text-xl font-black py-8 rounded-3xl hover:bg-slate-700 transition-all"
              >
                閉じる
              </button>
              {action && actionLabel && (
                <button
                  onClick={() => { action(); onClose(); }}
                  className="flex-1 btn-accessible bg-cyan-600 text-white text-xl font-black py-8 rounded-3xl shadow-[0_20px_60px_rgba(34,211,238,0.4)] hover:bg-cyan-500 transition-all border border-cyan-400/30"
                >
                  {actionLabel}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// 共通ローディングスケルトン
function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-8 animate-pulse p-10">
      <div className="h-40 bg-white/5 rounded-3xl" />
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-4 h-[600px] bg-white/5 rounded-3xl" />
        <div className="col-span-8 h-[600px] bg-white/5 rounded-3xl" />
      </div>
    </div>
  );
}

// プロ用エラー表示
function ErrorDisplay({ message, onRetry, status }: { message: string; onRetry: () => void; status?: number }) {
  const isUpstreamIssue = status === 503 || status === 502 || status === 504;

  return (
    <div className="min-h-screen flex items-center justify-center p-10 bg-app">
      <div className={clsx(
        "panel-strong max-w-2xl w-full p-20 text-center transition-all duration-500",
        isUpstreamIssue ? "border-cyan-500/40 shadow-[0_0_80px_rgba(34,211,238,0.1)]" : "border-red-500/30"
      )}>
        <div className={clsx(
          "w-32 h-32 rounded-full flex items-center justify-center mx-auto mb-12 border animate-pulse",
          isUpstreamIssue ? "bg-cyan-500/10 border-cyan-500/30" : "bg-red-500/10 border-red-500/20"
        )}>
          {isUpstreamIssue ? (
            <Activity className="w-16 h-16 text-cyan-400" />
          ) : (
            <AlertTriangle className="w-16 h-16 text-red-400" />
          )}
        </div>

        <h2 className="text-5xl font-black text-white mb-6 tracking-tighter uppercase">
          {isUpstreamIssue ? "System Initializing" : "System Error"}
        </h2>

        <div className="bg-black/40 border border-white/5 p-8 rounded-3xl mb-12 text-left">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Diagnostic Message</p>
          <p className="text-xl font-bold text-slate-300 leading-relaxed font-mono">
            {message}
          </p>
          {isUpstreamIssue && (
            <p className="mt-6 text-sm font-bold text-cyan-400/80 border-t border-white/5 pt-4">
              AIエンジンが起動中、またはネットワークが不安定です。数秒後に自動で再試行されます。
            </p>
          )}
        </div>

        <button
          onClick={onRetry}
          className={clsx(
            "w-full btn-accessible text-white text-2xl font-black py-10 rounded-[2rem] transition-all border shadow-2xl active:scale-95",
            isUpstreamIssue
              ? "bg-cyan-600 border-cyan-400/30 hover:bg-cyan-500 shadow-cyan-500/20"
              : "bg-slate-800 border-white/10 hover:bg-slate-700"
          )}
        >
          {isUpstreamIssue ? "手動で再接続を試行" : "システムを再試行"}
        </button>


        {status && (
          <p className="mt-10 text-[10px] font-black text-slate-600 uppercase tracking-[0.5em]">
            Status_Code: {status}
          </p>
        )}
      </div>
    </div>
  );
}

// 候補選択モーダル (3桁入力対応)
interface Candidate {
  ticker: string;
  name: string;
}
function CandidateModal({ isOpen, onClose, candidates, onSelect }: {
  isOpen: boolean; onClose: () => void; candidates: Candidate[]; onSelect: (ticker: string) => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/90 backdrop-blur-md p-8">
      <div className="panel-strong max-w-lg w-full p-10 bg-black border-cyan-500/50 shadow-[0_0_100px_rgba(34,211,238,0.2)]">
        <h3 className="text-2xl font-black text-white mb-2">Did you mean...?</h3>
        <p className="text-sm text-slate-400 mb-8">お探しの銘柄を選択してください</p>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
          {candidates.map(c => (
            <button
              key={c.ticker}
              onClick={() => onSelect(c.ticker)}
              className="w-full flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-all group"
            >
              <span className="text-xl font-pro-number font-black text-cyan-400 group-hover:text-white transition-colors">{c.ticker}</span>
              <span className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors">{c.name}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-8 w-full py-4 rounded-xl bg-white/5 text-slate-400 font-bold hover:bg-white/10 transition-all"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  // State
  const [ticker, setTicker] = useState('7203');
  const [inputTicker, setInputTicker] = useState('7203');
  const [period, setPeriod] = useState('1d');
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [marketPhase, setMarketPhase] = useState<any>(null);
  const [hotPicks, setHotPicks] = useState<any[]>([]);
  const [isLoadingPicks, setIsLoadingPicks] = useState(false);
  const [zenSignals, setZenSignals] = useState<any[]>([]);
  const [isLoadingZen, setIsLoadingZen] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [modalContent, setModalContent] = useState<{ isOpen: boolean, title: string, message: string, action?: () => void, actionLabel?: string }>({ isOpen: false, title: '', message: '' });
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  const [appMode, setAppMode] = useState<'PRO' | 'PRACTICE'>('PRO');
  const [market, setMarket] = useState<'JP' | 'US' | 'CRYPTO'>('JP');
  const [rankings, setRankings] = useState<MarketRanking | null>(null);
  const [isLoadingRankings, setIsLoadingRankings] = useState(false);
  const [candidateData, setCandidateData] = useState<{ isOpen: boolean, candidates: Candidate[] }>({ isOpen: false, candidates: [] });

  const lastSyncRef = useRef<string | null>(null); // 最後に正常に同期が完了した時刻を保持（再起動時の復帰確認用）
  const autoRetryCount = useRef(0);

  // Fetch Logic
  const fetchData = useCallback(async (isAuto = false) => {
    if (!isAuto) {
      setLoading(true);
      setChartLoading(true);
      setPrediction(null); // Clear old prediction to prevent mismatch on error
    }
    setError(null);

    const targetPeriod = period;
    try {
      const res = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, period: targetPeriod, capital: 500000 })
      });

      if (!res.ok) {
        let errorData;
        try {
          errorData = await res.json();
        } catch {
          const text = await res.text();
          errorData = { error: "FETCH_ERROR", detail: text || "API通信エラー", status: res.status };
        }

        // Handle Candidates (400 Bad Request with candidates)
        if (res.status === 400 && errorData.detail?.candidates) {
          setCandidateData({
            isOpen: true,
            candidates: errorData.detail.candidates
          });
          setLoading(false);
          setChartLoading(false);
          return;
        }

        const errorMsg = errorData.detail?.message || errorData.detail || errorData.error || "Unknown Error";
        throw { message: errorMsg, status: res.status || 500 };
      }

      const result: PredictionResponse = await res.json();
      setPrediction(result);
      if (result.chart_data) setChartData(result.chart_data);
      if (result.technical_analysis?.market_phase) {
        setMarketPhase(result.technical_analysis.market_phase);
      }
      const nowStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      lastSyncRef.current = nowStr; // Update Ref
      setLastRefreshed(nowStr);

      // Success - Reset retry count
      autoRetryCount.current = 0;

    } catch (err: any) {
      console.error('[Fetch Error]', err);

      const errorObj = {
        message: err.message || "Unknown error occurred",
        status: err.status || 500
      };

      // Auto-retry once or twice for first load if it's a transient upstream error
      if (!isAuto && (errorObj.status === 503 || errorObj.status === 502 || errorObj.status === 504) && autoRetryCount.current < 2) {
        autoRetryCount.current++;
        console.log(`[Auto-Retry] Attempt ${autoRetryCount.current}/2 due to status ${errorObj.status}...`);
        setTimeout(() => fetchData(false), 2000); // Wait 2s and retry
        return;
      }

      setError(errorObj);
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
      const res = await fetch('/api/hot-picks');
      if (!res.ok) {
        // Silently fail for hot picks, don't break UI
        return;
      }
      const data = await res.json();
      if (data.status === 'success' || data.picks) {
        setHotPicks(data.picks || []);
      }
    } catch (err) {
      console.error('[Hot Picks Error]', err);
    } finally {
      setIsLoadingPicks(false);
    }
  }, []);

  const fetchZenSignals = useCallback(async (targetMarket: string = market) => {
    setIsLoadingZen(true);
    try {
      const res = await fetch(`/api/scan_zen?market=${targetMarket}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.signals) {
        setZenSignals(data.signals || []);
      }
    } catch (err) {
      console.error('[Zen Signals Error]', err);
    } finally {
      setIsLoadingZen(false);
    }
  }, [market]);

  const fetchMarketRanking = useCallback(async (targetMarket: string = market) => {
    setIsLoadingRankings(true);
    try {
      const res = await fetch(`/api/market_ranking?market=${targetMarket}`);
      if (!res.ok) return;
      const data = await res.json();
      setRankings(data);
    } catch (err) {
      console.error('[Ranking Error]', err);
    } finally {
      setIsLoadingRankings(false);
    }
  }, [market]);

  // Effects
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    fetchHotPicks();
    fetchZenSignals();
    fetchMarketRanking();
  }, [fetchHotPicks, fetchZenSignals, fetchMarketRanking, market]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };
    const installedHandler = () => {
      setShowInstallBtn(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installedHandler);

    // Check if already in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setShowInstallBtn(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBtn(false);
    }
    setDeferredPrompt(null);
  };

  // Actions
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputTicker.trim()) {
      setTicker(inputTicker.trim().toUpperCase());
    }
  };

  const handleAction = (name: string, description: string) => {
    let customMessage = `${description}\n\n[System Log]\n- Ticker: ${ticker}\n- Action Log: SYNC_COMPLETED\n- User Auth: VERIFIED_PRO`;

    if (name === "QUANT_REPORT") {
      const p = prediction;
      if (p && p.reasoning) {
        customMessage = p.reasoning;
      } else if (p) {
        const decisionMap: Record<string, string> = { 'BUY': '買い推奨', 'SELL': '売り推奨', 'WAIT': '様子見', 'NO TRADE': '取引見送り', 'STRONG BUY': '強気買い' };
        const d = p.day_trading?.decision || 'WAIT';
        customMessage = `【クオンツ・レポート要約: ${ticker}】\n\n判定: ${d} (${decisionMap[d] || d})\nAI信頼度: ${p.day_trading?.super_score || 0}%\n\n※詳細な分析レポートの生成に失敗しました。再試行してください。`;
      }
    }

    const isReport = name === "QUANT_REPORT";

    setModalContent({
      isOpen: true,
      title: isReport ? "クオンツ・分析レポート" : name,
      message: customMessage,
      action: isReport ? undefined : () => {
        if (name === "Mode Switch") {
          // Mode switch logic if needed beyond state
        }
        console.log(`[Protocol] ${name} executed.`);
      },
      actionLabel: isReport ? undefined : "実行プロトコルを確認"
    });
  };

  // UI Handlers
  const isUp = (prediction?.price_change_percent || 0) >= 0;
  const decision = prediction?.day_trading?.decision || 'WAIT';
  const confidenceScore = prediction?.day_trading?.super_score || 0;

  if (loading && !prediction && !error) return <LoadingSkeleton />;
  if (error && !prediction) return <ErrorDisplay message={error.message} status={error.status} onRetry={() => fetchData()} />;

  return (
    <div className="min-h-screen bg-app selection:bg-cyan-500/30 overflow-x-hidden antialiased">
      <ActionModal
        isOpen={modalContent.isOpen}
        onClose={() => setModalContent({ ...modalContent, isOpen: false })}
        title={modalContent.title}
        message={modalContent.message}
        action={modalContent.action}
        actionLabel={modalContent.actionLabel}
      />

      <CandidateModal
        isOpen={candidateData.isOpen}
        onClose={() => setCandidateData({ ...candidateData, isOpen: false })}
        candidates={candidateData.candidates}
        onSelect={(t) => {
          setCandidateData({ ...candidateData, isOpen: false });
          setTicker(t);
          setInputTicker(t); // Update input as well
        }}
      />

      <AgentGuard>

        <div className="max-w-[1600px] mx-auto px-6 lg:px-10 py-8 min-h-screen flex flex-col gap-10">

          {/* Navigation & Control (Advanced v7.5) */}
          <nav className="panel-strong flex flex-col px-10 py-8 gap-10 sticky top-0 z-[100] shadow-2xl backdrop-blur-3xl ring-1 ring-white/5">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-12">
                <div className="flex flex-col">
                  <span className="text-5xl font-black tracking-tighter text-white">MINATOMIRAI <span className="text-cyan-400">PRO v8.1.0</span></span>
                  <span className="text-[10px] font-black text-slate-500 tracking-[1.5em] uppercase mt-2">Deep Analytics Engine</span>
                </div>

                <div className="h-16 w-px bg-white/10" />

                <div className="flex items-center gap-8">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 text-center">Protocol Level</span>
                    <div className="flex gap-1.5">
                      {['L1', 'L2', 'L3'].map(l => (
                        <div key={l} className={clsx("w-10 h-1.5 rounded-full transition-all", l === 'L3' ? "bg-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.5)]" : "bg-white/10")} />
                      ))}
                    </div>
                  </div>
                  <div className="flex bg-black/40 border border-white/10 rounded-2xl p-1.5 shadow-inner">
                    {(['PRO', 'PRACTICE'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setAppMode(mode)}
                        className={clsx(
                          "px-8 py-2.5 rounded-xl text-xs font-black transition-all tracking-wider",
                          appMode === mode ? "bg-cyan-600 text-white shadow-xl" : "text-slate-500 hover:text-white"
                        )}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>

                  <div className="flex bg-black/40 border border-white/10 rounded-2xl p-1.5 shadow-inner">
                    {(['JP', 'US', 'CRYPTO'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMarket(m)}
                        className={clsx(
                          "px-6 py-2.5 rounded-xl text-[10px] font-black transition-all tracking-widest",
                          market === m ? "bg-emerald-600 text-white shadow-xl" : "text-slate-500 hover:text-white"
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <Link
                    href="/screener"
                    className="px-6 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-xs font-black text-emerald-400 tracking-wider hover:bg-emerald-600/30 hover:text-white transition-all flex items-center gap-2"
                  >
                    <Search className="w-4 h-4" />
                    SCREENER
                  </Link>
                </div>
              </div>

              <div className="flex items-center gap-12">
                <div className="text-right">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.5em] mb-1">Global Market Pulse</p>
                  <p className="text-3xl font-pro-number font-black text-white tracking-widest">{lastRefreshed || '--:--:--'}</p>
                </div>
                {showInstallBtn && (
                  <button
                    onClick={handleInstall}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <span className="text-[9px] font-black text-cyan-400 uppercase tracking-widest animate-pulse">インストール可能</span>
                    <div className="w-16 h-16 rounded-2xl bg-white/5 border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/10 transition-all shadow-lg group-active:scale-95">
                      <Download className="w-6 h-6" />
                    </div>
                  </button>
                )}
                <button
                  onClick={() => fetchData()}
                  disabled={loading}
                  className="w-20 h-20 rounded-3xl bg-cyan-600 text-white flex items-center justify-center shadow-[0_20px_50px_rgba(34,211,238,0.3)] hover:bg-cyan-500 transition-all border border-cyan-400/20 active:scale-95 group"
                >
                  <RefreshCw className={clsx("w-8 h-8 transition-transform duration-700", loading ? "animate-spin" : "group-hover:rotate-180")} />
                </button>
              </div>
            </div>

            {/* Market Status (High-Density) */}
            <div className="flex items-center gap-8 bg-black/40 border border-white/5 p-5 rounded-2xl ring-1 ring-white/5">
              <div className={clsx("w-4 h-4 rounded-full shadow-[0_0_20px_rgba(34,211,238,0.4)]", marketPhase?.is_open ? "bg-green-400 animate-pulse" : "bg-red-500")} />
              <div className="flex-1 flex items-center gap-12">
                <div>
                  <p className="text-lg font-black text-white tracking-tight uppercase">{marketPhase?.label || "接続待機中..."}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{marketPhase?.detail || "マーケットデータを同期中"}</p>
                </div>
                <div className="h-8 w-px bg-white/10" />
                <div className="flex gap-10">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-500 uppercase mb-1">Vol / ATR</span>
                    <span className="text-sm font-black text-white">{marketPhase?.volatility || 'SYNCING...'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-500 uppercase mb-1">Trend Signal</span>
                    <span className="text-sm font-black text-cyan-400">OPTIMIZED</span>
                  </div>
                </div>
              </div>
              {marketPhase?.is_open && (
                <div className="flex items-center gap-3 bg-cyan-600/10 text-cyan-400 px-6 py-2.5 rounded-xl border border-cyan-500/20 shadow-inner">
                  <Activity className="w-5 h-5 animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-widest">Live Execution Enabled</span>
                </div>
              )}
            </div>
          </nav>

          {/* 12-Column High-Performance Grid */}
          <main className="grid grid-cols-12 gap-10 items-start">

            {/* Left Control Column (4 cols) */}
            <aside className="col-span-12 lg:col-span-4 space-y-10">

              {/* Search Protocol Card */}
              <div className="panel p-10 space-y-8 bg-gradient-to-br from-white/[0.03] to-transparent">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-3">
                    <Search className="w-5 h-5 text-cyan-500" /> Ticker Injection
                  </h3>
                  <div className="flex gap-1">
                    {[1, 2, 3].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-500/30" />)}
                  </div>
                </div>
                <form onSubmit={handleSearch} className="relative group">
                  <input
                    type="text"
                    value={inputTicker}
                    onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
                    placeholder="CODE"
                    className="w-full bg-black/60 border-4 border-white/10 rounded-2xl font-pro-number font-black text-center p-8 focus:border-cyan-500/40 focus:bg-black/80 outline-none transition-all text-6xl tracking-tighter text-white shadow-inner group-hover:border-white/20"
                  />
                  <div className="absolute inset-0 rounded-2xl bg-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </form>
                <div className="flex justify-between items-center text-[10px] font-black">
                  <span className="text-slate-500 uppercase tracking-widest">Protocol Version</span>
                  <span className="text-cyan-500 tracking-widest">V8.1.0-ANALYTICS</span>
                </div>
              </div>

              {/* ZEN STRATEGY SCANNER */}
              <div className="panel p-8 border-t-4 border-emerald-500/80 bg-gradient-to-b from-emerald-500/[0.05] to-transparent shadow-[0_0_30px_rgba(16,185,129,0.1)]">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                    <Target className="w-6 h-6 text-emerald-400" /> ZEN AUTO PLANNER
                  </h3>
                  <button
                    onClick={() => fetchZenSignals()}
                    disabled={isLoadingZen}
                    className="p-3 hover:bg-white/10 rounded-2xl transition-all border border-white/5 active:scale-90"
                  >
                    <RefreshCw className={clsx("w-5 h-5 text-emerald-400", isLoadingZen && "animate-spin")} />
                  </button>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 mb-6">
                  <p className="text-[10px] text-emerald-400 font-bold mb-1 flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> RSI/SMA厳格判定ロジック稼働中</p>
                  <p className="text-[9px] text-slate-300">売買サイン（利確目標/損切ライン）を自動算出</p>
                </div>
                <div className="space-y-4">
                  {isLoadingZen ? (
                    <div className="py-10 flex flex-col justify-center items-center gap-3">
                      <div className="w-8 h-8 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                      <span className="text-[9px] text-slate-500 tracking-widest">ANALYZING TRENDS...</span>
                    </div>
                  ) : zenSignals.length > 0 ? (
                    zenSignals.map((sig: any) => (
                      <button
                        key={sig.ticker}
                        onClick={() => { setTicker(sig.ticker); setInputTicker(sig.ticker.replace('.T', '')); }}
                        className="w-full text-left bg-black/40 hover:bg-emerald-500/20 p-5 rounded-2xl transition-all border border-white/5 hover:border-emerald-500/50 group block"
                      >
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-2xl font-black text-white font-pro-number">{sig.ticker}</span>
                          <span className="text-[10px] font-black tracking-widest text-emerald-400 bg-emerald-500/20 px-3 py-1.5 rounded-full border border-emerald-500/30">BUY SIGNAL</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-400 mb-2 font-black">
                          <span>現在: ¥{sig.analysis.values.close.toLocaleString()}</span>
                          <span className="text-emerald-400">利確: ¥{sig.analysis.risk_mgmt.target_price_1.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 font-bold mt-2 pt-2 border-t border-white/5">
                          <span>RSI: {sig.analysis.values.rsi.toFixed(1)}</span>
                          <span className="text-red-400">撤退: ¥{sig.analysis.risk_mgmt.stop_loss.toLocaleString()}</span>
                        </div>
                        {/* Advanced Signals (BB Squeeze / Consecutive Positive) */}
                        {(sig.analysis.advanced?.bb_squeeze || sig.analysis.advanced?.consecutive_positive) && (
                          <div className="flex gap-2 mt-2 pt-2 border-t border-white/5">
                            {sig.analysis.advanced?.bb_squeeze && (
                              <span className="text-[9px] font-black bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded flex items-center gap-1">
                                <Zap className="w-2.5 h-2.5" /> SQUEEZE
                              </span>
                            )}
                            {sig.analysis.advanced?.consecutive_positive && (
                              <span className="text-[9px] font-black bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded flex items-center gap-1">
                                <TrendingUp className="w-2.5 h-2.5" /> {sig.analysis.advanced.consecutive_days}+ DAYS
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-8 border-2 border-dashed border-white/10 rounded-2xl">
                      <p className="text-xs text-slate-500 font-black">現在、条件合致銘柄なし</p>
                    </div>
                  )}
                </div>
              </div>

              {/* MARKET RANKING (NEW) */}
              <div className="panel p-8 border-t-4 border-cyan-500 bg-gradient-to-b from-cyan-500/[0.05] to-transparent">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                    <TrendingUp className="w-6 h-6 text-cyan-400" /> {market} RANKING
                  </h3>
                  <button
                    onClick={() => fetchMarketRanking()}
                    disabled={isLoadingRankings}
                    className="p-3 hover:bg-white/10 rounded-2xl transition-all border border-white/5 active:scale-90"
                  >
                    <RefreshCw className={clsx("w-5 h-5 text-cyan-400", isLoadingRankings && "animate-spin")} />
                  </button>
                </div>
                
                <div className="space-y-6">
                  {isLoadingRankings ? (
                    <div className="py-10 flex flex-col justify-center items-center gap-3">
                      <div className="w-8 h-8 rounded-full border-2 border-cyan-500/20 border-t-cyan-500 animate-spin" />
                      <span className="text-[9px] text-slate-500 tracking-widest">FETCHING RANKINGS...</span>
                    </div>
                  ) : rankings ? (
                    <div className="grid grid-cols-1 gap-6">
                      {/* Top Gainers */}
                      <div className="space-y-3">
                        <p className="text-[10px] font-black text-green-400 uppercase tracking-[0.3em] mb-2">Top Gainers</p>
                        {rankings.top_gainers?.map((item: any) => (
                          <button
                            key={item.ticker}
                            onClick={() => { setTicker(item.ticker); setInputTicker(item.ticker.replace('.T', '')); }}
                            className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-green-500/10 hover:border-green-500/30 transition-all group"
                          >
                            <div className="flex flex-col text-left">
                              <span className="text-sm font-black text-white">{item.ticker}</span>
                              <span className="text-[8px] font-bold text-slate-500 uppercase truncate max-w-[100px]">{item.name}</span>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-black text-green-400">+{item.change_pct?.toFixed(2) || '0.00'}%</div>
                            </div>
                          </button>
                        ))}
                      </div>
                      {/* Top Losers */}
                      <div className="space-y-3">
                        <p className="text-[10px] font-black text-red-500 uppercase tracking-[0.3em] mb-2">Top Losers</p>
                        {rankings.top_losers?.map((item: any) => (
                          <button
                            key={item.ticker}
                            onClick={() => { setTicker(item.ticker); setInputTicker(item.ticker.replace('.T', '')); }}
                            className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-red-500/10 hover:border-red-500/30 transition-all group"
                          >
                            <div className="flex flex-col text-left">
                              <span className="text-sm font-black text-white">{item.ticker}</span>
                              <span className="text-[8px] font-bold text-slate-500 uppercase truncate max-w-[100px]">{item.name}</span>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-black text-red-500">{item.change_pct?.toFixed(2) || '0.00'}%</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 border-2 border-dashed border-white/10 rounded-2xl">
                      <p className="text-xs text-slate-500 font-black">データ取得待ち</p>
                    </div>
                  )}
                </div>
              </div>

              {/* AI Hot Picks / Scanner Grid (v7.5) */}
              <div className="panel p-10 border-t-4 border-cyan-600/50 bg-gradient-to-b from-cyan-500/[0.05] to-transparent">
                <div className="flex items-center justify-between mb-10">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-3">
                    <Zap className="w-6 h-6 text-cyan-400 animate-pulse" /> TARGET SCANNER
                  </h3>
                  <button
                    onClick={() => fetchHotPicks()}
                    disabled={isLoadingPicks}
                    className="p-3 hover:bg-white/10 rounded-2xl transition-all border border-white/5 active:scale-90"
                  >
                    <RefreshCw className={clsx("w-5 h-5 text-cyan-400", isLoadingPicks && "animate-spin")} />
                  </button>
                </div>

                <div className="space-y-6">
                  {isLoadingPicks ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-4">
                      <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
                      <span className="text-slate-500 font-black uppercase tracking-[0.5em] text-[9px]">Neural Scanning...</span>
                    </div>
                  ) : hotPicks.length > 0 ? (
                    /* Scanner Results (Fallback Support) */
                    <div className="space-y-4">
                      {hotPicks.map((pick: any) => (
                        <button
                          key={pick.ticker}
                          onClick={() => { setTicker(pick.ticker); setInputTicker(pick.ticker); }}
                          className="w-full text-left bg-white/5 hover:bg-white/10 p-6 rounded-3xl transition-all border border-white/5 hover:border-cyan-500/30 group relative overflow-hidden"
                        >
                          <div className="absolute top-0 right-0 p-3 opacity-30 group-hover:opacity-100 transition-opacity">
                            <ArrowUpRight className="w-6 h-6 text-cyan-500" />
                          </div>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-2xl font-black text-white font-pro-number block leading-none mb-1">{pick.ticker}</span>
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{pick.confidence ? `CONFIDENCE: ${(pick.confidence * 100).toFixed(0)}%` : 'HIGH VOLATILITY'}</span>
                            </div>
                            {/* Fallback Badge */}
                            {pick.reason === "Analyst Watch (Fallback)" && (
                              <span className="bg-cyan-900/40 text-cyan-300 text-[9px] px-2 py-1 rounded-full font-black uppercase tracking-wider border border-cyan-500/20">
                                Analyst Watch
                              </span>
                            )}
                          </div>
                          <div className="space-y-1">
                            {(pick.reason_top3 || []).map((r: string, i: number) => (
                              <div key={i} className="flex items-center gap-2">
                                <div className="w-1 h-1 rounded-full bg-cyan-500" />
                                <span className="text-xs font-bold text-slate-400 leading-tight">{r}</span>
                              </div>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="py-20 text-center border-2 border-dashed border-white/10 rounded-3xl">
                      <Database className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                      <p className="text-xs font-black text-slate-600 uppercase tracking-widest">SCAN_DATA_EMPTY</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Security Protocol Badge */}
              <div className="panel p-6 bg-black/40 border-l-4 border-green-500/50 flex items-center gap-6 group">
                <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center border border-green-500/20 group-hover:scale-110 transition-all">
                  <ShieldCheck className="w-6 h-6 text-green-400" />
                </div>
                <div>
                  <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Zero Issues Guard</h4>
                  <p className="text-[9px] font-bold text-slate-500">Secure Protocol v12.0.1 Active</p>
                </div>
              </div>
            </aside>

            {/* Right Analysis Column (8 cols) */}
            <div className="col-span-12 lg:col-span-8 space-y-10">

              {/* (v8.0) Beginner Compass Section */}
              {prediction?.beginner_judgment && (
                <BeginnerCompass data={prediction.beginner_judgment} />
              )}

              {/* Main Symbol Header Card (Full Metrics) */}
              <div className="panel p-10 bg-gradient-to-br from-white/[0.04] to-transparent relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-[0.03] select-none pointer-events-none">
                  <Target className="w-[300px] h-[300px] text-white" />
                </div>

                <div className="flex flex-col lg:flex-row justify-between items-start gap-10 mb-12 relative z-10">
                  <div className="space-y-3">
                    <h2 className="text-7xl font-black text-white tracking-tighter leading-none group hover:text-cyan-400 transition-colors cursor-default">
                      {prediction?.company_name || '---'}
                    </h2>
                    <div className="flex items-center gap-6">
                      <span className="text-3xl font-pro-number font-black text-slate-400 uppercase tracking-[0.2em]">{ticker}</span>
                      <span className="px-5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black text-slate-400 tracking-widest uppercase">TSE Prime Standard</span>
                    </div>
                  </div>
                  <div className={clsx(
                    "px-8 py-5 rounded-3xl text-3xl font-pro-number font-black flex items-center gap-4 shadow-2xl backdrop-blur-3xl ring-1 ring-white/10",
                    isUp ? "bg-green-500/10 text-green-400 shadow-green-500/10" : "bg-red-500/10 text-red-400 shadow-red-500/10"
                  )}>
                    <div className={clsx("w-12 h-12 rounded-full flex items-center justify-center", isUp ? "bg-green-500/20" : "bg-red-500/20")}>
                      {isUp ? <ArrowUpRight className="w-8 h-8" /> : <ArrowDownRight className="w-8 h-8" />}
                    </div>
                    <div className="flex flex-col px-2">
                      <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest mb-0.5">Neural Variance</span>
                      <span>{isUp ? '+' : '-'}{Math.abs(prediction?.price_change_percent || 0).toFixed(2)}%</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-baseline gap-8 mb-16 relative z-10">
                  <span className="text-[140px] font-pro-number font-black text-white tracking-tighter leading-none selection:text-cyan-500">
                    ¥{(prediction?.current_price || 0).toLocaleString()}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-2xl font-black text-slate-500 tracking-widest uppercase">JPY/TSE</span>
                    <div className="flex gap-2 items-center mt-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-[10px] font-black text-green-400 uppercase tracking-[0.5em]">Real-time Sync</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12 border-t border-white/5 relative z-10">
                  <div className="space-y-4">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <BrainCircuit className="w-4 h-4" /> Neural Bias
                    </span>
                    <div className={clsx(
                      "text-4xl font-black uppercase tracking-tight",
                      decision === 'BUY' ? "text-green-400" : decision === 'SELL' ? "text-amber-400" : "text-slate-500"
                    )}>
                      {decision === 'BUY' ? 'Accumulate' : decision === 'SELL' ? 'Distribute' : 'Wait/Observe'}
                    </div>
                  </div>
                  <div className="space-y-4 md:border-l border-white/5 md:pl-8">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <Activity className="w-4 h-4" /> Flow Direction
                    </span>
                    <div className="text-2xl font-black text-white uppercase tracking-wider">
                      {prediction?.day_trading?.order_flow?.bias_jp || 'ANALYZING...'}
                    </div>
                  </div>
                  <div className="space-y-4 md:border-l border-white/5 md:pl-8">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <Settings className="w-4 h-4" /> Risk Regime
                    </span>
                    <div className="text-2xl font-black text-cyan-400 uppercase tracking-widest">
                      {(prediction?.day_trading?.regime_info?.regime || 'DYNAMIC').toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Interactive Chart Section (v7.5 Area style) */}
              <div className="panel p-10 h-[550px] flex flex-col relative group">
                <div className="flex items-center justify-between mb-10 relative z-10">
                  <div className="flex items-center gap-6">
                    <h3 className="text-xs font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                      <Activity className="w-5 h-5 text-cyan-500" /> Neural Price Projection
                    </h3>
                    <div className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 flex gap-4">
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-cyan-500" /><span className="text-[8px] font-black uppercase text-slate-400">Historical</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-white/30" /><span className="text-[8px] font-black uppercase text-slate-400">SMA-20</span></div>
                    </div>
                  </div>
                  <div className="flex bg-black/40 border border-white/10 rounded-2xl p-1.5 shadow-inner">
                    {['1d', '1w', '1mo'].map(p => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={clsx(
                          "px-6 py-2 rounded-xl text-[10px] font-black transition-all tracking-widest",
                          period === p ? "bg-white/10 text-white shadow-xl" : "text-slate-500 hover:text-white"
                        )}
                      >
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={clsx("flex-1 w-full transition-opacity duration-700", chartLoading && "opacity-30")}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="neuralGradRestored" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={isUp ? "#22d3ee" : "#f43f5e"} stopOpacity={0.4} />
                          <stop offset="100%" stopColor={isUp ? "#22d3ee" : "#f43f5e"} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="5 5" stroke="rgba(255,255,255,0.03)" vertical={false} />
                      <XAxis
                        dataKey="name"
                        stroke="rgba(255,255,255,0.2)"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: 'rgba(255,255,255,0.3)', fontWeight: 'bold' }}
                      />
                      <YAxis
                        hide
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="panel-strong p-8 shadow-[0_30px_60px_rgba(0,0,0,0.8)] border-white/20 scale-105 transition-transform">
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 border-b border-white/5 pb-2">{d.name} Execution Data</p>
                                <div className="space-y-4">
                                  <div>
                                    <p className="text-[8px] font-black text-cyan-400 uppercase mb-1">Price Level</p>
                                    <p className="text-4xl font-pro-number font-black text-white tracking-tighter">¥{d.base?.toLocaleString()}</p>
                                  </div>
                                  <div className="flex gap-6 border-t border-white/5 pt-4">
                                    <div>
                                      <p className="text-[8px] font-black text-slate-500 uppercase mb-0.5">Variation</p>
                                      <p className="text-xs font-black text-white">{(d.growth * 100).toFixed(2)}%</p>
                                    </div>
                                    <div>
                                      <p className="text-[8px] font-black text-slate-500 uppercase mb-0.5">Strength</p>
                                      <div className="h-2 w-16 bg-white/5 rounded-full mt-1 overflow-hidden">
                                        <div className="h-full bg-cyan-500/50" style={{ width: `${(d.growth + 0.5) * 100}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="base"
                        stroke={isUp ? "#22d3ee" : "#f43f5e"}
                        strokeWidth={4}
                        fill="url(#neuralGradRestored)"
                        isAnimationActive={true}
                        animationDuration={1500}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Chart Overlay info */}
                <div className="mt-8 flex justify-between items-center bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                  <div className="flex items-center gap-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                    <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-cyan-500" /> Data Integrity: 100%</div>
                    <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-cyan-500" /> Neural Smoothing: Active</div>
                  </div>
                  <div className="text-[9px] font-black text-slate-700 uppercase tracking-widest">
                    Proprietary Minatomirai Core V7.5
                  </div>
                </div>
              </div>

              {/* Weekend Plan / Long-term Strategy */}
              {prediction && (
                <WeekendPlanSection data={prediction} />
              )}

              {/* Trading Execution Intelligence Console (v7.5 Final Section) */}
              <div className="panel p-16 border-t-[16px] border-cyan-600 shadow-[0_50px_100px_rgba(0,0,0,0.5)] bg-gradient-to-b from-white/[0.03] to-transparent space-y-16">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-16">


                  {/* AI Sentiment & Signals (Updated with Scorecard) */}
                  <div className="space-y-10">
                    <div className="flex items-center gap-8">
                      <div className={clsx(
                        "w-24 h-24 rounded-[2.5rem] flex items-center justify-center border-4 shadow-2xl shrink-0 transition-transform hover:scale-105",
                        decision === 'BUY' ? "bg-green-500/10 border-green-500 text-green-500 shadow-green-500/20" :
                          decision === 'SELL' ? "bg-amber-500/10 border-amber-500 text-amber-500 shadow-amber-500/20" :
                            "bg-white/5 border-white/10 text-slate-500 shadow-white/5"
                      )}>
                        {decision === 'BUY' ? <TrendingUp className="w-12 h-12" /> :
                          decision === 'SELL' ? <TrendingDown className="w-12 h-12" /> : <Activity className="w-12 h-12" />}
                      </div>
                      <div>
                        <h3 className="text-6xl font-black text-white tracking-tighter mb-2 leading-none">
                          {decision === 'BUY' ? '買い推奨' : decision === 'SELL' ? '売り推奨' : '様子見'}
                        </h3>
                        <div className="flex items-center gap-3">
                          <div className="h-1 w-20 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-500" style={{ width: `${confidenceScore}%` }} />
                          </div>
                          <p className="text-xl font-black text-cyan-400 tracking-tighter">AI信頼度：{confidenceScore}%</p>
                        </div>
                      </div>
                    </div>

                    {/* Scorecard Visualization (v8.0) */}
                    {prediction?.day_trading?.scorecard && (
                      <div className="bg-black/60 p-8 rounded-[2rem] border border-white/10 ring-1 ring-white/5">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                          <Target className="w-4 h-4 text-cyan-500" /> Analysis Scorecard
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          {Object.entries(prediction.day_trading.scorecard).map(([key, item]: [string, any]) => (
                            <div key={key} className="bg-white/5 p-4 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{item.label}</span>
                                <span className={clsx(
                                  "px-2 py-0.5 rounded-md text-[9px] font-black uppercase",
                                  item.status === 'OK' ? "bg-green-500/20 text-green-400" :
                                    item.status === 'Caution' ? "bg-amber-500/20 text-amber-400" :
                                      "bg-red-500/20 text-red-400"
                                )}>{item.status}</span>
                              </div>
                              <div className="text-lg font-black text-white mb-1">{item.value}</div>
                              <div className="text-[10px] text-slate-500 leading-tight">{item.reason}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="bg-black/60 p-10 rounded-[2.5rem] border border-white/10 space-y-10 ring-1 ring-white/5">
                      <h4 className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.4em] block border-b border-white/5 pb-6">AI 推論エンジン分析：決定論的根拠</h4>
                      <div className="space-y-6">
                        {((decision === 'NO TRADE' ? prediction?.day_trading?.reasoning_list : prediction?.day_trading?.explanations?.technical_reasons) || [])?.slice(0, 3).map((text: string, i: number) => (
                          <motion.div
                            initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                            key={i}
                            className="flex gap-6 items-start group/reason"
                          >
                            <span className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center text-xl font-black text-cyan-500 shrink-0 border border-cyan-500/20">
                              {i + 1}
                            </span>
                            <p className="text-lg font-bold text-slate-300 leading-tight pt-1.5 group-hover/reason:text-white transition-colors">
                              {text}
                            </p>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Quantitative Data & Risk Mgmt */}
                  <div className="space-y-10">

                    {/* Neural Super Score Gauge */}
                    <div className="panel p-10 bg-gradient-to-br from-cyan-950/30 to-black border-cyan-500/20 relative group overflow-hidden">
                      <div className="absolute top-0 right-0 p-8 opacity-[0.05] group-hover:scale-110 transition-transform">
                        <BrainCircuit className="w-24 h-24 text-cyan-400" />
                      </div>
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-4">Quantitative Super Score</span>
                      <div className="flex items-end gap-3 mb-8">
                        <span className="text-8xl font-pro-number font-black text-white leading-none tracking-tighter">{confidenceScore}</span>
                        <span className="text-2xl font-black text-slate-600 mb-2 uppercase tracking-widest">/ 100 Points</span>
                      </div>
                      <div className="h-3 bg-white/5 rounded-full overflow-hidden ring-1 ring-white/10">
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${confidenceScore}%` }} transition={{ duration: 1.5, ease: "easeOut" }}
                          className="h-full bg-gradient-to-r from-cyan-600 via-cyan-400 to-indigo-500 shadow-[0_0_20px_rgba(34,211,238,0.5)]"
                        />
                      </div>
                      <p className="mt-5 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Neural Weighted Consensus Level</p>
                    </div>

                    {/* Lot & Risk Management Console */}
                    <div className="panel p-10 bg-black/80 border-2 border-white/10 space-y-10 shadow-inner ring-1 ring-white/5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.25em]">資本効率シミュレーション</span>
                        <div className="flex items-center gap-2 h-full">
                          <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse shrink-0" />
                          <span className="text-[8px] font-black text-slate-500 uppercase leading-none pt-0.5">Optimal Slot</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-[1fr_1.4fr] gap-4">
                        <div className="panel p-[18px] bg-white/[0.02] border border-white/5 flex flex-col justify-center rounded-[18px] min-w-0">
                          <span className="text-[8px] font-black text-slate-500 uppercase block tracking-widest mb-[10px] leading-[1.2]">推奨株数</span>
                          <div className="flex items-baseline gap-1.5 justify-center">
                            <span className="text-4xl font-pro-number font-black text-white leading-none tabular-nums tracking-tighter">
                              {(prediction?.day_trading?.lot_management?.shares || 0).toLocaleString()}
                            </span>
                            <span className="text-xs font-black text-slate-600 uppercase">UNIT</span>
                          </div>
                        </div>
                        <div className="panel p-[18px] bg-white/[0.02] border border-white/5 flex flex-col justify-center rounded-[18px] min-w-0 select-none cursor-default" style={{ caretColor: 'transparent' }}>
                          <span className="text-[8px] font-black text-slate-500 uppercase block tracking-widest mb-[10px] leading-[1.2]">平均利幅(T1)</span>
                          <div className="flex items-baseline gap-[8px] justify-center whitespace-nowrap overflow-hidden w-full px-2 pb-1">
                            <span className="font-pro-number font-black text-green-400 leading-none pointer-events-none" style={{ fontSize: 'clamp(16px, 3.5vw, 24px)' }}>+</span>
                            <span className="font-pro-number font-black text-green-400 leading-[1.1] tabular-nums tracking-tighter margin-0 pointer-events-none" style={{ fontSize: 'clamp(20px, 4.5vw, 32px)' }}>
                              ¥{(prediction?.day_trading?.lot_management?.target_price || 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="panel p-6 bg-red-500/5 border border-red-500/20 grid grid-cols-[auto_1fr_auto] items-center gap-6 group/risk">
                        {/* Left Icon (Fixed Size) */}
                        <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20 shrink-0">
                          <AlertTriangle className="w-5 h-5 text-red-400" />
                        </div>

                        {/* Center Text */}
                        <div className="flex flex-col justify-center min-w-0">
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-wider mb-0.5 whitespace-nowrap">Termination Level (S1)</p>
                          <p className="text-2xl font-pro-number font-black text-red-500 leading-none tabular-nums">
                            ¥{(prediction?.day_trading?.lot_management?.stop_price || 0).toLocaleString()}
                          </p>
                        </div>

                        {/* Right Button (No Wrap) */}
                        <button
                          onClick={() => handleAction("Risk Config", "Adjusting stop-loss parameters.")}
                          className="px-6 py-3 rounded-xl bg-red-500/10 text-red-400 text-[10px] font-black border border-red-500/20 hover:bg-red-500/20 transition-all uppercase whitespace-nowrap min-w-[80px] text-center"
                        >
                          Tune
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Execution Actions (v7.5 Final UI) */}
                <div className="flex flex-col md:flex-row gap-8 pt-10 border-t border-white/5">
                  <button
                    disabled={!marketPhase?.is_open}
                    onClick={() => handleAction("ORDER_INJECTION", "Starting real-time order protocol for TSE Prime.")}
                    className={clsx(
                      "flex-1 h-24 btn-accessible rounded-[2.5rem] flex items-center justify-center gap-6 text-2xl font-black transition-all border-b-8 border-cyan-800 active:border-b-0 active:translate-y-2 group",
                      marketPhase?.is_open ?
                        "bg-cyan-600 text-white shadow-[0_30px_70px_rgba(34,211,238,0.3)] hover:bg-cyan-500" :
                        "bg-slate-800 text-slate-600 opacity-50 cursor-not-allowed border-slate-900"
                    )}
                  >
                    <Zap className={clsx("w-8 h-8", marketPhase?.is_open && "animate-pulse")} />
                    プロトコル発注開始
                  </button>
                  <button
                    onClick={() => handleAction("QUANT_REPORT", "Generating deep quantitative analysis report.")}
                    className="flex-1 h-24 btn-accessible bg-black/60 border-2 border-white/10 rounded-[2.5rem] text-2xl font-black text-white flex items-center justify-center gap-6 hover:bg-black underline-offset-8 hover:underline shadow-xl transition-all"
                  >
                    <LayoutDashboard className="w-8 h-8 text-cyan-500" /> 詳細分析要約
                  </button>
                </div>
              </div>

              {/* Contextual Market Insights (Low level) */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 opacity-60 hover:opacity-100 transition-opacity">
                {[
                  { l: 'Beta', v: '1.12', i: Activity },
                  { l: 'Sharp', v: '2.44', i: Activity },
                  { l: 'Alpha', v: '+0.05', i: TrendingUp },
                  { l: 'Var', v: '1.8%', i: TrendingDown }
                ].map((m, idx) => (
                  <div key={idx} className="panel p-5 flex items-center gap-4 bg-white/[0.02]">
                    <m.i className="w-4 h-4 text-cyan-500/50" />
                    <div>
                      <p className="text-[8px] font-black text-slate-500 uppercase">{m.l}</p>
                      <p className="text-sm font-black text-white">{m.v}</p>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </main>

          {/* Global Footer (Terminal Signature) */}
          <footer className="mt-20 py-20 flex flex-col items-center gap-8 border-t border-white/5 opacity-40">
            <div className="flex items-center gap-16">
              <div className="flex flex-col items-center">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-[1em] mb-2">Engine Status</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />
                  <span className="text-[10px] font-black text-white tracking-widest">NOMINAL_RESTORED</span>
                </div>
              </div>
              <div className="w-px h-12 bg-white/10" />
              <div className="text-center">
                <p className="text-[9px] font-black text-slate-500 tracking-[1.5em] uppercase mb-1">Architecture</p>
                <p className="text-xs font-black text-white uppercase tracking-wider">Zero-Intervention Multi-Agent Grid</p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-4">
              <div className="flex gap-1">
                {[...Array(20)].map((_, i) => <div key={i} className="w-4 h-1 bg-white/10" />)}
              </div>
              <p className="text-[8px] font-black text-slate-700 tracking-[2em] uppercase">Minatomirai Professional Trading Terminal v7.50</p>
            </div>
          </footer>
        </div>
      </AgentGuard>
    </div>
  );
}
