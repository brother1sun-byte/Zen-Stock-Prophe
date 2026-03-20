const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
// png-to-ico exports the function as .default in this environment
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const SOURCE = path.join(__dirname, '..', 'assets', 'app_icon_source.png');
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
const MASTER_ICON = path.join(ICONS_DIR, 'app_icon_master.png');

if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
}

async function run() {
    console.log('--- ICON GENERATION START (FIXED IMPORT) ---');

    if (!fs.existsSync(SOURCE)) {
        console.error(`ERROR: Source not found at ${SOURCE}`);
        process.exit(1);
    }

    try {
        // 1. Master
        const masterSize = 1024;
        const radius = 220;
        const mask = Buffer.from(`<svg><rect x="0" y="0" width="${masterSize}" height="${masterSize}" rx="${radius}" ry="${radius}" /></svg>`);

        await sharp(SOURCE)
            .resize(masterSize, masterSize)
            .composite([{ input: mask, blend: 'dest-in' }])
            .toFile(MASTER_ICON);
        console.log('SUCCESS: Master Icon created.');

        // 2. PNGs
        const sizes = [16, 32, 48, 64, 128, 256, 512];
        for (const size of sizes) {
            await sharp(MASTER_ICON)
                .ensureAlpha()
                .resize(size, size, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .toFile(path.join(ICONS_DIR, `icon-${size}.png`));
        }
        console.log('SUCCESS: All PNGs created.');

        // 3. ICO
        const icoSizes = [16, 32, 48, 64, 128, 256];
        const icoBuffers = [];
        for (const size of icoSizes) {
            const b = await sharp(MASTER_ICON).resize(size, size).png().toBuffer();
            icoBuffers.push(b);
        }

        console.log('Calling pngToIco...');
        const ico = await pngToIco(icoBuffers);
        if (ico && ico.length > 0) {
            fs.writeFileSync(path.join(ICONS_DIR, 'app_v802.ico'), ico);
            console.log(`SUCCESS: app_v802.ico created (${ico.length} bytes).`);
        } else {
            console.error('ERROR: pngToIco returned empty buffer.');
        }

        // 4. Cleanup/Others
        await sharp(MASTER_ICON).resize(32, 32).toFile(path.join(__dirname, '..', 'public', 'favicon.ico'));
        console.log('SUCCESS: favicon.ico updated.');

        console.log('--- ICON GENERATION SUCCESS !!! ---');
    } catch (err) {
        console.error('CRITICAL ERROR:', err);
        process.exit(1);
    }
}

run();
