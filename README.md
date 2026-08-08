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

Crea una sala, comparte su **código de 6 letras** (o el enlace `/ABC123`) y
quien lo tenga entra contigo. Cada sala es independiente: su gente, su chat y su
navegador compartido. La app arranca aunque no haya clave: te dirá qué falta.

### Variables de entorno

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `HYPERBEAM_API_KEY` | — | Clave de tu panel de Hyperbeam. **Obligatoria** para el navegador compartido. |
| `HYPERBEAM_API_URL` | `https://engine.hyperbeam.com/v0` | Base de la API REST. |
| `HB_WIDTH` / `HB_HEIGHT` | `1280` / `720` | Resolución del navegador. 16:9, que es como son las películas. |
| `HB_START_URL` | `https://www.google.com` | Página inicial. |
| `HB_USER_AGENT` | (vacío) | User agent del navegador virtual. Vacío = Chrome de escritorio. |
| `HB_OFFLINE_TIMEOUT` | `60` | Segundos sin nadie conectado antes de que la máquina se apague sola. |
| `GIPHY_API_KEY` | — | Clave de [developers.giphy.com](https://developers.giphy.com). Sin ella el botón de GIFs explica qué falta. |
| `ROOM_NAME` | `Sala de cine` | Nombre que aparece arriba. |
| `ROOM_OWNER_GRACE_MS` | `180000` | Cuánto espera la sala a un anfitrión desconectado antes de pasar el mando. |
| `ROOM_EMPTY_TTL_MS` | `120000` | Cuánto sobrevive una sala vacía antes de cerrarse y apagar su navegador. |
| `MAX_ROOMS` | `25` | Salas abiertas a la vez. Cada una puede gastar minutos de Hyperbeam. |
| `PORT` | `3000` | Puerto del servidor. |

---

## Desplegar en Fly.io

```bash
fly secrets set HYPERBEAM_API_KEY=sk_test_...   # la clave nunca va en el repo
fly secrets set GIPHY_API_KEY=...               # para el botón de GIFs
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

## Salas

No hay una sala única: cada una nace con un código de seis caracteres (sin O/0
ni I/1, porque se dictan por teléfono) y vive por su cuenta —su gente, su chat,
su navegador compartido y sus reglas—. El enlace `tudominio/ABC123` entra
directo.

Una sala vacía se cierra sola pasado `ROOM_EMPTY_TTL_MS` y se lleva su navegador
virtual con ella, que es lo que cuesta dinero.

## Anfitrión, moderadores e invitados

Quien crea la sala **la lleva**. Puede nombrar **moderadores**, y entre todos
ellos eligen qué se ve: abren el navegador, escriben direcciones, controlan la
reproducción y el volumen de la sala. El resto son **invitados**: ven la misma
pantalla y hablan por el chat.

| | Anfitrión | Moderador | Invitado |
| --- | :-: | :-: | :-: |
| Ver y chatear | ✓ | ✓ | ✓ |
| Abrir y cerrar el navegador | ✓ | ✓ | |
| Controlar la película y el volumen de la sala | ✓ | ✓ | |
| Expulsar invitados | ✓ | ✓ | |
| Nombrar moderadores | ✓ | | |
| Cerrar la sala | ✓ | | |

Un moderador no puede expulsar a otro moderador, y nadie puede tocar al
anfitrión.

No es solo que se escondan los botones. El servidor entrega a cada persona un
secreto al entrar y las rutas comprueban qué compra ese secreto: un invitado que
llame a la API a mano recibe un 403, y sin secreto un 401. Además su cliente
arranca con `disableInput`, así que sus clics y teclas ni siquiera salen hacia el
navegador compartido.

**Expulsar** saca a alguien de la sala y le impide volver con ese navegador.
**Sala cerrada** (en ⚙, solo el anfitrión) deja fuera a cualquiera nuevo; los que
ya están dentro se quedan.

El anfitrión lo es **por navegador, no por conexión**. Bloquear el móvil, cambiar
de app o recargar la página tira el socket, pero al volver sigues siendo el
anfitrión, apareces una sola vez en la lista y el chat no se llena de "ha salido
/ se ha unido" (el aviso de salida espera 15 s por si vuelves).

Si el anfitrión desaparece de verdad, la sala espera `ROOM_OWNER_GRACE_MS`
(3 minutos por defecto) antes de pasar el mando a quien lleve más tiempo dentro.
Y si no queda nadie, la sala se libera: quien llegue después empieza de cero, en
vez de quedarse bloqueado esperando a alguien que no va a volver.

> Lo que **no** está blindado: un invitado con las herramientas de desarrollo
> abiertas podría devolverse el control local sobre el vídeo. Bloquearlo de
> verdad requiere la API de permisos de Hyperbeam con el `admin_token` en el
> navegador del anfitrión, y este proyecto no ha podido probarla. Para ver una
> película con amigos, lo que hay sobra.

---

## Cómo se usa

1. Entras, pones tu nombre y ya estás en la sala.
2. El anfitrión pulsa **Abrir el navegador compartido**. A todos los demás se les
   conecta solo: no hay que darle a nada.
3. El anfitrión pone una película desde los accesos directos o escribiendo la
   dirección.
4. La barra de abajo controla la reproducción para toda la sala, porque manda
   las teclas al navegador remoto:

   | Control | Tecla que envía | Qué hace en YouTube, Twitch, Vimeo… |
   | --- | --- | --- |
   | ⏯ | `espacio` | Reproducir / pausar |
   | ⏪ ⏩ | `←` `→` | Retroceder / avanzar |
   | Recargar | — | Recarga la pestaña |

   El teclado también funciona directamente: cualquier tecla que pulses va a la
   película, **salvo** mientras escribes en el chat.

5. El botón del altavoz abre un panel con **dos barras independientes**:
   - **Solo para ti** — tu volumen. Nadie más lo nota.
   - **Para toda la sala** — el volumen de la película para todos. Manda las
     teclas de volumen al reproductor remoto (5% por paso en YouTube, Twitch y
     Vimeo), y su valor viaja por el socket, así que la barra de todos se mueve
     a la vez y quien llegue tarde la ve donde está. Solo quien la mueve manda
     las teclas: si lo hicieran todos, el volumen bajaría una vez por persona.
     El silencio compartido sí es exacto, porque usa la API de pestañas.

   El panel se cierra con la X, con `Esc` o tocando fuera.
6. **Modo cine** esconde el chat; el botón de al lado pone la ventana a pantalla
   completa.
7. Escribe **`!love`**, **`!pork`** o **`!drag`** en el chat y una animación se
   reproduce para toda la sala y luego se va sola. No dejan mensaje: son un
   momento, no una conversación, así que quien entre después no se encuentra la
   pantalla llena de corazones. Los comandos los define el servidor (`COMMANDS`
   en `server/rooms.js`) y aceptan tanto un Lottie como una imagen, así que
   añadir otro es una línea.
8. El botón 🙂 del chat abre los **stickers**. El catálogo lo define el servidor
   y solo acepta identificadores de esa lista, así que nadie puede colar
   contenido propio en el chat de los demás.
9. Al lado, el botón **GIF** busca en GIPHY. La búsqueda va contra
   `/api/gifs`, que es nuestro servidor: la clave de GIPHY se queda ahí y nunca
   llega al navegador. Al enviar, la sala solo acepta URLs de `giphy.com`, así
   que ese endpoint no sirve para meter imágenes de cualquier sitio en el chat
   ajeno.

### El user agent del navegador compartido

`HB_USER_AGENT` cambia el user agent que anuncia **el navegador virtual**, no el
tuyo. Se envía como `user_agent` en la llamada que crea la sesión, así que las
webs ven ese navegador cuando les pide la película.

Hyperbeam solo documenta un preset, `chrome_android`. **No hay preset de iPad**
—aunque la cadena de un iPad en modo escritorio es exactamente la de un Safari
de Mac, que es la que viene puesta—. Una cadena propia se pasa tal cual y decide
su API.

Como no se puede comprobar desde aquí si la acepta, el servidor prueba en orden:

1. la tuya (`HB_USER_AGENT`),
2. `chrome_android`, el preset que sí existe,
3. el agente por defecto.

Un user agent rechazado cuesta un diseño, nunca la película. En ⚙ verás cuál
acabó usando, y si tuvo que caer al siguiente te lo dice.

Para confirmar cuál se está usando de verdad, abre el navegador compartido en
`whatismybrowser.com/detect/what-is-my-user-agent`.

### El teclado del móvil

Un teclado en pantalla tapa la parte de abajo de la ventana sin que la página se
entere: `100dvh` sigue midiendo todo el alto y el campo de mensaje acaba debajo
de las teclas. La sala se mide con el *visual viewport*, que sí lo sabe, y
mantiene el campo a la vista.

### Cuando vuelves a la app

Un navegador móvil suspende el vídeo al pasar a segundo plano, y al volver la
conexión WebRTC suele estar muerta aunque el SDK diga que se está reconectando.
La sala lo trata como lo que es: al volver a primer plano le da un toque
(`hb.reconnect()`), y si en unos segundos no hay imagen, tira el vídeo y lo
vuelve a montar desde la sesión que el servidor sigue teniendo. El aviso de
"Reconectando…" lleva además un botón de **Reintentar**, para no dejarte mirando
un spinner.

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
  index.js       Express: estáticos, /api/config, /api/rooms/:code/session
  hyperbeam.js   Cliente REST de Hyperbeam
  giphy.js       Búsqueda de GIFs, para que la clave no salga del servidor
  rooms.js       Salas: presencia, chat, roles, moderación y WebSocket
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
