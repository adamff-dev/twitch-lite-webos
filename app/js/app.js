/* UI + navegación con mando.
   El foco se mueve por aritmética de índices (sin medir el DOM), así que mantener pulsada una flecha es barato. */
(function () {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var app = $('app'), grid = $('grid'), content = $('content'), msg = $('msg'), crumb = $('crumb'), qin = $('q'), acct = $('acct'), atoast = $('atoast');
  var tabEls = document.querySelectorAll('.tab');
  var TABS = ['streams', 'games', 'following', 'videos', 'search'];
  var COLS = { stream: 4, video: 4, game: 6, channel: 6 };   // deben coincidir con el CSS
  var views = {}, stack = [], view = null, loading = false, foc = null, lastBack = 0, atT = 0;

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(n) { return I18n.compact(n); }
  function two(n) { return n < 10 ? '0' + n : String(n); }
  function dur(s) {
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' + two(m) : m) + ':' + two(s % 60);
  }
  function say(t) { msg.textContent = t || ''; msg.hidden = !t; }
  function flash(t) {
    atoast.textContent = t; atoast.hidden = false;
    clearTimeout(atT);
    atT = setTimeout(function () { atoast.hidden = true; }, 2200);
  }

  /* ---------- tarjetas ---------- */
  function cardHtml(it, i) {
    var cls = it.type === 'game' ? ' g' : it.type === 'channel' ? ' g c' : '';
    var h = '<div class="f card' + cls + '" data-i="' + i + '"><div class="th">' + (it.thumb ? '<img src="' + esc(it.thumb) + '">' : '');
    if (it.type === 'video') h += '<div class="du">' + dur(it.duration) + '</div>';
    else if (it.type !== 'channel' || it.live) h += '<div class="vw">' + fmt(it.viewers) + '</div>';
    h += '</div>';
    if (it.type === 'video') {
      h += '<div class="nm">' + esc(it.title) + '</div><div class="ti">' + esc(it.date) + ' · ' + I18n.t('card.views', { n: fmt(it.views) }) + '</div><div class="gm">' + esc(it.game) + '</div>';
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
      // offsetTop es relativo a #content y no cambia con el scroll: no fuerza medir cada rect
      var H = content.clientHeight, pad = H * 0.04, top = el.offsetTop - content.scrollTop;
      if (top < pad) content.scrollTop = el.offsetTop - pad;
      else if (top + el.offsetHeight > H - pad) content.scrollTop = el.offsetTop + el.offsetHeight - H + pad;
      if (view && el.getAttribute('data-i') !== null) {
        var idx = +el.getAttribute('data-i');
        view.focus = idx;
        if (idx >= view.items.length - 8) loadMore(false);
      }
    }
  }

  function focusIdx(i) { setFocus(grid.children[i]); }
  function topEls() { return Array.prototype.slice.call(app.querySelectorAll('#top .f')); }
  function activeTab() { return app.querySelector('.tab.on') || app.querySelector('#top .f'); }

  function move(dir) {
    if (!foc || !document.body.contains(foc)) { setFocus(activeTab()); return; }
    var di = foc.getAttribute('data-i'), n = view.items.length;
    if (di === null) {                                    // barra superior
      var els = topEls(), k = els.indexOf(foc);
      if (dir === 'left' && k > 0) setFocus(els[k - 1]);
      else if (dir === 'right' && k < els.length - 1) setFocus(els[k + 1]);
      else if (dir === 'down' && n) focusIdx(Math.min(view.focus, n - 1));   // vuelve a la última tarjeta
      return;
    }
    var idx = +di, cols = COLS[view.items[idx].type] || 4;
    if (dir === 'right') { if (idx % cols < cols - 1 && idx + 1 < n) focusIdx(idx + 1); }
    else if (dir === 'left') { if (idx % cols > 0) focusIdx(idx - 1); }
    else if (dir === 'up') { if (idx - cols >= 0) focusIdx(idx - cols); else setFocus(activeTab()); }
    else if (dir === 'down') {
      if (idx + cols < n) focusIdx(idx + cols);
      else if (Math.floor(idx / cols) < Math.floor((n - 1) / cols)) focusIdx(n - 1);   // última fila incompleta
      else loadMore(false);
    }
  }

  function page(dir) {                                    // salto de 3 filas
    if (!foc || foc.getAttribute('data-i') === null) return;
    var idx = +foc.getAttribute('data-i'), cols = COLS[view.items[idx].type] || 4, n = view.items.length;
    focusIdx(Math.max(0, Math.min(n - 1, idx + dir * cols * 3)));
  }

  /* ---------- vistas ---------- */
  // fetch(cursor) -> Promise<{items, cursor, hasNext}>. Sin fetch = vista estática con mensaje.
  function makeView(o) {
    return { tab: o.tab, title: o.title || '', items: [], cursor: null, done: !o.fetch, fetch: o.fetch || null, focus: 0, scroll: 0, empty: o.empty || '', vars: o.vars };
  }
  // El mensaje de vista vacía se guarda como clave y se traduce al mostrarlo (así cambia con el idioma).
  function emptyText(v) { return v.empty ? I18n.t(v.empty, v.vars) : ''; }

  function tabView(name) {
    var li = Auth.isLoggedIn();
    if (name === 'streams') return makeView({ tab: name, fetch: Api.topStreams, empty: 'empty.streams' });
    if (name === 'games') return makeView({ tab: name, fetch: Api.topGames, empty: 'empty.games' });
    if (name === 'following') {
      return li ? makeView({ tab: name, fetch: Auth.followedStreams, empty: 'empty.following' })
        : makeView({ tab: name, empty: 'empty.followingGuest' });
    }
    if (name === 'videos') {
      return li ? makeView({ tab: name, fetch: Auth.followedChannels, empty: 'empty.videos' })
        : makeView({ tab: name, empty: 'empty.videosGuest' });
    }
    return makeView({ tab: 'search', empty: 'empty.search' });
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
    say(v.items.length ? '' : emptyText(v));
    if (!v.items.length && !v.done) loadMore(true);
    else if (v.items.length) setFocus(grid.children[Math.min(v.focus, v.items.length - 1)]);
    else setFocus(activeTab());
  }

  function loadMore(first) {
    var v = view;
    if (!v || loading || v.done || !v.fetch) return;
    loading = true;
    if (first) say(I18n.t('loading'));
    v.fetch(v.cursor).then(function (r) {
      var start = v.items.length;
      v.items = v.items.concat(r.items);
      v.cursor = r.cursor;
      v.done = !r.hasNext || v.items.length >= Api.MAX || !r.items.length;
      loading = false;
      if (view !== v) return;
      appendItems(r.items, start);
      say(v.items.length ? '' : emptyText(v) || I18n.t('empty.noResults'));
      if (first && v.items.length) setFocus(grid.children[0]);
    }, function (e) {
      loading = false;
      if (view === v && !v.items.length) say(I18n.t('error.retry', { msg: e.message }));
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
      fetch: function (c) { return Api.channelVideos(login, c); }, empty: 'empty.channel'
    }));
  }

  function doSearch() {
    var text = qin.value.replace(/^\s+|\s+$/g, '');
    if (!text) return;
    stack = [];
    views.search = makeView({
      tab: 'search', fetch: function () { return Api.search(text); }, empty: 'empty.searchFor', vars: { q: text }
    });
    showView(views.search);
  }

  /* ---------- cuenta ---------- */
  function setAcct(img) {
    acct.textContent = Auth.isLoggedIn() ? (Auth.login() || I18n.t('account.default')) : I18n.t('account.login');
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
      if (tab === 'lang') { I18n.toggle(); return; }     // selector ES/EN
      if (tab === 'search') { qin.focus(); return; }     // abre el teclado en pantalla
      if (tab === 'account') { Login.open(onAuthChange); return; }
      switchTab(tab);
      return;
    }
    var it = itemOf(el);
    if (!it) return;
    if (it.type === 'game') {
      push(makeView({ tab: view.tab, title: it.name, fetch: function (c) { return Api.gameStreams(it.key, c); }, empty: 'empty.game' }));
    } else if (it.type === 'channel') {
      openChannel(it.login, it.name);
    } else {                                              // stream | video
      view.scroll = content.scrollTop;
      Player.open(it, function () { setFocus(grid.children[view.focus] || activeTab()); });
    }
  }

  // Atrás: sale de la vista anidada → de la cuadrícula a las pestañas → a Inicio → (2 veces seguidas) cierra la app.
  function back() {
    if (stack.length) { showView(stack.pop()); return; }
    if (foc && grid.contains(foc)) { setFocus(activeTab()); return; }
    if (view.tab !== 'streams') { switchTab('streams'); return; }
    var now = Date.now();
    if (now - lastBack < 2500) { try { window.close(); } catch (e) {} return; }
    lastBack = now;
    flash(I18n.t('app.exitHint'));
  }

  /* ---------- mando ---------- */
  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 461: 'back', 27: 'back', 8: 'back',
    415: 'play', 19: 'pause', 413: 'stop', 179: 'playpause', 412: 'rw', 417: 'ff', 403: 'refresh', 404: 'green', 405: 'channel',
    33: 'pgup', 34: 'pgdn', 427: 'pgup', 428: 'pgdn',
    49: 't0', 50: 't1', 51: 't2', 52: 't3', 53: 't4' };

  document.addEventListener('keydown', function (e) {
    var k = KEYS[e.keyCode];
    if (!k) return;
    if (e.repeat && (k === 'ok' || k === 'back' || k === 'channel' || k === 'refresh' || k === 'green')) { e.preventDefault(); return; }   // pulsación mantenida
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
    else if (k === 'pgup' || k === 'pgdn') page(k === 'pgup' ? -1 : 1);
    else if (k.charAt(0) === 't' && k.length === 2) {    // 1-5: Inicio, Categorías, Siguiendo, Vídeos, Buscar
      var name = TABS[+k.charAt(1)];
      if (name === 'search') setFocus(qin); else switchTab(name);
    }
    else if (k === 'left' || k === 'right' || k === 'up' || k === 'down') move(k);
  });

  /* ---------- idioma ---------- */
  var langEl = $('lang');
  function relang() {
    langEl.textContent = I18n.lang().toUpperCase();
    refreshAcct();
    if (!view) return;
    var inGrid = foc && grid.contains(foc), keep = view.focus;
    if (inGrid) foc = null;
    grid.innerHTML = '';
    appendItems(view.items, 0);
    say(view.items.length ? '' : emptyText(view));
    if (inGrid && view.items.length) setFocus(grid.children[Math.min(keep, view.items.length - 1)]);
  }
  I18n.onChange(relang);

  relang();
  Auth.init().then(function () {
    var was = acct.textContent;
    refreshAcct();
    if (acct.textContent !== was) { views.following = views.videos = null; }
  });
  switchTab('streams');
})();
