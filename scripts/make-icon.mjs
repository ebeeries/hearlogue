import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/**
 * Generates the application icon.
 *
 * The mark is drawn in code rather than checked in as a binary so it stays in
 * step with the palette and can be regenerated at any size. Output is a PNG
 * embedded in an ICO container, which is what Windows and Electron Forge want.
 *
 * Run with: node scripts/make-icon.mjs
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets');

const INK = [11, 13, 15];
const BRASS = [214, 176, 106];
const BRASS_DIM = [140, 112, 64];

/** Signed-distance helpers, so the mark is antialiased rather than jagged. */
function coverage(distance) {
  // 1 inside, 0 outside, smooth across a one-pixel band.
  return Math.max(0, Math.min(1, 0.5 - distance));
}

function roundedBoxDistance(x, y, halfW, halfH, radius) {
  const dx = Math.abs(x) - (halfW - radius);
  const dy = Math.abs(y) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - radius;
}

function blend(target, index, color, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  target[index] = Math.round(target[index] * (1 - a) + color[0] * a);
  target[index + 1] = Math.round(target[index + 1] * (1 - a) + color[1] * a);
  target[index + 2] = Math.round(target[index + 2] * (1 - a) + color[2] * a);
  target[index + 3] = Math.max(target[index + 3], Math.round(255 * a));
}

/**
 * Draws the HEARLOGUE mark: a rounded plate with a brass ring and an upright
 * bar, reading as both an "H" and a record on a spindle.
 */
function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const c = size / 2;
  const scale = size / 256;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const px = x + 0.5 - c;
      const py = y + 0.5 - c;

      // Plate
      const plate = roundedBoxDistance(px, py, c - 2 * scale, c - 2 * scale, 56 * scale);
      const plateAlpha = coverage(plate);
      if (plateAlpha <= 0) continue;

      // A soft vertical gradient so the plate is not a flat slab.
      const t = (y / size) * 0.35;
      const base = [
        Math.round(INK[0] + 16 * (1 - t)),
        Math.round(INK[1] + 17 * (1 - t)),
        Math.round(INK[2] + 19 * (1 - t)),
      ];
      blend(pixels, index, base, plateAlpha);

      const radius = Math.hypot(px, py);

      // Outer ring
      const ringOuter = 88 * scale;
      const ringWidth = 7 * scale;
      const ringAlpha =
        coverage(Math.abs(radius - ringOuter) - ringWidth / 2) * plateAlpha * 0.9;
      blend(pixels, index, BRASS_DIM, ringAlpha);

      // Inner ring
      const innerRadius = 58 * scale;
      const innerAlpha =
        coverage(Math.abs(radius - innerRadius) - (3.5 * scale) / 2) * plateAlpha * 0.55;
      blend(pixels, index, BRASS_DIM, innerAlpha);

      // The two uprights and the crossbar of an H.
      const stemHalfW = 8 * scale;
      const stemHalfH = 46 * scale;
      const stemOffset = 27 * scale;
      const leftStem = roundedBoxDistance(px + stemOffset, py, stemHalfW, stemHalfH, 4 * scale);
      const rightStem = roundedBoxDistance(px - stemOffset, py, stemHalfW, stemHalfH, 4 * scale);
      const bar = roundedBoxDistance(px, py, stemOffset + stemHalfW, 7.5 * scale, 3.5 * scale);
      const markAlpha =
        Math.max(coverage(leftStem), coverage(rightStem), coverage(bar)) * plateAlpha;
      blend(pixels, index, BRASS, markAlpha);

      // Spindle hole, punched back to the plate colour.
      const holeAlpha = coverage(radius - 5.5 * scale) * plateAlpha;
      if (holeAlpha > 0) blend(pixels, index, [8, 9, 10], holeAlpha);
    }
  }

  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(pixels, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO container holding PNG-compressed images, supported by Windows Vista+. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = 6 + directory.length;

  images.forEach((image, index) => {
    const entry = index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palette
    directory[entry + 3] = 0;
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32BE(0, entry + 8);
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, data: encodePng(drawIcon(size), size) }));

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(images));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), images[images.length - 1].data);

console.log(`Wrote assets/icon.ico (${sizes.join(', ')}) and assets/icon.png`);
