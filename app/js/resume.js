/* Reanudar VODs: recuerda dónde lo dejaste.
   - Local (localStorage 'vpos'): siempre, hasta 60 vídeos.
   - Twitch (mismo dato que ven el móvil y el PC): se LEE con el GraphQL privado (video.self.viewingHistory), que
     solo acepta el token del cliente de la app de TV (ver config.js / points.js). Twitch no expone ninguna operación
     pública para ESCRIBIR esa posición, así que lo visto en la TV se guarda solo en la TV.
   Se usa la posición más reciente de las dos. Menos de MIN s o a menos de TAIL s del final no cuenta como "a medias". */
(function (w) {
  'use strict';
  var GQL = 'https://gql.twitch.tv/gql', TV_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
  var KEY = 'vpos', MAX = 60, MIN = 15, TAIL = 30, EVERY = 15000;
  var lastSave = 0, lastId = '';

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function store(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

  // pos y dur en segundos. Pasado el final (o casi) se olvida; antes de MIN s no se guarda nada.
  function save(id, pos, dur, force) {
    if (!id || !(pos >= 0)) return;
    var now = Date.now();
    if (!force && id === lastId && now - lastSave < EVERY) return;     // como mucho cada 15 s por vídeo
    var o = load();
    // Terminado: se anota posición 0 (no se borra), así una posición antigua de Twitch no vuelve a ganar por no haber dato local.
    if (dur > 0 && pos > dur - TAIL) o[id] = [0, now];
    else if (pos >= MIN) o[id] = [Math.floor(pos), now];
    else return;
    lastSave = now; lastId = id;
    var ids = Object.keys(o);
    if (ids.length > MAX) {                                   // se descartan los más antiguos
      ids.sort(function (a, b) { return o[a][1] - o[b][1]; });
      for (var i = 0; i < ids.length - MAX; i++) delete o[ids[i]];
    }
    store(o);
  }

  function local(id) { var e = load()[id]; return e ? { pos: e[0], at: e[1] } : null; }

  function remote(id) {
    var did = '';
    try { did = localStorage.getItem('did') || ''; } catch (e) {}
    if (!w.Auth.isLoggedIn() || w.CONFIG.CLIENT_ID !== TV_ID) return Promise.resolve(null);
    var h = { 'Content-Type': 'application/json', 'Client-Id': TV_ID, Authorization: 'OAuth ' + w.Auth.token() };
    if (did) h['X-Device-Id'] = did;
    return w.Api.timeout(fetch(GQL, {
      method: 'POST', headers: h,
      body: JSON.stringify({ query: '{video(id:' + JSON.stringify(String(id)) + '){self{viewingHistory{position updatedAt}}}}' })
    }), 4000).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var vh = j && j.data && j.data.video && j.data.video.self && j.data.video.self.viewingHistory;
      return vh && vh.position > 0 ? { pos: vh.position, at: Date.parse(vh.updatedAt) || 0 } : null;
    }).catch(function () { return null; });
  }

  // Segundo desde el que reanudar (0 = desde el principio). Nunca rechaza.
  function get(id, dur) {
    return remote(id).then(function (r) {
      var l = local(id), best = !r ? l : !l ? r : (r.at > l.at ? r : l);
      if (!best || best.pos < MIN || (dur > 0 && best.pos > dur - TAIL)) return 0;
      return best.pos;
    });
  }

  w.Resume = { get: get, save: save, _local: local };
})(window);
