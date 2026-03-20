'use client';

import React from 'react';
import { Activity, Clock, Zap, RefreshCw, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';

interface StatusBarProps {
    status: 'ok' | 'degraded' | 'failed';
    marketPhase?: { label: string; is_open: boolean };
    lastRefreshed: string;
    isLiveMode: boolean;
    onRefresh: () => void;
    isLoading: boolean;
}

/**
 * StatusBar
 * 画面上部に固定されるステータス表示コンポーネント。
 * システムの状態、市場状況、同期時刻を一元管理します。
 */
export function StatusBar({ status, marketPhase, lastRefreshed, isLiveMode, onRefresh, isLoading }: StatusBarProps) {
    return (
        <nav className="panel-strong px-6 py-3 flex items-center justify-between sticky top-0 z-[100] shadow-2xl">
            <div className="flex items-center gap-6">
                {/* Branding / Logo */}
                <div className="flex flex-col">
                    <span className="text-xl font-black tracking-tighter text-white flex items-center gap-2">
                        MINATOMIRAI <span className="text-cyan-400">PRO</span>
                    </span>
                    <span className="text-[10px] font-bold text-muted tracking-[0.3em] uppercase">Cybernetic Terminal</span>
                </div>

                <div className="h-8 w-px bg-stroke hidden md:block" />

                {/* System Status */}
                <div className="flex items-center gap-3 bg-black/40 px-4 py-1.5 rounded-full hairline">
                    <div className={clsx(
                        "w-2 h-2 rounded-full",
                        status === 'ok' ? "bg-green-400" : status === 'degraded' ? "bg-amber-400" : "bg-red-400 animate-pulse"
                    )} />
                    <span className="text-xs font-black uppercase tracking-widest text-muted">
                        {status === 'ok' ? 'System Stable' : status === 'degraded' ? 'Sync Degraded' : 'Connection Lost'}
                    </span>
                </div>

                {/* Market Phase */}
                <div className="hidden sm:flex items-center gap-3">
                    <Activity className={clsx("w-4 h-4", marketPhase?.is_open ? "text-green-400" : "text-muted")} />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                        {marketPhase?.label || 'Market Syncing...'}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-6">
                {/* Mode & Time */}
                <div className="hidden lg:flex items-center gap-8">
                    <div className="text-right">
                        <span className="text-[10px] font-bold text-muted uppercase block">Last Sync</span>
                        <span className="text-sm font-mono font-bold text-white">{lastRefreshed || '--:--:--'}</span>
                    </div>

                    <div className={clsx(
                        "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase border",
                        isLiveMode ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    )}>
                        {isLiveMode ? 'Live Mode' : 'Training Mode'}
                    </div>
                </div>

                <button
                    onClick={onRefresh}
                    disabled={isLoading}
                    className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all group"
                >
                    <RefreshCw className={clsx("w-5 h-5", isLoading && "animate-spin")} />
                </button>
            </div>
        </nav>
    );
}
