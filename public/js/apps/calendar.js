/** Calendar — real month grid with navigation, plus events for the selected day. */

import { fill, h, seeded } from "../core/dom.js"
import { action, emptyState, list, row, screen } from "../ui/kit.js"

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"]
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

const TEMPLATES = [
  { title: "Reunión de equipo", place: "Sala 3", color: "#0a84ff", start: 10, length: 1 },
  { title: "Café con Ana", place: "La Central", color: "#ff9f0a", start: 17, length: 1 },
  { title: "Gimnasio", place: "Basic Fit", color: "#30d158", start: 20, length: 1 },
  { title: "Demo del producto", place: "Online", color: "#bf5af2", start: 12, length: 2 },
  { title: "Cena familiar", place: "Casa", color: "#ff375f", start: 21, length: 2 },
]

const keyOf = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

/** Deterministic events so a day always shows the same agenda. */
function eventsFor(date) {
  const key = keyOf(date)
  const count = Math.floor(seeded(key) * 3)
  return Array.from({ length: count }, (_, index) => {
    const template = TEMPLATES[Math.floor(seeded(`${key}-${index}`) * TEMPLATES.length)]
    return { ...template, id: `${key}-${index}` }
  }).sort((a, b) => a.start - b.start)
}

export const calendar = {
  id: "calendar",
  name: "Calendario",
  tagline: "Eventos",
  icon: "calendar",
  gradient: "linear-gradient(180deg,#ffffff 0%,#f2f2f7 40%,#ff453a 40%,#c1121f 100%)",

  mount(root, ctx) {
    const today = new Date()
    let cursor = new Date(today.getFullYear(), today.getMonth(), 1)
    let selected = new Date(today)

    const grid = h("div.cal__grid")
    const eventsHost = h("div")

    function renderGrid() {
      header.setTitle(`${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`)

      const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
      // Monday-first, like the Spanish locale.
      const offset = (firstDay.getDay() + 6) % 7
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
      const daysInPrev = new Date(cursor.getFullYear(), cursor.getMonth(), 0).getDate()

      const cells = []
      for (let i = 0; i < offset; i++) {
        cells.push({ day: daysInPrev - offset + i + 1, muted: true, date: null })
      }
      for (let day = 1; day <= daysInMonth; day++) {
        cells.push({
          day,
          muted: false,
          date: new Date(cursor.getFullYear(), cursor.getMonth(), day),
        })
      }
      while (cells.length % 7 !== 0) {
        cells.push({ day: cells.length % 7, muted: true, date: null })
      }

      fill(
        grid,
        ...cells.map((cell) => {
          const isToday = cell.date && keyOf(cell.date) === keyOf(today)
          const isSelected = cell.date && keyOf(cell.date) === keyOf(selected)
          const hasEvents = cell.date && eventsFor(cell.date).length > 0
          return h(
            cell.date ? "button.cal__day" : "div.cal__day",
            {
              type: cell.date ? "button" : null,
              dataset: {
                muted: String(cell.muted),
                today: String(Boolean(isToday)),
                selected: String(Boolean(isSelected)),
              },
              onClick: cell.date
                ? () => {
                    selected = cell.date
                    renderGrid()
                    renderEvents()
                  }
                : null,
            },
            h("span", { text: String(cell.day) }),
            hasEvents ? h("span.cal__dot") : null,
          )
        }),
      )
    }

    function renderEvents() {
      const events = eventsFor(selected)
      const label = selected.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })

      if (!events.length) {
        fill(
          eventsHost,
          h("div.list__header", { text: label }),
          emptyState({ glyph: "calendar", title: "Sin eventos", text: "Día libre." }),
        )
        return
      }

      fill(
        eventsHost,
        list({
          header: label,
          rows: events.map((event) =>
            row({
              label: event.title,
              sub: event.place,
              value: `${String(event.start).padStart(2, "0")}:00`,
              onClick: () =>
                ctx.toast({
                  title: event.title,
                  text: `${event.place} · ${event.start}:00–${event.start + event.length}:00`,
                  glyph: "calendar",
                  color: event.color,
                }),
            }),
          ),
        }),
      )
      eventsHost.querySelectorAll(".row").forEach((node, index) => {
        node.prepend(h("span.event-row__bar", { style: { background: events[index].color } }))
      })
    }

    function shiftMonth(delta) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1)
      renderGrid()
    }

    const header = screen({
      title: `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`,
      left: action(null, () => shiftMonth(-1), { glyph: "chevron-left" }),
      right: h(
        "span",
        { style: { display: "flex", gap: "16px", alignItems: "center" } },
        action(null, () => {
          cursor = new Date(today.getFullYear(), today.getMonth(), 1)
          selected = new Date(today)
          renderGrid()
          renderEvents()
        }, { glyph: "home", side: "right" }),
        action(null, () => shiftMonth(1), { glyph: "chevron-right", side: "right" }),
      ),
      body: [
        h("div.cal__head", null, ...WEEKDAYS.map((day) => h("span", { text: day }))),
        grid,
        eventsHost,
      ],
    })

    fill(root, header.node)
    renderGrid()
    renderEvents()

    return {}
  },
}

export default calendar
