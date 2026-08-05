import { fill, h } from "../core/dom.js"
import { icon } from "../core/icons.js"
import { state, subscribe } from "../core/store.js"

export function formatTime(date = new Date(), { seconds = false } = {}) {
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12: false,
  })
}

export function formatDate(date = new Date()) {
  // Spanish lowercases weekdays and months; only the first letter is capitalised.
  const text = date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The status bar: clock on the left, radios and battery on the right. */
export function mountStatusBar(os) {
  const battery = { level: 0.78, charging: false }

  // Use the real battery when the browser exposes it, otherwise a plausible one.
  navigator.getBattery?.().then((api) => {
    const sync = () => {
      battery.level = api.level
      battery.charging = api.charging
      render()
    }
    api.addEventListener("levelchange", sync)
    api.addEventListener("chargingchange", sync)
    sync()
  })

  function render() {
    const radios = state.airplane
      ? [icon("airplane", { size: 16 })]
      : [
          icon("cellular", { size: 17 }),
          state.wifi ? icon("wifi", { size: 16, stroke: 1.9 }) : "",
        ]

    fill(
      os.statusbar,
      h("span.statusbar__time", { text: formatTime() }),
      h(
        "span.statusbar__right",
        null,
        h("span", { html: radios.join("") , style: { display: "flex", gap: "5px", alignItems: "center" } }),
        h(
          "span.battery",
          null,
          h(
            "span.battery__shell",
            null,
            h("span.battery__level", {
              style: {
                width: `${Math.round(battery.level * 100)}%`,
                background: battery.charging ? "var(--green)" : "currentColor",
              },
            }),
          ),
          h("span.battery__cap"),
        ),
      ),
    )
  }

  render()
  subscribe((keys) => {
    if (keys.some((k) => ["wifi", "airplane"].includes(k))) render()
  })

  // Re-render on the minute boundary so the clock never shows a stale value.
  const tick = () => {
    render()
    const now = new Date()
    setTimeout(tick, (60 - now.getSeconds()) * 1000 + 60)
  }
  setTimeout(tick, (60 - new Date().getSeconds()) * 1000 + 60)

  return { render }
}
