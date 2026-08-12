/**
 * Watch Party.
 *
 * Everyone in the room looks at the same Chromium — a virtual computer running
 * on Hyperbeam, streamed here over WebRTC — while presence and chat travel over
 * our own WebSocket. Open a film in the shared browser and it plays for the
 * whole room at once, because there is only one browser.
 */

import { $, clamp, fill, h } from "./core/dom.js"
import { icon } from "./core/icons.js"
import { api, normalizeCode, prettyHost, setRoomToken, toUrl } from "./core/api.js"
import { connectParty } from "./core/party.js"
import { colourFor, initialsFor, set, state } from "./core/store.js"
import { initApps, openAppsGallery, renderActivity, setAppVolume, showCue } from "./apps.js"

/* --------------------------------------------------------------------------
   Where films live. The DRM ones are flagged honestly further down.
   -------------------------------------------------------------------------- */

const SERVICES = [
  { label: "YouTube", url: "https://www.youtube.com", mark: "▶", tone: "#ff0033" },
  { label: "Twitch", url: "https://www.twitch.tv", mark: "T", tone: "#9146ff" },
  { label: "Archive", url: "https://archive.org/details/feature_films", mark: "A", tone: "#3b7dd8" },
  { label: "Vimeo", url: "https://vimeo.com", mark: "V", tone: "#17d5ff" },
  { label: "Plex", url: "https://watch.plex.tv", mark: "P", tone: "#e5a00d" },
  { label: "Netflix", url: "https://www.netflix.com", mark: "N", tone: "#e50914", drm: true },
  { label: "Prime Video", url: "https://www.primevideo.com", mark: "P", tone: "#00a8e1", drm: true },
  { label: "Disney+", url: "https://www.disneyplus.com", mark: "D", tone: "#113ccf", drm: true },
]

/* --------------------------------------------------------------------------
   App state
   -------------------------------------------------------------------------- */

const els = {
  app: $("#app"),
  topbar: $("#topbar"),
  stage: $("#stage"),
  screen: $("#screen"),
  mount: $("#screenMount"),
  badge: $("#screenBadge"),
  overlay: $("#screenOverlay"),
  controls: $("#controls"),
  panel: $("#panel"),
  sheets: $("#sheets"),
  toasts: $("#toasts"),
  lobby: $("#lobby"),
}

const room = {
  config: null,
  socket: null,
  status: "connecting",
  you: null,
  viewers: [],
  messages: [],
  tab: "chat",
  hb: null,
  starting: false,
  currentUrl: "",
  /** Stickers the server allows, delivered on join. */
  stickers: [],
  /** Chat commands the server understands, delivered on join. */
  commands: [],
  /** Which room we are in. */
  code: null,
  locked: false,
  /** Who runs the room, and what we are allowed to do in it. */
  ownerId: null,
  role: "guest",
  /** What proves that role to the HTTP routes. */
  token: null,
  /** The film's own volume, shared by the whole room. */
  audio: { volume: 100, muted: false },
  /** Last state the Hyperbeam stream reported. */
  connection: "idle",
  /** What the screen shows instead of the browser: app, game, or nothing. */
  activity: null,
}

const isOwner = () => room.role === "owner"
/** Owners and moderators drive the film and remove people. */
const canModerate = () => room.role === "owner" || room.role === "moderator"

/* The apps live inside the screen: same rectangle as the shared browser. */
const appHost = h("div.appview", { hidden: true })
const cueLayer = h("div.cue-layer", { hidden: true })
els.screen.append(appHost, cueLayer)

initApps({
  container: appHost,
  cueLayer,
  send: (payload) => room.socket?.app(payload),
  canModerate,
  you: () => room.you,
  code: () => room.code,
  token: () => room.token,
  sheet: (build) => sheet(build),
  toast: (options) => toast(options),
  browserLive: () => Boolean(room.hb || room.starting),
})

/** An app owns the screen, or gives it back to the idle overlay. */
function renderActivityView() {
  renderActivity(room.activity)
  // The controls bar swaps shape with the screen's owner (browser vs app).
  renderControls()
  if (room.activity) {
    els.overlay.hidden = true
    els.badge.hidden = true
  } else if (!room.hb && !room.starting) {
    showIdle()
  }
}

const ROLE_LABEL = { owner: "Anfitrión", moderator: "Moderador", guest: "Invitado" }

/* --------------------------------------------------------------------------
   System UI
   -------------------------------------------------------------------------- */

function toast({ title, text, glyph = "info", color = "var(--accent)", duration = 3600 } = {}) {
  const node = h(
    "div.toast",
    null,
    h("div.toast__icon", { style: { background: color }, html: icon(glyph, { size: 16 }) }),
    h(
      "div",
      { style: { minWidth: 0 } },
      title && h("div.toast__title", { text: title }),
      text && h("div.toast__text", { text }),
    ),
  )
  els.toasts.append(node)
  const dismiss = () => {
    if (!node.isConnected) return
    node.dataset.closing = "true"
    setTimeout(() => node.remove(), 220)
  }
  setTimeout(dismiss, duration)
  return dismiss
}

/** Modal sheet. `build(close)` returns the card's children. */
function sheet(build, { dismissable = true } = {}) {
  const backdrop = h("div.sheet")
  const close = () => backdrop.remove()
  const card = h("div.sheet__card")
  backdrop.append(card)
  if (dismissable) {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close()
    })
  }
  fill(card, build(close))
  els.sheets.append(backdrop)
  return close
}

/* --------------------------------------------------------------------------
   Top bar
   -------------------------------------------------------------------------- */

function renderTopbar() {
  const live = room.hb ? "true" : room.starting ? "connecting" : "false"
  const statusText = room.hb
    ? "Navegador compartido en marcha"
    : room.status === "connected"
      ? "Listo para empezar"
      : room.status === "reconnecting"
        ? "Reconectando…"
        : "Conectando…"

  const count = room.viewers.length
  const faces = room.viewers.slice(0, 4).map((viewer) =>
    h("span", {
      text: initialsFor(viewer.name),
      title: viewer.name,
      style: { background: colourFor(viewer.id + viewer.name) },
    }),
  )
  if (count > 4) {
    faces.push(h("span", { text: `+${count - 4}`, style: { background: "var(--fill)" } }))
  }

  fill(
    els.topbar,
    h("div.topbar__mark", { html: icon("play", { size: 17 }) }),
    h(
      "div.topbar__titles",
      null,
      h(
        "div.topbar__name",
        null,
        h("span", { text: "Sala " }),
        h("span.topbar__code", { text: room.code ?? "" }),
        room.locked ? h("span", { html: icon("lock", { size: 13 }), title: "Sala cerrada" }) : null,
      ),
      h(
        "div.topbar__sub",
        null,
        h("span.dot", { dataset: { live } }),
        h("span", { text: `${statusText} · ${count} ${count === 1 ? "persona" : "personas"}` }),
        h("span.tag", {
          dataset: { tone: isOwner() ? "ok" : room.role === "moderator" ? "accent" : "" },
          text: ROLE_LABEL[room.role],
        }),
      ),
    ),
    h("div.faces", null, ...faces),
    h("button.pill-btn", {
      type: "button",
      html: `${icon("share", { size: 16 })}<span>Invitar</span>`,
      onClick: invite,
    }),
    h("button.icon-btn", {
      type: "button",
      "aria-label": "Ajustes de la sala",
      html: icon("gear", { size: 19 }),
      onClick: openSettings,
    }),
  )
}

function roomUrl() {
  return `${location.origin}/${room.code ?? ""}`
}

