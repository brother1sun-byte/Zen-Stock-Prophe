const sharp = require('sharp');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'app_icon.png');
const DEST = path.join(__dirname, '..', 'app_icon_master.png');

async function prepareMaster() {
    console.log('--- Preparing Transparent Master Icon ---');

    const size = 1024;
    const rect = Buffer.from(
        `<svg><rect x="0" y="0" width="${size}" height="${size}" rx="${size * 0.22}" ry="${size * 0.22}" /></svg>`
    );

    await sharp(SOURCE)
        .resize(size, size)
        .composite([{
            input: rect,
            blend: 'dest-in'
        }])
        .toFile(DEST);

    console.log(`Success: ${DEST}`);
}

prepareMaster().catch(console.error);
