const http = require('http');

const endpoints = [
    { url: '/api/predict', method: 'POST', body: { ticker: '7203', period: '1y', capital: 500000 } },
    { url: '/api/analytics/reasons', method: 'GET' },
    { url: '/api/analytics/market-phases', method: 'GET' },
    { url: '/api/analytics/trends', method: 'GET' },
    { url: '/api/ops/metrics/latest', method: 'GET' },
    { url: '/api/ops/metrics/history', method: 'GET' },
    { url: '/api/hot-picks', method: 'GET' }
];

async function check(e) {
    return new Promise((resolve) => {
        const bodyStr = e.body ? JSON.stringify(e.body) : '';
        const options = {
            hostname: '127.0.0.1',
            port: 3000,
            path: e.url,
            method: e.method,
            headers: {
                'Content-Type': 'application/json',
                ...(e.body ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                const isJson = (res.headers['content-type'] || '').includes('application/json');
                let parsed = null;
                if (isJson) {
                    try { parsed = JSON.parse(body); } catch (ex) { }
                }
                resolve({
                    url: e.url,
                    status: res.statusCode,
                    type: res.headers['content-type'],
                    isJson,
                    hasData: !!parsed,
                    snippet: body.slice(0, 50)
                });
            });
        });

        req.on('error', (err) => resolve({ url: e.url, error: err.message }));
        if (e.body) req.write(bodyStr);
        req.end();
    });
}

async function run() {
    console.log('--- PHASE 12 API DIAGNOSTIC ---');
    for (const e of endpoints) {
        const res = await check(e);
        const marker = (res.status === 200 && res.isJson) ? '[OK]' : '[NG]';
        console.log(`${marker} ${res.url.padEnd(30)} | Status: ${res.status} | Type: ${res.type}`);
        if (res.error) console.log(`      ERROR: ${res.error}`);
    }
}

run();
