/* Login de Twitch por Device Code Grant (QR) + llamadas Helix del usuario. Scope mínimo: user:read:follows. */
(function (w) {
  'use strict';
  var OAUTH = 'https://id.twitch.tv/oauth2/', HELIX = 'https://api.twitch.tv/helix/';
  var SCOPES = 'user:read:follows', PAGE = 24;
  var st = {};
  try { st = JSON.parse(localStorage.getItem('tauth')) || {}; } catch (e) {}
  if (st.access && st.cid !== w.CONFIG.CLIENT_ID) st = {};   // sesión de otro Client ID: no sirve, hay que volver a entrar

  function save() { try { localStorage.setItem('tauth', JSON.stringify(st)); } catch (e) {} }
  function cid() { return w.CONFIG.CLIENT_ID; }
  function form(o) {
    return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
  }
  function postForm(url, o) {
    return Api.timeout(fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(o)
    }), 10000).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, json: j }; },
        function () { return { ok: r.ok, status: r.status, json: {} }; });
    });
  }

  function isLoggedIn() { return !!st.access; }
  function login() { return st.login || ''; }

  // Foto de perfil del usuario (Helix /users sin parámetros = el propio). size: lado en px (Twitch sirve 70, 150, 300...).
  function sized(url, size) { return url ? String(url).replace(/-\d+x\d+(\.\w+)$/, '-' + size + 'x' + size + '$1') : ''; }
  function avatar(size) {
    if (st.avatar) return Promise.resolve(sized(st.avatar, size));
    if (!st.access) return Promise.resolve('');
    return helix('users').then(function (j) {
      var u = j.data && j.data[0];
      if (u && u.profile_image_url) { st.avatar = u.profile_image_url; save(); }
      return sized(st.avatar, size);
    }, function () { return ''; });
  }
  function token() { return st.access || ''; }
  function userId() { return st.userId || ''; }
  // Sesión con el token del cliente de TV: la única que acepta también el GraphQL de Twitch (token de reproducción, puntos).
  function tvSession() { return !!st.access && w.CONFIG.CLIENT_ID === w.CONFIG.TV_CLIENT_ID; }
  function rand(n) {
    var c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = '';
    for (var i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  }
  function deviceId() {
    try {
      var d = localStorage.getItem('did');
      if (!d) { d = rand(32); localStorage.setItem('did', d); }
      return d;
    } catch (e) { return rand(32); }
  }

  function clear() { st = {}; try { localStorage.removeItem('tauth'); } catch (e) {} }

  function logout() {
    var t = st.access;
    clear();
    if (t && cid()) { try { postForm(OAUTH + 'revoke', { client_id: cid(), token: t }).catch(function () {}); } catch (e) {} }
  }

  // Comprueba el token y obtiene user_id/login.
  function identify() {
    return Api.timeout(fetch(OAUTH + 'validate', { headers: { Authorization: 'OAuth ' + st.access } }), 10000).then(function (r) {
      if (r.status === 401) { var e = new Error('401'); e.unauthorized = true; throw e; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) { st.userId = j.user_id; st.login = j.login; save(); });
  }

  // Los refresh tokens de Twitch son de un solo uso: si varias llamadas necesitan renovar a la vez,
  // todas comparten la misma petición (si no, la segunda gastaría un token ya invalidado).
  var refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    if (!st.refresh) return Promise.reject(new Error('sin refresh token'));
    function done() { refreshing = null; }
    refreshing = postForm(OAUTH + 'token', { client_id: cid(), grant_type: 'refresh_token', refresh_token: st.refresh }).then(function (r) {
      if (!r.ok || !r.json.access_token) { clear(); throw new Error(I18n.t('error.sessionExpired')); }
      st.access = r.json.access_token; st.refresh = r.json.refresh_token || st.refresh; save();
    });
    refreshing.then(done, done);
    return refreshing;
  }

  // Al arrancar: valida la sesión guardada (renovándola si hace falta) sin bloquear la UI.
  function init() {
    if (!st.access) return Promise.resolve(false);
    return identify().catch(function (e) {
      if (!e.unauthorized) throw e;
      return refresh().then(identify);
    }).then(function () { return true; }, function () { return isLoggedIn(); });
  }

  /* ----- Device Code Grant ----- */
  function begin() {
    if (!cid()) return Promise.reject(new Error('noclient'));
    return postForm(OAUTH + 'device', { client_id: cid(), scopes: SCOPES }).then(function (r) {
      if (!r.ok) throw new Error(r.json.message || ('HTTP ' + r.status));
      var j = r.json;
      // Algunos clientes reciben la URL sin el código: se añade para que la página de Twitch lo autocomplete.
      var uri = j.verification_uri || 'https://www.twitch.tv/activate';
      if (uri.indexOf('device-code=') < 0) uri += (uri.indexOf('?') < 0 ? '?' : '&') + 'device-code=' + encodeURIComponent(j.user_code);
      return { deviceCode: j.device_code, userCode: j.user_code, uri: uri, expiresIn: j.expires_in || 1800, interval: j.interval || 5 };
    });
  }

  // Sondea hasta que el usuario autorice. done({ok:true}) | done({error}). Devuelve función cancelar.
  function poll(d, done) {
    var dead = false, t, until = Date.now() + d.expiresIn * 1000;
    function next(extra) { t = setTimeout(tick, (d.interval + (extra || 0)) * 1000); }
    function tick() {
      if (dead) return;
      if (Date.now() > until) return done({ error: 'expired' });
      postForm(OAUTH + 'token', {
        client_id: cid(), scopes: SCOPES, device_code: d.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }).then(function (r) {
        if (dead) return;
        if (r.ok && r.json.access_token) {
          st = { access: r.json.access_token, refresh: r.json.refresh_token, cid: cid() };
          save();
          return identify().then(function () { if (!dead) done({ ok: true }); }, function (e) { if (!dead) done({ error: e.message }); });
        }
        var m = String(r.json.message || '').toLowerCase();
        if (m.indexOf('pending') >= 0) next();
        else if (m.indexOf('slow') >= 0) next(5);
        else done({ error: r.json.message || ('HTTP ' + r.status) });
      }, function () { if (!dead) next(); });          // fallo de red: reintenta
    }
    next();
    return function () { dead = true; clearTimeout(t); };
  }

  /* ----- Helix ----- */
  function helix(path, retried) {
    return Api.timeout(fetch(HELIX + path, { headers: { Authorization: 'Bearer ' + st.access, 'Client-Id': cid() } }), 10000).then(function (r) {
      if (r.status === 401 && !retried && st.refresh) return refresh().then(function () { return helix(path, true); });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function after(c) { return c ? '&after=' + encodeURIComponent(c) : ''; }
  function cursorOf(j) { return j.pagination && j.pagination.cursor || null; }

  function followedStreams(cursor) {
    return helix('streams/followed?user_id=' + st.userId + '&first=' + PAGE + after(cursor)).then(function (j) {
      var c = cursorOf(j);
      return {
        items: j.data.map(function (s) {
          return {
            type: 'stream', login: s.user_login, name: s.user_name, title: s.title || '', game: s.game_name || '',
            viewers: s.viewer_count || 0, thumb: String(s.thumbnail_url || '').replace('{width}', '440').replace('{height}', '248')
          };
        }),
        cursor: c, hasNext: !!c
      };
    });
  }

  function followedChannels(cursor) {
    return helix('channels/followed?user_id=' + st.userId + '&first=' + PAGE + after(cursor)).then(function (j) {
      var c = cursorOf(j), list = j.data;
      if (!list.length) return { items: [], cursor: null, hasNext: false };
      var ids = list.map(function (u) { return 'id=' + encodeURIComponent(u.broadcaster_id); }).join('&');
      return helix('users?' + ids).then(function (u) {
        var img = {};
        u.data.forEach(function (x) { img[x.id] = x.profile_image_url; });
        return {
          items: list.map(function (f) {
            return { type: 'channel', login: f.broadcaster_login, name: f.broadcaster_name, thumb: img[f.broadcaster_id] || '', live: false, viewers: 0 };
          }),
          cursor: c, hasNext: !!c
        };
      }, function () {                                   // sin avatares si /users falla
        return {
          items: list.map(function (f) { return { type: 'channel', login: f.broadcaster_login, name: f.broadcaster_name, thumb: '', live: false, viewers: 0 }; }),
          cursor: c, hasNext: !!c
        };
      });
    });
  }

  w.Auth = {
    init: init, isLoggedIn: isLoggedIn, login: login, token: token, userId: userId, tvSession: tvSession, deviceId: deviceId, avatar: avatar, logout: logout, begin: begin, poll: poll,
    followedStreams: followedStreams, followedChannels: followedChannels
  };
})(window);
