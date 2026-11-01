/* Reproductor: <video> nativo de webOS (HLS por hardware, sin hls.js). Directos y VODs.
   Mando: OK pausa · ▲ calidad · ▼ chat · ◀ ▶ saltos acelerados (VOD) · Atrás salir. */
(function (w) {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var el = $('player'), v = $('v'), ovl = $('ovl'), qm = $('qmenu'), pm = $('pmsg'), bar = $('obar'), fill = $('ofill'),
    tm = $('otime'), toast = $('ptoast'), st = $('pstate');
  var isOpen = false, item = null, quals = [], qi = 0, mi = 0, menu = false, isVod = false;
  var hideT = 0, retried = false, loadId = 0, onClose = null, toastT = 0;
  var seekTarget = null, seekFrom = 0, seekStreak = 0, seekLast = 0, seekT = 0;
  var resumeAt = 0;          // posición a recuperar al cambiar de calidad o reintentar un VOD
  var badQ = {};             // calidades que han fallado en esta sesión (algunos VODs no tienen todas)
  var STEPS = [10, 10, 30, 30, 60, 60, 120, 120, 300];     // segundos por pulsación según la racha de pulsaciones rápidas

  function say(t) { pm.textContent = t || ''; pm.hidden = !t; }
  function store(k, val) {
    try { if (val === undefined) return localStorage.getItem(k); localStorage.setItem(k, val); } catch (e) {}
  }
  function fmtN(n) { return I18n.thousands(n); }
  function fmt(n) { return I18n.compact(n); }
  function two(n) { return n < 10 ? '0' + n : String(n); }
  function hms(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' + two(m) : m) + ':' + two(s % 60);
  }
  function duration() { return v.duration > 0 && isFinite(v.duration) ? v.duration : (item && item.duration) || 0; }

  /* ---------- avisos (puntos, chat...) ---------- */
  function flash(t, ms) {
    toast.textContent = t;
    toast.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { toast.hidden = true; }, ms || 3000);
  }
  function claimed(earned, total) { flash(I18n.t('player.points', { n: fmtN(earned) }) + (total ? ' · ' + fmtN(total) : ''), 8000); }
  function startPoints() { if (isOpen && !isVod && item) Points.start(item.login, claimed); }

  /* ---------- chat ---------- */
  function applyChat() { el.classList[Chat.isOn() && isOpen && !isVod ? 'add' : 'remove']('chat'); }
  function startChat() { if (isOpen && !isVod && item) Chat.attach(item.login); applyChat(); }
  function toggleChat() {
    if (isVod) { flash(I18n.t('player.chatLiveOnly')); return; }
    var on = Chat.toggle();
    if (on) Chat.attach(item.login);
    applyChat();
    flash(I18n.t(on ? 'player.chatOn' : 'player.chatOff'), 1500);
  }

  /* ---------- barra, estado y overlay ---------- */
  function renderState() {
    var t = '';
    if (seekTarget !== null) {
      var d = seekTarget - seekFrom;
      t = (d >= 0 ? '▶▶ +' : '◀◀ −') + hms(Math.abs(d)) + '   →   ' + hms(seekTarget);
    } else if (v.paused && v.getAttribute('src')) t = I18n.t('player.paused');
    st.textContent = t;
    st.hidden = !t;
  }
  function updTime() {
    if (!isVod || ovl.hidden) return;
    var d = duration(), cur = seekTarget !== null ? seekTarget : v.currentTime;
    tm.textContent = hms(cur) + ' / ' + hms(d);
    fill.style.width = (d ? Math.min(100, cur / d * 100) : 0) + '%';
  }
  function showOvl() {
    ovl.hidden = false;
    updTime();
    clearTimeout(hideT);
    hideT = setTimeout(function () { if (!menu && !v.paused) ovl.hidden = true; }, 4000);
  }

  function stop() {
    try { v.pause(); } catch (e) {}
    v.removeAttribute('src');
    v.load();                 // libera el decoder
  }

  function info() {
    var parts = [];
    if (isVod) {
      $('oname').textContent = item.title;
      parts.push(item.name);
      if (item.date) parts.push(item.date);
    } else {
      $('oname').textContent = item.name + (item.game ? ' · ' + item.game : '');
      if (item.title) parts.push(item.title);
      parts.push(I18n.t('card.viewers', { n: fmt(item.viewers) }));
    }
    if (quals[qi]) parts.push(quals[qi].name);
    $('oinfo').textContent = parts.join(' — ');
    bar.hidden = tm.hidden = !isVod;
    $('ohint').textContent = I18n.t(isVod ? 'player.hintVod' : 'player.hintLive');
  }

  /* ---------- carga ---------- */
  // Al cambiar el flujo (calidad, reintento) la lista HLS nueva empieza en 0: se vuelve a la posición guardada
  // en cuanto el reproductor conoce la duración (loadedmetadata; canplay de respaldo).
  function applyResume() {
    if (!resumeAt) return;
    var t = resumeAt;
    resumeAt = 0;
    try { v.currentTime = t; } catch (e) {}
    updTime();
  }

  function play() {
    v.src = quals[qi].url;
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
    info();
  }

  function load() {
    var id = ++loadId;
    say(I18n.t('loading'));
    stop();
    Api.playback(item).then(function (r) {
      if (id !== loadId) return;
      quals = [{ name: 'Auto', url: r.master }].concat(r.variants);
      var saved = store('tq'); qi = 0;
      for (var i = 0; i < quals.length; i++) if (quals[i].name === saved && !badQ[saved]) qi = i;
      play();
    }).catch(function (e) {
      if (id !== loadId) return;
      say(e.offline ? I18n.t(isVod ? 'player.vodUnavailable' : 'player.offline') : I18n.t('player.error', { msg: e.message }));
    });
  }

  function renderMenu() {
    var h = '';
    for (var i = 0; i < quals.length; i++)
      h += '<div class="qi' + (i === mi ? ' foc' : '') + '">' + (i === qi ? '● ' : '') + quals[i].name + '</div>';
    qm.innerHTML = h;
  }

  function keepPosition() { if (isVod && v.getAttribute('src') && v.currentTime > 1) resumeAt = v.currentTime; }

  function resetSeek() { clearTimeout(seekT); seekTarget = null; seekStreak = 0; }

  function close() {
    loadId++; isOpen = false; menu = false; resumeAt = 0; clearTimeout(hideT); clearTimeout(toastT); resetSeek();
    Points.stop(); Chat.detach(); applyChat();
    stop(); say(''); st.hidden = true; toast.hidden = true;
    el.hidden = true; qm.hidden = true; ovl.hidden = true;
    item = null; quals = [];
    if (onClose) onClose();
  }

  function open(it, cb) {
    item = it; onClose = cb; isOpen = true; retried = false; menu = false; isVod = it.type === 'video';
    resumeAt = 0;
    resetSeek();
    el.hidden = false; qm.hidden = true; st.hidden = true;
    quals = []; qi = 0;
    info(); showOvl(); load(); startPoints(); startChat();
  }

  /* ---------- saltos acelerados (VOD) ----------
     Cada pulsación rápida (<700 ms desde la anterior) sube un escalón: 10, 10, 30, 30, 60, 60, 120, 120, 300 s.
     El salto real se aplica una sola vez, 450 ms después de la última pulsación (los seeks HLS son caros en TVs modestas). */
  function applySeek() {
    if (!isOpen || seekTarget === null) return;
    var t = seekTarget;
    seekTarget = null;
    try { v.currentTime = t; } catch (e) {}
    renderState(); updTime();
  }
  function seekPress(dir, big) {
    var now = Date.now();
    seekStreak = now - seekLast < 700 ? seekStreak + 1 : 1;
    seekLast = now;
    var step = STEPS[Math.min(seekStreak - 1, STEPS.length - 1)];
    if (big && step < 30) step = 30;
    if (seekTarget === null) seekFrom = v.currentTime;
    var d = duration();
    seekTarget = Math.max(0, Math.min(d > 2 ? d - 2 : 1e9, (seekTarget === null ? v.currentTime : seekTarget) + dir * step));
    renderState(); updTime();
    clearTimeout(seekT);
    seekT = setTimeout(applySeek, 450);
  }

  function togglePause() {
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
  }

  function openMenu() {
    if (quals.length < 2) { flash(I18n.t('player.noQualities'), 1500); return; }
    menu = true; mi = qi; qm.hidden = false; renderMenu();
  }

  // Devuelve true si consumió la tecla.
  function key(k) {
    if (!isOpen) return false;
    showOvl();
    if (menu) {
      if (k === 'up' && mi > 0) mi--;
      else if (k === 'down' && mi < quals.length - 1) mi++;
      else if (k === 'ok') {
        qi = mi; store('tq', quals[qi].name);
        if (isVod) resumeAt = seekTarget !== null ? seekTarget : v.currentTime;   // no perder la posición al cambiar de calidad
        resetSeek();
        menu = false; qm.hidden = true; say(I18n.t('loading')); play();
        return true;
      }
      else if (k === 'back' || k === 'green') { menu = false; qm.hidden = true; return true; }
      renderMenu();
      return true;
    }
    if (k === 'back' || k === 'stop') close();
    else if (k === 'ok' || k === 'playpause') togglePause();
    else if (k === 'up' || k === 'green') openMenu();
    else if (k === 'down' || k === 'channel') toggleChat();
    else if (k === 'play') { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    else if (k === 'pause') v.pause();
    else if (isVod && (k === 'left' || k === 'right')) seekPress(k === 'left' ? -1 : 1, false);
    else if (isVod && (k === 'rw' || k === 'ff')) seekPress(k === 'rw' ? -1 : 1, true);
    return true;
  }

  v.addEventListener('playing', function () { retried = false; say(''); renderState(); });
  v.addEventListener('waiting', function () { if (isOpen) say(I18n.t('loading')); });
  v.addEventListener('timeupdate', updTime);
  v.addEventListener('loadedmetadata', applyResume);
  v.addEventListener('canplay', applyResume);
  v.addEventListener('pause', function () { if (isOpen && v.getAttribute('src')) { renderState(); showOvl(); } });
  v.addEventListener('play', function () { if (isOpen) { renderState(); showOvl(); } });
  v.addEventListener('error', function () {
    if (!isOpen || !v.getAttribute('src')) return;
    if (!retried) { retried = true; keepPosition(); load(); }   // un reintento con token nuevo, sin perder la posición
    else if (qi > 0 && quals.length) {                          // esa calidad no se puede reproducir: vuelve a Auto
      badQ[quals[qi].name] = true;
      keepPosition();
      flash(I18n.t('player.qualityFallback', { q: quals[qi].name }), 4000);
      qi = 0; retried = false;
      say(I18n.t('loading')); play();
    }
    else say(I18n.t('player.cantPlay'));
  });

  // Si la app pasa a segundo plano, se libera el decoder y se cierran chat y puntos; al volver se retoma todo.
  document.addEventListener('visibilitychange', function () {
    if (!isOpen) return;
    if (document.hidden) { keepPosition(); loadId++; stop(); Points.stop(); Chat.detach(); }
    else { retried = false; load(); startPoints(); startChat(); }
  });

  w.Player = { open: open, key: key, isOpen: function () { return isOpen; } };
})(window);
