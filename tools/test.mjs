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
  let devUri = 'https://www.twitch.tv/activate?device-code=ABCD1234';
  let claimable = o.claim ?? false;
  const res = (body, status = 200, text) => Promise.resolve({
    ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(text ?? JSON.stringify(body)),
  });
  const goodTok = (h) => /(acc1|acc2)$/.test(h || '');
  const fetch = (url, opts = {}) => {
    calls.push({ url, opts });
    const body = opts.body;
    if (url.startsWith('https://gql.twitch.tv')) {
      const j = JSON.parse(body);
      const h = opts.headers || {};
      if (j.operationName === 'ChannelPointsContext' || (Array.isArray(j) && j[0].operationName === 'ClaimCommunityPoints')) {
        if (!/^OAuth acc[12]$/.test(h.Authorization || '')) return res({ error: 'Unauthorized', status: 401, message: 'The "Authorization" token is invalid.' }, 401);
        if (j.operationName) return res({ data: { community: { id: 'cmty1', channel: { self: { communityPoints: { balance: 1000, availableClaim: claimable ? { id: 'claim1' } : null } } } } } });
        claimable = false;
        return res([{ data: { claimCommunityPoints: { claim: { pointsEarnedTotal: 50 }, currentPoints: 1234 } } }]);
      }
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
    if (url.endsWith('/oauth2/device')) return res({ device_code: 'dc', user_code: 'ABCD1234', verification_uri: devUri, expires_in: 60, interval: 0.01 });
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
      if (url.endsWith('/helix/users')) return res({ data: [{ id: '42', login: 'adam', profile_image_url: 'http://avatar/self-300x300.png' }] });
      if (url.includes('/users?')) return res({ data: [1, 2].map((i) => ({ id: String(i), profile_image_url: 'http://avatar/' + i })) });
    }
    return res({ message: 'unmocked ' + url }, 404);
  };
  return { fetch, calls, setUri: (u) => { devUri = u; }, setClaim: (v) => { claimable = v; } };
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
  // idioma del sistema simulado: por defecto es-ES (lang: null = el de jsdom, en-US)
  const navLang = o.lang === undefined ? 'es-ES' : ({ es: 'es-ES', en: 'en-US' }[o.lang] || o.lang);
  w.__navLang = navLang;
  if (navLang) Object.defineProperty(w.navigator, 'language', { get: () => w.__navLang, configurable: true });
  const P = w.HTMLMediaElement.prototype;
  P.load = () => {};
  Object.defineProperty(P, 'paused', { get() { return this.__p !== false; }, configurable: true });
  Object.defineProperty(P, 'currentTime', { get() { return this.__t || 0; }, set(x) { this.__t = x; this.__seeks = (this.__seeks || 0) + 1; }, configurable: true });
  Object.defineProperty(P, 'duration', { get() { return this.__d ?? NaN; }, configurable: true });
  // los eventos de medios son asíncronos en los navegadores (el handler ve ya el estado final)
  P.pause = function () { this.__p = true; setTimeout(() => this.dispatchEvent(new w.Event('pause')), 0); };
  P.play = function () { this.__p = false; setTimeout(() => this.dispatchEvent(new w.Event('play')), 0); return Promise.resolve(); };
  const sockets = [];
  w.WebSocket = class {
    constructor(url) { this.url = url; this.sent = []; this.closed = false; sockets.push(this); setTimeout(() => this.onopen && this.onopen(), 0); }
    send(m) { this.sent.push(m); }
    close() { this.closed = true; if (this.onclose) this.onclose(); }
    emit(data) { if (this.onmessage) this.onmessage({ data }); }
  };
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
    if (f === 'js/config.js' && o.clientId) code = code.replace(/CLIENT_ID: '[^']*'/, `CLIENT_ID: '${o.clientId}'`);
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
  const K = { left: 37, up: 38, right: 39, down: 40, ok: 13, back: 461, yellow: 405, green: 404, ff: 417, rw: 412, pgup: 33, pgdn: 34 };
  const focused = () => d.querySelector('.foc');
  const highlighted = () => d.querySelectorAll('#app .foc').length;
  const cards = () => d.querySelectorAll('#grid .card');
  const focusTab = (name) => {
    for (let i = 0; i < 6 && !focused().classList.contains('tab'); i++) key(K.up);
    for (let i = 0; i < 8 && focused().getAttribute('data-tab') !== name; i++) key(K.right);
    assert.equal(focused().getAttribute('data-tab'), name, 'no se pudo enfocar la pestaña ' + name);
  };
  return { w, d, $, key, K, until, focused, cards, focusTab, N, errors, highlighted, sockets };
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
  w.CONFIG.CLIENT_ID = '';
  const d = await w.Auth.begin().catch((e) => e);
  assert.equal(d.message, 'noclient', 'sin Client ID debe rechazar');
  w.CONFIG.CLIENT_ID = 'cid123';
  const dev = J(await w.Auth.begin());
  assert.deepEqual([dev.userCode, dev.deviceCode], ['ABCD1234', 'dc']);
  assert.equal(dev.uri, 'https://www.twitch.tv/activate?device-code=ABCD1234');
  t.N.setUri('https://www.twitch.tv/activate');                 // URL sin código -> se añade
  assert.equal(J(await w.Auth.begin()).uri, 'https://www.twitch.tv/activate?device-code=ABCD1234');
  const call = t.N.calls.find((c) => c.url.endsWith('/oauth2/device'));
  assert.equal(call.opts.body, 'client_id=cid123&scopes=user%3Aread%3Afollows');
  const result = await new Promise((res) => w.Auth.poll(dev, res));
  assert.deepEqual(J(result), { ok: true });
  assert.equal(w.Auth.isLoggedIn(), true);
  assert.equal(w.Auth.login(), 'adam');
  assert.equal(JSON.parse(w.localStorage.getItem('tauth')).refresh, 'ref1');
  assert.equal(JSON.parse(w.localStorage.getItem('tauth')).cid, 'cid123');
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

  assert.equal(await w.Auth.avatar(70), 'http://avatar/self-70x70.png');
  assert.equal(await w.Auth.avatar(300), 'http://avatar/self-300x300.png');
  assert.equal(t.N.calls.filter((c) => c.url.endsWith('/helix/users')).length, 1, 'la foto se cachea');
  ok('foto de perfil: Helix /users, tamaño a medida y cacheada');

  w.Auth.logout();
  assert.equal(await w.Auth.avatar(70), '', 'sin sesión no hay foto');
  assert.equal(w.Auth.isLoggedIn(), false);
  assert.equal(w.localStorage.getItem('tauth'), null);
  assert.ok(t.N.calls.some((c) => c.url.endsWith('/oauth2/revoke')));
  ok('logout: borra sesión y revoca el token');

  // Token caducado al arrancar: se renueva con el refresh token (la app llama a Auth.init sola)
  const t2 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'old', refresh: 'r-old', userId: '42', login: 'adam', cid: 'cid123' }) } });
  await t2.until(() => JSON.parse(t2.w.localStorage.getItem('tauth') || '{}').access === 'acc2', 'refresh al arrancar');
  assert.equal(t2.w.Auth.login(), 'adam');
  ok('arranque con token caducado: refresh automático');

  // Refresh inválido: la sesión se descarta
  const t3 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'old', refresh: 'bad', userId: '42', login: 'adam', cid: 'cid123' }) } });
  await t3.until(() => !t3.w.Auth.isLoggedIn(), 'sesión descartada');
  assert.equal(t3.w.localStorage.getItem('tauth'), null);
  ok('arranque con refresh inválido: sesión descartada');

  // 401 en Helix a la vez que Auth.init: una sola renovación compartida (refresh token de un solo uso)
  const t5 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'stale', refresh: 'r-old', userId: '42', login: 'adam', cid: 'cid123' }) } });
  const r5 = J(await t5.w.Auth.followedStreams(null));
  assert.equal(r5.items.length, 2);
  assert.equal(JSON.parse(t5.w.localStorage.getItem('tauth')).access, 'acc2');
  assert.equal(t5.N.calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 1, 'debe haber una sola renovación');
  ok('Helix 401 + init concurrentes: una sola renovación, reintento correcto');

  // Una sesión guardada con otro Client ID no sirve (el token no vale para el nuevo): se descarta
  const t6 = boot({ clientId: 'otro-cliente', ls: { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'adam', cid: 'cid123' }) } });
  assert.equal(t6.w.Auth.isLoggedIn(), false);
  const t7 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'adam', cid: 'cid123' }) } });
  assert.equal(t7.w.Auth.isLoggedIn(), true);
  ok('sesión de otro Client ID: se descarta; la del mismo se conserva');
}

