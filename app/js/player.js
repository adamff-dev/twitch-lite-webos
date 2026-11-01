/* Reproductor: <video> nativo de webOS (HLS por hardware, sin hls.js). Directos y VODs. */
(function (w) {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var el = $('player'), v = $('v'), ovl = $('ovl'), qm = $('qmenu'), pm = $('pmsg'), bar = $('obar'), fill = $('ofill'), tm = $('otime');
  var isOpen = false, item = null, quals = [], qi = 0, mi = 0, menu = false, isVod = false;
  var hideT = 0, retried = false, loadId = 0, onClose = null;

  function say(t) { pm.textContent = t || ''; pm.hidden = !t; }
  function store(k, val) {
    try { if (val === undefined) return localStorage.getItem(k); localStorage.setItem(k, val); } catch (e) {}
  }

  function showOvl() {
    ovl.hidden = false;
    updTime();
    clearTimeout(hideT);
    hideT = setTimeout(function () { if (!menu) ovl.hidden = true; }, 4000);
  }

  function stop() {
    try { v.pause(); } catch (e) {}
    v.removeAttribute('src');
    v.load();                 // libera el decoder
  }

  function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + ' K' : String(n); }
  function two(n) { return n < 10 ? '0' + n : String(n); }
  function hms(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' + two(m) : m) + ':' + two(s % 60);
  }

  function updTime() {
    if (!isVod || ovl.hidden) return;
    var d = v.duration > 0 && isFinite(v.duration) ? v.duration : item.duration || 0;
    tm.textContent = hms(v.currentTime) + ' / ' + hms(d);
    fill.style.width = (d ? Math.min(100, v.currentTime / d * 100) : 0) + '%';
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
      parts.push(fmt(item.viewers) + ' espectadores');
    }
    if (quals[qi]) parts.push(quals[qi].name);
    $('oinfo').textContent = parts.join(' — ');
    bar.hidden = tm.hidden = !isVod;
    $('ohint').textContent = isVod ? 'OK: calidad · ◀ ▶ ±10 s · Play/Pause · Atrás: salir' : 'OK: calidad · Play/Pause · Atrás: salir';
  }

  function play() {
    v.src = quals[qi].url;
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
    info();
  }

  function load() {
    var id = ++loadId;
    say('Cargando…');
    stop();
    Api.playback(item).then(function (r) {
      if (id !== loadId) return;
      quals = [{ name: 'Auto', url: r.master }].concat(r.variants);
      var saved = store('tq'); qi = 0;
      for (var i = 0; i < quals.length; i++) if (quals[i].name === saved) qi = i;
      play();
    }).catch(function (e) {
      if (id !== loadId) return;
      say(e.offline ? (isVod ? 'Vídeo no disponible' : 'El canal está desconectado') : 'Error: ' + e.message);
    });
  }

  function renderMenu() {
    var h = '';
    for (var i = 0; i < quals.length; i++)
      h += '<div class="qi' + (i === mi ? ' foc' : '') + '">' + (i === qi ? '● ' : '') + quals[i].name + '</div>';
    qm.innerHTML = h;
  }

  function close() {
    loadId++; isOpen = false; menu = false; clearTimeout(hideT);
    stop(); say(''); el.hidden = true; qm.hidden = true; ovl.hidden = true;
    item = null; quals = [];
    if (onClose) onClose();
  }

  function open(it, cb) {
    item = it; onClose = cb; isOpen = true; retried = false; menu = false; isVod = it.type === 'video';
    el.hidden = false; qm.hidden = true;
    quals = []; qi = 0;
    info(); showOvl(); load();
  }

  function seek(d) {
    var max = v.duration > 0 && isFinite(v.duration) ? v.duration - 1 : 1e9;
    v.currentTime = Math.max(0, Math.min(max, v.currentTime + d));
    updTime();
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
        menu = false; qm.hidden = true; say('Cargando…'); play();
        return true;
      }
      else if (k === 'back') { menu = false; qm.hidden = true; return true; }
      renderMenu();
      return true;
    }
    if (k === 'back' || k === 'stop') close();
    else if (k === 'ok' && quals.length > 1) { menu = true; mi = qi; qm.hidden = false; renderMenu(); }
    else if (k === 'playpause') { if (v.paused) v.play(); else v.pause(); }
    else if (k === 'play') v.play();
    else if (k === 'pause') v.pause();
    else if (isVod && k === 'left') seek(-10);
    else if (isVod && k === 'right') seek(10);
    else if (isVod && k === 'rw') seek(-30);
    else if (isVod && k === 'ff') seek(30);
    return true;
  }

  v.addEventListener('playing', function () { say(''); });
  v.addEventListener('waiting', function () { if (isOpen) say('Cargando…'); });
  v.addEventListener('timeupdate', updTime);
  v.addEventListener('error', function () {
    if (!isOpen || !v.getAttribute('src')) return;
    if (!retried) { retried = true; load(); }           // un reintento con token nuevo
    else say('No se pudo reproducir');
  });

  // Si la app pasa a segundo plano, se libera el decoder; al volver se pide un token nuevo.
  document.addEventListener('visibilitychange', function () {
    if (!isOpen) return;
    if (document.hidden) { loadId++; stop(); } else { retried = false; load(); }
  });

  w.Player = { open: open, key: key, isOpen: function () { return isOpen; } };
})(window);