function invite() {
  const url = roomUrl()
  sheet((close) => [
    h("div.sheet__title", { text: "Invita a la sala" }),
    h("div.sheet__text", { text: "Comparte el código, o el enlace directo." }),
    h("div.code-display", { text: room.code ?? "—" }),
    h("input.field", {
      value: url,
      readonly: true,
      onFocus: (event) => event.target.select(),
    }),
    h("button.btn", {
      type: "button",
      text: "Copiar enlace",
      onClick: () => {
        navigator.clipboard
          ?.writeText(url)
          .then(() => {
            close()
            toast({ title: "Enlace copiado", text: url, glyph: "share" })
          })
          .catch(() => toast({ title: "Copia el enlace a mano", text: url }))
      },
    }),
    room.locked
      ? h("div.sheet__text", {
          text: "Ojo: la sala está cerrada, así que nadie nuevo podrá entrar aunque tenga el enlace.",
        })
      : null,
    h("button.btn", { type: "button", dataset: { tone: "quiet" }, text: "Cerrar", onClick: close }),
  ])
}

/* --------------------------------------------------------------------------
   Stage
   -------------------------------------------------------------------------- */

function showOverlay(nodes) {
  els.overlay.hidden = false
  fill(els.overlay, h("div.overlay__inner", null, ...nodes.filter(Boolean)))
}

function servicesGrid() {
  return h(
    "div.services",
    null,
    ...SERVICES.map((service) =>
      h(
        "button.service",
        {
          type: "button",
          title: service.drm ? `${service.label} — usa DRM, puede no reproducir` : service.label,
          onClick: () => (room.hb ? navigate(service.url) : start(service.url)),
        },
        h("span.service__dot", { text: service.mark, style: { background: service.tone } }),
        h("span", { text: service.label }),
      ),
    ),
  )
}

function showIdle(note) {
  // An app has the screen: the idle overlay must not paint over the game.
  if (room.activity) {
    els.overlay.hidden = true
    return
  }
  const configured = room.config?.configured

  // A guest has nothing to press here: the room's owner decides what goes on.
  if (!canModerate()) {
    const ownerName = room.viewers.find((viewer) => viewer.id === room.ownerId)?.name
    showOverlay([
      h("h1.overlay__title", { text: "Esperando a que empiece" }),
      h("p.overlay__note", {
        text: note
          ? note
          : ownerName
            ? `${ownerName} lleva la sala. En cuanto ponga algo, lo verás aquí.`
            : "En cuanto alguien ponga algo, lo verás aquí.",
      }),
      h("div.spinner"),
    ])
    return
  }

  showOverlay([
    h("h1.overlay__title", { text: "¿Qué vemos hoy?" }),
    h("p.overlay__note", {
      text:
        note ??
        "Abre el navegador compartido: todos veréis exactamente la misma pantalla, al mismo tiempo.",
    }),
    h("button.overlay__cta", {
      type: "button",
      disabled: !configured,
      html: `${icon("power", { size: 21 })}<span>Abrir el navegador compartido</span>`,
      onClick: () => start(),
    }),
    // The other road: synced YouTube, Twitch, cues and games. No Hyperbeam
    // minutes involved, so it works even when the key above is missing.
    h("button.overlay__apps", {
      type: "button",
      html: `${icon("apps", { size: 19 })}<span>Apps de la sala — vídeo y juegos</span>`,
      onClick: openAppsGallery,
    }),
    // `text`, not `html`: the message can carry an upstream API response, and
    // that is not ours to trust as markup.
    !configured
      ? h("p.overlay__note", {
          text: room.config?.error ?? "Falta la clave HYPERBEAM_API_KEY en el servidor.",
        })
      : null,
    configured && canModerate() ? servicesGrid() : null,
    configured
      ? h("p.overlay__note", {
          style: { fontSize: "12.5px" },
          text: "Netflix, Prime Video y Disney+ usan DRM y puede que no reproduzcan en un navegador virtual. YouTube, Twitch, Vimeo y Archive.org funcionan.",
        })
      : null,
  ])
}

function showLoading(text) {
  showOverlay([h("div.spinner"), h("p.overlay__note", { text })])
}

function showError(error) {
  showOverlay([
    h("h1.overlay__title", { text: "No se pudo abrir" }),
    h("p.overlay__note", { text: error.message }),
    h("button.overlay__cta", {
      type: "button",
      html: `${icon("reload", { size: 21 })}<span>Reintentar</span>`,
      onClick: () => start(),
    }),
  ])
}

/* --------------------------------------------------------------------------
   Controls
   -------------------------------------------------------------------------- */

const addressInput = h("input", {
  type: "text",
  placeholder: "Pega un enlace o busca algo",
  autocomplete: "off",
  autocapitalize: "off",
  spellcheck: "false",
  "aria-label": "Dirección",
})

/** Most players answer to the same keys, so this is our transport bar. */
function tapKey(key) {
  if (!room.hb || !canModerate()) return
  room.hb.sendEvent({ type: "keydown", key })
  room.hb.sendEvent({ type: "keyup", key })
}

/* --------------------------------------------------------------------------
   Volume: yours alone, and the room's
   -------------------------------------------------------------------------- */

const volumePopover = h("div.popover.popover--volume", { hidden: true })

/**
 * Push the room's volume towards `target`.
 *
 * There is no API for the volume inside the virtual browser, so this nudges the
 * player with the arrow keys, which move in 5% steps on YouTube, Twitch and
 * Vimeo. Only the viewer who moved the control sends the keys — everyone else
 * just updates their slider, or the volume would move once per person.
 */
function driveRoomVolume(target) {
  const steps = Math.round((target - room.audio.volume) / 5)
  const key = steps > 0 ? "ArrowUp" : "ArrowDown"
  for (let i = 0; i < Math.abs(steps); i++) tapKey(key)
}

/** Muting the tab is exact: Chromium's own tabs API does it for the whole room. */
function driveRoomMute(muted) {
  room.hb?.tabs.update({ muted }).catch((error) => {
    console.warn("[party] no se pudo silenciar la pestaña", error)
    toast({
      title: "No se pudo silenciar",
      text: "El navegador compartido no aceptó la orden.",
      color: "var(--orange)",
    })
  })
}

function renderVolumePopover() {
  const line = ({ label, note, value, muted, disabled, onValue, onMute }) => {
    const readout = h("span.vol__value", { text: muted ? "—" : `${Math.round(value)}%` })
    return h(
      "div.vol__row",
      null,
      h("div.vol__label", { text: label }),
      h(
        "div.vol__line",
        null,
        h("button.vol__mute", {
          type: "button",
          "aria-label": muted ? "Activar sonido" : "Silenciar",
          dataset: { on: String(muted) },
          disabled,
          html: icon(muted ? "speaker-off" : "speaker", { size: 17 }),
          onClick: () => onMute(!muted),
        }),
        h("input", {
          type: "range",
          min: "0",
          max: "100",
          value: String(Math.round(value)),
          "aria-label": label,
          disabled,
          onInput: (event) => {
            const next = Number(event.target.value)
            readout.textContent = `${next}%`
            onValue(next)
          },
        }),
        readout,
      ),
      note ? h("p.vol__note", { text: note }) : null,
    )
  }

  fill(
    volumePopover,
    h(
      "div.popover__head",
      null,
      h("span", { text: "Volumen" }),
      h("button.popover__close", {
        type: "button",
        "aria-label": "Cerrar",
        html: icon("x", { size: 15 }),
        onClick: closeVolume,
      }),
    ),
    line({
      label: "Solo para ti",
      note: "Nadie más lo nota.",
      value: state.volume * 100,
      muted: state.muted,
      onValue: (next) => {
        set({ volume: next / 100, muted: false })
        applyVolume()
        renderControls()
      },
      onMute: (next) => {
        set({ muted: next })
        applyVolume()
        renderVolumePopover()
        renderControls()
      },
    }),
    line({
      label: "Para toda la sala",
      note: !canModerate()
        ? "Solo quien lleva la sala puede cambiarlo."
        : room.hb
          ? "Cambia el volumen de la película para todos. Funciona en YouTube, Twitch y Vimeo."
          : "Disponible cuando el navegador compartido esté abierto.",
      value: room.audio.volume,
      muted: room.audio.muted,
      disabled: !room.hb || !canModerate(),
      onValue: (next) => {
        driveRoomVolume(next)
        room.audio.volume = next
        room.socket?.audio({ volume: next })
      },
      onMute: (next) => {
        driveRoomMute(next)
        room.audio.muted = next
        room.socket?.audio({ muted: next })
        renderVolumePopover()
        renderControls()
      },
    }),
  )
}

