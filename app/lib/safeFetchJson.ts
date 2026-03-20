/**
 * Zero Issues Protocol: Text-First Fetch Helper
 * 全てのAPI通信はこのヘルパーを経由し、非JSONレスポンスによるクラッシュを防止する。
 */

export interface SafeFetchResponse<T> {
    ok: boolean;
    status: number;
    data?: T;
    error?: {
        message: string;
        raw: string;
    };
}

export async function safeFetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<SafeFetchResponse<T>> {
    try {
        const response = await fetch(input, init);
        const contentType = response.headers.get("content-type") || "";
        const rawBody = await response.text(); // Text-First: 常にテキストとして一度だけ読み込む

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                error: {
                    message: `Server Error (${response.status})`,
                    raw: rawBody
                }
            };
        }

        if (!contentType.includes("application/json")) {
            return {
                ok: false,
                status: response.status,
                error: {
                    message: `Invalid Content-Type: ${contentType}`,
                    raw: rawBody
                }
            };
        }

        try {
            const data = JSON.parse(rawBody) as T;
            return {
                ok: true,
                status: response.status,
                data
            };
        } catch (e) {
            return {
                ok: false,
                status: response.status,
                error: {
                    message: "JSON Parse Error",
                    raw: rawBody
                }
            };
        }
    } catch (e: any) {
        return {
            ok: false,
            status: 0,
            error: {
                message: e.message || "Network Error",
                raw: ""
            }
        };
    }
}
