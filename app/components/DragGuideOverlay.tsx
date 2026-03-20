'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MousePointer2, X } from 'lucide-react';

export function DragGuideOverlay() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const dismissed = localStorage.getItem('minatomirai_drag_guide_dismissed');
        if (!dismissed) {
            setIsVisible(true);
        }
    }, []);

    const handleDismiss = () => {
        setIsVisible(false);
        localStorage.setItem('minatomirai_drag_guide_dismissed', '1');
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-[50] pointer-events-none flex flex-col items-center justify-center bg-cyan-950/20 backdrop-blur-[2px] rounded-2xl border border-cyan-500/20"
                >
                    <div className="relative w-full h-full flex items-center justify-center">
                        {/* Fake Card Ghost Animation */}
                        <motion.div
                            animate={{
                                x: [-60, 60, -60],
                                y: [0, -10, 0],
                                rotate: [0, 2, 0]
                            }}
                            transition={{
                                duration: 3,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className="w-32 h-20 bg-cyan-500/20 border-2 border-cyan-400/40 rounded-xl shadow-[0_0_30px_rgba(34,211,238,0.3)] flex items-center justify-center backdrop-blur-md"
                        >
                            <div className="w-12 h-2 bg-white/20 rounded-full" />
                        </motion.div>

                        {/* Mouse Cursor Animation */}
                        <motion.div
                            animate={{
                                x: [-50, 70, -50],
                                y: [20, 10, 20],
                                scale: [1, 0.9, 1]
                            }}
                            transition={{
                                duration: 3,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className="absolute"
                        >
                            <MousePointer2 className="w-8 h-8 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
                        </motion.div>

                        {/* Instructions */}
                        <div className="absolute bottom-6 flex flex-col items-center gap-2">
                             <p className="text-xs font-black text-cyan-400 uppercase tracking-[0.3em] drop-shadow-md">Drag to Reorder</p>
                             <button
                                onClick={handleDismiss}
                                className="pointer-events-auto bg-white/10 hover:bg-white/20 border border-white/20 rounded-full p-2 transition-all group"
                             >
                                <X className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
                             </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
