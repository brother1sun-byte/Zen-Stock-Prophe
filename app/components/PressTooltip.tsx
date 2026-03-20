import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PressTooltipProps {
    // Tooltip表示内容
    score?: number;
    confidence?: number;
    reasonTop3?: string[];
    dataStatus?: 'fresh' | 'stale' | 'missing';
    scanStatus?: 'ok' | 'degraded' | 'failed';
    riskFlag?: string;

    // トリガー要素
    children: React.ReactNode;

    // オプション
    longPressDuration?: number; // モバイルのlong press閾値（ms）
    disabled?: boolean;
}

export function PressTooltip({
    score,
    confidence,
    reasonTop3,
    dataStatus,
    scanStatus,
    riskFlag,
    children,
    longPressDuration = 400,
    disabled = false
}: PressTooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
        // モバイルデバイス判定
        const checkMobile = () => {
            setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
        };
        checkMobile();
    }, []);

    // Desktop: hover制御
    const handleMouseEnter = () => {
        if (!isMobile && !disabled) {
            setIsVisible(true);
        }
    };

    const handleMouseLeave = () => {
        if (!isMobile) {
            setIsVisible(false);
        }
    };

    // Mobile: tap-hold制御
    const handleTouchStart = (e: React.TouchEvent) => {
        if (disabled) return;

        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };

        // long press タイマー開始
        longPressTimerRef.current = setTimeout(() => {
            setIsVisible(true);
        }, longPressDuration);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!touchStartRef.current) return;

        const touch = e.touches[0];
        const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
        const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);

        // スクロール干渉防止：10px以上移動したらキャンセル
        if (deltaX > 10 || deltaY > 10) {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
            }
        }
    };

    const handleTouchEnd = () => {
        // タイマークリア
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        touchStartRef.current = null;

        // 指を離したら閉じる（モバイル）
        if (isMobile && isVisible) {
            setIsVisible(false);
        }
    };

    // 画面外タップで閉じる
    useEffect(() => {
        if (!isVisible) return;

        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            setIsVisible(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isVisible]);

    return (
        <div className="relative inline-block" data-testid="press-tooltip-wrapper">
            {/* トリガー要素 */}
            <div
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="cursor-pointer"
            >
                {children}
            </div>

            {/* Tooltip */}
            <AnimatePresence>
                {isVisible && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 10 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-[500] bg-slate-900 border-2 border-slate-700 rounded-2xl shadow-2xl p-6 min-w-[280px] max-w-sm"
                        style={{
                            top: 'calc(100% + 8px)',
                            left: '50%',
                            transform: 'translateX(-50%)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                        data-testid="press-tooltip-content"
                    >
                        {/* 閉じるボタン（モバイル用） */}
                        {isMobile && (
                            <button
                                onClick={() => setIsVisible(false)}
                                className="absolute top-2 right-2 text-white/50 hover:text-white transition-colors bg-white/5 p-1 rounded-full"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        )}

                        {/* 表示内容 */}
                        <div className="space-y-3">
                            {/* Score & Confidence */}
                            {(score !== undefined || confidence !== undefined) && (
                                <div className="flex gap-4">
                                    {score !== undefined && (
                                        <div>
                                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Score</span>
                                            <p className="text-2xl font-mono font-black text-white">{score}</p>
                                        </div>
                                    )}
                                    {confidence !== undefined && (
                                        <div>
                                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Confidence</span>
                                            <p className="text-2xl font-mono font-black text-blue-400">{(confidence * 100).toFixed(0)}%</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Reason Top 3 */}
                            {reasonTop3 && reasonTop3.length > 0 && (
                                <div className="pt-2 border-t border-white/5">
                                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-2">Reasons</span>
                                    <div className="space-y-1">
                                        {reasonTop3.map((reason, i) => (
                                            <div key={i} className="flex gap-2 items-start">
                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5" />
                                                <p className="text-xs font-bold text-slate-400 leading-tight">{reason}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Status Indicators */}
                            {(dataStatus || scanStatus) && (
                                <div className="flex gap-2 pt-2 border-t border-white/5">
                                    {dataStatus && (
                                        <span className={`text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-tighter ${dataStatus === 'fresh' ? 'bg-emerald-500/20 text-emerald-400' :
                                            dataStatus === 'stale' ? 'bg-amber-500/20 text-amber-400' :
                                                'bg-red-500/20 text-red-400'
                                            }`}>
                                            Data: {dataStatus}
                                        </span>
                                    )}
                                    {scanStatus && (
                                        <span className={`text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-tighter ${scanStatus === 'ok' ? 'bg-blue-500/20 text-blue-400' :
                                            scanStatus === 'degraded' ? 'bg-amber-500/20 text-amber-400' :
                                                'bg-red-500/20 text-red-400'
                                            }`}>
                                            Scan: {scanStatus}
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Risk Flag */}
                            {riskFlag && (
                                <div className="pt-2 border-t border-white/5">
                                    <p className="text-xs font-bold text-red-400 leading-tight line-clamp-1">{riskFlag}</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
