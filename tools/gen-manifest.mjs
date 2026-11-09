// Genera el manifest del Homebrew Channel a partir del IPK exacto de out/ (hash SHA-256, tamaño del IPK y tamaño instalado).
// Equivale a `webosbrew-toolbox-gen-manifest` (https://github.com/webosbrew/dev-toolbox-cli, solo se distribuye como .deb para Linux).
// Uso: npm run package && npm run manifest  ->  out/com.twitchlite.app.manifest.json  (se adjunta al release junto al IPK)
// installedSize = suma de los tamaños de los ficheros de data.tar.gz (comprobado contra el manifest publicado de 1.1.0).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const info = JSON.parse(fs.readFileSync(path.join(root, 'app', 'appinfo.json'), 'utf8'));
const ipkName = `${info.id}_${info.version}_all.ipk`;
const ipkPath = path.join(root, 'out', ipkName);
if (!fs.existsSync(ipkPath)) throw new Error(`No existe ${ipkPath}: ejecuta antes "npm run package"`);
const ipk = fs.readFileSync(ipkPath);

// El IPK es un archivo ar con debian-binary, control.tar.gz y data.tar.gz
if (ipk.slice(0, 8).toString() !== '!<arch>\n') throw new Error('El IPK no es un archivo ar');
const members = {};
for (let o = 8; o < ipk.length;) {
  const name = ipk.slice(o, o + 16).toString().trim().replace(/\/$/, '');
  const size = parseInt(ipk.slice(o + 48, o + 58).toString(), 10);
  members[name] = ipk.slice(o + 60, o + 60 + size);
  o += 60 + size + (size % 2);
}
if (!members['data.tar.gz']) throw new Error('El IPK no trae data.tar.gz');

const tar = zlib.gunzipSync(members['data.tar.gz']);
let installedSize = 0;
for (let p = 0; p + 512 <= tar.length;) {
  const h = tar.slice(p, p + 512);
  if (h.every((b) => b === 0)) break;
  const size = parseInt(h.slice(124, 136).toString().replace(/\0.*$/, '').trim() || '0', 8);
  const type = String.fromCharCode(h[156] || 48);
  if (type === '0') installedSize += size;                         // solo ficheros normales
  p += 512 + Math.ceil(size / 512) * 512;
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== info.version) throw new Error(`package.json (${pkg.version}) y appinfo.json (${info.version}) no coinciden`);

const repo = 'https://github.com/adamff-dev/twitch-lite-webos';
const manifest = {
  id: info.id,
  version: info.version,
  type: 'web',
  title: info.title,
  iconUri: 'https://raw.githubusercontent.com/adamff-dev/twitch-lite-webos/master/docs/icon.png',
  sourceUrl: repo,
  rootRequired: false,
  ipkUrl: ipkName,
  ipkHash: { sha256: crypto.createHash('sha256').update(ipk).digest('hex') },
  ipkSize: ipk.length,
  installedSize,
};
const out = path.join(root, 'out', `${info.id}.manifest.json`);
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${path.relative(root, out)}: ${info.id} ${info.version}, ipk ${ipk.length} B, instalado ${installedSize} B, sha256 ${manifest.ipkHash.sha256}`);
