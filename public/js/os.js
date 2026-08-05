/**
 * The OS controller.
 *
 * Owns the device state machine (booting → locked → unlocked), the overlay
 * stack (home screen / app / Spotlight / Control Center), and the system UI
 * affordances an app may ask for: toasts, the Dynamic Island, the status bar
 * colour scheme.
 */

import { $, fill, h, wait } from "./core/dom.js"
import { icon } from "./core/icons.js"
import { state, subscribe, wallpaperCss } from "./core/store.js"

export class OS {
  constructor(root) {
    this.device = root
    this.wallpaper = $("#wallpaper", root)
    this.springboard = $("#springboard", root)
    this.appLayer = $("#appLayer", root)
    this.lockscreen = $("#lockscreen", root)
    this.spotlight = $("#spotlight", root)
    this.controlCenter = $("#controlCenter", root)
    this.island = $("#dynamicIsland", root)
    this.islandContent = $("#islandContent", root)
    this.toasts = $("#toasts", root)
    this.statusbar = $("#statusbar", root)

    /** @type {Map<string, import("./apps/registry.js").AppDefinition>} */
    this.apps = new Map()
    /** Currently running app instance, if any. */
    this.running = null
    this.overlay = "none"
    this.islandTimer = null

    subscribe((keys) => this.#onStateChange(keys))
    this.applyAppearance()
  }

  register(apps) {
    for (const app of apps) this.apps.set(app.id, app)
  }

  /* ---------------------------------------------------------------- state */

  get locked() {
    return this.device.dataset.state === "locked"
  }

  setState(next) {
    this.device.dataset.state = next
  }

  #onStateChange(keys) {
    if (keys.some((k) => ["appearance", "wallpaper", "reduceMotion", "brightness"].includes(k))) {
      this.applyAppearance()
    }
  }

  applyAppearance() {
    this.device.dataset.appearance = state.appearance
    this.device.dataset.reduceMotion = String(state.reduceMotion)
    this.wallpaper.style.background = wallpaperCss()
    // Brightness reads as a dimmer screen; the CSS owns the blur so depth still works.
    this.wallpaper.style.setProperty("--wall-brightness", String(0.5 + state.brightness * 0.6))
  }

  /** Light content = white glyphs; dark content = black glyphs. */
  setStatusScheme(scheme) {
    this.statusbar.dataset.scheme = scheme === "dark" ? "dark" : "light"
    this.device.dataset.indicator = scheme === "dark" ? "dark" : "light"
  }

