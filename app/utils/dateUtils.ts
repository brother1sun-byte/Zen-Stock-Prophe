
import { PredictionResponse } from '../types';

/**
 * JPX Holidays (Simple static list for Phase 2.1)
 * In future this should be fetched or expanded.
 */
const HOLIDAYS = [
    '2024-01-01', '2024-01-02', '2024-01-03', '2024-01-08', '2024-02-11', '2024-02-12', '2024-02-23', // ...etc (sample for structure)
    // 2025
    '2025-01-01', '2025-01-13', '2025-02-11', '2025-02-23', '2025-02-24', '2025-03-20',
    // 2026 (Project Year)
    '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-21',
];

export const isJpxHoliday = (date: Date): boolean => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${d}`;
    return HOLIDAYS.includes(ymd);
};

/**
 * Get the latest trading date (asof) from the prediction data.
 * Priority:
 * 1. last_sync (Explicit timestamp from backend)
 * 2. Last valid point in chart_data (Actual market data)
 * 3. Fallback: Calculation based on "today" but adjusted for weekends/holidays (Client-side fail-safe)
 */
export const getLatestTradingDate = (data: PredictionResponse): string => {
    // 1. Backend Source of Truth
    if (data.last_sync) {
        return data.last_sync.split(' ')[0]; // Returns YYYY-MM-DD
    }

    // 2. Data Evidence
    if (data.chart_data && data.chart_data.length > 0) {
        // Search backwards for a valid date string
        for (let i = data.chart_data.length - 1; i >= 0; i--) {
            const point = data.chart_data[i];
            // Format check: usually "MM/DD" or "YYYY/MM/DD" in chart_data depending on timeframe
            if (point.name && point.name.includes('/')) {
                // If it's just MM/DD, prepend current year (or infer closest year)
                // For safety in this app context, assume current year if missing
                const parts = point.name.split('/');
                if (parts.length === 2) {
                    const nowYear = new Date().getFullYear();
                    return `${nowYear}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
                } else if (parts.length === 3) {
                    // YYYY/MM/DD
                    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                }
            }
        }
    }

    // 3. Fallback (Logic Hardening)
    // Instead of raw client time, we calculate the "Most Likely Last Session Close"
    const now = new Date();
    // Use JST for calculation
    const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    let target = new Date(jstNow);

    // If it's Saturday (6) or Sunday (0), roll back to Friday
    // If it's Monday (1) before 09:00, roll back to Friday
    const day = target.getDay();
    const hour = target.getHours();

    if (day === 0) { // Sun
        target.setDate(target.getDate() - 2);
    } else if (day === 6) { // Sat
        target.setDate(target.getDate() - 1);
    } else if (day === 1 && hour < 9) { // Mon Morning
        target.setDate(target.getDate() - 3);
    }
    // If it's Tu-Fri before 09:00, roll back 1 day
    else if (day >= 2 && day <= 5 && hour < 9) {
        target.setDate(target.getDate() - 1);
    }

    // Holiday Check (Simple loop to rollback if lands on holiday)
    // Max 5 days rollback to avoid infinite loop
    for (let i = 0; i < 5; i++) {
        if (isJpxHoliday(target)) {
            target.setDate(target.getDate() - 1);
        } else {
            break;
        }
    }

    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, '0');
    const d = String(target.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

/**
 * Check if the market is currently open in JST.
 * Used for UI default state (Open/Close toggles).
 */
export const isJstMarketOpen = (): boolean => {
    const now = new Date();
    const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const day = jstNow.getDay();
    const hours = jstNow.getHours();
    const minutes = jstNow.getMinutes();
    const timeValue = hours * 100 + minutes;

    // Weekend
    if (day === 0 || day === 6) return false;

    // Holiday
    if (isJpxHoliday(jstNow)) return false;

    // 前場: 9:00-11:30, 後場: 12:30-15:00
    const isMorning = timeValue >= 900 && timeValue <= 1130;
    const isAfternoon = timeValue >= 1230 && timeValue <= 1500;

    return isMorning || isAfternoon;
};
