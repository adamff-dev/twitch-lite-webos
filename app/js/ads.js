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

  // ¿Algún anuncio suena en `at` (ms epoch), empieza en los `lead` ms siguientes o acabó hace menos de `tail` ms?
  // La posición que se estima del vídeo no es exacta (puede ir ~1 s adelantada o atrasada), así que el silencio se
  // adelanta al inicio (lead) y se alarga al final (tail): se pierde algo de audio del directo, pero no se oye el anuncio.
  function isAd(p, at, lead, tail) {
    for (var i = 0; i < p.ads.length; i++) if (p.ads[i][0] <= at + (lead || 0) && p.ads[i][1] + (tail || 0) > at) return true;
    return false;
  }

  // lagSec: segundos que el reproductor va por detrás del borde en vivo de la lista. leadSec/tailSec: márgenes del silencio.
  function playingAd(txt, lagSec, leadSec, tailSec) {
    var p = parse(txt);
    return !!p.edge && isAd(p, p.edge - lagSec * 1000, (leadSec || 0) * 1000, (tailSec || 0) * 1000);
  }

  w.Ads = { parse: parse, isAd: isAd, playingAd: playingAd };
})(window);
