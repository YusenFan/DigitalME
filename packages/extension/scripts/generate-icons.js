/**
 * generate-icons.js — 生成占位图标 PNG
 * 运行：node scripts/generate-icons.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, "..", "icons");

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuffer, data]);

  let crc = 0xffffffff;
  for (let i = 0; i < crcInput.length; i++) {
    crc ^= crcInput[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  crc ^= 0xffffffff;
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

const sizes = [16, 48, 128];

for (const size of sizes) {
  // 紫色 1x1 pixel PNG placeholder
  const rawRow = Buffer.from([0, 128, 90, 200]); // filter=none, R=128 G=90 B=200
  const compressed = deflateSync(rawRow);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdr = createChunk("IHDR", ihdrData);
  const idat = createChunk("IDAT", compressed);
  const iend = createChunk("IEND", Buffer.alloc(0));

  const png = Buffer.concat([signature, ihdr, idat, iend]);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Created icon${size}.png (placeholder)`);
}
