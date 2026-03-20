import { NextResponse } from "next/server";
import { fetchWithRetry, handleApiError } from "@/lib/fetchWithRetry";

export async function GET() {
    try {
        const r = await fetchWithRetry("http://127.0.0.1:8000/api/analytics/market-phases", {
            cache: 'no-store',
            timeoutMs: 5000,
            retries: 3
        } as any);

        const raw = await r.text();

        if (!r.ok) {
            return NextResponse.json(
                {
                    error: "UPSTREAM_ERROR",
                    status: r.status,
                    detail: raw || "Internal Server Error from Backend"
                },
                { status: r.status }
            );
        }

        return new NextResponse(raw, {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e: any) {
        return handleApiError(e);
    }
}
