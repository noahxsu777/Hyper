# Hyper

Un sistema operativo estilo iOS completo dentro del navegador, con una **sala de
Hyperbeam** real: un Chromium alojado en la nube que se transmite por WebRTC a la
pantalla, con chat, llamada y teclado remoto.

No usa ningún framework ni paso de compilación: HTML, CSS y módulos ES nativos,
servidos por un Express mínimo cuya única responsabilidad extra es guardar la
clave de API de Hyperbeam fuera del navegador.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # y pon tu clave en HYPERBEAM_API_KEY
npm start                 # http://localhost:3000
```

El sistema arranca aunque no haya clave configurada: todas las apps funcionan y
la Sala explica exactamente qué falta.

### Variables de entorno

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `HYPERBEAM_API_KEY` | — | Clave de tu panel de Hyperbeam. **Obligatoria** para el navegador virtual. |
| `HYPERBEAM_API_URL` | `https://engine.hyperbeam.com/v0` | Base de la API REST. |
| `HB_WIDTH` / `HB_HEIGHT` | `720` / `1280` | Resolución del ordenador virtual (vertical, para que encaje en el teléfono). |
| `HB_START_URL` | `https://www.google.com` | Página inicial de la sala. |
| `HB_OFFLINE_TIMEOUT` | `60` | Segundos sin clientes conectados antes de que la VM se apague sola. |
| `PORT` | `3000` | Puerto del servidor. |

---

## La Sala (Hyperbeam)

Es la pantalla principal, y reproduce la sala de Hyperbeam: navegador arriba,
panel de tres pestañas abajo.

- **Abrir un navegador nuevo** arranca un ordenador virtual y lo transmite.
- **Chat** — mensajes de la sala, guardados en el dispositivo.
- **Llamada** — participantes y silenciar micrófono.
- **Teclado** — lo que escribas se envía al navegador remoto con `hb.sendEvent()`,
  incluidas teclas especiales (Intro, Borrar, Tab, flechas).
- **⚙** abre una hoja con el estado de la sesión, la resolución y el botón para
  terminar la VM.
- **👤+** copia el enlace de la sala al portapapeles.

Una vez abierto el navegador aparece la barra de direcciones: escribe un dominio
para navegar o cualquier otra cosa para buscar en Google. Atrás, adelante y
recargar hablan con `hb.tabs`, la misma forma que la API de extensiones de Chrome.

### Cómo viaja la clave

```
navegador  ──POST /api/session──▶  servidor  ──Authorization: Bearer <clave>──▶  engine.hyperbeam.com/v0/vm
navegador  ◀────{ embedUrl }─────  servidor  ◀──{ session_id, embed_url, admin_token }──
```

La clave y el `admin_token` **nunca** salen del proceso de Node. El navegador solo
recibe el `embed_url`, que ya está limitado a una única sesión.

Todos los visitantes comparten un mismo ordenador virtual: es lo que hace que la
sala sea una sala, y evita gastar minutos abriendo una VM por pestaña. Al parar el
servidor con Ctrl-C la sesión se termina en Hyperbeam.

---

## Lo que trae el sistema

**Shell**

- Arranque, pantalla de bloqueo con reloj, widgets y notificaciones
- Deslizar hacia arriba para desbloquear y para cerrar apps (arrastre interactivo)
- Springboard con páginas, widget de reloj, indicadores de página y dock
- Centro de control: conectividad, brillo, volumen, linterna, atajos
- Spotlight (desliza hacia abajo en el inicio): busca apps, notas y chats
- Dynamic Island, barra de estado con batería real, banners de notificación
- Aspecto claro y oscuro, seis fondos, reducir movimiento

**Apps** — todas funcionales, no maquetas:

| App | Qué hace de verdad |
| --- | --- |
| Sala | Navegador virtual de Hyperbeam + chat + llamada + teclado remoto |
| Mensajes | Conversaciones persistidas, indicador de escritura, respuestas |
| Mail | Bandeja con leídos/no leídos y vista de lectura |
| Fotos | Biblioteca, álbumes, favoritos y visor |
| Calendario | Rejilla mensual real, navegación y eventos por día |
| Notas | Crear, editar, buscar y borrar, guardado en el dispositivo |
| Recordatorios | Lista de tareas con completar y eliminar |
| Reloj | Reloj mundial, alarmas, cronómetro con vueltas, temporizador |
| Tiempo | Previsión por horas y 7 días, con métricas |
| Música | Reproductor simulado con progreso, scrub y biblioteca |
| Calculadora | Aritmética completa con la lógica y el teclado de iOS |
| App Store | Escaparate de las apps del dispositivo |
| Teléfono | Teclado, recientes, contactos y llamada con duración |
| Ajustes | Aspecto, fondo, accesibilidad y control de la sesión de Hyperbeam |

Los datos (notas, chats, recordatorios, preferencias) se guardan en
`localStorage` bajo la clave `hyper-ios:v1`. Ajustes → General → Restablecer los
borra.

### Atajos de teclado

`Esc` vuelve al inicio · `Espacio` o `Intro` desbloquean · `⌘L` bloquea.

---

## Estructura

```
server/
  index.js        Express: estáticos, /api/config, /api/session
  hyperbeam.js    Cliente REST de Hyperbeam
public/
  css/            reset · tokens (colores, materiales, muelles) · shell · apps
  js/
    core/         dom · icons (SVG) · store (estado persistido) · gestures · api
    ui/           statusbar · lockscreen · springboard · controlcenter · spotlight · kit
    apps/         una app por archivo + registry.js
    os.js         máquina de estados, ciclo de vida de apps, UI del sistema
    main.js       arranque y gestos globales
```

Para añadir una app: crea `public/js/apps/loquesea.js` exportando
`{ id, name, icon, gradient, mount(root, ctx) }` y añádela a `registry.js`. El
`ctx` te da `close()`, `toast()`, `island()` y `openApp()`.

---

## Notas

- Las claves `sk_test_` tienen minutos limitados. Termina la sesión desde
  Ajustes → Hyperbeam o desde la ⚙ de la Sala cuando acabes.
- No hay ninguna imagen en el proyecto: fondos, fotos y carátulas son degradados
  generados, así que todo el sistema es un único paquete autocontenido.
- El navegador virtual necesita salida a `engine.hyperbeam.com` y a los servidores
  WebRTC de Hyperbeam. Si tu red los bloquea, la Sala te lo dirá con el error exacto.
