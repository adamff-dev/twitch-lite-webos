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

  // Idiomas de emisor que acepta el filtro de Twitch (enum Language, comprobado contra el GQL: HE y ZH-HK dan error).
  var LANGS = ['AR', 'CS', 'DA', 'DE', 'EL', 'EN', 'ES', 'FI', 'FR', 'HI', 'HU', 'ID', 'IT', 'JA', 'KO', 'MS', 'NL', 'NO', 'PL', 'PT', 'RO', 'RU', 'SV', 'TH', 'TR', 'UK', 'VI', 'ZH'];

  // Código de Twitch a partir de una etiqueta de idioma ('es-ES' -> 'ES', 'pt-BR' -> 'PT'). '' si no es uno soportado.
  // Función pura: el idioma entra como argumento (no lee navigator).
  function lang(tag) {
    var m = /^([a-z]{2})(?:[-_]|$)/i.exec(String(tag || ''));
    var c = m ? m[1].toUpperCase() : '';
    return LANGS.indexOf(c) >= 0 ? c : '';
  }

  // Idioma a filtrar ahora: el de navigator.language, salvo que el ajuste 'cfilter' esté en 'off'. '' = sin filtro.
  function langFilter() {
    if (w.Settings && w.Settings.get('cfilter') === 'off') return '';
    return lang(w.navigator.language || w.navigator.userLanguage || '');
  }

  // Trozo de la consulta con el filtro de idioma del emisor. Sin código no se envía el argumento.
  function langOpt(code) { return code ? ',options:{broadcasterLanguages:[' + code + ']}' : ''; }

  function streamsPage(cursor, code) {
    return query('{streams(first:' + PAGE + langOpt(code) + after(cursor) + '){edges{cursor node{' + SF + '}}}}')
      .then(function (d) { return page(d.streams.edges, mapStream); });
  }

  // Inicio: directos del idioma del sistema. Si la primera página filtrada sale vacía, se pide sin filtro.
  // Los cursores de las páginas sin filtro llevan prefijo '#' para seguir sin filtro (no son base64 de Twitch).
  function topStreams(cursor) {
    var raw = !!cursor && cursor.charAt(0) === '#', c = raw ? cursor.slice(1) : cursor;
    var code = raw ? '' : langFilter();
    return streamsPage(c, code).then(function (p) {
      if (raw) p.cursor = p.cursor ? '#' + p.cursor : null;     // sigue sin filtro
      if (!code || c || p.items.length) return p;               // sin filtro, no es la 1.ª página, o hay directos
      return streamsPage(null, '').then(function (f) {          // la 1.ª página filtrada salió vacía
        f.cursor = f.cursor ? '#' + f.cursor : null;
        return f;
      });
    });
  }

  function topGames(cursor) {
    return query('{games(first:' + PAGE + after(cursor) + ',options:{sort:VIEWER_COUNT}){edges{cursor node{name displayName boxArtURL(width:285,height:380) viewersCount}}}}')
      .then(function (d) {
        return page(d.games.edges, function (n) {
          return { type: 'game', key: n.name, name: n.displayName, viewers: n.viewersCount || 0, thumb: n.boxArtURL };
        });
      });
  }

  function gameStreamsPage(name, cursor, code) {
    return query('{game(name:' + JSON.stringify(name) + '){streams(first:' + PAGE + langOpt(code) + after(cursor) + '){edges{cursor node{' + SF + '}}}}}')
      .then(function (d) { return page(d.game.streams.edges, mapStream); });
  }

  // Directos de una categoría, con el mismo esquema que Inicio: si en tu idioma no hay ninguno, se muestran todos
  // (cursores con prefijo '#' = sin filtro), para no dejar la categoría vacía habiendo gente emitiendo.
  function gameStreams(name, cursor) {
    var raw = !!cursor && cursor.charAt(0) === '#', c = raw ? cursor.slice(1) : cursor;
    var code = raw ? '' : langFilter();
    return gameStreamsPage(name, c, code).then(function (p) {
      if (raw) p.cursor = p.cursor ? '#' + p.cursor : null;
      if (!code || c || p.items.length) return p;
      return gameStreamsPage(name, null, '').then(function (f) {
        f.cursor = f.cursor ? '#' + f.cursor : null;
        return f;
      });
    });
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
            type: 'video', id: n.id, login: u.login, name: u.displayName, title: n.title || I18n.t('video.untitled'),
            game: n.game ? n.game.displayName : '', views: n.viewCount || 0, duration: n.lengthSeconds || 0,
            date: String(n.createdAt || '').slice(0, 10), thumb: n.previewThumbnailURL || ''
          });
        });
        return { items: items, cursor: edges.length ? edges[edges.length - 1].cursor : null, hasNext: edges.length >= PAGE };
      });
  }

  // Id numérico de un canal a partir de su login ('' si no existe). Lo piden 7TV y BTTV para los emotes.
  function channelId(login) {
    return query('{user(login:' + JSON.stringify(String(login)) + '){id}}').then(function (d) { return (d.user && d.user.id) || ''; });
  }

  // Chat de un VOD: mensajes {t: segundo del vídeo, n: nombre, c: color, m: texto, e: emotes de Twitch}. Primera página desde un segundo
  // (offset); las siguientes con el cursor devuelto. Cada página trae ~60 mensajes ordenados por tiempo.
  function vodComments(id, offset, cursor) {
    var a = cursor ? 'after:' + JSON.stringify(cursor) : 'contentOffsetSeconds:' + Math.max(0, Math.floor(offset || 0));
    return query('{video(id:' + JSON.stringify(String(id)) + '){comments(' + a + ',first:100){edges{cursor node{contentOffsetSeconds commenter{displayName} message{userColor fragments{text emote{emoteID}}}}} pageInfo{hasNextPage}}}}')
      .then(function (d) {
        var c = d.video && d.video.comments, e = (c && c.edges) || [];
        return {
          items: e.map(function (x) {
            var n = x.node, f = (n.message && n.message.fragments) || [], s = '', e = '', len = 0;
            for (var i = 0; i < f.length; i++) {
              var tx = f[i].text || '', cp = tx.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '_').length;   // Twitch cuenta puntos de código
              if (f[i].emote && f[i].emote.emoteID) e += (e ? '/' : '') + f[i].emote.emoteID + ':' + len + '-' + (len + cp - 1);   // mismo formato que la etiqueta emotes del IRC
              s += tx; len += cp;
            }
            return { t: n.contentOffsetSeconds || 0, n: n.commenter ? n.commenter.displayName : '', c: (n.message && n.message.userColor) || '', m: s, e: e };
          }),
          cursor: e.length ? e[e.length - 1].cursor : null,
          hasNext: !!(c && c.pageInfo && c.pageInfo.hasNextPage)
        };
      });
  }

  // Texto de una URL (lista de medios HLS) con tiempo máximo. Rechaza si falla.
  function text(url) {
    return timeout(fetch(url), 8000).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  function gone() { var e = new Error('offline'); e.offline = true; return e; }

  var CDN_RES = [
    ['chunked', 'Source'], ['1080p60', '1080p60'], ['720p60', '720p60'],
    ['480p30', '480p30'], ['360p30', '360p30'], ['160p30', '160p30']
  ];

  function specialId(u) {
    var parts = u.pathname.split('/');
    for (var i = 1; i < parts.length; i++) if (parts[i].indexOf('storyboards') >= 0) return parts[i - 1];
    return '';
  }

  function subUrl(host, v, key, id) {
    var type = String(v.broadcastType || '').toLowerCase();
    var age = (Date.now() - new Date(v.createdAt || 0).getTime()) / 86400000;
    var special = specialId(new URL(v.seekPreviewsURL));
    if (type === 'highlight') return 'https://' + host + '/' + special + '/' + key + '/highlight-' + id + '.m3u8';
    if (type === 'upload' && age > 7) return 'https://' + host + '/' + encodeURIComponent(v.owner.login) + '/' + id + '/' + special + '/' + key + '/index-dvr.m3u8';
    return 'https://' + host + '/' + special + '/' + key + '/index-dvr.m3u8';
  }

  // VODs solo para suscriptores: el token de reproducción no existe o usher responde 403. La API pública
  // de vídeo da seekPreviewsURL y de ahí se reconstruyen las listas de medios del CDN.
  function subonly(id) {
    return query('{video(id:' + JSON.stringify(String(id)) + '){broadcastType createdAt seekPreviewsURL owner{login}}}').then(function (d) {
      var v = d && d.video, u, jobs = [], muted = false, i;
      if (!v || !v.seekPreviewsURL || !v.owner) throw gone();
      try { u = new URL(v.seekPreviewsURL); } catch (e) { throw gone(); }
      if (!specialId(u)) throw gone();
      function valid(url) {
        return text(url).then(function (t) {
          if (t.indexOf('-muted') >= 0) muted = true;
          if (t.indexOf('.ts') >= 0 || t.indexOf('.mp4') >= 0) return url;
          return null;
        }, function () { return null; });
      }
      for (i = 0; i < CDN_RES.length; i++) {
        jobs.push((function (name, url) {
          return valid(url).then(function (ok) { return ok ? { name: name, url: ok } : null; });
        })(CDN_RES[i][1], subUrl(u.host, v, CDN_RES[i][0], id)));
      }
      return Promise.all(jobs).then(function (list) {
        var out = [], k;
        for (k = 0; k < list.length; k++) if (list[k]) out.push(list[k]);
        if (!out.length) throw gone();
        return { master: out[0].url, variants: out.slice(1), subonly: true, muted: muted };
      });
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

  // El token de reproducción se pide con la sesión del usuario cuando es posible (como hace el reproductor oficial): sin ella
  // Twitch nos trata como un espectador anónimo y sirve un anuncio de inicio en cada sesión. Si falla, se pide como anónimo.
  function tokenPost(body) {
    if (!w.Auth || !Auth.tvSession()) return post(body);
    function ok(j) {
      var e = Array.isArray(j) ? j[0] : j, d = e && e.data;
      return !!(d && (d.streamPlaybackAccessToken || d.videoPlaybackAccessToken));
    }
    return timeout(fetch(GQL, {
      method: 'POST',
      headers: { 'Client-ID': w.CONFIG.TV_CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8', Authorization: 'OAuth ' + Auth.token(), 'X-Device-Id': Auth.deviceId() },
      body: JSON.stringify(body)
    }), 10000).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) { return ok(j) ? j : post(body); }, function () { return post(body); });
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
    return tokenPost(body).then(function (j) {
      var d = (Array.isArray(j) ? j[0] : j).data;
      var t = d && (vod ? d.videoPlaybackAccessToken : d.streamPlaybackAccessToken);
      if (!t) {
        if (vod) return subonly(item.id);
        throw gone();
      }
      var master = 'https://usher.ttvnw.net/' + (vod ? 'vod/' + encodeURIComponent(item.id) : 'api/channel/hls/' + encodeURIComponent(item.login)) + '.m3u8' +
        '?player=' + encodeURIComponent(w.Settings ? Settings.get('usher') : 'twitchweb') + '&token=' + encodeURIComponent(t.value) + '&sig=' + t.signature +
        '&allow_audio_only=true&allow_source=true&type=any&fast_bread=true&p=' + Math.floor(Math.random() * 1e6);
      return timeout(fetch(master), 10000).then(function (r) {
        if (r.status === 404 || r.status === 403) {
          if (vod) return subonly(item.id);
          throw gone();
        }
        return r.text().then(function (txt) { return { master: master, variants: parseMaster(txt), muted: txt.indexOf('-muted') >= 0 }; });
      }, function () {
        // Si el fetch falla (p.ej. CORS) dejamos que el <video> lo intente directamente, solo en Auto.
        return { master: master, variants: [] };
      });
    });
  }

  w.Api = { MAX: MAX, timeout: timeout, channelVideos: channelVideos, topStreams: topStreams, topGames: topGames, gameStreams: gameStreams, search: search, playback: playback, parseMaster: parseMaster, lang: lang, vodComments: vodComments, channelId: channelId, text: text };
})(window);
