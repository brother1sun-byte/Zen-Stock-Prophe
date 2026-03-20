'use client';

import React from 'react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';

interface PerformanceChartProps {
    data: any[];
    isUp: boolean;
    period: string;
    onPeriodChange: (p: string) => void;
    isLoading: boolean;
}

/**
 * PerformanceChart
 * 価格推移を表示するチャートコンポーネント。
 */
export function PerformanceChart({ data, isUp, period, onPeriodChange, isLoading }: PerformanceChartProps) {
    return (
        <div className="panel p-8 h-full flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-muted uppercase tracking-widest">Performance Protocol</h3>
                <div className="flex gap-2">
                    {['1d', '1w', '1mo'].map(p => (
                        <button
                            key={p}
                            onClick={() => onPeriodChange(p)}
                            className={clsx(
                                "px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all",
                                period === p ? "bg-cyan-500 text-black shadow-[0_0_10px_rgba(34,211,238,0.4)]" : "text-muted hover:text-white"
                            )}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            <div className={clsx("flex-1 min-h-[300px] transition-opacity duration-300", isLoading && "opacity-30")}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={isUp ? "#34d399" : "#fb7185"} stopOpacity={0.2} />
                                <stop offset="100%" stopColor={isUp ? "#34d399" : "#fb7185"} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis
                            dataKey="name"
                            stroke="rgba(255,255,255,0.2)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const d = payload[0].payload;
                                    return (
                                        <div className="panel-strong p-4 shadow-2xl border-white/10 ring-1 ring-white/5">
                                            <p className="text-[10px] font-black text-muted uppercase mb-1">{d.name}</p>
                                            <p className="text-xl font-pro-number font-black text-white">¥{d.base?.toLocaleString()}</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="base"
                            stroke={isUp ? "#34d399" : "#fb7185"}
                            strokeWidth={2}
                            fill="url(#chartGrad)"
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// clsx workaround if not imported
function clsx(...args: any[]) {
    return args.filter(Boolean).join(' ');
}
