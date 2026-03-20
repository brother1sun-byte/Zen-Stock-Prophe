'use client';

import React from 'react';
import { isAgentMode } from '../lib/appMode';
import { ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';

interface AgentGuardProps {
    children: React.ReactNode;
    reason?: string;
    className?: string;
}

/**
 * エージェントモード時に子要素（主にボタンやフォーム）を無効化し、理由を表示するガードコンポーネント。
 */
export function AgentGuard({
    children,
    reason = "エージェント実行中のため、この操作は無効です。通常モードで利用してください。",
    className
}: AgentGuardProps) {
    const isAgent = isAgentMode();

    if (!isAgent) {
        return <>{children}</>;
    }

    return (
        <div className={clsx("relative group", className)}>
            <div className="opacity-50 pointer-events-none filter grayscale">
                {children}
            </div>
            <div className="mt-2 flex items-center gap-2 text-red-400 text-[10px] font-bold bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                <ShieldAlert className="w-3 h-3 flex-shrink-0" />
                <span>{reason}</span>
            </div>
            {/* ツールチップ的な表示 */}
            <div className="absolute inset-0 z-10 cursor-not-allowed" title={reason} />
        </div>
    );
}
