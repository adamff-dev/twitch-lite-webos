# Light Twitch (webOS)

Cliente ligero de Twitch para TVs LG webOS. Sin frameworks, un único `index.html` de ~41 KB, `<video>` nativo para HLS.

## Login con Twitch (QR)

Usa el *Device Code Grant* oficial de Twitch: la TV muestra un QR y un código; escaneas con el móvil, inicias sesión y la TV queda vinculada. Scope mínimo: `user:read:follows`.

Necesitas un **Client ID propio** (gratis):

1. https://dev.twitch.tv/console → *Register Your Application*.
2. **Client Type: Public** (imprescindible para el flujo de dispositivo; no hace falta secret). Redirect URL: `http://localhost`.
3. Compila con tu ID: `TWITCH_CLIENT_ID=tu_id npm run package` (o edita `app/js/config.js`).

Sin Client ID la app funciona igual (Inicio, Categorías, Buscar); solo Siguiendo/Vídeos piden sesión.

## Pantallas

| Pestaña | Contenido |
|---|---|
| Inicio | Directos más vistos |
| Categorías | Categorías → sus directos |
| Siguiendo | Directos de los canales que sigues (requiere sesión) |
| Vídeos | Tus canales seguidos → sus emisiones pasadas (VOD). Si el canal está en directo, aparece primero |
| Buscar | Canales (en directo primero) → sus vídeos |
| Entrar / usuario | Login por QR o cerrar sesión |

## Comandos

```
npm test                 # compatibilidad Chromium 53 + red simulada + flujos de UI con jsdom
TWITCH_CLIENT_ID=xxx npm run package   # build -> dist/ y .ipk en out/
ares-install -d <tv> out/com.lighttwitch.app_0.1.0_all.ipk
ares-launch  -d <tv> com.lighttwitch.app
ares-inspect -d <tv> com.lighttwitch.app --open   # DevTools remotas
```

Prueba en escritorio: abrir `app/index.html` en Chrome (flechas, Enter, Esc/Backspace = Atrás).

## Mando

| Tecla | Acción |
|---|---|
| Flechas / OK | Navegar / abrir |
| Atrás | Volver / salir del reproductor / salir de la app |
| Amarillo | Sobre un directo: ver los vídeos de ese canal |
| Rojo | Refrescar la pestaña actual |
| Reproductor: OK | Menú de calidad |
| Reproductor (VOD): ◀ ▶ / ⏪ ⏩ | ±10 s / ±30 s |
| Play / Pause / Stop | Control |

## Estructura

- `app/js/api.js` — GraphQL de Twitch (sin sesión) + token y master playlist HLS
- `app/js/auth.js` — Device Code Grant, refresh de token, Helix (seguidos)
- `app/js/qr.js` — generador de QR propio (verificado con OpenCV, ver `tools/qr-check`)
- `app/js/login.js`, `player.js`, `app.js` — pantalla de cuenta, reproductor, vistas y mando
- `tools/build.mjs` — inlina CSS/JS, minifica ligeramente y genera iconos
