/* Pantalla de cuenta: QR + código para iniciar sesión, o cierre de sesión. */
(function (w) {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var box = $('login'), qr = $('lqr'), code = $('lc'), stat = $('ls'), hint = $('lh');
  var isOpen = false, cancel = null, onChange = null, mode = '', stamp = 0;
  function touch() { stamp = Date.now(); }          // los OK que llegan justo tras un cambio de pantalla se ignoran

  function stopPoll() { if (cancel) { cancel(); cancel = null; } }

  function fail(msg) {
    mode = 'error';
    qr.innerHTML = ''; code.textContent = '';
    stat.textContent = msg + '\nPulsa OK para reintentar.';
    hint.textContent = 'Atrás: cerrar';
  }

  function begin() {
    stopPoll();
    qr.innerHTML = ''; code.textContent = '';
    if (!w.CONFIG.CLIENT_ID) {
      mode = 'noclient';
      stat.textContent = 'Falta el Client ID de Twitch.\nEdita app/js/config.js o compila con TWITCH_CLIENT_ID=<id> npm run package.';
      hint.textContent = 'Atrás: cerrar';
      return;
    }
    mode = 'wait';
    stat.textContent = 'Generando código…';
    hint.textContent = 'Atrás: cancelar';
    Auth.begin().then(function (d) {
      if (!isOpen) return;
      qr.innerHTML = w.QR.svg(d.uri);
      code.textContent = d.userCode;
      stat.textContent = 'Escanea el QR con el móvil e inicia sesión en Twitch.\nSi no puedes, entra en twitch.tv/activate e introduce el código.\n\nEsperando autorización…';
      cancel = Auth.poll(d, function (r) {
        cancel = null;
        if (!isOpen) return;
        if (r.ok) {
          mode = 'done';
          qr.innerHTML = ''; code.textContent = '';
          stat.textContent = '¡Sesión iniciada como ' + Auth.login() + '!';
          hint.textContent = '';
          setTimeout(function () { if (isOpen && mode === 'done') { close(); if (onChange) onChange(true); } }, 2000);
        } else {
          fail(r.error === 'expired' ? 'El código ha caducado.' : 'Error: ' + r.error);
        }
      });
    }, function (e) { if (isOpen) fail('No se pudo iniciar el proceso: ' + e.message); });
  }

  function open(cb) {
    onChange = cb; isOpen = true; box.hidden = false; touch();
    if (Auth.isLoggedIn()) {
      mode = 'in'; qr.innerHTML = ''; code.textContent = '';
      stat.textContent = 'Sesión iniciada como ' + (Auth.login() || 'tu cuenta');
      hint.textContent = 'OK: cerrar sesión · Atrás: volver';
    } else begin();
  }

  function close() { stopPoll(); isOpen = false; box.hidden = true; }

  function key(k) {
    if (k === 'back') { close(); return; }
    if (k !== 'ok' || Date.now() - stamp < 700) return;
    if (mode === 'in') {                                  // cerrar sesión pide confirmación explícita
      mode = 'confirm'; touch();
      stat.textContent = '¿Cerrar la sesión de ' + (Auth.login() || 'tu cuenta') + '?';
      hint.textContent = 'OK: confirmar · Atrás: cancelar';
    } else if (mode === 'confirm') { Auth.logout(); close(); if (onChange) onChange(false); }
    else if (mode === 'error') { touch(); begin(); }
  }

  w.Login = { open: open, key: key, isOpen: function () { return isOpen; } };
})(window);