/* ---------- 3b) puntos automáticos ---------- */
{
  const TV = 'ue6666qo983tsx6so1t0vnawi233wa';
  const session = { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'adam', cid: TV }) };
  const gqlCalls = (t) => t.N.calls.filter((c) => c.url.includes('gql') && /ChannelPointsContext|ClaimCommunityPoints/.test(c.opts.body));

  // sin sesión: no hace ninguna petición
  let t = boot();
  t.w.Points.start('chan1', () => {});
  await sleep(50);
  assert.equal(gqlCalls(t).length, 0);
  assert.equal(t.w.Points.enabled(), false);

  // con otro Client ID el GraphQL privado rechazaría el token: desactivado
  t = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'acc1', userId: '42', login: 'adam', cid: 'cid123' }) } });
  t.w.Points.start('chan1', () => {});
  await sleep(50);
  assert.equal(gqlCalls(t).length, 0);
  ok('puntos: desactivados sin sesión o con un Client ID que no es el de TV');

  // sesión válida y sin cofre: consulta pero no reclama
  t = boot({ ls: session });
  assert.equal(t.w.Points.enabled(), true);
  t.w.Points.start('chan1', () => assert.fail('no debe reclamar'));
  await t.until(() => gqlCalls(t).length === 1, 'consulta de puntos');
  await sleep(50);
  assert.equal(gqlCalls(t).length, 1, 'sin cofre no debe reclamar');
  const h = gqlCalls(t)[0].opts.headers;
  assert.equal(h['Client-Id'], TV);
  assert.equal(h.Authorization, 'OAuth acc1');
  assert.equal(h['X-Device-Id'].length, 32);
  t.w.Points.stop();
  ok('puntos: consulta con las cabeceras del cliente de TV y no reclama si no hay cofre');

  // con cofre: reclama y avisa con lo ganado y el total
  t = boot({ ls: session, claim: true });
  let got = null;
  t.w.Points.start('chan1', (earned, total) => { got = [earned, total]; });
  await t.until(() => got, 'reclamo del cofre');
  assert.deepEqual(got, [50, 1234]);
  const calls = gqlCalls(t);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].opts.body)[0].variables.input.claimID, 'claim1');
  assert.equal(JSON.parse(calls[1].opts.body)[0].variables.input.channelID, 'cmty1');
  assert.ok(calls[1].opts.headers['api-consumer-type']);
  t.w.Points.stop();
  await t.w.Points.tick();                                   // tras stop no hace nada
  assert.equal(gqlCalls(t).length, 2);
  ok('puntos: reclama el cofre y devuelve +50 / total 1234');

  // dentro del reproductor: aviso visible y se limpia al salir
  t = boot({ ls: session, claim: true });
  await t.until(() => t.cards().length === 6, 'inicio');
  t.key(t.K.ok);
  await t.until(() => !t.$('ptoast').hidden, 'aviso de puntos');
  assert.equal(t.$('ptoast').textContent, '+50 puntos · 1.234');
  t.key(t.K.back);
  assert.equal(t.$('ptoast').hidden, true);
  const before = gqlCalls(t).length;
  t.N.setClaim(true);
  await sleep(80);
  assert.equal(gqlCalls(t).length, before, 'al salir deja de consultar');
  ok('puntos en el reproductor: aviso "+50 puntos · 1.234" y se detiene al salir');
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
  key(K.up); assert.equal($('qmenu').hidden, false, '▲ abre el menú de calidad');
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
  w.CONFIG.CLIENT_ID = '';
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
  await until(() => $('acct').querySelector('img.av'), 'avatar en el botón');
  assert.equal($('acct').querySelector('img.av').getAttribute('src'), 'http://avatar/self-70x70.png');
  assert.equal($('acct').textContent, 'adam', 'el nombre sigue ahí junto a la foto');
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
  await until(() => $('lqr').querySelector('img'), 'foto en la pantalla de cuenta');
  assert.equal($('lqr').querySelector('img').getAttribute('src'), 'http://avatar/self-300x300.png');
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
/* ---------- 6) controles del reproductor ---------- */
{
  const t = boot();
  const { $, key, K, until, cards, w } = t;
  await until(() => cards().length === 6, 'inicio');
  key(K.ok);
  await until(() => $('v').getAttribute('src'), 'src del directo');
  const v = $('v');

  assert.equal(v.paused, false);
  key(K.ok);                                                  // OK = pausa
  assert.equal(v.paused, true);
  await until(() => !$('pstate').hidden, 'indicador de pausa');
  assert.match($('pstate').textContent, /En pausa/);
  assert.equal($('qmenu').hidden, true, 'OK ya no abre el menú de calidad');
  await sleep(4300);
  assert.equal($('ovl').hidden, false, 'en pausa el panel no se oculta');
  key(K.ok);                                                  // OK = reanudar
  assert.equal(v.paused, false);
  await until(() => $('pstate').hidden, 'sin indicador al reanudar');
  ok('reproductor: OK pausa y reanuda (el panel se queda visible en pausa)');

  key(K.up); assert.equal($('qmenu').hidden, false);
  key(K.down); key(K.ok);                                     // elige 1080p
  assert.match(v.getAttribute('src'), /AAA\.m3u8/);
  key(K.green); assert.equal($('qmenu').hidden, false, 'el botón verde también abre calidad');
  key(K.back); assert.equal($('qmenu').hidden, true);
  assert.equal(w.Player.isOpen(), true, 'Atrás en el menú solo cierra el menú');
  ok('reproductor: ▲/verde abren calidad, Atrás solo cierra el menú');

  // ▼ = chat (desactivado por defecto)
  assert.equal(w.Chat.isOn(), false);
  assert.equal(t.sockets.length, 0, 'sin chat no hay conexión');
  key(K.down);
  assert.equal(w.Chat.isOn(), true);
  assert.equal($('chat').hidden, false);
  assert.ok($('player').classList.contains('chat'));
  await until(() => t.sockets.length === 1, 'conexión del chat');
  assert.equal(t.sockets[0].url, 'wss://irc-ws.chat.twitch.tv:443');
  key(K.down);
  assert.equal(w.Chat.isOn(), false);
  assert.equal($('chat').hidden, true);
  assert.equal(t.sockets[0].closed, true, 'al ocultar el chat se cierra la conexión');
  assert.equal(w.localStorage.getItem('chat'), '0');
  key(K.back);
  ok('reproductor: ▼ muestra/oculta el chat y solo conecta mientras está visible');

  // VOD: saltos acelerados
  w.Player.open({ type: 'video', id: '901', name: 'Chan1', title: 'VOD', date: '', game: '', duration: 3725 }, () => {});
  await until(() => v.getAttribute('src'), 'src del VOD');
  v.__d = 3725; v.__t = 100; v.__seeks = 0;
  key(K.right);
  assert.match($('pstate').textContent, /▶▶ \+0:10\s+→\s+1:50/);
  assert.equal(v.__seeks, 0, 'el salto no se aplica hasta que dejas de pulsar');
  await sleep(600);
  assert.equal(v.__t, 110); assert.equal(v.__seeks, 1);
  assert.equal($('pstate').hidden, true);

  await sleep(800);                                           // la racha se reinicia tras 700 ms sin pulsar
  v.__t = 1000; v.__seeks = 0;
  for (let i = 0; i < 5; i++) key(K.right);                   // 10+10+30+30+60 = 140 s
  assert.match($('pstate').textContent, /▶▶ \+2:20\s+→\s+19:00/);
  await sleep(600);
  assert.equal(v.__t, 1140);
  assert.equal(v.__seeks, 1, 'cinco pulsaciones rápidas = un solo seek');

  await sleep(800);                                           // la racha se reinicia si esperas
  v.__t = 1000;
  key(K.left); await sleep(600);
  assert.equal(v.__t, 990);
  v.__t = 5; key(K.left); await sleep(600);
  assert.equal(v.__t, 0, 'no baja de 0');
  v.__t = 3720; key(K.right); await sleep(600);
  assert.equal(v.__t, 3723, 'no pasa del final');
  v.__t = 500; await sleep(800);
  key(K.ff); await sleep(600);
  assert.equal(v.__t, 530, 'adelante rápido salta 30 s como mínimo');
  key(K.rw); await sleep(600);
  assert.equal(v.__t, 500);
  ok('VOD: saltos acelerados (10→10→30→30→60 s…), un solo seek y límites 0 / final');

  // cambiar de calidad no pierde la posición (la lista HLS nueva empieza en 0)
  await sleep(800);
  v.__t = 1234; v.__seeks = 0;
  const srcBefore = v.getAttribute('src');
  key(K.up); key(K.down); key(K.ok);
  assert.notEqual(v.getAttribute('src'), srcBefore, 'cambia el flujo');
  v.__t = 0;                                                  // el flujo nuevo arranca en 0
  v.dispatchEvent(new w.Event('loadedmetadata'));
  assert.equal(v.__t, 1234, 'recupera la posición al cargar el nuevo flujo');
  v.dispatchEvent(new w.Event('canplay'));
  assert.equal(v.__seeks, 1, 'la posición se restaura una sola vez');

  // un error de reproducción reintenta con token nuevo y tampoco pierde la posición
  v.__t = 500; v.__seeks = 0;
  v.dispatchEvent(new w.Event('error'));
  await sleep(150);
  await until(() => v.getAttribute('src'), 'src tras el reintento');
  v.__t = 0;
  v.dispatchEvent(new w.Event('loadedmetadata'));
  assert.equal(v.__t, 500, 'el reintento recupera la posición');

  // un vídeo distinto empieza en 0
  w.Player.open({ type: 'video', id: '902', name: 'Chan1', title: 'Otro', date: '', game: '', duration: 100 }, () => {});
  await until(() => v.getAttribute('src'), 'src del otro VOD');
  v.__t = 0; v.__seeks = 0;
  v.dispatchEvent(new w.Event('loadedmetadata'));
  assert.equal(v.__seeks, 0, 'no arrastra la posición del vídeo anterior');
  ok('VOD: cambiar de calidad o reintentar conserva la posición (una sola vez y sin arrastrarla a otro vídeo)');

  // una calidad que no se puede reproducir (algunos VODs no tienen todas): un reintento y luego vuelve a Auto,
  // sin perder la posición y sin volver a elegirla en los vídeos siguientes
  w.Player.key('back');
  w.localStorage.setItem('tq', '720p60');
  w.Player.open({ type: 'video', id: '903', name: 'Chan1', title: 'Falla', date: '', game: '', duration: 5000 }, () => {});
  await until(() => v.getAttribute('src'), 'src con la calidad guardada');
  assert.match(v.getAttribute('src'), /BBB\.m3u8/, 'arranca con la calidad guardada (720p60)');
  v.__t = 700;
  v.dispatchEvent(new w.Event('error'));                      // 1.er fallo: reintento con token nuevo
  await sleep(50);
  await until(() => v.getAttribute('src'), 'src tras el reintento');
  assert.match(v.getAttribute('src'), /BBB\.m3u8/);
  v.dispatchEvent(new w.Event('error'));                      // 2.º fallo: vuelve a Auto
  assert.match(v.getAttribute('src'), /usher\.ttvnw\.net\/vod\/903\.m3u8/, 'cae a Auto');
  assert.match($('ptoast').textContent, /720p60 no está disponible/);
  v.__t = 0; v.__seeks = 0;
  v.dispatchEvent(new w.Event('loadedmetadata'));
  assert.equal(v.__t, 700, 'conserva la posición al caer a Auto');
  assert.notEqual($('pmsg').textContent, 'No se pudo reproducir');
  w.Player.key('back');
  w.Player.open({ type: 'video', id: '904', name: 'Chan1', title: 'Siguiente', date: '', game: '', duration: 5000 }, () => {});
  await until(() => v.getAttribute('src'), 'src del siguiente');
  assert.match(v.getAttribute('src'), /usher\.ttvnw\.net\/vod\/904\.m3u8/, 'no vuelve a elegir la calidad que falló');
  ok('VOD: una calidad que falla vuelve a Auto sin perder la posición y no se vuelve a elegir');
  w.localStorage.removeItem('tq');

  key(K.down);
  assert.match($('ptoast').textContent, /solo está disponible en directos/);
  assert.equal(t.sockets.length, 1, 'un VOD no abre chat');
  key(K.back);
  ok('VOD: no hay chat');
}

