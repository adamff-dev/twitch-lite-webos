/* Cliente mínimo de Twitch (GraphQL web + usher HLS). ES2015 sin async/await (Chromium 53). */
(function (w) {
  'use strict';
  var GQL = 'https://gql.twitch.tv/gql';
  var CID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp';        // Client-ID del reproductor web (el mismo que usa Twire)
  var TOKEN_HASH = '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712'; // PlaybackAccessToken (de Twire)
  var PAGE = 24, MAX = 96;                              // tope de tarjetas en el DOM
  var SF = 'id title viewersCount previewImageURL(width:440,height:248) broadcaster{login displayName} game{displayName}';

  function timeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error(I18n.t('error.timeout'))); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  function post(body) {
    return timeout(fetch(GQL, {
      method: 'POST',
      headers: { 'Client-ID': CID, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body)
    }), 10000).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function query(q) {
    return post({ query: q }).then(function (j) {
      if (j.errors && !j.data) throw new Error(j.errors[0].message);
      return j.data;
    });
  }

  function after(c) { return c ? ',after:' + JSON.stringify(c) : ''; }

  function mapStream(n) {
    return {
      type: 'stream', login: n.broadcaster.login, name: n.broadcaster.displayName,
      title: n.title || '', game: n.game ? n.game.displayName : '',
      viewers: n.viewersCount || 0, thumb: n.previewImageURL
    };
  }

  function page(edges, mapper) {
    var items = edges.map(function (e) { return mapper(e.node); });
    return {
      items: items,
      cursor: edges.length ? edges[edges.length - 1].cursor : null,
      hasNext: edges.length >= PAGE
    };
  }

  function topStreams(cursor) {
    return query('{streams(first:' + PAGE + after(cursor) + '){edges{cursor node{' + SF + '}}}}')
      .then(function (d) { return page(d.streams.edges, mapStream); });
  }

  function topGames(cursor) {
    return query('{games(first:' + PAGE + after(cursor) + ',options:{sort:VIEWER_COUNT}){edges{cursor node{name displayName boxArtURL(width:285,height:380) viewersCount}}}}')
      .then(function (d) {
        return page(d.games.edges, function (n) {
          return { type: 'game', key: n.name, name: n.displayName, viewers: n.viewersCount || 0, thumb: n.boxArtURL };
        });
      });
  }

  function gameStreams(name, cursor) {
    return query('{game(name:' + JSON.stringify(name) + '){streams(first:' + PAGE + after(cursor) + '){edges{cursor node{' + SF + '}}}}}')
      .then(function (d) { return page(d.game.streams.edges, mapStream); });
  }

  // Búsqueda de canales (en directo o no). Si searchFor falla, se prueba el login exacto.
  function search(text) {
    var T = '{login displayName profileImageURL(width:150) stream{viewersCount}}';
    var q1 = query('{searchFor(userQuery:' + JSON.stringify(text) + ',platform:"web",options:{targets:[{index:CHANNEL}]}){channels{edges{item{... on User' + T + '}}}}}')
      .then(function (d) {
        return d.searchFor.channels.edges.map(function (e) { return e.item; });
      }).catch(function () { return []; });
    var login = text.replace(/\s+/g, '').toLowerCase();
    var q2 = query('{user(login:' + JSON.stringify(login) + ')' + T + '}')
      .then(function (d) { return d.user ? [d.user] : []; }).catch(function () { return []; });
    return Promise.all([q1, q2]).then(function (r) {
      var seen = {}, items = [];
      r[1].concat(r[0]).forEach(function (u) {
        if (!u || !u.login || seen[u.login]) return;
        seen[u.login] = 1;
        items.push({
          type: 'channel', login: u.login, name: u.displayName, thumb: u.profileImageURL || '',
          live: !!u.stream, viewers: u.stream ? u.stream.viewersCount || 0 : 0
        });
      });
      items.sort(function (a, b) { return (b.live ? 1 : 0) - (a.live ? 1 : 0); });
      return { items: items, cursor: null, hasNext: false };
    });
  }

  // Vídeos (emisiones pasadas) de un canal. En la primera página, si está en directo, se antepone el directo.
  function channelVideos(login, cursor) {
    var live = cursor ? '' : 'stream{id title viewersCount previewImageURL(width:440,height:248) game{displayName}} ';
    return query('{user(login:' + JSON.stringify(login) + '){login displayName ' + live +
      'videos(first:' + PAGE + after(cursor) + ',type:ARCHIVE,sort:TIME){edges{cursor node{id title lengthSeconds viewCount createdAt previewThumbnailURL(width:440,height:248) game{displayName}}}}}}')
      .then(function (d) {
        var u = d.user;
        if (!u) throw new Error(I18n.t('error.channelNotFound'));
        var edges = u.videos ? u.videos.edges : [], items = [];
        if (u.stream) {
          items.push({
            type: 'stream', login: u.login, name: u.displayName, title: u.stream.title || '',
            game: u.stream.game ? u.stream.game.displayName : '', viewers: u.stream.viewersCount || 0, thumb: u.stream.previewImageURL
          });
        }
        edges.forEach(function (e) {
          var n = e.node;
          items.push({
            type: 'video', id: n.id, name: u.displayName, title: n.title || I18n.t('video.untitled'),
            game: n.game ? n.game.displayName : '', views: n.viewCount || 0, duration: n.lengthSeconds || 0,
            date: String(n.createdAt || '').slice(0, 10), thumb: n.previewThumbnailURL || ''
          });
        });
        return { items: items, cursor: edges.length ? edges[edges.length - 1].cursor : null, hasNext: edges.length >= PAGE };
      });
  }

  // Parsea el master playlist HLS -> [{name, url}] (de mejor a peor calidad)
  function parseMaster(text) {
    var out = [], name = null, lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], m;
      if (l.indexOf('#EXT-X-MEDIA:') === 0 && (m = /NAME="([^"]+)"/.exec(l))) name = m[1];
      else if (l.charAt(0) !== '#' && /^https?:/.test(l)) {
        out.push({ name: name || ('Calidad ' + (out.length + 1)), url: l });
        name = null;
      }
    }
    return out;
  }

  // Obtiene token + master playlist de un directo ({login}) o de un VOD ({type:'video', id}). Devuelve {master, variants}.
  function playback(item, playerType) {
    var vod = item.type === 'video';
    var body = [{
      operationName: 'PlaybackAccessToken',
      variables: {
        isLive: !vod, isVod: vod, login: vod ? '' : item.login, vodID: vod ? item.id : '', playerType: playerType || 'site'
      },
      extensions: { persistedQuery: { version: 1, sha256Hash: TOKEN_HASH } }
    }];
    function gone() { var e = new Error('offline'); e.offline = true; return e; }
    return post(body).then(function (j) {
      var d = (Array.isArray(j) ? j[0] : j).data;
      var t = d && (vod ? d.videoPlaybackAccessToken : d.streamPlaybackAccessToken);
      if (!t) throw gone();
      var master = 'https://usher.ttvnw.net/' + (vod ? 'vod/' + encodeURIComponent(item.id) : 'api/channel/hls/' + encodeURIComponent(item.login)) + '.m3u8' +
        '?player=twitchweb&token=' + encodeURIComponent(t.value) + '&sig=' + t.signature +
        '&allow_audio_only=true&allow_source=true&type=any&fast_bread=true&p=' + Math.floor(Math.random() * 1e6);
      return timeout(fetch(master), 10000).then(function (r) {
        if (r.status === 404 || r.status === 403) throw gone();
        return r.text().then(function (txt) { return { master: master, variants: parseMaster(txt) }; });
      }, function () {
        // Si el fetch falla (p.ej. CORS) dejamos que el <video> lo intente directamente, solo en Auto.
        return { master: master, variants: [] };
      });
    });
  }

  w.Api = { MAX: MAX, timeout: timeout, channelVideos: channelVideos, topStreams: topStreams, topGames: topGames, gameStreams: gameStreams, search: search, playback: playback, parseMaster: parseMaster };
})(window);
