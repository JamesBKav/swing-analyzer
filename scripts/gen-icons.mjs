// Generates the PWA icons as PNGs with no dependencies: shapes are drawn
// with supersampled distance tests and encoded with node:zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const BG = [16, 22, 30];
const GREEN = [61, 220, 132];
const BALL = [244, 247, 250];
const DIMPLE = [196, 204, 212];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Returns [r,g,b,a] for a point in unit space.
function sample(x, y, { scale, rounded }) {
  // Background (optionally rounded square).
  if (rounded) {
    const r = 0.2, dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
  }
  let col = BG;
  // Content in a scaled space around the centre (for maskable safe zone).
  const u = (x - 0.5) / scale + 0.5, v = (y - 0.5) / scale + 0.5;
  // Swing arc: ring over the top, fading in from the left.
  const cx = 0.5, cy = 0.47, R = 0.28, half = 0.03;
  const d = Math.hypot(u - cx, v - cy);
  if (Math.abs(d - R) < half) {
    let a = Math.atan2(cy - v, u - cx); // y up, radians
    // Arc spans from 240deg (lower-left) counter-clockwise... over the top to -60deg (lower-right).
    let deg = (a * 180) / Math.PI; // -180..180
    if (deg < -90) deg += 360; // now -90..270
    if (deg > -60 && deg < 240) {
      const t = (240 - deg) / 300; // 0 at left start, 1 at right end
      const alpha = 0.15 + 0.85 * t;
      col = col.map((c, i) => c + (GREEN[i] - c) * alpha);
    }
  }
  // Ball at the bottom of the arc.
  const bx = 0.5, by = 0.75, br = 0.095;
  if (Math.hypot(u - bx, v - by) < br) {
    col = BALL;
    for (const [ox, oy] of [[-0.035, -0.03], [0.02, -0.04], [0.04, 0.01], [-0.01, 0.0], [-0.04, 0.03], [0.015, 0.045]]) {
      if (Math.hypot(u - bx - ox, v - by - oy) < 0.013) col = DIMPLE;
    }
  }
  return [...col, 255];
}

function render(size, opts) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const s = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts);
        acc[0] += s[0] * s[3]; acc[1] += s[1] * s[3]; acc[2] += s[2] * s[3]; acc[3] += s[3];
      }
      const i = (py * size + px) * 4;
      const a = acc[3];
      buf[i] = a ? Math.round(acc[0] / a) : 0;
      buf[i + 1] = a ? Math.round(acc[1] / a) : 0;
      buf[i + 2] = a ? Math.round(acc[2] / a) : 0;
      buf[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return png(size, buf);
}

const icons = [
  ['icon-192.png', 192, { scale: 1, rounded: true }],
  ['icon-512.png', 512, { scale: 1, rounded: true }],
  ['icon-maskable-512.png', 512, { scale: 0.78, rounded: false }],
  ['apple-touch-icon.png', 180, { scale: 0.92, rounded: false }],
];
for (const [name, size, opts] of icons) {
  writeFileSync(join(out, name), render(size, opts));
  console.log('wrote', name);
}
