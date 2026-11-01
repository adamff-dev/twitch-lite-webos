/* UI + navegación con mando. Un solo conjunto de elementos .f focusables y navegación espacial por geometría. */
(function () {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var app = $('app'), grid = $('grid'), content = $('content'), msg = $('msg'), crumb = $('crumb'), qin = $('q'), acct = $('acct');
  var tabEls = document.querySelectorAll('.tab');
  var views = {}, stack = [], view = null, loading = false, foc = null;

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + ' K' : String(n); }
  function two(n) { return n < 10 ? '0' + n : String(n); }
  function dur(s) {
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' + two(m) : m) + ':' + two(s % 60);
  }
  function say(t) { msg.textContent = t || ''; msg.hidden = !t; }

  /* ---------- tarjetas ---------- */
  function cardHtml(it, i) {
    var cls = it.type === 'game' ? ' g' : it.type === 'channel' ? ' g c' : '';
    var h = '<div class="f card' + cls + '" data-i="' + i + '"><div class="th">' + (it.thumb ? '<img src="' + esc(it.thumb) + '">' : '');
    if (it.type === 'video') h += '<div class="du">' + dur(it.duration) + '</div>';
    else if (it.type !== 'channel' || it.live) h += '<div class="vw">' + fmt(it.viewers) + '</div>';
    h += '</div>';
    if (it.type === 'video') {
      h += '<div class="nm">' + esc(it.title) + '</div><div class="ti">' + esc(it.date) + ' · ' + fmt(it.views) + ' visualizaciones</div><div class="gm">' + esc(it.game) + '</div>';
    } else if (it.type === 'stream') {
      h += '<div class="nm">' + esc(it.name) + '</div><div class="ti">' + esc(it.title) + '</div><div class="gm">' + esc(it.game) + '</div>';
    } else {
      h += '<div class="nm">' + esc(it.name) + '</div>';
    }
    return h + '</div>';
  }

  function appendItems(items, start) {
    var h = '';
    for (var i = 0; i < items.length; i++) h += cardHtml(items[i], start + i);
    grid.insertAdjacentHTML('beforeend', h);
  }

  /* ---------- foco ---------- */
  function setFocus(el) {
    if (!el) return;
    if (foc) foc.classList.remove('foc');
    foc = el;
    el.classList.add('foc');
    if (content.contains(el)) {
      var r = el.getBoundingClientRect(), c = content.getBoundingClientRect(), pad = c.height * 0.04;
      if (r.top < c.top + pad) content.scrollTop -= (c.top + pad - r.top);
      else if (r.bottom > c.bottom - pad) content.scrollTop += r.bottom - (c.bottom - pad);
      if (view && el.getAttribute('data-i') !== null) {
        var idx = +el.getAttribute('data-i');
        view.focus = idx;
        if (idx >= view.items.length - 8) loadMore(false);
      }
    }
  }

  function move(dir) {
    if (!foc || !document.body.contains(foc)) { setFocus(app.querySelector('.f')); return; }
    var els = app.querySelectorAll('.f'), cr = foc.getBoundingClientRect();
    var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2, best = null, bs = 1e9;
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e === foc) continue;
      var r = e.getBoundingClientRect();
      if (!r.width) continue;
      var dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy, s;
      if (dir === 'right') { if (dx <= 1 || Math.abs(dy) > cr.height) continue; s = dx + Math.abs(dy) * 3; }
      else if (dir === 'left') { if (dx >= -1 || Math.abs(dy) > cr.height) continue; s = -dx + Math.abs(dy) * 3; }
      else if (dir === 'down') { if (dy <= 1) continue; s = dy + Math.abs(dx) * 2; }
      else { if (dy >= -1) continue; s = -dy + Math.abs(dx) * 2; }
      if (s < bs) { bs = s; best = e; }
    }
    if (best) setFocus(best);
  }

  /* ---------- vistas ---------- */
  // fetch(cursor) -> Promise<{items, cursor, hasNext}>. Sin fetch = vista estática con mensaje.
  function makeView(o) {
    return { tab: o.tab, title: o.title || '', items: [], cursor: null, done: !o.fetch, fetch: o.fetch || null, focus: 0, scroll: 0, empty: o.empty || '' };
  }

  function tabView(name) {
    var li = Auth.isLoggedIn();
    if (name === 'streams') return makeView({ tab: name, fetch: Api.topStreams, empty: 'No hay directos' });
    if (name === 'games') return makeView({ tab: name, fetch: Api.topGames, empty: 'No hay categorías' });
    if (name === 'following') {
      return li ? makeView({ tab: name, fetch: Auth.followedStreams, empty: 'Ninguno de los canales que sigues está en directo ahora mismo' })
        : makeView({ tab: name, empty: 'Inicia sesión con "Entrar" (arriba a la derecha) para ver los canales que sigues' });
    }
    if (name === 'videos') {
      return li ? makeView({ tab: name, fetch: Auth.followedChannels, empty: 'Aún no sigues ningún canal' })
        : makeView({ tab: name, empty: 'Inicia sesión con "Entrar" para ver los vídeos de tus canales, o usa Buscar para encontrar un canal' });
    }
    return makeView({ tab: 'search', empty: 'Selecciona el cuadro de búsqueda y pulsa OK para escribir' });
  }

  function markTabs() {
    for (var i = 0; i < tabEls.length; i++)
      tabEls[i].classList[tabEls[i].getAttribute('data-tab') === view.tab ? 'add' : 'remove']('on');
  }

  function showView(v) {
    view = v; loading = false;
    if (foc && grid.contains(foc)) foc = null;           // la tarjeta se destruye; si el foco está en una pestaña, setFocus lo limpia
    markTabs();
    crumb.textContent = v.title;
    grid.innerHTML = '';
    appendItems(v.items, 0);
    content.scrollTop = v.scroll || 0;
    say(v.items.length ? '' : v.empty);
    if (!v.items.length && !v.done) loadMore(true);
    else if (v.items.length) setFocus(grid.children[Math.min(v.focus, v.items.length - 1)]);
    else setFocus(app.querySelector('.tab.on') || app.querySelector('.f'));
  }

  function loadMore(first) {
    var v = view;
    if (!v || loading || v.done || !v.fetch) return;
    loading = true;
    if (first) say('Cargando…');
    v.fetch(v.cursor).then(function (r) {
      var start = v.items.length;
      v.items = v.items.concat(r.items);
      v.cursor = r.cursor;
      v.done = !r.hasNext || v.items.length >= Api.MAX || !r.items.length;
      loading = false;
      if (view !== v) return;
      appendItems(r.items, start);
      say(v.items.length ? '' : v.empty || 'Sin resultados');
      if (first && v.items.length) setFocus(grid.children[0]);
    }, function (e) {
      loading = false;
      if (view === v && !v.items.length) say('Error: ' + e.message + ' — pulsa OK en la pestaña para reintentar');
    });
  }

  function switchTab(name) {
    stack = [];
    if (!views[name]) views[name] = tabView(name);
    showView(views[name]);
  }

  function push(v) {
    view.scroll = content.scrollTop;
    stack.push(view);
    showView(v);
  }

  function openChannel(login, name) {
    push(makeView({
      tab: view.tab, title: name,
      fetch: function (c) { return Api.channelVideos(login, c); }, empty: 'Este canal no tiene vídeos'
    }));
  }

  function doSearch() {
    var text = qin.value.replace(/^\s+|\s+$/g, '');
    if (!text) return;
    stack = [];
    views.search = makeView({
      tab: 'search', fetch: function () { return Api.search(text); }, empty: 'Sin resultados para "' + text + '"'
    });
    showView(views.search);
  }

  /* ---------- cuenta ---------- */
  function setAcct(img) {
    acct.textContent = Auth.isLoggedIn() ? (Auth.login() || 'Cuenta') : 'Entrar';
    if (img) {
      var el = document.createElement('img');
      el.className = 'av'; el.src = img;
      acct.insertBefore(el, acct.firstChild);
    }
  }
  function refreshAcct() {
    setAcct('');
    if (!Auth.isLoggedIn()) return;
    Auth.avatar(70).then(function (u) { if (u && Auth.isLoggedIn()) setAcct(u); });
  }

  function onAuthChange() {
    refreshAcct();
    views.following = views.videos = null;               // dependen de la sesión
    if (view && (view.tab === 'following' || view.tab === 'videos')) switchTab(view.tab);
    else setFocus(grid.children[view ? view.focus : 0] || acct);   // no dejar el foco en el botón de cuenta
  }

  /* ---------- acciones ---------- */
  function itemOf(el) { return view.items[+el.getAttribute('data-i')]; }

  function activate(el) {
    var tab = el.getAttribute('data-tab');
    if (tab) {
      if (tab === 'search') { qin.focus(); return; }     // abre el teclado en pantalla
      if (tab === 'account') { Login.open(onAuthChange); return; }
      switchTab(tab);
      return;
    }
    var it = itemOf(el);
    if (!it) return;
    if (it.type === 'game') {
      push(makeView({ tab: view.tab, title: it.name, fetch: function (c) { return Api.gameStreams(it.key, c); }, empty: 'Nadie emite esta categoría ahora mismo' }));
    } else if (it.type === 'channel') {
      openChannel(it.login, it.name);
    } else {                                              // stream | video
      view.scroll = content.scrollTop;
      Player.open(it, function () { setFocus(grid.children[view.focus] || app.querySelector('.f')); });
    }
  }

  function back() {
    if (stack.length) { showView(stack.pop()); return; }
    try { window.close(); } catch (e) {}                // sale de la app en webOS
  }

  /* ---------- mando ---------- */
  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 461: 'back', 27: 'back', 8: 'back',
    415: 'play', 19: 'pause', 413: 'stop', 179: 'playpause', 412: 'rw', 417: 'ff', 403: 'refresh', 405: 'channel' };

  document.addEventListener('keydown', function (e) {
    var k = KEYS[e.keyCode];
    if (!k) return;
    if (e.repeat && (k === 'ok' || k === 'back' || k === 'channel' || k === 'refresh')) { e.preventDefault(); return; }   // pulsación mantenida
    if (document.activeElement === qin) {               // escribiendo en el cuadro de búsqueda
      if (k === 'ok') { qin.blur(); doSearch(); e.preventDefault(); }
      else if (k === 'back' && e.keyCode !== 8) { qin.blur(); e.preventDefault(); }
      return;
    }
    e.preventDefault();
    if (Login.isOpen()) { Login.key(k); return; }
    if (Player.isOpen()) { Player.key(k); return; }
    if (k === 'ok') { if (foc) activate(foc); }
    else if (k === 'back') back();
    else if (k === 'refresh') { var t = view.tab; views[t] = null; switchTab(t); }
    else if (k === 'channel') {                          // amarillo: ver los vídeos del canal de la tarjeta
      var it = foc && foc.getAttribute('data-i') !== null ? itemOf(foc) : null;
      if (it && it.type === 'stream') openChannel(it.login, it.name);
    }
    else if (k === 'left' || k === 'right' || k === 'up' || k === 'down') move(k);
  });

  refreshAcct();
  Auth.init().then(function () {
    var was = acct.textContent;
    refreshAcct();
    if (acct.textContent !== was) { views.following = views.videos = null; }
  });
  switchTab('streams');
})();