function openVolume() {
  renderVolumePopover()
  volumePopover.hidden = false
  renderControls()
}

function closeVolume() {
  volumePopover.hidden = true
  renderControls()
}

function toggleVolume() {
  if (volumePopover.hidden) openVolume()
  else closeVolume()
}

function renderControls() {
  // Anything that drives the shared browser needs both a browser to drive and
  // the right to drive it. The bar itself stays put either way, so a guest can
  // still reach their own volume, theatre mode and fullscreen.
  const live = Boolean(room.hb) && canModerate()

  const ctrl = (glyph, label, onClick, options = {}) =>
    h("button.ctrl", {
      type: "button",
      "aria-label": label,
      title: options.title ?? label,
      dataset: options.dataset ?? {},
      disabled: options.needsBrowser !== false && !live,
      html: options.text
        ? `${icon(glyph, { size: 19 })}<span>${options.text}</span>`
        : icon(glyph, { size: 19 }),
      onClick,
    })

  addressInput.disabled = !live

  // With an app on the screen, the browser-only controls are dead weight —
  // CSS hides them and hands the row back to the picture. And when anything
  // is actually showing, the phone gives the screen more height.
  els.controls.dataset.app = String(Boolean(room.activity))
  els.app.dataset.live = String(Boolean(room.hb || room.activity || room.starting))

  fill(
    els.controls,
    h(
      "div.controls__group",
      null,
      ctrl("backward", "Retroceder", () => tapKey("ArrowLeft"), { title: "Retroceder (←)" }),
      ctrl("play", "Reproducir o pausar", () => tapKey(" "), {
        dataset: { primary: "true" },
        title: "Reproducir / pausar (espacio)",
      }),
      ctrl("forward", "Avanzar", () => tapKey("ArrowRight"), { title: "Avanzar (→)" }),
    ),
    canModerate()
      ? h(
          "div.address",
          null,
          h("span", { html: icon("search", { size: 15 }) }),
          addressInput,
        )
      : h("div.address.address--readonly", null, h("span", {
          text: room.hb ? prettyHost(room.currentUrl) : "Esperando a la sala…",
        })),
    h(
      "div.controls__group",
      null,
      ctrl(
        "apps",
        "Apps de la sala",
        () =>
          canModerate()
            ? openAppsGallery()
            : toast({ title: "Apps", text: "Quien lleva la sala elige qué se abre.", glyph: "apps" }),
        {
          needsBrowser: false,
          title: "Apps — vídeo sincronizado y juegos",
          dataset: { on: String(Boolean(room.activity)) },
        },
      ),
      ctrl("reload", "Recargar", () => room.hb?.tabs.reload()),
      ctrl(
        state.muted || room.audio.muted ? "speaker-off" : "speaker",
        "Volumen",
        toggleVolume,
        {
          dataset: { on: String(!volumePopover.hidden) },
          title: "Volumen — el tuyo y el de la sala",
          needsBrowser: false,
        },
      ),
      ctrl("screen", "Modo cine", toggleTheatre, {
        dataset: { on: String(els.app.dataset.theatre === "true") },
        title: "Modo cine — oculta el chat",
        needsBrowser: false,
      }),
      ctrl("expand", "Pantalla completa", toggleFullscreen, {
        title: "Pantalla completa de la ventana",
        needsBrowser: false,
      }),
    ),
  )
}

function applyVolume() {
  if (room.hb) room.hb.volume = state.muted ? 0 : state.volume
  // The apps' players follow the same personal volume.
  setAppVolume(state.muted ? 0 : state.volume)
}

function toggleTheatre() {
  const next = els.app.dataset.theatre !== "true"
  els.app.dataset.theatre = String(next)
  set({ theatre: next })
  renderControls()
  // The stream should follow the new size, not stay letterboxed.
  setTimeout(fitToScreen, 260)
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await els.app.requestFullscreen()
  } catch (error) {
    toast({ title: "Pantalla completa", text: String(error.message ?? error), glyph: "info" })
  }
}

/**
 * "Solo el vídeo": the bar, the chat and the transport controls step out of
 * the way, and the picture claims the whole fullscreen surface. What used to
 * be "pantalla completa" only fullscreened the app shell — the browser then
 * dutifully filled the screen with our chrome around a small video.
 */
function applyFullscreenState() {
  const active = document.fullscreenElement === els.app
  els.app.dataset.fullscreen = String(active)

  const orientation = screen.orientation
  if (active) {
    // Most of what plays here is landscape video; a phone held upright would
    // otherwise fullscreen into a portrait rectangle with the same wasted
    // space this button exists to remove. Not fatal if it fails or is
    // unsupported — a vertical video, or a browser without the API, is still
    // a working fullscreen, just not auto-rotated.
    orientation?.lock?.("landscape").catch(() => {})
  } else {
    orientation?.unlock?.()
  }
  // The resolution Hyperbeam renders at should match the surface it now
  // fills — the whole device screen, not the inline card.
  setTimeout(fitToScreen, active ? 350 : 200)
}

const exitFullscreenButton = h("button.screen__exit-fullscreen", {
  type: "button",
  "aria-label": "Salir de pantalla completa",
  html: icon("collapse", { size: 17 }),
  onClick: () => document.exitFullscreen().catch(() => {}),
})
els.screen.append(exitFullscreenButton)

/* --------------------------------------------------------------------------
   Panel: chat and people
   -------------------------------------------------------------------------- */

const composerField = h("textarea", {
  rows: "1",
  placeholder: "Escribe un mensaje",
  "aria-label": "Mensaje",
})

const composerSend = h("button.composer__send", {
  type: "button",
  disabled: true,
  "aria-label": "Enviar",
  html: icon("send", { size: 17, stroke: 1.9 }),
})

/* ---- stickers ------------------------------------------------------------ */

const stickerPicker = h("div.popover.popover--stickers", { hidden: true })

const stickerButton = h("button.composer__chip.composer__sticker", {
  type: "button",
  "aria-label": "Stickers",
  text: "🙂",
  onClick: () => toggleStickers(),
})

function renderStickerPicker() {
  fill(
    stickerPicker,
    h(
      "div.popover__head",
      null,
      h("span", { text: "Stickers" }),
      h("button.popover__close", {
        type: "button",
        "aria-label": "Cerrar",
        html: icon("x", { size: 15 }),
        onClick: closeStickers,
      }),
    ),
    room.stickers.length
      ? h(
          "div.sticker-grid",
          null,
          ...room.stickers.map((sticker) =>
            h("button", {
              type: "button",
              text: sticker.char,
              title: sticker.id,
              "aria-label": `Enviar sticker ${sticker.id}`,
              onClick: () => {
                room.socket?.sticker(sticker.id)
                closeStickers()
              },
            }),
          ),
        )
      : h("p.vol__note", { text: "Conectando con la sala…" }),
    room.commands.length
      ? h("p.vol__note", {
          text: `Escribe ${room.commands.map((c) => c.command).join(" o ")} en el chat para lanzar una animación.`,
        })
      : null,
  )
}

