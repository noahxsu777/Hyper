/** Mail — inbox with unread state and a reading view. */

import { fill, h } from "../core/dom.js"
import { action, list, pushPage, row, screen } from "../ui/kit.js"

const INBOX = [
  {
    id: "m1",
    from: "Hyperbeam",
    subject: "Tu clave de API está lista",
    preview: "Ya puedes lanzar ordenadores virtuales desde tu aplicación…",
    body:
      "Hola,\n\nTu clave de prueba ya está activa. Recuerda que las claves sk_test_ tienen minutos limitados: termina la sesión cuando acabes para no gastarlos.\n\nGuarda la clave en el servidor y nunca la incluyas en el código del navegador.\n\n— El equipo de Hyperbeam",
    at: "09:14",
    unread: true,
  },
  {
    id: "m2",
    from: "Ana",
    subject: "Re: la demo de mañana",
    preview: "Me encaja a las 10. ¿Enseñamos el navegador virtual?",
    body:
      "Me encaja a las 10.\n\n¿Enseñamos el navegador virtual dentro de la interfaz? Creo que es lo que más va a sorprender.\n\nUn abrazo,\nAna",
    at: "Ayer",
    unread: true,
  },
  {
    id: "m3",
    from: "Facturación",
    subject: "Resumen mensual",
    preview: "Tu consumo de este mes está por debajo del límite del plan.",
    body: "Tu consumo de este mes está por debajo del límite del plan.\n\nNo se requiere ninguna acción.",
    at: "lunes",
    unread: false,
  },
  {
    id: "m4",
    from: "Newsletter",
    subject: "Novedades de la semana",
    preview: "Cinco ideas para interfaces que se sienten nativas en la web.",
    body: "Cinco ideas para interfaces que se sienten nativas en la web:\n\n1. Respeta las áreas seguras.\n2. Anima con muelles, no con curvas lineales.\n3. Usa materiales translúcidos con moderación.\n4. Cuida la tipografía tabular en los relojes.\n5. Haz que cada gesto tenga una respuesta inmediata.",
    at: "lunes",
    unread: false,
  },
]

export const mail = {
  id: "mail",
  name: "Mail",
  tagline: "Correo",
  icon: "mail",
  gradient: "linear-gradient(160deg,#5ac8fa 0%,#0a84ff 55%,#0b46c8 100%)",

  mount(root, ctx) {
    const messages = structuredClone(INBOX)
    const host = h("div")

    function openMessage(message) {
      message.unread = false
      render()
      pushPage(root, (close) =>
        screen({
          title: message.subject,
          left: action("Entrada", close, { glyph: "back" }),
          right: action(null, () => {
            close()
            ctx.toast({ title: "Eliminado", text: message.subject, glyph: "trash", color: "var(--red)" })
          }, { glyph: "trash", side: "right", tone: "var(--red)" }),
          body: h(
            "div",
            { style: { padding: "4px 20px 30px" } },
            h("div", { text: message.from, style: { fontSize: "17px", fontWeight: "600" } }),
            h("div", {
              text: `Para: ${"mí"} · ${message.at}`,
              style: { fontSize: "13px", color: "var(--label-2)", marginBottom: "18px" },
            }),
            h("div", {
              text: message.body,
              style: { fontSize: "16px", lineHeight: "1.5", whiteSpace: "pre-wrap" },
            }),
          ),
        }).node,
      )
    }

    function render() {
      const unread = messages.filter((message) => message.unread).length
      fill(
        host,
        list({
          footer: unread ? `${unread} sin leer` : "Todo leído",
          rows: messages.map((message) =>
            row({
              label: message.subject,
              sub: message.preview,
              value: message.at,
              chevron: true,
              onClick: () => openMessage(message),
            }),
          ),
        }),
      )

      host.querySelectorAll(".row").forEach((node, index) => {
        const message = messages[index]
        node.prepend(
          h("span", {
            style: {
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              flex: "none",
              background: message.unread ? "var(--tint)" : "transparent",
            },
          }),
        )
        const label = node.querySelector(".row__label > span")
        if (label) label.textContent = `${message.from} — ${message.subject}`
      })
    }

    const view = screen({
      title: "Entrada",
      right: action(null, () => ctx.toast({ title: "Redactar", text: "No implementado" }), {
        glyph: "plus",
        side: "right",
      }),
      body: host,
    })

    fill(root, view.node)
    render()

    return {}
  },
}

export default mail
