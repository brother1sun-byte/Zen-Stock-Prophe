import { PredictionResponse, ScenarioRuleSet, ScenarioEvaluationResult, MacroSnapshot, DiaryEntry, ScenarioScore, PostDiaryRequest, GetDiaryResponse, AggregateScoringResponse, RuleScoringResponse, PortfolioResponse, PortfolioRequest, WeeklyReviewResponse } from '../types';

const API_BASE = 'http://localhost:8000'; // Or relative '/api' if proxied, but sticking to known pattern

export const getScenario = async (ticker: string, asof: string): Promise<ScenarioRuleSet | null> => {
    try {
        const res = await fetch(`${API_BASE}/api/scenario?ticker=${ticker}&asof=${asof}`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.error("Failed to fetch scenario", e);
        return null;
    }
};

export const saveScenario = async (data: ScenarioRuleSet): Promise<boolean> => {
    try {
        const res = await fetch(`${API_BASE}/api/scenario`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) {
        console.error("Failed to save scenario", e);
        return false;
    }
};

export const evaluateScenario = async (
    ticker: string,
    asof: string,
    current_price: number,
    open_price: number,
    prev_close: number,
    rules?: ScenarioRuleSet,
    market_regime?: string
): Promise<ScenarioEvaluationResult | null> => {
    try {
        const body = {
            ticker,
            asof,
            current_price,
            open_price,
            prev_close,
            market_regime,
            rules
        };
        const res = await fetch(`${API_BASE}/api/scenario/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.error("Failed to evaluate scenario", e);
        return null;
    }
};

// Phase 3.2 Macro
export async function getMacroSnapshot(asof?: string): Promise<MacroSnapshot | null> {
    try {
        const url = asof ? `${API_BASE}/api/macro_snapshot?asof=${asof}` : `${API_BASE}/api/macro_snapshot`;
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch macro snapshot:', error);
        return null;
    }
}

// --- Phase 4 API ---
export async function saveDiaryEntry(entry: PostDiaryRequest): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/api/diary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        });
        return response.ok;
    } catch (error) {
        console.error('Failed to save diary entry:', error);
        return false;
    }
}

export async function getDiaryEntries(ticker?: string, fromDate?: string, toDate?: string, limit: number = 50): Promise<DiaryEntry[]> {
    try {
        const params = new URLSearchParams();
        if (ticker) params.append('ticker', ticker);
        if (fromDate) params.append('from', fromDate);
        if (toDate) params.append('to', toDate);
        params.append('limit', limit.toString());

        const response = await fetch(`${API_BASE}/api/diary?${params.toString()}`);
        if (!response.ok) return [];
        const data: GetDiaryResponse = await response.json();
        return data.items || [];
    } catch (error) {
        console.error('Failed to fetch diary entries:', error);
        return [];
    }
}

/**
 * Fetch diary entries (alias for convenience matching user request)
 */
export async function fetchDiaryEntries(ticker: string, limit: number = 10): Promise<DiaryEntry[]> {
    return getDiaryEntries(ticker, undefined, undefined, limit);
}

export async function getScenarioScore(ticker: string, asof?: string, period: string = 'weekly'): Promise<ScenarioScore | null> {
    try {
        const url = asof
            ? `${API_BASE}/api/scoring?ticker=${ticker}&period=${period}&asof=${asof}`
            : `${API_BASE}/api/scoring?ticker=${ticker}&period=${period}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch scenario score:', error);
        return null;
    }
}

export async function getAggregateScoring(tickers: string, asof?: string, period: string = 'weekly'): Promise<AggregateScoringResponse | null> {
    try {
        const url = asof
            ? `${API_BASE}/api/scoring/aggregate?tickers=${encodeURIComponent(tickers)}&period=${period}&asof=${asof}`
            : `${API_BASE}/api/scoring/aggregate?tickers=${encodeURIComponent(tickers)}&period=${period}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch aggregate scoring:', error);
        return null;
    }
}

export async function getRuleScoring(tickers: string, asof?: string, period: string = 'weekly'): Promise<RuleScoringResponse | null> {
    try {
        const url = asof
            ? `${API_BASE}/api/scoring/by_rule?tickers=${encodeURIComponent(tickers)}&period=${period}&asof=${asof}`
            : `${API_BASE}/api/scoring/by_rule?tickers=${encodeURIComponent(tickers)}&period=${period}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch rule scoring:', error);
        return null;
    }
}


export async function fetchPortfolio(): Promise<PortfolioResponse | null> {
    try {
        const response = await fetch(`${API_BASE}/api/portfolio`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch portfolio:', error);
        return null;
    }
}

export async function savePortfolio(tickers: string[]): Promise<boolean> {
    try {
        const body: PortfolioRequest = { tickers };
        const response = await fetch(`${API_BASE}/api/portfolio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return response.ok;
    } catch (error) {
        console.error('Failed to save portfolio:', error);
        return false;
    }
}

export async function fetchWeeklyReview(tickers: string, fromDate: string, toDate: string): Promise<WeeklyReviewResponse | null> {
    try {
        const params = new URLSearchParams({
            from: fromDate,
            to: toDate,
        });
        if (tickers) params.append('tickers', tickers);

        const response = await fetch(`${API_BASE}/api/review?${params.toString()}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch weekly review:', error);
        return null;
    }
}
