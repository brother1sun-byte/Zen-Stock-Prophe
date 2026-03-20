'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, RefreshCw, ArrowUpRight, Activity, ZoomIn, TrendingDown,
  Filter, BarChart3, Zap, ArrowLeft
} from 'lucide-react';
import { clsx } from 'clsx';
import Link from 'next/link';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
interface ScreenResult {
  ticker: string;
  name: string;
  price: number;
  rsi?: number;
  bb_width?: number;
  consecutive_days?: number;
  growth_pct?: number;
  volume_ratio?: number;
  filter: string;
}

interface ScreenResponse {
  timestamp: string;
  market: string;
  filter: string;
  timeframe: string;
  total_scanned: number;
  matches_count: number;
  elapsed_ms: number;
  results: ScreenResult[];
}

// ------------------------------------------------------------------
// Filter Definitions
// ------------------------------------------------------------------
const FILTERS = [
  {
    id: 'rsi_oversold',
    label: 'RSI 売られすぎ',
    description: 'RSI14 ≤ 30 の銘柄',
    icon: TrendingDown,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/30',
  },
  {
    id: 'rsi_overbought',
    label: 'RSI 買われすぎ',
    description: 'RSI14 ≥ 70 の銘柄',
    icon: ArrowUpRight,
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/30',
  },
  {
    id: 'bb_squeeze',
    label: 'BB スクイーズ',
    description: 'ボリンジャーバンド幅が収縮中',
    icon: ZoomIn,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/30',
  },
  {
    id: 'consecutive_bullish',
    label: '連続陽線',
    description: '3日以上連続陽線 + 成長率2%以上',
    icon: BarChart3,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
  },
  {
    id: 'volume_spike',
    label: '出来高急増',
    description: '出来高が20日平均の2倍以上',
    icon: Zap,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
  },
];

const MARKETS = [
  { id: 'JP', label: '日本株' },
  { id: 'US', label: '米国株' },
  { id: 'CRYPTO', label: '仮想通貨' },
];

const TIMEFRAMES = [
  { id: '1d', label: '日足' },
  { id: '1wk', label: '週足' },
];

// ------------------------------------------------------------------
// Column renderer per filter type
// ------------------------------------------------------------------
function renderFilterColumn(r: ScreenResult): React.ReactNode {
  switch (r.filter) {
    case 'rsi_oversold':
    case 'rsi_overbought':
      return (
        <span className={clsx(
          'font-pro-number text-xl font-black',
          r.rsi != null && r.rsi <= 30 ? 'text-blue-400' :
          r.rsi != null && r.rsi >= 70 ? 'text-red-400' : 'text-white'
        )}>
          RSI {r.rsi?.toFixed(1)}
        </span>
      );
    case 'bb_squeeze':
      return (
        <span className="font-pro-number text-xl font-black text-purple-400">
          BB幅 {r.bb_width?.toFixed(4)}
        </span>
      );
    case 'consecutive_bullish':
      return (
        <span className="font-pro-number text-xl font-black text-emerald-400">
          {r.consecutive_days}日連続 +{r.growth_pct?.toFixed(1)}%
        </span>
      );
    case 'volume_spike':
      return (
        <span className="font-pro-number text-xl font-black text-amber-400">
          x{r.volume_ratio?.toFixed(1)} {r.rsi != null ? `(RSI ${r.rsi.toFixed(0)})` : ''}
        </span>
      );
    default:
      return null;
  }
}

