import { useRef, useState, useCallback, useEffect } from 'react';

interface UseLongPressOptions {
    threshold?: number;
    onLongPress: () => void;
    onCancel?: () => void;
    moveThreshold?: number;
}

export function useLongPress({
    threshold = 400,
    onLongPress,
    onCancel,
    moveThreshold = 10
}: UseLongPressOptions) {
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startPosRef = useRef<{ x: number; y: number } | null>(null);
    const [isTriggered, setIsTriggered] = useState(false);

    const start = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        // タッチイベントのみ、または必要に応じてマウスも対応
        // 今回はモバイル要件なのでタッチメインだが、一応両対応
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        startPosRef.current = { x: clientX, y: clientY };
        setIsTriggered(false);

        timerRef.current = setTimeout(() => {
            onLongPress();
            setIsTriggered(true);
        }, threshold);
    }, [onLongPress, threshold]);

    const clear = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        startPosRef.current = null;
        if (onCancel && !isTriggered) {
            onCancel();
        }
        // isTriggeredのリセットはここで行わない（長押し成功状態を維持したい場合があるため）
        // ただし今回は「指を離したら解除」などの要件に合わせて調整
    }, [onCancel, isTriggered]);

    const move = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        if (!startPosRef.current || !timerRef.current) return;

        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        const dx = Math.abs(clientX - startPosRef.current.x);
        const dy = Math.abs(clientY - startPosRef.current.y);

        if (dx > moveThreshold || dy > moveThreshold) {
            clear();
        }
    }, [moveThreshold, clear]);

    return {
        handlers: {
            onMouseDown: start,
            onTouchStart: start,
            onMouseUp: clear,
            onMouseLeave: clear,
            onTouchEnd: clear,
            onMouseMove: move,
            onTouchMove: move,
        },
        isTriggered
    };
}
