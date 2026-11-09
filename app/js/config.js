/* Configuración.
   CLIENT_ID: por defecto el de la app de TV de Twitch. Es el único cuyo token acepta también el GraphQL
   privado (necesario para reclamar puntos automáticamente). Con otro Client ID (p.ej. el de tu propia app
   de dev.twitch.tv, tipo "Público") todo funciona salvo los puntos.
   Se puede sustituir al compilar:  TWITCH_CLIENT_ID=xxxx npm run package */
window.CONFIG = {
  CLIENT_ID: 'ue6666qo983tsx6so1t0vnawi233wa',
  STALL_MS: 8000,   // directo sin datos durante este tiempo: salta al borde en vivo y, si sigue parado, recarga el flujo
  TV_CLIENT_ID: 'ue6666qo983tsx6so1t0vnawi233wa',   // el de la app de TV: no cambiar (tools/build.mjs solo sustituye CLIENT_ID)
  // Pantalla de créditos (Ajustes > Créditos). donate: URL de donaciones para el QR; si está vacía, el QR apunta al proyecto
  CREDITS: { author: 'adamff-dev', url: 'https://github.com/adamff-dev/twitch-lite-webos', donate: '' }
};
