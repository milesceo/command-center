// Captures one full turn of the Home screen's spinning ASCII logo as an animated PNG (APNG).
// No ffmpeg or other download needed: frames are screenshots of the real UI, stitched in Node.
//   E2E_CHROMIUM=<chrome> E2E_OUT=../../docs/onboarding node e2e/logo-video.mjs
import { writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length);
  return out;
}

/** Splits a PNG file into its chunks. */
function parse(png) {
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

/** Builds an APNG from same-size PNG frames, `delayMs` apart, looping forever. */
function apng(frames, delayMs) {
  const parsed = frames.map(parse);
  const ihdr = parsed[0].find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const parts = [SIGNATURE, chunk('IHDR', ihdr)];
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4); // loop forever
  parts.push(chunk('acTL', actl));

  let seq = 0;
  parsed.forEach((chunks, index) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(width, 4);
    fctl.writeUInt32BE(height, 8);
    fctl.writeUInt32BE(0, 12);
    fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(delayMs, 20);
    fctl.writeUInt16BE(1000, 22);
    fctl.writeUInt8(0, 24); // dispose: none
    fctl.writeUInt8(0, 25); // blend: source
    parts.push(chunk('fcTL', fctl));
    const pixels = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
    if (index === 0) {
      parts.push(chunk('IDAT', pixels));
    } else {
      const seqBytes = Buffer.alloc(4);
      seqBytes.writeUInt32BE(seq++, 0);
      parts.push(chunk('fdAT', Buffer.concat([seqBytes, pixels])));
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const h = await startHarness({ real: false });
const app = await h.launch({
  viewport: { width: 1100, height: 520 },
  theme: 'dark',
  layout: 'classic',
  home: true,
});
const logo = app.page.getByTestId('ascii-logo');
await logo.waitFor();
await app.page.waitForTimeout(500);

// One revolution is 9 s; Balanced runs the logo at 12 fps. Sample every 250 ms for 9 s.
const frames = [];
const box = await logo.boundingBox();
const clip = {
  x: Math.max(0, box.x - 8),
  y: Math.max(0, box.y - 8),
  width: box.width + 16,
  height: box.height + 16,
};
for (let i = 0; i < 36; i++) {
  frames.push(await app.page.screenshot({ clip }));
  await app.page.waitForTimeout(250);
}
writeFileSync(join(outDir, 'ascii-logo.png'), apng(frames, 250));
console.log(`wrote ascii-logo.png (${frames.length} frames, ${clip.width}x${clip.height})`);
await app.close();
await h.stop();
