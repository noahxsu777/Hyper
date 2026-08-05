/** Reminders — a real checklist, persisted with the rest of the OS state. */

import { fill, h } from "../core/dom.js"
import { icon } from "../core/icons.js"
import { commit, state } from "../core/store.js"
import { action, emptyState, list, row, screen } from "../ui/kit.js"

// Seeded on first run so the app is not empty on a fresh install.
const SEED = [
  { id: "r1", text: "Probar el navegador virtual", done: false, list: "Hoy" },
  { id: "r2", text: "Cambiar el fondo de pantalla", done: false, list: "Hoy" },
  { id: "r3", text: "Leer la nota de bienvenida", done: true, list: "Hoy" },
]

export const reminders = {
  id: "reminders",
  name: "Recordatorios",
  short: "Record.",
  tagline: "Tareas pendientes",
  icon: "reminders",
  gradient: "linear-gradient(160deg,#ffffff 0%,#f2f2f7 35%,#ff9f0a 35%,#ff375f 100%)",

  mount(root, ctx) {
    if (!state.reminders) {
      state.reminders = structuredClone(SEED)
      commit(["reminders"])
    }

    const host = h("div")
    let showCompleted = false

    function save() {
      commit(["reminders"])
      render()
    }

    function add(text) {
      state.reminders.unshift({
        id: `r-${Date.now()}`,
        text,
        done: false,
        list: "Hoy",
      })
      save()
    }

    function circle(item) {
      return h("button", {
        type: "button",
        "aria-label": item.done ? "Marcar como pendiente" : "Completar",
        style: {
          width: "24px",
          height: "24px",
          borderRadius: "50%",
          border: `1.8px solid ${item.done ? "var(--orange)" : "var(--label-3)"}`,
          background: item.done ? "var(--orange)" : "transparent",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          flex: "none",
        },
        html: item.done ? icon("check", { size: 13, stroke: 3 }) : "",
        onClick: (event) => {
          event.stopPropagation()
          item.done = !item.done
          save()
        },
      })
    }

    function render() {
      const pending = state.reminders.filter((item) => !item.done)
      const done = state.reminders.filter((item) => item.done)
      const visible = showCompleted ? [...pending, ...done] : pending

      const input = h("input", {
        type: "text",
        placeholder: "Nuevo recordatorio",
        style: {
          width: "calc(100% - 32px)",
          margin: "0 16px 20px",
          padding: "12px 14px",
          borderRadius: "12px",
          background: "var(--bg-grouped-secondary)",
          fontSize: "16px",
        },
        onKeydown: (event) => {
          if (event.key !== "Enter") return
          const text = event.target.value.trim()
          if (!text) return
          add(text)
          ctx.toast({ title: "Recordatorio añadido", text, glyph: "reminders", color: "var(--orange)" })
        },
      })

      fill(
        host,
        input,
        visible.length
          ? list({
              header: `${pending.length} pendientes`,
              footer: done.length
                ? `${done.length} completados · toca “${showCompleted ? "Ocultar" : "Mostrar"}” arriba a la derecha`
                : null,
              rows: visible.map((item) =>
                row({
                  label: item.text,
                  tone: item.done ? "var(--label-2)" : null,
                  accessory: h("button", {
                    type: "button",
                    "aria-label": "Eliminar",
                    style: { color: "var(--label-3)" },
                    html: icon("trash", { size: 17 }),
                    onClick: (event) => {
                      event.stopPropagation()
                      state.reminders = state.reminders.filter((entry) => entry.id !== item.id)
                      save()
                    },
                  }),
                }),
              ),
            })
          : emptyState({
              glyph: "reminders",
              title: "Todo hecho",
              text: "No queda nada pendiente por hoy.",
            }),
      )

      // Prepend the completion circles.
      host.querySelectorAll(".row").forEach((node, index) => {
        node.prepend(circle(visible[index]))
      })
    }

    const view = screen({
      title: "Hoy",
      right: action(showCompleted ? "Ocultar" : "Mostrar", (event) => {
        showCompleted = !showCompleted
        event.currentTarget.querySelector("span").textContent = showCompleted ? "Ocultar" : "Mostrar"
        render()
      }, { side: "right" }),
      body: host,
    })

    fill(root, view.node)
    render()

    return {}
  },
}

export default reminders
