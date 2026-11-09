/* Chat de Twitch de solo lectura (en directo por IRC; en un VOD, la repetición sincronizada), pensado para TVs con pocos recursos:
   - una única conexión WebSocket (IRC anónimo), abierta solo mientras el chat está visible;
   - N nodos del DOM fijos que se reciclan (nunca se crean/destruyen elementos en caliente);
   - como mucho 4 repintados por segundo y un tope de mensajes por repintado (ante una ráfaga se descartan los antiguos);
   - los emotes son imágenes pequeñas y estáticas con caché de memoria acotada (emotes.js); solo se parsean los mensajes que se van a pintar. */
(function (w) {
  'use strict';
  var WS_URL = 'wss://irc-ws.chat.twitch.tv:443';
  var N = 30;            // nodos reutilizados
  var FLUSH = 250;       // ms entre repintados
  var PER_FLUSH = 8;     // mensajes máximos por repintado
  var BACKLOG = 60;      // líneas sin procesar que se guardan como mucho
  var MAXLEN = 160;      // caracteres por mensaje
  var $ = function (i) { return document.getElementById(i); };
  var box = $('chat'), list = $('cmsgs'), cst = $('cst');
  var on = false, chan = null, ws = null, queue = [], timer = 0, retry = 0, retryT = 0, count = 0;
  try { on = localStorage.getItem('chat') === '1'; } catch (e) {}

  /* ---------- parseo (sin crear mapas de tags) ---------- */
  function tag(tags, key) {
    var s = ';' + tags, k = s.indexOf(';' + key + '=');
    if (k < 0) return '';
    k += key.length + 2;
    var e = s.indexOf(';', k);
    return s.slice(k, e < 0 ? s.length : e);
  }
  function lum(hex) {                                     // luminancia aproximada para evitar nombres ilegibles sobre fondo oscuro
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return 0.3 * r + 0.59 * g + 0.11 * b;
  }
  function parse(line) {
    var i = line.indexOf(' PRIVMSG ');
    if (i < 0) return null;
    var m = line.indexOf(' :', i + 9);
    if (m < 0) return null;
    var tags = line.charAt(0) === '@' ? line.slice(1, line.indexOf(' ')) : '';
    var text = line.slice(m + 2);
    var name = tag(tags, 'display-name').replace(/\\s/g, ' ');
    if (!name) {
      var p = line.indexOf(':', tags ? tags.length : 0);
      name = line.slice(p + 1, line.indexOf('!', p));
    }
    var color = tag(tags, 'color');
    if (!/^#[0-9A-Fa-f]{6}$/.test(color) || lum(color) < 70) color = '#bf94ff';
    var action = text.charCodeAt(0) === 1 && text.indexOf('ACTION ') === 1;
    if (action) text = text.slice(8, text.charCodeAt(text.length - 1) === 1 ? -1 : undefined);
    if (text.length > MAXLEN) text = text.slice(0, MAXLEN) + '…';
    return { n: name, c: color, t: text, a: action, e: tag(tags, 'emotes') };
  }

  /* ---------- pintado: nodos reciclados ---------- */
  function node() {
    if (list.children.length < N) {
      var d = document.createElement('div');
      d.className = 'cm';
      d.appendChild(document.createElement('b'));
      d.appendChild(document.createElement('span'));
      return d;
    }
    return list.firstChild;                               // reutiliza el más antiguo
  }
  function paint(m) {
    var d = node(), b = d.firstChild, s = d.lastChild;
    b.textContent = m.n + (m.a ? '' : ':');
    b.style.color = m.c;
    w.Emotes.fill(s, m.t, m.e);                           // texto, con los emotes como imágenes si están activados
    s.className = m.a ? 'me' : '';
    list.appendChild(d);                                  // mover el nodo al final = orden cronológico
    count++;
  }
  function flush() {
    timer = 0;
    var raw = queue; queue = [];
    if (raw.length > PER_FLUSH) raw = raw.slice(raw.length - PER_FLUSH);
    for (var i = 0; i < raw.length; i++) { var m = parse(raw[i]); if (m) paint(m); }
  }

  /* ---------- conexión ---------- */
  function status(t) { cst.textContent = t || ''; cst.hidden = !t; }
  function schedule() {
    clearTimeout(retryT);
    retryT = setTimeout(connect, Math.min(30000, 1000 * Math.pow(2, retry++)));
  }
  function connect() {
    if (ws || !chan || !on) return;
    var s;
    try { s = new WebSocket(WS_URL); } catch (e) { schedule(); return; }
    ws = s;
    status(I18n.t('chat.connecting'));
    s.onopen = function () {
      if (ws !== s || !chan) return;                      // llegó tarde: ya se cerró o se cambió de canal
      retry = 0;
      s.send('CAP REQ :twitch.tv/tags');
      s.send('PASS SCHMOOPIIE');
      s.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 80000)));
      s.send('JOIN #' + chan.toLowerCase());
      status('');
    };
    s.onmessage = function (e) {
      var lines = String(e.data).split('\r\n');
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (l.indexOf('PING') === 0) s.send('PONG :tmi.twitch.tv');
        else if (l.indexOf(' PRIVMSG ') > 0) {
          queue.push(l);
          if (queue.length > BACKLOG) queue.shift();
        }
      }
      if (queue.length && !timer) timer = setTimeout(flush, FLUSH);
    };
    s.onclose = function () {
      if (ws === s) ws = null;
      if (on && chan) { status(I18n.t('chat.reconnecting')); schedule(); }
    };
  }
  function disconnect() {
    clearTimeout(retryT); clearTimeout(timer); timer = 0; retry = 0; queue = [];
    var s = ws; ws = null;
    if (s) { s.onopen = null; s.onclose = null; s.onmessage = null; try { s.close(); } catch (e) {} }
  }
  function clearList() { while (list.firstChild) list.removeChild(list.firstChild); }

  /* ---------- chat de un VOD: la repetición de la emisión, sincronizada con la posición del vídeo ----------
     Se piden páginas de ~60 mensajes por GraphQL (sin WebSocket) y cada mensaje se pinta cuando el vídeo llega a su
     segundo. Se pide la página siguiente cuando quedan pocos mensajes por delante. Si la posición salta (adelantar,
     retroceder, cambiar de calidad) se vacía el panel y se vuelve a pedir desde la nueva posición. En pausa no sale nada. */
  var VOD_TICK = 250;     // ms entre comprobaciones
  var VOD_AHEAD = 30;     // mensajes por delante por debajo de los cuales se pide la página siguiente
  var VOD_BACK = 10;      // segundos de contexto previos al empezar o tras un salto
  var VOD_JUMP = 8;       // un avance mayor que esto (s entre dos comprobaciones) o cualquier retroceso es un salto
  var vod = null, vodTimer = 0;

  function vodStop() { clearInterval(vodTimer); vodTimer = 0; vod = null; }
  function vodFetch() {
    var s = vod;
    if (!s || s.busy || !s.more || Date.now() < s.retryAt) return;
    s.busy = true;
    var gen = s.gen;
    Api.vodComments(s.id, s.from, s.cursor).then(function (r) {
      if (vod !== s || s.gen !== gen) return;                // ya hubo un salto o se cerró el chat
      s.busy = false; s.buf = s.buf.concat(r.items); s.cursor = r.cursor; s.more = r.hasNext && !!r.cursor;
      status('');
    }, function () {
      if (vod !== s || s.gen !== gen) return;
      s.busy = false; s.retryAt = Date.now() + 3000;
    });
  }
  function vodReset(t) {
    var s = vod;
    s.gen++; s.buf = []; s.bi = 0; s.cursor = null; s.more = true; s.busy = false; s.retryAt = 0;
    s.last = t; s.from = Math.max(0, t - VOD_BACK);
    clearList(); status(I18n.t('loading'));
    vodFetch();
  }
  function vodPaint(m) {
    var c = m.c, t = m.m;
    if (!/^#[0-9A-Fa-f]{6}$/.test(c) || lum(c) < 70) c = '#bf94ff';
    if (t.length > MAXLEN) t = t.slice(0, MAXLEN) + '…';
    paint({ n: m.n, c: c, t: t, a: false, e: m.e });
  }
  function vodTick() {
    var s = vod, t = s ? s.time() : -1;
    if (!s || !(t >= 0)) return;
    if (t < s.last - 1 || t > s.last + VOD_JUMP) vodReset(t);
    s.last = t;
    var out = [];
    while (s.bi < s.buf.length && s.buf[s.bi].t <= t) out.push(s.buf[s.bi++]);
    if (out.length > PER_FLUSH) out = out.slice(out.length - PER_FLUSH);    // tras un salto o una ráfaga: solo lo más reciente
    for (var i = 0; i < out.length; i++) vodPaint(out[i]);
    if (s.buf.length - s.bi < VOD_AHEAD) vodFetch();
    if (s.bi > 200) { s.buf = s.buf.slice(s.bi); s.bi = 0; }               // no acumular lo ya mostrado
  }
  function vodStart() {
    if (!vod || vodTimer) return;
    vodReset(Math.max(0, vod.time() || 0));
    vodTimer = setInterval(vodTick, VOD_TICK);
  }

  function refresh() {
    var show = on && (!!chan || !!vod);
    box.hidden = !show;
    if (!show) { disconnect(); vodStop(); clearList(); status(''); w.Emotes.release(); }
    else if (chan) connect();
    else vodStart();
  }

  /* ---------- API ---------- */
  function attach(login) { vodStop(); chan = login; refresh(); if (on && login) w.Emotes.use(login); }
  // Chat de un VOD: id del vídeo, función que devuelve la posición actual en segundos y login del canal (para sus emotes).
  function attachVod(id, time, login) {
    disconnect(); vodStop(); chan = null;
    vod = { id: id, time: time, buf: [], bi: 0, cursor: null, more: true, busy: false, gen: 0, last: 0, from: 0, retryAt: 0 };
    clearList();
    refresh();
    if (on && login) w.Emotes.use(login);
  }
  function detach() { chan = null; vodStop(); refresh(); box.hidden = true; }
  function toggle() {
    on = !on;
    try { localStorage.setItem('chat', on ? '1' : '0'); } catch (e) {}
    refresh();
    return on;
  }

  w.Chat = { attach: attach, attachVod: attachVod, detach: detach, toggle: toggle, isOn: function () { return on; }, parse: parse, _stats: function () { return { nodes: list.children.length, painted: count, queued: queue.length, connected: !!ws }; } };
})(window);