/* ---- GIFs ---------------------------------------------------------------- */

const gifPicker = h("div.popover.popover--gifs", { hidden: true })
const gifGrid = h("div.gif-grid")
const gifSearch = h("input.field.field--search", {
  type: "search",
  placeholder: "Buscar un GIF",
  autocomplete: "off",
})

let gifQuery = ""
let gifRequest = 0

async function loadGifs(query) {
  const ticket = ++gifRequest
  fill(gifGrid, h("div.gif-grid__note", null, h("div.spinner"), h("span", { text: "Buscando…" })))
  try {
    const { gifs } = await api.gifs(query)
    // A slower earlier search must not overwrite a newer one.
    if (ticket !== gifRequest) return
    if (!gifs.length) {
      fill(gifGrid, h("div.gif-grid__note", { text: "Nada por aquí. Prueba con otra palabra." }))
      return
    }
    fill(
      gifGrid,
      ...gifs.map((gif) =>
        h("button", {
          type: "button",
          "aria-label": gif.title,
          title: gif.title,
          // Reserve the right shape so the grid does not jump as they load.
          style: { aspectRatio: `${gif.width} / ${gif.height}` },
          onClick: () => {
            room.socket?.gif(gif)
            closeGifs()
          },
        },
        h("img", { src: gif.url, alt: "", loading: "lazy" })),
      ),
    )
  } catch (error) {
    if (ticket !== gifRequest) return
    fill(gifGrid, h("div.gif-grid__note", { text: error.message }))
  }
}

let gifDebounce = null
gifSearch.addEventListener("input", () => {
  const value = gifSearch.value.trim()
  clearTimeout(gifDebounce)
  gifDebounce = setTimeout(() => {
    gifQuery = value
    loadGifs(gifQuery)
  }, 350)
})

fill(
  gifPicker,
  h(
    "div.popover__head",
    null,
    h("span", { text: "GIFs" }),
    h("button.popover__close", {
      type: "button",
      "aria-label": "Cerrar",
      html: icon("x", { size: 15 }),
      onClick: () => closeGifs(),
    }),
  ),
  gifSearch,
  gifGrid,
  // GIPHY asks for this wherever their results are shown.
  h("p.gif-grid__credit", { text: "Powered by GIPHY" }),
)

const gifButton = h("button.composer__chip.composer__gif", {
  type: "button",
  "aria-label": "GIFs",
  text: "GIF",
  onClick: () => toggleGifs(),
})

function openGifs() {
  closeStickers()
  gifPicker.hidden = false
  gifButton.dataset.on = "true"
  loadGifs(gifQuery)
  setTimeout(() => gifSearch.focus({ preventScroll: true }), 80)
}

function closeGifs() {
  gifPicker.hidden = true
  delete gifButton.dataset.on
}

function toggleGifs() {
  if (gifPicker.hidden) openGifs()
  else closeGifs()
}

function openStickers() {
  closeGifs()
  renderStickerPicker()
  stickerPicker.hidden = false
  stickerButton.dataset.on = "true"
}

function closeStickers() {
  stickerPicker.hidden = true
  delete stickerButton.dataset.on
}

function toggleStickers() {
  if (stickerPicker.hidden) openStickers()
  else closeStickers()
}

const panelBody = h("div.panel__body")

/* ---- chat effects (!love and friends) ------------------------------------ */

const effectLayer = h("div.effects", { "aria-hidden": "true" })
let effectTimer = null

/**
 * Play an animation over the chat and take it away again.
 *
 * The animation is a third-party embed, so it goes in a sandboxed iframe: it
 * may run its own scripts, but it cannot navigate us or reach into the page.
 */
function playEffect({ url, kind = "lottie", duration = 5000, by }) {
  if (!url) return
  clearTimeout(effectTimer)

  const media =
    kind === "image"
      ? h("img.effects__image", {
          src: url,
          alt: "",
          referrerpolicy: "no-referrer",
          // A hotlink-blocked or wrong URL should vanish, not sit there broken.
          onError: (event) => event.currentTarget.remove(),
        })
      : h("iframe", {
          src: url,
          title: "Animación",
          loading: "eager",
          referrerpolicy: "no-referrer",
          sandbox: "allow-scripts allow-same-origin",
          allowtransparency: "true",
        })

  fill(
    effectLayer,
    h("div.effects__stage", null, media, by ? h("div.effects__by", { text: by }) : null),
  )
  effectLayer.dataset.on = "true"

  effectTimer = setTimeout(() => {
    effectLayer.dataset.on = "false"
    // Let the fade finish before dropping the iframe, or it blinks out.
    setTimeout(() => {
      if (effectLayer.dataset.on !== "true") fill(effectLayer)
    }, 400)
  }, duration)
}

function sendChat() {
  const text = composerField.value.trim()
  if (!text) return
  room.socket?.chat(text)
  composerField.value = ""
  composerField.style.height = "auto"
  composerSend.disabled = true
}

composerField.addEventListener("input", () => {
  composerSend.disabled = !composerField.value.trim()
  composerField.style.height = "auto"
  composerField.style.height = `${Math.min(110, composerField.scrollHeight)}px`
})
composerField.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    sendChat()
  }
})
composerSend.addEventListener("click", sendChat)

const composer = h(
  "div.composer",
  null,
  stickerPicker,
  gifPicker,
  stickerButton,
  gifButton,
  composerField,
  composerSend,
)

function renderPanel() {
  const segmented = h(
    "div.segmented",
    null,
    ...[
      { id: "chat", label: "Chat" },
      { id: "people", label: `Gente (${room.viewers.length})` },
    ].map((item) =>
      h("button", {
        type: "button",
        text: item.label,
        dataset: { active: String(item.id === room.tab) },
        onClick: () => {
          room.tab = item.id
          renderPanel()
        },
      }),
    ),
  )

  fill(els.panel, segmented, panelBody, effectLayer, composer)
  composer.hidden = room.tab !== "chat"
  renderPanelBody()
}

