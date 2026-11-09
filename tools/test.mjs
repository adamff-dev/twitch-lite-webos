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
    if (url.startsWith('https://spade.twitch.tv')) return res({}, 204);
    if (url.startsWith('https://gql.twitch.tv')) {
      const j = JSON.parse(body);
      const h = opts.headers || {};
      if (j.operationName === 'ChannelPointsContext' || (Array.isArray(j) && j[0].operationName === 'ClaimCommunityPoints')) {
        if (!/^OAuth acc[12]$/.test(h.Authorization || '')) return res({ error: 'Unauthorized', status: 401, message: 'The "Authorization" token is invalid.' }, 401);
        if (j.operationName) return res({ data: { community: { id: 'cmty1', channel: { self: { communityPoints: { balance: 1000, availableClaim: claimable ? { id: 'claim1' } : null } } } } } });
        claimable = false;
        return res([{ data: { claimCommunityPoints: { claim: { pointsEarnedTotal: 50 }, currentPoints: 1234 } } }]);
      }
      if (Array.isArray(j) && j[0].operationName === 'PlaybackAccessToken' && o.tokenReject && h.Authorization) return res({}, 401);
      if (Array.isArray(j)) {
        const v = j[0].variables;
        if (o.offline) return res([{ data: { streamPlaybackAccessToken: null, videoPlaybackAccessToken: null } }]);
        return res([{ data: v.isVod ? { videoPlaybackAccessToken: { value: '{"v":1}', signature: 'sg' } } : { streamPlaybackAccessToken: { value: '{"l":1}', signature: 'sg' } } }]);
      }
      const q = j.query;
      if (q.includes('user(login:') && q.includes('stream{id}')) return res({ data: { user: { id: 'chan-id', stream: { id: 'bcast-1' } } } });
      if (/^\{user\(login:"[^"]*"\)\{id\}\}$/.test(q)) return res({ data: { user: { id: '777' } } });
      if (q.includes('viewingHistory')) return res({ data: { video: { self: { viewingHistory: o.vpos ? { position: o.vpos, updatedAt: o.vposAt || '2030-01-01T00:00:00Z' } : null } } } });
      if (q.includes('comments(')) {
        // chat de un VOD: un mensaje por segundo (offset = nº de mensaje), 60 por página; el cursor es el offset del último
        const m = /contentOffsetSeconds:(\d+)/.exec(q), a = /after:"c(\d+)"/.exec(q);
        if (m && +m[1] === 7777) return res({ data: { video: { comments: { edges: [
          { cursor: 'e1', node: { contentOffsetSeconds: 7777, commenter: { displayName: 'E1' }, message: { userColor: null, fragments: [{ text: 'Kappa', emote: { emoteID: '25' } }, { text: ' ', emote: null }, { text: 'Kappa', emote: { emoteID: '25' } }] } } },
          { cursor: 'e2', node: { contentOffsetSeconds: 7778, commenter: { displayName: 'E2' }, message: { userColor: null, fragments: [{ text: '\u{1FAE0} ', emote: null }, { text: 'LUL', emote: { emoteID: 'emotesv2_abc' } }] } } },
        ], pageInfo: { hasNextPage: false } } } } });
        const from = a ? +a[1] + 1 : m ? +m[1] : 0, items = Array.from({ length: 60 }, (_, i) => from + i);
        return res({ data: { video: { comments: { edges: items.map((s) => ({ cursor: 'c' + s, node: { contentOffsetSeconds: s, commenter: { displayName: 'U' + s }, message: { userColor: s % 2 ? '#FF4500' : null, fragments: [{ text: 'msg ' }, { text: String(s) }] } } })), pageInfo: { hasNextPage: from + 60 < 3000 } } } } });
      }
      if (q.includes('video(id:') && !q.includes('comments(')) {
        if (!o.subonly) return res({ data: { video: null } });
        return res({ data: { video: { broadcastType: 'archive', createdAt: '2026-10-31T10:00:00Z',
          seekPreviewsURL: 'https://video-weaver.example/v1/playlist/ABC/storyboards/xyz.storyboard', owner: { login: 'chan1' } } } });
      }
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
      if (q.includes('game(name')) return res({ data: { game: { streams: { edges: o.emptyLang && q.includes('broadcasterLanguages') ? [] : [stream(1), stream(2)] } } } });
      if (q.includes('games(first')) return res({ data: { games: { edges: [1, 2, 3].map((i) => ({ cursor: 'g' + i, node: { name: 'game' + i, displayName: 'Game ' + i, boxArtURL: 'http://box/' + i, viewersCount: 500 } })) } } });
      if (q.includes('streams(first')) return res({ data: { streams: { edges: o.emptyLang && q.includes('broadcasterLanguages') ? [] : [1, 2, 3, 4, 5, 6].map(stream) } } });
      return res({ errors: [{ message: 'unmocked ' + q }] });
    }
    if (url.startsWith('https://7tv.io/')) {
      if (o.emoteFail === '7tv') return res({}, 500);
      if (url.endsWith('/emote-sets/global')) return res({ emotes: [{ id: 'GGG', name: 'Gl7', data: { animated: false } }] });
      const j = JSON.parse(body);
      const data = j.query.includes('userByConnection')
        ? { userByConnection: { connections: [{ platform: 'TWITCH', emote_set_id: 'SET1' }] } }
        : { emoteSet: { emotes: [{ id: 'AAA', name: 'catJAM', data: { animated: true } }, { id: 'BBB', name: 'Pog7', data: { animated: false } }] } };
      // como el servidor real: tras los datos va un bloque "extensions" enorme que no hay que interpretar
      return res(null, 200, JSON.stringify({ data }).slice(0, -1) + ',"extensions":{"tracing":{"resolvers":[' + '{"path":["x"]},'.repeat(50) + '{}]}}}');
    }
    if (url.startsWith('https://api.betterttv.net/')) {
      if (o.emoteFail === 'bttv') return res({}, 500);
      if (url.endsWith('/emotes/global')) return res([{ id: 'bg', code: 'BTglobal', modifier: false }, { id: 'bm', code: 'w!', modifier: true }]);
      return res({ channelEmotes: [{ id: 'b1', code: 'monkaBT', modifier: false }], sharedEmotes: [{ id: 'b2', code: 'Pog7', modifier: false }] });
    }
    if (url.startsWith('https://api.frankerfacez.com/')) {
      if (o.emoteFail === 'ffz') return res({}, 500);
      if (url.endsWith('/set/global')) return res({ default_sets: [3], sets: { 3: { emoticons: [{ id: 12, name: 'ffzG' }] } } });
      return res({ room: { set: 5 }, sets: { 5: { emoticons: [{ id: 11, name: 'ffzE' }, { id: 13, name: 'ffzH', hidden: true }] } } });
    }
    if (url.startsWith('https://usher.ttvnw.net')) return res(null, o.usher ?? 200, MASTER);
    if (url.startsWith('https://video-weaver.example')) return res(null, 200, o.media ?? '#EXTM3U\n');   // lista de medios de una calidad
    if (url.endsWith('/oauth2/device')) return res({ device_code: 'dc', user_code: 'ABCD1234', verification_uri: devUri, expires_in: 60, interval: 0.01 });
    if (url.endsWith('/oauth2/token')) {
      const p = Object.fromEntries(body.split('&').map((kv) => kv.split('=').map(decodeURIComponent)));
      if (p.grant_type === 'refresh_token') return p.refresh_token === 'r-old' ? res({ access_token: 'acc2', refresh_token: 'ref2' }) : res({ message: 'Invalid refresh token' }, 400);
      if (pending-- > 0) return res({ status: 400, message: 'authorization_pending' }, 400);
      return res({ access_token: 'acc1', refresh_token: 'ref1' });
    }
    if (url.endsWith('/oauth2/validate')) return goodTok(opts.headers.Authorization) ? res({ user_id: '42', login: 'demo_user' }) : res({ message: 'invalid' }, 401);
    if (url.endsWith('/oauth2/revoke')) return res({});
    if (url.startsWith('https://api.twitch.tv/helix/')) {
      if (!goodTok(opts.headers.Authorization)) return res({ message: 'Invalid OAuth token' }, 401);
      assert.ok(opts.headers['Client-Id'], 'Helix sin Client-Id');
      if (url.includes('streams/followed')) return res({ data: [1, 2].map((i) => ({ user_id: String(i), user_login: 'chan' + i, user_name: 'Chan' + i, game_name: 'Juego', title: 'Sig ' + i, viewer_count: 50 * i, thumbnail_url: 'http://t/{width}x{height}.jpg' })), pagination: {} });
      if (url.includes('channels/followed') && url.includes('after=')) return res({ data: [], pagination: {} });
      if (url.includes('channels/followed')) return res({ data: [1, 2].map((i) => ({ broadcaster_id: String(i), broadcaster_login: 'chan' + i, broadcaster_name: 'Chan' + i })), pagination: { cursor: 'nx' } });
      if (url.endsWith('/helix/users')) return res({ data: [{ id: '42', login: 'demo_user', profile_image_url: 'http://avatar/self-300x300.png' }] });
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
  // salvo que el test pida los ajustes de serie (o traiga los suyos), se parte con el bloqueo de anuncios apagado: los flujos
  // de reproducción de los tests usan el reproductor nativo (el bloqueo, activado por defecto, se prueba aparte)
  const ls = { ...(o.ls || {}) };
  if (!o.defaults && !ls.settings) ls.settings = JSON.stringify({ adblock: 'off' });
  for (const [k, v] of Object.entries(ls)) w.localStorage.setItem(k, v);
  // idioma del sistema simulado: por defecto es-ES (lang: null = el de jsdom, en-US)
  const navLang = o.lang === undefined ? 'es-ES' : ({ es: 'es-ES', en: 'en-US' }[o.lang] || o.lang);
  w.__navLang = navLang;
  if (navLang) Object.defineProperty(w.navigator, 'language', { get: () => w.__navLang, configurable: true });
  const P = w.HTMLMediaElement.prototype;
  P.load = () => {};
  Object.defineProperty(P, 'paused', { get() { return this.__p !== false; }, configurable: true });
  Object.defineProperty(P, 'currentTime', { get() { return this.__t || 0; }, set(x) { this.__seeks = (this.__seeks || 0) + 1; if (!this.__noSeek) this.__t = x; }, configurable: true });
  Object.defineProperty(P, 'duration', { get() { return this.__d ?? NaN; }, configurable: true });
  // rangos seekables: v.__live = borde en vivo de un directo; sin __live no hay rangos (VOD o directo sin datos)
  Object.defineProperty(P, 'seekable', { get() { const el = this; return el.__live === undefined ? { length: 0 } : { length: 1, start() { return 0; }, end() { return el.__live; } }; }, configurable: true });
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
  // botones del panel del reproductor: el enfocado, los visibles y ir a uno concreto (data-a)
  const pb = () => d.querySelector('#octl .pb.foc');
  const btnNames = () => [...d.querySelectorAll('#octl .pb')].filter((b) => !b.hidden).map((b) => b.getAttribute('data-a'));
  const goBtn = (a) => {
    if ($('obar').classList.contains('foc')) key(K.down);
    for (let i = 0; i < 8; i++) key(K.left);
    for (let i = 0; i < 8 && pb().getAttribute('data-a') !== a; i++) key(K.right);
    assert.equal(pb().getAttribute('data-a'), a, 'no se pudo enfocar el botón ' + a);
  };
  return { w, d, $, key, K, until, focused, cards, focusTab, N, errors, highlighted, sockets, pb, btnNames, goBtn };
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

  // el token de reproducción va con la sesión del usuario (como el reproductor oficial) para no ser tratado como anónimo
  const TVID = 'ue6666qo983tsx6so1t0vnawi233wa', WEBID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp';
  const tokenCalls = (x) => x.N.calls.filter((c) => c.url.includes('gql') && /PlaybackAccessToken/.test(c.opts.body || ''));
  const tvLs = { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'demo_user', cid: TVID }) };
  let pt = boot();
  await pt.w.Api.playback({ type: 'stream', login: 'x' });
  assert.equal(tokenCalls(pt).length, 1);
  assert.equal(tokenCalls(pt)[0].opts.headers['Client-ID'], WEBID, 'sin sesión: anónimo, con el Client-ID web');
  assert.equal(tokenCalls(pt)[0].opts.headers.Authorization, undefined);
  pt = boot({ ls: tvLs });
  const pr = await pt.w.Api.playback({ type: 'stream', login: 'x' });
  assert.match(pr.master, /usher.ttvnw.net/);
  assert.equal(tokenCalls(pt).length, 1);
  const th = tokenCalls(pt)[0].opts.headers;
  assert.equal(th.Authorization, 'OAuth acc1', 'con sesión: el token va con la cuenta');
  assert.equal(th['Client-ID'], TVID);
  assert.equal(th['X-Device-Id'].length, 32);
  pt = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'acc1', userId: '42', login: 'demo_user', cid: 'cid123' }) } });
  await pt.w.Api.playback({ type: 'stream', login: 'x' });
  assert.equal(tokenCalls(pt)[0].opts.headers.Authorization, undefined, 'con otro Client-ID la sesión no sirve para el GraphQL: anónimo');
  pt = boot({ ls: tvLs, tokenReject: true });
  const pf = await pt.w.Api.playback({ type: 'stream', login: 'x' });
  assert.match(pf.master, /usher.ttvnw.net/, 'si el servidor rechaza la sesión, reproduce como anónimo');
  assert.equal(tokenCalls(pt).length, 2);
  assert.equal(tokenCalls(pt)[1].opts.headers.Authorization, undefined);
  ok('playback: token con la sesión del usuario (cliente de TV) y respaldo anónimo');

  const patched = w.Unmute.patch('#EXTM3U\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="x",NAME="x"\n#EXTINF:10,\n123-muted.ts\nindex-muted-ABC.m3u8\n');
  assert.equal(patched.changed, 1);
  assert.ok(patched.text.indexOf('123.ts') >= 0 && patched.text.indexOf('123-muted.ts') < 0);
  assert.equal(w.Unmute.mutedUrl('https://cdn/1.ts?x=1'), 'https://cdn/1-muted.ts?x=1');
  assert.ok(w.Unmute.isMuted('0-muted.ts'));
  ok('unmute: reescritura de segmentos y no de listas .m3u8');

  function baseOk() {}
  baseOk.prototype.load = (ctx, cfg, cb) => cb.onSuccess({ data: '#EXTM3U\n#EXTINF:10,\n0-muted.ts\n' }, {}, ctx, {});
  const LO = w.Unmute.loaders({ DefaultConfig: { loader: baseOk } });
  let data = '';
  new LO.pLoader({}).load({ url: 'https://cdn/x.m3u8' }, {}, {
    onSuccess: (r) => { data = r.data; }, onProgress: () => {}, onError: () => {},
  });
  assert.ok(data.indexOf('0.ts') >= 0 && data.indexOf('-muted') < 0);

  function base403() {}
  base403.prototype.load = (ctx, cfg, cb) => cb.onError({ code: 403 }, ctx, {});
  const FO = w.Unmute.loaders({ DefaultConfig: { loader: base403 } });
  let failed = '';
  new FO.fLoader({}).load({ url: 'https://cdn/0.ts' }, {}, {
    onSuccess: () => {}, onProgress: () => {},
    onError: (e, ctx) => { failed = ctx.url; },
  });
  assert.match(failed, /0-muted\.ts$/);
  ok('unmute: cargadores de hls.js (playlist y fallback de segmento)');

  const sub = boot({ subonly: true, usher: 403, media: '#EXTM3U\n#EXTINF:10,\n0-muted.ts\n' });
  const sr = await sub.w.Api.playback({ type: 'video', id: '777' });
  assert.equal(sr.subonly, true);
  assert.equal(sr.muted, true);
  assert.match(sr.master, /^https:\/\/video-weaver\.example\/ABC\/chunked\/index-dvr\.m3u8$/);
  assert.deepEqual(J(sr.variants.map((x) => x.name)), ['1080p60', '720p60', '480p30', '360p30', '160p30']);
  assert.ok(sr.variants.every((x) => /^https:\/\/video-weaver\.example\/ABC\/[^/]+\/index-dvr\.m3u8$/.test(x.url)));
  ok('playback: VOD solo para suscriptores (CDN desde seekPreviewsURL)');

  const inst = { destroyed: false, loaded: '', attached: false, handlers: {}, config: null,
    on(e, f) { this.handlers[e] = f; }, attachMedia() { this.attached = true; },
    loadSource(s) { this.loaded = s; }, destroy() { this.destroyed = true; } };
  function FakeHls(config) { inst.config = config; return inst; }
  FakeHls.DefaultConfig = { loader: function () {} };
  FakeHls.DefaultConfig.loader.prototype.load = function () {};
  FakeHls.isSupported = () => true;
  FakeHls.Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
  FakeHls.ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
  const m = boot({ media: '#EXTM3U\n#EXTINF:10,\n0-muted.ts\n', beforeScripts: (win) => { win.Hls = FakeHls; } });
  const v = m.$('v');
  m.w.Player.open({ type: 'video', id: '905', name: 'Chan', title: 'VOD silenciado', duration: 100 }, () => {});
  await m.until(() => inst.loaded, 'hls.js bajo demanda');
  assert.ok(inst.attached);
  assert.match(inst.loaded, /usher\.ttvnw\.net\/vod\/905\.m3u8/);
  assert.equal(typeof inst.config.pLoader, 'function');
  assert.equal(typeof inst.config.fLoader, 'function');

  // apagar el ajuste en caliente vuelve al reproductor nativo; encenderlo lo reactiva
  m.key(m.K.green);
  m.key(m.K.down); m.key(m.K.down); m.key(m.K.right);
  assert.equal(m.w.Settings.get('unmute'), 'off');
  assert.equal(inst.destroyed, true, 'apagar el ajuste destruye hls.js');
  assert.match(v.getAttribute('src') || '', /usher\.ttvnw\.net\/vod\/905\.m3u8/, 'vuelve al flujo nativo');
  inst.destroyed = false; inst.loaded = '';
  m.key(m.K.left);
  assert.equal(m.w.Settings.get('unmute'), 'on');
  await m.until(() => inst.loaded, 'hls.js de nuevo al reactivar el audio');
  m.key(m.K.back);
  m.key(m.K.back);
  assert.equal(inst.destroyed, true, 'salir destruye hls.js');
  ok('VOD silenciado: usa hls.js bajo demanda, respeta el ajuste en caliente y lo destruye al salir');

  // bloqueo de anuncios: el filtro quita los segmentos del anunciante y las marcas stitched-ad
  const A = m.w.Adblock;
  const AD = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-DATERANGE:ID="ad1",CLASS="twitch-stitched-ad",START-DATE="2026-11-02T10:00:00.000Z",DURATION=4.0\n' +
    '#EXTINF:2.000,live\nl1.ts\n#EXTINF:2.000,Amazon|123\na1.ts\n#EXTINF:2.000,Amazon|123\na2.ts\n#EXTINF:2.000,live\nl2.ts\n#EXT-X-TWITCH-PREFETCH:p1.ts\n';
  const cleaned = A.filterVariantPlaylist(AD);
  assert.ok(cleaned.indexOf('l1.ts') >= 0 && cleaned.indexOf('l2.ts') >= 0, 'los segmentos de la emisión se conservan');
  assert.ok(!/a1\.ts|a2\.ts|Amazon|stitched-ad|PREFETCH/.test(cleaned), 'sin anuncio, marca ni precarga');
  assert.ok(cleaned.indexOf('#EXT-X-MEDIA-SEQUENCE:7') >= 0);
  const clean = '#EXTM3U\n#EXTINF:2.000,live\nl1.ts\n#EXT-X-TWITCH-PREFETCH:p1.ts\n';
  assert.equal(A.filterVariantPlaylist(clean), clean, 'sin anuncios no se toca');
  const allAds = '#EXTM3U\n#EXTINF:2.000,Amazon|1\na1.ts\n#EXTINF:2.000,Amazon|1\na2.ts\n';
  assert.equal(A.filterVariantPlaylist(allAds), allAds, 'si todo es anuncio no se vacía la lista');
  // el cargador filtra solo las listas de medios, no la maestra
  const FH = function () {}; FH.DefaultConfig = { loader: function () {} };
  FH.DefaultConfig.loader.prototype.load = function (ctx, cfg, cb) { cb.onSuccess({ data: ctx.body }, {}, ctx, null); };
  const PL = A.makeAdblockLoaders(FH).pLoader;
  const loaded = (body) => { let r; new PL({}).load({ body }, {}, { onSuccess: (x) => { r = x.data; } }); return r; };
  assert.equal(loaded(AD), cleaned, 'la lista de medios sale filtrada');
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://x/v.m3u8\n#EXTINF:2.000,Amazon|1\n';
  assert.equal(loaded(master), master, 'la lista maestra no se toca');
  ok('bloqueo de anuncios: el filtro quita segmentos del anunciante y respeta listas sin ellos');

  // lista solo de anuncios (mid-roll): se sustituye por la del respaldo; si el respaldo falla se deja pasar el anuncio y se avisa
  assert.equal(A.onlyAds(allAds), true);
  assert.equal(A.onlyAds(AD), false, 'con segmentos de la emisión no es solo anuncio');
  assert.equal(A.onlyAds(clean), false);
  assert.equal(A.onlyAds('#EXTM3U\n'), false);
  const BK = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9\n#EXTINF:2.000,live\nb1.ts\n#EXTINF:2.000,live\nb2.ts\n';
  const run = (body, opts) => { let r; const calls = { backup: 0, leak: 0 };
    const PB = A.makeAdblockLoaders(FH, { backup: (done) => { calls.backup++; opts.backup(done); }, onLeak: () => { calls.leak++; } }).pLoader;
    new PB({}).load({ body }, {}, { onSuccess: (x) => { r = x.data; } }); return { r: () => r, calls }; };
  let b = run(allAds, { backup: (done) => done(BK) });
  assert.equal(b.r(), BK, 'mid-roll: se sirve la lista del respaldo');
  assert.deepEqual(b.calls, { backup: 1, leak: 0 });
  b = run(allAds, { backup: (done) => done('') });
  assert.equal(b.r(), allAds, 'respaldo vacío: pasa el anuncio original');
  assert.deepEqual(b.calls, { backup: 1, leak: 1 }, 'y se avisa de la fuga');
  b = run(allAds, { backup: (done) => done('#EXTM3U\n#EXTINF:2.000,Amazon|9\nz.ts\n') });
  assert.equal(b.r(), allAds, 'un respaldo que también trae solo anuncio no vale');
  assert.equal(b.calls.leak, 1);
  // empieza un anuncio: segmentos de la emisión y, tras ellos, los del anunciante -> respaldo ya, sin esperar a que todo sea anuncio
  assert.equal(A.needsBackup(AD), true, 'anuncio tras la emisión');
  assert.equal(A.needsBackup(allAds), true);
  assert.equal(A.needsBackup(clean), false);
  b = run(AD, { backup: (done) => done(BK) });
  assert.equal(b.r(), BK, 'al empezar el anuncio se sirve el respaldo');
  assert.deepEqual(b.calls, { backup: 1, leak: 0 });
  b = run(AD, { backup: (done) => done('') });
  assert.equal(b.r(), cleaned, 'si el respaldo falla se filtra el anuncio');
  assert.deepEqual(b.calls, { backup: 1, leak: 0 }, 'y no es fuga: aún queda emisión');
  // el anuncio acaba: solo quedan restos al principio de la lista -> se quitan y la secuencia avanza, sin respaldo
  const HEAD = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:2.000,Amazon|1\na1.ts\n#EXTINF:2.000,Amazon|1\na2.ts\n#EXTINF:2.000,live\nl1.ts\n#EXTINF:2.000,live\nl2.ts\n';
  assert.equal(A.needsBackup(HEAD), false, 'anuncio solo al principio');
  b = run(HEAD, { backup: (done) => done(BK) });
  assert.equal(b.r(), '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9\n#EXTINF:2.000,live\nl1.ts\n#EXTINF:2.000,live\nl2.ts\n', 'se quitan y la numeración avanza');
  assert.deepEqual(b.calls, { backup: 0, leak: 0 });
  let late; const PL2 = A.makeAdblockLoaders(FH, { backup: (done) => { late = done; }, onLeak() {} }).pLoader;
  let got; new PL2({}).load({ body: allAds }, {}, { onSuccess: (x) => { got = x.data; } });
  assert.equal(got, undefined, 'espera al respaldo antes de entregar la lista');
  late(BK);
  assert.equal(got, BK);
  ok('bloqueo de anuncios: mid-roll sustituido por la lista de respaldo, con salida segura si falla');

  // directo con el ajuste activo: se reproduce por hls.js; apagarlo en caliente vuelve al reproductor nativo
  const li = { destroyed: false, loaded: '', attached: false, handlers: {}, config: null,
    on(e, f) { this.handlers[e] = f; }, attachMedia() { this.attached = true; },
    loadSource(x) { this.loaded = x; }, destroy() { this.destroyed = true; } };
  function LiveHls(config) { li.config = config; return li; }
  LiveHls.DefaultConfig = FakeHls.DefaultConfig; LiveHls.isSupported = () => true;
  LiveHls.Events = FakeHls.Events; LiveHls.ErrorTypes = FakeHls.ErrorTypes;
  const lv = boot({ ls: { settings: JSON.stringify({ adblock: 'on', usher: 'html5' }) }, beforeScripts: (win) => { win.Hls = LiveHls; } });
  lv.w.Player.open({ type: 'stream', login: 'foo', name: 'Foo', title: 'Directo' }, () => {});
  await lv.until(() => li.loaded, 'hls.js para el directo');
  assert.ok(li.attached);
  assert.match(li.loaded, /usher\.ttvnw\.net\/api\/channel\/hls\/foo\.m3u8\?player=html5&/, 'usa el tipo de reproductor elegido');
  assert.equal(typeof li.config.pLoader, 'function');
  assert.equal(lv.$('v').getAttribute('src'), null, 'el flujo va por MSE, no por src');

  // el token y la lista maestra del respaldo se piden con antelación, en cuanto el directo arranca por hls.js
  const bkCalls = () => lv.N.calls.filter((c) => c.url.includes('gql') && /picture-by-picture/.test(c.opts.body || '')).length;
  assert.equal(bkCalls(), 0, 'antes de arrancar no se pide');
  li.handlers.manifest();
  await lv.until(() => bkCalls() === 1, 'respaldo precargado');
  li.handlers.manifest();
  await sleep(50);
  assert.equal(bkCalls(), 1, 'con el respaldo reciente no se vuelve a pedir');
  ok('directo con hls.js: el respaldo de anuncios se precarga una sola vez');

  // atasco con hls.js (p. ej. al pasar de un anuncio a la lista de respaldo): se recarga el flujo sin saltar al borde
  const lvv = lv.$('v');
  Object.defineProperty(lvv, 'paused', { value: false, configurable: true });
  lvv.setAttribute('src', 'blob:atasco');
  lv.w.CONFIG.STALL_MS = 40;
  const lvUsher = () => lv.N.calls.filter((c) => c.url.startsWith('https://usher.ttvnw.net')).length;
  const lvBefore = lvUsher();
  li.destroyed = false; li.loaded = '';
  lvv.dispatchEvent(new lv.w.Event('waiting'));
  await lv.until(() => lvUsher() === lvBefore + 1, 'recarga del directo atascado con hls.js');
  assert.equal(li.destroyed, true, 'la recarga destruye la instancia de hls.js');
  await lv.until(() => li.loaded, 'hls.js de nuevo tras la recarga');
  lv.w.CONFIG.STALL_MS = 8000;
  ok('directo con hls.js: un atasco recarga el flujo');
  lv.key(lv.K.green);
  for (let i = 0; i < 3; i++) lv.key(lv.K.down);
  lv.key(lv.K.right);
  assert.equal(lv.w.Settings.get('adblock'), 'off');
  await lv.until(() => li.destroyed, 'apagar el ajuste destruye hls.js');
  await lv.until(() => lv.$('v').getAttribute('src'), 'vuelve al flujo nativo');
  lv.key(lv.K.back);
  lv.key(lv.K.back);
  ok('directo: el bloqueo de anuncios usa hls.js, respeta el tipo de reproductor y se apaga en caliente');

  const s = J(await w.Api.search('fo o'));
  assert.deepEqual(s.items.map((i) => [i.login, i.live, i.type]), [['bar', true, 'channel'], ['foo', false, 'channel']]);
  assert.equal(s.items[0].viewers, 5);
  ok('búsqueda: canales, sin duplicados, en directo primero');

  let cv = J(await w.Api.channelVideos('chan1', null));
  assert.deepEqual(cv.items.map((i) => i.type), ['stream', 'video', 'video']);
  assert.equal(cv.items[1].duration, 3725);
  assert.equal(cv.items[1].login, 'chan1', 'el vídeo sabe de qué canal es (para sus emotes)');
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
  assert.equal(w.Auth.login(), 'demo_user');
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
  const t2 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'old', refresh: 'r-old', userId: '42', login: 'demo_user', cid: 'cid123' }) } });
  await t2.until(() => JSON.parse(t2.w.localStorage.getItem('tauth') || '{}').access === 'acc2', 'refresh al arrancar');
  assert.equal(t2.w.Auth.login(), 'demo_user');
  ok('arranque con token caducado: refresh automático');

  // Refresh inválido: la sesión se descarta
  const t3 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'old', refresh: 'bad', userId: '42', login: 'demo_user', cid: 'cid123' }) } });
  await t3.until(() => !t3.w.Auth.isLoggedIn(), 'sesión descartada');
  assert.equal(t3.w.localStorage.getItem('tauth'), null);
  ok('arranque con refresh inválido: sesión descartada');

  // 401 en Helix a la vez que Auth.init: una sola renovación compartida (refresh token de un solo uso)
  const t5 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'stale', refresh: 'r-old', userId: '42', login: 'demo_user', cid: 'cid123' }) } });
  const r5 = J(await t5.w.Auth.followedStreams(null));
  assert.equal(r5.items.length, 2);
  assert.equal(JSON.parse(t5.w.localStorage.getItem('tauth')).access, 'acc2');
  assert.equal(t5.N.calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 1, 'debe haber una sola renovación');
  ok('Helix 401 + init concurrentes: una sola renovación, reintento correcto');

  // Una sesión guardada con otro Client ID no sirve (el token no vale para el nuevo): se descarta
  const t6 = boot({ clientId: 'otro-cliente', ls: { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'demo_user', cid: 'cid123' }) } });
  assert.equal(t6.w.Auth.isLoggedIn(), false);
  const t7 = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'demo_user', cid: 'cid123' }) } });
  assert.equal(t7.w.Auth.isLoggedIn(), true);
  ok('sesión de otro Client ID: se descarta; la del mismo se conserva');
}

