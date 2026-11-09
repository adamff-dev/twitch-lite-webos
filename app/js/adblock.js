/* Bloqueo de anuncios en un directo: reproduce por MSE (hls.js, el mismo que usa unmute.js) y quita de la lista de medios
   los segmentos de publicidad que Twitch inserta en ella ("stitched ads").
   Un segmento es anuncio si su EXTINF trae un título distinto de "live" (los anuncios llevan el del anunciante) y los
   #EXT-X-DATERANGE de clase "stitched-ad" se descartan. Al empezar un anuncio la lista trae los últimos segmentos de la
   emisión seguidos de los del anunciante (y luego solo los del anunciante): quitarlos dejaría al reproductor sin datos en
   cuanto agotase los primeros, así que en cuanto aparece un segmento de anuncio tras uno de la emisión se pide la lista del
   mismo canal con otro tipo de reproductor
   (el reproductor la da el callback opts.backup), que Twitch sirve sin anuncios. Si no hay respaldo, o falla, se devuelve la
   lista original para no dejar el reproductor sin datos: ese anuncio suena y se avisa con opts.onLeak (ads.js lo silencia). */
(function (w) {
  'use strict';

  function isAdTitle(t) { return !!t && t !== 'live'; }

  // true si la lista tiene segmentos de anuncio y ninguno de la emisión
  function onlyAds(text) {
    var re = /^#EXTINF:[\d.]+,?(.*)$/gm, m, ads = 0, live = 0;
    while ((m = re.exec(String(text)))) { if (isAdTitle(m[1].replace(/\r$/, ''))) ads++; else live++; }
    return ads > 0 && live === 0;
  }

  // true si hay anuncio tras algún segmento de la emisión (empieza un anuncio: los segmentos de la emisión se agotan enseguida
  // y el reproductor se quedaría sin datos) o si todo es anuncio. Con los anuncios solo al principio (el anuncio acaba) basta
  // quitarlos.
  function needsBackup(text) {
    var re = /^#EXTINF:[\d.]+,?(.*)$/gm, m, ads = 0, seenLive = false, lateAd = false;
    while ((m = re.exec(String(text)))) {
      if (isAdTitle(m[1].replace(/\r$/, ''))) { ads++; if (seenLive) lateAd = true; } else seenLive = true;
    }
    return ads > 0 && (lateAd || !seenLive);
  }

  function filterVariantPlaylist(text) {
    var lines = String(text).split(/\r?\n/);
    var out = [], removed = 0, kept = 0, lead = 0, i = 0, l, m;
    while (i < lines.length) {
      l = lines[i];
      if (l.indexOf('#EXT-X-DATERANGE:') === 0 && /stitched-ad/i.test(l)) { i++; continue; }
      if (l.indexOf('#EXTINF:') === 0) {
        m = /^#EXTINF:([\d.]+),?(.*)$/.exec(l);
        i++;
        if (m && isAdTitle(m[2])) {
          removed++;
          if (!kept) lead++;                                           // anuncio al principio: la secuencia avanza
          if (i < lines.length && lines[i].charAt(0) !== '#') i++;     // su URI
          continue;
        }
        kept++;
        out.push(l);
        continue;
      }
      out.push(l);
      i++;
    }
    if (!removed) return text;
    if (!kept) return text;                                            // todo era anuncio: no se vacía la lista
    // la precarga (#EXT-X-TWITCH-PREFETCH) durante un anuncio apunta a segmentos del propio anuncio
    return out.filter(function (x) { return x.indexOf('#EXT-X-TWITCH-PREFETCH:') !== 0; }).map(function (x) {
      var q = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(x);
      return q && lead ? '#EXT-X-MEDIA-SEQUENCE:' + (parseInt(q[1], 10) + lead) : x;   // los números de segmento no se desplazan
    }).join('\n');
  }

  function makeAdblockLoaders(Hls, opts) {
    opts = opts || {};
    var Base = Hls && Hls.DefaultConfig && Hls.DefaultConfig.loader;

    function Playlist(config) { if (Base) Base.call(this, config); }
    Playlist.prototype = Object.create(Base ? Base.prototype : {});
    Playlist.prototype.constructor = Playlist;
    Playlist.prototype.load = function (context, config, callbacks) {
      var cb = {
        onSuccess: function (response, stats, ctx, xhr) {
          var txt = response && response.data;
          function pass() { if (callbacks.onSuccess) callbacks.onSuccess(response, stats, ctx, xhr); }
          if (typeof txt === 'string' && txt.indexOf('#EXTM3U') === 0 && txt.indexOf('#EXT-X-STREAM-INF') < 0) {
            var all = false, need = false;
            try { all = onlyAds(txt); need = needsBackup(txt); } catch (e) {}
            if (need && opts.backup) {
              opts.backup(function (clean) {
                var good = typeof clean === 'string' && clean.indexOf('#EXTINF:') >= 0 && !needsBackup(clean) && !onlyAds(clean);
                if (good) response.data = clean;
                else if (all) { if (opts.onLeak) opts.onLeak(); }
                else { try { response.data = filterVariantPlaylist(txt); } catch (e) {} }
                pass();
              });
              return;
            }
            if (all && opts.onLeak) opts.onLeak();
            try { response.data = filterVariantPlaylist(txt); } catch (e) {}
          }
          pass();
        },
        onProgress: callbacks.onProgress,
        onError: callbacks.onError,
        onTimeout: callbacks.onTimeout
      };
      Base.prototype.load.call(this, context, config, cb);
    };

    return { pLoader: Playlist };
  }

  function start(url, ok, fail, opts) {
    w.Unmute.load(function (Hls) {
      if (!Hls || !Hls.isSupported || !Hls.isSupported()) {
        if (fail) fail();
        return;
      }
      ok(Hls, makeAdblockLoaders(Hls, opts));
    }, fail);
  }

  w.Adblock = { onlyAds: onlyAds, needsBackup: needsBackup, filterVariantPlaylist: filterVariantPlaylist, makeAdblockLoaders: makeAdblockLoaders, start: start };
})(window);
