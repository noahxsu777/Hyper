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
| `HB_OFFLINE_TIMEOUT` | tope + 60 s (`1860`) | Red de seguridad de Hyperbeam: segundos sin nadie conectado antes de apagar la máquina si el servidor muere sin limpiar. El apagado normal de una sala vacía lo hace la sala (ver [Apagado automático](#apagado-automático)). No lo bajes del tope o recortarás lo que elija el anfitrión. |
| `HB_LOCK_CONTROL` | (apagado) | `true` pide a Hyperbeam sesiones donde nadie puede manejar hasta que el anfitrión se lo concede (ver [El mando](#el-mando-del-navegador-compartido)). |
| `HB_INACTIVE_TIMEOUT` | `0` | Segundos sin que nadie **toque** el navegador compartido antes de apagarlo. `0` lo desactiva, que es lo que necesita una watch party. |
| `HB_ABSOLUTE_TIMEOUT` | `21600` | Tope de vida de una sesión, en segundos. Seis horas, como red de seguridad. |
| `GIPHY_API_KEY` | — | Clave de [developers.giphy.com](https://developers.giphy.com). Sin ella el botón de GIFs explica qué falta. |
| `ROOM_NAME` | `Sala de cine` | Nombre que aparece arriba. |
| `ROOM_OWNER_GRACE_MS` | `180000` | Cuánto espera la sala a un anfitrión desconectado antes de pasar el mando. |
| `ROOM_EMPTY_TTL_MS` | `86400000` | Cuánto se recuerda una sala **vacía** (un día). Una sala con gente dentro no expira nunca. |
| `ROOM_IDLE_SESSION_MS` | `120000` | Cuánto espera una sala **vacía** antes de apagar su navegador virtual (2 min). El anfitrión puede cambiarlo en Ajustes. |
| `ROOM_IDLE_SESSION_MAX_MS` | `1800000` | Lo máximo que el anfitrión puede elegir (30 min): el techo del operador sobre lo que cuesta una sala vacía. |
| `MAX_ROOMS` | `25` | Salas abiertas a la vez. Cada una puede gastar minutos de Hyperbeam. |
| `PORT` | `3000` | Puerto del servidor. |

Marca, acceso, límites y medición de uso (`BRAND_*`, `ACCESS_CODES`,
`MAX_SESSIONS`, `ADMIN_TOKEN`…) están explicados en
[Producción y venta a clientes](#producción-y-venta-a-clientes).

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
- Health check contra `/healthz` (barato: no toca Hyperbeam).
- **La máquina no se para sola** (`auto_stop_machines = 'off'`,
  `min_machines_running = 1`). Ver más abajo: es lo que hacía que una sala
  "dejara de existir" a media película.

---

## Producción y venta a clientes

Lo que hace falta para ofrecer esto a terceros sin que sea un prototipo: marca
propia, control de quién gasta minutos, un techo para la factura, medición por
cliente y un servidor que no se deja abusar.

### Checklist antes de abrirlo al público

1. `NODE_ENV=production` (ya está en el `Dockerfile` y en `fly.toml`). En
   producción el público ve mensajes amables; los detalles técnicos y los
   diagnósticos del operador (clave de prueba, user agent…) van solo al log.
2. Una clave **`sk_live_`** de Hyperbeam. Con una `sk_test_` el arranque lo
   avisa: los minutos son limitados.
3. `ACCESS_CODES` con un código por cliente (ver abajo). Sin él, **cualquiera**
   que entre a una sala puede abrir un navegador y gastar tus minutos.
4. `MAX_SESSIONS` pensado con tu plan de Hyperbeam: es el techo de la factura.
5. `ADMIN_TOKEN` para consultar el uso (16 caracteres mínimo).
6. Un volumen persistente para `ROOM_STATE_FILE` y `USAGE_FILE`. El disco de una
   máquina de Fly se borra en cada despliegue: sin volumen pierdes el registro
   de uso. Crea el volumen con `fly volumes create data --size 1 --region ams`,
   añade a `fly.toml`
   ```toml
   [mounts]
     source = 'data'
     destination = '/data'
   ```
   y define `ROOM_STATE_FILE=/data/rooms-state.json` y
   `USAGE_FILE=/data/usage.jsonl`.
7. `fly scale count 1` (ver arriba).

### Marca blanca

Todo sale de variables de entorno; no hay que tocar código.

| Variable | Por defecto | Efecto |
| --- | --- | --- |
| `BRAND_NAME` | `Watch Party` | Nombre en la portada, la pestaña, el icono de inicio y la vista previa al compartir el enlace. |
| `BRAND_SHORT_NAME` | `BRAND_NAME` (14 car.) | Nombre bajo el icono en la pantalla de inicio del móvil. |
| `BRAND_TAGLINE` | (frase por defecto) | Subtítulo de la portada y descripción del enlace. |
| `BRAND_ACCENT` | `#7c5cff` | Color de marca `#rrggbb`: botones, degradados, brillos **y los iconos de la app**, que el servidor dibuja con ese color. |
| `BRAND_LOGO_URL` | — | Logo (https) que sustituye al símbolo ▶ en la portada y la barra superior. |
| `BRAND_SUPPORT_URL` / `BRAND_TERMS_URL` / `BRAND_PRIVACY_URL` | — | Enlaces «Soporte», «Términos» y «Privacidad» al pie de la portada. Solo aparecen los que definas, y solo se aceptan URLs `http(s)`. Los textos legales los pones tú: la app no inventa ninguno. |
| `BRAND_ASSETS_DIR` | — | Carpeta con tus propios `icon-32.png`, `icon-180.png`, `icon-192.png` e `icon-512.png`. Los que existan sustituyen a los dibujados. |
| `FRAME_ANCESTORS` | `'none'` | Por defecto la app no se puede incrustar en otra web. Para ponerla dentro de la de un cliente: `https://cliente.com`. |

**Instalable en el iPhone.** Abre la web en Safari → Compartir → *Añadir a
pantalla de inicio*. Se abre a pantalla completa, sin barra de Safari, con su
icono y su nombre (`manifest.webmanifest`, `apple-touch-icon` y los metadatos de
app web ya están en la página). Los iconos son opacos y sin esquinas
redondeadas a propósito: iOS les pone las suyas.

### Quién puede abrir un navegador (`ACCESS_CODES`)

Entrar a una sala, chatear y jugar no cuesta nada. Lo único que cuesta dinero es
la máquina virtual, así que es lo único que se controla:

```bash
ACCESS_CODES="Acme Corp=acme-7Hk2-93xQ,Globex=globex-Zr4t-81bN"
```

- Formato `Cliente=código`, separados por comas. Mínimo 8 caracteres por código
  (el arranque avisa de los cortos).
- Quien pulse «Abrir el navegador compartido» sin código ve una hoja que lo pide;
  lo recuerda en ese navegador y, si se equivoca, vuelve a preguntar.
- La **sala queda licenciada** por el primer código válido: sus siguientes
  arranques no lo piden y todos los minutos se atribuyen a ese cliente.
- Unirse a un navegador que ya está abierto nunca pide código.
- Sin `ACCESS_CODES` todo queda abierto (desarrollo, o una instalación de un solo
  cliente).

### Techo de gasto y límites

| Variable | Por defecto | Qué limita |
| --- | --- | --- |
| `MAX_SESSIONS` | `10` | Máquinas virtuales vivas a la vez, de quien sea. `0` lo quita. Al llegar, el que pide una nueva ve «no hay navegadores libres» y no se gasta nada. |
| `MAX_VIEWERS_PER_ROOM` | `50` | Personas por sala (el creador siempre entra). |
| `MAX_SOCKETS_PER_IP` | `30` | Conexiones simultáneas por dirección. |
| `RATE_LIMIT_MULTIPLIER` | `1` | Multiplica todos los límites por IP. Súbelo (`3`) si un cliente tiene una oficina entera detrás de una sola IP. |

Límites fijos por IP: 12 salas nuevas / 10 min, 20 aperturas de navegador /
10 min (los códigos mal escritos cuentan, lo que frena a quien pruebe códigos),
60 búsquedas de GIF/YouTube / min. En el chat, ráfagas de 5 mensajes y luego
uno por segundo; los mensajes del socket no pueden pasar de 16 KB.

Detrás de Fly se usa la IP real del cliente. Fuera de un proxy conocido no se
fía de `X-Forwarded-For` (lo escribe quien quiera); `TRUST_PROXY=1` lo activa a
mano.

### Medición de uso y facturación

Cada vez que se apaga una máquina (por el botón, por inactividad, al cerrar la
sala o al parar el servidor) se añade una línea a `USAGE_FILE`
(`usage.jsonl`, una por sesión: cliente, sala, inicio, fin, minutos y motivo).
Con `ADMIN_TOKEN` definido:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://tu-app.fly.dev/api/admin/usage?since=2026-10-01"
```

devuelve minutos y sesiones por cliente desde esa fecha, más lo que está
corriendo ahora (`live`) y cuánto queda hasta los topes. **No incluye cobro**: la
app mide, tú facturas.

Dos matices honestos: una sesión que sigue viva (o que se pierde por una caída
sin apagado limpio) aparece en `live`, no en los totales hasta que termine; y
los minutos son los del servidor (de la creación al borrado de la máquina), que
pueden diferir unos segundos de lo que te cobre Hyperbeam.

### Seguridad que ya lleva

- Cabeceras en todo: `X-Content-Type-Options`, `Referrer-Policy`,
  `frame-ancestors`/`X-Frame-Options` (no se puede enmarcar), y HSTS tras HTTPS.
  La política CSP es solo el subconjunto seguro: una con `script-src`/`connect-src`
  tendría que listar cada host de Hyperbeam, YouTube, Twitch y GIPHY, y un error
  ahí rompe la pantalla compartida en silencio, así que es una decisión de cada
  despliegue.
- Peticiones de 16 KB como mucho; comparación de códigos y token en tiempo
  constante; el panel de uso no existe (404) sin `ADMIN_TOKEN`.
- Errores de Hyperbeam: al público una frase («se ha agotado el cupo…»); al log,
  el detalle y una línea `[ALERTA]` cuando parece cupo agotado o clave rechazada.
- Un cierre limpio (SIGTERM/SIGINT, o una excepción inesperada) apaga todas las
  máquinas antes de salir.

### Pruebas

```bash
npm test
```

Levanta el servidor de verdad con un Hyperbeam simulado que cuenta las máquinas
vivas (esa cuenta es la factura) y comprueba: roles y relevo del anfitrión,
códigos de acceso, tope de máquinas, que tres clics a la vez abren una sola,
medición de uso, marca y manifest, límites, cabeceras y apagado.

---

## Salas

No hay una sala única: cada una nace con un código de seis caracteres (sin O/0
ni I/1, porque se dictan por teléfono) y vive por su cuenta —su gente, su chat,
su navegador compartido y sus reglas—. El enlace `tudominio/ABC123` entra
directo.

Una sala con gente dentro **no expira nunca**. Vacía, se recuerda un día
entero (`ROOM_EMPTY_TTL_MS`) por si su gente vuelve, pero su navegador virtual
**se apaga solo a los 2 minutos** (ver [Apagado automático](#apagado-automático)):
la sala es memoria y no cuesta nada; la máquina se factura por minuto. Al llegar
a `MAX_ROOMS`, la sala vacía más antigua cede su hueco a quien crea una nueva:
los fantasmas nunca bloquean a la gente real.

### Apagado automático

Si **nadie queda en la sala**, el navegador compartido se apaga solo y deja de
gastar minutos. Por defecto, a los 2 minutos: lo justo para un refresco, un
túnel o un bloqueo de pantalla corto.

- El **anfitrión** lo cambia en ⚙ Ajustes → *Apagar el navegador si la sala
  queda vacía* (1, 2, 5, 10, 15 o 30 min). Es del anfitrión porque decide cuánto
  dinero sigue corriendo.
- El **operador** pone el techo con `ROOM_IDLE_SESSION_MAX_MS` (30 min por
  defecto): las opciones por encima no aparecen, y un archivo de estado editado
  a mano tampoco puede saltárselo.
- Quien vuelve después lo ve en el chat: *«El navegador compartido se apagó solo
  porque la sala se quedó vacía. Ábrelo otra vez cuando quieras.»*
- Si el servidor se reinicia con una sala ya vacía, el reloj cuenta lo que esa
  sala ya llevaba vacía, no empieza de cero.
- La red de seguridad es el `offline_timeout` de Hyperbeam: lo calcula el
  servidor a partir del techo (+1 min) para que nunca recorte la elección del
  anfitrión.

El precio de un valor corto es real: quien salga a compartir el enlace y tarde
más del tiempo elegido encuentra el navegador cerrado (la sala, el chat y los
roles siguen). Si tu gente suele pausar películas largas, súbelo en Ajustes.

### La portada

La primera pantalla pide un nombre y ofrece tres caminos: **crear una sala**,
**entrar con un código**, o **elegir una de las salas abiertas**.

La lista sale de `GET /api/rooms` y se refresca sola cada 5 segundos mientras la
portada está a la vista, así que una sala que alguien abre ahora aparece sin
recargar. De cada sala se ve el código, quién la lleva, cuánta gente hay dentro y
si la película ya está en marcha.

Lo que **no** sale en esa lista importa igual:

- **Las salas en privado.** Poner el candado también quita la sala de la
  portada. Sigue funcionando con su código para quien ya estaba invitado: el
  candado es para no aparecer, no para dejar de existir.
- **Las salas vacías.** Una sala sin nadie dentro se recuerda todo un día por
  si su gente vuelve, pero no es una sala "abierta" y no se anuncia como tal.
- **Nada de dentro.** El listado no lleva tokens, ni el `embed_url`, ni el
  historial del chat, ni la lista de gente: sólo lo justo para decidir si entrar.

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
| Abrir y cerrar votaciones | ✓ | ✓ | |
| Votar y reaccionar | ✓ | ✓ | ✓ |
| Elegir el apagado automático de la sala vacía | ✓ | | |
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
(3 minutos por defecto) antes de pasar el mando a quien lleve más tiempo dentro,
**como suplente**: quien creó la sala sigue siendo su creador para siempre. En
cuanto vuelva desde su navegador —un minuto o un día después, aunque la sala esté
cerrada— recupera el mando y el suplente vuelve a invitado (el chat avisa:
*«Ana ha vuelto y retoma la sala»*). Y si no queda nadie, la sala se libera:
quien llegue después empieza de cero, en vez de quedarse bloqueado esperando a
alguien que no va a volver.

Esto se apoya en el identificador que guarda el navegador. Quien borre los datos
del sitio o entre desde otro dispositivo es, para la sala, otra persona.

### El mando del navegador compartido

Hyperbeam tiene su propio sistema de permisos: cada sesión nace con un
`admin_token`, y quien lo presenta puede decidir quién maneja. Esta app lo usa
así:

- El servidor **solo entrega el token al anfitrión y a los moderadores**
  (`GET /api/rooms/:code/session/control`, con el secreto de sala). Nunca va en
  la sesión pública, ni en el mensaje de bienvenida, ni en ningún aviso a la sala.
- Al conectarse al navegador, el cliente de un anfitrión pasa ese token a
  Hyperbeam y **reclama el mando** (`setPermissions`) con la prioridad más alta:
  2 el anfitrión, 1 los moderadores.
- **Refrescar no lo pierde.** La sala conoce al anfitrión por su navegador, no
  por su conexión, así que al recargar recupera el token y vuelve a reclamar el
  mando. No se abre otra máquina: se reengancha a la que ya había.
- Si nombras moderador a alguien con el navegador abierto, recibe el token y el
  mando al momento, sin recargar. Si se lo quitas, suelta el mando y el token.
- Un invitado conecta sin token, con la entrada desactivada, y nunca pide control.

**Modo estricto (`HB_LOCK_CONTROL=true`).** Por defecto, todo el que está conectado
puede manejar a nivel de Hyperbeam y es esta página la que se lo impide a los
invitados (`disableInput`): suficiente para ver una película con amigos, pero un
invitado con las herramientas de desarrollo podría saltárselo. Con el modo
estricto la sesión se abre con `control_disable_default: true`: nadie maneja
hasta que el anfitrión o un moderador se lo concede, y eso lo hace cumplir
Hyperbeam, no la página.

> **Sin verificar contra la API real.** Este proyecto no ha podido probar contra
> Hyperbeam ni el parámetro `control_disable_default` ni la semántica exacta de
> `setPermissions` (`priority`, `idle_timeout`), así que está apagado por defecto.
> Si la API rechaza el parámetro, la sesión se abre igual sin él, el log lo dice
> y no se vuelve a intentar. Pruébalo con tu cuenta antes de confiar en él: abre
> una sala, entra con un invitado y comprueba que no puede manejar. Una cosa más:
> un moderador degradado suelta el token en su navegador, pero uno malintencionado
> lo habría copiado; reiniciar el navegador compartido (una sesión nueva) lo
> invalida.

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
10. **Reacciones sobre la pantalla.** El botón 😊 de la esquina de la pantalla
    despliega seis emojis (🍿 😂 ❤️ 🔥 👏 😱); al tocar uno sube flotando por la
    pantalla de **todos**, también sobre el navegador compartido o un juego, y
    se pliega solo a los 5 s. Solo vuelan los stickers de la lista del servidor,
    y cada persona puede lanzar unos 5 por segundo (ráfaga de 10): no hay forma
    de inundar la pantalla de los demás. No dejan rastro en el chat.
11. **Votaciones.** El anfitrión y los moderadores abren una desde la barra
    *🗳️ Crear una votación* del chat: una pregunta y de 2 a 6 opciones (las
    repetidas y las vacías se descartan). Todos votan **una vez** y pueden
    cambiar su voto mientras esté abierta; el resultado se actualiza en directo
    en las hojas abiertas. Quien la abre la cierra con *Cerrar la votación* y el
    chat anuncia el ganador (o el empate, o que nadie votó). Los votos son
    anónimos: se ven los recuentos, no quién votó qué. Viven en memoria, como el
    chat.

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

### La pantalla en el móvil

La ventana del navegador compartido —la caja donde vive Hyperbeam— mide
**16:9** en el móvil, la misma proporción con la que arranca la máquina
virtual (`HB_WIDTH`×`HB_HEIGHT`). Antes medía más alta que ancha para
aprovechar el hueco vertical, pero eso tiene un coste: `fitToScreen` redimensiona
la máquina virtual exactamente al tamaño de esa caja, así que una caja
desproporcionada hace que la página remota se renderice en una ventana casi
cuadrada — y lo que se ve alrededor del vídeo no es "recorte", es la propia
página (a menudo con fondo oscuro) ocupando el hueco que el vídeo no llena.
A 16:9, ese hueco casi desaparece.

**Pantalla completa** (⛶ en la barra) ya no fullscreenea toda la app con su
barra, su chat y sus controles alrededor en miniatura: esconde los tres y dejan
la ventana entera para la imagen, de borde a borde, con solo un botón para
volver (arriba a la derecha, se difumina si no se usa). En Android, además
intenta bloquear la orientación en horizontal (`screen.orientation.lock`),
porque casi todo lo que se ve aquí es vídeo horizontal; si el contenido es
vertical, o el navegador no admite el bloqueo, sigue funcionando — solo que
sin el giro automático.

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

### Por qué una sala ya no "caduca" viéndola

Se cortaba a media película por tres motivos distintos, todos con la misma cara:

1. **El reloj de inactividad de Hyperbeam.** Cuenta desde la última vez que
   alguien tocó el ratón o el teclado *dentro* del navegador compartido. Ver una
   película es exactamente eso: dos horas sin tocar nada. La sesión se cerraba
   "por inactividad" con la sala entera mirándola. Ahora se pide
   `timeout.inactive = 0`, que lo desactiva. Si la cuenta no acepta ese campo,
   la sesión se abre igual sin él y el servidor lo dice en ⚙ (`timeoutsApplied`)
   en vez de dar por hecho que se aplicó.
2. **`offline_timeout` en 60 segundos.** Bloquear el móvil un minuto bastaba
   para que Hyperbeam apagara la máquina. Ahora la red de seguridad de
   Hyperbeam es el tope de apagado + 1 min, y si la API rechaza ese valor el
   servidor baja el listón en escalera (→ 1 h → sin bloque) en vez de quedarse
   sin sesión; ⚙ enseña cuál aplicó (`activeOfflineTimeout`). El apagado de una
   sala vacía lo decide la sala, no ese reloj.
3. **Fly parando la máquina.** Las salas viven en la memoria del proceso: si Fly
   la paraba por falta de tráfico, desaparecían todas, y al volver salía "la
   sala ya no existe". `auto_stop_machines = 'off'` y `min_machines_running = 1`.

Y una sala vacía ya no se tira a los 2 minutos. Ahora son dos relojes separados,
porque cuestan cosas distintas: el **navegador virtual** se apaga a los 90
segundos (es lo único que gasta minutos), y la **sala** —su código, su chat,
quién la lleva— se recuerda un día entero. Con gente dentro, no expira nunca.

Pasada la gracia del anfitrión con la sala vacía, la sala queda libre: quien
entre después la lleva. Una sala que conserva a un dueño que no está es una sala
que nadie puede arrancar.

### Apps de la sala

El botón ⊞ de la barra (y «Apps de la sala» en la pantalla de espera) abre un
catálogo tipo tienda: **Medios** y **Juegos**. Las apps ocupan la misma pantalla
que el navegador compartido, pero no lo usan: **no gastan minutos de Hyperbeam**
y funcionan aunque falte la clave.

- **YouTube** — reproducción sincronizada de verdad, sin Hyperbeam: solo el
  iframe oficial en cada navegador. La caja de arriba busca **y** acepta
  enlaces: escribe algo y salen resultados con miniatura, canal y duración
  (la búsqueda pasa por `/api/youtube`, un proxy a la API que usa la propia web
  de YouTube — sin clave nuestra ni cuota); pega un enlace y se reproduce
  directo. El servidor guarda el vídeo, si está en marcha y en qué segundo, y
  cada navegador reproduce su copia pegada al reloj de la sala (se corrige sola
  si se desvía más de segundo y medio). Los controles del iframe van
  desactivados: el mando es la barra de la sala. El servidor solo acepta **IDs
  de vídeo**, nunca URLs: aceptar URLs convertiría la app en una forma de
  incrustar cualquier página en la pantalla de todos.
- **Twitch** — todos el mismo canal; al ser directo, la sincronía la pone Twitch.
- **Netflix (vinculado)** — Netflix **no puede** reproducirse dentro de otra
  web: prohíbe incrustarse y su DRM solo corre en su reproductor. Lo que hacen
  Rave (app nativa con WebView) y Teleparty (extensión) es sincronizar el
  reproductor de **cada uno**, y esta app hace lo mismo con la extensión de la
  carpeta **`extension/`**: cada persona abre Netflix con su cuenta, vincula la
  pestaña pegando el enlace de la sala, y play, pausa y posición viajan solos.
  Quien lleva la sala puede además pegar su **código de mando** (su token de
  sala): entonces su pestaña de Netflix ES el mando, y dar al play ahí mueve el
  de todos. Sin extensión (móviles), queda la cuenta atrás en grande de
  siempre. Detalles e instalación en `extension/README.md`.
- **Juegos** — cuatro en raya, tres en raya, damas y ajedrez. **Las reglas viven
  en el servidor** (`server/games.js`): un movimiento llega como intención, se
  valida contra el estado real y solo entonces se entera la sala — un navegador
  mentiroso no puede corromper el tablero de nadie. El ajedrez es completo
  (enroque con sus condiciones, al paso, promoción a dama, mate y ahogado;
  validado con perft 20/400) y las damas llevan captura obligatoria, cadenas y
  coronación. Abrir y cerrar apps es de moderadores, pero **sentarse a jugar es
  de cualquiera**: los asientos son de la sala, y un asiento cuyo dueño se fue
  se puede ocupar.

Una pantalla, una cosa: abrir el navegador compartido cierra la app, y con el
navegador en marcha el catálogo pide cerrarlo primero.

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
  index.js       Express: estáticos, /api/config, /api/rooms/:code/session, /api/admin/usage
  security.js    Cabeceras, límites por IP y antiflood de sockets
  brand.js       Marca blanca: HTML, manifest e iconos PNG dibujados con el color
  access.js      Códigos de acceso por cliente
  usage.js       Registro de minutos de máquina por cliente
  hyperbeam.js   Cliente REST de Hyperbeam
  giphy.js       Búsqueda de GIFs, para que la clave no salga del servidor
  youtube.js     Búsqueda de vídeos vía la API de la web de YouTube (sin clave)
  games.js       Las reglas de los juegos: ajedrez, damas, cuatro y tres en raya
  rooms.js       Salas: presencia, chat, roles, apps, moderación y WebSocket
public/
  css/           reset · tokens (colores, materiales, muelles) · app
  js/
    core/        dom · icons (SVG) · api · party (socket) · store
    apps.js      Catálogo y vistas: YouTube sincronizado, Twitch, Netflix, tableros
    main.js      La sala entera
test/            Pruebas (npm test): salas, servidor, marca, acceso y apagado
extension/       Extensión de navegador: vincula la pestaña de Netflix a la sala
```

---

## Notas

- Las claves `sk_test_` tienen minutos limitados: cierra el navegador compartido
  desde ⚙ cuando terminéis.
- El chat vive en memoria del servidor (los últimos 120 mensajes). Si reinicias
  el servidor, se vacía. Tu nombre y tu volumen sí se guardan en tu navegador.
- Hace falta salida a `engine.hyperbeam.com` y a los servidores WebRTC de
  Hyperbeam. Si tu red los bloquea, la sala te muestra el error exacto.