/* ---------- 3b) puntos automáticos ---------- */
{
  const TV = 'ue6666qo983tsx6so1t0vnawi233wa';
  const session = { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'demo_user', cid: TV }) };
  const gqlCalls = (t) => t.N.calls.filter((c) => c.url.includes('gql') && /ChannelPointsContext|ClaimCommunityPoints/.test(c.opts.body));

  // sin sesión: no hace ninguna petición
  let t = boot();
  t.w.Points.start('chan1', () => {});
  await sleep(50);
  assert.equal(gqlCalls(t).length, 0);
  assert.equal(t.w.Points.enabled(), false);

  // con otro Client ID el GraphQL privado rechazaría el token: desactivado
  t = boot({ clientId: 'cid123', ls: { tauth: JSON.stringify({ access: 'acc1', userId: '42', login: 'demo_user', cid: 'cid123' }) } });
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

  // el aviso de visionado ("minute-watched") sale antes de consultar el cofre y lleva los ids del canal
  const spadeCalls = (x) => x.N.calls.filter((c) => c.url === 'https://spade.twitch.tv/track');
  t = boot({ ls: session });
  t.w.Points.start('chan1', () => {}, () => true);
  await t.until(() => spadeCalls(t).length === 1, 'aviso de visionado');
  const sp = spadeCalls(t)[0];
  assert.equal(sp.opts.method, 'POST');
  assert.equal(sp.opts.mode, 'no-cors');
  assert.equal(sp.opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const ev = JSON.parse(t.w.atob(decodeURIComponent(sp.opts.body.replace(/^data=/, ''))));
  assert.deepEqual(J(ev), [{ event: 'minute-watched', properties: { channel_id: 'chan-id', broadcast_id: 'bcast-1', player: 'site', user_id: '42', live: true, channel: 'chan1' } }]);
  await t.until(() => gqlCalls(t).length === 1, 'consulta de puntos tras el aviso');
  t.w.Points.stop();

  // en pausa (o con la pestaña oculta) no cuenta como estar viendo: ni aviso ni consulta de ids
  t = boot({ ls: session });
  t.w.Points.start('chan1', () => {}, () => false);
  await t.until(() => gqlCalls(t).length === 1, 'consulta de puntos en pausa');
  assert.equal(spadeCalls(t).length, 0, 'en pausa no se avisa de visionado');
  assert.equal(t.N.calls.filter((c) => c.url.includes('gql') && /stream{id}/.test(c.opts.body)).length, 0);
  t.w.Points.stop();
  ok('puntos: avisa de visionado (minute-watched) solo mientras se reproduce y con los ids del canal');

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

/* ---------- 3c) contenido de mi país (filtro de idioma del emisor) ---------- */
{
  const qs = (t, re) => t.N.calls.filter((c) => c.url.includes('gql') && re.test(String(c.opts.body))).map((c) => JSON.parse(c.opts.body).query);
  const filt = /broadcasterLanguages:\[ES\]/;
  // idioma del sistema -> código de Twitch (función pura)
  const { w: lw } = boot();
  assert.deepEqual(['es-ES', 'pt-BR', 'EN', 'zh-Hant-TW', 'xx-XX', '', undefined].map((x) => lw.Api.lang(x)), ['ES', 'PT', 'EN', 'ZH', '', '', '']);
  ok('filtro de país: es-ES → ES, pt-BR → PT y un idioma no soportado → sin filtro');

  // por defecto (es-ES): Inicio y los directos de una categoría se filtran; el listado de categorías no
  let t = boot();
  await t.until(() => t.cards().length === 6, 'inicio');
  let sq = qs(t, /streams\(first/);
  assert.ok(sq.length >= 1 && sq.every((q) => filt.test(q)), 'Inicio filtra por ES');
  t.focusTab('games'); t.key(t.K.ok);
  await t.until(() => t.cards().length === 3, 'categorías');
  assert.ok(qs(t, /games\(first/).every((q) => !/broadcasterLanguages/.test(q)), 'el listado de categorías no se filtra');
  t.key(t.K.ok);
  await t.until(() => t.cards().length === 2, 'directos de la categoría');
  assert.ok(qs(t, /game\(name/).every((q) => /game\(name:"game1"\)\{streams\(first:24,options:\{broadcasterLanguages:\[ES\]\}/.test(q)), 'la categoría filtra sus directos');
  ok('filtro de país: Inicio y directos de una categoría filtran por ES; el listado de categorías no');

  // idioma no soportado, o ajuste en "Todo" -> sin filtro
  t = boot({ lang: 'xx-XX' });
  await t.until(() => t.cards().length === 6, 'inicio sin filtro');
  sq = qs(t, /streams\(first/);
  assert.ok(sq.length >= 1 && sq.every((q) => !/broadcasterLanguages/.test(q)), 'idioma no soportado: sin filtro');
  t = boot({ ls: { settings: JSON.stringify({ cfilter: 'off' }) } });
  await t.until(() => t.cards().length === 6, 'inicio con el ajuste en Todo');
  sq = qs(t, /streams\(first/);
  assert.ok(sq.length >= 1 && sq.every((q) => !/broadcasterLanguages/.test(q)), 'ajuste Todo: sin filtro');
  ok('filtro de país: idioma no soportado o ajuste "Todo" → sin filtro');

  // primera página filtrada vacía → segunda petición sin filtro; las páginas siguientes también sin filtro
  t = boot({ emptyLang: true });
  await t.until(() => t.cards().length === 6, 'fallback sin filtro');
  sq = qs(t, /streams\(first/);
  assert.equal(sq.length, 2, 'una petición filtrada y otra sin filtro');
  assert.ok(filt.test(sq[0]) && !/broadcasterLanguages/.test(sq[1]));
  const fb = boot({ emptyLang: true });
  const p1 = J(await fb.w.Api.topStreams(null));
  assert.equal(p1.cursor, '#c6', 'el cursor de la página sin filtro lleva prefijo');
  await fb.w.Api.topStreams(p1.cursor);
  const next = qs(fb, /after:/);
  assert.equal(next.length, 1);
  assert.ok(/after:"c6"/.test(next[0]) && !/broadcasterLanguages/.test(next[0]), 'la página siguiente sigue sin filtro');
  ok('filtro de país: si no hay directos del idioma, Inicio pide sin filtro (y sigue sin filtro al paginar)');

  // lo mismo dentro de una categoría: nunca vacía habiendo gente emitiendo en otro idioma
  const gf = boot({ emptyLang: true });
  const g1 = J(await gf.w.Api.gameStreams('just chatting', null));
  assert.equal(g1.items.length, 2, 'la categoría muestra directos aunque no haya en tu idioma');
  const gq = qs(gf, /game\(name/);
  assert.equal(gq.length, 2, 'una petición filtrada y otra sin filtro');
  assert.ok(filt.test(gq[0]) && !/broadcasterLanguages/.test(gq[1]));
  assert.equal(g1.cursor, '#c2', 'cursor sin filtro con prefijo');
  await gf.w.Api.gameStreams('just chatting', g1.cursor);
  const gn = qs(gf, /game\(name/).pop();
  assert.ok(/after:"c2"/.test(gn) && !/broadcasterLanguages/.test(gn), 'la página siguiente sigue sin filtro');
  ok('filtro de país: una categoría sin directos en tu idioma también muestra todos');

  // cambiar el ajuste con la app abierta recarga Inicio con el nuevo criterio
  t = boot();
  await t.until(() => t.cards().length === 6, 'inicio');
  const n0 = qs(t, /streams\(first/).length;
  t.key(t.K.green);
  t.key(t.K.down);                                            // fila 2: contenido de mi país
  t.key(t.K.right);                                           // Automático → Todo
  assert.equal(t.w.Settings.get('cfilter'), 'off');
  await t.until(() => qs(t, /streams\(first/).length > n0 && t.cards().length === 6, 'recarga de Inicio');
  assert.ok(!/broadcasterLanguages/.test(qs(t, /streams\(first/).pop()), 'Inicio sin filtro tras el cambio');
  t.key(t.K.green);
  ok('filtro de país: cambiar el ajuste recarga Inicio');
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
  assert.deepEqual(t.btnNames(), ['pause', 'quality', 'chat', 'close'], 'un directo: pausa, calidad, chat y salir');
  assert.equal(t.pb().getAttribute('data-a'), 'pause', 'el foco empieza en Pausa');
  key(K.right); key(K.ok); assert.equal($('qmenu').hidden, false, 'el botón Calidad abre el menú');
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
  assert.equal($('acct').textContent, 'demo_user');
  await until(() => $('acct').querySelector('img.av'), 'avatar en el botón');
  assert.equal($('acct').querySelector('img.av').getAttribute('src'), 'http://avatar/self-70x70.png');
  assert.equal($('acct').textContent, 'demo_user', 'el nombre sigue ahí junto a la foto');
  await until(() => cards().length === 2, 'siguiendo tras login');
  assert.notEqual(focused().id, 'acct', 'el foco no debe quedar en el botón de cuenta');
  assert.equal(d.querySelector('#grid .card .ti').textContent, 'Sig 1');
  ok('Login por QR → "demo_user" y Siguiendo se recarga con sus directos');

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
  assert.deepEqual(t.btnNames(), ['back', 'pause', 'fwd', 'quality', 'chat', 'close'], 'un VOD: saltos, pausa, calidad, chat y salir');
  key(K.right); key(K.ok);                                   // botón 10 s ▶: no debe romper aunque no haya duración real
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
  assert.match($('ls').textContent, /Sesión iniciada como demo_user/);
  await until(() => $('lqr').querySelector('img'), 'foto en la pantalla de cuenta');
  assert.equal($('lqr').querySelector('img').getAttribute('src'), 'http://avatar/self-300x300.png');
  key(K.ok); key(K.ok);                                      // OK inmediatos: se ignoran
  assert.equal(w.Auth.isLoggedIn(), true, 'un OK inmediato no debe cerrar la sesión');
  await sleep(750);
  key(K.ok);                                                 // pide confirmación
  assert.match($('ls').textContent, /¿Cerrar la sesión de demo_user\?/);
  assert.equal(w.Auth.isLoggedIn(), true);
  key(K.ok);                                                 // inmediato: ignorado
  assert.equal(w.Auth.isLoggedIn(), true);
  key(K.back);                                               // cancelar
  assert.equal($('login').hidden, true);
  assert.equal(w.Auth.isLoggedIn(), true, 'cancelar no cierra la sesión');
  assert.equal($('acct').textContent, 'demo_user');
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
  // reloj simulado (el reproductor usa Date.now) para simular pausas largas sin esperar
  let skew = 0; const realNow = w.Date.now; w.Date.now = () => realNow() + skew;
  const usher = () => t.N.calls.filter((c) => c.url.startsWith('https://usher.ttvnw.net')).length;

  assert.equal(v.paused, false);
  key(K.ok);                                                  // OK = pausa
  assert.equal(v.paused, true);
  await until(() => !$('pstate').hidden, 'indicador de pausa');
  assert.match($('pstate').textContent, /En pausa/);
  assert.match($('bpause').textContent, /Reproducir/, 'en pausa el botón ofrece reproducir');
  assert.equal($('qmenu').hidden, true, 'OK ya no abre el menú de calidad');
  await sleep(4300);
  assert.equal($('ovl').hidden, false, 'en pausa el panel no se oculta');
  key(K.ok);                                                  // OK = reanudar
  assert.equal(v.paused, false);
  await until(() => $('pstate').hidden, 'sin indicador al reanudar');
  ok('reproductor: OK pausa y reanuda (el panel se queda visible en pausa)');

  // el panel oculto: las flechas solo lo muestran, OK pausa
  await until(() => $('pstate').hidden, 'sin indicador');
  assert.match($('bpause').textContent, /^Pausa$/);
  $('ovl').hidden = true;
  key(K.right);
  assert.equal($('ovl').hidden, false, 'una flecha muestra el panel');
  assert.equal(v.paused, false, 'una flecha con el panel oculto no hace nada más');
  assert.equal(t.pb().getAttribute('data-a'), 'pause');
  $('ovl').hidden = true;
  key(K.ok);
  assert.equal(v.paused, true, 'OK con el panel oculto pausa');
  assert.equal($('ovl').hidden, false);
  key(K.ok);
  assert.equal(v.paused, false);
  ok('reproductor: con el panel oculto, una flecha lo muestra y OK pausa');

  // el puntero del mando también vale
  $('bpause').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(v.paused, true, 'pulsar el botón Pausa con el puntero');
  $('bpause').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(v.paused, false);
  await until(() => $('pstate').hidden, 'sin indicador tras el puntero');

  // directo en pausa: al reanudar tras más de 2 s salta al borde en vivo (una sola vez, sin bucles)
  v.__t = 1000; v.__seeks = 0; v.__live = 5000;
  key(K.ok); await sleep(20);                                 // pausa (el evento llega en el turno siguiente)
  skew += 2500; v.__live = 5030;
  key(K.ok); await sleep(20);                                 // reanudar
  assert.equal(v.paused, false);
  assert.equal(v.__t, 5030, 'tras una pausa de 2,5 s salta al borde en vivo');
  await sleep(150);
  assert.equal(v.__seeks, 1, 'el salto se aplica una sola vez');
  assert.equal(v.paused, false);
  ok('directo: tras una pausa larga, reanudar salta al borde en vivo');

  // una pausa corta (<2 s) continúa donde se paró
  v.__seeks = 0;
  key(K.ok); await sleep(20); skew += 500; v.__live = 5100;
  key(K.ok); await sleep(20);
  assert.equal(v.__seeks, 0, 'una pausa corta no salta');
  assert.equal(v.paused, false);

  // directo sin rangos seekables: al reanudar se recarga el flujo (token nuevo)
  v.__live = undefined;
  let before = usher();
  key(K.ok); await sleep(20); skew += 3000;
  key(K.ok); await sleep(20);
  await until(() => usher() === before + 1, 'recarga del directo sin rangos');
  await until(() => v.getAttribute('src'), 'src tras recargar el directo');
  await sleep(50);
  assert.equal(usher(), before + 1, 'la recarga ocurre una sola vez');
  assert.equal(v.paused, false);
  ok('directo: sin rangos seekables, reanudar recarga el flujo una sola vez');

  // atasco en un directo: la posición se pasa del final de la lista y el reproductor nativo no avanza solo
  w.CONFIG.STALL_MS = 40;
  v.__live = 5200; v.__t = 5210; v.__seeks = 0;
  before = usher();
  v.dispatchEvent(new w.Event('waiting'));
  await until(() => v.__seeks === 1, 'salto al borde en vivo tras el atasco');
  assert.equal(v.__t, 5197, 'salta 3 s antes del borde en vivo');
  assert.equal(usher(), before, 'primero salta, sin recargar');
  await until(() => usher() === before + 1, 'recarga si sigue atascado');
  await until(() => v.getAttribute('src'), 'src tras recargar el atasco');
  await sleep(150);
  assert.equal(usher(), before + 1, 'la recarga ocurre una sola vez');
  // si el vídeo se recupera antes de que venza el plazo, no se toca nada
  v.__live = 5300; v.__t = 5290; v.__seeks = 0; before = usher();
  v.dispatchEvent(new w.Event('waiting'));
  v.dispatchEvent(new w.Event('playing'));
  await sleep(200);
  assert.equal(v.__seeks, 0, 'recuperado: no salta');
  assert.equal(usher(), before, 'recuperado: no recarga');
  w.CONFIG.STALL_MS = 8000;
  ok('directo: un atasco salta al borde en vivo y, si sigue parado, recarga el flujo; si se recupera, no hace nada');

  // pausa muy larga (lista HLS caducada): se recarga aunque haya borde en vivo
  v.__live = 6000; v.__t = 0; v.__seeks = 0; before = usher();
  key(K.ok); await sleep(20); skew += 40000;
  key(K.ok); await sleep(20);
  await until(() => usher() === before + 1, 'recarga tras una pausa muy larga');
  await sleep(50);
  assert.equal(v.__seeks, 0, 'tras una pausa muy larga recarga en lugar de saltar');
  v.__live = undefined;
  ok('directo: tras una pausa muy larga (30 s o más) se recarga el flujo');

  // calidad: botón del panel
  t.goBtn('quality'); key(K.ok);
  assert.equal($('qmenu').hidden, false);
  key(K.down); key(K.ok);                                     // elige 1080p
  assert.match(v.getAttribute('src'), /AAA\.m3u8/);
  assert.match($('bqual').textContent, /^Calidad · 1080p60/, 'el botón muestra la calidad actual');
  t.goBtn('quality'); key(K.ok); assert.equal($('qmenu').hidden, false);
  key(K.back); assert.equal($('qmenu').hidden, true);
  assert.equal(w.Player.isOpen(), true, 'Atrás en el menú solo cierra el menú');
  ok('reproductor: el botón Calidad abre el menú, Atrás solo lo cierra');

  // botón Chat (desactivado por defecto)
  assert.equal(w.Chat.isOn(), false);
  assert.equal(t.sockets.length, 0, 'sin chat no hay conexión');
  t.goBtn('chat'); key(K.ok);
  assert.equal(w.Chat.isOn(), true);
  assert.ok($('bchat').classList.contains('act'), 'el botón Chat se marca al activarlo');
  assert.equal($('chat').hidden, false);
  assert.ok($('player').classList.contains('chat'));
  await until(() => t.sockets.length === 1, 'conexión del chat');
  assert.equal(t.sockets[0].url, 'wss://irc-ws.chat.twitch.tv:443');
  key(K.ok);
  assert.equal(w.Chat.isOn(), false);
  assert.ok(!$('bchat').classList.contains('act'));
  assert.equal($('chat').hidden, true);
  assert.equal(t.sockets[0].closed, true, 'al ocultar el chat se cierra la conexión');
  assert.equal(w.localStorage.getItem('chat'), '0');
  t.goBtn('close'); key(K.ok);
  assert.equal(w.Player.isOpen(), false, 'el botón Salir cierra el reproductor');
  ok('reproductor: el botón Chat muestra/oculta el chat (solo conecta si está visible) y Salir cierra');

  // VOD: saltos acelerados
  w.Player.open({ type: 'video', id: '901', name: 'Chan1', title: 'VOD', date: '', game: '', duration: 3725 }, () => {});
  await until(() => v.getAttribute('src'), 'src del VOD');
  // un VOD no salta al reanudar tras una pausa larga, aunque el vídeo tuviera rangos seekables
  v.__t = 100; v.__live = 9999; v.__seeks = 0;
  key(K.ok); await sleep(20); skew += 5000;
  key(K.ok); await sleep(20);
  assert.equal(v.paused, false);
  assert.equal(v.__t, 100, 'en un VOD reanudar no salta');
  assert.equal(v.__seeks, 0);
  v.__live = undefined;
  ok('VOD: reanudar tras una pausa larga no salta');
  v.__d = 3725; v.__t = 100; v.__seeks = 0;
  key(K.right); key(K.left);                                  // en los botones las flechas no saltan
  await sleep(600);
  assert.equal(v.__seeks, 0, 'las flechas sobre los botones solo mueven el foco');
  key(K.up);
  assert.ok($('obar').classList.contains('foc'), '▲ enfoca la barra de progreso');
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
  ok('VOD: saltos acelerados con la barra enfocada (10→10→30→30→60 s…), un solo seek y límites 0 / final');

  // botones ◀ 10 s / 10 s ▶ del panel
  await sleep(800);
  v.__t = 500;
  t.goBtn('fwd'); key(K.ok); await sleep(600);
  assert.equal(v.__t, 510, 'el botón 10 s ▶ salta 10 s');
  await sleep(800);
  t.goBtn('back'); key(K.ok); await sleep(600);
  assert.equal(v.__t, 500, 'el botón ◀ 10 s retrocede 10 s');
  key(K.up); assert.ok($('obar').classList.contains('foc'));
  key(K.down); assert.equal(t.pb().getAttribute('data-a'), 'pause', '▼ en la barra vuelve a los botones');
  ok('VOD: botones de salto ±10 s y ▲ ▼ entre barra y botones');

  // cambiar de calidad no pierde la posición (la lista HLS nueva empieza en 0)
  await sleep(800);
  v.__t = 1234; v.__seeks = 0;
  const srcBefore = v.getAttribute('src');
  t.goBtn('quality'); key(K.ok); key(K.down); key(K.ok);
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
  w.Player.open({ type: 'video', id: '904', login: 'chan1', name: 'Chan1', title: 'Siguiente', date: '', game: '', duration: 5000 }, () => {});
  await until(() => v.getAttribute('src'), 'src del siguiente');
  assert.match(v.getAttribute('src'), /usher\.ttvnw\.net\/vod\/904\.m3u8/, 'no vuelve a elegir la calidad que falló');
  ok('VOD: una calidad que falla vuelve a Auto sin perder la posición y no se vuelve a elegir');
  w.localStorage.removeItem('tq');

  // chat de un VOD: la repetición, sincronizada con la posición del vídeo (sin WebSocket)
  const gqlComments = () => t.N.calls.filter((c) => c.url.includes('gql') && /comments\(/.test(String(c.opts.body))).map((c) => String(JSON.parse(c.opts.body).query));
  const lastMsg = () => $('cmsgs').lastChild && $('cmsgs').lastChild.lastChild.textContent;
  assert.equal($('bchat').hidden, false, 'un VOD también tiene botón de chat');
  assert.equal(w.Chat.isOn(), false);
  assert.equal(gqlComments().length, 0, 'con el chat apagado no se piden comentarios');
  v.__d = 5000; v.__t = 100; v.__live = undefined;
  t.goBtn('chat'); key(K.ok);
  assert.equal(w.Chat.isOn(), true);
  assert.ok($('player').classList.contains('chat'));
  await until(() => lastMsg() === 'msg 100', 'mensajes del chat del VOD hasta la posición 100');
  assert.match(gqlComments()[0], /contentOffsetSeconds:90,/, 'empieza 10 s antes de la posición');
  assert.equal($('cmsgs').lastChild.firstChild.textContent, 'U100:');
  assert.equal(w.Emotes._stats().want, 'chan1', 'el chat del VOD usa los emotes del canal del vídeo');
  assert.ok($('cmsgs').children.length <= 8, 'tras el arranque solo se pintan los más recientes');
  assert.equal(t.sockets.length, 1, 'un VOD no abre WebSocket');
  await sleep(600);
  assert.equal(lastMsg(), 'msg 100', 'sin avanzar el vídeo no salen mensajes nuevos (ni del futuro)');
  v.__t = 103;
  await until(() => lastMsg() === 'msg 103', 'mensajes al avanzar el vídeo');
  assert.equal($('cmsgs').lastChild.firstChild.style.color, 'rgb(255, 69, 0)', 'color del usuario');
  ok('VOD: chat de la repetición sincronizado con la posición (nada del futuro, sin WebSocket)');

  v.__t = 1000;                                               // salto: se vacía y se pide desde la nueva posición
  await until(() => lastMsg() === 'msg 1000', 'chat tras un salto');
  assert.ok(gqlComments().some((q) => /contentOffsetSeconds:990,/.test(q)));
  assert.ok(![...$('cmsgs').children].some((n) => /^msg (1\d\d|\d\d)$/.test(n.lastChild.textContent)), 'lo anterior al salto desaparece');
  for (const s of [1006, 1012, 1018, 1024]) { v.__t = s; await sleep(300); }
  await until(() => gqlComments().some((q) => /after:"c1049"/.test(q)), 'página siguiente con el cursor');
  v.__t = 500;                                                // retroceder también es un salto
  await until(() => lastMsg() === 'msg 500', 'chat tras retroceder');
  ok('VOD: saltar o retroceder reinicia el chat y se pide la página siguiente con el cursor');

  t.goBtn('chat'); key(K.ok);
  assert.equal(w.Chat.isOn(), false);
  assert.equal($('chat').hidden, true);
  const nq = gqlComments().length;
  v.__t = 505; await sleep(400);
  assert.equal(gqlComments().length, nq, 'con el chat apagado deja de pedir comentarios');
  key(K.back);
  ok('VOD: apagar el chat o salir detiene las peticiones');
}

/* ---------- 6b) anuncios en directos ---------- */
{
  const { w } = boot();
  const base = Date.parse('2026-11-02T17:00:00.000Z');
  const iso = (ms) => new Date(ms).toISOString();
  const seg = (i, title = 'live') => `#EXT-X-PROGRAM-DATE-TIME:${iso(base + i * 2000)}\n#EXTINF:2.000,${title}\nhttps://seg/${i}.ts`;
  const list = (titles = [], off = 0) => '#EXTM3U\n#EXT-X-TARGETDURATION:2\n' + [0, 1, 2, 3, 4].map((i) => seg(i + off, titles[i])).join('\n');
  const dr = `#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="${iso(base + 4000)}",DURATION=4.000\n`;
  // el borde en vivo de la lista es base+10 s; el anuncio ocupa de base+4 s a base+8 s
  assert.equal(w.Ads.playingAd(list(), 4), false, 'sin anuncio');
  assert.equal(w.Ads.playingAd(dr + list(), 4), true, 'DATERANGE stitched-ad: suena el tramo del anuncio');
  assert.equal(w.Ads.playingAd(dr + list(), 0), false, 'ya en el borde (después del anuncio)');
  assert.equal(w.Ads.playingAd(dr + list(), 7), false, 'aún antes del anuncio');
  // con antelación: se silencia justo ANTES de que suene (aquí suena a los 4 s y el vídeo va por los 3 s), pero no se alarga al terminar
  assert.equal(w.Ads.playingAd(dr + list(), 7, 2), true, 'el anuncio empieza en 1 s: ya se silencia');
  assert.equal(w.Ads.playingAd(dr + list(), 7, 0.5), false, 'aún falta más que la antelación');
  assert.equal(w.Ads.playingAd(dr + list(), 1.9, 2), false, 'sin margen final, tras el anuncio no se mantiene el silencio');
  // con margen final: el audio no vuelve hasta 2 s después de acabar (el anuncio acaba a los 8 s)
  assert.equal(w.Ads.playingAd(dr + list(), 1.9, 2, 2), true, 'acabó hace 0,1 s: sigue en silencio');
  assert.equal(w.Ads.playingAd(dr + list(), 0, 2, 2), false, 'acabó hace 2 s: el audio vuelve');
  assert.equal(w.Ads.playingAd(dr + list(), 2.1, 2), true, 'el anuncio aún suena (acaba a los 8 s, el vídeo va por 7.9 s)');
  assert.equal(w.Ads.playingAd(list([, , , 'Amazon', 'Amazon']), 3), true, 'segmentos con título de anunciante');
  assert.equal(w.Ads.playingAd('#EXTM3U\n#EXTINF:2.000,live\nhttps://seg/0.ts', 0), false, 'sin fechas no se puede saber');
  ok('anuncios: detección por DATERANGE stitched-ad y por título de segmento, según el retraso del reproductor');

  // en el reproductor: silencia mientras dura el anuncio y deja el audio como estaba al acabar
  const t = boot();
  let media = list();
  const f = t.w.fetch;
  t.w.fetch = (u, ...r) => String(u).includes('video-weaver') ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(media) }) : f(u, ...r);
  await t.until(() => t.cards().length === 6, 'inicio');
  t.key(t.K.ok);
  const v = t.$('v');
  await t.until(() => v.getAttribute('src'), 'src del directo');
  v.muted = false; v.__live = 100; v.__t = 96;                 // el vídeo va 4 s por detrás del borde
  assert.equal(v.muted, false);
  media = dr + list();
  await t.until(() => v.muted, 'audio silenciado durante el anuncio', 4500);
  assert.match(t.$('ptoast').textContent, /Anuncio/);
  media = list([], 20);                                        // el directo avanza y el vídeo sale del anuncio (96 → 99,5 s)
  v.__t = 99.5;
  await t.until(() => !v.muted, 'audio recuperado al acabar el anuncio', 4500);
  media = dr + list();
  v.__t = 96;                                                  // otra vez dentro del anuncio
  await t.until(() => v.muted, 'segundo anuncio', 4500);
  t.key(t.K.back);
  assert.equal(v.muted, false, 'al salir el audio no se queda silenciado');
  ok('anuncios: el reproductor silencia el audio durante el anuncio y lo restaura al acabar o al salir');
}

/* ---------- 6c) reanudar VODs ---------- */
{
  const TV = 'ue6666qo983tsx6so1t0vnawi233wa';
  const session = { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'demo_user', cid: TV }) };
  const vod = (id, d = 5000) => ({ type: 'video', id, name: 'Chan1', title: 'VOD ' + id, date: '', game: '', duration: d });
  const reopen = async (t, id, d) => {
    t.w.Player.open(vod(id, d), () => {});
    await t.until(() => t.$('v').getAttribute('src'), 'src del VOD ' + id);
    const v = t.$('v'); v.__t = 0; v.__seeks = 0;
    v.dispatchEvent(new t.w.Event('loadedmetadata'));
    return v;
  };

  // solo en local: se guarda al salir y se retoma
  let t = boot();
  let v = await reopen(t, '950');
  assert.equal(v.__seeks, 0, 'un VOD nuevo empieza en 0');
  v.__d = 5000; v.__t = 300;
  t.key(t.K.back);
  assert.equal(t.w.Resume._local('950').pos, 300, 'al salir se guarda la posición');
  v = await reopen(t, '950');
  assert.equal(v.__t, 300, 'se reanuda donde se dejó');
  assert.match(t.$('ptoast').textContent, /Continúas por 5:00/);
  v.__t = 4990;                                              // casi al final: ya está visto
  t.key(t.K.back);
  assert.equal(t.w.Resume._local('950').pos, 0, 'un VOD visto hasta el final se anota como terminado (posición 0)');
  v = await reopen(t, '950');
  assert.equal(v.__seeks, 0, 'y vuelve a empezar desde 0');
  v.__t = 5; t.key(t.K.back);
  assert.equal(t.w.Resume._local('950').pos, 0, 'menos de 15 s no se guarda (sigue como terminado)');
  ok('reanudar VOD (local): se guarda al salir, se retoma, y se olvida al terminarlo o con menos de 15 s');

  // webOS descarta el salto en loadedmetadata (duration=Infinity): se reintenta y, mientras tanto, no se pisa la posición guardada
  v = await reopen(t, '952');
  v.__d = 5000; v.__t = 300; t.key(t.K.back);
  t.w.Player.open(vod('952', 5000), () => {});
  await t.until(() => t.$('v').getAttribute('src'), 'src del VOD 952');
  v = t.$('v'); v.__t = 0; v.__d = Infinity; v.__noSeek = true;
  await t.until(() => /Continúas por 5:00/.test(t.$('ptoast').textContent), 'aviso de reanudado');
  v.dispatchEvent(new t.w.Event('loadedmetadata'));
  assert.equal(v.__t, 0, 'el reproductor descartó el salto');
  v.__t = 20; v.dispatchEvent(new t.w.Event('timeupdate'));
  assert.equal(t.w.Resume._local('952').pos, 300, 'con el salto pendiente no se pisa la posición guardada');
  v.__t = 0; v.__noSeek = false; v.__d = 5000;
  v.dispatchEvent(new t.w.Event('durationchange'));
  assert.equal(v.__t, 300, 'al conocer la duración se reintenta y se aplica');
  v.dispatchEvent(new t.w.Event('canplay'));
  const n = v.__seeks;
  v.dispatchEvent(new t.w.Event('playing'));
  assert.equal(v.__seeks, n, 'una vez aplicado no se vuelve a saltar');
  t.key(t.K.back);
  v.__t = 0;                                                 // el 'pause' asíncrono de la apertura siguiente no debe ver este 300
  ok('reanudar VOD: reintenta el salto si el reproductor lo descarta y no pisa la posición guardada');

  // se guarda también durante la reproducción (cada 15 s) y al pausar
  v = await reopen(t, '951');
  v.__t = 700; v.dispatchEvent(new t.w.Event('timeupdate'));
  assert.equal(t.w.Resume._local('951').pos, 700, 'timeupdate guarda');
  v.__t = 800; v.dispatchEvent(new t.w.Event('timeupdate'));
  assert.equal(t.w.Resume._local('951').pos, 700, 'pero no más de una vez cada 15 s');
  v.__t = 900; v.pause();
  await sleep(20);
  assert.equal(t.w.Resume._local('951').pos, 900, 'al pausar se guarda enseguida');
  t.key(t.K.back);
  ok('reanudar VOD: se guarda cada 15 s y al pausar');

  // directos: no se guarda nada
  t.w.Player.open({ type: 'stream', login: 'chan1', name: 'Chan1', title: '', game: '', viewers: 1 }, () => {});
  await t.until(() => t.$('v').getAttribute('src'), 'src del directo');
  t.$('v').__t = 500; t.key(t.K.back);
  assert.equal(t.w.Resume._local('chan1'), null);

  // posición de Twitch (otro dispositivo): se lee con la sesión del cliente de TV y gana la más reciente
  t = boot({ ls: session, vpos: 600 });
  v = await reopen(t, '960');
  assert.equal(v.__t, 600, 'sin posición local se usa la de Twitch');
  assert.ok(t.N.calls.some((c) => c.url.includes('gql') && /viewingHistory/.test(String(c.opts.body))));
  const hdr = t.N.calls.find((c) => /viewingHistory/.test(String(c.opts.body))).opts.headers;
  assert.equal(hdr.Authorization, 'OAuth acc1');
  assert.equal(hdr['Client-Id'], TV);
  t.key(t.K.back);

  t = boot({ ls: { ...session, vpos: JSON.stringify({ 961: [200, Date.now()] }) }, vpos: 600, vposAt: '2020-01-01T00:00:00Z' });
  v = await reopen(t, '961');
  assert.equal(v.__t, 200, 'la posición local más reciente gana a la de Twitch');
  t.key(t.K.back);

  t = boot({ vpos: 600 });                                    // sin sesión no se consulta a Twitch
  v = await reopen(t, '962');
  assert.equal(v.__seeks, 0);
  assert.ok(!t.N.calls.some((c) => /viewingHistory/.test(String(c.opts.body || ''))), 'sin sesión no hay petición');
  t.key(t.K.back);
  t = boot({ clientId: 'otro', ls: { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'demo_user', cid: 'otro' }) }, vpos: 600 });
  v = await reopen(t, '963');
  assert.equal(v.__seeks, 0, 'con otro Client ID el GraphQL privado no se usa');
  t.key(t.K.back);

  // terminar un VOD en la TV: una posición antigua de Twitch no debe volver a reanudarlo
  t = boot({ ls: session, vpos: 600, vposAt: '2020-01-01T00:00:00Z' });
  v = await reopen(t, '964');
  assert.equal(v.__t, 600, 'primero reanuda por la posición de Twitch');
  v.__d = 5000; v.__t = 4990; t.key(t.K.back);
  v = await reopen(t, '964');
  assert.equal(v.__seeks, 0, 'tras terminarlo en la TV no reanuda por la posición antigua de Twitch');
  t.key(t.K.back);
  ok('reanudar VOD (Twitch): lee la posición con el cliente de TV, gana la más reciente y no se usa sin sesión');
}

/* ---------- 6d) aviso de directos de canales seguidos ---------- */
{
  const TV = 'ue6666qo983tsx6so1t0vnawi233wa';
  const session = { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'demo_user', cid: TV }) };
  const LIVE = 'https://api.twitch.tv/helix/streams/followed';
  // el reloj del módulo se captura: el test lo dispara a mano (sin esperar minutos). beforeScripts corre antes de los scripts.
  const setup = (o = {}) => {
    const st = { live: ['chan1'], timers: [], cleared: 0 };
    const t = boot({ ...o, beforeScripts: (w) => {
      if (o.pre) o.pre(w);
      const si = w.setInterval.bind(w), ci = w.clearInterval.bind(w);
      w.setInterval = (fn, ms) => { if (ms >= 120000) { st.timers.push({ fn, ms }); return 900 + st.timers.length; } return si(fn, ms); };
      w.clearInterval = (id) => { if (id >= 900) st.cleared++; else ci(id); };
    } });
    const f0 = t.w.fetch;
    t.w.fetch = (u, op) => String(u).startsWith(LIVE) ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: st.live.map((l, i) => ({ user_id: String(i + 1), user_login: l, user_name: l.toUpperCase(), game_name: i ? 'Ajedrez' : 'Juego' })), pagination: {} }) }) : f0(u, op);
    return { t, st };
  };

  // VOD: la primera lista no avisa; un canal nuevo en la siguiente sí, con foto y juego; el que ya estaba no se repite
  let { t, st } = setup({ ls: session });
  let seen = 0;
  const f1 = t.w.fetch; t.w.fetch = (u, op) => { if (String(u).startsWith(LIVE)) seen++; return f1(u, op); };
  t.w.Player.open({ type: 'video', id: '970', login: 'chan9', name: 'Chan9', title: 'VOD', date: '', game: '', duration: 5000 }, () => {});
  await t.until(() => seen === 1, 'primera lista (línea base)');
  assert.equal(st.timers.length, 1, 'un solo temporizador');
  assert.equal(st.timers[0].ms, 120000, 'por defecto cada 2 min');
  await sleep(30);
  assert.equal(t.$('live').hidden, true, 'los que ya estaban en directo no se avisan');
  st.live = ['chan1', 'nuevo'];
  st.timers[0].fn();
  await t.until(() => !t.$('live').hidden, 'aviso del canal nuevo');
  assert.equal(t.$('lname').textContent, 'NUEVO');
  assert.equal(t.$('lsub').textContent, 'En directo ahora · Ajedrez');
  assert.equal(t.$('limg').getAttribute('src'), 'http://avatar/1', 'con la foto del canal');
  assert.equal(t.$('live').className, '', 'con el chat a la derecha el aviso va a la izquierda');
  assert.equal(seen, 2);
  st.timers[0].fn();
  await t.until(() => seen === 3, 'tercera lista');
  await sleep(30);
  assert.equal(t.$('lname').textContent, 'NUEVO', 'sin avisos repetidos del mismo canal');
  t.key(t.K.back);
  assert.equal(t.$('live').hidden, true, 'al salir se oculta');
  assert.equal(t.$('limg').getAttribute('src'), null, 'y se suelta la imagen');
  assert.ok(st.cleared >= 1, 'y se para el temporizador');
  ok('aviso de directos: línea base sin avisar, canal nuevo con foto y juego, sin repetir, se limpia al salir');

  // directo: el canal que se está viendo no se avisa a sí mismo; se avisa del resto
  ({ t, st } = setup({ ls: session }));
  seen = 0;
  const f2 = t.w.fetch; t.w.fetch = (u, op) => { if (String(u).startsWith(LIVE)) seen++; return f2(u, op); };
  st.live = [];
  t.w.Player.open({ type: 'stream', login: 'Chan1', name: 'Chan1', title: '', game: '', viewers: 1 }, () => {});
  await t.until(() => seen === 1, 'línea base del directo');
  await sleep(30);
  st.live = ['chan1', 'otro'];
  st.timers[0].fn();
  await t.until(() => !t.$('live').hidden, 'aviso del otro canal');
  assert.equal(t.$('lname').textContent, 'OTRO', 'chan1 (el que se ve) no se avisa');
  t.key(t.K.back);
  ok('aviso de directos: durante un directo no se avisa del propio canal');

  // ajustes: apagado no consulta nada; el intervalo se respeta; sin sesión tampoco
  ({ t, st } = setup({ ls: { ...session, settings: JSON.stringify({ adblock: 'off', live: 'off' }) } }));
  seen = 0;
  const f3 = t.w.fetch; t.w.fetch = (u, op) => { if (String(u).startsWith(LIVE)) seen++; return f3(u, op); };
  t.w.Player.open({ type: 'video', id: '971', login: 'x', name: 'X', title: 'V', date: '', game: '', duration: 5000 }, () => {});
  await t.until(() => t.$('v').getAttribute('src'), 'src');
  await sleep(40);
  assert.equal(seen + st.timers.length, 0, 'apagado: ni petición ni temporizador');
  t.key(t.K.back);
  ({ t, st } = setup({ ls: { ...session, settings: JSON.stringify({ adblock: 'off', liveEvery: 5 }) } }));
  t.w.Player.open({ type: 'video', id: '972', login: 'x', name: 'X', title: 'V', date: '', game: '', duration: 5000 }, () => {});
  await t.until(() => st.timers.length === 1, 'temporizador');
  assert.equal(st.timers[0].ms, 300000, 'liveEvery 5 = cada 5 min');
  t.key(t.K.back);
  ({ t, st } = setup({}));                                      // sin sesión
  t.w.Player.open({ type: 'video', id: '973', login: 'x', name: 'X', title: 'V', date: '', game: '', duration: 5000 }, () => {});
  await t.until(() => t.$('v').getAttribute('src'), 'src');
  await sleep(40);
  assert.equal(st.timers.length, 0, 'sin sesión no hay nada en marcha');
  t.key(t.K.back);
  ok('aviso de directos: respeta el ajuste (apagado, intervalo) y no hace nada sin sesión');

  // sonido, tiempo en pantalla, clic (ir), × y teclas de colores (Amarillo = ver, Azul = cerrar)
  const beeps = [];
  const withAudio = (w) => {
    w.AudioContext = class {
      constructor() { this.currentTime = 0; this.destination = {}; this.osc = 0; this.closed = false; beeps.push(this); }
      createOscillator() { this.osc++; return { frequency: {}, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      close() { this.closed = true; }
    };
  };
  ({ t, st } = setup({ ls: session, pre: withAudio }));
  seen = 0;
  const f4 = t.w.fetch; t.w.fetch = (u, op) => { if (String(u).startsWith(LIVE)) seen++; return f4(u, op); };
  let closed = 0;
  t.w.Player.open({ type: 'video', id: '980', login: 'chan9', name: 'Chan9', title: 'VOD', date: '', game: '', duration: 5000 }, () => { closed++; });
  await t.until(() => seen === 1, 'línea base');
  await sleep(30);
  const fire = async (login) => {
    st.live = [...st.live, login];
    st.timers[st.timers.length - 1].fn();
    await t.until(() => !t.$('live').hidden, 'aviso de ' + login);
  };
  await fire('uno');
  assert.equal(t.$('lname').textContent, 'UNO');
  assert.equal(beeps.length, 1, 'suena al salir el aviso');
  assert.equal(beeps[0].osc, 2, 'un pitido de dos notas');
  await sleep(950);
  assert.equal(beeps[0].closed, true, 'y el audio se cierra al acabar');
  assert.equal(t.$('lgo').textContent, 'Ver');
  assert.equal(t.$('lcl').textContent, 'Cerrar');
  t.key(406);                                                  // Azul: cerrar
  assert.equal(t.$('live').hidden, true, 'Azul cierra el aviso');
  assert.equal(t.w.Player.isOpen(), true, 'sin salir del reproductor');
  assert.equal(closed, 0);
  await sleep(450);
  await fire('dos');
  t.$('lx').click();                                           // la × con el puntero
  assert.equal(t.$('live').hidden, true, 'la × cierra el aviso');
  await sleep(450);
  const n0 = seen;
  await fire('tres');
  t.$('lname').click();                                        // clic en el aviso: ir al directo
  assert.equal(t.$('live').hidden, true);
  assert.match(t.$('oname').textContent, /TRES/, 'el reproductor pasa al directo del aviso');
  assert.equal(t.$('obar').hidden, true, 'ya no es un VOD (sin barra de progreso)');
  assert.equal(closed, 0, 'cambiar de contenido no cuenta como salir del reproductor');
  await t.until(() => seen === n0 + 2, 'línea base del nuevo directo');
  await sleep(30);
  await fire('cuatro');
  t.key(405);                                                  // Amarillo: ver
  assert.match(t.$('oname').textContent, /CUATRO/, 'Amarillo abre el directo del aviso');
  assert.equal(t.$('live').hidden, true);
  t.key(t.K.back);
  assert.equal(closed, 1, 'al salir vuelve el foco como si se hubiera abierto una sola vez');
  assert.equal(t.w.Player.isOpen(), false);
  ok('aviso de directos: suena, se cierra con Azul o la ×, y un clic o Amarillo pasa al directo');

  // foco con las flechas: Arriba (desde lo más alto del panel) entra al aviso, ◀ ▶ eligen, OK pulsa, ▼ o Atrás vuelven
  ({ t, st } = setup({ ls: session }));
  seen = 0;
  const f6 = t.w.fetch; t.w.fetch = (u, op) => { if (String(u).startsWith(LIVE)) seen++; return f6(u, op); };
  closed = 0;
  t.w.Player.open({ type: 'video', id: '982', login: 'chan9', name: 'Chan9', title: 'VOD', date: '', game: '', duration: 5000 }, () => { closed++; });
  await t.until(() => seen === 1, 'línea base');
  await sleep(30);
  const fire2 = async (login) => {
    st.live = [...st.live, login];
    st.timers[st.timers.length - 1].fn();
    await t.until(() => !t.$('live').hidden, 'aviso de ' + login);
  };
  const lf = () => [t.$('lgo'), t.$('lcl')].map((e) => e.classList.contains('foc'));
  await fire2('uno');
  assert.deepEqual(lf(), [false, false], 'al salir el aviso no tiene el foco');
  t.key(t.K.up);                                               // en un VOD la primera sube a la barra de progreso
  assert.deepEqual(lf(), [false, false]);
  assert.equal(t.$('obar').classList.contains('foc'), true);
  t.key(t.K.up);                                               // la segunda ya es del aviso
  assert.deepEqual(lf(), [true, false], 'Arriba desde la barra lleva el foco a "Ver"');
  assert.equal(t.$('player').classList.contains('nf'), true, 'el panel atenúa su foco');
  t.key(t.K.right);
  assert.deepEqual(lf(), [false, true], '▶ pasa a "Cerrar"');
  t.key(t.K.right);
  assert.deepEqual(lf(), [false, true], 'no da la vuelta');
  t.key(t.K.left);
  assert.deepEqual(lf(), [true, false]);
  t.key(t.K.down);
  assert.deepEqual(lf(), [false, false], 'Abajo devuelve el foco al reproductor');
  assert.equal(t.$('player').classList.contains('nf'), false);
  assert.equal(t.$('live').hidden, false, 'el aviso sigue a la vista');
  t.key(t.K.up);                                               // otra vez al aviso
  t.key(t.K.back);
  assert.deepEqual(lf(), [false, false], 'Atrás solo devuelve el foco');
  assert.equal(t.w.Player.isOpen(), true, 'sin salir del reproductor');
  t.key(t.K.up);
  t.key(t.K.right);
  t.key(t.K.ok);                                               // OK en "Cerrar"
  assert.equal(t.$('live').hidden, true, 'OK en Cerrar cierra el aviso');
  assert.equal(t.$('player').classList.contains('nf'), false, 'y el foco vuelve al panel');
  await sleep(450);
  await fire2('dos');
  t.key(t.K.up);                                               // la barra de progreso conserva el foco: sube directo al aviso
  assert.deepEqual(lf(), [true, false]);
  t.key(t.K.ok);                                               // OK en "Ver"
  assert.match(t.$('oname').textContent, /DOS/, 'OK en Ver pasa al directo');
  assert.equal(t.$('obar').hidden, true);
  assert.equal(closed, 0);
  await t.until(() => seen >= 3, 'línea base del nuevo directo');
  await sleep(30);
  await fire2('tres');                                         // en un directo basta una pulsación de Arriba con el panel a la vista
  t.key(t.K.up);
  assert.deepEqual(lf(), [true, false], 'en un directo Arriba entra directamente');
  t.key(t.K.back);
  t.key(t.K.back);
  assert.equal(closed, 1, 'el segundo Atrás sí sale del reproductor');
  ok('aviso de directos: se puede mover el foco con las flechas (Arriba entra, ◀ ▶ eligen, OK pulsa, Abajo o Atrás vuelven)');

  // sin sonido (ajuste) no se crea ningún audio; sin aviso a la vista los colores siguen siendo del reproductor
  beeps.length = 0;
  ({ t, st } = setup({ ls: { ...session, settings: JSON.stringify({ adblock: 'off', liveSound: 'off' }) }, pre: withAudio }));
  seen = 0;
  const f5 = t.w.fetch; t.w.fetch = (u, op) => { if (String(u).startsWith(LIVE)) seen++; return f5(u, op); };
  t.w.Player.open({ type: 'video', id: '981', login: 'chan9', name: 'Chan9', title: 'VOD', date: '', game: '', duration: 5000 }, () => {});
  await t.until(() => seen === 1, 'línea base');
  await sleep(30);
  st.live = ['chan1', 'nuevo'];
  st.timers[st.timers.length - 1].fn();
  await t.until(() => !t.$('live').hidden, 'aviso sin sonido');
  assert.equal(beeps.length, 0, 'con el sonido apagado no hay audio');
  t.key(t.K.back);
  t.key(406);                                                  // sin aviso ni reproductor: no pasa nada
  ok('aviso de directos: con el sonido apagado no se crea ningún audio');
}

/* ---------- 6e) ajustes: el panel no se sale de la pantalla (barra de desplazamiento visual) ---------- */
{
  // jsdom no hace layout: se simula un área de 300 px con 17 filas de 50 px (850 px de contenido)
  let t = boot();
  assert.equal(t.$('swrap').scrollHeight, 0);
  t.key(t.K.green);
  assert.equal(t.$('sbar').hidden, true, 'si todo cabe no hay barra');
  t.key(t.K.green);

  t = boot();
  const w = t.w, wrap = t.$('swrap');
  let st = 0;
  Object.defineProperty(wrap, 'clientHeight', { get: () => 300 });
  Object.defineProperty(wrap, 'scrollHeight', { get: () => 850 });
  Object.defineProperty(wrap, 'scrollTop', { get: () => st, set: (x) => { st = Math.max(0, Math.min(550, x)); } });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetTop', { get() { return this.classList.contains('si') ? [...this.parentNode.children].indexOf(this) * 50 : 0; }, configurable: true });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { get() { return this.classList.contains('si') ? 50 : 0; }, configurable: true });
  const thumb = () => ({ h: parseFloat(t.$('sthumb').style.height), top: parseFloat(t.$('sthumb').style.top) });
  t.key(t.K.green);
  assert.equal(t.$('sbar').hidden, false, 'si no cabe se ve la barra');
  assert.equal(t.$('sbar').style.height, '300px', 'la barra mide lo que el área de filas');
  const th = 300 * 300 / 850, near = (a, b) => Math.abs(a - b) < 0.01;
  assert.ok(near(thumb().h, th) && thumb().top === 0, 'arriba: el tirador está al principio');
  for (let i = 0; i < 5; i++) t.key(t.K.down);
  assert.equal(st, 0, 'las filas visibles no desplazan');
  for (let i = 0; i < 3; i++) t.key(t.K.down);                 // fila 8: su borde inferior (450) pasa de 300
  assert.equal(st, 150);
  assert.ok(near(thumb().top, 150 / 550 * (300 - th)), 'el tirador baja con la selección');
  for (let i = 0; i < 8; i++) t.key(t.K.down);                 // Restablecer (fila 16)
  assert.equal(st, 550, 'la última fila queda a la vista');
  assert.ok(near(thumb().top, 300 - th), 'abajo: el tirador llega al final de la barra');
  for (let i = 0; i < 16; i++) t.key(t.K.up);
  assert.equal(st, 0, 'al volver a la primera fila se sube del todo');
  assert.equal(thumb().top, 0);
  t.key(t.K.green);
  ok('ajustes: el área de filas se desplaza con la selección y la barra muestra por dónde vas');
}

/* ---------- 7) chat optimizado ---------- */
{
  const line = (name, text, tags = '') => `${tags ? '@' + tags + ' ' : ''}:${name}!${name}@${name}.tmi.twitch.tv PRIVMSG #chan1 :${text}`;

  // parseo
  const { w: pw } = boot();
  const P = (l) => J(pw.Chat.parse(l));
  assert.deepEqual(P(line('foo', 'hola: mundo')), { n: 'foo', c: '#bf94ff', t: 'hola: mundo', a: false, e: '' });
  assert.deepEqual(P(line('foo', 'hola', 'color=#FF4500;display-name=Fo\\so;id=1')), { n: 'Fo o', c: '#FF4500', t: 'hola', a: false, e: '' });
  assert.equal(P(line('foo', 'x', 'color=#0000FF')).c, '#bf94ff', 'un color ilegible sobre fondo oscuro se sustituye');
  assert.deepEqual(P(line('foo', '\u0001ACTION baila\u0001')), { n: 'foo', c: '#bf94ff', t: 'baila', a: true, e: '' });
  assert.equal(P(line('foo', 'hola Kappa', 'emotes=25:5-9;id=1')).e, '25:5-9', 'la etiqueta emotes viaja con el mensaje');
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

/* ---------- 7b) emotes del chat ---------- */
{
  // Image simulada: dispara onload/onerror como un navegador (jsdom no carga imágenes) y apunta qué URLs se piden
  const imgLog = [];
  const fakeImage = (opts = {}) => (win) => {
    win.Image = class {
      constructor() { this.naturalWidth = opts.w ?? 64; this.naturalHeight = opts.h ?? 64; this._s = ''; }
      get src() { return this._s; }
      set src(v) {
        this._s = v;
        if (!v) return;
        imgLog.push(v);
        setTimeout(() => { if (this._s !== v) return; const f = opts.fail && opts.fail(v); const h = f ? this.onerror : this.onload; if (h) h.call(this); }, opts.delay ?? 0);
      }
    };
  };
  const EMO_HOSTS = /7tv\.io|betterttv\.net|frankerfacez\.com/;
  const emoCalls = (t) => t.N.calls.filter((c) => EMO_HOSTS.test(c.url) || (c.url.includes('gql.twitch.tv') && /\{user\(login:"[^"]*"\)\{id\}\}/.test(String(c.opts.body))));
  const span = (t) => t.d.createElement('span');
  const srcs = (el) => [...el.querySelectorAll('img')].map((i) => i.getAttribute('src'));
  // rellena y espera a que terminen las descargas simuladas (el tope de descargas simultáneas se prueba aparte)
  const fillT = async (t, text, tag) => { const e = span(t); t.w.Emotes.fill(e, text, tag); await sleep(8); return e; };
  const LIM_BYTES = 6 * 1024 * 1024, LIM_ITEMS = 250;
  const TW = (id) => 'https://static-cdn.jtvnw.net/emoticons/v2/' + id + '/static/dark/2.0';

  // diccionarios: 7TV por GraphQL (sin interpretar las trazas), BTTV, FFZ y globales; prioridad 7TV > BTTV > FFZ
  let t = boot({ beforeScripts: fakeImage() });
  let w = t.w;
  w.Emotes.use('Chan1');
  await t.until(() => w.Emotes._stats().chan === 4 && w.Emotes._stats().glob === 3, 'diccionarios del canal y globales');
  assert.equal(w.Emotes._stats().want, 'chan1');
  const urls = emoCalls(t).map((c) => c.url);
  assert.ok(urls.includes('https://api.frankerfacez.com/v1/room/chan1'), 'FFZ por login');
  assert.ok(urls.includes('https://api.betterttv.net/3/cached/users/twitch/777'), 'BTTV por id numérico');
  let el = await fillT(t, 'hola catJAM Pog7 monkaBT ffzE Gl7 ffzG fin', '');
  assert.deepEqual(srcs(el), [
    'https://cdn.7tv.app/emote/AAA/2x_static.webp',
    'https://cdn.7tv.app/emote/BBB/2x.webp',
    'https://cdn.betterttv.net/emote/b1/2x.png',
    'https://cdn.frankerfacez.com/emote/11/2',
    'https://cdn.7tv.app/emote/GGG/2x.webp',
    'https://cdn.frankerfacez.com/emote/12/2',
  ], 'animados en versión estática, BTTV en png, 2x; Pog7 es de 7TV aunque BTTV también lo tenga');
  assert.equal(el.textContent, 'hola ' + ' '.repeat(5) + ' fin', 'el resto del texto se conserva');
  assert.equal(el.firstChild.textContent, 'hola ');
  assert.equal(el.lastChild.textContent, ' fin');
  assert.equal(el.querySelector('img').getAttribute('alt'), 'catJAM');
  assert.equal(el.querySelector('img').className, 'emo');
  el = await fillT(t, 'w! hola BTglobal ffzH', '');
  assert.deepEqual(srcs(el), ['https://cdn.betterttv.net/emote/bg/2x.png'], 'los modificadores y los emotes ocultos de FFZ se quedan como texto');
  el = await fillT(t, 'constructor __proto__ toString hola', '');
  assert.equal(el.querySelectorAll('img').length, 0);
  assert.equal(el.textContent, 'constructor __proto__ toString hola', 'las palabras que coinciden con propiedades de Object no son emotes');
  el = await fillT(t, 'catJAM!  catJAM', '');
  assert.equal(srcs(el).length, 1, 'solo la palabra exacta (con puntuación pegada no)');
  ok('emotes: 7TV (GraphQL), BTTV, FFZ y globales con prioridad, URLs 2x estáticas y solo palabras exactas');

  // emotes de Twitch (etiqueta del IRC, en puntos de código) y la misma etiqueta construida para los VOD
  el = await fillT(t, 'hola Kappa', '25:5-9');
  assert.deepEqual(srcs(el), [TW(25)]);
  el = await fillT(t, '\u{1FAE0} Kappa \u{1FAE0} LUL', '25:2-6/425618:10-12');
  assert.deepEqual(srcs(el), [TW(25), TW(425618)], 'los índices de Twitch cuentan puntos de código, no unidades UTF-16');
  assert.equal(el.firstChild.textContent, '\u{1FAE0} ');
  el = await fillT(t, 'Kappa x', '25:0-9');
  assert.equal(srcs(el).length, 0, 'un rango que no encaja con una palabra se ignora');
  el = await fillT(t, 'hola', '25:5-9/zz');
  assert.equal(el.textContent, 'hola');
  el = await fillT(t, 'x', 'a$b:0-0');
  assert.equal(srcs(el).length, 0, 'un id con caracteres raros no genera URL');
  const vc = J(await w.Api.vodComments('9', 7777));
  assert.deepEqual(vc.items.map((i) => [i.m, i.e]), [['Kappa Kappa', '25:0-4/25:6-10'], ['\u{1FAE0} LUL', 'emotesv2_abc:2-4']], 'el chat del VOD trae los emotes de Twitch con el formato del IRC');
  el = await fillT(t, vc.items[1].m, vc.items[1].e);
  assert.deepEqual(srcs(el), [TW('emotesv2_abc')]);
  ok('emotes: Twitch por etiqueta (puntos de código) y los del chat de un VOD');

  // sin emotes que mostrar el mensaje sigue siendo texto plano (sin elementos extra)
  el = await fillT(t, 'hola mundo sin nada', '');
  assert.equal(el.childNodes.length, 1);
  assert.equal(el.firstChild.nodeType, 3);
  ok('emotes: un mensaje sin emotes es un único nodo de texto');

  // caché en localStorage: se guarda el diccionario y al reabrir el canal no se vuelve a pedir nada
  const saved = JSON.parse(w.localStorage.getItem('emo:chan1'));
  assert.equal(Object.keys(saved.d).length, 4);
  assert.equal(saved.d.catJAM, '8AAA');
  assert.ok(w.localStorage.getItem('emo:*'), 'los globales se guardan aparte');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('emo.ix')), ['emo:chan1'], 'el índice solo lleva canales');
  const t2 = boot({ beforeScripts: fakeImage(), ls: { 'emo:chan1': w.localStorage.getItem('emo:chan1'), 'emo:*': w.localStorage.getItem('emo:*'), 'emo.ix': w.localStorage.getItem('emo.ix') } });
  t2.w.Emotes.use('chan1');
  assert.equal(t2.w.Emotes._stats().chan, 4, 'el diccionario guardado se usa al momento');
  await t2.until(() => t2.w.Emotes._stats().glob === 3, 'globales guardados');
  await sleep(50);
  assert.equal(emoCalls(t2).length, 0, 'con la caché fresca no se pide nada a la red');
  // caducada (6 h): se vuelve a pedir
  const old = JSON.parse(w.localStorage.getItem('emo:chan1')); old.t = Date.now() - 7 * 3600 * 1000;
  const t3 = boot({ beforeScripts: fakeImage(), ls: { 'emo:chan1': JSON.stringify(old) } });
  t3.w.Emotes.use('chan1');
  await t3.until(() => t3.w.Emotes._stats().chan === 4, 'refresco de la caché caducada');
  assert.ok(emoCalls(t3).length > 0);
  ok('emotes: diccionarios en localStorage (6 h por canal, globales 24 h) sin volver a la red mientras valen');

  // como mucho 4 canales guardados (los globales aparte)
  const t4 = boot({ beforeScripts: fakeImage() });
  for (const c of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
    t4.w.Emotes.use(c);
    await t4.until(() => t4.w.localStorage.getItem('emo:' + c), 'canal ' + c);
  }
  assert.deepEqual(JSON.parse(t4.w.localStorage.getItem('emo.ix')), ['emo:a3', 'emo:a4', 'emo:a5', 'emo:a6']);
  assert.equal(t4.w.localStorage.getItem('emo:a1'), null, 'el canal menos usado se borra');
  assert.equal(t4.w.localStorage.getItem('emo:a2'), null);
  assert.ok(t4.w.localStorage.getItem('emo:*'), 'los globales no cuentan en el cupo');
  ok('emotes: se guardan como mucho 4 canales (se borra el menos usado)');

  // un proveedor caído: se usa lo que hay pero no se guarda un diccionario incompleto
  const tf = boot({ beforeScripts: fakeImage(), emoteFail: 'bttv' });
  tf.w.Emotes.use('chan1');
  await tf.until(() => tf.w.Emotes._stats().chan === 3, 'diccionario parcial');
  await sleep(30);
  assert.equal(tf.w.localStorage.getItem('emo:chan1'), null, 'no se guarda un diccionario incompleto');
  assert.equal(tf.errors.length, 0);
  ok('emotes: si un proveedor falla se usan los demás y no se cachea el resultado incompleto');

  // límite de memoria: tope de bytes (imágenes grandes) y de elementos (imágenes pequeñas), expulsando la menos usada
  imgLog.length = 0;
  const big = boot({ beforeScripts: fakeImage({ w: 512, h: 512 }) });         // 1 MiB cada una
  const eid = (i) => i + ':0-0';
  for (let i = 1; i <= 10; i++) await fillT(big, 'x', eid(i));
  let st = big.w.Emotes._stats();
  assert.ok(st.bytes <= LIM_BYTES, 'memoria: ' + st.bytes);
  assert.equal(st.images, 6, '6 imágenes de 1 MiB caben en 6 MiB');
  const n0 = imgLog.length;
  await fillT(big, 'x', eid(10));
  assert.equal(imgLog.length, n0, 'la más reciente sigue en la caché (no se vuelve a pedir)');
  await fillT(big, 'x', eid(1));
  assert.equal(imgLog.length, n0 + 1, 'la más antigua fue expulsada y se vuelve a pedir');
  st = big.w.Emotes._stats();
  assert.ok(st.bytes <= LIM_BYTES && st.images === 6);
  const small = boot({ beforeScripts: fakeImage() });                         // 16 KiB cada una
  for (let i = 1; i <= 300; i++) { small.w.Emotes.fill(span(small), 'x', eid(i)); await sleep(1); }
  await sleep(10);
  assert.equal(small.w.Emotes._stats().images, LIM_ITEMS, 'como mucho 250 imágenes distintas en memoria');
  assert.ok(small.w.Emotes._stats().bytes <= LIM_BYTES);
  ok('emotes: caché de imágenes con tope de memoria (6 MiB) y de elementos (250), expulsando la menos usada');

  // descargas simultáneas acotadas y tope de imágenes por mensaje
  const slow = boot({ beforeScripts: fakeImage({ delay: 40 }) });
  el = span(slow); slow.w.Emotes.fill(el, 'a b c d e f g h', '1:0-0/2:2-2/3:4-4/4:6-6/5:8-8/6:10-10/7:12-12/8:14-14');
  assert.equal(srcs(el).length, 6, 'solo 6 descargas a la vez');
  assert.equal(slow.w.Emotes._stats().pending, 6);
  assert.ok(el.textContent.endsWith('g h'), 'sin hueco, el emote sale como texto');
  await slow.until(() => slow.w.Emotes._stats().pending === 0, 'descargas terminadas');
  el = span(slow); slow.w.Emotes.fill(el, 'g h', '7:0-0/8:2-2');
  assert.equal(srcs(el).length, 2, 'con huecos libres ya salen como imagen');
  const many = boot({ beforeScripts: fakeImage() });
  el = span(many);
  many.w.Emotes.fill(el, Array(15).fill('x').join(' '), Array.from({ length: 15 }, (_, i) => '1:' + i * 2 + '-' + i * 2).join('/'));
  assert.equal(srcs(el).length, 10, 'como mucho 10 imágenes por mensaje');
  assert.equal(many.w.Emotes._stats().images, 1, 'la misma imagen no se duplica en la caché');
  ok('emotes: descargas simultáneas acotadas y 10 imágenes como mucho por mensaje');

  // un emote que falla sale como texto y no se reintenta enseguida
  imgLog.length = 0;
  const fl = boot({ beforeScripts: fakeImage({ fail: (u) => u.includes('/emoticons/v2/9/') }) });
  await fillT(fl, 'hola Rota', '9:5-8');
  assert.equal(fl.w.Emotes._stats().images, 0, 'la imagen fallida sale de la caché');
  el = await fillT(fl, 'hola Rota', '9:5-8');
  assert.equal(srcs(el).length, 0, 'durante un rato no se vuelve a pedir');
  assert.equal(el.textContent, 'hola Rota');
  assert.equal(imgLog.filter((u) => u.includes('/9/')).length, 1);
  el = span(slow); slow.w.Emotes.fill(el, 'Ok', '5:0-1');                      // un <img> que falla al mostrarse: vuelve el nombre
  const im = el.querySelector('img');
  assert.ok(im);
  im.dispatchEvent(new slow.w.Event('error'));
  assert.equal(el.querySelector('img'), null);
  assert.equal(el.textContent, 'Ok');
  ok('emotes: un emote que falla se muestra como texto y no se reintenta enseguida');

  // ajuste desactivado: nada de red ni imágenes; al activarlo en caliente se cargan
  const off = boot({ beforeScripts: fakeImage(), ls: { settings: JSON.stringify({ adblock: 'off', emotes: 'off' }) } });
  off.w.Emotes.use('chan1');
  el = await fillT(off, 'hola Kappa', '25:5-9');
  assert.equal(el.textContent, 'hola Kappa');
  assert.equal(srcs(el).length, 0);
  await sleep(50);
  assert.equal(emoCalls(off).length, 0, 'con los emotes apagados no se pide nada');
  assert.equal(off.w.Emotes._stats().images, 0);
  off.key(off.K.green);
  for (let i = 0; i < 8; i++) off.key(off.K.down);
  assert.match(off.d.querySelectorAll('#srows .si')[8].textContent, /Emotes en el chat.*No/);
  off.key(off.K.left);
  assert.equal(off.w.Settings.get('emotes'), 'on');
  await off.until(() => off.w.Emotes._stats().chan === 4, 'al activarlos se cargan los del canal');
  el = await fillT(off, 'hola catJAM', '');
  assert.equal(srcs(el).length, 1);
  off.key(off.K.right);                                                         // y al apagarlos se libera la memoria
  assert.equal(off.w.Settings.get('emotes'), 'off');
  assert.equal(off.w.Emotes._stats().chan, 0);
  assert.equal(off.w.Emotes._stats().images, 0);
  el = await fillT(off, 'hola catJAM', '');
  assert.equal(srcs(el).length, 0);
  ok('emotes: el ajuste los apaga (sin red, sin imágenes, memoria liberada) y se aplica en caliente');

  // integración con el chat en directo: pinta los emotes y al salir libera diccionario e imágenes
  const ct = boot({ ls: { chat: '1' }, beforeScripts: fakeImage() });
  await ct.until(() => ct.cards().length === 6, 'inicio');
  ct.key(ct.K.ok);
  await ct.until(() => ct.sockets.length === 1 && ct.sockets[0].sent.length >= 4, 'conexión del chat');
  assert.equal(ct.w.Emotes._stats().want, 'chan1', 'el chat pide los emotes del canal');
  await ct.until(() => ct.w.Emotes._stats().chan === 4, 'diccionario del canal');
  const lineE = (text, tags) => '@' + tags + ' :foo!foo@foo.tmi.twitch.tv PRIVMSG #chan1 :' + text;
  ct.sockets[0].emit(lineE('hola catJAM Kappa', 'color=#FF4500;display-name=Foo;emotes=25:12-16') + '\r\n');
  await ct.until(() => ct.$('cmsgs').children.length === 1, 'mensaje con emotes');
  const body = ct.$('cmsgs').firstChild.lastChild;
  assert.deepEqual([...body.querySelectorAll('img')].map((i) => i.alt), ['catJAM', 'Kappa']);
  assert.equal(body.firstChild.textContent, 'hola ');
  ct.sockets[0].emit(lineE('solo texto', 'color=#FF4500;display-name=Foo') + '\r\n');
  await ct.until(() => ct.$('cmsgs').children.length === 2, 'mensaje de texto');
  assert.equal(ct.$('cmsgs').lastChild.lastChild.textContent, 'solo texto');
  assert.ok(ct.w.Emotes._stats().images <= LIM_ITEMS);
  ct.key(ct.K.back);
  assert.equal(ct.w.Emotes._stats().want, '', 'al salir se libera el canal');
  assert.equal(ct.w.Emotes._stats().chan, 0);
  assert.equal(ct.w.Emotes._stats().images, 0, 'y la caché de imágenes');
  assert.equal(ct.errors.length, 0);
  ok('chat: los emotes se pintan como imágenes y al salir se libera la memoria');
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
  key(53); assert.equal(focused(), $('q'), '5 = enfoca Buscar');
  assert.deepEqual([...t.d.querySelectorAll('#top [data-k]')].map((e) => e.getAttribute('data-k')), ['1', '2', '3', '4', '5', '6'], 'cada pestaña muestra su número');
  key(54); assert.equal($('login').hidden, false, '6 = abre la cuenta (Entrar)');
  key(K.back); assert.equal($('login').hidden, true);
  ok('navegación: teclas 1-6 abren las pestañas, Buscar y la cuenta');

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
  const SESSION = { tauth: JSON.stringify({ access: 'acc1', refresh: 'r', userId: '42', login: 'demo_user', cid: 'ue6666qo983tsx6so1t0vnawi233wa' }) };

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
  assert.match(t.$('ohint').textContent, /^◀ ▶ move around the buttons · OK select · Back exit$/);
  assert.equal(t.$('bpause').textContent, 'Pause');
  assert.match(t.$('bqual').textContent, /^Quality · /);
  assert.equal(t.$('bchat').textContent, 'Chat');
  assert.equal(t.$('bclose').textContent, 'Exit');
  t.key(t.K.ok);
  await t.until(() => !t.$('pstate').hidden, 'estado de pausa');
  assert.equal(t.$('pstate').textContent, '⏸  Paused');
  assert.equal(t.$('bpause').textContent, '▶ Play');
  t.key(t.K.back);
  ok('inglés: aviso de puntos con separador de miles inglés, pausa y pistas del reproductor');

  // VOD: pistas y calidad de salto en inglés
  t.w.Player.open({ type: 'video', id: '901', name: 'Chan1', title: 'VOD', date: '', game: '', duration: 3725 }, () => {});
  await t.until(() => t.$('v').getAttribute('src'), 'src del VOD en inglés');
  assert.match(t.$('ohint').textContent, /press fast to skip further/);
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

/* ---------- 10) ajustes (botón Verde) ---------- */
{
  const t = boot({ defaults: true });
  const { d, $, key, K, until, focused, cards, w } = t;
  const rows = () => [...d.querySelectorAll('#srows .si')];
  const stored = () => JSON.parse(w.localStorage.getItem('settings'));
  await until(() => cards().length === 6, 'inicio');
  assert.equal($('settings').hidden, true);
  assert.equal(focused().getAttribute('data-i'), '0');

  key(K.green);
  assert.equal($('settings').hidden, false, 'Verde abre los ajustes');
  assert.equal(w.Settings.isOpen(), true);
  assert.equal($('settings').className, '', 'fuera del reproductor el panel va centrado');
  assert.equal(rows().length, 17, '15 ajustes + créditos + restablecer');
  assert.match(rows()[0].textContent, /Pestaña al abrir la aplicación.*Inicio/);
  assert.match(rows()[1].textContent, /Contenido de mi país.*Automático/);
  assert.match(rows()[2].textContent, /Restaurar audio silenciado.*Sí/);
  assert.match(rows()[3].textContent, /Bloquear anuncios.*Sí/, 'el bloqueo de anuncios viene activado de serie');
  assert.match(rows()[4].textContent, /Tipo de reproductor.*Twitch Web \(defecto\)/);
  assert.match(rows()[5].textContent, /Avisar de directos que sigo.*Sí/, 'el aviso de directos viene activado de serie');
  assert.match(rows()[6].textContent, /Comprobar directos cada.*2 min/);
  assert.match(rows()[7].textContent, /Sonido del aviso de directo.*Sí/, 'el sonido del aviso viene activado de serie');
  assert.match(rows()[8].textContent, /Emotes en el chat.*Sí/, 'los emotes vienen activados de serie');
  assert.match(rows()[9].textContent, /Tamaño de la letra del chat.*Normal/);
  assert.match(rows()[10].textContent, /Ancho del chat.*25%/);
  assert.match(rows()[11].textContent, /Alto del chat.*100%/);
  assert.match(rows()[12].textContent, /Posición del chat.*Arriba derecha/);
  assert.match(rows()[13].textContent, /Opacidad.*90%/);
  for (let i = 0; i < 12; i++) key(K.down);                    // las flechas no mueven la cuadrícula de detrás
  assert.equal(focused().getAttribute('data-i'), '0');
  key(K.ok);                                                  // OK en la posición: siguiente valor
  assert.equal(w.Settings.get('pos'), 'bl');
  for (let i = 0; i < 12; i++) key(K.up);
  key(K.ok);                                                  // OK en la pestaña inicial: siguiente valor
  assert.equal(w.Settings.get('tab'), 'games');
  assert.equal(stored().tab, 'games', 'se guarda al momento');
  key(K.green);
  assert.equal($('settings').hidden, true, 'Verde también cierra');
  key(K.right); assert.equal(focused().getAttribute('data-i'), '1', 'la navegación vuelve a funcionar');
  ok('ajustes: Verde abre y cierra, las flechas no tocan la pantalla de detrás y se guarda al momento');

  // límites con ◀ ▶ (no dan la vuelta) y restablecer
  key(K.green);
  for (let i = 0; i < 13; i++) key(K.down);                    // opacidad
  for (let i = 0; i < 15; i++) key(K.left);
  assert.equal(w.Settings.get('op'), 0, 'la opacidad no baja de 0');
  for (let i = 0; i < 15; i++) key(K.right);
  assert.equal(w.Settings.get('op'), 100);
  key(K.down); key(K.right);                                  // ocultar panel tras
  assert.equal(w.Settings.hideMs(), 6000);
  key(K.down); key(K.down); assert.match(rows()[16].textContent, /Restablecer/);   // antes pasa por Créditos
  key(K.ok);
  assert.deepEqual(stored(), { tab: 'streams', cfilter: 'auto', unmute: 'on', adblock: 'on', usher: 'twitchweb', live: 'on', liveEvery: 2, liveSound: 'on', emotes: 'on', fs: 'm', size: 25, height: 100, pos: 'tr', op: 90, hide: 4 }, 'restablecer vuelve a los valores de serie');
  key(K.back);
  assert.equal($('settings').hidden, true, 'Atrás cierra');
  ok('ajustes: límites de ◀ ▶ y restablecer valores por defecto');

  // con la cuenta abierta, Verde no abre los ajustes
  key(54);
  assert.equal($('login').hidden, false);
  key(K.green);
  assert.equal($('settings').hidden, true);
  key(K.back);
  ok('ajustes: Verde se ignora en la pantalla de cuenta');
}

{
  // pestaña inicial guardada y valores inválidos
  let t = boot({ ls: { settings: JSON.stringify({ tab: 'videos' }) } });
  assert.equal(t.d.querySelector('.tab.on').textContent, 'Vídeos', 'arranca en la pestaña elegida');
  t = boot({ ls: { settings: '{"tab":"zzz","op":55,"pos":"xx"}' } });
  assert.equal(t.d.querySelector('.tab.on').textContent, 'Inicio', 'un valor inválido vuelve al de serie');
  assert.equal(t.w.Settings.chat().op, 90);
  assert.equal(t.w.Settings.get('pos'), 'tr');
  t = boot({ ls: { settings: 'no es json' } });
  assert.equal(t.d.querySelector('.tab.on').textContent, 'Inicio');
  ok('ajustes: pestaña inicial guardada y tolerancia a datos corruptos');
}

{
  // el chat cambia en caliente desde el reproductor
  const t = boot({ ls: { chat: '1' } });
  const { d, $, key, K, until, cards, w } = t;
  const rows = () => [...d.querySelectorAll('#srows .si')];
  await until(() => cards().length === 6, 'inicio');
  key(K.ok);
  await until(() => $('v').getAttribute('src'), 'src del directo');
  assert.ok($('player').classList.contains('chat'));
  assert.equal($('chat').style.width, '25vw', 'por defecto: 25vw');
  assert.equal($('chat').style.height, '100%');
  assert.equal($('chat').style.top, '0px'); assert.equal($('chat').style.right, '0px');
  assert.equal($('ovl').style.right, '25vw', 'el panel se aparta del chat');

  const paused = $('v').paused;
  key(K.green);
  assert.equal($('settings').className, 'pl al', 'sobre el reproductor el panel se aparta del chat (chat a la derecha → panel a la izquierda)');
  key(K.ok);                                                  // OK en los ajustes no pausa el vídeo
  assert.equal($('v').paused, paused);
  key(K.back);
  assert.equal(w.Player.isOpen(), true, 'Atrás cierra solo los ajustes');
  assert.equal($('settings').hidden, true);
  key(K.green);
  for (let i = 0; i < 10; i++) key(K.down);                    // tamaño (tras pestaña, contenido, audio, anuncios, usher, avisos (3), emotes y letra)
  key(K.left);
  assert.equal($('chat').style.width, '20vw', 'un paso = 5 %'); assert.equal($('chat').style.height, '100%');
  assert.equal($('ovl').style.right, '20vw');
  for (let i = 0; i < 40; i++) key(K.left);
  assert.equal($('chat').style.width, '5vw', 'el tamaño no baja del 5 %');
  for (let i = 0; i < 40; i++) key(K.right);
  assert.equal($('chat').style.width, '100vw', 'el tamaño llega al 100 %');
  assert.equal($('ovl').style.right, '70vw', 'el panel de controles se queda dentro de la pantalla');
  assert.equal(w.Settings.chat().w, 100);
  for (let i = 0; i < 15; i++) key(K.left);                   // 100 → 25
  assert.equal($('chat').style.width, '25vw');
  key(K.up); key(K.left);                                     // letra pequeña
  assert.equal($('chat').style.fontSize, '1.15vw');
  key(K.down); key(K.down); key(K.left);                      // alto: 100 → 95
  assert.equal($('chat').style.height, '95%', 'el alto del chat se aplica');
  assert.equal($('chat').style.width, '25vw', 'el alto no toca el ancho');
  key(K.down); key(K.right); key(K.right);                    // posición: abajo derecha
  assert.equal($('chat').style.bottom, '0px'); assert.equal($('chat').style.top, 'auto');
  assert.equal($('chat').style.right, '0px');
  for (let i = 0; i < 3; i++) key(K.left);                    // arriba izquierda
  assert.equal($('chat').style.left, '0px'); assert.equal($('chat').style.right, 'auto');
  assert.equal($('ovl').style.left, '25vw'); assert.equal($('ovl').style.right, '', 'ya no se aparta por la derecha');
  assert.equal($('qmenu').style.right, ''); assert.equal($('ptoast').style.right, '');
  key(K.down); key(K.left);                                   // opacidad 80
  assert.match($('chat').style.background, /0\.8\)/);
  key(K.back);
  key(K.green);
  assert.equal($('settings').className, 'pl ar', 'con el chat a la izquierda el panel va a la derecha');
  for (let i = 0; i < 16; i++) key(K.down);                   // restablecer (tras Créditos): el alto vuelve al 100 %
  key(K.ok);
  assert.equal(w.Settings.get('height'), 100);
  assert.equal($('chat').style.height, '100%', 'restablecer devuelve el alto al 100 %');
  key(K.back);

  // el chat apagado: el panel se queda centrado y el panel no deja huecos
  t.goBtn('chat'); key(K.ok);
  assert.equal(w.Chat.isOn(), false);
  assert.equal($('ovl').style.left, '', 'sin chat el panel ocupa todo el ancho');
  key(K.green);
  assert.equal($('settings').className, '', 'sin chat visible el panel de ajustes va centrado');
  key(K.back);
  key(K.back);
  assert.equal(w.Player.isOpen(), false);
  ok('ajustes: el chat cambia en caliente (posición, tamaño, letra, opacidad) y el panel se aparta');
}

{
  // inglés
  const t = boot({ lang: 'en' });
  await t.until(() => t.cards().length === 6, 'inicio (en)');
  t.key(t.K.green);
  assert.equal(t.$('stitle').textContent, 'Settings');
  assert.match(t.d.querySelector('#srows .si').textContent, /Tab on app start.*Home/);
  assert.match(t.$('shint').textContent, /Back or Green close/);
  t.key(t.K.back);
  ok('ajustes: textos en inglés');
}

/* ---------- 11) créditos (Ajustes > Créditos) ---------- */
{
  const qrHtml = (w, text) => { const tmp = w.document.createElement('div'); tmp.innerHTML = w.QR.svg(text); return tmp.innerHTML; };
  // sin URL de donaciones: el QR y su texto apuntan al proyecto
  const t = boot();
  const { d, $, key, K, until, cards, w } = t;
  const rows = () => [...d.querySelectorAll('#srows .si')];
  await until(() => cards().length === 6, 'inicio (créditos)');
  key(K.green);
  for (let i = 0; i < 15; i++) key(K.down);                   // las 15 filas de ajustes → Créditos
  assert.match(rows()[15].textContent, /Créditos/);
  assert.ok(rows()[15].classList.contains('on'), 'la fila Créditos queda enfocada');
  key(K.ok);
  assert.equal($('credits').hidden, false, 'OK abre los créditos');
  assert.equal(w.Credits.isOpen(), true);
  assert.equal($('settings').hidden, false, 'los ajustes siguen debajo');
  assert.match($('cmade').textContent, /Hecho por adamff-dev/);
  assert.equal($('curl').textContent, w.CONFIG.CREDITS.url);
  assert.equal($('cqrtxt').textContent, 'Escanea para ver el proyecto', 'sin donaciones el QR apunta al proyecto');
  assert.equal($('cqr').innerHTML, qrHtml(w, w.CONFIG.CREDITS.url));
  key(K.down); key(K.green);                                  // mientras se ven, el mando no llega a los ajustes
  assert.equal($('settings').hidden, false, 'Verde no cierra los ajustes desde los créditos');
  assert.ok(rows()[15].classList.contains('on'), 'Abajo no movió la selección de Ajustes');
  key(K.back);
  assert.equal($('credits').hidden, true, 'Atrás cierra los créditos');
  assert.equal($('settings').hidden, false, 'y vuelve a Ajustes');
  key(K.ok); assert.equal($('credits').hidden, false, 'OK vuelve a abrirlos');
  key(K.ok); assert.equal($('credits').hidden, true, 'OK también cierra');
  key(K.back);
  assert.equal($('settings').hidden, true, 'Atrás cierra los ajustes');
  ok('créditos: se abren desde Ajustes con autor y QR del proyecto; Atrás vuelve a Ajustes');

  // con URL de donaciones, el QR y el texto apuntan a donar
  const DON = 'https://donate.example/cafe';
  const t2 = boot();
  t2.w.CONFIG.CREDITS.donate = DON;
  await t2.until(() => t2.cards().length === 6, 'inicio (donar)');
  t2.key(t2.K.green);
  for (let i = 0; i < 15; i++) t2.key(t2.K.down);
  t2.key(t2.K.ok);
  assert.equal(t2.$('cqrtxt').textContent, 'Escanea para apoyar el proyecto con una donación', 'con donaciones: texto de donar');
  assert.equal(t2.$('cqr').innerHTML, qrHtml(t2.w, DON), 'con donaciones: el QR apunta a la URL de donar');
  assert.equal(t2.$('curl').textContent, t2.w.CONFIG.CREDITS.url, 'la URL del proyecto sigue en texto');
  ok('créditos: con donate configurado el QR apunta a la donación');

  // inglés
  const en = boot({ lang: 'en' });
  await en.until(() => en.cards().length === 6, 'inicio (créditos en inglés)');
  en.key(en.K.green);
  for (let i = 0; i < 15; i++) en.key(en.K.down);
  assert.match(en.d.querySelectorAll('#srows .si')[15].textContent, /Credits/);
  en.key(en.K.ok);
  assert.equal(en.$('ctitle').textContent, 'Credits');
  assert.equal(en.$('cmade').textContent, 'Made by adamff-dev');
  assert.equal(en.$('cwarn').textContent, 'Unofficial project, not related to Twitch');
  en.key(en.K.back);
  ok('créditos: textos en inglés');
}

console.log('\nOK');
process.exit(0);
