// Tests: compatibilidad Chromium 53, lógica de red con fetch simulado y flujos de UI con jsdom.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const J = (x) => JSON.parse(JSON.stringify(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`);

/* ---------- 1) sintaxis + compatibilidad con Chromium 53 (webOS 4) ---------- */
const banned = [
  [/\basync\s+function|\bawait\s/, 'async/await (Chrome 55)'],
  [/\.\.\.[A-Za-z_{\[]/, 'spread/rest (Chrome 46-60)'],
  [/\?\./, 'optional chaining (Chrome 80)'],
  [/\?\?/, 'nullish coalescing (Chrome 80)'],
  [/\.padStart|\.padEnd|Object\.entries|Object\.values|\.flat\(|\.flatMap\(|\.finally\(|URLSearchParams/, 'API posterior a Chrome 53'],
];
for (const f of scripts) {
  const code = fs.readFileSync(path.join(appDir, f), 'utf8');
  new vm.Script(code, { filename: f });
  const clean = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, (m, off) => (code.slice(Math.max(0, off - 1), off) === ':' ? m : ''))
    .replace(/'[^'\n]*'/g, "''");
  for (const [re, what] of banned) assert.ok(!re.test(clean), `${f} usa ${what}`);
}
const css = fs.readFileSync(path.join(appDir, 'css/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/display:\s*grid|\bgap:|aspect-ratio|:is\(|:where\(|inset:/.test(css), 'CSS no compatible con Chromium 53');
ok(`sintaxis y compatibilidad Chromium 53 (${scripts.length} scripts)`);

/* ---------- mock de la red de Twitch ---------- */
const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=8000000,RESOLUTION=1920x1080,VIDEO="chunked"
https://video-weaver.example/v1/playlist/AAA.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=3400000,RESOLUTION=1280x720,VIDEO="720p60"
https://video-weaver.example/v1/playlist/BBB.m3u8
`;
const stream = (i) => ({
  cursor: 'c' + i,
  node: { id: String(i), title: 'Título ' + i, viewersCount: 1000 + i, previewImageURL: `http://img/${i}.jpg`, broadcaster: { login: 'chan' + i, displayName: 'Chan' + i }, game: { displayName: 'Juego' } },
});

function net(o = {}) {
  const calls = [];
  let pending = o.pending ?? 2;
  const res = (body, status = 200, text) => Promise.resolve({
    ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(text ?? JSON.stringify(body)),
  });
  const goodTok = (h) => /(acc1|acc2)$/.test(h || '');
  const fetch = (url, opts = {}) => {
    calls.push({ url, opts });
    const body = opts.body;
    if (url.startsWith('https://gql.twitch.tv')) {
      const j = JSON.parse(body);
      if (Array.isArray(j)) {
        const v = j[0].variables;
        if (o.offline) return res([{ data: { streamPlaybackAccessToken: null, videoPlaybackAccessToken: null } }]);
        return res([{ data: v.isVod ? { videoPlaybackAccessToken: { value: '{"v":1}', signature: 'sg' } } : { streamPlaybackAccessToken: { value: '{"l":1}', signature: 'sg' } } }]);
      }
      const q = j.query;
      if (q.includes('searchFor')) return res({ data: { searchFor: { channels: { edges: [
        { item: { login: 'foo', displayName: 'Foo', profileImageURL: 'http://p/foo', stream: null } },
        { item: { login: 'bar', displayName: 'Bar', profileImageURL: 'http://p/bar', stream: { viewersCount: 5 } } },
      ] } } } });
      if (q.includes('videos(')) {
        const first = !q.includes('after:');
        return res({ data: { user: { login: 'chan1', displayName: 'Chan1',
          ...(first ? { stream: { id: 's', title: 'En vivo', viewersCount: 77, previewImageURL: 'http://img/s.jpg', game: { displayName: 'Juego' } } } : {}),
          videos: { edges: [1, 2].map((i) => ({ cursor: 'v' + i, node: { id: '90' + i, title: 'VOD ' + i, lengthSeconds: 3725, viewCount: 10 * i, createdAt: '2026-10-3' + i + 'T10:00:00Z', previewThumbnailURL: `http://img/v${i}.jpg`, game: { displayName: 'Juego' } } })) } } } });
      }
      if (q.includes('user(login')) return res({ data: { user: { login: 'foo', displayName: 'Foo', profileImageURL: 'http://p/foo', stream: null } } });
      if (q.includes('game(name')) return res({ data: { game: { streams: { edges: [stream(1), stream(2)] } } } });
      if (q.includes('games(first')) return res({ data: { games: { edges: [1, 2, 3].map((i) => ({ cursor: 'g' + i, node: { name: 'game' + i, displayName: 'Game ' + i, boxArtURL: 'http://box/' + i, viewersCount: 500 } })) } } });
      if (q.includes('streams(first')) return res({ data: { streams: { edges: [1, 2, 3, 4, 5, 6].map(stream) } } });
      return res({ errors: [{ message: 'unmocked ' + q }] });
    }
    if (url.startsWith('https://usher.ttvnw.net')) return res(null, o.usher ?? 200, MASTER);
    if (url.endsWith('/oauth2/device')) return res({ device_code: 'dc', user_code: 'ABCD1234', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD1234', expires_in: 60, interval: 0.01 });
    if (url.endsWith('/oauth2/token')) {
      const p = Object.fromEntries(body.split('&').map((kv) => kv.split('=').map(decodeURIComponent)));
      if (p.grant_type === 'refresh_token') return p.refresh_token === 'r-old' ? res({ access_token: 'acc2', refresh_token: 'ref2' }) : res({ message: 'Invalid refresh token' }, 400);
      if (pending-- > 0) return res({ status: 400, message: 'authorization_pending' }, 400);
      return res({ access_token: 'acc1', refresh_token: 'ref1' });
    }
    if (url.endsWith('/oauth2/validate')) return goodTok(opts.headers.Authorization) ? res({ user_id: '42', login: 'adam' }) : res({ message: 'invalid' }, 401);
    if (url.endsWith('/oauth2/revoke')) return res({});
    if (url.startsWith('https://api.twitch.tv/helix/')) {
      if (!goodTok(opts.headers.Authorization)) return res({ message: 'Invalid OAuth token' }, 401);
      assert.ok(opts.headers['Client-Id'], 'Helix sin Client-Id');
      if (url.includes('streams/followed')) return res({ data: [1, 2].map((i) => ({ user_login: 'chan' + i, user_name: 'Chan' + i, game_name: 'Juego', title: 'Sig ' + i, viewer_count: 50 * i, thumbnail_url: 'http://t/{width}x{height}.jpg' })), pagination: {} });
      if (url.includes('channels/followed') && url.includes('after=')) return res({ data: [], pagination: {} });
      if (url.includes('channels/followed')) return res({ data: [1, 2].map((i) => ({ broadcaster_id: String(i), broadcaster_login: 'chan' + i, broadcaster_name: 'Chan' + i })), pagination: { cursor: 'nx' } });
      if (url.includes('/users?')) return res({ data: [1, 2].map((i) => ({ id: String(i), profile_image_url: 'http://avatar/' + i })) });
    }
    return res({ message: 'unmocked ' + url }, 404);
  };
  return { fetch, calls };
}

/* ---------- arranque de la app en jsdom ---------- */
function boot(o = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://app.test/', virtualConsole: vc });
  const w = dom.window;
  const N = o.net || net(o);
  w.fetch = N.fetch;
  for (const [k, v] of Object.entries(o.ls || {})) w.localStorage.setItem(k, v);
  w.HTMLMediaElement.prototype.load = () => {};
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  // layout falso: tarjetas en rejilla de 4 columnas y pestañas en fila
  const box = (l, t, wd, h) => ({ left: l, top: t, width: wd, height: h, right: l + wd, bottom: t + h });
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('card')) { const i = +this.getAttribute('data-i'); return box((i % 4) * 200 + 50, 100 + Math.floor(i / 4) * 200, 180, 180); }
    if (this.classList.contains('tab')) { const i = [...w.document.querySelectorAll('.tab')].indexOf(this); return box(i * 150 + 20, 10, 130, 40); }
    if (this.id === 'content') return box(0, 60, 1000, 600);
    return box(0, 0, 0, 0);
  };
  if (o.beforeScripts) o.beforeScripts(w);
  for (const f of scripts) {
    let code = fs.readFileSync(path.join(appDir, f), 'utf8');
    if (f === 'js/config.js' && o.clientId) code = code.replace("CLIENT_ID: ''", `CLIENT_ID: '${o.clientId}'`);
    w.eval(code);
  }
  const d = w.document;
  const $ = (id) => d.getElementById(id);
  const key = (code) => {
    const ev = new w.KeyboardEvent('keydown', { keyCode: code, bubbles: true, cancelable: true });
    if (ev.keyCode !== code) Object.defineProperty(ev, 'keyCode', { value: code });
    d.dispatchEvent(ev);
  };
  const until = async (fn, what, ms = 3000) => {
    const t0 = Date.now();
    while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout esperando: ' + what); await sleep(10); }
  };
  const K = { left: 37, up: 38, right: 39, down: 40, ok: 13, back: 461, yellow: 405 };
  const focused = () => d.querySelector('.foc');
  const highlighted = () => d.querySelectorAll('#app .foc').length;
  const cards = () => d.querySelectorAll('#grid .card');
  const focusTab = (name) => {
    for (let i = 0; i < 6 && !focused().classList.contains('tab'); i++) key(K.up);
    for (let i = 0; i < 8 && focused().getAttribute('data-tab') !== name; i++) key(K.right);
    assert.equal(focused().getAttribute('data-tab'), name, 'no se pudo enfocar la pestaña ' + name);
  };
  return { w, d, $, key, K, until, focused, cards, focusTab, N, errors, highlighted };
}

/* ---------- 2) lógica de red ---------- */
{
  const t = boot();
  const { w } = t;
  const q = J(w.Api.parseMaster(MASTER));
  assert.deepEqual(q.map((x) => x.name), ['1080p60 (source)', '720p60']);

  let r = await w.Api.playback({ type: 'stream', login: 'Foo' });
  assert.match(r.master, /^https:\/\/usher\.ttvnw\.net\/api\/channel\/hls\/Foo\.m3u8\?player=twitchweb&token=%7B%22l%22%3A1%7D&sig=sg&/);
  assert.equal(r.variants.length, 2);
  let body = JSON.parse(t.N.calls.filter((c) => c.url.includes('gql')).pop().opts.body);
  assert.equal(body[0].variables.isLive, true);
  r = await w.Api.playback({ type: 'video', id: '901' });
  assert.match(r.master, /^https:\/\/usher\.ttvnw\.net\/vod\/901\.m3u8\?/);
  body = JSON.parse(t.N.calls.filter((c) => c.url.includes('gql')).pop().opts.body);
  assert.equal(body[0].variables.isVod, true);
  assert.equal(body[0].variables.vodID, '901');
  ok('playback: directo y VOD (token + URL usher)');

  const off = boot({ offline: true });
  await assert.rejects(off.w.Api.playback({ type: 'stream', login: 'x' }), (e) => e.offline === true);
  await assert.rejects(off.w.Api.playback({ type: 'video', id: '1' }), (e) => e.offline === true);
  const gone = boot({ usher: 404 });
  await assert.rejects(gone.w.Api.playback({ type: 'stream', login: 'x' }), (e) => e.offline === true);
  ok('playback: canal desconectado / VOD no disponible');

  const s = J(await w.Api.search('fo o'));
  assert.deepEqual(s.items.map((i) => [i.login, i.live, i.type]), [['bar', true, 'channel'], ['foo', false, 'channel']]);
  assert.equal(s.items[0].viewers, 5);
  ok('búsqueda: canales, sin duplicados, en directo primero');

  let cv = J(await w.Api.channelVideos('chan1', null));
  assert.deepEqual(cv.items.map((i) => i.type), ['stream', 'video', 'video']);
  assert.equal(cv.items[1].duration, 3725);
  assert.equal(cv.items[1].date, '2026-10-31');
  assert.equal(cv.cursor, 'v2');
  cv = J(await w.Api.channelVideos('chan1', 'v2'));
  assert.deepEqual(cv.items.map((i) => i.type), ['video', 'video']);
  ok('vídeos de un canal: directo antepuesto solo en la 1ª página');
}

/* ---------- 3) autenticación ---------- */
{
  // Device Code Grant completo (2 respuestas "pending" antes de autorizar)
  const t = boot();
  const { w } = t;
  const d = await w.Auth.begin().catch((e) => e);
  assert.equal(d.message, 'noclient', 'sin Client ID debe rechazar');
  w.CONFIG.CLIENT_ID = 'cid123';
  const dev = J(await w.Auth.begin());
  assert.deepEqual([dev.userCode, dev.deviceCode], ['ABCD1234', 'dc']);
  const call = t.N.calls.find((c) => c.url.endsWith('/oauth2/device'));
  assert.equal(call.opts.body, 'client_id=cid123&scopes=user%3Aread%3Afollows');
  const result = await new Promise((res) => w.Auth.poll(dev, res));
  assert.deepEqual(J(result), { ok: true });
  assert.equal(w.Auth.isLoggedIn(), true);
  assert.equal(w.Auth.login(), 'adam');
  assert.equal(JSON.parse(w.localStorage.getItem('tauth')).refresh, 'ref1');
  assert.equal(t.N.calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 3);
  ok('device flow: pending → pending → token → identificación');

  const fs1 = J(await w.Auth.followedStreams(null));
  assert.equal(fs1.items[0].thumb, 'http://t/440x248.jpg');
  assert.equal(fs1.items[1].viewers, 100);
  assert.equal(fs1.hasNext, false);
  const fc = J(await w.Auth.followedChannels(null));
  assert.deepEqual(fc.items.map((i) => [i.login, i.thumb]), [['chan1', 'http://avatar/1'], ['chan2', 'http://avatar/2']]);
  assert.equal(fc.hasNext, true);
  assert.equal(fc.cursor, 'nx');
  ok('Helix: streams/followed y channels/followed (+avatares)');

  w.Auth.logout();
  assert.equal(w.Auth.isLoggedIn(), false);
  assert.equal(w.localStorage.getItem('tauth'), null);
  assert.ok(t.N.calls.some((c) => c.url.endsWith('/oauth2/revoke')));
  ok('logout: borra sesión y revoca el token');

  // Token caducado al arrancar: se renueva con el refresh token (la app llama a Auth.init sola)
  const t2 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'old', refresh: 'r-old', userId: '42', login: 'adam' }) } });
  await t2.until(() => JSON.parse(t2.w.localStorage.getItem('tauth') || '{}').access === 'acc2', 'refresh al arrancar');
  assert.equal(t2.w.Auth.login(), 'adam');
  ok('arranque con token caducado: refresh automático');

  // Refresh inválido: la sesión se descarta
  const t3 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'old', refresh: 'bad', userId: '42', login: 'adam' }) } });
  await t3.until(() => !t3.w.Auth.isLoggedIn(), 'sesión descartada');
  assert.equal(t3.w.localStorage.getItem('tauth'), null);
  ok('arranque con refresh inválido: sesión descartada');

  // 401 en Helix a la vez que Auth.init: una sola renovación compartida (refresh token de un solo uso)
  const t5 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'stale', refresh: 'r-old', userId: '42', login: 'adam' }) } });
  const r5 = J(await t5.w.Auth.followedStreams(null));
  assert.equal(r5.items.length, 2);
  assert.equal(JSON.parse(t5.w.localStorage.getItem('tauth')).access, 'acc2');
  assert.equal(t5.N.calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 1, 'debe haber una sola renovación');
  ok('Helix 401 + init concurrentes: una sola renovación, reintento correcto');
}

