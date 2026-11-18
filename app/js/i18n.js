/* Locale files are loaded synchronously before the other app scripts start.
   Add locales/<language>.json to support another TV language. English is the fallback. */
(function (w) {
  'use strict';
  var D = {}, lang = 'en', listeners = [];
  var supported = ['en', 'es', 'de'];
  function readLocale(code) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'locales/' + code + '.json', false);
      xhr.send(null);
      if ((xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) && xhr.responseText) {
        return JSON.parse(xhr.responseText);
      }
    } catch (e) { /* Keep the UI running when a locale file is unavailable. */ }
    return {};
  }
  D.en = readLocale('en');
  function detect() {
    var n = String(navigator.language || navigator.userLanguage || 'en').toLowerCase().split(/[-_]/)[0];
    return supported.indexOf(n) >= 0 ? n : 'en';
  }
  function t(key, vars) {
    var s = D[lang] && D[lang][key];
    if (s === undefined) s = D.en[key];
    if (s === undefined) return key;
    if (vars) for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }
  function apply() {
    var nodes = document.querySelectorAll('[data-i18n]'), i;
    for (i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    nodes = document.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('placeholder', t(nodes[i].getAttribute('data-i18n-placeholder')));
    document.documentElement.lang = lang;
  }
  function update() {
    var l = detect();
    if (l === lang) return;
    if (!D[l]) D[l] = readLocale(l);
    lang = l;
    apply();
    for (var i = 0; i < listeners.length; i++) listeners[i]();
  }
  function thousands(n) {
    var sep = lang === 'en' ? ',' : '.';
    return String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
  function compact(n) {
    n = +n || 0;
    if (n < 1000) return String(n);
    var dec = lang === 'en' ? '.' : ',';
    return (n / 1000).toFixed(1).replace('.', dec) + (lang === 'en' ? 'K' : ' K');
  }
  lang = detect();
  if (lang !== 'en') D[lang] = readLocale(lang);
  apply();
  try { localStorage.removeItem('lang'); } catch (e) {}
  w.addEventListener('languagechange', update);
  w.I18n = {
    t: t, lang: function () { return lang; }, update: update, apply: apply,
    thousands: thousands, compact: compact,
    onChange: function (fn) { listeners.push(fn); }
  };
})(window);