  #setOverlay(name) {
    this.overlay = name
    this.device.dataset.overlay = name
    this.device.dataset.depth = name === "spotlight" || name === "cc" ? "blurred" : "flat"
  }

  /* ------------------------------------------------------------ lifecycle */

  async boot() {
    await wait(2500)
    this.setState("locked")
    this.setStatusScheme("light")
  }

  unlock() {
    if (!this.locked) return
    this.setState("unlocked")
    this.setStatusScheme("light")
  }

  lock() {
    this.closeApp({ instant: true })
    this.closeControlCenter()
    this.closeSpotlight()
    this.setState("locked")
    this.setStatusScheme("light")
  }

  /* ----------------------------------------------------------------- apps */

  /**
   * Launch an app. `originEl` is the tapped icon, used to grow the window out
   * of it the way iOS does.
   */
  async openApp(id, originEl) {
    const app = this.apps.get(id)
    if (!app) {
      this.toast({ title: "No disponible", text: `La app "${id}" no está instalada.` })
      return
    }
    if (this.running?.id === id) return
    if (this.running) this.closeApp({ instant: true })

    this.closeSpotlight({ instant: true })
    this.closeControlCenter({ instant: true })

    // Grow from the icon's position.
    const device = this.device.getBoundingClientRect()
    if (originEl) {
      const from = originEl.getBoundingClientRect()
      const scale = Math.max(0.1, from.width / device.width)
      const dx = from.left + from.width / 2 - (device.left + device.width / 2)
      const dy = from.top + from.height / 2 - (device.top + device.height / 2)
      this.appLayer.style.setProperty("--origin-scale", String(scale))
      this.appLayer.style.setProperty("--origin-x", `${dx / scale}px`)
      this.appLayer.style.setProperty("--origin-y", `${dy / scale}px`)
    } else {
      this.appLayer.style.setProperty("--origin-scale", "0.85")
      this.appLayer.style.setProperty("--origin-x", "0px")
      this.appLayer.style.setProperty("--origin-y", "0px")
    }

    const root = h("div.app", { dataset: { app: id } })
    fill(this.appLayer, root)
    this.appLayer.hidden = false
    this.appLayer.dataset.animating = "open"

    const context = this.#appContext(app)
    let instance = null
    try {
      instance = app.mount(root, context) ?? {}
    } catch (err) {
      console.error(`[os] "${id}" failed to mount`, err)
      fill(
        root,
        h(
          "div.empty-state",
          null,
          h("h3", { text: "Esta app se cerró inesperadamente" }),
          h("p", { text: String(err?.message ?? err) }),
        ),
      )
      instance = {}
    }

    this.running = { id, app, root, instance }
    this.#setOverlay("app")
    this.setStatusScheme(app.statusScheme ?? "light")

    await wait(420)
    if (this.appLayer.dataset.animating === "open") delete this.appLayer.dataset.animating
  }

  #appContext(app) {
    return {
      os: this,
      app,
      close: () => this.closeApp(),
      toast: (options) => this.toast(options),
      island: (options) => this.showIsland(options),
      hideIsland: () => this.hideIsland(),
      setStatusScheme: (scheme) => this.setStatusScheme(scheme),
      openApp: (id) => this.openApp(id),
    }
  }

  async closeApp({ instant = false } = {}) {
    const running = this.running
    if (!running) return
    this.running = null

    try {
      running.instance?.destroy?.()
    } catch (err) {
      console.warn(`[os] "${running.id}" destroy() threw`, err)
    }

    this.#setOverlay("none")
    this.setStatusScheme("light")

    if (instant || state.reduceMotion) {
      this.appLayer.hidden = true
      this.appLayer.replaceChildren()
      delete this.appLayer.dataset.animating
      this.appLayer.style.transform = ""
      return
    }

    this.appLayer.style.transform = ""
    this.appLayer.dataset.animating = "close"
    await wait(400)
    this.appLayer.hidden = true
    this.appLayer.replaceChildren()
    delete this.appLayer.dataset.animating
  }

  /** Back to the home screen from wherever the user is. */
  goHome() {
    if (this.locked) return
    if (this.overlay === "cc") return this.closeControlCenter()
    if (this.overlay === "spotlight") return this.closeSpotlight()
    if (this.running) return this.closeApp()
  }

  /* -------------------------------------------------------------- overlays */

  openControlCenter() {
    if (this.overlay === "cc" || this.locked) return
    this.controlCenter.hidden = false
    delete this.controlCenter.dataset.closing
    this.#setOverlay("cc")
    this.onControlCenterOpen?.()
  }

  async closeControlCenter({ instant = false } = {}) {
    if (this.controlCenter.hidden) return
    if (instant || state.reduceMotion) {
      this.controlCenter.hidden = true
    } else {
      this.controlCenter.dataset.closing = "true"
      await wait(220)
      this.controlCenter.hidden = true
      delete this.controlCenter.dataset.closing
    }
    this.#setOverlay(this.running ? "app" : "none")
  }

  openSpotlight() {
    if (this.overlay === "spotlight" || this.locked) return
    this.spotlight.hidden = false
    this.#setOverlay("spotlight")
    this.onSpotlightOpen?.()
  }

  closeSpotlight() {
    if (this.spotlight.hidden) return
    this.spotlight.hidden = true
    this.#setOverlay(this.running ? "app" : "none")
    this.onSpotlightClose?.()
  }

  /* ------------------------------------------------------------ system UI */

  /** Banner notification sliding in from the top. */
  toast({ title, text, glyph = "info", color = "var(--tint)", duration = 3200 } = {}) {
    const node = h(
      "div.toast",
      null,
      h("div.toast__icon", { style: { background: color }, html: icon(glyph, { size: 18 }) }),
      h(
        "div",
        { style: { minWidth: 0 } },
        title && h("div.toast__title", { text: title }),
        text && h("div.toast__text", { text }),
      ),
    )
    this.toasts.append(node)

    const dismiss = async () => {
      if (!node.isConnected) return
      node.dataset.closing = "true"
      await wait(220)
      node.remove()
    }
    node.addEventListener("click", dismiss)
    setTimeout(dismiss, duration)
    return dismiss
  }

  /** Expand the Dynamic Island with a short status. */
  showIsland({ text, tone = "ok", duration = 2600 } = {}) {
    clearTimeout(this.islandTimer)
    fill(
      this.islandContent,
      h("span.island__dot", { class: tone === "ok" ? "" : `island__dot--${tone}` }),
      h("span", { text }),
    )
    this.island.dataset.expanded = "true"
    if (duration > 0) {
      this.islandTimer = setTimeout(() => {
        this.island.dataset.expanded = "false"
      }, duration)
    }
  }

  hideIsland() {
    clearTimeout(this.islandTimer)
    this.island.dataset.expanded = "false"
  }
}
