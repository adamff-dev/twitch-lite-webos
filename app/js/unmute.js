(function (w) {
  'use strict';

  function isMuted(text) {
    return String(text || '').indexOf('-muted') >= 0;
  }

  function patch(text) {
    var lines = String(text || '').split('\n'), changed = 0, i, l;
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (l.indexOf('-muted') < 0) continue;
      if (l.charAt(0) === '#' && l.indexOf('URI="') < 0) continue;
      if (l.indexOf('.m3u8') >= 0) continue;
      lines[i] = l.replace(/-muted(?=\.(?:ts|mp4|m4s|aac))/g, '');
      if (lines[i] !== l) changed++;
    }
    return { text: lines.join('\n'), changed: changed };
  }

  function mutedUrl(url) {
    if (!url || String(url).indexOf('-muted') >= 0) return url;
    return String(url).replace(/(\.(?:ts|mp4|m4s|aac))(\?|#|$)/, '-muted$1$2');
  }

  function detect(url) {
    if (!url) return Promise.resolve(false);
    if (isMuted(url)) return Promise.resolve(true);
    if (!w.Api || !w.Api.text) return Promise.resolve(false);
    return w.Api.text(url).then(function (text) {
      return isMuted(text);
    }, function () {
      return false;
    });
  }

  function loaders(Hls) {
    var Base = Hls && Hls.DefaultConfig && Hls.DefaultConfig.loader;

    function Playlist(config) {
      if (Base) Base.call(this, config);
    }
    Playlist.prototype = Object.create(Base ? Base.prototype : {});
    Playlist.prototype.constructor = Playlist;
    Playlist.prototype.load = function (context, config, callbacks) {
      var cb = {
        onSuccess: function (response, stats, ctx, xhr) {
          var p;
          if (response && typeof response.data === 'string') {
            p = patch(response.data);
            if (p.changed) response.data = p.text;
          }
          if (callbacks.onSuccess) callbacks.onSuccess(response, stats, ctx, xhr);
        },
        onProgress: callbacks.onProgress,
        onError: callbacks.onError
      };
      Base.prototype.load.call(this, context, config, cb);
    };

    function Frag(config) {
      if (Base) Base.call(this, config);
    }
    Frag.prototype = Object.create(Base ? Base.prototype : {});
    Frag.prototype.constructor = Frag;
    Frag.prototype.load = function (context, config, callbacks) {
      var self = this;
      function onError(err, ctx, xhr) {
        if (err && (err.code === 403 || err.code === 404) && ctx && ctx.url) {
          var next = mutedUrl(ctx.url);
          if (next !== ctx.url) {
            ctx.url = next;
            self.load(ctx, config, callbacks);
            return;
          }
        }
        if (callbacks.onError) callbacks.onError(err, ctx, xhr);
      }
      var cb = { onSuccess: callbacks.onSuccess, onProgress: callbacks.onProgress, onError: onError };
      Base.prototype.load.call(this, context, config, cb);
    };

    return { pLoader: Playlist, fLoader: Frag };
  }

  var pending = null, loadTimer = 0;

  function settle(ok, H) {
    var q = pending, i;
    if (!q) return;
    pending = null;
    clearTimeout(loadTimer);
    loadTimer = 0;
    for (i = 0; i < q.length; i++) {
      if (ok && H) q[i].ok(H);
      else if (q[i].fail) q[i].fail();
    }
  }

  function load(ok, fail) {
    if (w.Hls) { ok(w.Hls); return; }
    if (pending) { pending.push({ ok: ok, fail: fail }); return; }
    pending = [{ ok: ok, fail: fail }];
    var s = document.createElement('script');
    s.src = 'js/hls.light.min.js';
    s.onload = function () { settle(true, w.Hls); };
    s.onerror = function () { settle(false); };
    loadTimer = setTimeout(function () { settle(false); }, 15000);
    (document.head || document.getElementsByTagName('head')[0]).appendChild(s);
  }

  function start(url, ok, fail) {
    load(function (Hls) {
      if (!Hls || !Hls.isSupported || !Hls.isSupported()) {
        if (fail) fail();
        return;
      }
      ok(Hls, loaders(Hls));
    }, fail);
  }

  w.Unmute = { isMuted: isMuted, patch: patch, mutedUrl: mutedUrl, detect: detect, loaders: loaders, start: start, load: load };
})(window);
