
"use client";

import React, { useEffect, useState } from "react";
import { safeFetchJson } from "../lib/safeFetchJson";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    LineChart, Line, Area, AreaChart
} from "recharts";
import { Brain, TrendingUp, AlertTriangle, Activity } from "lucide-react";

interface AnalyticsData {
    reasons: any[];
    marketPhases: any[];
    trends: any[];
    opsLatest?: any;
    opsHistory?: any[];
}

export default function DashboardPage() {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            try {
                const endpoints = [
                    "/api/analytics/reasons",
                    "/api/analytics/market-phases",
                    "/api/analytics/trends",
                    "/api/ops/metrics/latest",
                    "/api/ops/metrics/history"
                ];

                const results = await Promise.all(endpoints.map(async (url) => {
                    const result = await safeFetchJson<any>(url);
                    return result.ok ? result.data : null;
                }));

                const [reasons, marketPhases, trends, opsLatest, opsHistory] = results;

                setData({
                    reasons: reasons || [],
                    marketPhases: marketPhases || [],
                    trends: trends || [],
                    opsLatest: opsLatest || {},
                    opsHistory: opsHistory || []
                });
            } catch (error) {
                console.error("Failed to fetch analytics:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96 text-gray-500">
                <Activity className="animate-spin mr-2" /> Loading Analytics...
            </div>
        );
    }

    if (!data) return <div className="text-center text-red-500">Data Load Error</div>;

    return (
        <div className="space-y-8">
            {/* Header Section */}
            <div>
                <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                    Learning Process Visualization
                </h2>
                <p className="text-gray-400 mt-1">AI意思決定ロジックの自己分析と精度評価</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="flex items-center space-x-3 text-blue-400 mb-2">
                        <Brain size={20} />
                        <span className="font-semibold">Avg Super Score</span>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {data.trends.length > 0
                            ? Math.round(data.trends.reduce((acc: number, cur: any) => acc + cur.score, 0) / data.trends.length)
                            : "---"}
                        <span className="text-sm text-gray-500 ml-2">pts</span>
                    </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="flex items-center space-x-3 text-green-400 mb-2">
                        <TrendingUp size={20} />
                        <span className="font-semibold">Learning Samples</span>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {data.reasons.reduce((acc: number, cur: any) => acc + cur.count, 0)}
                        <span className="text-sm text-gray-500 ml-2">decisions</span>
                    </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="flex items-center space-x-3 text-yellow-400 mb-2">
                        <AlertTriangle size={20} />
                        <span className="font-semibold">Dominant Reason</span>
                    </div>
                    <div className="text-lg font-bold text-white truncate">
                        {data.reasons.length > 0 ? data.reasons[0].reason : "No Data"}
                    </div>
                </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Reason Analysis */}
                <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
                    <h3 className="text-lg font-semibold mb-4 text-gray-200">Dominant Reasons (Top 3)</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.reasons.slice(0, 3)} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                                <XAxis type="number" stroke="#94a3b8" />
                                <YAxis dataKey="reason" type="category" width={100} stroke="#94a3b8" tick={{ fontSize: 10 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                    formatter={(value: any, name: any, props: any) => {
                                        if (name === "Avg Score") return [`${value} pts`, name];
                                        return [value, name];
                                    }}
                                    labelFormatter={(label) => label} // Custom Tooltip could show buy_rate
                                />
                                {/* Custom Tooltip for buy_rate */}
                                <Bar dataKey="avg_score" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Avg Score" isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                        * Buy Rate: {(data.reasons.slice(0, 3).map(r => `${r.reason.substring(0, 5)}..: ${r.buy_rate}%`).join(" | "))}
                    </div>
                </div>

                {/* Trend Analysis */}
                <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
                    <h3 className="text-lg font-semibold mb-4 text-gray-200">Score & Confidence Trend</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.trends}>
                                <defs>
                                    <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                                <XAxis dataKey="timestamp" hide />
                                <YAxis domain={[0, 100]} stroke="#94a3b8" />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                                    labelFormatter={(label, payload) => {
                                        if (payload && payload.length > 0) {
                                            return `${label} (${payload[0].payload.ticker})`;
                                        }
                                        return label;
                                    }}
                                />
                                <Area type="monotone" dataKey="score" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorScore)" name="Super Score" isAnimationActive={false} />
                                <Line type="monotone" dataKey="confidence" stroke="#10b981" dot={false} strokeWidth={2} name="Confidence" isAnimationActive={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Market Phase Analysis (Bar Chart for comparison) */}
                <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl lg:col-span-2">
                    <h3 className="text-lg font-semibold mb-4 text-gray-200">Market Phase Performance</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.marketPhases}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                                <XAxis dataKey="phase" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#94a3b8" />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                />
                                <Legend />
                                <Bar dataKey="avg_score" fill="#3b82f6" name="Avg Score" isAnimationActive={false} />
                                <Bar dataKey="avg_confidence" fill="#10b981" name="Avg Confidence (%)" isAnimationActive={false} />
                                <Bar dataKey="count" fill="#64748b" name="Sample Count" isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* --- Phase 8: Ops Metrics Section --- */}
                {data.opsHistory && data.opsHistory.length > 0 && (
                    <div className="col-span-1 lg:col-span-2 mt-8 border-t border-slate-800 pt-8">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-gray-200">Ops Metrics (SLO Monitoring)</h2>
                                <p className="text-gray-400 text-sm">System Health & Performance (Last 24h)</p>
                            </div>
                            <div className="flex space-x-4">
                                <div className="bg-slate-800 px-4 py-2 rounded-lg border border-slate-700">
                                    <div className="text-xs text-gray-500">Current p95 Latency</div>
                                    <div className={`text-xl font-bold ${data.opsLatest?.latency?.p95 > 2.0 ? 'text-red-500' : 'text-green-400'}`}>
                                        {data.opsLatest?.latency?.p95 || "---"}s
                                    </div>
                                </div>
                                <div className="bg-slate-800 px-4 py-2 rounded-lg border border-slate-700">
                                    <div className="text-xs text-gray-500">429 Errors (1h)</div>
                                    <div className={`text-xl font-bold ${data.opsLatest?.counts?.error_429 > 0 ? 'text-yellow-500' : 'text-gray-200'}`}>
                                        {data.opsLatest?.counts?.error_429 || 0}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Latency Trend */}
                            <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
                                <h3 className="text-lg font-semibold mb-4 text-gray-200">Latency Trend (p50 vs p95)</h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={data.opsHistory}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                                            <XAxis dataKey="timestamp" hide />
                                            <YAxis stroke="#94a3b8" label={{ value: 'Seconds', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} />
                                            <Legend />
                                            <Line type="monotone" dataKey="latency.p95" stroke="#ef4444" name="p95" strokeWidth={2} dot={false} isAnimationActive={false} />
                                            <Line type="monotone" dataKey="latency.p50" stroke="#3b82f6" name="p50" dot={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Reliability Rates */}
                            <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
                                <h3 className="text-lg font-semibold mb-4 text-gray-200">Reliability & Quality</h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={data.opsHistory}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                                            <XAxis dataKey="timestamp" hide />
                                            <YAxis domain={[80, 100]} stroke="#94a3b8" />
                                            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} />
                                            <Legend />
                                            <Bar dataKey="rates.success" fill="#10b981" name="Success Rate %" isAnimationActive={false} />
                                            <Bar dataKey="rates.cache_hit" fill="#f59e0b" name="Cache Hit %" isAnimationActive={false} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
