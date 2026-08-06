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
import { api, prettyHost, toUrl } from "./core/api.js"
import { connectParty } from "./core/party.js"
import { colourFor, initialsFor, set, state } from "./core/store.js"

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
  /** The film's own volume, shared by the whole room. */
  audio: { volume: 100, muted: false },
}

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
      h("div.topbar__name", { text: room.config?.roomName ?? "Sala" }),
      h(
        "div.topbar__sub",
        null,
        h("span.dot", { dataset: { live } }),
        h("span", { text: `${statusText} · ${count} ${count === 1 ? "persona" : "personas"}` }),
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

function invite() {
  const url = location.origin + location.pathname
  navigator.clipboard
    ?.writeText(url)
    .then(() =>
      toast({
        title: "Enlace copiado",
        text: "Quien lo abra entra en esta misma sala.",
        glyph: "share",
      }),
    )
    .catch(() =>
      sheet((close) => [
        h("div.sheet__title", { text: "Invita a la sala" }),
        h("div.sheet__text", { text: "Comparte esta dirección:" }),
        h("input.field", { value: url, readonly: true, onFocus: (e) => e.target.select() }),
        h("button.btn", { type: "button", text: "Cerrar", onClick: close }),
      ]),
    )
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
  const configured = room.config?.configured
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
    // `text`, not `html`: the message can carry an upstream API response, and
    // that is not ours to trust as markup.
    !configured
      ? h("p.overlay__note", {
          text: room.config?.error ?? "Falta la clave HYPERBEAM_API_KEY en el servidor.",
        })
      : null,
    configured ? servicesGrid() : null,
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
  if (!room.hb) return
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
      note: room.hb
        ? "Cambia el volumen de la película para todos. Funciona en YouTube, Twitch y Vimeo."
        : "Disponible cuando el navegador compartido esté abierto.",
      value: room.audio.volume,
      muted: room.audio.muted,
      disabled: !room.hb,
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
  // Anything that talks to the shared browser is dead until one is attached;
  // the bar itself stays put so the volume is reachable from the first second.
  const live = Boolean(room.hb)

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
    h(
      "div.address",
      null,
      h("span", { html: icon("search", { size: 15 }) }),
      addressInput,
    ),
    h(
      "div.controls__group",
      null,
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

const stickerButton = h("button.composer__sticker", {
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

function openStickers() {
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
function playEffect({ url, duration = 5000, by }) {
  if (!url) return
  clearTimeout(effectTimer)

  const frame = h("iframe", {
    src: url,
    title: "Animación",
    loading: "eager",
    referrerpolicy: "no-referrer",
    sandbox: "allow-scripts allow-same-origin",
    allowtransparency: "true",
  })

  fill(
    effectLayer,
    h("div.effects__stage", null, frame, by ? h("div.effects__by", { text: by }) : null),
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
  stickerButton,
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
      ...room.viewers.map((viewer) =>
        h(
          "div.person",
          null,
          h("span.person__avatar", {
            text: initialsFor(viewer.name),
            style: { background: colourFor(viewer.id + viewer.name) },
          }),
          h("span.person__name", { text: viewer.name }),
          viewer.id === room.you?.id ? h("span.tag", { dataset: { tone: "accent" }, text: "TÚ" }) : null,
        ),
      ),
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
            : h("div.msg__text", { text: message.text }),
        ),
      )
    }),
  )

  if (nearBottom) panelBody.scrollTop = panelBody.scrollHeight
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
      api.createSession({ startUrl }),
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
      showIdle(
        event?.type === "inactive"
          ? "La sesión se cerró por inactividad."
          : "Se ha cerrado la conexión con el navegador compartido.",
      )
    },
    onConnectionStateChange: ({ state: connection }) => {
      if (connection === "reconnecting") {
        els.badge.hidden = false
        fill(els.badge, h("span.spinner", { style: { width: "13px", height: "13px" } }), "Reconectando…")
      } else if (connection === "playing") {
        els.badge.hidden = true
      }
    },
    onCloseWarning: () =>
      toast({
        title: "La sala se va a cerrar",
        text: "El navegador compartido se apagará por inactividad.",
        glyph: "timer",
        color: "var(--orange)",
      }),
  })

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
    api.getSession().catch(() => null),
  ])

  sheet((dismiss) => {
    const nameField = h("input.field", {
      value: room.you?.name ?? state.name,
      maxlength: "24",
      "aria-label": "Tu nombre",
    })

    // A user agent is only meaningful once you can see which one went out, so
    // it is shown here rather than left to the server logs.
    const agent = config?.userAgent
    const rows = [
      ["Navegador compartido", session ? "En marcha" : "Detenido"],
      ["Clave de API", config?.configured ? (config.testKey ? "De prueba" : "Activa") : "Sin configurar"],
      ["Resolución", config?.width ? `${config.width}×${config.height}` : "—"],
      ["User agent", agent ? agent : "Por defecto (Chrome de escritorio)"],
      ["Personas en la sala", String(room.viewers.length)],
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
      config?.testKey
        ? h("div.sheet__text", {
            text: "La clave de prueba tiene minutos limitados: cierra el navegador al terminar.",
          })
        : null,
      session
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
              await api.endSession().catch(() => {})
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
      if (!room.hb || isTyping() || event.metaKey || event.ctrlKey || event.altKey) return
      // The film gets the key; the page should not also scroll.
      if ([" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault()
      }
      room.hb.sendEvent({ type, key: event.key })
    },
    { capture: true },
  )
}

window.addEventListener("resize", () => fitToScreen())
document.addEventListener("fullscreenchange", () => setTimeout(fitToScreen, 200))

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
})

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return
  if (!volumePopover.hidden) closeVolume()
  if (!stickerPicker.hidden) closeStickers()
})

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function boot() {
  room.config = await api.config().catch((error) => ({
    configured: false,
    error: `No se pudo hablar con el servidor: ${error.message}`,
    roomName: "Sala",
  }))

  els.app.dataset.theatre = String(Boolean(state.theatre))
  els.stage.append(volumePopover)
  els.controls.hidden = false
  renderControls()
  renderTopbar()
  renderPanel()
  showIdle()

  const name = state.name || (await askName())

  room.socket = connectParty({
    name,
    onEvent(event) {
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
          if (event.audio) room.audio = event.audio
          renderTopbar()
          renderPanel()
          // Someone opened the browser before we arrived: join it.
          if (event.session) join(event.session)
          break

        case "effect":
          playEffect(event)
          break

        case "audio":
          // Someone else moved the room's volume; follow along without
          // touching the player, or every client would send its own keys.
          room.audio = event.audio
          if (!volumePopover.hidden) renderVolumePopover()
          renderControls()
          break

        case "you":
          room.you = event.you
          renderPanel()
          break

        case "presence":
          room.viewers = event.viewers
          renderTopbar()
          renderPanel()
          break

        case "chat":
          room.messages.push(event.message)
          if (room.messages.length > 200) room.messages.shift()
          if (room.tab === "chat") renderPanelBody()
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
            showIdle("Alguien ha cerrado el navegador compartido.")
          }
          break
      }
    },
  })
}

boot()

// Handy from the console while developing.
window.watchParty = room
