import { fill, h } from "../core/dom.js"
import { swipe } from "../core/gestures.js"
import { icon } from "../core/icons.js"
import { state } from "../core/store.js"

const normalize = (value) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

/** Spotlight: fuzzy-ish search over apps, notes, chats, plus a web fallback. */
export function mountSpotlight(os, apps) {
  const input = h("input", {
    type: "search",
    placeholder: "Buscar",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Buscar",
  })

  const results = h("div.spotlight__results")

  function row({ glyph, gradient, title, subtitle, onClick }) {
    return h(
      "button.spotlight__row",
      { type: "button", onClick },
      h("span.app-icon__glyph", {
        style: { background: gradient },
        html: icon(glyph, { size: 23 }),
      }),
      h(
        "span",
        { style: { minWidth: 0, flex: "1", textAlign: "left" } },
        h("span.spotlight__row__title", { text: title, style: { display: "block" } }),
        subtitle && h("span.spotlight__row__sub", { text: subtitle, style: { display: "block" } }),
      ),
    )
  }

  function launch(id) {
    os.closeSpotlight()
    os.openApp(id)
  }

  function render() {
    const query = normalize(input.value.trim())
    const sections = []

    const matchedApps = query
      ? apps.filter((app) => normalize(app.name).includes(query) || normalize(app.id).includes(query))
      : apps.slice(0, 8)

    if (matchedApps.length) {
      sections.push(
        h("div.spotlight__section", { text: query ? "Aplicaciones" : "Sugerencias de Siri" }),
        ...matchedApps.map((app) =>
          row({
            glyph: app.icon,
            gradient: app.gradient,
            title: app.name,
            subtitle: app.tagline,
            onClick: () => launch(app.id),
          }),
        ),
      )
    }

    if (query) {
      const notes = state.notes.filter(
        (note) => normalize(note.title).includes(query) || normalize(note.body).includes(query),
      )
      if (notes.length) {
        sections.push(
          h("div.spotlight__section", { text: "Notas" }),
          ...notes.map((note) =>
            row({
              glyph: "note",
              gradient: "linear-gradient(160deg,#ffe27a,#f2b705)",
              title: note.title,
              subtitle: note.body.split("\n").slice(1).join(" ").slice(0, 60) || "Nota",
              onClick: () => launch("notes"),
            }),
          ),
        )
      }

      const chats = state.chats.filter((chat) => normalize(chat.name).includes(query))
      if (chats.length) {
        sections.push(
          h("div.spotlight__section", { text: "Mensajes" }),
          ...chats.map((chat) =>
            row({
              glyph: "message",
              gradient: "linear-gradient(160deg,#5ff77f,#12a03a)",
              title: chat.name,
              subtitle: chat.messages.at(-1)?.text,
              onClick: () => launch("messages"),
            }),
          ),
        )
      }

      sections.push(
        h("div.spotlight__section", { text: "Buscar en la web" }),
        row({
          glyph: "hyperbeam",
          gradient: "linear-gradient(160deg,#a78bfa,#4c1fd7)",
          title: `Buscar “${input.value.trim()}”`,
          subtitle: "Abrir en el navegador virtual",
          onClick: () => {
            const term = input.value.trim()
            os.closeSpotlight()
            os.openApp("room").then(() => {
              os.running?.instance?.navigate?.(term)
            })
          },
        }),
      )
    }

    fill(results, ...sections)
    if (!sections.length) {
      fill(results, h("div.spotlight__empty", { text: "Sin resultados" }))
    }
  }

  fill(
    os.spotlight,
    h(
      "div.spotlight__field",
      null,
      h("span", { html: icon("search", { size: 18 }) }),
      input,
      h("button", {
        type: "button",
        "aria-label": "Cerrar",
        html: icon("x", { size: 16 }),
        onClick: () => os.closeSpotlight(),
      }),
    ),
    results,
  )

  input.addEventListener("input", render)
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") os.closeSpotlight()
    if (event.key === "Enter") results.querySelector(".spotlight__row")?.click()
  })

  swipe(os.spotlight, {
    direction: "up",
    distance: 50,
    zone: (_x, _y, rect) => rect.height > 0,
    onSwipe: () => os.closeSpotlight(),
  })

  os.onSpotlightOpen = () => {
    input.value = ""
    render()
    setTimeout(() => input.focus({ preventScroll: true }), 120)
  }
  os.onSpotlightClose = () => input.blur()

  render()
  return { render }
}
