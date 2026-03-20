'use client';

import { redirect } from 'next/navigation';

/**
 * Legacy Redirect
 * v7.5 UI がメインルート (/) に統合されたため、
 * /legacy へのアクセスはルートへリダイレクトします。
 */
export default function LegacyRedirect() {
    redirect('/');
}
