/* Configuración.
   CLIENT_ID: por defecto el de la app de TV de Twitch. Es el único cuyo token acepta también el GraphQL
   privado (necesario para reclamar puntos automáticamente). Con otro Client ID (p.ej. el de tu propia app
   de dev.twitch.tv, tipo "Público") todo funciona salvo los puntos.
   Se puede sustituir al compilar:  TWITCH_CLIENT_ID=xxxx npm run package */
window.CONFIG = { CLIENT_ID: 'ue6666qo983tsx6so1t0vnawi233wa' };
