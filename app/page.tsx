'use client';

import React from 'react';
import LegacyLayout from './page_original_v7.5';

/**
 * Home (Production v7.5 Locked)
 * UIバージョンを V7.5 (page_original_v7.5.tsx) に完全固定します。
 * 他のUIバージョンへの切り替えロジックは排除されています。
 */
export default function Home() {
    return <LegacyLayout />;
}
