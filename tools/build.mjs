// Build sin dependencias: inlina CSS + JS en un único index.html (1 sola petición al arrancar)
// y genera los iconos PNG. Salida: dist/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'app');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const clientId = (process.env.TWITCH_CLIENT_ID || '').trim();
if (clientId && !/^[a-z0-9]+$/i.test(clientId)) throw new Error('TWITCH_CLIENT_ID no válido');
const read = (p) => {
  const s = fs.readFileSync(path.join(src, p), 'utf8');
  return p === 'js/config.js' && clientId ? s.replace("CLIENT_ID: ''", `CLIENT_ID: '${clientId}'`) : s;
};

const minCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};:,>])\s*/g, '$1').trim();
// Minificado seguro: solo comentarios de línea completa e indentación (no toca strings ni regex).
const minJs = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (_, f) => `<style>${minCss(read(f))}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>\s*/g, (_, f) => `<script>${minJs(read(f))}</script>\n`);
html = html.replace(/>\s+</g, '><');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(src, 'appinfo.json'), path.join(out, 'appinfo.json'));

// --- Iconos PNG (morado Twitch + triángulo de play) ---
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const [ax, ay, bx, by, cx, cy] = [0.38, 0.27, 0.38, 0.73, 0.76, 0.5].map((v) => v * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = (px, py, qx, qy) => (x - qx) * (py - qy) - (px - qx) * (y - qy);
      const d1 = d(ax, ay, bx, by), d2 = d(bx, by, cx, cy), d3 = d(cx, cy, ax, ay);
      const inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const [r, g, b] = inside ? [255, 255, 255] : [0x91, 0x46, 0xff];
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(out, 'icon.png'), png(80));
fs.writeFileSync(path.join(out, 'largeIcon.png'), png(130));

const kb = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(1) + ' KB';
console.log(clientId ? 'Client ID inyectado' : 'AVISO: sin TWITCH_CLIENT_ID (el login por QR no funcionará)');
console.log(`dist/index.html ${kb('index.html')} · icon ${kb('icon.png')} · largeIcon ${kb('largeIcon.png')}`);