/* ---------- 4) QR ---------- */
{
  const { w } = boot();
  const svg = w.QR.svg('https://www.twitch.tv/activate?device-code=ABCD1234');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 41 41"/);          // versión 4: 33 módulos + 2×4 de silencio
  assert.equal(w.QR.matrix('A').length, 21);
  assert.throws(() => w.QR.matrix('x'.repeat(300)), /demasiado largo/);
  ok('QR: versión correcta y límite de longitud (decodificación verificada con OpenCV aparte)');
}

/* ---------- 5) flujos de UI con el mando ---------- */
{
  const t = boot();
  const { d, $, key, K, until, focused, cards, focusTab, w } = t;
  await until(() => cards().length === 6, 'directos de Inicio');
  assert.equal(focused().getAttribute('data-i'), '0');
  key(K.right); assert.equal(focused().getAttribute('data-i'), '1');
  key(K.down); assert.equal(focused().getAttribute('data-i'), '5');
  key(K.right); assert.equal(focused().getAttribute('data-i'), '5', 'no debe saltar de fila');
  key(K.up); key(K.left); assert.equal(focused().getAttribute('data-i'), '0');
  key(K.ok);
  assert.equal(w.Player.isOpen(), true);
  await until(() => d.getElementById('v').getAttribute('src'), 'src del vídeo');
  assert.match($('v').getAttribute('src'), /hls\/chan1\.m3u8/);
  assert.equal($('obar').hidden, true, 'un directo no muestra barra de progreso');
  key(K.ok); assert.equal($('qmenu').hidden, false, 'OK abre el menú de calidad');
  key(K.down); key(K.ok);
  assert.match($('v').getAttribute('src'), /AAA\.m3u8/);
  key(K.back); assert.equal(w.Player.isOpen(), false);
  assert.equal($('v').getAttribute('src'), null, 'al salir se libera el decoder');
  ok('Inicio: foco con el mando, reproducir directo, calidad y salir');

  // Siguiendo sin sesión
  focusTab('following'); key(K.ok);
  assert.match($('msg').textContent, /Inicia sesión/);
  assert.equal(cards().length, 0);
  ok('Siguiendo sin sesión: pide iniciar sesión');

  // Login: sin Client ID
  focusTab('account'); key(K.ok);
  assert.equal($('login').hidden, false);
  assert.match($('ls').textContent, /Falta el Client ID/);
  key(K.back); assert.equal($('login').hidden, true);
  ok('Entrar sin Client ID: instrucciones');

  // Login completo por QR
  w.CONFIG.CLIENT_ID = 'cid123';
  key(K.ok);
  await until(() => $('lqr').querySelector('svg'), 'QR');
  assert.equal($('lc').textContent, 'ABCD1234');
  assert.match($('ls').textContent, /Esperando autorización/);
  await until(() => $('login').hidden, 'cierre del login', 6000);
  assert.equal($('acct').textContent, 'adam');
  await until(() => cards().length === 2, 'siguiendo tras login');
  assert.notEqual(focused().id, 'acct', 'el foco no debe quedar en el botón de cuenta');
  assert.equal(d.querySelector('#grid .card .ti').textContent, 'Sig 1');
  ok('Login por QR → "adam" y Siguiendo se recarga con sus directos');

  // Amarillo: vídeos del canal desde un directo seguido
  key(K.yellow);
  assert.equal($('crumb').textContent, 'Chan1');
  await until(() => cards().length === 3, 'canal: directo + 2 vídeos');
  assert.equal(d.querySelector('#grid .card .nm').textContent, 'Chan1');
  key(K.back);
  assert.equal($('crumb').textContent, '');
  assert.equal(cards().length, 2);
  ok('Amarillo en un directo → vídeos del canal; Atrás vuelve');

  // Vídeos: canales seguidos → canal → VOD
  focusTab('videos'); key(K.ok);
  await until(() => cards().length === 2, 'canales seguidos');
  assert.equal(t.highlighted(), 1, 'solo un elemento resaltado');
  assert.ok(cards()[0].classList.contains('c'));
  key(K.ok);
  assert.equal($('crumb').textContent, 'Chan1');
  await until(() => cards().length === 3, 'vídeos del canal');
  key(K.right);                                              // 1º = directo, 2º = primer VOD
  assert.match(focused().querySelector('.du').textContent, /^1:02:05$/);
  key(K.ok);
  assert.equal(w.Player.isOpen(), true);
  await until(() => $('v').getAttribute('src'), 'src VOD');
  assert.match($('v').getAttribute('src'), /AAA|usher\.ttvnw\.net\/vod\/901/);
  assert.equal($('obar').hidden, false, 'un VOD muestra barra de progreso');
  assert.match($('otime').textContent, /0:00 \/ 1:02:05/);
  key(K.right);                                              // +10 s no debe romper aunque no haya duración real
  key(K.back); assert.equal(w.Player.isOpen(), false);
  key(K.back);
  assert.equal(cards().length, 2);
  ok('Vídeos: canales seguidos → vídeos → reproducir VOD con barra de progreso');

  // Buscar
  focusTab('search'); key(K.ok);
  assert.equal(d.activeElement, $('q'));
  $('q').value = 'foo';
  key(K.ok);
  await until(() => cards().length === 2, 'resultados de búsqueda');
  assert.deepEqual([...cards()].map((c) => c.querySelector('.nm').textContent), ['Bar', 'Foo']);
  assert.ok(cards()[0].querySelector('.vw'), 'el canal en directo muestra espectadores');
  assert.ok(!cards()[1].querySelector('.vw'));
  ok('Buscar: canales, en directo primero');

  // Cerrar sesión: nunca con un OK suelto ni con pulsaciones repetidas
  focusTab('account'); key(K.ok);
  assert.match($('ls').textContent, /Sesión iniciada como adam/);
  key(K.ok); key(K.ok);                                      // OK inmediatos: se ignoran
  assert.equal(w.Auth.isLoggedIn(), true, 'un OK inmediato no debe cerrar la sesión');
  await sleep(750);
  key(K.ok);                                                 // pide confirmación
  assert.match($('ls').textContent, /¿Cerrar la sesión de adam\?/);
  assert.equal(w.Auth.isLoggedIn(), true);
  key(K.ok);                                                 // inmediato: ignorado
  assert.equal(w.Auth.isLoggedIn(), true);
  key(K.back);                                               // cancelar
  assert.equal($('login').hidden, true);
  assert.equal(w.Auth.isLoggedIn(), true, 'cancelar no cierra la sesión');
  assert.equal($('acct').textContent, 'adam');
  key(K.ok); await sleep(750); key(K.ok); await sleep(750); key(K.ok);
  assert.equal($('acct').textContent, 'Entrar');
  assert.equal(w.Auth.isLoggedIn(), false);
  ok('Cuenta: cerrar sesión solo con confirmación y sin pulsaciones repetidas');

  assert.deepEqual(t.errors, [], 'errores de JS en la página');
  ok('sin errores de JavaScript durante los flujos');
}
console.log('\nOK');
process.exit(0);