/* ---------- 7) chat optimizado ---------- */
{
  const line = (name, text, tags = '') => `${tags ? '@' + tags + ' ' : ''}:${name}!${name}@${name}.tmi.twitch.tv PRIVMSG #chan1 :${text}`;

  // parseo
  const { w: pw } = boot();
  const P = (l) => J(pw.Chat.parse(l));
  assert.deepEqual(P(line('foo', 'hola: mundo')), { n: 'foo', c: '#bf94ff', t: 'hola: mundo', a: false });
  assert.deepEqual(P(line('foo', 'hola', 'color=#FF4500;display-name=Fo\\so;id=1')), { n: 'Fo o', c: '#FF4500', t: 'hola', a: false });
  assert.equal(P(line('foo', 'x', 'color=#0000FF')).c, '#bf94ff', 'un color ilegible sobre fondo oscuro se sustituye');
  assert.deepEqual(P(line('foo', '\u0001ACTION baila\u0001')), { n: 'foo', c: '#bf94ff', t: 'baila', a: true });
  assert.equal(P(line('foo', 'a'.repeat(500))).t.length, 161);
  assert.equal(pw.Chat.parse(':tmi.twitch.tv 001 justinfan1 :Welcome'), null);
  assert.equal(pw.Chat.parse('@a=b :x PRIVMSG'), null);
  ok('chat: parseo de tags, /me, colores ilegibles y mensajes largos');

  const t = boot({ ls: { chat: '1' } });                       // chat activado por preferencia
  const { $, key, K, until, cards, w } = t;
  await until(() => cards().length === 6, 'inicio');
  assert.equal(t.sockets.length, 0, 'no conecta hasta que hay un directo');
  key(K.ok);
  await until(() => t.sockets.length === 1 && t.sockets[0].sent.length >= 4, 'conexión y registro');
  const s = t.sockets[0];
  assert.deepEqual(s.sent.slice(0, 1), ['CAP REQ :twitch.tv/tags']);
  assert.ok(s.sent.some((m) => /^NICK justinfan\d+$/.test(m)));
  assert.ok(s.sent.includes('JOIN #chan1'));
  s.emit('PING :tmi.twitch.tv\r\n');
  assert.equal(s.sent[s.sent.length - 1], 'PONG :tmi.twitch.tv');

  s.emit(line('foo', 'hola Kappa', 'color=#FF4500;display-name=Foo') + '\r\n');
  await until(() => $('cmsgs').children.length === 1, 'primer mensaje');
  const m0 = $('cmsgs').firstChild;
  assert.equal(m0.firstChild.textContent, 'Foo:');
  assert.equal(m0.lastChild.textContent, 'hola Kappa');
  assert.equal(m0.firstChild.style.color, 'rgb(255, 69, 0)');
  ok('chat: se conecta, se registra, responde al PING y pinta mensajes');

  // ráfaga de 500 mensajes de golpe: se pintan como mucho 8 y se descartan los antiguos
  const before = t.w.Chat._stats().painted;
  s.emit(Array.from({ length: 500 }, (_, i) => line('u' + i, 'msg ' + i)).join('\r\n') + '\r\n');
  await sleep(350);
  const st1 = w.Chat._stats();
  assert.ok(st1.painted - before <= 8, `pintados en la ráfaga: ${st1.painted - before}`);
  assert.equal($('cmsgs').lastChild.lastChild.textContent, 'msg 499', 'se conservan los más recientes');
  assert.equal(st1.queued, 0);
  ok('chat: una ráfaga de 500 mensajes pinta como mucho 8 (los más recientes)');

  // flujo sostenido: los nodos del DOM no crecen nunca (se reciclan)
  const ids = [];
  for (let b = 0; b < 12; b++) {
    s.emit(Array.from({ length: 8 }, (_, i) => line('x', `lote ${b} mensaje ${i}`)).join('\r\n') + '\r\n');
    await sleep(270);
    ids.push(w.Chat._stats().nodes);
  }
  assert.ok(Math.max(...ids) <= 30, 'máximo 30 nodos');
  assert.equal($('cmsgs').children.length, 30);
  const firstNode = $('cmsgs').firstChild;
  s.emit(line('y', 'otro') + '\r\n'); await sleep(300);
  assert.equal($('cmsgs').children.length, 30);
  assert.notEqual($('cmsgs').firstChild, firstNode, 'el nodo más antiguo se movió al final (reciclado)');
  assert.equal($('cmsgs').lastChild, firstNode);
  ok('chat: 30 nodos fijos reciclados (sin crear ni destruir elementos)');

  // reconexión con espera
  const n0 = t.sockets.length;
  s.onclose();                                                 // el servidor cierra
  assert.match($('cst').textContent, /Reconectando/);
  await sleep(1150);
  assert.equal(t.sockets.length, n0 + 1, 'reconecta tras 1 s');
  ok('chat: reconexión automática tras un corte');

  // al cerrar el directo se corta todo
  const live = t.sockets[t.sockets.length - 1];
  key(K.back);
  assert.equal(live.closed, true);
  assert.equal($('chat').hidden, true);
  assert.equal($('cmsgs').children.length, 0, 'se vacía el panel');
  await sleep(1300);
  assert.equal(t.sockets.length, n0 + 1, 'no reconecta después de salir');
  ok('chat: al salir del directo se cierra la conexión y no reconecta');
}

