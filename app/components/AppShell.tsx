'use client';

import React from 'react';

/**
 * AppShell
 * 全レイアウト共通の外枠コンポーネント。
 * 背景グラデーション、最大幅、パディングを統一します。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-app text-white selection:bg-cyan-500/30 overflow-x-hidden antialiased">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-6 min-h-screen flex flex-col gap-6">
                {children}
            </div>
        </div>
    );
}
