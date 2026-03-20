'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { BeginnerJudgment } from '../types';

interface BeginnerCompassProps {
    data: BeginnerJudgment;
}

export const BeginnerCompass: React.FC<BeginnerCompassProps> = ({ data }) => {
    const { verdict, sign, color, description, summary, points } = data;

    const colorMap: Record<string, { bg: string, text: string, border: string, accent: string }> = {
        cyan: {
            bg: 'bg-cyan-500/10',
            text: 'text-cyan-400',
            border: 'border-cyan-500/20',
            accent: 'bg-cyan-500'
        },
        green: {
            bg: 'bg-emerald-500/10',
            text: 'text-emerald-400',
            border: 'border-emerald-500/20',
            accent: 'bg-emerald-500'
        },
        amber: {
            bg: 'bg-amber-500/10',
            text: 'text-amber-400',
            border: 'border-amber-500/20',
            accent: 'bg-amber-500'
        },
        red: {
            bg: 'bg-rose-500/10',
            text: 'text-rose-400',
            border: 'border-rose-500/20',
            accent: 'bg-rose-500'
        },
        slate: {
            bg: 'bg-slate-500/10',
            text: 'text-slate-400',
            border: 'border-slate-500/20',
            accent: 'bg-slate-500'
        }
    };

    const theme = colorMap[color] || colorMap.slate;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel-strong overflow-hidden relative group"
        >
            {/* Decorative background glow */}
            <div className={clsx(
                "absolute -top-24 -right-24 w-64 h-64 rounded-full blur-[100px] opacity-20 transition-all duration-1000 group-hover:opacity-40",
                theme.accent
            )} />

            <div className="p-8 relative z-10">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center border shadow-lg", theme.bg, theme.border)}>
                            <Sparkles className={clsx("w-5 h-5", theme.text)} />
                        </div>
                        <div>
                            <h3 className="text-xs font-black text-white uppercase tracking-[0.2em]">Beginner's Compass</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Instant Judgment v8.0</p>
                        </div>
                    </div>
                    <div className={clsx("px-4 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest", theme.bg, theme.border, theme.text)}>
                        AI Analysis
                    </div>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-10 bg-black/40 border border-white/5 p-10 rounded-[2.5rem] shadow-inner mb-10">
                    <div className="relative">
                        <motion.div
                            animate={{
                                scale: [1, 1.1, 1],
                                rotate: [0, 5, -5, 0]
                            }}
                            transition={{
                                duration: 5,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className={clsx(
                                "w-32 h-32 rounded-[2.5rem] flex items-center justify-center text-7xl shadow-2xl border-4 transition-all duration-500",
                                theme.bg, theme.border
                            )}
                        >
                            {sign}
                        </motion.div>
                        <div className={clsx(
                            "absolute -bottom-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center border-4 border-black text-white shadow-xl",
                            theme.accent
                        )}>
                            <ArrowRight className="w-5 h-5" />
                        </div>
                    </div>

                    <div className="flex-1 text-center md:text-left">
                        <h4 className={clsx("text-5xl font-black tracking-tighter mb-4 leading-none uppercase", theme.text)}>
                            {verdict}
                        </h4>
                        <div className="flex items-center justify-center md:justify-start gap-4 mb-4">
                            <div className="h-1 w-24 bg-white/10 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: '100%' }}
                                    transition={{ duration: 1.5, ease: "easeOut" }}
                                    className={clsx("h-full", theme.accent)}
                                />
                            </div>
                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Signal Strength: High</span>
                        </div>
                        <p className="text-xl font-bold text-slate-200 leading-tight">
                            {description}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2">
                            <Info className="w-4 h-4 text-cyan-500" /> Key Reason
                        </h5>
                        <div className="bg-white/5 border border-white/5 p-6 rounded-2xl flex gap-4 items-start">
                            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
                                <CheckCircle2 className="w-4 h-4" />
                            </div>
                            <p className="text-lg font-bold text-white leading-snug pt-0.5">
                                {summary}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2">
                            <Target className="w-4 h-4 text-emerald-500" /> Analysis Points
                        </h5>
                        <div className="space-y-3">
                            {points.map((point, i) => (
                                <div key={i} className="flex items-center gap-4 text-sm font-bold text-slate-400 group/point">
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-700 group-hover/point:bg-emerald-500 transition-colors" />
                                    {point}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="px-8 py-4 bg-white/[0.02] border-t border-white/5 flex justify-between items-center text-[9px] font-black text-slate-600 uppercase tracking-widest">
                <span>MinatoMirai Engine v8.0.2</span>
                <span>Secure Analysis Mode</span>
            </div>
        </motion.div>
    );
};

// Icons not imported from lucide-react in current scope (Target), let's fix imports
import { Target } from 'lucide-react';
