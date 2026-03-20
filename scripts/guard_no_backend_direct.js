const fs = require('fs');
const path = require('path');

const targetDirs = ['app', 'components', 'hooks', 'lib'];
const forbiddenPatterns = [
    /:8000/,
    /localhost:8000/,
    /127\.0\.0\.1:8000/
];

const allowList = [
    'app\\api\\',
    'app/api/'
];

function checkFile(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    if (allowList.some(p => normalizedPath.includes(p.replace(/\\/g, '/').toLowerCase()))) {
        return true;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
            console.error(`[ERROR] Direct backend access found in: ${filePath}`);
            console.error(`        Pattern: ${pattern}`);
            return false;
        }
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

console.log('--- Guard: No Backend Direct Access ---');
let allOk = true;
targetDirs.forEach(dir => {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath)) {
        if (!walkDir(dirPath)) allOk = false;
    }
});

if (!allOk) {
    console.error('FAILED: Direct backend access detected. Use /api/* Route Handlers instead.');
    process.exit(1);
} else {
    console.log('PASSED: No direct backend access found.');
}
