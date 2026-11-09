/* Emotes del chat (Twitch, 7TV, BTTV y FFZ) pensados para TVs con poca RAM:
   - solo imágenes ESTÁTICAS y pequeñas (2x): 7TV animado -> "_static.webp", BTTV -> .png (el .webp animado pesa MB), Twitch -> static;
   - diccionario nombre -> código compacto ("7<id>"), nunca URLs ni objetos de la API; tope de entradas y caché en localStorage
     (6 h por canal, 24 h los globales, como mucho 4 canales) para no volver a pedir ~1 MB de JSON de 7TV al reabrir un canal;
   - caché de imágenes en memoria con tope de BYTES (decodificados, ancho*alto*4) y de elementos, con expulsión del menos usado.
     Tras expulsar una imagen se libera su bitmap; al cerrar el chat o apagar el ajuste se vacía todo;
   - como mucho MAX_PENDING descargas a la vez (el emote que no cabe sale como texto y saldrá como imagen la próxima vez) y
     MAX_IMGS imágenes por mensaje. Un emote que falla se pinta como texto y no se reintenta durante un rato. */
(function (w) {
  'use strict';
  var CACHE_BYTES = 6 * 1024 * 1024;      // tope de memoria de imágenes (estimación de píxeles decodificados)
  var CACHE_ITEMS = 250;                  // tope de imágenes distintas en memoria
  var MAX_PENDING = 6;                    // descargas simultáneas
  var PENDING_MS = 10000;                 // una descarga que no termina se da por fallida
  var BAD_MS = 60000;                     // sin reintentar una URL fallida durante este tiempo
  var MAX_IMGS = 10;                      // imágenes por mensaje
  var MAX_DICT = 3000;                    // entradas del diccionario del canal (y de los globales)
  var MAX_SAVED = 4;                      // canales guardados en localStorage
  var TTL_CHAN = 6 * 3600 * 1000, TTL_GLOB = 24 * 3600 * 1000;
  var IX = 'emo.ix', GLOBAL = 'emo:*';
  var API7 = 'https://7tv.io/v3', APIB = 'https://api.betterttv.net/3/cached', APIF = 'https://api.frankerfacez.com/v1';

  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var want = '', gen = 0, chan = null, glob = null, globBusy = false;
  var cache = new Map(), bytes = 0, pending = 0, bad = {};

  function enabled() { return !w.Settings || w.Settings.get('emotes') !== 'off'; }

  /* ---------- URL de la imagen a partir del código ---------- */
  // 7: 7TV · 8: 7TV animado (versión estática) · b: BTTV · f: FFZ · t: Twitch
  function url(code) {
    var id = code.slice(1);
    if (!/^[\w-]+$/.test(id)) return '';                   // el id viene de la red: solo caracteres seguros en la URL
    switch (code.charAt(0)) {
      case '7': return 'https://cdn.7tv.app/emote/' + id + '/2x.webp';
      case '8': return 'https://cdn.7tv.app/emote/' + id + '/2x_static.webp';
      case 'b': return 'https://cdn.betterttv.net/emote/' + id + '/2x.png';
      case 'f': return 'https://cdn.frankerfacez.com/emote/' + id + '/2';
      case 't': return 'https://static-cdn.jtvnw.net/emoticons/v2/' + id + '/static/dark/2.0';
    }
    return '';
  }

  /* ---------- caché de imágenes en memoria (LRU con tope de bytes) ---------- */
  function drop(e) {
    if (!e.done) { e.done = true; pending--; clearTimeout(e.timer); }
    e.img.onload = e.img.onerror = null;
    try { e.img.src = ''; } catch (x) {}                  // libera el bitmap decodificado
  }
  function trim() {
    while (cache.size > 1 && (bytes > CACHE_BYTES || cache.size > CACHE_ITEMS)) {
      var k = cache.keys().next().value, e = cache.get(k);   // el primero = el menos usado
      cache.delete(k); bytes -= e.b; drop(e);
    }
  }
  function fail(u, e) {
    if (cache.get(u) === e) { cache.delete(u); bytes -= e.b; }
    drop(e); bad[u] = Date.now();
  }
  // Entrada de caché de la URL, o null si no se puede pedir ahora (demasiadas descargas en curso o falló hace poco).
  function ref(u) {
    var e = cache.get(u);
    if (e) { cache.delete(u); cache.set(u, e); return e; }   // se marca como el más reciente
    if (pending >= MAX_PENDING || (bad[u] && Date.now() - bad[u] < BAD_MS)) return null;
    delete bad[u];
    var im = new w.Image();
    e = { img: im, b: 56 * 56 * 4, done: false, timer: 0 };  // estimación hasta conocer el tamaño real
    pending++;
    im.onload = function () {
      if (e.done) return;
      e.done = true; pending--; clearTimeout(e.timer);
      var nb = (im.naturalWidth || 56) * (im.naturalHeight || 56) * 4;
      bytes += nb - e.b; e.b = nb;
      im.onload = im.onerror = null;
      trim();
    };
    im.onerror = function () { if (!e.done) fail(u, e); };
    e.timer = setTimeout(function () { if (!e.done) fail(u, e); }, PENDING_MS);
    cache.set(u, e); bytes += e.b;
    im.src = u;
    trim();
    return e;
  }
  function clearImages() {
    cache.forEach(drop);
    cache.clear(); bytes = 0; pending = 0; bad = {};
  }

  /* ---------- pintado ---------- */
  // Rangos de emotes de Twitch ("25:0-4,12-16/1902:6-10", índices en puntos de código) -> {inicio UTF-16: [fin, id]}
  function ranges(etag, text) {
    if (!etag) return null;
    var surr = /[\ud800-\udbff]/.test(text), map = null, i, j, k;
    if (surr) {                                           // Twitch cuenta puntos de código, JS unidades UTF-16
      map = []; k = 0;
      for (i = 0; i < text.length; i++, k++) { map[k] = i; if (/[\ud800-\udbff]/.test(text.charAt(i))) i++; }
      map[k] = text.length;
    }
    var out = {}, any = false, groups = etag.split('/');
    for (i = 0; i < groups.length; i++) {
      var g = groups[i], c = g.indexOf(':');
      if (c < 1) continue;
      var rs = g.slice(c + 1).split(',');
      for (j = 0; j < rs.length; j++) {
        var p = rs[j].split('-'), s = +p[0], e = +p[1];
        if (!(s >= 0) || !(e >= s)) continue;
        if (map) { s = map[s]; e = map[e + 1] - 1; }
        if (s === undefined || !(e >= s)) continue;
        out[s] = [e + 1, g.slice(0, c)]; any = true;
      }
    }
    return any ? out : null;
  }
  function lookup(word) {
    if (word.length > 40) return null;
    if (chan && has(chan, word)) return chan[word];
    if (glob && has(glob, word)) return glob[word];
    return null;
  }
  // Trozos del mensaje: textos y [código, nombre]. null si no hay ningún emote.
  function split(text, etag) {
    var tw = ranges(etag, text);
    if (!tw && !chan && !glob) return null;
    var out = [], buf = '', i = 0, n = text.length, found = false;
    while (i <= n) {
      var j = text.indexOf(' ', i);
      if (j < 0) j = n;
      var word = text.slice(i, j), code = null;
      if (word) {
        var r = tw && tw[i];
        code = r && r[0] === j ? 't' + r[1] : lookup(word);
      }
      if (code) { if (buf) out.push(buf); buf = ''; out.push([code, word]); found = true; }
      else buf += word;
      if (j < n) buf += ' ';
      i = j + 1;
    }
    if (buf) out.push(buf);
    return found ? out : null;
  }
  function image(u, name) {
    var im = document.createElement('img');
    im.className = 'emo'; im.alt = name;
    im.onerror = function () {                            // si falla, el nombre como texto
      var p = im.parentNode;
      im.onerror = null;
      if (p) p.replaceChild(document.createTextNode(name), im);
    };
    im.src = u;
    return im;
  }
  // Rellena el elemento con el texto del mensaje, con los emotes como imágenes (o solo texto si no hay ninguno / están apagados).
  function fill(el, text, etag) {
    var parts = enabled() ? split(text, etag) : null;
    if (!parts) { el.textContent = text; return; }
    while (el.firstChild) el.removeChild(el.firstChild);
    var f = document.createDocumentFragment(), buf = '', imgs = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (typeof p === 'string') { buf += p; continue; }
      var u = imgs < MAX_IMGS ? url(p[0]) : '';
      if (u && ref(u)) {
        if (buf) { f.appendChild(document.createTextNode(buf)); buf = ''; }
        f.appendChild(image(u, p[1])); imgs++;
      } else buf += p[1];
    }
    if (buf) f.appendChild(document.createTextNode(buf));
    el.appendChild(f);
  }

  /* ---------- diccionarios: red ---------- */
  function get(u, opts) {
    return w.Api.timeout(w.fetch(u, opts), 15000).then(function (r) {
      if (r.status === 404) return null;                  // sin emotes de ese proveedor en este canal
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    });
  }
  function add(d, name, code) {
    if (name && !has(d, name) && d.__n < MAX_DICT) { d[name] = code; d.__n++; }
  }
  function newDict() { var d = {}; Object.defineProperty(d, '__n', { value: 0, writable: true, enumerable: false }); return d; }

  function from7(arr, d) {
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (e && e.id && e.name) add(d, e.name, (e.data && e.data.animated ? '8' : '7') + e.id);
    }
  }
  // Canal en 7TV por GraphQL, pidiendo solo id, nombre y si es animado (la REST de un canal grande son MB de JSON).
  // La respuesta lleva un bloque "extensions" enorme (trazas) que se descarta antes de interpretar el JSON.
  function gql7(q, vars) {
    return get(API7 + '/gql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: vars }) })
      .then(function (r) { return r && r.text(); }).then(function (t) {
        if (t === null || t === undefined) return null;
        var x = t.indexOf(',"extensions"');
        return JSON.parse(x > 0 ? t.slice(0, x) + '}' : t).data;
      });
  }
  function load7(id, d) {
    return gql7('query($id:String!){userByConnection(platform:TWITCH,id:$id){connections{platform emote_set_id}}}', { id: id }).then(function (r) {
      var cs = r && r.userByConnection && r.userByConnection.connections || [], set = '';
      for (var i = 0; i < cs.length; i++) if (cs[i].platform === 'TWITCH' && cs[i].emote_set_id) set = cs[i].emote_set_id;
      if (!set) return;
      return gql7('query($id:ObjectID!){emoteSet(id:$id){emotes{id name data{animated}}}}', { id: set }).then(function (s) {
        if (s && s.emoteSet) from7(s.emoteSet.emotes || [], d);
      });
    });
  }
  function fromB(arr, d) {
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id && !arr[i].modifier) add(d, arr[i].code, 'b' + arr[i].id);
  }
  function loadB(id, d) {
    return get(APIB + '/users/twitch/' + encodeURIComponent(id)).then(function (r) { return r && r.json(); }).then(function (j) {
      if (j) { fromB(j.channelEmotes || [], d); fromB(j.sharedEmotes || [], d); }
    });
  }
  function fromF(root, d, room) {
    if (!root || !root.sets) return;
    var ids = room ? [root.room && root.room.set] : root.default_sets || Object.keys(root.sets);
    for (var i = 0; i < ids.length; i++) {
      var set = root.sets[String(ids[i])], em = set && set.emoticons || [];
      for (var k = 0; k < em.length; k++) if (em[k] && em[k].id && !em[k].hidden && !em[k].modifier) add(d, em[k].name, 'f' + em[k].id);
    }
  }
  function loadF(login, d) {
    return get(APIF + '/room/' + encodeURIComponent(login)).then(function (r) { return r && r.json(); }).then(function (j) { fromF(j, d, true); });
  }

  /* ---------- diccionarios: localStorage ---------- */
  function readIx() { try { return JSON.parse(localStorage.getItem(IX)) || []; } catch (e) { return []; } }
  function readStore(key, ttl) {
    try {
      var o = JSON.parse(localStorage.getItem(key));
      return o && o.d && Date.now() - o.t < ttl ? o.d : null;
    } catch (e) { return null; }
  }
  // Los canales llevan un índice (del menos al más usado) y se guardan como mucho MAX_SAVED; los globales van aparte.
  function writeStore(key, d) {
    var s, ix = key === GLOBAL ? [] : readIx().filter(function (k) { return k !== key; }).concat(key);
    try {
      s = JSON.stringify({ t: Date.now(), d: d });
      while (ix.length > MAX_SAVED) localStorage.removeItem(ix.shift());
      for (;;) {
        try { localStorage.setItem(key, s); break; }
        catch (e) { if (ix.length <= 1) throw e; localStorage.removeItem(ix.shift()); }   // sin sitio: se borra el canal menos usado
      }
      if (key !== GLOBAL) localStorage.setItem(IX, JSON.stringify(ix));
    } catch (e) {}
  }
  function touchStore(key) {
    if (key === GLOBAL) return;
    var ix = readIx().filter(function (k) { return k !== key; });
    ix.push(key);
    try { localStorage.setItem(IX, JSON.stringify(ix)); } catch (e) {}
  }
  // Une los diccionarios por orden de prioridad (el primero gana si un nombre se repite)
  function merge(list) {
    var d = newDict();
    for (var i = 0; i < list.length; i++) for (var k in list[i]) if (has(list[i], k)) add(d, k, list[i][k]);
    return d;
  }
  function plain(d) { var o = {}; for (var k in d) if (has(d, k)) o[k] = d[k]; return o; }

  function loadGlobal() {
    if (glob || globBusy) return;
    var c = readStore(GLOBAL, TTL_GLOB);
    if (c) { glob = c; touchStore(GLOBAL); return; }
    globBusy = true;
    var d7 = newDict(), db = newDict(), df = newDict(), ok = true;
    function soft(p) { return p.then(null, function () { ok = false; }); }
    Promise.all([
      soft(get(API7 + '/emote-sets/global').then(function (r) { return r && r.json(); }).then(function (j) { if (j) from7(j.emotes || [], d7); })),
      soft(get(APIB + '/emotes/global').then(function (r) { return r && r.json(); }).then(function (j) { if (j) fromB(j, db); })),
      soft(get(APIF + '/set/global').then(function (r) { return r && r.json(); }).then(function (j) { fromF(j, df, false); }))
    ]).then(function () {
      globBusy = false;
      if (!enabled()) return;
      var d = merge([d7, db, df]);
      glob = d;
      if (ok) writeStore(GLOBAL, plain(d));
    });
  }

  function loadChannel(login) {
    var g = ++gen, key = 'emo:' + login;
    var c = readStore(key, TTL_CHAN);
    if (c) { chan = c; touchStore(key); return; }
    chan = null;
    w.Api.channelId(login).then(function (id) {
      if (g !== gen || !id) return;
      var d7 = newDict(), db = newDict(), df = newDict(), ok = true;
      function soft(p) { return p.then(null, function () { ok = false; }); }
      return Promise.all([soft(load7(id, d7)), soft(loadB(id, db)), soft(loadF(login, df))]).then(function () {
        if (g !== gen || !enabled()) return;
        var d = merge([d7, db, df]);
        chan = d;
        if (ok) writeStore(key, plain(d));              // con un proveedor caído no se guarda un diccionario incompleto
      });
    }).then(null, function () {});
  }

  /* ---------- API ---------- */
  function apply() {
    if (!want || !enabled()) { gen++; chan = null; clearImages(); return; }
    loadGlobal();
    loadChannel(want);
  }
  // Canal cuyos emotes se usan ahora (login). '' = ninguno: se libera todo.
  function use(login) {
    login = String(login || '').toLowerCase();
    if (login === want) return;
    want = login;
    if (!login) { gen++; chan = null; clearImages(); return; }
    apply();
  }
  function release() { want = ''; gen++; chan = null; clearImages(); }

  if (w.Settings) w.Settings.onChange(function (k) { if (k === 'emotes' || k === '*') { chan = null; apply(); } });

  w.Emotes = {
    use: use, release: release, fill: fill, url: url,
    _stats: function () { return { bytes: bytes, images: cache.size, pending: pending, chan: chan ? Object.keys(chan).length : 0, glob: glob ? Object.keys(glob).length : 0, want: want }; },
    _limits: function () { return { bytes: CACHE_BYTES, items: CACHE_ITEMS, pending: MAX_PENDING, imgs: MAX_IMGS, dict: MAX_DICT }; }
  };
})(window);