function renderPanelBody() {
  if (room.tab === "people") {
    fill(
      panelBody,
      ...room.viewers.map((viewer) => {
        const isYou = viewer.id === room.you?.id
        const theirRole = viewer.role ?? "guest"

        // The owner appoints moderators; moderators and the owner remove guests.
        // Nobody can act on the owner, and a moderator cannot remove a peer.
        const mayPromote = isOwner() && !isYou && theirRole !== "owner"
        const mayKick =
          canModerate() &&
          !isYou &&
          theirRole !== "owner" &&
          !(room.role === "moderator" && theirRole === "moderator")

        return h(
          "div.person",
          null,
          h("span.person__avatar", {
            text: initialsFor(viewer.name),
            style: { background: colourFor(viewer.id + viewer.name) },
          }),
          h("span.person__name", { text: viewer.name }),
          theirRole !== "guest"
            ? h("span.tag", {
                dataset: { tone: theirRole === "owner" ? "ok" : "accent" },
                text: theirRole === "owner" ? "ANFITRIÓN" : "MOD",
              })
            : null,
          isYou ? h("span.tag", { dataset: { tone: "accent" }, text: "TÚ" }) : null,
          mayPromote
            ? h("button.person__act", {
                type: "button",
                title: theirRole === "moderator" ? "Quitar moderador" : "Hacer moderador",
                "aria-label": theirRole === "moderator" ? "Quitar moderador" : "Hacer moderador",
                dataset: { on: String(theirRole === "moderator") },
                html: icon("shield", { size: 15 }),
                onClick: () =>
                  room.socket?.setRole(viewer.id, theirRole === "moderator" ? "guest" : "moderator"),
              })
            : null,
          mayKick
            ? h("button.person__act", {
                type: "button",
                title: "Expulsar",
                "aria-label": `Expulsar a ${viewer.name}`,
                dataset: { tone: "danger" },
                html: icon("x", { size: 15 }),
                onClick: () => confirmKick(viewer),
              })
            : null,
        )
      }),
    )
    return
  }

  if (!room.messages.length) {
    fill(
      panelBody,
      h(
        "div.panel__empty",
        null,
        h("h3", { text: "Aún no hay mensajes" }),
        h("p", { text: "Comenta la película mientras la veis. Todos leen lo mismo, en directo." }),
      ),
    )
    return
  }

  const nearBottom = panelBody.scrollHeight - panelBody.scrollTop - panelBody.clientHeight < 80

  fill(
    panelBody,
    ...room.messages.map((message) => {
      if (message.kind === "system") {
        return h("div.msg.msg--system", null, h("div.msg__text", { text: message.text }))
      }
      const mine = message.viewerId && message.viewerId === room.you?.id
      return h(
        "div.msg",
        { class: mine ? "msg--mine" : "" },
        h("span.msg__avatar", {
          text: initialsFor(message.name),
          style: { background: colourFor((message.viewerId ?? "") + message.name) },
        }),
        h(
          "div.msg__body",
          null,
          h(
            "div.msg__head",
            null,
            h("span.msg__name", { text: mine ? "Tú" : message.name }),
            h("span.msg__time", {
              text: new Date(message.at).toLocaleTimeString("es-ES", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }),
          ),
          message.kind === "sticker"
            ? h("div.msg__sticker", { text: message.char })
            : message.kind === "gif"
              ? h("img.msg__gif", {
                  src: message.url,
                  alt: "GIF",
                  loading: "lazy",
                  width: message.width,
                  height: message.height,
                })
              : h("div.msg__text", { text: message.text }),
        ),
      )
    }),
  )

  if (nearBottom) panelBody.scrollTop = panelBody.scrollHeight
}

/** A dead end: kicked, refused, or a room that no longer exists. */
function showBlocked(title, text) {
  room.hb = null
  stopRoomsPoll()
  els.app.hidden = true
  fill(
    els.lobby,
    h(
      "div.lobby__card",
      null,
      h("h1.lobby__title", { text: title }),
      h("p.lobby__note", { text }),
      h("button.btn", {
        type: "button",
        text: "Volver al inicio",
        onClick: () => {
          history.replaceState(null, "", "/")
          location.reload()
        },
      }),
    ),
  )
  els.lobby.hidden = false
}

/** Removing someone is not undoable from here, so it asks first. */
function confirmKick(viewer) {
  sheet((close) => [
    h("div.sheet__title", { text: `¿Expulsar a ${viewer.name}?` }),
    h("div.sheet__text", {
      text: "Saldrá de la sala y no podrá volver a entrar con este navegador.",
    }),
    h("button.btn", {
      type: "button",
      dataset: { tone: "destructive" },
      text: "Expulsar",
      onClick: () => {
        room.socket?.kick(viewer.id)
        close()
      },
    }),
    h("button.btn", { type: "button", dataset: { tone: "quiet" }, text: "Cancelar", onClick: close }),
  ])
}

/* --------------------------------------------------------------------------
   Hyperbeam
   -------------------------------------------------------------------------- */

async function start(startUrl) {
  if (room.hb) {
    if (startUrl) navigate(startUrl)
    return
  }
  if (room.starting) return
  room.starting = true
  renderTopbar()
  showLoading("Arrancando el navegador compartido…")

  try {
    const [{ default: Hyperbeam }, session] = await Promise.all([
      import("/vendor/hyperbeam.js"),
      api.startSession(room.code, { startUrl }),
    ])
    await attach(Hyperbeam, session)
    if (startUrl) navigate(startUrl)
  } catch (error) {
    console.error("[party] no se pudo abrir el navegador", error)
    room.starting = false
    renderTopbar()
    showError(error)
  }
}

/** Connect to a session someone else already opened. */
async function join(session) {
  if (room.hb || room.starting) return
  room.starting = true
  renderTopbar()
  showLoading("Conectando con la sala…")
  try {
    const { default: Hyperbeam } = await import("/vendor/hyperbeam.js")
    await attach(Hyperbeam, session)
  } catch (error) {
    console.error("[party] no se pudo conectar", error)
    room.starting = false
    renderTopbar()
    showError(error)
  }
}

let stallTimer = null
let reattaching = false

/** The badge, with a way out for someone staring at a spinner. */
function showStalled(text) {
  els.badge.hidden = false
  fill(
    els.badge,
    h("span.spinner", { style: { width: "13px", height: "13px" } }),
    h("span", { text }),
    h("button.badge__retry", { type: "button", text: "Reintentar", onClick: () => reattach() }),
  )
}

/**
 * The virtual computer is gone for good. Tell the server so it stops handing
 * out a dead `embed_url` — otherwise everyone who tries to join, or comes back
 * later, gets a session that will never connect.
 *
 * Only whoever runs the room may do this, which is also who found out.
 */
function forgetDeadSession() {
  if (!canModerate() || !room.code) return
  api.endSession(room.code).catch((err) => {
    console.warn("[party] no se pudo limpiar la sesión terminada", err)
  })
}

/**
 * Tear the stream down and build it again from the session the server still
 * has. Coming back to a backgrounded tab often leaves the WebRTC connection
 * beyond saving, and no amount of waiting brings it round.
 */
async function reattach() {
  if (reattaching || !room.hb) return
  reattaching = true
  clearTimeout(stallTimer)
  showStalled("Reconectando…")

  try {
    try {
      room.hb.destroy()
    } catch {
      /* it was already gone */
    }
    room.hb = null
    els.mount.replaceChildren()

    const session = await api.getSession(room.code)
    if (!session) {
      renderTopbar()
      renderControls()
      showIdle("El navegador compartido se ha cerrado.")
      return
    }
    const { default: Hyperbeam } = await import("/vendor/hyperbeam.js")
    await attach(Hyperbeam, session)
  } catch (error) {
    console.error("[party] no se pudo recuperar el vídeo", error)
    showStalled("Sin conexión")
  } finally {
    reattaching = false
  }
}

async function attach(Hyperbeam, session) {
  showLoading("Conectando con el vídeo…")

  room.hb = await Hyperbeam(els.mount, session.embedUrl, {
    volume: state.muted ? 0 : state.volume,
    // We forward keys ourselves so typing in the chat never leaks into the film.
    delegateKeyboard: true,
    onDisconnect: (event) => {
      room.hb = null
      renderTopbar()
      renderControls()

      // "inactive" y "absolute" son la máquina virtual apagándose de verdad, no
      // un corte de red. El servidor todavía guarda la sesión muerta, y si no
      // se la quitamos, el siguiente intento se conecta a una URL que ya no
      // lleva a ninguna parte y la sala se queda dando vueltas.
      if (event?.type === "inactive" || event?.type === "absolute") {
        forgetDeadSession()
        showIdle(
          event.type === "absolute"
            ? "La sesión llegó a su duración máxima. Vuelve a abrirla para seguir."
            : "El navegador compartido se cerró por inactividad.",
        )
        return
      }
      showIdle("Se ha cerrado la conexión con el navegador compartido.")
    },
    onConnectionStateChange: ({ state: connection }) => {
      room.connection = connection
      if (connection === "playing") {
        clearTimeout(stallTimer)
        els.badge.hidden = true
        return
      }
      if (connection === "reconnecting") {
        showStalled("Reconectando…")
        // If it is still stuck after this, the stream is not coming back on its
        // own and a fresh attach is the only thing that will fix it.
        clearTimeout(stallTimer)
        stallTimer = setTimeout(reattach, 9000)
        return
      }
      if (connection === "failed") {
        showStalled("Se perdió la conexión")
        clearTimeout(stallTimer)
        stallTimer = setTimeout(reattach, 1500)
      }
    },
    onCloseWarning: (event) => {
      // Con el reloj de inactividad desactivado en el servidor esto ya no
      // debería saltar a media película. Si salta, el aviso dice cuánto queda
      // y qué hacer, en vez de limitarse a asustar.
      const seconds = Math.round((event?.deadline?.delay ?? 0) / 1000)
      const left = seconds > 90 ? `${Math.round(seconds / 60)} min` : `${seconds || "unos"} s`
      toast({
        title: "El navegador compartido se va a cerrar",
        text:
          event?.type === "absolute"
            ? `Llega a su duración máxima en ${left}. Ábrelo otra vez para seguir viendo.`
            : `Se cerrará en ${left} si nadie lo toca. Mueve el ratón sobre el vídeo para mantenerlo.`,
        glyph: "timer",
        color: "var(--orange)",
        duration: 8000,
      })
    },
  })

  // A guest watches: their clicks and keys never reach the shared browser.
  room.hb.disableInput = !canModerate()
  room.connection = "playing"
  clearTimeout(stallTimer)
  els.badge.hidden = true

  room.starting = false
  els.overlay.hidden = true
  renderTopbar()
  renderControls()
  applyVolume()
  // The room's volume controls only work with a browser attached.
  if (!volumePopover.hidden) renderVolumePopover()
  watchTabs()
  fitToScreen()
}

function watchTabs() {
  room.hb.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
    const url = changeInfo.url || tab?.url
    if (!url) return
    room.currentUrl = url
    if (document.activeElement !== addressInput) addressInput.value = prettyHost(url)
  })
  room.hb.tabs
    .query({ active: true })
    .then((tabs) => {
      const tab = tabs?.[0]
      if (!tab?.url) return
      room.currentUrl = tab.url
      addressInput.value = prettyHost(tab.url)
    })
    .catch(() => {})
}

