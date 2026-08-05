/**
 * Sala — the Hyperbeam room.
 *
 * A shared virtual computer on top, and a panel below with three tabs: chat,
 * voice call and a keyboard that types straight into the remote browser.
 * The browser is real: a Chromium instance on Hyperbeam's infrastructure,
 * streamed over WebRTC through the `@hyperbeam/web` SDK.
 */

import { fill, h } from "../core/dom.js"
import { icon } from "../core/icons.js"
import { api, prettyHost, toUrl } from "../core/api.js"
import { commit, state } from "../core/store.js"

const TABS = [
  { id: "chat", glyph: "message", label: "Chat" },
  { id: "call", glyph: "phone", label: "Llamada" },
  { id: "keyboard", glyph: "keyboard", label: "Teclado" },
]

const FAVORITES = [
  { label: "Google", url: "https://www.google.com", letter: "G", tone: "#4285f4" },
  { label: "YouTube", url: "https://www.youtube.com", letter: "▶", tone: "#ff0033" },
  { label: "Wikipedia", url: "https://es.wikipedia.org", letter: "W", tone: "#8a8a8f" },
  { label: "Hyperbeam", url: "https://hyperbeam.com", letter: "H", tone: "#7c5cff" },
]

/** Keys the on-screen keyboard can forward to the virtual browser. */
const SPECIAL_KEYS = [
  { key: "Enter", label: "Intro" },
  { key: "Backspace", label: "Borrar" },
  { key: "Tab", label: "Tab" },
  { key: "ArrowUp", label: "▲" },
  { key: "ArrowDown", label: "▼" },
  { key: "ArrowLeft", label: "◀" },
  { key: "ArrowRight", label: "▶" },
]

