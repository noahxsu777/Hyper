import { clamp, fill, h } from "../core/dom.js"
import { drag, swipe } from "../core/gestures.js"
import { icon } from "../core/icons.js"
import { set, state, toggle } from "../core/store.js"

/** A round connectivity toggle. */
function toggleButton({ glyph, key, tone, label, onChange }) {
  const button = h("button.cc__toggle", {
    type: "button",
    "aria-label": label,
    dataset: { on: String(Boolean(state[key])), tone: tone ?? "" },
    html: icon(glyph, { size: 24 }),
  })
  button.addEventListener("click", () => {
    const value = toggle(key)
    button.dataset.on = String(value)
    onChange?.(value)
  })
  return button
}

/** A vertical slider (brightness, volume). */
function verticalSlider({ glyph, key, onChange }) {
  const fillBar = h("div.cc__slider__fill", {
    style: { height: `${state[key] * 100}%` },
  })
  const node = h("div.cc__slider", null, fillBar, h("span", { html: icon(glyph, { size: 26 }) }))

  const apply = (clientY) => {
    const rect = node.getBoundingClientRect()
    const value = clamp(1 - (clientY - rect.top) / rect.height, 0, 1)
    fillBar.style.height = `${value * 100}%`
    set({ [key]: value })
    onChange?.(value)
  }

  drag(node, {
    onStart: (detail) => {
      apply(detail.startY)
    },
    onMove: (detail) => apply(detail.y),
  })

  return node
}

/** Control Center, opened by swiping from the top-right corner. */
export function mountControlCenter(os) {
  function render() {
    const connectivity = h(
      "div.cc__module.cc__module--connectivity",
      null,
      toggleButton({
        glyph: "airplane",
        key: "airplane",
        label: "Modo avión",
        tone: "orange",
        onChange: (on) => on && os.toast({ title: "Modo avión", text: "Radios desactivadas", glyph: "airplane", color: "var(--orange)" }),
      }),
      toggleButton({ glyph: "hotspot", key: "wifi", label: "Wi-Fi" }),
      toggleButton({ glyph: "bluetooth", key: "bluetooth", label: "Bluetooth" }),
      toggleButton({ glyph: "airdrop", key: "dnd", label: "AirDrop", tone: "green" }),
    )

    const square = (glyph, label, handler, options = {}) =>
      h("button.cc__square", {
        type: "button",
        "aria-label": label,
        dataset: options.dataset ?? {},
        html: icon(glyph, { size: 26 }),
        onClick: (event) => handler(event.currentTarget),
      })

    const media = h(
      "div.cc__module.cc__media",
      null,
      h(
        "div.cc__media__row",
        null,
        h("div.cc__media__art"),
        h(
          "div",
          { style: { minWidth: 0, flex: "1" } },
          h("div.cc__media__title", { text: "Midnight Drive" }),
          h("div.cc__media__sub", { text: "Neon Harbor" }),
        ),
      ),
      h(
        "div.cc__media__controls",
        null,
        h("button", { html: icon("backward", { size: 26 }), onClick: () => os.openApp("music") }),
        h("button", { html: icon("play", { size: 26 }), onClick: () => os.openApp("music") }),
        h("button", { html: icon("forward", { size: 26 }), onClick: () => os.openApp("music") }),
      ),
    )

    fill(
      os.controlCenter,
      h("div.cc__grid", null, connectivity, media),
      h(
        "div.cc__sliders",
        null,
        verticalSlider({ glyph: "sun", key: "brightness", onChange: () => os.applyAppearance() }),
        verticalSlider({ glyph: "speaker", key: "volume" }),
      ),
      h(
        "div.cc__grid",
        null,
        square("rotate", "Bloqueo de orientación", (button) => {
          const on = toggle("rotationLock")
          button.dataset.on = String(on)
        }, { dataset: { on: String(state.rotationLock) } }),
        square("focus", "Modo concentración", (button) => {
          const on = toggle("dnd")
          button.dataset.on = String(on)
          os.toast({
            title: "No molestar",
            text: on ? "Activado" : "Desactivado",
            glyph: "focus",
            color: "var(--purple)",
          })
        }, { dataset: { on: String(state.dnd) } }),
        square("screen", "Duplicar pantalla", () =>
          os.toast({ title: "Duplicar pantalla", text: "No se encontraron dispositivos", glyph: "screen" }),
        ),
        square("flashlight", "Linterna", (button) => {
          const on = button.dataset.on !== "true"
          button.dataset.on = String(on)
        }),
        square("timer", "Temporizador", () => {
          os.closeControlCenter()
          os.openApp("clock")
        }),
        square("calculator", "Calculadora", () => {
          os.closeControlCenter()
          os.openApp("calculator")
        }),
        square("camera", "Cámara", () => {
          os.closeControlCenter()
          os.openApp("photos")
        }),
        square("hyperbeam", "Sala", () => {
          os.closeControlCenter()
          os.openApp("room")
        }),
      ),
    )
  }

  os.onControlCenterOpen = render

  // Tapping the backdrop dismisses; swiping up dismisses too.
  os.controlCenter.addEventListener("pointerdown", (event) => {
    if (event.target === os.controlCenter) os.closeControlCenter()
  })
  swipe(os.controlCenter, { direction: "up", distance: 40, onSwipe: () => os.closeControlCenter() })

  // The system-wide opening gesture: drag from the top-right corner.
  swipe(os.device, {
    direction: "down",
    distance: 40,
    zone: (x, y, rect) => y < 46 && x > rect.width * 0.55,
    onSwipe: () => os.openControlCenter(),
  })

  render()
  return { render }
}