/** Match the stream to the box so the picture is sharp and nothing is letterboxed. */
async function fitToScreen() {
  if (!room.hb) return
  const rect = els.screen.getBoundingClientRect()
  const ratio = clamp(window.devicePixelRatio || 1, 1, 2)
  let width = Math.round(rect.width * ratio)
  let height = Math.round(rect.height * ratio)

  const maxArea = room.hb.maxArea || width * height
  const area = width * height
  if (area > maxArea) {
    const shrink = Math.sqrt(maxArea / area)
    width = Math.floor(width * shrink)
    height = Math.floor(height * shrink)
  }
  try {
    await room.hb.resize(width, height)
  } catch (error) {
    console.warn("[party] resize rechazado", error)
  }
}

function navigate(input) {
  const url = toUrl(input)
  if (!url) return
  if (!room.hb) return start(url)
  els.overlay.hidden = true
  room.hb.tabs.update({ url }).catch((error) => {
    toast({ title: "No se pudo abrir", text: String(error.message ?? error), color: "var(--red)" })
  })
  addressInput.blur()
}

addressInput.addEventListener("focus", () => {
  addressInput.value = room.currentUrl
  requestAnimationFrame(() => addressInput.select())
})
addressInput.addEventListener("blur", () => {
  addressInput.value = prettyHost(room.currentUrl)
})
addressInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") navigate(addressInput.value)
  if (event.key === "Escape") addressInput.blur()
})

/* --------------------------------------------------------------------------
   Settings
   -------------------------------------------------------------------------- */

async function openSettings() {
  const close = sheet(() => [
    h("div.sheet__title", { text: "Ajustes de la sala" }),
    h("div.spinner"),
  ])
  close()

  const [config, session] = await Promise.all([
    api.config().catch(() => null),
    api.getSession(room.code).catch(() => null),
  ])

  sheet((dismiss) => {
    const nameField = h("input.field", {
      value: room.you?.name ?? state.name,
      maxlength: "24",
      "aria-label": "Tu nombre",
    })

    // A user agent is only meaningful once you can see which one went out, so
    // it is shown here rather than left to the server logs.
    const agent = config?.activeUserAgent ?? config?.userAgent
    const fellBack =
      config?.activeUserAgent && config?.userAgent && config.activeUserAgent !== config.userAgent
    const rows = [
      ["Navegador compartido", session ? "En marcha" : "Detenido"],
      ["Clave de API", config?.configured ? (config.testKey ? "De prueba" : "Activa") : "Sin configurar"],
      ["Resolución", config?.width ? `${config.width}×${config.height}` : "—"],
      [
        "User agent",
        agent
          ? fellBack
            ? `${agent} (el tuyo fue rechazado)`
            : agent
          : "Por defecto (Chrome de escritorio)",
      ],
      ["Personas en la sala", String(room.viewers.length)],
      ["Tu papel", ROLE_LABEL[room.role]],
      ["Código", room.code ?? "—"],
    ]

    return [
      h("div.sheet__title", { text: "Ajustes de la sala" }),
      h("div.sheet__text", { text: "Tu nombre en el chat" }),
      nameField,
      h("button.btn", {
        type: "button",
        dataset: { tone: "quiet" },
        text: "Guardar nombre",
        onClick: () => {
          const next = nameField.value.trim()
          if (!next) return
          set({ name: next })
          room.socket?.rename(next)
          dismiss()
          toast({ title: "Nombre actualizado", text: next, glyph: "users" })
        },
      }),
      h(
        "div.sheet__rows",
        null,
        ...rows.map(([label, value]) =>
          h("div.sheet__row", null, h("span", { text: label }), h("span", { text: value })),
        ),
      ),
      isOwner()
        ? h(
            "label.sheet__toggle",
            null,
            h(
              "span",
              null,
              h("span", { text: "Sala cerrada", style: { display: "block", fontWeight: "600" } }),
              h("span", {
                text: "Nadie nuevo puede entrar. Los que ya están se quedan.",
                style: { display: "block", fontSize: "12.5px", color: "var(--label-2)" },
              }),
            ),
            (() => {
              const box = h("input", { type: "checkbox", checked: room.locked })
              box.addEventListener("change", () => room.socket?.lock(box.checked))
              return box
            })(),
          )
        : null,
      config?.testKey
        ? h("div.sheet__text", {
            text: "La clave de prueba tiene minutos limitados: cierra el navegador al terminar.",
          })
        : null,
      session && canModerate()
        ? h("button.btn", {
            type: "button",
            dataset: { tone: "destructive" },
            text: "Cerrar el navegador compartido",
            onClick: async () => {
              dismiss()
              try {
                room.hb?.destroy()
              } catch {
                /* already gone */
              }
              room.hb = null
              await api.endSession(room.code).catch(() => {})
              renderTopbar()
              renderControls()
              showIdle()
            },
          })
        : null,
      h("button.btn", { type: "button", dataset: { tone: "quiet" }, text: "Cerrar", onClick: dismiss }),
    ]
  })
}

function askName() {
  return new Promise((resolve) => {
    sheet(
      (close) => {
        const field = h("input.field", {
          placeholder: "Tu nombre",
          maxlength: "24",
          value: state.name,
        })
        const confirm = () => {
          const name = field.value.trim() || "Invitado"
          set({ name })
          close()
          resolve(name)
        }
        field.addEventListener("keydown", (event) => {
          if (event.key === "Enter") confirm()
        })
        setTimeout(() => field.focus(), 80)
        return [
          h("div.sheet__title", { text: "¿Cómo te llamas?" }),
          h("div.sheet__text", {
            text: "Así te verá el resto de la sala en el chat y en la lista de gente.",
          }),
          field,
          h("button.btn", { type: "button", text: "Entrar en la sala", onClick: confirm }),
        ]
      },
      { dismissable: false },
    )
  })
}

