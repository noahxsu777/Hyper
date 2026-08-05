import { fill, h } from "../core/dom.js"
import { drag } from "../core/gestures.js"
import { icon } from "../core/icons.js"
import { state } from "../core/store.js"
import { formatDate, formatTime } from "./statusbar.js"

const NOTIFICATIONS = [
  {
    app: "Mensajes",
    color: "#30d158",
    glyph: "message",
    title: "Ana",
    text: "Se ve igualito a un iPhone",
    at: "hace 52 min",
    open: "messages",
  },
  {
    app: "Hyperbeam",
    color: "#7c5cff",
    glyph: "hyperbeam",
    title: "Sala",
    text: "Tu navegador virtual está listo para abrirse",
    at: "ahora",
    open: "room",
  },
]

/** Lock screen: clock, widgets, notifications, and swipe-to-unlock. */
export function mountLockScreen(os) {
  function clockNodes() {
    return h(
      "div.lock__clock",
      null,
      h("div.lock__date", { text: formatDate() }),
      h("div.lock__time", { text: formatTime() }),
    )
  }

  function render() {
    fill(
      os.lockscreen,
      clockNodes(),
      h(
        "div.lock__widgets",
        null,
        h(
          "div.lock__widget",
          null,
          h("b", { text: "Clima" }),
          h("strong", { text: "21°" }),
          h("div", { text: "Parcialmente nublado" }),
        ),
        h(
          "div.lock__widget",
          null,
          h("b", { text: "Batería" }),
          h("strong", { text: "78%" }),
          h("div", { text: "Sin carga" }),
        ),
      ),
      h(
        "div.lock__notifications",
        null,
        ...NOTIFICATIONS.map((notification, index) =>
          h(
            "div.notification",
            {
              style: { animationDelay: `${index * 90}ms` },
              onClick: () => {
                os.unlock()
                setTimeout(() => os.openApp(notification.open), 220)
              },
            },
            h("div.notification__icon", {
              style: { background: notification.color },
              html: icon(notification.glyph, { size: 20 }),
            }),
            h(
              "div.notification__body",
              null,
              h("div.notification__title", { text: notification.title }),
              h("div.notification__text", { text: notification.text }),
            ),
            h("div.notification__time", { text: notification.at }),
          ),
        ),
        h(
          "div.lock__hint",
          { style: { alignSelf: "center" } },
          h("span", { html: icon("chevron-up", { size: 16 }) }),
          "Desliza para abrir",
        ),
      ),
      h(
        "div.lock__quick",
        null,
        h("button", {
          "aria-label": "Linterna",
          html: icon("flashlight", { size: 21 }),
          onClick: (event) => {
            event.stopPropagation()
            os.toast({ title: "Linterna", text: "Encendida", glyph: "flashlight", color: "#ffd60a" })
          },
        }),
        h("button", {
          "aria-label": "Cámara",
          html: icon("camera", { size: 21 }),
          onClick: (event) => {
            event.stopPropagation()
            os.unlock()
            setTimeout(() => os.openApp("photos"), 220)
          },
        }),
      ),
    )
  }

  render()
  setInterval(() => {
    if (os.locked) render()
  }, 20000)

  // Swipe up (or tap the hint area) to unlock.
  drag(os.lockscreen, {
    threshold: 4,
    onMove(detail) {
      if (!os.locked || detail.dy > 0) return
      const progress = Math.min(1, -detail.dy / 220)
      os.lockscreen.style.transform = `translateY(${detail.dy * 0.8}px)`
      os.lockscreen.style.opacity = String(1 - progress * 0.9)
    },
    onEnd(detail) {
      os.lockscreen.style.transform = ""
      os.lockscreen.style.opacity = ""
      if (!os.locked) return
      const swipedUp = -detail.dy > 70 || -detail.vy > 0.4
      const tapped = !detail.moved
      if (swipedUp || tapped) os.unlock()
    },
  })

  return { render }
}
