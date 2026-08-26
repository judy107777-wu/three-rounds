/**
 * 產生桌面圖示。
 * 不裝任何圖形套件，直接寫出 PNG，離線也跑得起來。
 * 圖案：奶茶棕底，三條由長到短的米白橫線——同一個主題講三遍，一遍比一遍精煉。
 *
 * 用法：npm run icons
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BG = [0x8b, 0x6f, 0x52]; // --primary 奶茶棕
const FG = [0xfa, 0xf6, 0xf0]; // --bg 米白

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 每個色版 8 bit
  ihdr[9] = 2; // 真彩色，不含透明
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每一列前面加一個 0，表示這一列沒有用預測濾波
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i += 1) {
    rgb[i * 3] = BG[0];
    rgb[i * 3 + 1] = BG[1];
    rgb[i * 3 + 2] = BG[2];
  }

  // 三條橫線放在中間 60% 的範圍內，四周留白，當作 maskable 的安全區
  const barHeight = Math.round(size * 0.075);
  const gap = Math.round(size * 0.09);
  const totalHeight = barHeight * 3 + gap * 2;
  const top = Math.round((size - totalHeight) / 2);
  const left = Math.round(size * 0.22);
  const widths = [0.56, 0.42, 0.28].map((w) => Math.round(size * w));

  for (let bar = 0; bar < 3; bar += 1) {
    const y0 = top + bar * (barHeight + gap);
    for (let y = y0; y < y0 + barHeight; y += 1) {
      for (let x = left; x < left + widths[bar]; x += 1) {
        const i = (y * size + x) * 3;
        rgb[i] = FG[0];
        rgb[i + 1] = FG[1];
        rgb[i + 2] = FG[2];
      }
    }
  }

  return encodePng(size, size, rgb);
}

mkdirSync(resolve(root, 'icons'), { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(root, `icons/icon-${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`寫出 icons/icon-${size}.png`);
}
