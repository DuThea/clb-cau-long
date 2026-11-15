// Sinh icon PNG cho PWA / iOS (không cần thư viện ngoài): nền xanh #4772FA + quả cầu lông trắng.
// Chạy: node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.resolve('public/icons');
fs.mkdirSync(OUT, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const encodePNG = (w, h, rgba) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C1 = hex('#4772FA'), C2 = hex('#2848B8'), WHITE = [255, 255, 255], FEATHER = hex('#C9D6FF'), BAND = hex('#FF9500');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Toạ độ chuẩn hoá 0..1. Trả màu tại điểm (u, v).
function shade(u, v) {
  let col = mix(C1, C2, Math.min(1, Math.max(0, (u + v) / 2)));
  // Váy lông cầu: hình thang từ v=0.22 (rộng) tới v=0.60 (hẹp)
  const top = 0.22, bot = 0.60;
  if (v >= top && v <= bot) {
    const t = (v - top) / (bot - top);
    const half = 0.24 - t * 0.12;
    if (Math.abs(u - 0.5) <= half) {
      col = WHITE;
      // Các gân lông hội tụ về đế cầu
      const rel = (u - 0.5) / half; // -1..1
      for (const k of [-0.66, -0.33, 0, 0.33, 0.66]) {
        if (Math.abs(rel - k) < 0.035 / (half / 0.24)) col = FEATHER;
      }
      if (Math.abs(v - (top + 0.12)) < 0.012) col = FEATHER; // vòng chỉ buộc
    }
  }
  // Đai màu cam giữa lông và đế
  if (v > 0.60 && v <= 0.645 && Math.abs(u - 0.5) <= 0.125) col = BAND;
  // Đế cầu (nửa hình tròn phía dưới)
  const dx = u - 0.5, dy = v - 0.645;
  if (dy >= 0 && dx * dx + dy * dy <= 0.125 * 0.125) col = WHITE;
  return col;
}

function render(size) {
  const SS = 4; // khử răng cưa
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          acc = acc.map((v, i) => v + c[i]);
        }
      }
      const o = (y * size + x) * 4;
      buf[o] = Math.round(acc[0] / (SS * SS));
      buf[o + 1] = Math.round(acc[1] / (SS * SS));
      buf[o + 2] = Math.round(acc[2] / (SS * SS));
      buf[o + 3] = 255; // icon iOS phải đặc, không trong suốt
    }
  }
  return encodePNG(size, size, buf);
}

for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  fs.writeFileSync(path.join(OUT, name), render(size));
  console.log('✓', name);
}
