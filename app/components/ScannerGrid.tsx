'use client';

import React from 'react';
import { BrainCircuit, TrendingUp, TrendingDown, LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

interface HotPick {
    ticker: string;
    confidence: number;
    reason_top3?: string[];
    reason?: string;
    scan_status?: string;
}

interface ScannerGridProps {
    picks: HotPick[];
    isLoading: boolean;
    onSelect: (ticker: string) => void;
}

/**
 * ScannerGrid
 * AIのスキャン結果を表示するグリッド。
 * 情報密度を高め、視覚的な一貫性を提供します。
 */
export function ScannerGrid({ picks, isLoading, onSelect }: ScannerGridProps) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="panel p-5 h-32 animate-pulse bg-white/5" />
                ))}
            </div>
        );
    }

    if (picks.length === 0) {
        return (
            <div className="panel p-10 text-center border-dashed border-white/5">
                <p className="text-muted font-bold uppercase tracking-widest text-xs">No active targets found</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {picks.map((pick) => (
                <button
                    key={pick.ticker}
                    onClick={() => onSelect(pick.ticker)}
                    className="panel p-5 text-left hover:border-cyan-500/50 hover:bg-white/5 group transition-all relative overflow-hidden"
                >
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-2xl font-mono font-black text-white group-hover:text-cyan-400">
                            {pick.ticker}
                        </span>
                        <div className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[9px] font-black text-cyan-400 uppercase tracking-tighter">
                            {(pick.confidence * 100).toFixed(0)}% CONF
                        </div>
                    </div>

                    <div className="space-y-1.5 min-h-[40px]">
                        {pick.reason_top3 ? (
                            <div className="flex flex-col gap-1">
                                <p className="text-[10px] font-bold text-muted leading-tight truncate">
                                    {pick.reason_top3[0]}
                                </p>
                                <div className="flex gap-2">
                                    <span className="text-[8px] font-bold text-cyan-400/60 uppercase">Trend+</span>
                                    <span className="text-[8px] font-bold text-cyan-400/60 uppercase">Vol+</span>
                                </div>
                            </div>
                        ) : (
                            <p className="text-[10px] font-bold text-muted leading-tight line-clamp-2">
                                {pick.reason}
                            </p>
                        )}
                    </div>

                    {/* Visual indicator for selection */}
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500 scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
                </button>
            ))}
        </div>
    );
}