export const room = {
  id: "room",
  name: "Sala",
  tagline: "Navegador virtual compartido",
  icon: "hyperbeam",
  gradient: "linear-gradient(160deg,#a78bfa 0%,#7c5cff 45%,#4c1fd7 100%)",
  statusScheme: "light",

  mount(root, ctx) {
    let hb = null
    let destroyed = false
    let tab = "chat"
    let currentUrl = state.homeUrl
    let muted = false

    if (!state.roomChat) {
      state.roomChat = []
      commit(["roomChat"])
    }

    /* ------------------------------------------------------------- header */

    const roomTitle = h("div.room__title", { text: state.roomName ?? "Cinema" })

    const header = h(
      "div.room__header",
      null,
      h("button.room__icon-btn", {
        type: "button",
        "aria-label": "Volver",
        html: icon("back", { size: 22, stroke: 2 }),
        onClick: () => ctx.close(),
      }),
      roomTitle,
      h("button.room__icon-btn", {
        type: "button",
        "aria-label": "Ajustes de la sala",
        html: icon("gear", { size: 21 }),
        onClick: () => openSheet("settings"),
      }),
      h("button.room__icon-btn", {
        type: "button",
        "aria-label": "Invitar",
        html: icon("contacts", { size: 21 }),
        onClick: () => invite(),
      }),
    )

    /* ------------------------------------------------------------ browser */

    const stage = h("div.safari__stage")
    const badge = h("div.safari__badge", { hidden: true })
    const overlay = h("div.room__overlay")
    const viewport = h("div.room__viewport", null, stage, badge, overlay)

    const address = h("input", {
      type: "text",
      placeholder: "Buscar o introducir dirección",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "aria-label": "Dirección",
    })

    const urlBar = h(
      "div.room__urlbar",
      { hidden: true },
      h("button", {
        type: "button",
        "aria-label": "Atrás",
        html: icon("arrow-left", { size: 18 }),
        onClick: () => hb?.tabs.goBack(),
      }),
      h("button", {
        type: "button",
        "aria-label": "Adelante",
        html: icon("arrow-right", { size: 18 }),
        onClick: () => hb?.tabs.goForward(),
      }),
      h("div.room__field", null, h("span", { html: icon("search", { size: 14 }) }), address),
      h("button", {
        type: "button",
        "aria-label": "Recargar",
        html: icon("reload", { size: 18 }),
        onClick: () => hb?.tabs.reload(),
      }),
    )

    /* --------------------------------------------------------------- tabs */

    const tabStrip = h(
      "div.room__tabs",
      null,
      ...TABS.map((item) =>
        h(
          "button",
          {
            type: "button",
            dataset: { active: String(item.id === tab), tab: item.id },
            "aria-label": item.label,
            onClick: () => {
              tab = item.id
              for (const button of tabStrip.children) {
                button.dataset.active = String(button.dataset.tab === tab)
              }
              renderPanel()
            },
          },
          h("span", { html: icon(item.glyph, { size: 22 }) }),
        ),
      ),
    )

    const panel = h("div.room__panel")

    /* --------------------------------------------------------------- chat */

    const composerField = h("textarea.composer__field", {
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
    const composer = h("div.composer.room__composer", null, composerField, composerSend)

    function sendMessage() {
      const text = composerField.value.trim()
      if (!text) return
      state.roomChat.push({ from: "me", author: state.owner, text, at: Date.now() })
      commit(["roomChat"])
      composerField.value = ""
      composerField.style.height = "auto"
      composerSend.disabled = true
      renderPanel()
    }

    composerField.addEventListener("input", () => {
      composerSend.disabled = !composerField.value.trim()
      composerField.style.height = "auto"
      composerField.style.height = `${Math.min(96, composerField.scrollHeight)}px`
    })
    composerField.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        sendMessage()
      }
    })
    composerSend.addEventListener("click", sendMessage)

    function renderChat() {
      if (!state.roomChat.length) {
        return h(
          "div.room__empty",
          null,
          h("h3", { text: "Invita a tus amigos" }),
          h("p", { text: "Comparte el enlace para navegar y chatear en la misma sala." }),
          h("button.room__cta", {
            type: "button",
            html: `${icon("contacts", { size: 18 })}<span>Invitar amigos</span>`,
            onClick: () => invite(),
          }),
        )
      }
      return h(
        "div.room__messages",
        null,
        ...state.roomChat.map((message) =>
          h(
            "div.room__message",
            null,
            h("div.room__message__meta", {
              text: `${message.author ?? "Invitado"} · ${new Date(message.at).toLocaleTimeString(
                "es-ES",
                { hour: "2-digit", minute: "2-digit" },
              )}`,
            }),
            h("div.bubble", {
              class: message.from === "me" ? "bubble--out" : "bubble--in",
              text: message.text,
            }),
          ),
        ),
      )
    }

    /* --------------------------------------------------------------- call */

    function renderCall() {
      const participant = (name, initial, color, you) =>
        h(
          "div.room__participant",
          null,
          h("span.chat-row__avatar", { text: initial, style: { background: color } }),
          h(
            "span",
            { style: { flex: "1", minWidth: 0 } },
            h("span", { text: name, style: { display: "block", fontSize: "16px" } }),
            h("span", {
              text: you ? (muted ? "Silenciado" : "Micrófono activo") : "Esperando…",
              style: { display: "block", fontSize: "13px", color: "var(--label-2)" },
            }),
          ),
          you
            ? h("button.room__mute", {
                type: "button",
                dataset: { on: String(muted) },
                html: icon(muted ? "speaker-off" : "speaker", { size: 18 }),
                onClick: () => {
                  muted = !muted
                  renderPanel()
                },
              })
            : null,
        )

      return h(
        "div.room__call",
        null,
        h("div.list__header", { text: "En la llamada" }),
        participant(state.owner, state.owner[0] ?? "H", "linear-gradient(150deg,#7c5cff,#4c1fd7)", true),
        h("div.room__empty", { style: { paddingTop: "10px" } },
          h("p", { text: "Nadie más se ha unido todavía. Comparte el enlace de la sala para que entren." }),
          h("button.room__cta", {
            type: "button",
            html: `${icon("share", { size: 18 })}<span>Copiar enlace</span>`,
            onClick: () => invite(),
          }),
        ),
      )
    }

    /* ----------------------------------------------------------- keyboard */

    function renderKeyboard() {
      const field = h("input", {
        type: "text",
        placeholder: "Escribe aquí y se envía al navegador",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        class: "room__keyfield",
      })

      // Each character is forwarded as a keydown/keyup pair to the remote page.
      field.addEventListener("input", (event) => {
        const text = event.target.value
        if (!text || !hb) {
          if (!hb) event.target.value = ""
          return
        }
        for (const character of text) {
          hb.sendEvent({ type: "keydown", key: character })
          hb.sendEvent({ type: "keyup", key: character })
        }
        event.target.value = ""
      })

      const keys = h(
        "div.room__keys",
        null,
        ...SPECIAL_KEYS.map((entry) =>
          h("button", {
            type: "button",
            text: entry.label,
            onClick: () => {
              if (!hb) return ctx.toast({ title: "Sin navegador", text: "Abre primero un navegador." })
              hb.sendEvent({ type: "keydown", key: entry.key })
              hb.sendEvent({ type: "keyup", key: entry.key })
            },
          }),
        ),
      )

      return h(
        "div.room__keyboard",
        null,
        h("div.list__header", { text: "Teclado remoto" }),
        field,
        keys,
        h("div.list__footer", {
          text: hb
            ? "Las pulsaciones se envían al ordenador virtual mediante hb.sendEvent()."
            : "Abre un navegador para poder escribir en él.",
        }),
      )
    }

    function renderPanel() {
      const views = { chat: renderChat, call: renderCall, keyboard: renderKeyboard }
      fill(panel, views[tab]())
      composer.hidden = tab !== "chat"
      const messages = panel.querySelector(".room__messages")
      if (messages) messages.scrollTop = messages.scrollHeight
    }

    /* ------------------------------------------------------------- sheets */

    function closeSheet() {
      root.querySelector(".room__sheet")?.remove()
    }

    async function openSheet(kind) {
      closeSheet()
      const body = h("div.room__sheet__body")
      const sheet = h(
        "div.room__sheet",
        { onClick: (event) => event.target === sheet && closeSheet() },
        h(
          "div.room__sheet__card",
          null,
          h("div.room__sheet__grabber"),
          body,
        ),
      )
      root.append(sheet)

      if (kind !== "settings") return

      fill(body, h("div.room__sheet__title", { text: "Ajustes de la sala" }), h("div.spinner"))

      const [config, session] = await Promise.all([
        api.config().catch(() => null),
        api.getSession().catch(() => null),
      ])

      const nameField = h("input.room__keyfield", {
        type: "text",
        value: state.roomName ?? "Cinema",
        "aria-label": "Nombre de la sala",
        onChange: (event) => {
          const value = event.target.value.trim() || "Cinema"
          state.roomName = value
          commit(["roomName"])
          roomTitle.textContent = value
        },
      })

      fill(
        body,
        h("div.room__sheet__title", { text: "Ajustes de la sala" }),
        h("div.list__header", { text: "Nombre" }),
        nameField,
        h("div.list__header", { text: "Ordenador virtual" }),
        h(
          "div.room__stat",
          null,
          h("span", { text: "Estado" }),
          h("span.status-pill", {
            text: session ? "En marcha" : "Detenido",
            dataset: { tone: session ? "ok" : "" },
          }),
        ),
        h(
          "div.room__stat",
          null,
          h("span", { text: "Clave de API" }),
          h("span.status-pill", {
            text: config?.configured ? (config.testKey ? "Prueba" : "Activa") : "Sin configurar",
            dataset: { tone: config?.configured ? (config.testKey ? "warn" : "ok") : "bad" },
          }),
        ),
        h(
          "div.room__stat",
          null,
          h("span", { text: "Resolución" }),
          h("span", { text: config?.width ? `${config.width}×${config.height}` : "—" }),
        ),
        session
          ? h("button.btn-filled", {
              type: "button",
              text: "Terminar el navegador",
              dataset: { tone: "destructive" },
              onClick: async () => {
                await teardown()
                await api.endSession().catch(() => {})
                closeSheet()
                showIdle()
                ctx.toast({
                  title: "Sesión terminada",
                  text: "El ordenador virtual se ha apagado.",
                  glyph: "power",
                  color: "var(--red)",
                })
              },
            })
          : null,
        h("button.btn-plain", { type: "button", text: "Cerrar", onClick: closeSheet }),
      )
    }

    function invite() {
      const url = window.location.href
      navigator.clipboard
        ?.writeText(url)
        .then(() =>
          ctx.toast({
            title: "Enlace copiado",
            text: "Compártelo para que se unan a la sala.",
            glyph: "contacts",
            color: "#7c5cff",
          }),
        )
        .catch(() => ctx.toast({ title: "Enlace de la sala", text: url, glyph: "contacts" }))
    }

    /* ------------------------------------------------------------ browser */

    function setOverlay(nodes) {
      overlay.hidden = false
      fill(overlay, ...nodes)
    }

    function showIdle(message) {
      urlBar.hidden = true
      setOverlay([
        h("h2.room__idle-title", { text: "Empieza a navegar" }),
        h("button.room__open", {
          type: "button",
          html: `${icon("power", { size: 24 })}<span>Abrir un navegador nuevo</span>`,
          onClick: () => start(),
        }),
        message ? h("p.room__idle-note", { text: message }) : null,
        h(
          "div.room__favorites",
          null,
          ...FAVORITES.map((favorite) =>
            h(
              "button",
              { type: "button", onClick: () => start(favorite.url) },
              h("span", { text: favorite.letter, style: { color: favorite.tone } }),
              h("span", { text: favorite.label }),
            ),
          ),
        ),
      ])
    }

    function showLoading(text) {
      setOverlay([h("div.spinner"), h("p.room__idle-note", { text })])
    }

    function showError(error) {
      const missingKey = /HYPERBEAM_API_KEY/i.test(error.message)
      setOverlay([
        h("h2.room__idle-title", { text: missingKey ? "Falta la clave de API" : "No se pudo conectar" }),
        h("p.room__idle-note", { text: error.message }),
        missingKey
          ? h("p.room__idle-note", {
              html: "Copia <code>.env.example</code> a <code>.env</code> y define <code>HYPERBEAM_API_KEY</code>.",
            })
          : null,
        h("button.room__open", {
          type: "button",
          html: `${icon("reload", { size: 22 })}<span>Reintentar</span>`,
          onClick: () => start(),
        }),
      ])
    }

    async function start(startUrl) {
      if (hb) {
        if (startUrl) navigate(startUrl)
        return
      }
      showLoading("Arrancando el ordenador virtual…")
      ctx.island({ text: "Abriendo navegador…", tone: "busy", duration: 0 })

      try {
        const [{ default: Hyperbeam }, session] = await Promise.all([
          import("/vendor/hyperbeam.js"),
          api.createSession({ startUrl: startUrl || state.homeUrl }),
        ])
        if (destroyed) return

        showLoading("Conectando con el flujo de vídeo…")

        hb = await Hyperbeam(stage, session.embedUrl, {
          volume: state.volume,
          delegateKeyboard: false,
          onDisconnect: (event) => {
            if (destroyed) return
            hb = null
            showIdle(
              event?.type === "inactive"
                ? "La sesión se cerró por inactividad."
                : "Se ha cerrado la conexión con el ordenador virtual.",
            )
            ctx.island({ text: "Navegador desconectado", tone: "error" })
            renderPanel()
          },
          onConnectionStateChange: ({ state: connection }) => {
            if (connection === "reconnecting") {
              badge.hidden = false
              fill(badge, h("span.spinner", { style: { width: "12px", height: "12px" } }), "Reconectando…")
            } else if (connection === "playing") {
              badge.hidden = true
            }
          },
          onCloseWarning: () =>
            ctx.toast({
              title: "Sesión a punto de cerrarse",
              text: "El ordenador virtual se apagará por inactividad.",
              glyph: "timer",
              color: "var(--orange)",
            }),
        })

        if (destroyed) {
          hb.destroy()
          hb = null
          return
        }

        overlay.hidden = true
        urlBar.hidden = false
        ctx.island({ text: "Navegador activo", tone: "ok" })
        wireTabs()
        fitToViewport()
        renderPanel()
        if (startUrl) navigate(startUrl)
      } catch (error) {
        console.error("[room] could not start the virtual browser", error)
        ctx.island({ text: "Error de conexión", tone: "error" })
        if (!destroyed) showError(error)
      }
    }

    /** Match the stream to the viewport so text stays crisp. */
    async function fitToViewport() {
      if (!hb) return
      const rect = viewport.getBoundingClientRect()
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      let width = Math.round(rect.width * ratio)
      let height = Math.round(rect.height * ratio)
      const maxArea = hb.maxArea || width * height
      const area = width * height
      if (area > maxArea) {
        const shrink = Math.sqrt(maxArea / area)
        width = Math.floor(width * shrink)
        height = Math.floor(height * shrink)
      }
      try {
        await hb.resize(width, height)
      } catch (error) {
        console.warn("[room] resize rejected", error)
      }
    }

    function wireTabs() {
      hb.tabs.onUpdated.addListener((_tabId, changeInfo, remoteTab) => {
        const url = changeInfo.url || remoteTab?.url
        if (url) {
          currentUrl = url
          if (document.activeElement !== address) address.value = prettyHost(currentUrl)
        }
      })
      hb.tabs
        .query({ active: true })
        .then((tabs) => {
          const remoteTab = tabs?.[0]
          if (!remoteTab) return
          currentUrl = remoteTab.url ?? currentUrl
          address.value = prettyHost(currentUrl)
        })
        .catch(() => {})
    }

    function navigate(input) {
      const url = toUrl(input)
      if (!url) return
      if (!hb) return start(url)
      overlay.hidden = true
      hb.tabs.update({ url }).catch((error) => {
        ctx.toast({ title: "No se pudo navegar", text: String(error.message ?? error) })
      })
      address.blur()
    }

    async function teardown() {
      if (!hb) return
      try {
        hb.destroy()
      } catch (error) {
        console.warn("[room] destroy threw", error)
      }
      hb = null
      urlBar.hidden = true
    }

    address.addEventListener("focus", () => {
      address.value = currentUrl
      requestAnimationFrame(() => address.select())
    })
    address.addEventListener("blur", () => {
      address.value = prettyHost(currentUrl)
    })
    address.addEventListener("keydown", (event) => {
      if (event.key === "Enter") navigate(address.value)
      if (event.key === "Escape") address.blur()
    })

    const onResize = () => fitToViewport()
    window.addEventListener("resize", onResize)

    /* --------------------------------------------------------------- mount */

    root.classList.add("room")
    fill(root, header, viewport, urlBar, tabStrip, panel, composer)
    address.value = prettyHost(currentUrl)
    showIdle()
    renderPanel()

    // Reconnect straight away if a virtual computer is already running.
    api
      .getSession()
      .then((session) => {
        if (session && !destroyed) start()
      })
      .catch(() => {})

    return {
      navigate,
      destroy() {
        destroyed = true
        window.removeEventListener("resize", onResize)
        teardown()
        ctx.hideIsland()
      },
    }
  },
}

export default room
