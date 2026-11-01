/* Reclamo automático de puntos del canal (cofre de bonificación) mientras se ve un directo.
   Usa el GraphQL privado de Twitch: solo acepta tokens del cliente de la app de TV (ver config.js). */
(function (w) {
  'use strict';
  var GQL = 'https://gql.twitch.tv/gql';
  var TV_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
  var CONTEXT_HASH = '374314de591e69925fce3ddc2bcf085796f56ebb8cad67a0daa3165c03adc345';   // ChannelPointsContext
  var CLAIM_HASH = '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0';     // ClaimCommunityPoints
  var EVERY = 60000;
  var channel = null, timer = 0, busy = false, onClaim = null;

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

  // Solo con sesión y con el token del cliente de TV (con otro Client ID el GraphQL lo rechaza).
  function enabled() {
    var off = false;
    try { off = localStorage.getItem('ptsOff') === '1'; } catch (e) {}
    return !off && Auth.isLoggedIn() && w.CONFIG.CLIENT_ID === TV_ID;
  }

  function call(body, claim) {
    var h = { 'Content-Type': 'application/json', 'Client-Id': TV_ID, 'X-Device-Id': deviceId(), Authorization: 'OAuth ' + Auth.token() };
    if (claim) h['api-consumer-type'] = 'tv; lg_web_tv/sst-8414cf5';
    return Api.timeout(fetch(GQL, { method: 'POST', headers: h, body: JSON.stringify(body) }), 10000).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Una pasada: mira si hay cofre disponible y lo reclama. Devuelve una promesa que nunca rechaza.
  function tick() {
    if (!channel || busy || !enabled()) return Promise.resolve();
    busy = true;
    var ch = channel;
    return call({ operationName: 'ChannelPointsContext', variables: { channelLogin: ch }, extensions: { persistedQuery: { version: 1, sha256Hash: CONTEXT_HASH } } })
      .then(function (j) {
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
      })
      .then(function () { busy = false; }, function () { busy = false; });
  }

  function stop() { clearInterval(timer); timer = 0; channel = null; onClaim = null; }

  function start(login, cb) {
    stop();
    channel = login; onClaim = cb;
    tick();
    timer = setInterval(tick, EVERY);
  }

  w.Points = { start: start, stop: stop, tick: tick, enabled: enabled };
})(window);
