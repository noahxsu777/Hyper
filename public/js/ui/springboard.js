import { clamp, fill, h } from "../core/dom.js"
import { swipe } from "../core/gestures.js"
import { icon } from "../core/icons.js"
import { formatTime } from "./statusbar.js"

const DOCK = ["phone", "room", "messages", "music"]

/** One home-screen icon. */
export function appIcon(app, { onOpen, badge } = {}) {
  const glyph = h("span.app-icon__glyph", {
    style: { background: app.gradient },
    html: icon(app.icon, { size: 34, stroke: app.iconStroke ?? 1.7 }),
  })

  return h(
    "button.app-icon",
    {
      type: "button",
      "aria-label": app.name,
      onClick: (event) => onOpen?.(app.id, event.currentTarget.querySelector(".app-icon__glyph")),
    },
    glyph,
    badge ? h("span.app-icon__badge", { text: String(badge) }) : null,
    h("span.app-icon__label", { text: app.short ?? app.name }),
  )
}

/** The home screen: paged icon grid, widget, dock and page dots. */
export function mountSpringboard(os, apps) {
  const open = (id, originEl) => os.openApp(id, originEl)

  const dockApps = DOCK.map((id) => apps.find((a) => a.id === id)).filter(Boolean)
  const gridApps = apps.filter((a) => !DOCK.includes(a.id))

  // Page 1 keeps room for the 2×2 widget; the rest flow onto later pages.
  const firstPage = gridApps.slice(0, 16)
  const secondPage = gridApps.slice(16)
  const pageDefs = [firstPage, secondPage].filter((page) => page.length)

  const clockWidget = h(
    "button.widget",
    { type: "button", onClick: (event) => open("clock", event.currentTarget) },
    h("div.widget__head", null, h("span", { html: icon("clock", { size: 14 }) }), "Reloj"),
    h("div.widget__big", { text: formatTime() }),
    h("div.widget__sub", { text: "Madrid · Hora local" }),
  )
  setInterval(() => {
    const big = clockWidget.querySelector(".widget__big")
    if (big) big.textContent = formatTime()
  }, 15000)

  const pages = h(
    "div.pages",
    null,
    ...pageDefs.map((pageApps, index) =>
      h(
        "div.page",
        null,
        index === 0 ? clockWidget : null,
        ...pageApps.map((app) => appIcon(app, { onOpen: open, badge: app.badge })),
      ),
    ),
  )

  const dots = h(
    "div.page-dots",
    null,
    ...pageDefs.map((_, index) => h("span", { dataset: { active: String(index === 0) } })),
  )

  const dock = h(
    "div.dock",
    null,
    ...dockApps.map((app) => appIcon(app, { onOpen: open })),
  )

  fill(os.springboard, pages, dots, dock)

  // Keep the dots in sync with horizontal paging.
  pages.addEventListener("scroll", () => {
    const index = clamp(Math.round(pages.scrollLeft / pages.clientWidth), 0, pageDefs.length - 1)
    dots.querySelectorAll("span").forEach((dot, i) => {
      dot.dataset.active = String(i === index)
    })
  })

  // Swipe down on empty home-screen space opens Spotlight.
  swipe(pages, {
    direction: "down",
    distance: 50,
    onSwipe: () => os.openSpotlight(),
  })

  return {
    element: os.springboard,
    goToFirstPage() {
      pages.scrollTo({ left: 0, behavior: "smooth" })
    },
  }
}
