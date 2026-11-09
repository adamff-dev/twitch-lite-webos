/* Aviso de directos: mientras ves un VOD o un directo, un mensaje con la foto del canal cuando otro canal que sigues
   empieza a emitir. Pensado para gastar lo mínimo:
   - solo funciona con el reproductor abierto y con sesión (en los menús no hay nada en marcha);
   - una petición Helix pequeña cada N minutos (Ajustes > Avisar de directos), sin consultar si la app está en segundo plano
     ni si la anterior sigue en vuelo;
   - la foto se pide solo cuando hay que avisar, a 70 px, y se suelta al ocultar el mensaje;
   - no guarda nada en disco: la lista de "ya en directo" se toma al abrir el reproductor y vive solo en memoria.
   Al abrir el reproductor se toma una primera lista (sin avisar): los canales que ya estaban en directo no cuentan.
   El aviso dura SHOW_MS, suena un pitido corto (WebAudio, sin ficheros; Ajustes > Sonido del aviso) y se puede pulsar: con el
   puntero del mando un clic en el aviso abre el directo y la × lo cierra; con los botones de colores, Amarillo = ver y Azul = cerrar;
   y con las flechas: Arriba (desde lo más alto del panel del reproductor) lleva el foco al aviso, ◀ ▶ eligen Ver o Cerrar, OK pulsa y
   Abajo o Atrás devuelven el foco al reproductor. */
(function (w) {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var box = $('live'), img = $('limg'), nameEl = $('lname'), subEl = $('lsub'), goEl = $('lgo'), clEl = $('lcl');
  var SHOW_MS = 30000, GAP_MS = 400, MAX_PER_POLL = 3, IMG_WAIT = 3000;
  var watching = false, skip = '', known = null, timer = 0, busy = false, gen = 0;
  var queue = [], showing = false, hideT = 0, cur = null;
  var foc = -1, playerEl = $('player');                         // foco del mando en el aviso: -1 ninguno, 0 Ver, 1 Cerrar

  function setFoc(i) {
    foc = i;
    goEl.classList.toggle('foc', i === 0);
    clEl.classList.toggle('foc', i === 1);
    playerEl.classList.toggle('nf', i >= 0);                    // el panel del reproductor atenúa su foco mientras el aviso lo tiene
  }

  function enabled() { return Settings.get('live') === 'on' && Auth.isLoggedIn(); }

  function hide() {
    clearTimeout(hideT); hideT = 0;
    box.hidden = true; showing = false; cur = null;
    setFoc(-1);
    img.removeAttribute('src');                                   // libera la imagen
  }

  // Pitido de dos notas (la y mi agudo, ~0,4 s). El AudioContext se crea al sonar y se cierra al acabar: no queda nada en marcha.
  function beep() {
    if (Settings.get('liveSound') !== 'on') return;
    try {
      var AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return;
      var c = new AC(), t = c.currentTime;
      [[880, 0], [1319, 0.15]].forEach(function (n) {
        var o = c.createOscillator(), g = c.createGain(), at = t + n[1];
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
        o.connect(g); g.connect(c.destination);
        o.start(at); o.stop(at + 0.26);
      });
      setTimeout(function () { try { c.close(); } catch (e) {} }, 900);
    } catch (e) {}
  }

  function done() { hide(); setTimeout(next, GAP_MS); }      // cierra este aviso y pasa al siguiente de la cola

  // Cerrar el aviso (Azul o la ×). true si había uno a la vista.
  function dismiss() {
    if (box.hidden || !cur) return false;
    done();
    return true;
  }
  // Ir al directo del aviso (Amarillo o clic): cambia lo que se reproduce a ese canal. true si había uno a la vista.
  function go() {
    if (box.hidden || !cur) return false;
    var s = cur;
    hide();
    w.Player.goTo({ type: 'stream', login: s.login, name: s.name, title: '', game: s.game, viewers: 0 });
    return true;
  }
  // Teclas de colores mientras hay un aviso a la vista; devuelve true si la consumió.
  function key(k) {
    if (box.hidden) return false;
    if (k === 'channel') return go();
    if (k === 'blue') return dismiss();
    if (foc >= 0) {                                              // el aviso tiene el foco: las flechas y OK son suyos
      if (k === 'left') setFoc(0);
      else if (k === 'right') setFoc(1);
      else if (k === 'ok') return foc === 0 ? go() : dismiss();
      else if (k === 'down' || k === 'back') setFoc(-1);
      else if (k !== 'up') return false;                        // teclas de medios y demás siguen siendo del reproductor
      return true;
    }
    if (k === 'up' && w.Player.atTop()) { setFoc(0); return true; }   // desde lo más alto del panel se sube al aviso
    return false;
  }
  box.addEventListener('click', function (e) { if (e.target && e.target.id === 'lx') dismiss(); else go(); });

  function next() {
    if (showing || !queue.length || !watching) return;
    var s = queue.shift(), id = gen;
    showing = true; cur = s;
    // la foto se espera un momento para que el mensaje no "salte"; si no llega, se avisa sin ella
    Api.timeout(Auth.userImage(s.id, 70), IMG_WAIT).catch(function () { return ''; }).then(function (u) {
      if (id !== gen || !watching || cur !== s) return;
      nameEl.textContent = s.name;
      subEl.textContent = I18n.t('live.now') + (s.game ? ' · ' + s.game : '');
      if (u) img.src = u; else img.removeAttribute('src');
      box.className = Settings.chat().pos === 'tl' ? 'r' : '';       // el chat en la esquina superior izquierda: el aviso pasa a la derecha
      goEl.textContent = I18n.t('live.go'); clEl.textContent = I18n.t('live.close');
      box.hidden = false;
      beep();
      hideT = setTimeout(done, SHOW_MS);
    });
  }

  function tick() {
    if (document.hidden) { known = null; return; }                // en segundo plano no se consulta; al volver se toma lista nueva sin avisar
    if (busy || !watching || !enabled()) return;
    var id = gen;
    busy = true;
    Auth.liveNow().then(function (list) {
      if (id !== gen) return;
      var cur = {}, fresh = [];
      list.forEach(function (s) {
        cur[s.login] = 1;
        if (known && !known[s.login] && s.login.toLowerCase() !== skip) fresh.push(s);
      });
      known = cur;
      fresh.slice(0, MAX_PER_POLL).forEach(function (s) { queue.push(s); });
      next();
    }).then(function () { if (id === gen) busy = false; }, function () { if (id === gen) busy = false; });   // sin red: se reintenta en el siguiente turno
  }

  function schedule() {
    clearInterval(timer); timer = 0;
    if (!watching || !enabled()) return;
    timer = setInterval(tick, Settings.get('liveEvery') * 60000);
    if (!known) tick();
  }

  // login: el canal del directo que se está viendo (no se avisa de él); '' en un VOD.
  function start(login) {
    stop();
    watching = true; skip = String(login || '').toLowerCase();
    schedule();
  }
  function stop() {
    watching = false; gen++; busy = false; known = null; queue = [];
    clearInterval(timer); timer = 0;
    hide();
  }

  Settings.onChange(function (k) {
    if (k !== 'live' && k !== 'liveEvery' && k !== '*') return;
    if (!watching) return;
    if (!enabled()) { gen++; busy = false; known = null; queue = []; clearInterval(timer); timer = 0; hide(); return; }
    schedule();
  });

  w.Notify = { start: start, stop: stop, key: key };
})(window);
