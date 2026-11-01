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
    stat.textContent = msg + '\n' + I18n.t('login.retryHint');
    hint.textContent = I18n.t('login.hintBack');
  }

  function begin() {
    stopPoll();
    qr.innerHTML = ''; code.textContent = '';
    if (!w.CONFIG.CLIENT_ID) {
      mode = 'noclient';
      stat.textContent = I18n.t('login.noClient');
      hint.textContent = I18n.t('login.hintBack');
      return;
    }
    mode = 'wait';
    stat.textContent = I18n.t('login.generating');
    hint.textContent = I18n.t('login.hintCancel');
    Auth.begin().then(function (d) {
      if (!isOpen) return;
      qr.innerHTML = w.QR.svg(d.uri);
      code.textContent = d.userCode;
      stat.textContent = I18n.t('login.instructions');
      cancel = Auth.poll(d, function (r) {
        cancel = null;
        if (!isOpen) return;
        if (r.ok) {
          mode = 'done';
          qr.innerHTML = ''; code.textContent = '';
          stat.textContent = I18n.t('login.done', { name: Auth.login() });
          hint.textContent = '';
          setTimeout(function () { if (isOpen && mode === 'done') { close(); if (onChange) onChange(true); } }, 2000);
        } else {
          fail(r.error === 'expired' ? I18n.t('login.expired') : I18n.t('login.error', { msg: r.error }));
        }
      });
    }, function (e) { if (isOpen) fail(I18n.t('login.startFailed', { msg: e.message })); });
  }

  function open(cb) {
    onChange = cb; isOpen = true; box.hidden = false; touch();
    if (Auth.isLoggedIn()) {
      mode = 'in'; qr.innerHTML = ''; code.textContent = '';
      stat.textContent = I18n.t('login.loggedInAs', { name: Auth.login() || I18n.t('login.yourAccount') });
      hint.textContent = I18n.t('login.hintIn');
      Auth.avatar(300).then(function (u) {
        if (u && isOpen && (mode === 'in' || mode === 'confirm')) {
          qr.innerHTML = '';
          var img = document.createElement('img');
          img.src = u;
          qr.appendChild(img);
        }
      });
    } else begin();
  }

  function close() { stopPoll(); isOpen = false; box.hidden = true; }

  function key(k) {
    if (k === 'back') { close(); return; }
    if (k !== 'ok' || Date.now() - stamp < 700) return;
    if (mode === 'in') {                                  // cerrar sesión pide confirmación explícita
      mode = 'confirm'; touch();
      stat.textContent = I18n.t('login.confirmLogout', { name: Auth.login() || I18n.t('login.yourAccount') });
      hint.textContent = I18n.t('login.hintConfirm');
    } else if (mode === 'confirm') { Auth.logout(); close(); if (onChange) onChange(false); }
    else if (mode === 'error') { touch(); begin(); }
  }

  w.Login = { open: open, key: key, isOpen: function () { return isOpen; } };
})(window);
