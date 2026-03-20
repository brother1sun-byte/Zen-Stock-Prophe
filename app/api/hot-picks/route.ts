import { NextResponse } from "next/server";
import { fetchWithRetry, handleApiError } from "@/lib/fetchWithRetry";

export async function GET() {
    try {
        const r = await fetchWithRetry("http://127.0.0.1:8000/api/hot-picks", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: 'no-store',
            timeoutMs: 10000,
            retries: 3
        } as any);

        const raw = await r.text();

        if (!r.ok) {
            return NextResponse.json(
                {
                    error: "UPSTREAM_ERROR",
                    status: r.status,
                    detail: raw || "Internal Server Error from Backend",
                },
                { status: r.status }
            );
        }

        const contentType = r.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return NextResponse.json(
                {
                    error: "NON_JSON_RESPONSE",
                    status: 502,
                    detail: raw.slice(0, 500),
                },
                { status: 502 }
            );
        }

        return new NextResponse(raw, {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        return handleApiError(error);
    }
}
