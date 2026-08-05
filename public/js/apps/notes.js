/** Notes — list, editor, search and delete, all persisted to localStorage. */

import { fill, h } from "../core/dom.js"
import { commit, state } from "../core/store.js"
import { action, emptyState, list, pushPage, row, screen } from "../ui/kit.js"

const relative = (timestamp) => {
  const date = new Date(timestamp)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  if (sameDay) return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  const yesterday = new Date(today.getTime() - 86400000)
  if (date.toDateString() === yesterday.toDateString()) return "Ayer"
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" })
}

const preview = (note) => {
  const rest = note.body.split("\n").slice(1).join(" ").trim()
  return rest || "Sin texto adicional"
}

const titleOf = (body) => body.split("\n")[0].trim().slice(0, 60) || "Nueva nota"

export const notes = {
  id: "notes",
  name: "Notas",
  tagline: "Escribe y guarda",
  icon: "note",
  gradient: "linear-gradient(160deg,#fff3b0 0%,#ffd60a 45%,#e8a900 100%)",

  mount(root, ctx) {
    let query = ""

    const search = h("input", {
      type: "search",
      placeholder: "Buscar",
      style: {
        width: "calc(100% - 32px)",
        margin: "0 16px 16px",
        padding: "8px 12px",
        borderRadius: "10px",
        background: "var(--fill-3)",
        fontSize: "16px",
      },
      onInput: (event) => {
        query = event.target.value.toLowerCase()
        renderList()
      },
    })

    const listHost = h("div")

    function openEditor(note) {
      const isNew = !note
      const draft = note ?? {
        id: `note-${Date.now()}`,
        title: "Nueva nota",
        body: "",
        updatedAt: Date.now(),
      }

      const textarea = h("textarea", {
        placeholder: "Empieza a escribir…",
        spellcheck: "false",
        text: draft.body,
      })

      let dirty = false
      const save = () => {
        const body = textarea.value
        if (isNew && !body.trim()) return
        draft.body = body
        draft.title = titleOf(body)
        draft.updatedAt = Date.now()
        const existing = state.notes.find((item) => item.id === draft.id)
        if (existing) Object.assign(existing, draft)
        else state.notes.unshift(draft)
        commit(["notes"])
      }

      textarea.addEventListener("input", () => {
        dirty = true
      })

      const pop = pushPage(root, (close) => {
        const done = () => {
          if (dirty || isNew) save()
          close()
          renderList()
        }

        const page = screen({
          left: action("Notas", done, { glyph: "back" }),
          right: h(
            "span",
            { style: { display: "flex", gap: "14px", alignItems: "center" } },
            isNew
              ? null
              : action(null, () => {
                  close()
                  remove(draft)
                }, { glyph: "trash", side: "right", tone: "var(--red)" }),
            action("OK", done, { side: "right" }),
          ),
          body: h(
            "div.note-editor",
            null,
            h("div.note-editor__date", {
              text: new Date(draft.updatedAt).toLocaleString("es-ES", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              }),
            }),
            textarea,
          ),
        })
        setTimeout(() => textarea.focus({ preventScroll: true }), 260)
        return page.node
      })

      return pop
    }

    function remove(note) {
      state.notes = state.notes.filter((item) => item.id !== note.id)
      commit(["notes"])
      renderList()
      ctx.toast({ title: "Nota eliminada", text: note.title, glyph: "trash", color: "var(--red)" })
    }

    function renderList() {
      const visible = state.notes
        .filter(
          (note) =>
            !query ||
            note.title.toLowerCase().includes(query) ||
            note.body.toLowerCase().includes(query),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)

      if (!visible.length) {
        fill(
          listHost,
          emptyState({
            glyph: "note",
            title: query ? "Sin resultados" : "Aún no hay notas",
            text: query ? "Prueba con otra búsqueda." : "Toca el botón + para crear la primera.",
          }),
        )
        return
      }

      fill(
        listHost,
        list({
          footer: `${visible.length} ${visible.length === 1 ? "nota" : "notas"}`,
          rows: visible.map((note) =>
            row({
              label: note.title,
              sub: `${relative(note.updatedAt)}  ·  ${preview(note)}`,
              chevron: true,
              onClick: () => openEditor(note),
            }),
          ),
        }),
      )
    }

    const view = screen({
      title: "Notas",
      right: action(null, () => openEditor(null), { glyph: "plus", side: "right" }),
      body: [search, listHost],
    })

    fill(root, view.node)
    renderList()

    return {}
  },
}

export default notes