/* --------------------------------------------------------------------------
   Keyboard: forward to the film unless the user is typing to people
   -------------------------------------------------------------------------- */

const isTyping = () => {
  const el = document.activeElement
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
}

for (const type of ["keydown", "keyup"]) {
  window.addEventListener(
    type,
    (event) => {
      if (!room.hb || !canModerate() || isTyping() || event.metaKey || event.ctrlKey || event.altKey) return
      // The film gets the key; the page should not also scroll.
      if ([" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault()
      }
      room.hb.sendEvent({ type, key: event.key })
    },
    { capture: true },
  )
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !room.hb) return
  // A backgrounded tab has its media suspended; nudge it, and if the nudge does
  // not take, rebuild the stream rather than leave a spinner up forever.
  if (room.connection !== "playing") {
    try {
      room.hb.reconnect()
    } catch {
      /* the SDK is past nudging */
    }
    clearTimeout(stallTimer)
    stallTimer = setTimeout(reattach, 6000)
  }
  fitToScreen()
})

window.addEventListener("resize", () => fitToScreen())
document.addEventListener("fullscreenchange", applyFullscreenState)

/* --------------------------------------------------------------------------
   The on-screen keyboard
   -------------------------------------------------------------------------- */

/**
 * A phone keyboard covers the bottom of the window without the page ever
 * hearing about it: `100dvh` still measures the whole screen, so the composer
 * ends up underneath the keys. The visual viewport does know, so the layout is
 * sized from that instead, and the message field is kept in view.
 */
function trackKeyboard() {
  const vv = window.visualViewport
  if (!vv) return

  const apply = () => {
    // How much of the window the keyboard is covering.
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    document.documentElement.style.setProperty("--keyboard", `${Math.round(hidden)}px`)
    els.app.dataset.keyboard = hidden > 80 ? "true" : "false"
    if (hidden > 80 && document.activeElement === composerField) {
      composerField.scrollIntoView({ block: "nearest" })
    }
  }

  vv.addEventListener("resize", apply)
  vv.addEventListener("scroll", apply)
  apply()
}

composerField.addEventListener("focus", () => {
  // Give the keyboard a moment to finish animating before chasing the field.
  setTimeout(() => composerField.scrollIntoView({ block: "nearest" }), 320)
})

/* --------------------------------------------------------------------------
   Popovers close when you look away from them
   -------------------------------------------------------------------------- */

document.addEventListener("pointerdown", (event) => {
  if (!volumePopover.hidden && !volumePopover.contains(event.target)) {
    // The button that opened it does its own toggling.
    if (!event.target.closest?.('.ctrl[aria-label="Volumen"]')) closeVolume()
  }
  if (!stickerPicker.hidden && !stickerPicker.contains(event.target)) {
    if (!event.target.closest?.(".composer__sticker")) closeStickers()
  }
  if (!gifPicker.hidden && !gifPicker.contains(event.target)) {
    if (!event.target.closest?.(".composer__gif")) closeGifs()
  }
})

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return
  if (!volumePopover.hidden) closeVolume()
  if (!stickerPicker.hidden) closeStickers()
  if (!gifPicker.hidden) closeGifs()
})

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Everything the room tells us
   -------------------------------------------------------------------------- */

function handleRoomEvent(event) {
  switch (event.type) {
    case "status":
      room.status = event.status
      renderTopbar()
      break

    case "welcome":
      room.you = event.you
      room.viewers = event.viewers
      room.messages = event.history ?? []
      room.stickers = event.stickers ?? []
      room.commands = event.commands ?? []
      room.code = event.code ?? room.code
      room.locked = Boolean(event.locked)
      room.ownerId = event.ownerId ?? null
      room.role = event.role ?? "guest"
      room.token = event.token
      setRoomToken(event.token)
      if (event.audio) room.audio = event.audio
      room.activity = event.activity ?? null
      // The server had forgotten this room and brought it back for us.
      if (event.revived) {
        toast({
          title: "Sala recuperada",
          text: "El servidor la había olvidado; se ha vuelto a abrir con el mismo código.",
          glyph: "reload",
          duration: 5000,
        })
      }
      renderTopbar()
      renderControls()
      renderPanel()
      // Someone opened the browser — or an app — before we arrived: join it.
      if (event.session) join(event.session)
      else renderActivityView()
      break

    case "role":
      // Being crowned deserves more than a relabel.
      if (event.role === "moderator" && room.role !== "moderator") {
        toast({
          title: "👑 Eres la reina de la sala",
          text: "Puedes poner la película, controlarla y cuidar de la sala.",
          glyph: "heart",
          color: "var(--accent)",
          duration: 5000,
        })
      }
      // The token is what the HTTP routes ask for; the role is what it buys.
      setRoomToken(event.token)
      room.token = event.token
      room.role = event.role
      room.ownerId = event.ownerId ?? room.ownerId
      if (room.hb) room.hb.disableInput = !canModerate()
      renderTopbar()
      renderControls()
      renderPanel()
      if (!room.hb && !room.starting) showIdle()
      break

    case "presence":
      room.viewers = event.viewers
      room.ownerId = event.ownerId ?? room.ownerId
      room.locked = Boolean(event.locked)
      room.role = room.viewers.find((viewer) => viewer.id === room.you?.id)?.role ?? room.role
      if (room.hb) room.hb.disableInput = !canModerate()
      renderTopbar()
      renderControls()
      renderPanel()
      if (!room.hb && !room.starting) showIdle()
      break

    case "you":
      room.you = event.you
      renderPanel()
      break

    case "chat":
      room.messages.push(event.message)
      if (room.messages.length > 200) room.messages.shift()
      if (room.tab === "chat") renderPanelBody()
      break

    case "effect":
      playEffect(event)
      break

    case "activity":
      room.activity = event.activity
      renderActivityView()
      break

    case "cue":
      showCue(event)
      break

    case "app-denied":
      toast({ title: "La sala dice que no", text: event.reason, glyph: "info" })
      break

    case "audio":
      // Someone else moved the room's volume; follow along without touching the
      // player, or every client would send its own keys and it would move once
      // per person.
      room.audio = event.audio
      if (!volumePopover.hidden) renderVolumePopover()
      renderControls()
      break

    case "session":
      if (event.session) join(event.session)
      else if (room.hb) {
        try {
          room.hb.destroy()
        } catch {
          /* already gone */
        }
        room.hb = null
        renderTopbar()
        renderControls()
        showIdle("Se ha cerrado el navegador compartido.")
      }
      break

    case "kicked":
      room.socket?.close()
      showBlocked("Te han expulsado", event.reason ?? "Ya no estás en esta sala.")
      break

    case "denied":
      room.socket?.close()
      showBlocked("No puedes entrar", event.reason ?? "La sala no te deja pasar.")
      break

    case "no-room":
      // With revival in place this only happens for malformed codes or a
      // server with every slot occupied.
      room.socket?.close()
      showLobby({ notice: `No se pudo abrir la sala ${event.code}. Prueba en un momento.` })
      break
  }
}

/* --------------------------------------------------------------------------
   The landing page: no room yet
   -------------------------------------------------------------------------- */

/** Ticking while the landing page is up, so the room list stays true. */
let roomsPoll = null

function stopRoomsPoll() {
  clearInterval(roomsPoll)
  roomsPoll = null
}