// ------------------------------------------------------------------
// Main Page Component
// ------------------------------------------------------------------
export default function ScreenerPage() {
  const [market, setMarket] = useState('JP');
  const [filterType, setFilterType] = useState('rsi_oversold');
  const [timeframe, setTimeframe] = useState('1d');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScreenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeFilter = FILTERS.find(f => f.id === filterType)!;

  const runScreen = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        market,
        filter: filterType,
        timeframe,
        limit: '20',
      });
      const res = await fetch(`/api/screen?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const json: ScreenResponse = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [market, filterType, timeframe]);

  return (
    <div className="min-h-screen bg-app selection:bg-cyan-500/30 overflow-x-hidden antialiased">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-10 py-8 min-h-screen flex flex-col gap-10">

        {/* =================== HEADER =================== */}
        <nav className="panel-strong flex flex-col gap-8 px-10 py-8 sticky top-0 z-[100] shadow-2xl backdrop-blur-3xl ring-1 ring-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <Link href="/" className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all">
                <ArrowLeft className="w-6 h-6" />
              </Link>
              <div className="flex flex-col">
                <span className="text-4xl font-black tracking-tighter text-white">
                  SCREENER <span className="text-cyan-400">PRO</span>
                </span>
                <span className="text-[10px] font-black text-slate-500 tracking-[1.5em] uppercase mt-1">
                  Advanced Multi-Filter Scanner
                </span>
              </div>
            </div>

            {/* Market Tabs */}
            <div className="flex items-center gap-6">
              <div className="flex bg-black/40 border border-white/10 rounded-2xl p-1.5 shadow-inner">
                {MARKETS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMarket(m.id)}
                    className={clsx(
                      'px-6 py-2.5 rounded-xl text-xs font-black transition-all tracking-wider',
                      market === m.id ? 'bg-cyan-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Timeframe */}
              <div className="flex bg-black/40 border border-white/10 rounded-2xl p-1.5 shadow-inner">
                {TIMEFRAMES.map(tf => (
                  <button
                    key={tf.id}
                    onClick={() => setTimeframe(tf.id)}
                    className={clsx(
                      'px-5 py-2.5 rounded-xl text-xs font-black transition-all tracking-wider',
                      timeframe === tf.id ? 'bg-white/10 text-white shadow-xl' : 'text-slate-500 hover:text-white'
                    )}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>

              {/* Scan Button */}
              <button
                onClick={runScreen}
                disabled={loading}
                className="w-16 h-16 rounded-2xl bg-cyan-600 text-white flex items-center justify-center shadow-[0_15px_40px_rgba(34,211,238,0.3)] hover:bg-cyan-500 transition-all border border-cyan-400/20 active:scale-95 group"
              >
                <Search className={clsx('w-7 h-7 transition-transform', loading && 'animate-spin')} />
              </button>
            </div>
          </div>
        </nav>

        {/* =================== FILTER SELECTOR =================== */}
        <div className="grid grid-cols-5 gap-4">
          {FILTERS.map(f => {
            const Icon = f.icon;
            const isActive = filterType === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                className={clsx(
                  'relative p-6 rounded-2xl border transition-all text-left group',
                  isActive
                    ? `${f.bg} shadow-lg ring-2 ring-white/10`
                    : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
                )}
              >
                <div className="flex items-center gap-3 mb-3">
                  <Icon className={clsx('w-5 h-5', isActive ? f.color : 'text-slate-500 group-hover:text-white')} />
                  <span className={clsx('text-sm font-black tracking-tight', isActive ? 'text-white' : 'text-slate-400 group-hover:text-white')}>
                    {f.label}
                  </span>
                </div>
                <p className="text-[10px] font-bold text-slate-500">{f.description}</p>
                {isActive && (
                  <motion.div
                    layoutId="activeFilter"
                    className="absolute inset-0 rounded-2xl border-2 border-cyan-500/40 pointer-events-none"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* =================== RESULTS =================== */}
        <div className="flex-1">
          {/* Initial state */}
          {!data && !loading && !error && (
            <div className="flex flex-col items-center justify-center py-32 gap-6">
              <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <Filter className="w-10 h-10 text-slate-600" />
              </div>
              <p className="text-lg font-black text-slate-500 uppercase tracking-widest">
                フィルターを選択して検索を実行
              </p>
              <p className="text-xs text-slate-600">
                上部のフィルターカードを選択し、右上の 🔍 ボタンを押してください
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-32 gap-6">
              <div className="w-16 h-16 rounded-full border-4 border-cyan-500/20 border-t-cyan-500 animate-spin" />
              <p className="text-sm font-black text-slate-400 uppercase tracking-[0.5em]">
                Scanning {market} market...
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="panel p-10 text-center">
              <p className="text-red-400 font-black text-xl mb-4">Scan Error</p>
              <p className="text-slate-400 text-sm">{error}</p>
              <button onClick={runScreen} className="mt-6 px-8 py-3 rounded-xl bg-white/5 text-white font-bold hover:bg-white/10 transition-all">
                再試行
              </button>
            </div>
          )}

          {/* Results */}
          {data && !loading && (
            <AnimatePresence mode="wait">
              <motion.div
                key={data.timestamp}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {/* Summary Bar */}
                <div className="flex items-center justify-between px-4">
                  <div className="flex items-center gap-6">
                    <span className="text-sm font-black text-white">
                      {data.matches_count}件 ヒット
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">
                      / {data.total_scanned}銘柄スキャン
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500">
                    <span>{data.elapsed_ms}ms</span>
                    <span className="text-slate-600">|</span>
                    <span>{data.market}</span>
                    <span className="text-slate-600">|</span>
                    <span>{activeFilter.label}</span>
                  </div>
                </div>

                {/* Results Grid */}
                {data.results.length > 0 ? (
                  <div className="space-y-3">
                    {data.results.map((r, idx) => (
                      <Link
                        key={r.ticker}
                        href={`/?ticker=${r.ticker}`}
                        className="block"
                      >
                        <motion.div
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="panel p-6 flex items-center justify-between hover:bg-white/[0.04] hover:border-cyan-500/20 transition-all group cursor-pointer"
                        >
                          <div className="flex items-center gap-8">
                            {/* Rank */}
                            <div className={clsx(
                              'w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg',
                              idx < 3 ? 'bg-cyan-600/20 text-cyan-400' : 'bg-white/5 text-slate-500'
                            )}>
                              {idx + 1}
                            </div>

                            {/* Ticker & Name */}
                            <div className="min-w-[200px]">
                              <span className="text-2xl font-black text-white font-pro-number block leading-none">
                                {r.ticker}
                              </span>
                              <span className="text-xs font-bold text-slate-500 mt-1 block truncate max-w-[180px]">
                                {r.name}
                              </span>
                            </div>

                            {/* Price */}
                            <div className="min-w-[120px]">
                              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Price</span>
                              <span className="text-xl font-black text-white font-pro-number">
                                {r.price >= 1 ? `¥${r.price.toLocaleString()}` : `$${r.price.toFixed(4)}`}
                              </span>
                            </div>
                          </div>

                          {/* Filter-specific column */}
                          <div className="flex items-center gap-8">
                            {renderFilterColumn(r)}
                            <ArrowUpRight className="w-6 h-6 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                          </div>
                        </motion.div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="panel p-16 text-center">
                    <Activity className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-sm font-black text-slate-500 uppercase tracking-widest">
                      条件に合致する銘柄はありませんでした
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
