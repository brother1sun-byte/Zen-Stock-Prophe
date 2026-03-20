export type AppMode = 'normal' | 'agent';

/**
 * 現在の動作モードを返します。
 * 環境変数 NEXT_PUBLIC_APP_MODE が 'agent' の場合のみ 'agent' を返し、
 * それ以外（未定義や不正な値）はすべて 'normal' 扱いとします。
 */
export function getAppMode(): AppMode {
    const mode = process.env.NEXT_PUBLIC_APP_MODE;
    if (mode === 'agent') {
        return 'agent';
    }
    return 'normal';
}

/**
 * エージェントモードかどうかを判定します。
 */
export function isAgentMode(): boolean {
    return getAppMode() === 'agent';
}
