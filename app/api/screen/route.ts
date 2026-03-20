import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const backendUrl = new URL('http://127.0.0.1:8000/api/screen');

        // Pass along all query params
        searchParams.forEach((value, key) => {
            backendUrl.searchParams.append(key, value);
        });

        const res = await fetch(backendUrl.toString(), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store'
        });

        if (!res.ok) {
            const text = await res.text();
            return NextResponse.json(
                { error: 'Backend error', detail: text },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Proxy Error /api/screen:', error);
        return NextResponse.json(
            { error: 'Backend connection failed', detail: error.message },
            { status: 500 }
        );
    }
}
