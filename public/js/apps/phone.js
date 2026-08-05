/** Phone — keypad, recents and contacts. Calls are simulated end to end. */

import { fill, h, wait } from "../core/dom.js"
import { icon } from "../core/icons.js"
import { state } from "../core/store.js"
import { action, emptyState, list, row, screen, tabBar } from "../ui/kit.js"

const KEYPAD = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
]

const RECENTS = [
  { name: "Ana", detail: "Móvil", when: "hace 12 min", missed: false },
  { name: "Papá", detail: "Casa", when: "ayer", missed: true },
  { name: "+34 611 22 33 44", detail: "Desconocido", when: "ayer", missed: true },
  { name: "Equipo", detail: "FaceTime", when: "lunes", missed: false },
]

export const phone = {
  id: "phone",
  name: "Teléfono",
  tagline: "Llamadas",
  icon: "phone",
  gradient: "linear-gradient(160deg,#6ef78a 0%,#2fd45a 45%,#12922f 100%)",

  mount(root, ctx) {
    let tab = "keypad"
    let number = ""
    const host = h("div.app__body")
    let callTimer = null

    /** Full-screen call UI with a running duration. */
    async function call(target) {
      const duration = h("div", {
        text: "llamando…",
        style: { fontSize: "17px", opacity: "0.7" },
      })
      const screenEl = h(
        "div",
        {
          style: {
            position: "absolute",
            inset: "0",
            zIndex: "9",
            background: "linear-gradient(180deg,#2c2c31,#0e0e11)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: "calc(var(--safe-top) + 40px)",
            gap: "8px",
          },
        },
        h("div", { text: target, style: { fontSize: "34px", fontWeight: "300" } }),
        duration,
      )

      const hangUp = h(
        "button",
        {
          type: "button",
          style: {
            marginTop: "auto",
            marginBottom: "calc(var(--safe-bottom) + 30px)",
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            background: "var(--red)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            transform: "rotate(135deg)",
          },
          html: icon("phone", { size: 30 }),
        },
      )
      screenEl.append(hangUp)
      root.append(screenEl)

      let seconds = 0
      await wait(1800)
      duration.textContent = "00:00"
      callTimer = setInterval(() => {
        seconds += 1
        duration.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
          seconds % 60,
        ).padStart(2, "0")}`
      }, 1000)

      const end = () => {
        clearInterval(callTimer)
        callTimer = null
        screenEl.remove()
        ctx.toast({
          title: "Llamada finalizada",
          text: `${target} · ${duration.textContent}`,
          glyph: "phone",
          color: "var(--green)",
        })
      }
      hangUp.addEventListener("click", end)
    }

    function renderKeypad() {
      const display = h("div", {
        text: number || "",
        style: {
          fontSize: "36px",
          fontWeight: "300",
          textAlign: "center",
          minHeight: "52px",
          letterSpacing: "1px",
        },
      })

      const keys = h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: "16px 26px",
            padding: "10px 40px",
          },
        },
        ...KEYPAD.map(([digit, letters]) =>
          h(
            "button",
            {
              type: "button",
              style: {
                aspectRatio: "1",
                borderRadius: "50%",
                background: "var(--fill-3)",
                display: "grid",
                placeItems: "center",
                alignContent: "center",
              },
              onClick: () => {
                number += digit
                display.textContent = number
              },
            },
            h("span", { text: digit, style: { fontSize: "32px", fontWeight: "300" } }),
            letters
              ? h("span", {
                  text: letters,
                  style: { fontSize: "10px", letterSpacing: "1.5px", opacity: "0.6" },
                })
              : null,
          ),
        ),
      )

      const callRow = h(
        "div",
        { style: { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "12px 40px" } },
        h("span"),
        h("button", {
          type: "button",
          "aria-label": "Llamar",
          style: {
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            background: "var(--green)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
          },
          html: icon("phone", { size: 30 }),
          onClick: () => {
            if (!number) return
            call(number)
          },
        }),
        number
          ? h("button", {
              type: "button",
              "aria-label": "Borrar",
              style: { justifySelf: "start", color: "var(--label-2)" },
              html: icon("x", { size: 22 }),
              onClick: () => {
                number = number.slice(0, -1)
                renderTab()
              },
            })
          : h("span"),
      )

      return h("div", { style: { paddingTop: "10px" } }, display, keys, callRow)
    }

    function renderRecents() {
      return list({
        rows: RECENTS.map((entry) =>
          row({
            label: entry.name,
            sub: entry.detail,
            value: entry.when,
            tone: entry.missed ? "var(--red)" : null,
            chevron: true,
            onClick: () => call(entry.name),
          }),
        ),
      })
    }

    function renderContacts() {
      const contacts = state.chats.map((chat) => chat.name)
      if (!contacts.length) return emptyState({ glyph: "contacts", title: "Sin contactos" })
      return list({
        rows: contacts.map((name) =>
          row({ label: name, chevron: true, onClick: () => call(name) }),
        ),
      })
    }

    function renderTab() {
      const content =
        tab === "keypad" ? renderKeypad() : tab === "recents" ? renderRecents() : renderContacts()
      fill(host, content)
    }

    const tabs = tabBar(
      [
        { id: "recents", label: "Recientes", glyph: "clock" },
        { id: "contacts", label: "Contactos", glyph: "contacts" },
        { id: "keypad", label: "Teclado", glyph: "calculator" },
      ],
      tab,
      (next) => {
        tab = next
        renderTab()
      },
    )

    const header = screen({
      title: "Teléfono",
      right: action("Editar", () => ctx.toast({ title: "Editar", text: "No implementado" }), {
        side: "right",
      }),
    })

    fill(root, header.navbar, host, tabs)
    renderTab()

    return {
      destroy() {
        if (callTimer) clearInterval(callTimer)
      },
    }
  },
}

export default phone
