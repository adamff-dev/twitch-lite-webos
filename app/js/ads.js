/* Detección de anuncios en un directo (publicidad insertada por Twitch en la propia lista HLS).
   Solo SILENCIA el audio mientras suena el anuncio; no lo salta ni lo bloquea.
   Un tramo cuenta como anuncio si la lista lo marca con #EXT-X-DATERANGE de clase "stitched-ad" (con inicio y
   duración) o si el segmento trae un título EXTINF distinto de "live" (los anuncios llevan el del anunciante).
   Para saber qué tramo suena ahora se usa PROGRAM-DATE-TIME: borde en vivo de la lista menos el retraso del reproductor. */
(function (w) {
  'use strict';
  function ms(s) { var t = Date.parse(s); return isNaN(t) ? 0 : t; }

  // Devuelve { ads: [[inicio, fin] en ms epoch], edge: fin del último segmento en ms epoch (0 si no hay fechas) }.
  function parse(txt) {
    var lines = String(txt).split(/\r?\n/), ads = [], edge = 0, pdt = 0, dur = 0, title = '', m, s, d;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.indexOf('#EXT-X-DATERANGE:') === 0) {
        if (/stitched-ad/i.test(l)) {
          s = /START-DATE="([^"]+)"/.exec(l);
          d = /(?:^|,)(?:DURATION|PLANNED-DURATION)=([\d.]+)/.exec(l);
          if (s && ms(s[1])) ads.push([ms(s[1]), ms(s[1]) + (d ? parseFloat(d[1]) * 1000 : 30000)]);
        }
      } else if (l.indexOf('#EXT-X-PROGRAM-DATE-TIME:') === 0) {
        pdt = ms(l.slice(25));
      } else if (l.indexOf('#EXTINF:') === 0) {
        m = /^#EXTINF:([\d.]+),?(.*)$/.exec(l);
        dur = m ? parseFloat(m[1]) * 1000 : 0;
        title = m ? m[2] : '';
      } else if (l && l.charAt(0) !== '#') {                  // URI de un segmento
        if (pdt) {
          if (title && title !== 'live') ads.push([pdt, pdt + dur]);
          pdt += dur;
          edge = pdt;
        }
        title = '';
      }
    }
    return { ads: ads, edge: edge };
  }

  // ¿El instante `at` (ms epoch) cae dentro de un anuncio?
  function isAd(p, at) {
    for (var i = 0; i < p.ads.length; i++) if (at >= p.ads[i][0] && at < p.ads[i][1]) return true;
    return false;
  }

  // lagSec: segundos que el reproductor va por detrás del borde en vivo de la lista.
  function playingAd(txt, lagSec) {
    var p = parse(txt);
    return !!p.edge && isAd(p, p.edge - lagSec * 1000);
  }

  w.Ads = { parse: parse, isAd: isAd, playingAd: playingAd };
})(window);
