'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';

interface AlertToastProps {
    error: string | null;
    onClose: () => void;
}

/**
 * AlertToast
 * 画面上部に上品に表示されるシステム警告コンポーネント。
 */
export function AlertToast({ error, onClose }: AlertToastProps) {
    const [expanded, setExpanded] = React.useState(false);

    return (
        <AnimatePresence>
            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -40, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -40, scale: 0.95 }}
                    className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] w-full max-w-2xl px-4 pointer-events-none"
                >
                    <div className="panel-strong p-5 shadow-[0_40px_80px_rgba(0,0,0,0.8)] border-red-500/40 pointer-events-auto overflow-hidden">
                        <div className="flex items-start gap-5">
                            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle className="w-6 h-6 text-red-400" />
                            </div>

                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-black text-red-400 uppercase tracking-widest mb-1">System Alert</h3>
                                <p className="text-sm font-bold text-white/90 leading-tight truncate">
                                    {error}
                                </p>

                                <button
                                    onClick={() => setExpanded(!expanded)}
                                    className="mt-2 text-[10px] font-bold text-muted hover:text-white flex items-center gap-1 transition-colors"
                                >
                                    {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    詳細プロトコルを確認
                                </button>

                                <AnimatePresence>
                                    {expanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="mt-4 p-4 bg-black/40 rounded-xl hairline overflow-hidden"
                                        >
                                            <p className="text-xs font-mono text-muted whitespace-pre-line leading-relaxed">
                                                {error}
                                            </p>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                                <X className="w-5 h-5 text-muted hover:text-white" />
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
