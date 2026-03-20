'use client';

import React from 'react';
import { Search, Zap } from 'lucide-react';

interface SearchBarProps {
    value: string;
    onChange: (val: string) => void;
    onSearch: (e: React.FormEvent) => void;
    isLoading: boolean;
}

/**
 * SearchBar
 * 銘柄検索バー。
 * タイポグラフィを強調しつつ、インプットエリアをコンパクトにまとめます。
 */
export function SearchBar({ value, onChange, onSearch, isLoading }: SearchBarProps) {
    return (
        <div className="panel p-6 space-y-4">
            <h3 className="text-xs font-black text-muted uppercase tracking-widest flex items-center gap-2">
                <Search className="w-4 h-4" /> Market Search
            </h3>

            <form onSubmit={onSearch} className="flex gap-3">
                <div className="relative flex-1 group">
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value.toUpperCase())}
                        placeholder="銘柄コード (e.g. 7203)"
                        className="w-full bg-black/40 border-2 border-stroke rounded-xl px-5 py-3 text-2xl font-mono font-black text-white focus:border-cyan-500/50 focus:outline-none transition-all placeholder:text-white/10"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted uppercase tracking-tighter opacity-0 group-focus-within:opacity-100 transition-opacity">
                        Press Enter
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isLoading}
                    className="btn-accessible bg-cyan-600 border-cyan-500 text-white shadow-[0_0_20px_rgba(34,211,238,0.2)] hover:bg-cyan-500"
                >
                    <Zap className="mr-2 w-4 h-4" />
                    Scan
                </button>
            </form>

            <p className="text-[10px] font-bold text-muted uppercase tracking-widest text-center">
                7203.T / SOFTBANK / TOYOTA - AI-DRIVEN ANALYSIS ENABLED
            </p>
        </div>
    );
}