/**
 * The list of rooms anyone may walk into. The server decides what belongs here
 * — a locked room is nobody's business — so this only draws what it is given.
 */
function renderOpenRooms(container, rooms, onPick) {
  if (rooms === null) {
    fill(container, h("p.rooms__empty", { text: "No se pudo cargar la lista de salas." }))
    return
  }
  if (!rooms.length) {
    fill(
      container,
      h("p.rooms__empty", {
        text: "Ahora mismo no hay ninguna sala abierta. Crea la primera.",
      }),
    )
    return
  }

  fill(
    container,
    ...rooms.map((entry) =>
      h(
        "button.room-card",
        { type: "button", onClick: () => onPick(entry.code) },
        h(
          "div.room-card__main",
          null,
          h("div.room-card__code", { text: entry.code }),
          h("div.room-card__host", {
            // `text`, never `html`: this name was typed by a stranger.
            text: entry.host ? `de ${entry.host}` : "sin anfitrión ahora mismo",
          }),
        ),
        h(
          "div.room-card__meta",
          null,
          entry.live
            ? h("span.tag", { dataset: { tone: "ok" }, text: "EN MARCHA" })
            : h("span.tag", { text: "ESPERANDO" }),
          h("span.room-card__people", {
            text: `${entry.viewers} ${entry.viewers === 1 ? "persona" : "personas"}`,
          }),
        ),
        h("span.room-card__go", { html: icon("chevron-right", { size: 15 }) }),
      ),
    ),
  )
}

/** Everything before a room exists: open one, pick one, or type a code. */
function showLobby({ notice, code = "" } = {}) {
  els.app.hidden = true
  els.lobby.hidden = false

  const nameField = h("input.field", {
    type: "text",
    placeholder: "Tu nombre",
    maxlength: "24",
    value: state.name,
    autocomplete: "nickname",
  })

  const codeField = h("input.field.field--code", {
    type: "text",
    placeholder: "CÓDIGO",
    maxlength: "7",
    value: code,
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: "false",
    inputmode: "text",
    onInput: (event) => {
      event.target.value = normalizeCode(event.target.value)
    },
  })

  const message = h("p.lobby__error", { hidden: true })
  const say = (text) => {
    message.textContent = text
    message.hidden = !text
  }
  if (notice) say(notice)

  const rememberName = () => {
    const name = nameField.value.trim() || "Invitado"
    set({ name })
    return name
  }

  const createButton = h("button.btn", {
    type: "button",
    text: "Crear una sala",
    onClick: async () => {
      createButton.disabled = true
      createButton.textContent = "Creando…"
      try {
        const { code: fresh } = await api.createRoom()
        rememberName()
        enterRoom(fresh)
      } catch (error) {
        say(error.message)
        createButton.disabled = false
        createButton.textContent = "Crear una sala"
      }
    },
  })

  const joinButton = h("button.btn", {
    type: "button",
    dataset: { tone: "quiet" },
    text: "Entrar",
    onClick: async () => {
      const wanted = normalizeCode(codeField.value)
      if (wanted.length < 6) return say("El código tiene 6 caracteres.")
      joinButton.disabled = true
      try {
        const found = await api.findRoom(wanted)
        if (!found) {
          // Could be a typo — or a room the server forgot. First press warns;
          // pressing again walks in and revives the room with that code.
          if (codeField.dataset.confirmed === wanted) {
            rememberName()
            enterRoom(wanted)
            return
          }
          codeField.dataset.confirmed = wanted
          say("Esa sala no existe ahora mismo. Revisa el código — o pulsa Entrar otra vez para abrirla igualmente.")
          return
        }
        if (found.locked) say("La sala está cerrada, puede que no te deje entrar.")
        rememberName()
        enterRoom(wanted)
      } catch (error) {
        say(error.message)
      } finally {
        joinButton.disabled = false
      }
    },
  })

  codeField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinButton.click()
  })

  /** Walking into a room found on the list is the same as typing its code. */
  const pickRoom = (wanted) => {
    rememberName()
    enterRoom(wanted)
  }

  const roomsList = h("div.rooms__list")
  const roomsCount = h("span.rooms__count", { text: "" })

  async function loadRooms() {
    try {
      const { rooms } = await api.listRooms()
      renderOpenRooms(roomsList, rooms, pickRoom)
      roomsCount.textContent = rooms.length
        ? `${rooms.length} ${rooms.length === 1 ? "sala" : "salas"}`
        : ""
    } catch (error) {
      console.warn("[party] no se pudo listar las salas", error)
      renderOpenRooms(roomsList, null, pickRoom)
      roomsCount.textContent = ""
    }
  }

  fill(
    els.lobby,
    h(
      "div.landing",
      null,
      h(
        "header.landing__hero",
        null,
        h("div.lobby__mark", { html: icon("play", { size: 26 }) }),
        h("h1.landing__title", { text: "Watch Party" }),
        h("p.landing__tagline", {
          text: "Un solo navegador para toda la sala. Pon una película y la veis a la vez, en la misma pantalla y al mismo segundo.",
        }),
      ),
      h(
        "div.landing__cols",
        null,
        h(
          "section.lobby__card",
          null,
          h("h2.card__title", { text: "Empieza aquí" }),
          h("label.field-label", { text: "Tu nombre", for: "landingName" }),
          nameField,
          createButton,
          h("div.lobby__or", null, h("span", { text: "o entra con un código" })),
          h("div.lobby__join", null, codeField, joinButton),
          message,
          room.config && !room.config.configured
            ? h("p.lobby__error", { text: room.config.error })
            : null,
        ),
        h(
          "section.lobby__card.rooms",
          null,
          h(
            "div.rooms__head",
            null,
            h("h2.card__title", { text: "Salas abiertas" }),
            roomsCount,
          ),
          h("p.rooms__note", {
            text: "Salas con gente dentro que no están en privado. Las cerradas siguen funcionando con su código.",
          }),
          roomsList,
        ),
      ),
    ),
  )

  nameField.id = "landingName"
  renderOpenRooms(roomsList, [], pickRoom)
  loadRooms()

  // Someone opens a room while you are looking at the list, so the list has to
  // keep up. Cheap poll, and only while this page is actually on screen.
  stopRoomsPoll()
  roomsPoll = setInterval(() => {
    if (!document.hidden && !els.lobby.hidden) loadRooms()
  }, 5000)

  setTimeout(() => (state.name ? codeField : nameField).focus({ preventScroll: true }), 80)
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

/** Walk into a room: put it in the URL, wire the socket, show the app. */
function enterRoom(code) {
  room.code = normalizeCode(code)
  history.replaceState(null, "", `/${room.code}`)

  stopRoomsPoll()
  els.lobby.hidden = true
  els.app.hidden = false
  els.app.dataset.theatre = String(Boolean(state.theatre))
  els.stage.append(volumePopover)
  els.controls.hidden = false

  renderControls()
  renderTopbar()
  renderPanel()
  showIdle()
  trackKeyboard()

  room.socket?.close()
  room.socket = connectParty({
    code: room.code,
    name: state.name || "Invitado",
    clientId: state.clientId,
    onEvent: handleRoomEvent,
  })
}

async function boot() {
  room.config = await api.config().catch((error) => ({
    configured: false,
    error: `No se pudo hablar con el servidor: ${error.message}`,
  }))

  // /ABC123 walks straight into that room; anything else is the lobby.
  const fromUrl = normalizeCode(location.pathname.slice(1))
  if (fromUrl.length === 6 && state.name) {
    enterRoom(fromUrl)
    return
  }
  showLobby({ code: fromUrl.length === 6 ? fromUrl : "" })
}

boot()

// Handy from the console while developing.
window.watchParty = room