/* ---------- 8) navegación ---------- */
{
  const t = boot();
  const { $, key, K, until, focused, cards, w } = t;
  let closed = 0;
  w.close = () => { closed++; };
  await until(() => cards().length === 6, 'inicio');
  const at = () => focused().getAttribute('data-i');
  key(K.right); key(K.right); key(K.right); assert.equal(at(), '3');
  key(K.right); assert.equal(at(), '3', 'no se sale por la derecha');
  key(K.left); key(K.left); key(K.left); key(K.left); assert.equal(at(), '0');
  key(K.down); assert.equal(at(), '4');
  key(K.up); key(K.right); key(K.right); key(K.right); assert.equal(at(), '3');
  key(K.down); assert.equal(at(), '5', 'bajar a una última fila incompleta va a su última tarjeta');
  key(K.down); assert.equal(at(), '5');
  ok('navegación: cuadrícula por índices (bordes, fila incompleta)');

  key(K.left); key(K.up); key(K.left);                         // 4 -> 0 -> pestañas
  assert.equal(at(), '0');
  key(K.up);
  assert.equal(focused().getAttribute('data-tab'), 'streams', 'subir desde la 1ª fila va a la pestaña activa');
  key(K.right); assert.equal(focused().getAttribute('data-tab'), 'games');
  key(K.left); key(K.left); assert.equal(focused().getAttribute('data-tab'), 'streams', 'no se sale por la izquierda');
  key(K.down); assert.equal(at(), '0');
  key(K.right); key(K.right); key(K.up); key(K.down);
  assert.equal(at(), '2', 'Abajo desde las pestañas vuelve a la última tarjeta enfocada');
  key(K.pgdn); assert.equal(at(), '5', 'Canal+ salta 3 filas (acotado al final)');
  key(K.pgup); assert.equal(at(), '0');
  ok('navegación: pestañas, vuelta a la última tarjeta y salto de página');

  key(51);                                                     // 3 = Siguiendo
  assert.equal(d_on(), 'Siguiendo');
  key(49);
  assert.equal(d_on(), 'Inicio');
  key(52); assert.equal(d_on(), 'Vídeos'); key(50); assert.equal(d_on(), 'Categorías'); key(49);
  function d_on() { return t.d.querySelector('.tab.on').textContent; }
  ok('navegación: teclas 1-4 abren las pestañas');

  // Atrás: cuadrícula → pestañas → (otra pestaña) Inicio → pestañas de Inicio → aviso → salir
  await until(() => cards().length === 6, 'inicio de nuevo');
  key(K.down);
  key(K.back);
  assert.equal(focused().getAttribute('data-tab'), 'streams', 'Atrás en la cuadrícula lleva a las pestañas');
  key(51);
  key(K.back);
  assert.equal(d_on(), 'Inicio', 'Atrás desde otra pestaña vuelve a Inicio');
  key(K.back);                                                 // en Inicio con el foco en la cuadrícula: a las pestañas
  assert.equal(focused().getAttribute('data-tab'), 'streams');
  assert.equal($('atoast').hidden, true);
  key(K.back);                                                 // ya en las pestañas de Inicio: aviso
  assert.equal($('atoast').hidden, false);
  assert.match($('atoast').textContent, /Atrás otra vez/);
  assert.equal(closed, 0);
  key(K.back);
  assert.equal(closed, 1, 'la segunda pulsación seguida cierra la app');
  ok('navegación: Atrás por niveles y salir solo con doble pulsación');
}

