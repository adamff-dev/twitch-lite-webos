/* Reproductor: <video> nativo de webOS (HLS por hardware). Los VODs con audio silenciado usan hls.js bajo demanda.
   Todo se maneja con botones del panel inferior: las flechas mueven el foco, OK activa (◀ 10 s, pausa, 10 s ▶,
   calidad, chat, salir) y en un VOD la barra de progreso también se enfoca para saltar (◀ ▶, acelerado).
   Con el panel oculto, OK pausa y cualquier flecha lo muestra. Atrás sale; las teclas multimedia siguen valiendo. */
(function (w) {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var el = $('player'), v = $('v'), ovl = $('ovl'), qm = $('qmenu'), pm = $('pmsg'), bar = $('obar'), fill = $('ofill'),
    tm = $('otime'), toast = $('ptoast'), st = $('pstate'), ctl = $('octl'), bPause = $('bpause');
  var cur = bPause;          // elemento enfocado del panel: un botón .pb o la barra de progreso (VOD)
  var lastMove = 0;
  var isOpen = false, item = null, quals = [], qi = 0, mi = 0, menu = false, isVod = false;
  var hideT = 0, retried = false, loadId = 0, onClose = null, toastT = 0;
  var seekTarget = null, seekFrom = 0, seekStreak = 0, seekLast = 0, seekT = 0;
  var resumeAt = 0;          // posición a recuperar al cambiar de calidad o reintentar un VOD
  var pausedAt = 0;          // instante en que se pausó un directo (0 = no hay pausa pendiente de reanudar)
  var LIVE_SKIP_MS = 2000;   // pausa de un directo más larga que esto: al reanudar se salta al borde en vivo
  var LIVE_RELOAD_MS = 30000; // pausa tan larga que la lista HLS ya ha caducado: al reanudar se recarga el flujo
  var ADS_EVERY = 1000;      // ms entre lecturas de la lista de medios para ver anuncios nuevos
  var AD_LEAD = 2;           // s de antelación con que se silencia: el anuncio llega a la lista ~2-3 s antes de sonar
  var AD_TAIL = 2;           // s que sigue en silencio tras acabar el anuncio (la posición estimada no es exacta)
  var badQ = {};           // calidades que han fallado en esta sesión (algunos VODs no tienen todas)
  var STEPS = [10, 10, 30, 30, 60, 60, 120, 120, 300];     // segundos por pulsación según la racha de pulsaciones rápidas
  var hls = null, hlsStarting = false, unmuteFailed = false, hlsErrs = 0;

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

  /* ---------- botones del panel ---------- */
  function btns() { return Array.prototype.filter.call(ctl.querySelectorAll('.pb'), function (b) { return !b.hidden; }); }
  function setFoc(e) {
    cur.classList.remove('foc');
    cur = e;
    cur.classList.add('foc');
  }
  function focusDefault() { setFoc(bPause); }
  function labels() {
    bPause.textContent = I18n.t(v.paused && v.getAttribute('src') ? 'player.btnPlay' : 'player.btnPause');
    $('bqual').textContent = I18n.t('player.btnQuality') + (quals[qi] ? ' · ' + quals[qi].name : '');
    $('bchat').textContent = I18n.t('player.btnChat');
    $('bchat').classList[Chat.isOn() ? 'add' : 'remove']('act');
    $('bclose').textContent = I18n.t('player.btnExit');
  }

  /* ---------- avisos (puntos, chat...) ---------- */
  function flash(t, ms) {
    toast.textContent = t;
    toast.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { toast.hidden = true; }, ms || 3000);
  }
  function claimed(earned, total) { flash(I18n.t('player.points', { n: fmtN(earned) }) + (total ? ' · ' + fmtN(total) : ''), 8000); }
  function startPoints() { if (isOpen && !isVod && item) Points.start(item.login, claimed, function () { return !v.paused && !v.ended && !document.hidden; }); }

  /* ---------- chat ---------- */
  // Esquina, tamaño, letra y opacidad del chat según los ajustes; el panel y los avisos se apartan del chat.
  function layoutChat() {
    var c = Settings.chat(), s = $('chat').style, right = c.pos.charAt(1) === 'r', on = el.classList.contains('chat');
    s.width = c.w + 'vw'; s.height = c.h + '%';
    s.top = c.pos.charAt(0) === 't' ? '0' : 'auto'; s.bottom = c.pos.charAt(0) === 'b' ? '0' : 'auto';
    s.left = right ? 'auto' : '0'; s.right = right ? '0' : 'auto';
    s.fontSize = c.fs + 'vw';
    s.background = 'rgba(14,14,16,' + c.op / 100 + ')';
    var off = Math.min(c.w, 70);                          // con el chat muy ancho, el panel de controles se queda a la vista
    ovl.style.left = on && !right ? off + 'vw' : '';
    ovl.style.right = on && right ? off + 'vw' : '';
    qm.style.right = toast.style.right = on && right ? (off + 3) + 'vw' : '';
  }
  function applyChat() { el.classList[Chat.isOn() && isOpen ? 'add' : 'remove']('chat'); layoutChat(); }
  // Directo: chat en vivo (IRC). VOD: el chat de la emisión original, sincronizado con la posición del vídeo.
  function attachChat() {
    if (isVod) Chat.attachVod(item.id, function () { return v.currentTime; }, item.login);
    else Chat.attach(item.login);
  }
  function startChat() { if (isOpen && item) attachChat(); applyChat(); }
  function toggleChat() {
    var on = Chat.toggle();
    if (on) attachChat();
    applyChat();
    flash(I18n.t(on ? 'player.chatOn' : 'player.chatOff'), 1500);
    labels();
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
    labels();
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
    hideT = setTimeout(function () { if (!menu && !v.paused) ovl.hidden = true; }, Settings.hideMs());
  }

  function stopMedia() {
    try { v.pause(); } catch (e) {}
    v.removeAttribute('src');
    v.load();                 // libera el decoder
  }
  function stopHls() {
    hlsStarting = false;
    adblockHls = false;
    clearInterval(backupT); backupT = 0;
    var old = hls;
    hls = null;
    if (old) { try { old.destroy(); } catch (e) {} }
  }
  function stop() { stallStop(); stopHls(); stopMedia(); }

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
    $('bback').hidden = $('bfwd').hidden = !isVod;       // saltar: solo VOD
    if (cur.hidden) focusDefault();
    $('ohint').textContent = I18n.t(isVod ? 'player.hintVod' : 'player.hintLive');
    labels();
  }

  /* ---------- carga ---------- */
  // Al cambiar el flujo (calidad, reintento) la lista HLS nueva empieza en 0: se vuelve a la posición guardada
  // en cuanto el reproductor conoce la duración (loadedmetadata; canplay de respaldo).
  // El reproductor nativo de webOS en loadedmetadata aún da duration=Infinity y descarta el salto (currentTime se queda en 0):
  // resumeAt solo se borra cuando currentTime confirma que el salto se aplicó; si no, se reintenta en los siguientes eventos
  // del vídeo (durationchange, canplay, playing...). Mientras esté pendiente savePos no guarda, así que un salto perdido no
  // pisa la posición buena con un 0.
  var resumeTry = 0, RESUME_TRIES = 6;
  function applyResume() {
    if (!resumeAt) return;
    var t = resumeAt;
    if (resumeTry++ >= RESUME_TRIES) { resumeAt = 0; return; }       // no hay manera: se reproduce desde donde esté
    try { v.currentTime = t; } catch (e) {}
    if (v.currentTime >= t - 3) resumeAt = 0;                        // el reproductor aceptó el salto
    updTime();
  }

  /* ---------- anuncios (directos) ----------
     Cada pocos segundos se lee la lista de medios y, si el tramo que suena es un anuncio, se silencia el audio
     hasta que termina (solo silencia: el anuncio se sigue viendo). Ver ads.js. */
  // Seguros para no dejar el audio mudo por error: tope de AD_MAX_MS seguidos y se suelta tras AD_FAILS lecturas fallidas.
  var adT = 0, adOn = false, adWasMuted = false, adSince = 0, adFails = 0, adBlock = false;
  var AD_MAX_MS = 180000, AD_FAILS = 3;
  var adblockHls = false, adLeakAt = 0, backupVars = null, backupAt = 0, backupT = 0, backupP = null;
  var BACKUP_TTL = 240000, BACKUP_WARM = 150000;
  function setAd(on) {
    if (on === adOn) return;
    adOn = on;
    if (on) { adWasMuted = v.muted; adSince = Date.now(); v.muted = true; flash(I18n.t('player.adMuted'), 4000); }
    else v.muted = adWasMuted;
  }
  function adUrl() { return qi > 0 ? quals[qi].url : (quals.length > 1 ? quals[1].url : ''); }
  function adLag() {                                      // segundos que el vídeo va por detrás del borde de la lista
    try { var r = v.seekable; if (r && r.length) return Math.max(0, r.end(r.length - 1) - v.currentTime); } catch (e) {}
    return 8;
  }
  function adTick() {
    var u = adUrl(), id = loadId;
    if (!isOpen || isVod || !u || v.paused) return;
    Api.text(u).then(function (t) {
      if (id !== loadId || !isOpen) return;
      adFails = 0;
      var ad = Ads.playingAd(t, adLag(), AD_LEAD, AD_TAIL);
      if (adblockHls) ad = ad && Date.now() - adLeakAt < 10000;   // bloqueando: solo se silencia si un anuncio se cuela
      if (!ad) adBlock = false;
      else if (adOn && Date.now() - adSince > AD_MAX_MS) { adBlock = true; ad = false; }   // un anuncio no dura tanto: algo va mal
      setAd(ad && !adBlock);
    }, function () {
      if (id === loadId && ++adFails >= AD_FAILS) setAd(false);                // sin poder leer la lista no se sigue en mudo
    });
  }
  function startAds() { if (!isVod && !adT) { adT = setInterval(adTick, ADS_EVERY); adTick(); } }     // primera lectura ya: un pre-roll no se cuela
  function stopAds() { clearInterval(adT); adT = 0; adFails = 0; adBlock = false; setAd(false); }

  // Posición del VOD: se guarda cada 15 s, al pausar, al salir y al pasar a segundo plano (ver resume.js).
  function savePos(force) {
    if (isVod && item && isOpen && v.getAttribute('src') && !resumeAt) Resume.save(item.id, v.currentTime, duration(), force);
  }

  function probeUrl() {
    return qi > 0 ? quals[qi].url : (quals.length > 1 ? quals[1].url : (quals[0] ? quals[0].url : ''));
  }

  function hlsFail() {
    if (!hls) return;
    unmuteFailed = true;
    keepPosition();
    var wasAdblock = adblockHls;
    stopHls();
    flash(I18n.t(wasAdblock ? 'player.adblockFailed' : 'player.unmuteFailed'), 4000);
    play();
  }

  // Carga hls.js bajo demanda y reproduce el VOD por MSE para pedir los segmentos sin "-muted".
  function startHls(id) {
    if (!isOpen || id !== loadId || hlsStarting || unmuteFailed || !w.Unmute) return;
    if (hls) { keepPosition(); stopHls(); }
    var source = quals[qi] ? quals[qi].url : '';
    if (!source) return;
    hlsStarting = true;
    hlsErrs = 0;
    flash(I18n.t('player.unmuteOn'), 3000);
    w.Unmute.start(source, function (Hls, L) {
      if (!isOpen || id !== loadId || !hlsStarting) { hlsStarting = false; return; }
      hlsStarting = false;
      var wasPlaying = !v.paused;
      keepPosition();
      stopMedia();
      var inst = new Hls({
        pLoader: L.pLoader, fLoader: L.fLoader, enableWorker: true,
        maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 30 * 1000 * 1000
      });
      hls = inst;
      inst.on(Hls.Events.ERROR, function (ev, data) {
        if (!data || !data.fatal || hls !== inst) return;
        if (++hlsErrs > 2) { hlsFail(); return; }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) inst.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) inst.recoverMediaError();
        else hlsFail();
      });
      inst.on(Hls.Events.MANIFEST_PARSED, function () {
        if (hls !== inst) return;
        hlsErrs = 0;
        if ((quals[qi] ? quals[qi].url : '') !== source) { startHls(id); return; }
        if (wasPlaying) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        info();
      });
      inst.attachMedia(v);
      inst.loadSource(source);
    }, function () {
      hlsStarting = false;
      unmuteFailed = true;
      if (!isOpen || id !== loadId) return;
      if ((quals[qi] ? quals[qi].url : '') !== source) { keepPosition(); play(); }
      flash(I18n.t('player.unmuteFailed'), 4000);
    });
  }

  // Lista de medios del mismo canal con el tipo de reproductor 'picture-by-picture', que Twitch sirve sin anuncios (a menor
  // calidad). Se usa solo mientras la lista normal trae únicamente anuncio. Cualquier fallo devuelve '' (el anuncio suena).
  function adBackup(done) {
    var id = loadId, name = quals[qi] ? quals[qi].name : '';
    function use(vars) {
      var u = '';
      for (var i = 0; i < vars.length; i++) if (vars[i].name === name) u = vars[i].url;
      if (!u && vars.length) u = vars[0].url;
      if (!u) { done(''); return; }
      Api.text(u).then(function (t) { done(id === loadId ? t : ''); }, function () { backupVars = null; done(''); });
    }
    if (backupVars && Date.now() - backupAt < BACKUP_TTL) { use(backupVars); return; }
    fetchBackup().then(function (vars) { use(vars); }, function () { done(''); });
  }
  function fetchBackup() {
    if (backupP) return backupP;                        // una sola petición a la vez
    var id = loadId;
    function end() { if (id === loadId) backupP = null; }
    backupP = Api.playback(item, 'picture-by-picture').then(function (r) {
      end();
      if (id === loadId) { backupVars = r.variants; backupAt = Date.now(); }
      return r.variants;
    }, function (e) { end(); throw e; });
    return backupP;
  }
  // El token y la lista maestra del respaldo se piden con antelación (y se renuevan): así, cuando llega un anuncio, solo falta
  // pedir la lista de medios y el vídeo no se queda sin datos esperándolos.
  function warmBackup() {
    if (!adblockHls || isVod) return;
    if (!backupT) backupT = setInterval(warmBackup, BACKUP_WARM);
    if (backupVars && Date.now() - backupAt < BACKUP_WARM) return;
    fetchBackup().then(function () {}, function () {});
  }

  function startAdblockHls(id) {
    if (!isOpen || id !== loadId || hlsStarting || unmuteFailed || !w.Adblock) return;
    if (hls) { keepPosition(); stopHls(); }
    var source = quals[qi] ? quals[qi].url : '';
    if (!source) return;
    hlsStarting = true;
    hlsErrs = 0;
    flash(I18n.t('player.adblockOn'), 3000);
    w.Adblock.start(source, function (Hls, L) {
      if (!isOpen || id !== loadId || !hlsStarting) { hlsStarting = false; return; }
      hlsStarting = false;
      var wasPlaying = !v.paused || !v.getAttribute('src');   // directo recién abierto: aún sin flujo, arranca solo
      keepPosition();
      stopMedia();
      var inst = new Hls({
        pLoader: L.pLoader, enableWorker: true,
        maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 30 * 1000 * 1000
      });
      hls = inst;
      adblockHls = true;
      inst.on(Hls.Events.ERROR, function (ev, data) {
        if (!data || !data.fatal || hls !== inst) return;
        if (++hlsErrs > 2) { hlsFail(); return; }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) inst.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) inst.recoverMediaError();
        else hlsFail();
      });
      inst.on(Hls.Events.MANIFEST_PARSED, function () {
        if (hls !== inst) return;
        hlsErrs = 0;
        if ((quals[qi] ? quals[qi].url : '') !== source) { startAdblockHls(id); return; }
        if (wasPlaying) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        info();
        warmBackup();
      });
      inst.attachMedia(v);
      inst.loadSource(source);
    }, function () {
      hlsStarting = false;
      unmuteFailed = true;
      adblockHls = false;
      if (!isOpen || id !== loadId) return;
      play();                                           // sin hls.js: reproductor nativo con la lista original
      flash(I18n.t('player.adblockFailed'), 4000);
    }, { backup: adBackup, onLeak: function () { adLeakAt = Date.now(); } });
  }

  function checkUnmute(id, known) {
    if (!isVod || unmuteFailed || !w.Unmute || Settings.get('unmute') === 'off') return;
    if (known === true) { startHls(id); return; }
    var u = probeUrl();
    if (!u) return;
    w.Unmute.detect(u).then(function (on) {
      if (!on || id !== loadId || !isOpen) return;
      startHls(id);
    }, function () {});
  }

  function play() {
    pausedAt = 0;                                       // un flujo nuevo empieza en vivo: no hay pausa que recuperar
    var useAdblock = !isVod && Settings.get('adblock') === 'on' && !!w.Adblock && !unmuteFailed;
    if (adblockHls && !useAdblock) stopHls();           // el ajuste se apagó (o hls.js falló): vuelve al reproductor nativo
    if (useAdblock) { startAdblockHls(loadId); startAds(); return; }
    if (hls || hlsStarting) { startHls(loadId); return; }
    v.src = quals[qi].url;
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
    info();
    startAds();
  }

  function load() {
    var id = ++loadId;
    backupVars = null; backupP = null;
    var fresh = isVod && !resumeAt;                     // VOD recién abierto (no un reintento): ¿por dónde iba?
    say(I18n.t('loading'));
    stop();
    Promise.all([Api.playback(item), fresh ? Resume.get(item.id, item.duration) : 0]).then(function (a) {
      if (id !== loadId) return;
      var r = a[0];
      quals = [{ name: 'Auto', url: r.master }].concat(r.variants);
      var saved = store('tq'); qi = 0;
      for (var i = 0; i < quals.length; i++) if (quals[i].name === saved && !badQ[saved]) qi = i;
      if (fresh && a[1] > 0 && !resumeAt) { resumeAt = a[1]; flash(I18n.t('player.resumed', { t: hms(a[1]) }), 4000); }
      if (r.subonly) flash(I18n.t('player.subonly'), 5000);
      play();
      checkUnmute(id, r.muted);
    }).catch(function (e) {
      if (id !== loadId) return;
      say(e.offline ? I18n.t(isVod ? 'player.vodUnavailable' : 'player.offline') : I18n.t('player.error', { msg: e.message }));
    });
  }

  function renderMenu() {
    var h = '';
    for (var i = 0; i < quals.length; i++)
      h += '<div class="qi' + (i === mi ? ' foc' : '') + '" data-i="' + i + '">' + (i === qi ? '● ' : '') + quals[i].name + '</div>';
    qm.innerHTML = h;
  }

  // Un salto de reanudado aún sin aplicar manda sobre currentTime (que sería el 0 de antes del salto)
  function keepPosition() { if (isVod && !resumeAt && v.getAttribute('src') && v.currentTime > 1) resumeAt = v.currentTime; }

  function resetSeek() { clearTimeout(seekT); seekTarget = null; seekStreak = 0; }

  function close() {
    savePos(true);
    loadId++; isOpen = false; menu = false; resumeAt = 0; clearTimeout(hideT); clearTimeout(toastT); resetSeek();
    Points.stop(); Chat.detach(); applyChat(); stopAds(); Notify.stop();
    stop(); say(''); st.hidden = true; toast.hidden = true;
    el.hidden = true; qm.hidden = true; ovl.hidden = true;
    item = null; quals = [];
    if (onClose) onClose();
  }

  function open(it, cb) {
    item = it; onClose = cb; isOpen = true; retried = false; menu = false; isVod = it.type === 'video';
    resumeAt = 0; unmuteFailed = false; hlsErrs = 0;
    resetSeek();
    el.hidden = false; qm.hidden = true; st.hidden = true;
    quals = []; qi = 0;
    focusDefault();
    info(); showOvl(); load(); startPoints(); startChat();
    Notify.start(isVod ? '' : it.login);               // aviso de directos de canales seguidos (en un VOD se avisa de todos)
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

  // Directos en pausa: el emisor sigue en vivo, así que al reanudar se salta al borde en vivo, no al punto pausado.
  // Borde según el reproductor (null si no hay rangos seekables utilizables).
  function liveEdge() {
    try {
      var s = v.seekable, n = s ? s.length : 0;
      var e = n > 0 ? s.end(n - 1) : 0;
      return e > 0 && isFinite(e) ? e : null;
    } catch (x) { return null; }
  }
  // Llamada desde el evento 'play'. Una sola vez por pausa (pausedAt se borra antes de actuar). El seek no dispara
  // pause/play; si no hay borde o la pausa fue muy larga, se recarga el flujo (load() pide un token nuevo).
  function resumeLive() {
    var gap = pausedAt ? Date.now() - pausedAt : 0;
    pausedAt = 0;
    if (!isOpen || isVod || !v.getAttribute('src') || gap < LIVE_SKIP_MS) return;
    var edge = gap < LIVE_RELOAD_MS ? liveEdge() : null;
    if (edge !== null) {
      try { v.currentTime = edge; } catch (e) { edge = null; }
    }
    if (edge === null) load();
  }

  // Atasco en un directo: el reproductor nativo se queda esperando segmentos que ya no llegan (su posición se pasa del final
  // de la lista y nunca se recupera solo). Tras STALL_MS sin datos salta al borde en vivo; si sigue parado, recarga el flujo.
  // Con hls.js (bloqueo de anuncios) recarga el flujo directamente.
  var stallT = 0, stallTries = 0;
  function stallStop() { clearTimeout(stallT); stallT = 0; stallTries = 0; }
  function stallWatch() {
    if (isVod || stallT || !isOpen) return;
    stallT = setTimeout(function () {
      stallT = 0;
      if (!isOpen || isVod || v.paused || document.hidden || !v.getAttribute('src') || v.readyState >= 3) return;
      var edge = liveEdge();
      // con hls.js (bloqueo de anuncios) no se salta al borde: en un cambio de anuncio a respaldo el salto lo hace él y puede
      // quedarse esperando segmentos que ya no están; se recarga directamente
      if (!hls && stallTries++ === 0 && edge !== null) {
        try { v.currentTime = Math.max(0, edge - 3); } catch (e) {}
        stallWatch();
      } else {
        stallTries = 0;
        retried = false;
        load();
      }
    }, w.CONFIG.STALL_MS || 8000);
  }

  function openMenu() {
    if (quals.length < 2) { flash(I18n.t('player.noQualities'), 1500); return; }
    menu = true; mi = qi; qm.hidden = false; renderMenu();
  }

  function pick(i) {
    qi = i; store('tq', quals[qi].name);
    if (isVod) resumeAt = seekTarget !== null ? seekTarget : (resumeAt || v.currentTime);   // no perder la posición al cambiar de calidad
    resetSeek();
    menu = false; qm.hidden = true; say(I18n.t('loading')); play();
  }

  // Acción de un botón del panel (con OK o con el puntero).
  function act(a) {
    if (a === 'pause') togglePause();
    else if (a === 'back') seekPress(-1, false);
    else if (a === 'fwd') seekPress(1, false);
    else if (a === 'quality') openMenu();
    else if (a === 'chat') toggleChat();
    else if (a === 'close') close();
  }

  // Devuelve true si consumió la tecla.
  function key(k) {
    if (!isOpen) return false;
    var hidden = ovl.hidden;
    showOvl();
    if (menu) {
      if (k === 'up' && mi > 0) mi--;
      else if (k === 'down' && mi < quals.length - 1) mi++;
      else if (k === 'ok') { pick(mi); return true; }
      else if (k === 'back') { menu = false; qm.hidden = true; return true; }
      renderMenu();
      return true;
    }
    if (k === 'back' || k === 'stop') close();
    else if (k === 'playpause') togglePause();
    else if (k === 'play') { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    else if (k === 'pause') v.pause();
    else if (isVod && (k === 'rw' || k === 'ff')) seekPress(k === 'rw' ? -1 : 1, true);
    else if (hidden && (k === 'ok' || k === 'left' || k === 'right' || k === 'up' || k === 'down')) {
      focusDefault();                                  // con el panel oculto: OK pausa y las flechas solo lo muestran
      if (k === 'ok') togglePause();
    }
    else if (cur === bar) {                            // barra de progreso (VOD)
      if (k === 'left' || k === 'right') seekPress(k === 'left' ? -1 : 1, false);
      else if (k === 'down') focusDefault();
      else if (k === 'ok') togglePause();
    }
    else {
      var bs = btns(), i = bs.indexOf(cur);
      if (k === 'left' && i > 0) setFoc(bs[i - 1]);
      else if (k === 'right' && i < bs.length - 1) setFoc(bs[i + 1]);
      else if (k === 'up' && isVod) setFoc(bar);
      else if (k === 'ok') act(cur.getAttribute('data-a'));
    }
    return true;
  }

  // Puntero del mando mágico: pulsar un botón o una calidad, y mover el puntero muestra el panel.
  ctl.addEventListener('click', function (e) {
    var b = e.target;
    while (b && b !== ctl && b.className.indexOf('pb') < 0) b = b.parentNode;
    if (!isOpen || !b || b === ctl) return;
    showOvl(); setFoc(b); act(b.getAttribute('data-a'));
  });
  qm.addEventListener('click', function (e) {
    var i = e.target.getAttribute && e.target.getAttribute('data-i');
    if (isOpen && menu && i !== null && i !== undefined) pick(+i);
  });
  el.addEventListener('mousemove', function () {
    var now = Date.now();
    if (!isOpen || now - lastMove < 300) return;
    lastMove = now;
    showOvl();
  });
  I18n.onChange(function () { if (isOpen && item) info(); });

  v.addEventListener('playing', function () { retried = false; stallStop(); say(''); renderState(); });
  v.addEventListener('waiting', function () { if (isOpen) { say(I18n.t('loading')); stallWatch(); } });
  v.addEventListener('stalled', stallWatch);
  v.addEventListener('timeupdate', function () { updTime(); savePos(false); });
  v.addEventListener('loadstart', function () { resumeTry = 0; });      // flujo nuevo (calidad, hls.js, reintento): intentos de salto de cero
  ['loadedmetadata', 'durationchange', 'canplay', 'playing', 'seeked'].forEach(function (e) { v.addEventListener(e, applyResume); });
  // Con src quitado (stop() al cerrar o al pasar a segundo plano) la pausa no cuenta: no es del usuario.
  v.addEventListener('pause', function () {
    if (isOpen && v.getAttribute('src')) { if (!isVod && !pausedAt) pausedAt = Date.now(); savePos(true); renderState(); showOvl(); }
  });
  v.addEventListener('play', function () { if (isOpen) { resumeLive(); renderState(); showOvl(); } });
  v.addEventListener('error', function () {
    if (!isOpen || !v.getAttribute('src') || hls || hlsStarting) return;
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
    if (document.hidden) { savePos(true); keepPosition(); loadId++; stop(); Points.stop(); Chat.detach(); stopAds(); }
    else { retried = false; load(); startPoints(); startChat(); }
  });

  Settings.onChange(function (k) {
    layoutChat();
    if (!isOpen) return;
    if (k === 'unmute' && isVod) {
      if (Settings.get('unmute') === 'off') {
        if (hls || hlsStarting) { keepPosition(); stopHls(); play(); }
      } else {
        unmuteFailed = false;
        checkUnmute(loadId, false);
      }
    } else if ((k === 'adblock' || k === 'usher') && !isVod) {
      unmuteFailed = false;
      retried = false;
      load();                                           // otro token/lista de usher y, si toca, por hls.js
    }
  });

  w.Player = { open: open, key: key, isOpen: function () { return isOpen; }, chatShown: function () { return el.classList.contains('chat'); } };
})(window);
