const fs = require('fs');
const path = require('path');

const targetDirs = ['app', 'hooks'];
const forbiddenPattern = /\.json\(\)/;
const allowList = [
    'app\\lib\\safeFetchJson.ts',
    'app\\api\\', // Allow within Route Handlers as they are the proxy
    'app\\page_original_v7.5.tsx' // Legacy backup
];

function checkFile(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    if (allowList.some(p => normalizedPath.includes(p.replace(/\\/g, '/').toLowerCase()))) {
        return true;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    if (forbiddenPattern.test(content)) {
        console.error(`[ERROR] Direct .json() call found in: ${filePath}`);
        console.error('        Use safeFetchJson helper instead to enforce Text-First protocol.');
        return false;
    }
    return true;
}

function walkDir(dir) {
    let ok = true;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!walkDir(fullPath)) ok = false;
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            if (!checkFile(fullPath)) ok = false;
        }
    }
    return ok;
}

console.log('--- Guard: Text-First Only (No direct .json() calls) ---');
let allOk = true;
targetDirs.forEach(dir => {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath)) {
        if (!walkDir(dirPath)) allOk = false;
    }
});

if (!allOk) {
    console.error('FAILED: Direct .json() calls detected. Enforce Text-First protocol via safeFetchJson.');
    process.exit(1);
} else {
    console.log('PASSED: Text-First protocol followed (no raw .json() calls in UI/hooks).');
}
