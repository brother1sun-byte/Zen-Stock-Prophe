'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Target, Shield } from 'lucide-react';
import { clsx } from 'clsx';
import { PredictionResponse } from '../types';
import { WeekendPlanSection } from './WeekendPlanSection';

// prediction: PredictionResponse imported from types.ts

interface SymbolDetailProps {
    ticker: string;
    prediction: PredictionResponse | null;
}

/**
 * SymbolDetail
 * 銘柄の詳細情報（価格、スコア、売買判断）を表示するパネル。
 */
export function SymbolDetail({ ticker, prediction }: SymbolDetailProps) {
    if (!prediction) {
        return (
            <div className="panel p-12 h-full flex items-center justify-center border-dashed border-white/5">
                <p className="text-muted font-black uppercase tracking-widest">Select a symbol to begin analysis</p>
            </div>
        );
    }

    const isUp = prediction.price_change_percent >= 0;
    const decision = prediction.day_trading?.decision || 'WAIT';
    const score = prediction.day_trading?.super_score || 0;

    return (
        <div className="space-y-6">
            {/* Price section */}
            <div className="panel p-8 flex justify-between items-end">
                <div>
                    <h2 className="text-4xl font-black text-white tracking-tighter mb-1 uppercase">
                        {prediction.company_name}
                    </h2>
                    <p className="text-lg font-bold text-muted tracking-widest uppercase">
                        {ticker} | TSE Prime
                    </p>
                </div>
                <div className="text-right">
                    <div className={clsx(
                        "text-sm font-black mb-1 flex items-center justify-end gap-1",
                        isUp ? "text-green-400" : "text-red-400"
                    )}>
                        {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {Math.abs(prediction.price_change_percent).toFixed(2)}%
                    </div>
                    <p className="text-6xl font-pro-number font-black text-white leading-none">
                        ¥{prediction.current_price.toLocaleString()}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Decision Section */}
                <div className="panel p-8 flex flex-col justify-between relative overflow-hidden">
                    <div className="relative z-10">
                        <span className="text-[10px] font-black text-muted uppercase tracking-widest block mb-4">AI Signal</span>
                        <h3 className={clsx(
                            "text-5xl font-black mb-2",
                            decision === 'BUY' ? "text-green-400" : decision === 'SELL' ? "text-amber-400" : "text-muted"
                        )}>
                            {decision === 'BUY' ? 'BUY' : decision === 'SELL' ? 'SELL' : 'WAIT'}
                        </h3>
                        <p className="text-sm font-bold text-white leading-tight">
                            {prediction.day_trading?.final_action_line}
                        </p>
                    </div>
                    <Target className="absolute -bottom-4 -right-4 w-24 h-24 text-white opacity-5" />
                </div>

                {/* Score Section */}
                <div className="panel p-8 relative overflow-hidden">
                    <span className="text-[10px] font-black text-muted uppercase tracking-widest block mb-4">Super Score</span>
                    <div className="flex items-end gap-2">
                        <span className="text-6xl font-pro-number font-black text-white">{score}</span>
                        <span className="text-xl font-black text-muted mb-2">/100</span>
                    </div>
                    <div className="mt-4 h-1.5 bg-black/40 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-green-500 transition-all duration-1000"
                            style={{ width: `${score}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Trading Management */}
            <div className="panel p-8">
                <span className="text-[10px] font-black text-muted uppercase tracking-widest block mb-6">Lot Management (Simulation)</span>
                <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase">Recommended</span>
                        <p className="text-2xl font-pro-number font-black text-white">{prediction.day_trading?.lot_management.shares?.toLocaleString() || 0} <span className="text-sm opacity-50">Shares</span></p>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase">Take Profit</span>
                        <p className="text-2xl font-pro-number font-black text-green-400">¥{prediction.day_trading?.lot_management.target_price?.toLocaleString() || 0}</p>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase">Stop Loss</span>
                        <p className="text-2xl font-pro-number font-black text-red-400">¥{prediction.day_trading?.lot_management.stop_price?.toLocaleString() || 0}</p>
                    </div>
                </div>
            </div>

            {/* Phase 2: Weekend Plan (Long-term & Risk Analysis) */}
            <WeekendPlanSection data={prediction} />
        </div>
    );
}
