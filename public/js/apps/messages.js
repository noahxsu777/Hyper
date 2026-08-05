/** Messages — conversation list, thread view, composer and a chatty reply bot. */

import { fill, h } from "../core/dom.js"
import { icon } from "../core/icons.js"
import { commit, state } from "../core/store.js"
import { action, list, pushPage, row, screen } from "../ui/kit.js"

const REPLIES = [
  "Jaja, buenísimo",
  "Te leo 👀",
  "Voy en camino",
  "¿Te parece si lo vemos mañana?",
  "Vale, apuntado",
  "Mándame el enlace cuando puedas",
  "Perfecto 👌",
]

const stamp = (at) =>
  new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false })

const dayStamp = (at) => {
  const date = new Date(at)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return `Hoy ${stamp(at)}`
  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "short",
  })
}

export const messages = {
  id: "messages",
  name: "Mensajes",
  tagline: "Conversaciones",
  icon: "message",
  gradient: "linear-gradient(160deg,#6ef78a 0%,#2fd45a 45%,#0f9e33 100%)",

  mount(root, ctx) {
    const timers = new Set()
    const listHost = h("div")

    function openThread(chat) {
      const thread = h("div.thread")
      const composerField = h("textarea.composer__field", {
        rows: "1",
        placeholder: "Mensaje",
        "aria-label": "Mensaje",
      })
      const sendBtn = h("button.composer__send", {
        type: "button",
        disabled: true,
        "aria-label": "Enviar",
        html: icon("arrow-up", { size: 19, stroke: 2.4 }),
      })

      let body = null

      function scrollToEnd() {
        requestAnimationFrame(() => {
          if (body) body.scrollTop = body.scrollHeight
        })
      }

      function renderThread() {
        const nodes = []
        let lastAt = 0
        for (const message of chat.messages) {
          if (message.at - lastAt > 1000 * 60 * 30) {
            nodes.push(h("div.thread__stamp", { text: dayStamp(message.at) }))
          }
          lastAt = message.at
          nodes.push(
            h("div.bubble", {
              class: message.from === "me" ? "bubble--out" : "bubble--in",
              text: message.text,
            }),
          )
        }
        fill(thread, ...nodes)
        scrollToEnd()
      }

      function send() {
        const text = composerField.value.trim()
        if (!text) return
        chat.messages.push({ from: "me", text, at: Date.now() })
        commit(["chats"])
        composerField.value = ""
        composerField.style.height = "auto"
        sendBtn.disabled = true
        renderThread()

        // Typing indicator, then a reply.
        const typing = h("div.bubble.bubble--in.bubble--typing", null, h("i"), h("i"), h("i"))
        const typingTimer = setTimeout(() => {
          thread.append(typing)
          scrollToEnd()
        }, 500)
        const replyTimer = setTimeout(
          () => {
            typing.remove()
            chat.messages.push({
              from: "them",
              text: REPLIES[Math.floor(Math.random() * REPLIES.length)],
              at: Date.now(),
            })
            commit(["chats"])
            renderThread()
          },
          1400 + Math.random() * 900,
        )
        timers.add(typingTimer)
        timers.add(replyTimer)
      }

      composerField.addEventListener("input", () => {
        sendBtn.disabled = !composerField.value.trim()
        composerField.style.height = "auto"
        composerField.style.height = `${Math.min(100, composerField.scrollHeight)}px`
      })
      composerField.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          send()
        }
      })
      sendBtn.addEventListener("click", send)

      pushPage(root, (close) => {
        const view = screen({
          left: action(null, close, { glyph: "back" }),
          body: thread,
        })
        // Contact header in place of the large title.
        view.navbar.querySelector(".navbar__row").children[1].replaceWith(
          h(
            "div",
            { style: { flex: "1", textAlign: "center" } },
            h("div.chat-row__avatar", {
              text: chat.name[0],
              style: {
                background: chat.color,
                width: "34px",
                height: "34px",
                fontSize: "14px",
                margin: "0 auto 2px",
              },
            }),
            h("div", { text: chat.name, style: { fontSize: "12px", fontWeight: "600" } }),
          ),
        )
        body = view.body
        const wrapper = h("div", { style: { display: "contents" } }, view.node, h("div.composer", null, composerField, sendBtn))
        renderThread()
        return wrapper
      })
    }

    function renderList() {
      const sorted = [...state.chats].sort(
        (a, b) => (b.messages.at(-1)?.at ?? 0) - (a.messages.at(-1)?.at ?? 0),
      )
      fill(
        listHost,
        list({
          rows: sorted.map((chat) => {
            const last = chat.messages.at(-1)
            return row({
              label: chat.name,
              sub: last?.text ?? "Sin mensajes",
              value: last ? stamp(last.at) : "",
              chevron: true,
              onClick: () => openThread(chat),
              accessory: null,
              insetIcon: true,
              glyph: null,
            })
          }),
        }),
      )

      // Prepend avatars: the generic row builder has no avatar slot.
      const rows = listHost.querySelectorAll(".row")
      rows.forEach((node, index) => {
        const chat = sorted[index]
        node.prepend(
          h("span.chat-row__avatar", { text: chat.name[0], style: { background: chat.color } }),
        )
      })
    }

    const view = screen({
      title: "Mensajes",
      right: action(null, () => ctx.toast({ title: "Nuevo mensaje", text: "Todavía no implementado" }), {
        glyph: "plus",
        side: "right",
      }),
      body: listHost,
    })

    fill(root, view.node)
    renderList()

    return {
      destroy() {
        for (const timer of timers) clearTimeout(timer)
      },
    }
  },
}

export default messages
