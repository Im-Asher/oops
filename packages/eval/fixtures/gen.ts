import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const W = 900;
const H = 900;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // truecolor RGB

const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  const row = y * (W * 3 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < W; x += 1) {
    const p = row + 1 + x * 3;
    // 一朵简单的双色渐变，避免纯色让 VLM 判分困难
    raw[p] = 200 + Math.floor((x / W) * 40);
    raw[p + 1] = 210 + Math.floor((y / H) * 35);
    raw[p + 2] = 205;
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(join(import.meta.dirname, "product.png"), png);
console.log("fixtures/product.png 已生成", png.length, "bytes");
