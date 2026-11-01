# Light Twitch (webOS)

Cliente ligero de Twitch para TVs LG webOS. Sin frameworks, un único `index.html` de ~41 KB, `<video>` nativo para HLS.

## Login con Twitch (QR)

Usa el *Device Code Grant* de Twitch: la TV muestra un QR (con el código ya incluido) y un código; escaneas con el móvil, inicias sesión y la TV queda vinculada. Permiso pedido: `user:read:follows`.

Por defecto inicia sesión con el **Client ID de la app de TV de Twitch** (`app/js/config.js`). Es el único cuyo token también acepta el GraphQL privado de Twitch, necesario para los puntos automáticos. Por eso, en la pantalla de autorización de Twitch la solicitante aparece como la app oficial de Twitch.

> **Aviso:** usar el cliente oficial y la API privada no está permitido por las condiciones de Twitch y puede dejar de funcionar en cualquier momento o afectar a tu cuenta. Es tu decisión.

Alternativa oficial: registra tu propia app en https://dev.twitch.tv/console (**Client Type: Public**, redirect `http://localhost`) y compila con `TWITCH_CLIENT_ID=tu_id npm run package`. Todo funciona igual **salvo los puntos automáticos**.

Sin sesión la app funciona (Inicio, Categorías, Buscar); Siguiendo y Vídeos piden sesión.

## Puntos del canal automáticos

Mientras ves un directo con la sesión iniciada, cada 60 s se comprueba si hay un cofre de bonificación y se reclama solo. En el reproductor aparece un aviso (`+50 puntos · 1.234`). Para desactivarlo: `localStorage.setItem('ptsOff','1')`.

## Idioma

Interfaz en **español** e **inglés**. Si no has elegido nada, sigue el idioma del sistema (si empieza por `es`, español; en cualquier otro caso, inglés). El botón **ES / EN** de la barra superior cambia el idioma al momento y la elección se recuerda.

Las traducciones están en `app/js/i18n.js`. Para añadir un idioma, copia el bloque `en` y tradúcelo.

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
npm run package         # build -> dist/ y .ipk en out/  (opcional: TWITCH_CLIENT_ID=xxx)
ares-install -d <tv> out/com.lighttwitch.app_0.1.0_all.ipk
ares-launch  -d <tv> com.lighttwitch.app
ares-inspect -d <tv> com.lighttwitch.app --open   # DevTools remotas
```

Prueba en escritorio: abrir `app/index.html` en Chrome (flechas, Enter, Esc/Backspace = Atrás).

## Mando

**Navegación**

| Tecla | Acción |
|---|---|
| Flechas / OK | Mover / abrir. Bajar desde las pestañas vuelve a la última tarjeta |
| Atrás | Vista anterior → pestañas → Inicio → aviso; pulsar Atrás otra vez cierra la app |
| 1 – 4 | Inicio, Categorías, Siguiendo, Vídeos (5 = Buscar) |
| CH+ / CH− (o Re Pág / Av Pág) | Salto de 3 filas |
| Amarillo | Sobre un directo: ver los vídeos de ese canal |
| Rojo | Refrescar la pestaña actual |

**Reproductor**

| Tecla | Acción |
|---|---|
| OK / Play-Pause | Pausa y reanudar (en pausa el panel no se oculta) |
| ▲ o Verde | Menú de calidad |
| ▼ o Amarillo | Mostrar/ocultar el chat (solo directos) |
| ◀ ▶ (VOD) | Saltar ±10 s. **Pulsando rápido el salto crece**: 10, 10, 30, 30, 60, 60, 120, 120, 300 s. Se aplica un único salto al soltar |
| ⏪ ⏩ (VOD) | Saltos de 30 s como mínimo, con la misma aceleración |
| Atrás / Stop | Salir |

## Chat (solo lectura)

Se activa con ▼ en un directo y la preferencia se recuerda. Pensado para TVs modestas:

- una única conexión WebSocket, **abierta solo mientras el chat está visible**;
- **30 nodos del DOM fijos que se reciclan** (nunca se crean ni destruyen elementos);
- como mucho **4 repintados por segundo** y 8 mensajes por repintado: ante una ráfaga se descartan los antiguos;
- sin imágenes (los emotes salen como texto), mensajes de hasta 160 caracteres y panel superpuesto (el vídeo no se redimensiona);
- se corta al salir del directo o si la app pasa a segundo plano.

## Estructura

- `app/js/api.js` — GraphQL de Twitch (sin sesión) + token y master playlist HLS
- `app/js/auth.js` — Device Code Grant, refresh de token, Helix (seguidos)
- `app/js/points.js` — reclamo automático de puntos (GraphQL privado, requiere el cliente de TV)
- `app/js/qr.js` — generador de QR propio (verificado con OpenCV, ver `tools/qr-check`)
- `app/js/chat.js` — chat IRC de solo lectura optimizado
- `app/js/login.js`, `player.js`, `app.js` — pantalla de cuenta, reproductor, vistas y mando
- `tools/build.mjs` — inlina CSS/JS, minifica ligeramente y genera iconos
