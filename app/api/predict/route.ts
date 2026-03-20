import { NextResponse } from "next/server";
import { fetchWithRetry, handleApiError } from "@/lib/fetchWithRetry";

export async function POST(req: Request) {
  // Add simple health check logic or rely on fetchWithRetry's robust handling
  try {
    const body = await req.json();

    // Use enhanced fetch with retry logic
    // 8s timeout, 4 retries, exponential backoff
    const r = await fetchWithRetry("http://127.0.0.1:8000/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 8000,
      retries: 4,
    } as any); // Type assertion needed if fetchWithRetry options overlap with RequestInit

    const raw = await r.text();
    const contentType = r.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!r.ok) {
      // Handle upstream errors (500, 400, etc.)
      // Wrap them in JSON to prevent frontend parsing errors
      return NextResponse.json(
        {
          error: "UPSTREAM_ERROR",
          status: r.status,
          detail: raw || "Internal Server Error from Backend",
        },
        { status: r.status }
      );
    }

    if (!isJson) {
      // 200 OK but not JSON (unexpected proxy/server response)
      return NextResponse.json(
        {
          error: "NON_JSON_RESPONSE",
          status: 502,
          detail: raw.slice(0, 500),
        },
        { status: 502 }
      );
    }

    // Success
    return new NextResponse(raw, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    // Handle network errors, timeouts, etc.
    return handleApiError(error);
  }
}
