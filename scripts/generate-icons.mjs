// Generates public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png
// procedurally, matching the split-flap-board design in public/icon.svg.
// Uses ONLY Node built-ins: draws into an RGBA buffer by hand, deflates with node:zlib,
// and hand-writes PNG chunks (IHDR/IDAT/IEND) with CRC-32 checksums. No npm dependencies.

import { deflateSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// ---- Colors (matches public/icon.svg) ----
const BG = [0x1a, 0x1a, 0x1a];
const AMBER = [0xe8, 0xa3, 0x3d];
const DARK_TILE = [0x3a, 0x2f, 0x22];
const HINGE = [0x1a, 0x1a, 0x1a];

// ---- CRC-32 ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ---- Minimal PNG encoder (8-bit RGBA, no interlace, no filtering per scanline) ----
function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type 6 = RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdr = chunk("IHDR", ihdrData);

  // Raw scanlines, each prefixed with filter type 0 (none)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: none
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }

  const compressed = deflateSync(raw, { level: 9 });
  const idat = chunk("IDAT", compressed);
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ---- Procedural drawing ----
function setPixel(buf, width, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function fillRoundedRect(buf, width, height, x0, y0, w, h, radius, color) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
      // distance from nearest corner if inside a corner box
      let inside = true;
      const cornerRadius = radius;
      const nearLeft = x < x0 + cornerRadius;
      const nearRight = x > x1 - cornerRadius;
      const nearTop = y < y0 + cornerRadius;
      const nearBottom = y > y1 - cornerRadius;
      if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
        const cx = nearLeft ? x0 + cornerRadius : x1 - cornerRadius;
        const cy = nearTop ? y0 + cornerRadius : y1 - cornerRadius;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > cornerRadius * cornerRadius) inside = false;
      }
      if (inside) setPixel(buf, width, x, y, color);
    }
  }
}

// Draws the split-flap-board icon into a size x size RGBA buffer.
function drawIcon(size, { rounded }) {
  const buf = Buffer.alloc(size * size * 4);

  // Background
  const bgRadius = rounded ? size * 0.1875 : 0; // ~9/48
  if (rounded) {
    fillRoundedRect(buf, size, size, 0, 0, size, size, bgRadius, BG);
  } else {
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = BG[0];
      buf[i + 1] = BG[1];
      buf[i + 2] = BG[2];
      buf[i + 3] = 255;
    }
  }

  // Tile grid, coordinates scaled from the 48x48 icon.svg design.
  const scale = size / 48;
  const tiles = [
    { x: 5, y: 5, color: AMBER },
    { x: 18.5, y: 5, color: DARK_TILE },
    { x: 32, y: 5, color: AMBER },
    { x: 11.5, y: 18.5, color: DARK_TILE },
    { x: 25.5, y: 18.5, color: DARK_TILE },
    { x: 18.5, y: 32, color: AMBER },
  ];
  const tileSize = 11 * scale;
  const tileRadius = 1.5 * scale;
  const hingeThickness = Math.max(1, Math.round(0.9 * scale));

  for (const t of tiles) {
    const tx = t.x * scale;
    const ty = t.y * scale;
    fillRoundedRect(buf, size, size, tx, ty, tileSize, tileSize, tileRadius, t.color);
    // Hinge line across the middle of the tile
    const hingeY = Math.round(ty + tileSize / 2 - hingeThickness / 2);
    for (let dy = 0; dy < hingeThickness; dy++) {
      for (let x = Math.round(tx); x < Math.round(tx + tileSize); x++) {
        setPixel(buf, size, x, hingeY + dy, HINGE);
      }
    }
  }

  return buf;
}

function verifyPng(filePath, expectedWidth, expectedHeight) {
  const data = readFileSync(filePath);
  const magic = data.subarray(0, 8);
  const expectedMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!magic.equals(expectedMagic)) {
    throw new Error(`${filePath}: bad PNG magic bytes`);
  }
  const ihdrType = data.subarray(12, 16).toString("ascii");
  if (ihdrType !== "IHDR") {
    throw new Error(`${filePath}: expected IHDR chunk, got ${ihdrType}`);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `${filePath}: expected ${expectedWidth}x${expectedHeight}, got ${width}x${height}`
    );
  }
  console.log(`OK  ${filePath}  (${width}x${height}, ${data.length} bytes)`);
}

function generate(name, size, rounded) {
  const buf = drawIcon(size, { rounded });
  const png = encodePng(size, size, buf);
  const outPath = path.join(PUBLIC_DIR, name);
  writeFileSync(outPath, png);
  verifyPng(outPath, size, size);
}

generate("icon-192.png", 192, true);
generate("icon-512.png", 512, true);
generate("apple-touch-icon.png", 180, false);

console.log("All icons generated and verified.");
