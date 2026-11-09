/* Puntos del canal mientras se ve un directo: avisa a Twitch de que se está viendo ("minute-watched", como hace su
   reproductor; sin ese aviso no cuenta el tiempo de visionado y nunca aparece el cofre) y reclama el cofre de bonificación.
   Usa el GraphQL privado de Twitch: solo acepta tokens del cliente de la app de TV (ver config.js). */
(function (w) {
  'use strict';
  var GQL = 'https://gql.twitch.tv/gql';
  var CONTEXT_HASH = '374314de591e69925fce3ddc2bcf085796f56ebb8cad67a0daa3165c03adc345';   // ChannelPointsContext
  var CLAIM_HASH = '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0';     // ClaimCommunityPoints
  var SPADE = 'https://spade.twitch.tv/track';
  var EVERY = 60000;
  var REFRESH_IDS = 10;     // cada tantos avisos se vuelve a pedir el id de la emisión (cambia si el canal reinicia el directo)
  var channel = null, timer = 0, busy = false, onClaim = null, isPlaying = null, ids = null, beats = 0;

  // Solo con sesión y con el token del cliente de TV (con otro Client ID el GraphQL lo rechaza).
  function enabled() {
    var off = false;
    try { off = localStorage.getItem('ptsOff') === '1'; } catch (e) {}
    return !off && Auth.isLoggedIn() && Auth.tvSession();
  }

  function call(body, claim) {
    var h = { 'Content-Type': 'application/json', 'Client-Id': w.CONFIG.TV_CLIENT_ID, 'X-Device-Id': Auth.deviceId(), Authorization: 'OAuth ' + Auth.token() };
    if (claim) h['api-consumer-type'] = 'tv; lg_web_tv/sst-8414cf5';
    return Api.timeout(fetch(GQL, { method: 'POST', headers: h, body: JSON.stringify(body) }), 10000).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Ids del canal y de la emisión en curso, necesarios para el aviso de visionado.
  function resolveIds(ch) {
    return call({ query: '{user(login:' + JSON.stringify(ch) + '){id stream{id}}}' }).then(function (j) {
      var u = j && j.data && j.data.user;
      if (u && u.id && u.stream && u.stream.id) ids = { cid: u.id, bid: u.stream.id };
      return ids;
    });
  }

  // Un aviso de "minute-watched" por pasada, solo si el vídeo se está reproduciendo de verdad. Nunca rechaza.
  function watch(ch) {
    var uid = Auth.userId && Auth.userId();
    if (!uid || (isPlaying && !isPlaying())) return Promise.resolve();
    if (beats++ % REFRESH_IDS === 0) ids = null;
    return (ids ? Promise.resolve(ids) : resolveIds(ch)).then(function (d) {
      if (!d || channel !== ch) return;
      var ev = [{ event: 'minute-watched', properties: { channel_id: d.cid, broadcast_id: d.bid, player: 'site', user_id: uid, live: true, channel: ch } }];
      return Api.timeout(fetch(SPADE, {
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(btoa(JSON.stringify(ev)))
      }), 10000);
    }).then(function () {}, function () {});
  }

  // Una pasada: avisa de que se está viendo, mira si hay cofre disponible y lo reclama.
  // Devuelve una promesa que nunca rechaza.
  function tick() {
    if (!channel || busy || !enabled()) return Promise.resolve();
    busy = true;
    var ch = channel;
    return watch(ch).then(function () {
      return call({ operationName: 'ChannelPointsContext', variables: { channelLogin: ch }, extensions: { persistedQuery: { version: 1, sha256Hash: CONTEXT_HASH } } });
    }).then(function (j) {
      var c = j && j.data && j.data.community;
      var cp = c && c.channel && c.channel.self && c.channel.self.communityPoints;
      var claim = cp && cp.availableClaim;
      if (!claim || !claim.id || !c.id) return;
      return call([{ operationName: 'ClaimCommunityPoints', variables: { input: { channelID: c.id, claimID: claim.id } }, extensions: { persistedQuery: { version: 1, sha256Hash: CLAIM_HASH } } }], true)
        .then(function (r) {
          var d = r && r[0] && r[0].data && r[0].data.claimCommunityPoints;
          var earned = d && d.claim && d.claim.pointsEarnedTotal;
          if (earned && channel === ch && onClaim) onClaim(earned, d.currentPoints);
        });
    }).then(function () { busy = false; }, function () { busy = false; });
  }

  function stop() { clearInterval(timer); timer = 0; channel = null; onClaim = null; isPlaying = null; ids = null; beats = 0; }

  // playing: función opcional que dice si el vídeo se está reproduciendo; sin ella se avisa siempre.
  function start(login, cb, playing) {
    stop();
    channel = login; onClaim = cb; isPlaying = playing || null;
    tick();
    timer = setInterval(tick, EVERY);
  }

  w.Points = { start: start, stop: stop, tick: tick, enabled: enabled };
})(window);
