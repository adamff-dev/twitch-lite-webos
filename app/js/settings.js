/* Ajustes de la aplicación (botón Verde del mando). Se guardan en localStorage y se aplican al momento.
   ▲ ▼ mueven entre filas · ◀ ▶ cambian el valor · OK pasa al siguiente valor (en Créditos abre la pantalla de créditos; en Restablecer restablece) · Atrás o Verde cierran.
   Los demás módulos leen los valores con Settings.get / chat / hideMs y se enteran de los cambios con onChange. */
(function (w) {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var box = $('settings'), rowsEl = $('srows'), hintEl = $('shint');
  var STORE = 'settings';
  var FONTS = { s: 1.15, m: 1.6, l: 2, xl: 2.4 };                           // vw
  function range(a, b, step) { var r = []; for (var i = a; i <= b; i += step) r.push(i); return r; }
  // tr: el texto del valor viene de i18n ('set.<k>.<valor>'); si no, se muestra valor + unit
  var ITEMS = [
    { k: 'tab', def: 'streams', vals: ['streams', 'games', 'following', 'videos'], tr: true },
    { k: 'cfilter', def: 'auto', vals: ['auto', 'off'], tr: true },     // contenido de mi país (Inicio y categorías)
    { k: 'unmute', def: 'on', vals: ['on', 'off'], tr: true },          // audio de los tramos silenciados de un VOD
    { k: 'fs', def: 'm', vals: ['s', 'm', 'l', 'xl'], tr: true },
    { k: 'size', def: 25, vals: range(5, 100, 5), unit: '%' },
    { k: 'height', def: 100, vals: range(5, 100, 5), unit: '%' },      // alto del chat (% de la pantalla)
    { k: 'pos', def: 'tr', vals: ['tl', 'tr', 'bl', 'br'], tr: true },
    { k: 'op', def: 90, vals: range(0, 100, 10), unit: '%' },
    { k: 'hide', def: 4, vals: [3, 4, 6, 10, 15], unit: ' s' }
  ];
  var vals = {}, isOpen = false, sel = 0, listeners = [];

  function load() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      vals[it.k] = it.vals.indexOf(o[it.k]) >= 0 ? o[it.k] : it.def;     // un valor inválido o ausente vuelve al de serie
    }
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(vals)); } catch (e) {} }
  function emit(k) { for (var i = 0; i < listeners.length; i++) listeners[i](k); }

  function label(it) { return it.tr ? I18n.t('set.' + it.k + '.' + vals[it.k]) : vals[it.k] + it.unit; }

  function render() {
    var h = '', i;
    for (i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i], on = i === sel;
      h += '<div class="si' + (on ? ' on' : '') + '"><span>' + I18n.t('set.' + it.k) + '</span><span class="sv">' +
        (on ? '◀ ' : '') + label(it) + (on ? ' ▶' : '') + '</span></div>';
    }
    // Créditos (abre una pantalla propia) y Restablecer, en las dos últimas filas
    h += '<div class="si' + (sel === ITEMS.length ? ' on' : '') + '"><span>' + I18n.t('set.credits') + '</span></div>';
    h += '<div class="si rs' + (sel === ITEMS.length + 1 ? ' on' : '') + '"><span>' + I18n.t('set.reset') + '</span></div>';
    rowsEl.innerHTML = h;
    hintEl.textContent = I18n.t('set.hint');
  }

  // dir: -1 / +1. Con wrap (OK) da la vuelta; con ◀ ▶ se queda en los extremos.
  function step(dir, wrap) {
    var it = ITEMS[sel];
    if (!it) return;
    var n = it.vals.length, i = it.vals.indexOf(vals[it.k]) + dir;
    i = wrap ? (i + n) % n : Math.max(0, Math.min(n - 1, i));
    if (it.vals[i] === vals[it.k]) return;
    vals[it.k] = it.vals[i];
    save(); emit(it.k);
  }
  function reset() {
    for (var i = 0; i < ITEMS.length; i++) vals[ITEMS[i].k] = ITEMS[i].def;
    save(); emit('*');
  }

  // side: 'l' | 'r' = el panel se pega a ese lado (así no tapa el chat en el reproductor); '' = centrado
  function open(side) {
    isOpen = true; sel = 0;
    box.className = side ? 'pl a' + side : '';
    box.hidden = false;
    render();
  }
  function close() { isOpen = false; box.hidden = true; }

  function key(k) {
    if (k === 'back' || k === 'green') { close(); return; }
    var last = ITEMS.length + 1;                         // filas: ajustes, Créditos (ITEMS.length) y Restablecer (last)
    if (k === 'up' && sel > 0) sel--;
    else if (k === 'down' && sel < last) sel++;
    else if (k === 'left') step(-1, false);
    else if (k === 'right') step(1, false);
    else if (k === 'ok') {
      if (sel === last) reset();
      else if (sel === last - 1) w.Credits.open();
      else step(1, true);
    }
    render();
  }

  load();
  I18n.onChange(function () { if (isOpen) render(); });

  w.Settings = {
    open: open, close: close, key: key,
    isOpen: function () { return isOpen; },
    get: function (k) { return vals[k]; },
    // geometría y aspecto del chat: ancho y alto (% de la pantalla, 5-100), esquina, letra (vw) y opacidad del fondo (0-100)
    chat: function () { return { w: vals.size, h: vals.height, pos: vals.pos, fs: FONTS[vals.fs], op: vals.op }; },
    hideMs: function () { return vals.hide * 1000; },
    // lado libre de la pantalla (donde colocar el panel de ajustes) según la esquina del chat
    freeSide: function () { return vals.pos.charAt(1) === 'r' ? 'l' : 'r'; },
    onChange: function (fn) { listeners.push(fn); }
  };
})(window);
