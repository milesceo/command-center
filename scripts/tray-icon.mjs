// Generates the macOS menu-bar ("template") tray icon: the app icon's `>_` prompt in black on a
// transparent background. macOS uses only the alpha channel of a template image and tints it for
// the light or dark menu bar, so the glyph is drawn as coverage, supersampled for smooth edges.
//
//   node scripts/tray-icon.mjs   -> apps/desktop/src-tauri/icons/tray-template{,@2x}.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = 'apps/desktop/src-tauri/icons';
const SUPERSAMPLE = 8;

/** Distance from point p to the segment a-b. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Coverage of the glyph at a point in a unit square (0..1 on both axes, y down). */
function inside(x, y) {
  const stroke = 0.065; // half the line width (close to the system glyphs' weight at menu-bar size)
  // The chevron `>`.
  const chevron =
    segmentDistance(x, y, 0.16, 0.22, 0.48, 0.5) <= stroke ||
    segmentDistance(x, y, 0.48, 0.5, 0.16, 0.78) <= stroke;
  // The underscore `_`, a rounded bar.
  const bar = segmentDistance(x, y, 0.58, 0.76, 0.84, 0.76) <= stroke;
  return chevron || bar;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (inside(x, y)) hits++;
        }
      }
      const i = (py * size + px) * 4;
      rgba[i + 3] = Math.round((hits / SUPERSAMPLE ** 2) * 255); // black, alpha = coverage
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ['tray-template.png', 22],
  ['tray-template@2x.png', 44],
]) {
  writeFileSync(`${OUT}/${name}`, png(size, render(size)));
  console.log(`wrote ${OUT}/${name} (${size}x${size})`);
}
