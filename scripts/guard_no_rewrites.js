const fs = require('fs');
const path = require('path');

const configFile = 'next.config.ts'; // Also check .js if exists
const configFileJs = 'next.config.js';

function checkRewrites(file) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) return true;

    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('rewrites')) {
        console.error(`[ERROR] "rewrites" detected in ${file}.`);
        console.error('        Use Route Handlers (app/api/*) instead of rewrites to avoid routing conflicts.');
        return false;
    }
    return true;
}

console.log('--- Guard: No Next.js Rewrites ---');
const ok1 = checkRewrites(configFile);
const ok2 = checkRewrites(configFileJs);

if (!ok1 || !ok2) {
    process.exit(1);
} else {
    console.log('PASSED: No rewrites found.');
}
