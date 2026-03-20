import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const backendUrl = new URL('http://127.0.0.1:8000/api/scan_zen');

        // Pass along query params if any
        searchParams.forEach((value, key) => {
            backendUrl.searchParams.append(key, value);
        });

        const res = await fetch(backendUrl.toString(), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-store'
        });

        if (!res.ok) {
            throw new Error(`Backend error: ${res.status}`);
        }

        const data = await res.json();
        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Proxy Error /api/scan_zen:', error);
        return NextResponse.json(
            { error: 'Backend connection failed', detail: error.message },
            { status: 500 }
        );
    }
}
