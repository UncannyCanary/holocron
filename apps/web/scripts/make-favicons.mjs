// Makes the PNG and ICO favicons from public/favicon.svg. Safari does not
// read SVG favicons and older browsers ask for favicon.ico, so the same logo
// is written out as bitmaps once and committed beside the SVG.
// Run from apps/web: node scripts/make-favicons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// sharp is a dependency of the API, not the web app. Borrow it from there.
const sharp = require('../../api/node_modules/sharp');

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(`${publicDir}favicon.svg`);

async function png(size) {
  return sharp(svg, { density: (72 * size) / 32 })
    .resize(size, size)
    .png()
    .toBuffer();
}

// An ICO file that wraps one PNG image, which every current browser reads.
function ico(pngBuffer, size) {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size === 256 ? 0 : size, 6); // width
  header.writeUInt8(size === 256 ? 0 : size, 7); // height
  header.writeUInt8(0, 8); // colours in palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(pngBuffer.length, 14); // image size
  header.writeUInt32LE(header.length, 18); // image offset
  return Buffer.concat([header, pngBuffer]);
}

const [png32, png180, png512] = await Promise.all([png(32), png(180), png(512)]);
writeFileSync(`${publicDir}favicon-32.png`, png32);
writeFileSync(`${publicDir}apple-touch-icon.png`, png180);
writeFileSync(`${publicDir}icon-512.png`, png512);
writeFileSync(`${publicDir}favicon.ico`, ico(png32, 32));
console.log('wrote favicon-32.png, apple-touch-icon.png, icon-512.png, favicon.ico');
