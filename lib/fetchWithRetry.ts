import { NextResponse } from "next/server";

interface FetchOptions extends RequestInit {
    timeoutMs?: number;
    retries?: number;
    backoffFactor?: number;
}

export class UpstreamError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = "UpstreamError";
    }
}

/**
 * Robust fetch with timeout and exponential backoff retry
 */
export async function fetchWithRetry(url: string, options: FetchOptions = {}) {
    const {
        timeoutMs = 8000,
        retries = 4,
        backoffFactor = 500, // 500ms initial wait
        ...fetchOptions
    } = options;

    let attempt = 0;
    let lastError: any;

    while (attempt <= retries) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        try {
            console.log(`[FetchWithRetry] Attempt ${attempt + 1}/${retries + 1}: ${url}`);

            const res = await fetch(url, {
                ...fetchOptions,
                signal: controller.signal,
                cache: 'no-store', // Disable next.js cache for API calls
            });

            clearTimeout(id);
            return res;

        } catch (err: any) {
            clearTimeout(id);
            lastError = err;

            const isAbort = err.name === 'AbortError';
            const isNetworkError = err.cause?.code === 'ECONNREFUSED' || err.message.includes('fetch failed');

            console.warn(`[FetchWithRetry] Failed attempt ${attempt + 1}/${retries + 1}: ${err.message}`);

            // Don't retry if it's not a network/timeout error (unless we want to be very aggressive)
            if (!isAbort && !isNetworkError) {
                throw err;
            }

            if (attempt === retries) break;

            // Exponential backoff
            const delay = backoffFactor * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            attempt++;
        }
    }

    // All retries failed
    console.error(`[FetchWithRetry] All retries failed for ${url}`);
    throw lastError;
}

/**
 * Standardized error response helper
 */
export function handleApiError(error: any) {
    console.error("[API Error Handler]", error);

    // Connection refused / Network error -> 503 Service Unavailable
    if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('fetch failed')) {
        return NextResponse.json(
            {
                error: "UPSTREAM_UNREACHABLE",
                detail: "Backend service is not reachable. It might be starting up.",
                status: 503
            },
            { status: 503 }
        );
    }

    // Timeout -> 504 Gateway Timeout
    if (error.name === 'AbortError') {
        return NextResponse.json(
            {
                error: "UPSTREAM_TIMEOUT",
                detail: "Backend service timed out.",
                status: 504
            },
            { status: 504 }
        );
    }

    // Upstream returned non-200 (handled via UpstreamError if used)
    if (error instanceof UpstreamError) {
        return NextResponse.json(
            {
                error: "UPSTREAM_ERROR",
                detail: error.message,
                status: error.status
            },
            { status: error.status }
        );
    }

    // Generic 500
    return NextResponse.json(
        {
            error: "INTERNAL_SERVER_ERROR",
            detail: error.message || "Unknown error"
        },
        { status: 500 }
    );
}
