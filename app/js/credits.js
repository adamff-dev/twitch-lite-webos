/* Pantalla de créditos (Ajustes > Créditos): autor, enlace del proyecto, QR de donaciones y aviso de proyecto no oficial.
   OK o Atrás la cierran y se vuelve a Ajustes, que sigue abierto debajo. El QR apunta a CONFIG.CREDITS.donate
   o, si está vacío, a la URL del proyecto. */
(function (w) {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var box = $('credits'), qr = $('cqr'), cap = $('cqrtxt'), made = $('cmade'), url = $('curl'), hint = $('chint');
  var isOpen = false;

  function render() {
    var c = w.CONFIG.CREDITS || {}, donate = c.donate || '', target = donate || c.url || '';
    made.textContent = I18n.t('credits.madeBy', { author: c.author || '' });
    url.textContent = c.url || '';
    qr.innerHTML = target ? w.QR.svg(target) : '';
    cap.textContent = I18n.t(donate ? 'credits.donate' : 'credits.project');
    hint.textContent = I18n.t('credits.hint');
  }

  function open() { isOpen = true; box.hidden = false; render(); }
  function close() { isOpen = false; box.hidden = true; }

  // mientras están abiertos consumen el mando: solo OK y Atrás hacen algo
  function key(k) {
    if (k === 'back' || k === 'ok') close();
  }

  I18n.onChange(function () { if (isOpen) render(); });

  w.Credits = { open: open, close: close, key: key, isOpen: function () { return isOpen; } };
})(window);
