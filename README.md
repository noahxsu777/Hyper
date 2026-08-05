# Watch Party

Ved películas juntos. Un solo navegador —un Chromium real alojado por
**Hyperbeam** y transmitido por WebRTC— que todos los de la sala ven a la vez,
con chat y presencia en tiempo real alrededor.

No hay que sincronizar nada: no existen varias reproducciones que puedan
desfasarse, existe **un único navegador** y todos miran su pantalla.

Sin frameworks ni paso de compilación: HTML, CSS y módulos ES nativos, con un
Express + WebSocket mínimo detrás.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # y pon tu clave en HYPERBEAM_API_KEY
npm start                 # http://localhost:3000
```

Comparte esa dirección (o el botón **Invitar**) y quien la abra entra en la
misma sala. La app arranca aunque no haya clave: te dirá exactamente qué falta.

### Variables de entorno

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `HYPERBEAM_API_KEY` | — | Clave de tu panel de Hyperbeam. **Obligatoria** para el navegador compartido. |
| `HYPERBEAM_API_URL` | `https://engine.hyperbeam.com/v0` | Base de la API REST. |
| `HB_WIDTH` / `HB_HEIGHT` | `1280` / `720` | Resolución del navegador. 16:9, que es como son las películas. |
| `HB_START_URL` | `https://www.google.com` | Página inicial. |
| `HB_OFFLINE_TIMEOUT` | `60` | Segundos sin nadie conectado antes de que la máquina se apague sola. |
| `ROOM_NAME` | `Sala de cine` | Nombre que aparece arriba. |
| `PORT` | `3000` | Puerto del servidor. |

---

## Desplegar en Fly.io

```bash
fly secrets set HYPERBEAM_API_KEY=sk_test_...   # la clave nunca va en el repo
fly scale count 1                               # ⚠️ obligatorio, ver abajo
fly deploy
```

### Tiene que ser una sola máquina

La presencia, el chat y la sesión compartida viven en la memoria de **este**
proceso. Con dos máquinas detrás del balanceador de Fly, dos personas que entren
caen en procesos distintos y pasa esto:

- no se ven en la lista de gente,
- el chat se parte en dos mitades que no se hablan,
- **cada máquina abre su propio navegador virtual**, así que gastas el doble de
  minutos y cada grupo ve una película distinta.

`fly scale count 1` lo arregla. Si algún día hicieran falta varias máquinas,
habría que mover la sala a un almacén compartido (Redis o similar); para una
watch party, una máquina sobra.

### Cosas que ya están resueltas en la configuración

- `PORT = '8080'` en `fly.toml`, igual que `internal_port`. Fly no define `PORT`
  por su cuenta: sin esto el servidor escucha en el 3000 y el proxy enruta al
  8080, donde no hay nadie — la aplicación responde con un error de conexión.
- El contenedor arranca con `node server/index.js`, no con `npm run start`. Node
  es PID 1 y recibe el SIGINT que Fly manda al parar la máquina, que es lo que
  dispara el apagado de la sesión de Hyperbeam. Con `npm` en medio la señal no
  llega y el navegador virtual seguiría facturando.
- Health check contra `/api/config`.
- La máquina puede pararse sola cuando no hay nadie (`auto_stop_machines`) y
  arranca de nuevo con la primera visita.

---

## Cómo se usa

1. Entras, pones tu nombre y ya estás en la sala.
2. Alguien pulsa **Abrir el navegador compartido**. A todos los demás se les
   conecta solo: no hay que darle a nada.
3. Pones una película desde los accesos directos o escribiendo la dirección.
4. La barra de abajo controla la reproducción para toda la sala, porque manda
   las teclas al navegador remoto:

   | Control | Tecla que envía | Qué hace en YouTube, Twitch, Vimeo… |
   | --- | --- | --- |
   | ⏯ | `espacio` | Reproducir / pausar |
   | ⏪ ⏩ | `←` `→` | Retroceder / avanzar |
   | Recargar | — | Recarga la pestaña |

   El teclado también funciona directamente: cualquier tecla que pulses va a la
   película, **salvo** mientras escribes en el chat.

5. El volumen y el botón de silencio son **tuyos**: cada uno se lo ajusta sin
   molestar al resto.
6. **Modo cine** esconde el chat; el botón de al lado pone la ventana a pantalla
   completa.

### Sobre el DRM

YouTube, Twitch, Vimeo, Plex y Archive.org funcionan. Netflix, Prime Video y
Disney+ usan DRM (Widevine) y puede que se nieguen a reproducir dentro de un
navegador virtual: eso depende del plan de Hyperbeam, no de esta aplicación. La
interfaz ya lo avisa en vez de dejarte con una pantalla negra.

---

## Cómo funciona por dentro

```
navegador  ──POST /api/session──▶  servidor  ──Authorization: Bearer <clave>──▶  engine.hyperbeam.com/v0/vm
navegador  ◀────{ embedUrl }─────  servidor  ◀──{ session_id, embed_url, admin_token }──
           ◀────── WebSocket /ws ─────────▶   presencia · chat · "se ha abierto el navegador"
```

- La clave de API y el `admin_token` **nunca** salen del proceso de Node. El
  navegador solo recibe el `embed_url`, que ya está limitado a una sesión.
- Hay **una sola** máquina virtual para toda la sala. Es lo que hace que ver algo
  juntos funcione, y evita gastar minutos abriendo una por persona.
- Cuando alguien la abre, el servidor avisa por WebSocket y el resto se conecta
  automáticamente. Cuando se cierra, pasa lo mismo al revés.
- Al parar el servidor con Ctrl-C la sesión se termina en Hyperbeam.

### Estructura

```
server/
  index.js       Express: estáticos, /api/config, /api/session
  hyperbeam.js   Cliente REST de Hyperbeam
  party.js       WebSocket: presencia, chat e historial de la sala
public/
  css/           reset · tokens (colores, materiales, muelles) · app
  js/
    core/        dom · icons (SVG) · api · party (socket) · store
    main.js      La sala entera
```

---

## Notas

- Las claves `sk_test_` tienen minutos limitados: cierra el navegador compartido
  desde ⚙ cuando terminéis.
- El chat vive en memoria del servidor (los últimos 120 mensajes). Si reinicias
  el servidor, se vacía. Tu nombre y tu volumen sí se guardan en tu navegador.
- Hace falta salida a `engine.hyperbeam.com` y a los servidores WebRTC de
  Hyperbeam. Si tu red los bloquea, la sala te muestra el error exacto.
