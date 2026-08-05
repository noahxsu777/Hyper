/** App Store — a showcase of everything installed on this device. */

import { fill, h } from "../core/dom.js"
import { icon } from "../core/icons.js"
import { commit, state } from "../core/store.js"
import { action, list, row, screen, tabBar } from "../ui/kit.js"

const FEATURED = [
  {
    id: "room",
    kicker: "App del día",
    title: "Sala",
    blurb: "Un Chromium real y compartido, con chat, llamada y teclado remoto.",
    glyph: "hyperbeam",
    cover: "linear-gradient(140deg,#7c5cff,#a78bfa 55%,#2a0f7a)",
  },
  {
    id: "weather",
    kicker: "Imprescindible",
    title: "Tiempo",
    blurb: "Previsión por horas y para siete días con un diseño de vidrio.",
    glyph: "cloud-sun",
    cover: "linear-gradient(140deg,#2f7fd8,#5ac8fa 60%,#16233f)",
  },
  {
    id: "clock",
    kicker: "Productividad",
    title: "Reloj",
    blurb: "Reloj mundial, cronómetro con vueltas y temporizador.",
    glyph: "clock",
    cover: "linear-gradient(140deg,#2c2c31,#5a5a63 60%,#0b0b0d)",
  },
]

export const appstore = {
  id: "appstore",
  name: "App Store",
  short: "Store",
  tagline: "Descubre apps",
  icon: "store",
  gradient: "linear-gradient(160deg,#3ba0ff 0%,#0a84ff 50%,#0b46c8 100%)",

  mount(root, ctx) {
    let tab = "today"
    const host = h("div.app__body")

    const installed = (id) => id === "room" || state.installed.includes(id)

    function renderToday() {
      const today = new Date().toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
      return h(
        "div",
        null,
        h("div.list__header", { text: today }),
        ...FEATURED.map((item) =>
          h(
            "button.store__card",
            { type: "button", onClick: () => ctx.openApp(item.id) },
            h(
              "div.store__cover",
              { style: { background: item.cover } },
              h("b", { text: item.kicker }),
              h("span", { html: icon(item.glyph, { size: 66, stroke: 1.3 }) }),
            ),
            h(
              "div.store__meta",
              null,
              h("h3", { text: item.title }),
              h("p", { text: item.blurb }),
            ),
          ),
        ),
      )
    }

    function renderApps() {
      const all = [...ctx.os.apps.values()].filter((app) => app.id !== "appstore")
      return list({
        header: "En este dispositivo",
        footer: "Todas las apps vienen preinstaladas con HyperOS.",
        rows: all.map((app) =>
          row({
            label: app.name,
            sub: app.tagline,
            glyph: app.icon,
            glyphColor: "transparent",
            accessory: h("button.get-btn", {
              type: "button",
              text: installed(app.id) ? "ABRIR" : "OBTENER",
              dataset: { state: installed(app.id) ? "installed" : "available" },
              onClick: (event) => {
                event.stopPropagation()
                if (!installed(app.id)) {
                  state.installed.push(app.id)
                  commit(["installed"])
                  event.currentTarget.textContent = "ABRIR"
                  event.currentTarget.dataset.state = "installed"
                  ctx.toast({ title: app.name, text: "Instalada", glyph: "store", color: "var(--tint)" })
                  return
                }
                ctx.openApp(app.id)
              },
            }),
            onClick: () => ctx.openApp(app.id),
          }),
        ),
      })
    }

    function renderTab() {
      fill(host, tab === "today" ? renderToday() : renderApps())
      header.setTitle(tab === "today" ? "Hoy" : "Apps")
    }

    // Give the store rows real app icons instead of flat glyphs.
    function decorate() {
      if (tab !== "apps") return
      const all = [...ctx.os.apps.values()].filter((app) => app.id !== "appstore")
      host.querySelectorAll(".row__icon").forEach((node, index) => {
        node.style.background = all[index]?.gradient ?? "var(--gray)"
        node.style.width = "44px"
        node.style.height = "44px"
        node.style.borderRadius = "10px"
      })
    }

    const tabs = tabBar(
      [
        { id: "today", label: "Hoy", glyph: "store" },
        { id: "apps", label: "Apps", glyph: "files" },
      ],
      tab,
      (next) => {
        tab = next
        renderTab()
        decorate()
      },
    )

    const header = screen({
      title: "Hoy",
      right: action(null, () => ctx.toast({ title: "Cuenta", text: "Sesión local" }), {
        glyph: "contacts",
        side: "right",
      }),
    })

    fill(root, header.navbar, host, tabs)
    host.addEventListener("scroll", () => {
      header.navbar.dataset.scrolled = String(host.scrollTop > 14)
    })
    renderTab()

    return {}
  },
}

export default appstore
