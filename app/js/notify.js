/* Aviso de directos: mientras ves un VOD o un directo, un mensaje con la foto del canal cuando otro canal que sigues
   empieza a emitir. Pensado para gastar lo mínimo:
   - solo funciona con el reproductor abierto y con sesión (en los menús no hay nada en marcha);
   - una petición Helix pequeña cada N minutos (Ajustes > Avisar de directos), sin consultar si la app está en segundo plano
     ni si la anterior sigue en vuelo;
   - la foto se pide solo cuando hay que avisar, a 70 px, y se suelta al ocultar el mensaje;
   - no guarda nada en disco: la lista de "ya en directo" se toma al abrir el reproductor y vive solo en memoria.
   Al abrir el reproductor se toma una primera lista (sin avisar): los canales que ya estaban en directo no cuentan. */
(function (w) {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var box = $('live'), img = $('limg'), nameEl = $('lname'), subEl = $('lsub');
  var SHOW_MS = 6000, GAP_MS = 400, MAX_PER_POLL = 3, IMG_WAIT = 3000;
  var watching = false, skip = '', known = null, timer = 0, busy = false, gen = 0;
  var queue = [], showing = false, hideT = 0;

  function enabled() { return Settings.get('live') === 'on' && Auth.isLoggedIn(); }

  function hide() {
    clearTimeout(hideT); hideT = 0;
    box.hidden = true; showing = false;
    img.removeAttribute('src');                                   // libera la imagen
  }

  function next() {
    if (showing || !queue.length || !watching) return;
    var s = queue.shift(), id = gen;
    showing = true;
    // la foto se espera un momento para que el mensaje no "salte"; si no llega, se avisa sin ella
    Api.timeout(Auth.userImage(s.id, 70), IMG_WAIT).catch(function () { return ''; }).then(function (u) {
      if (id !== gen || !watching) return;
      nameEl.textContent = s.name;
      subEl.textContent = I18n.t('live.now') + (s.game ? ' · ' + s.game : '');
      if (u) img.src = u; else img.removeAttribute('src');
      box.className = Settings.chat().pos === 'tl' ? 'r' : '';       // el chat en la esquina superior izquierda: el aviso pasa a la derecha
      box.hidden = false;
      hideT = setTimeout(function () { hide(); setTimeout(next, GAP_MS); }, SHOW_MS);
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

  w.Notify = { start: start, stop: stop };
})(window);
