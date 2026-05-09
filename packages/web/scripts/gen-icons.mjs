#!/usr/bin/env node
/**
 * Generate RCC PWA icons (192, 512, maskable-512) as PNGs.
 *
 * Pure Node — no sharp / canvas dependency. Draws a radial gradient (orange
 * → rose) over dark bg `#09090b`, then rasterises a bold letter "R" using a
 * hand-built bitmap font (so we don't need any font files).
 *
 * Outputs into packages/web/public/.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --- minimal PNG encoder (RGBA, no filter) -------------------------------
function crc32(buf) {
  let c;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(width, height, pixels) {
  // pixels: Uint8ClampedArray length = w*h*4
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  // filter byte 0 per scanline
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    pixels.subarray(y * width * 4, (y + 1) * width * 4);
    for (let x = 0; x < width * 4; x++) {
      raw[y * (1 + width * 4) + 1 + x] = pixels[y * width * 4 + x];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- colour helpers -------------------------------------------------------
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function lerp(a, b, t) { return a + (b - a) * t; }
function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

// --- letter R bitmap (scalable via stroke thickness) ----------------------
// We rasterise by sampling a vector-ish definition of the glyph at each
// pixel: strokes are rectangles / diagonals, bowl is a half-ring.
function isInsideR(u, v, stroke) {
  // u,v in [0,1], origin top-left of glyph box
  const s = stroke;
  // vertical left bar
  if (u >= 0.1 && u <= 0.1 + s && v >= 0.1 && v <= 0.9) return true;
  // top horizontal
  if (v >= 0.1 && v <= 0.1 + s && u >= 0.1 && u <= 0.7) return true;
  // middle horizontal (bowl close)
  if (v >= 0.48 && v <= 0.48 + s && u >= 0.1 && u <= 0.65) return true;
  // right bar (upper half)
  if (u >= 0.7 - s && u <= 0.7 && v >= 0.1 && v <= 0.5) return true;
  // bowl: quarter-ring from (0.7, 0.1) ~ (0.7, 0.5), approximated by arc test
  {
    const cx = 0.5, cy = 0.3;
    const r = 0.22, rin = r - s * 1.1;
    const dx = u - cx, dy = v - cy;
    const d2 = dx * dx + dy * dy;
    if (u >= 0.5 && d2 <= r * r && d2 >= rin * rin && v <= 0.52) return true;
  }
  // diagonal leg from (0.4, 0.5) to (0.72, 0.9)
  {
    const x0 = 0.4, y0 = 0.5, x1 = 0.72, y1 = 0.9;
    // distance from point (u,v) to segment
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / len2));
    const px = x0 + t * dx, py = y0 + t * dy;
    const d = Math.hypot(u - px, v - py);
    if (d <= s * 0.75 && v >= 0.5) return true;
  }
  return false;
}

function drawIcon(size, { maskable = false } = {}) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const bg = hexToRgb("#09090b");
  const c1 = hexToRgb("#fb923c"); // orange-400
  const c2 = hexToRgb("#f43f5e"); // rose-500
  const c3 = hexToRgb("#a855f7"); // violet-500 (subtle touch)

  // Maskable icons: everything of interest must live in the inner 80% circle.
  // For us this just means we leave a fuller padding around the glyph and let
  // the gradient fill the whole square.
  const glyphInset = maskable ? 0.28 : 0.18;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      // Background: dark with radial gradient highlight top-left
      const du = u - 0.35, dv = v - 0.35;
      const rd = Math.min(1, Math.hypot(du, dv) * 1.2);
      let col = mixRgb(mixRgb(c1, c2, rd), bg, 0.55 + rd * 0.35);
      // subtle violet tint bottom-right
      const bd = Math.min(1, Math.hypot(u - 0.9, v - 0.95) * 1.3);
      col = mixRgb(col, c3, (1 - bd) * 0.25);
      // Rounded-square mask for standard icon; full square for maskable
      let alpha = 255;
      if (!maskable) {
        const r = 0.18; // corner radius in [0..1]
        const dx = Math.max(r - u, 0, u - (1 - r));
        const dy = Math.max(r - v, 0, v - (1 - r));
        const d = Math.hypot(dx, dy);
        if (d > r) alpha = 0;
        else if (d > r - 0.01) alpha = Math.round(255 * (r - d) / 0.01);
      }

      // Glyph box
      const gu = (u - glyphInset) / (1 - 2 * glyphInset);
      const gv = (v - glyphInset) / (1 - 2 * glyphInset);
      let glyph = false;
      if (gu >= 0 && gu <= 1 && gv >= 0 && gv <= 1) {
        glyph = isInsideR(gu, gv, 0.18);
      }
      let out = col;
      if (glyph) {
        out = [255, 255, 255];
      }
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(out[0]);
      pixels[i + 1] = Math.round(out[1]);
      pixels[i + 2] = Math.round(out[2]);
      pixels[i + 3] = alpha;
    }
  }
  return encodePng(size, size, pixels);
}

// --- main ------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "public");
mkdirSync(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

for (const t of targets) {
  const png = drawIcon(t.size, { maskable: t.maskable });
  writeFileSync(resolve(outDir, t.file), png);
  console.log(`[gen-icons] wrote ${t.file} (${png.length} bytes)`);
}