/* ---------- 9) idioma (español / inglés) ---------- */
{
  const SESSION = { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'adam', cid: 'ue6666qo983tsx6so1t0vnawi233wa' }) };

  // el idioma es el del sistema: es-* → español, cualquier otro → inglés
  let t = boot({ lang: null });
  assert.equal(t.w.I18n.lang(), 'en', 'jsdom informa en-US: inglés');
  for (const [loc, want] of [['es-ES', 'es'], ['es-MX', 'es'], ['ES', 'es'], ['en-GB', 'en'], ['fr-FR', 'en'], ['de', 'en']]) {
    t = boot({ lang: loc });
    assert.equal(t.w.I18n.lang(), want, loc);
  }
  t = boot({ lang: 'es-ES' });
  assert.equal(t.$('acct').textContent, 'Entrar');
  assert.equal(t.d.documentElement.lang, 'es');
  assert.equal(t.d.getElementById('lang'), null, 'ya no hay botón de idioma');
  ok('idioma: sigue al sistema (es-* → español, resto → inglés) y no hay botón');

  // interfaz en inglés
  t = boot({ lang: 'en' });
  await t.until(() => t.cards().length === 6, 'inicio en inglés');
  const tabs = [...t.d.querySelectorAll('#top .tab')].map((n) => n.textContent);
  assert.deepEqual(tabs.slice(0, 4), ['Home', 'Categories', 'Following', 'Videos']);
  assert.equal(t.$('q').getAttribute('placeholder'), 'Search channel…');
  assert.equal(t.$('acct').textContent, 'Log in');
  assert.equal(t.d.documentElement.lang, 'en');
  ok('inglés: pestañas, buscador, botón de cuenta e idioma del documento');

  t.focusTab('following'); t.key(t.K.ok);
  assert.match(t.$('msg').textContent, /^Log in with "Log in" \(top right\)/);
  ok('inglés: mensajes de vista vacía');

  // si el sistema cambia de idioma con la app abierta, la interfaz se actualiza sola
  t.w.__navLang = 'es-ES';
  t.w.dispatchEvent(new t.w.Event('languagechange'));
  assert.equal(t.w.I18n.lang(), 'es');
  assert.equal(t.$('acct').textContent, 'Entrar');
  assert.equal(t.d.documentElement.lang, 'es');
  assert.match(t.$('msg').textContent, /^Inicia sesión con "Entrar"/, 'el mensaje vacío se traduce al cambiar');
  assert.deepEqual([...t.d.querySelectorAll('#top .tab')].slice(0, 4).map((n) => n.textContent), ['Inicio', 'Categorías', 'Siguiendo', 'Vídeos']);
  t.w.dispatchEvent(new t.w.Event('languagechange'));           // sin cambio real: no hace nada
  assert.equal(t.w.I18n.lang(), 'es');
  t.w.__navLang = 'en-US';
  t.w.dispatchEvent(new t.w.Event('languagechange'));
  assert.equal(t.$('acct').textContent, 'Log in');
  ok('idioma: un cambio del idioma del sistema (languagechange) actualiza la interfaz en caliente');

  // una preferencia manual de versiones anteriores se ignora y se borra
  t = boot({ lang: 'es-ES', ls: { lang: 'en' } });
  assert.equal(t.w.I18n.lang(), 'es', 'manda el sistema, no la preferencia antigua');
  assert.equal(t.w.localStorage.getItem('lang'), null, 'la preferencia antigua se elimina');
  ok('idioma: la preferencia guardada por el antiguo botón se ignora y se elimina');

  // tarjetas de vídeo: el recuento de visualizaciones usa el idioma activo
  t = boot({ lang: 'en', ls: SESSION });
  await t.until(() => t.cards().length === 6, 'inicio antes de cambiar de pestaña');
  t.focusTab('videos'); t.key(t.K.ok);
  await t.until(() => t.cards().length === 2, 'canales seguidos en inglés');
  t.key(t.K.ok);
  await t.until(() => t.cards().length === 3, 'vídeos del canal en inglés');
  const meta = t.d.querySelector('#grid .card:nth-child(2) .ti').textContent;
  assert.match(meta, /^\d{4}-\d{2}-\d{2} · 10 views$/, 'meta del vídeo: ' + meta);
  t.key(t.K.back);
  ok('inglés: recuento de visualizaciones en las tarjetas de vídeo');

  // puntos y reproductor en inglés
  t = boot({ lang: 'en', ls: SESSION, claim: true });
  await t.until(() => t.cards().length === 6, 'inicio con sesión');
  t.key(t.K.ok);
  await t.until(() => !t.$('ptoast').hidden, 'aviso de puntos en inglés');
  assert.equal(t.$('ptoast').textContent, '+50 points · 1,234');
  await t.until(() => t.$('v').getAttribute('src'), 'src del directo en inglés');
  assert.match(t.$('ohint').textContent, /^OK pause · ▲ quality · ▼ chat · Back exit$/);
  t.key(t.K.ok);
  await t.until(() => !t.$('pstate').hidden, 'estado de pausa');
  assert.equal(t.$('pstate').textContent, '⏸  Paused');
  t.key(t.K.back);
  ok('inglés: aviso de puntos con separador de miles inglés, pausa y pistas del reproductor');

  // VOD: pistas y calidad de salto en inglés
  t.w.Player.open({ type: 'video', id: '901', name: 'Chan1', title: 'VOD', date: '', game: '', duration: 3725 }, () => {});
  await t.until(() => t.$('v').getAttribute('src'), 'src del VOD en inglés');
  assert.match(t.$('ohint').textContent, /skip \(press fast to go further\)/);
  assert.match(t.$('oinfo').textContent, /Chan1/);
  t.key(t.K.back);
  ok('inglés: pistas del VOD');

  // login sin Client ID en inglés
  t = boot({ lang: 'en', clientId: '' });
  t.w.CONFIG.CLIENT_ID = '';
  await t.until(() => t.cards().length === 6, 'inicio (sin Client ID)');
  t.focusTab('account'); t.key(t.K.ok);
  assert.match(t.$('ls').textContent, /^Twitch Client ID missing\./);
  assert.equal(t.$('lh').textContent, 'Back: close');
  t.key(t.K.back);
  ok('inglés: pantalla de cuenta sin Client ID');

  // la clave ausente cae a inglés y, si tampoco existe, muestra la clave
  assert.equal(t.w.I18n.t('no.existe'), 'no.existe');
  assert.equal(t.w.I18n.t('error.retry', { msg: 'x' }), 'Error: x — press OK on the tab to retry');
  assert.equal(t.w.I18n.compact(70700), '70.7K');
  assert.equal(t.w.I18n.thousands(1234567), '1,234,567');
  t.w.__navLang = 'es-ES';
  t.w.dispatchEvent(new t.w.Event('languagechange'));
  assert.equal(t.w.I18n.compact(70700), '70,7 K');
  assert.equal(t.w.I18n.thousands(1234567), '1.234.567');
  ok('i18n: formato de números por idioma y fallback de claves');
}

console.log('\nOK');
process.exit(0);
