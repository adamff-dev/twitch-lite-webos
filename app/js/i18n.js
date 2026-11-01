/* Traducciones (español e inglés). Idioma: el elegido por el usuario (selector ES/EN) o, si no hay ninguno,
   el del sistema: si empieza por "es" se usa español, en cualquier otro caso inglés.
   Claves con puntos; los marcadores {nombre} se sustituyen con t(clave, {nombre: valor}). */
(function (w) {
  'use strict';
  var D = {
    es: {
      'tab.home': 'Inicio',
      'tab.games': 'Categorías',
      'tab.following': 'Siguiendo',
      'tab.videos': 'Vídeos',
      'tab.search': 'Buscar canal…',
      'account.login': 'Entrar',
      'account.default': 'Cuenta',
      'account.title': 'Cuenta de Twitch',
      'loading': 'Cargando…',
      'empty.streams': 'No hay directos',
      'empty.games': 'No hay categorías',
      'empty.following': 'Ninguno de los canales que sigues está en directo ahora mismo',
      'empty.followingGuest': 'Inicia sesión con "Entrar" (arriba a la derecha) para ver los canales que sigues',
      'empty.videos': 'Aún no sigues ningún canal',
      'empty.videosGuest': 'Inicia sesión con "Entrar" para ver los vídeos de tus canales, o usa Buscar para encontrar un canal',
      'empty.search': 'Selecciona el cuadro de búsqueda y pulsa OK para escribir',
      'empty.channel': 'Este canal no tiene vídeos',
      'empty.game': 'Nadie emite esta categoría ahora mismo',
      'empty.noResults': 'Sin resultados',
      'empty.searchFor': 'Sin resultados para "{q}"',
      'error.retry': 'Error: {msg} — pulsa OK en la pestaña para reintentar',
      'error.timeout': 'Tiempo de espera agotado',
      'error.channelNotFound': 'Canal no encontrado',
      'error.sessionExpired': 'sesión caducada',
      'video.untitled': '(sin título)',
      'card.views': '{n} visualizaciones',
      'card.viewers': '{n} espectadores',
      'player.offline': 'El canal está desconectado',
      'player.vodUnavailable': 'Vídeo no disponible',
      'player.error': 'Error: {msg}',
      'player.cantPlay': 'No se pudo reproducir',
      'player.paused': '⏸  En pausa',
      'player.chatLiveOnly': 'El chat solo está disponible en directos',
      'player.chatOn': 'Chat activado',
      'player.chatOff': 'Chat desactivado',
      'player.noQualities': 'No hay otras calidades',
      'player.qualityFallback': 'La calidad {q} no está disponible en este vídeo. Usando Auto',
      'player.hintVod': 'OK pausa · ▲ calidad · ◀ ▶ saltar (pulsa rápido para ir más lejos) · Atrás salir',
      'player.hintLive': 'OK pausa · ▲ calidad · ▼ chat · Atrás salir',
      'player.points': '+{n} puntos',
      'chat.connecting': 'Conectando al chat…',
      'chat.reconnecting': 'Reconectando al chat…',
      'app.exitHint': 'Pulsa Atrás otra vez para salir',
      'login.noClient': 'Falta el Client ID de Twitch.\nEdita app/js/config.js o compila con TWITCH_CLIENT_ID=<id> npm run package.',
      'login.hintBack': 'Atrás: cerrar',
      'login.hintCancel': 'Atrás: cancelar',
      'login.generating': 'Generando código…',
      'login.instructions': 'Escanea el QR con el móvil e inicia sesión en Twitch.\nSi no puedes, entra en twitch.tv/activate e introduce el código.\n\nEsperando autorización…',
      'login.expired': 'El código ha caducado.',
      'login.error': 'Error: {msg}',
      'login.retryHint': 'Pulsa OK para reintentar.',
      'login.startFailed': 'No se pudo iniciar el proceso: {msg}',
      'login.done': '¡Sesión iniciada como {name}!',
      'login.loggedInAs': 'Sesión iniciada como {name}',
      'login.yourAccount': 'tu cuenta',
      'login.hintIn': 'OK: cerrar sesión · Atrás: volver',
      'login.confirmLogout': '¿Cerrar la sesión de {name}?',
      'login.hintConfirm': 'OK: confirmar · Atrás: cancelar'
    },
    en: {
      'tab.home': 'Home',
      'tab.games': 'Categories',
      'tab.following': 'Following',
      'tab.videos': 'Videos',
      'tab.search': 'Search channel…',
      'account.login': 'Log in',
      'account.default': 'Account',
      'account.title': 'Twitch account',
      'loading': 'Loading…',
      'empty.streams': 'No live streams',
      'empty.games': 'No categories',
      'empty.following': 'None of the channels you follow are live right now',
      'empty.followingGuest': 'Log in with "Log in" (top right) to see the channels you follow',
      'empty.videos': 'You don\'t follow any channel yet',
      'empty.videosGuest': 'Log in with "Log in" to see your channels\' videos, or use Search to find a channel',
      'empty.search': 'Select the search box and press OK to type',
      'empty.channel': 'This channel has no videos',
      'empty.game': 'Nobody is streaming this category right now',
      'empty.noResults': 'No results',
      'empty.searchFor': 'No results for "{q}"',
      'error.retry': 'Error: {msg} — press OK on the tab to retry',
      'error.timeout': 'Request timed out',
      'error.channelNotFound': 'Channel not found',
      'error.sessionExpired': 'session expired',
      'video.untitled': '(untitled)',
      'card.views': '{n} views',
      'card.viewers': '{n} viewers',
      'player.offline': 'Channel is offline',
      'player.vodUnavailable': 'Video unavailable',
      'player.error': 'Error: {msg}',
      'player.cantPlay': 'Could not play',
      'player.paused': '⏸  Paused',
      'player.chatLiveOnly': 'Chat is only available for live streams',
      'player.chatOn': 'Chat on',
      'player.chatOff': 'Chat off',
      'player.noQualities': 'No other qualities',
      'player.qualityFallback': 'Quality {q} is not available for this video. Using Auto',
      'player.hintVod': 'OK pause · ▲ quality · ◀ ▶ skip (press fast to go further) · Back exit',
      'player.hintLive': 'OK pause · ▲ quality · ▼ chat · Back exit',
      'player.points': '+{n} points',
      'chat.connecting': 'Connecting to chat…',
      'chat.reconnecting': 'Reconnecting to chat…',
      'app.exitHint': 'Press Back again to exit',
      'login.noClient': 'Twitch Client ID missing.\nEdit app/js/config.js or build with TWITCH_CLIENT_ID=<id> npm run package.',
      'login.hintBack': 'Back: close',
      'login.hintCancel': 'Back: cancel',
      'login.generating': 'Generating code…',
      'login.instructions': 'Scan the QR code with your phone and log in to Twitch.\nIf you can\'t, go to twitch.tv/activate and enter the code.\n\nWaiting for authorization…',
      'login.expired': 'The code has expired.',
      'login.error': 'Error: {msg}',
      'login.retryHint': 'Press OK to retry.',
      'login.startFailed': 'Could not start the process: {msg}',
      'login.done': 'Logged in as {name}!',
      'login.loggedInAs': 'Logged in as {name}',
      'login.yourAccount': 'your account',
      'login.hintIn': 'OK: log out · Back: return',
      'login.confirmLogout': 'Log out of {name}?',
      'login.hintConfirm': 'OK: confirm · Back: cancel'
    }
  };

  var lang = 'en', listeners = [];

  function saved() { try { return localStorage.getItem('lang'); } catch (e) { return null; } }

  function detect() {
    var s = saved();
    if (s === 'es' || s === 'en') return s;
    var n = String(navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return n.indexOf('es') === 0 ? 'es' : 'en';
  }

  function t(key, vars) {
    var s = D[lang][key];
    if (s === undefined) s = D.en[key];
    if (s === undefined) return key;
    if (vars) for (var k in vars) if (vars.hasOwnProperty(k)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  // Rellena los elementos marcados con data-i18n (texto) y data-i18n-placeholder (atributo placeholder).
  function apply() {
    var nodes = document.querySelectorAll('[data-i18n]'), i;
    for (i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    nodes = document.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('placeholder', t(nodes[i].getAttribute('data-i18n-placeholder')));
    document.documentElement.lang = lang;
  }

  function setLang(l) {
    if (l !== 'es' && l !== 'en') return;
    lang = l;
    try { localStorage.setItem('lang', l); } catch (e) {}
    apply();
    for (var i = 0; i < listeners.length; i++) listeners[i]();
  }

  // 1234 -> "1.234" (es) o "1,234" (en)
  function thousands(n) {
    var sep = lang === 'es' ? '.' : ',';
    return String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }

  // 70700 -> "70,7 K" (es) o "70.7K" (en)
  function compact(n) {
    n = +n || 0;
    if (n < 1000) return String(n);
    var dec = lang === 'es' ? ',' : '.';
    return (n / 1000).toFixed(1).replace('.', dec) + (lang === 'es' ? ' K' : 'K');
  }

  lang = detect();
  apply();

  w.I18n = {
    t: t,
    lang: function () { return lang; },
    setLang: setLang,
    toggle: function () { setLang(lang === 'es' ? 'en' : 'es'); },
    apply: apply,
    thousands: thousands,
    compact: compact,
    onChange: function (fn) { listeners.push(fn); }
  };
})(window);
