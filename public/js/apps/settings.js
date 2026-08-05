/**
 * Settings.
 *
 * Everything here is wired to the real thing: the switches mutate the persisted
 * store, the wallpaper picker repaints the OS, and the Hyperbeam section talks
 * to the backend that owns the API key.
 */

import { fill, h } from "../core/dom.js"
import { api } from "../core/api.js"
import { WALLPAPERS, reset, set, state, wallpaperCss } from "../core/store.js"
import { action, list, pushPage, row, screen, switchControl } from "../ui/kit.js"

const pill = (text, tone) => h("span.status-pill", { text, dataset: { tone } })

export const settings = {
  id: "settings",
  name: "Ajustes",
  tagline: "Preferencias del sistema",
  icon: "gear",
  gradient: "linear-gradient(160deg,#9aa0a8,#5b6068)",

  mount(root, ctx) {
    /* ------------------------------------------------------------ subpages */

    function openDisplay() {
      pushPage(root, (close) => {
        const brightness = h("input", {
          type: "range",
          min: "20",
          max: "100",
          value: String(Math.round(state.brightness * 100)),
          style: { width: "calc(100% - 32px)", margin: "0 16px 26px" },
          onInput: (event) => {
            set({ brightness: Number(event.target.value) / 100 })
          },
        })

        const appearanceRow = (id, label) =>
          row({
            label,
            accessory: switchControl(state.appearance === id, (on) => {
              if (on) set({ appearance: id })
              renderAll()
              close()
              openDisplay()
            }),
          })

        return screen({
          title: "Pantalla y brillo",
          left: action("Ajustes", close, { glyph: "back" }),
          body: [
            list({
              header: "Aspecto",
              rows: [appearanceRow("light", "Claro"), appearanceRow("dark", "Oscuro")],
            }),
            h("div.list__header", { text: "Brillo" }),
            brightness,
          ],
        }).node
      })
    }

    function openWallpaper() {
      pushPage(root, (close) => {
        const picker = h(
          "div.wallpaper-picker",
          null,
          ...WALLPAPERS.map((paper) =>
            h("button", {
              type: "button",
              "aria-label": paper.name,
              dataset: { active: String(state.wallpaper === paper.id) },
              style: { background: paper.css },
              onClick: (event) => {
                set({ wallpaper: paper.id })
                for (const button of picker.children) button.dataset.active = "false"
                event.currentTarget.dataset.active = "true"
              },
            }),
          ),
        )

        return screen({
          title: "Fondo de pantalla",
          left: action("Ajustes", close, { glyph: "back" }),
          body: [
            h("div.list__header", { text: "Elige un fondo" }),
            picker,
            h("div.list__footer", {
              text: "El fondo se aplica al instante en la pantalla de bloqueo y en el inicio.",
            }),
          ],
        }).node
      })
    }

    function openAccessibility() {
      pushPage(root, (close) =>
        screen({
          title: "Accesibilidad",
          left: action("Ajustes", close, { glyph: "back" }),
          body: list({
            header: "Movimiento",
            footer: "Reduce las animaciones de apertura y cierre de apps.",
            rows: [
              row({
                label: "Reducir movimiento",
                accessory: switchControl(state.reduceMotion, (on) => set({ reduceMotion: on })),
              }),
            ],
          }),
        }).node,
      )
    }

    function openAbout() {
      pushPage(root, (close) =>
        screen({
          title: "Información",
          left: action("General", close, { glyph: "back" }),
          body: [
            list({
              rows: [
                row({ label: "Nombre", value: "Hyper" }),
                row({ label: "Versión de HyperOS", value: "1.0" }),
                row({ label: "Modelo", value: "Web" }),
                row({ label: "Navegador virtual", value: "Hyperbeam" }),
                row({ label: "Apps instaladas", value: String(ctx.os.apps.size) }),
              ],
            }),
            list({
              header: "Almacenamiento",
              rows: [
                row({ label: "Capacidad", value: "—" }),
                row({ label: "Notas guardadas", value: String(state.notes.length) }),
                row({ label: "Conversaciones", value: String(state.chats.length) }),
              ],
            }),
          ],
        }).node,
      )
    }

    function openGeneral() {
      pushPage(root, (close) =>
        screen({
          title: "General",
          left: action("Ajustes", close, { glyph: "back" }),
          body: [
            list({
              rows: [
                row({ label: "Información", chevron: true, onClick: openAbout }),
                row({ label: "Actualización de software", value: "Al día", chevron: true, onClick: () => ctx.toast({ title: "Software", text: "HyperOS 1.0 está al día." }) }),
                row({ label: "Fecha y hora", value: "Automática", chevron: true, onClick: () => ctx.toast({ title: "Fecha y hora", text: "Se toma del navegador." }) }),
              ],
            }),
            list({
              header: "Restablecer",
              footer: "Borra notas, conversaciones y preferencias guardadas en este navegador.",
              rows: [
                row({
                  label: "Restablecer todos los ajustes",
                  tone: "var(--red)",
                  onClick: () => {
                    reset()
                    ctx.os.applyAppearance()
                    ctx.toast({
                      title: "Ajustes restablecidos",
                      text: "Se han restaurado los valores de fábrica.",
                      glyph: "power",
                      color: "var(--red)",
                    })
                    close()
                    renderAll()
                  },
                }),
              ],
            }),
          ],
        }).node,
      )
    }

    /* ---------------------------------------------------------- hyperbeam */

    function openHyperbeam() {
      pushPage(root, (close) => {
        const statusHost = h("div")
        const detailHost = h("div")

        async function refresh() {
          fill(statusHost, h("div.list__header", { text: "Estado" }), h("div.list", null, row({ label: "Comprobando…", accessory: h("div.spinner") })))
          try {
            const [config, session] = await Promise.all([api.config(), api.getSession()])

            fill(
              statusHost,
              list({
                header: "Estado",
                rows: [
                  row({
                    label: "Clave de API",
                    accessory: config.configured
                      ? pill(config.testKey ? "Clave de prueba" : "Clave activa", config.testKey ? "warn" : "ok")
                      : pill("Sin configurar", "bad"),
                  }),
                  row({
                    label: "Ordenador virtual",
                    accessory: session ? pill("En marcha", "ok") : pill("Detenido"),
                  }),
                  row({ label: "Resolución", value: config.width ? `${config.width}×${config.height}` : "—" }),
                ],
                footer: config.configured
                  ? config.testKey
                    ? "Las claves de prueba tienen minutos limitados. Termina la sesión cuando acabes."
                    : "La clave vive solo en el servidor; el navegador nunca la recibe."
                  : config.error ?? "Define HYPERBEAM_API_KEY en el archivo .env del servidor.",
              }),
            )

            fill(
              detailHost,
              list({
                header: "Sesión",
                rows: [
                  row({ label: "Identificador", value: session ? `${session.sessionId.slice(0, 12)}…` : "—" }),
                  row({
                    label: "Iniciada",
                    value: session ? new Date(session.createdAt).toLocaleTimeString("es-ES") : "—",
                  }),
                  row({ label: "Página de inicio", value: config.startUrl ?? "—" }),
                ],
              }),
              h("button.btn-filled", {
                type: "button",
                text: session ? "Abrir la sala" : "Iniciar ordenador virtual",
                disabled: !config.configured,
                onClick: async () => {
                  if (session) {
                    close()
                    ctx.openApp("room")
                    return
                  }
                  ctx.toast({ title: "Hyperbeam", text: "Arrancando el ordenador virtual…", glyph: "hyperbeam" })
                  try {
                    await api.createSession()
                    refresh()
                  } catch (error) {
                    ctx.toast({ title: "No se pudo iniciar", text: error.message, glyph: "info", color: "var(--red)" })
                  }
                },
              }),
              session
                ? h("button.btn-filled", {
                    type: "button",
                    text: "Terminar sesión",
                    dataset: { tone: "destructive" },
                    onClick: async () => {
                      await api.endSession().catch(() => {})
                      ctx.toast({
                        title: "Sesión terminada",
                        text: "El ordenador virtual se ha apagado.",
                        glyph: "power",
                        color: "var(--red)",
                      })
                      refresh()
                    },
                  })
                : null,
              h("button.btn-plain", { type: "button", text: "Actualizar estado", onClick: refresh }),
            )
          } catch (error) {
            fill(
              statusHost,
              list({
                header: "Estado",
                rows: [row({ label: "Servidor", accessory: pill("Sin conexión", "bad") })],
                footer: error.message,
              }),
            )
            fill(detailHost)
          }
        }

        const homeUrl = h("input", {
          type: "url",
          value: state.homeUrl,
          placeholder: "https://…",
          style: {
            width: "calc(100% - 32px)",
            margin: "0 16px 26px",
            padding: "12px 14px",
            borderRadius: "12px",
            background: "var(--bg-grouped-secondary)",
            fontSize: "16px",
          },
          onChange: (event) => {
            set({ homeUrl: event.target.value.trim() || "https://www.google.com" })
            ctx.toast({ title: "Página de inicio", text: state.homeUrl, glyph: "compass" })
          },
        })

        refresh()

        return screen({
          title: "Hyperbeam",
          left: action("Ajustes", close, { glyph: "back" }),
          body: [
            statusHost,
            detailHost,
            h("div.list__header", { text: "Página de inicio de la sala" }),
            homeUrl,
            h("div.mono-block", {
              text:
                "POST /api/session → engine.hyperbeam.com/v0/vm\n" +
                "El servidor añade la cabecera Authorization: Bearer <clave> y devuelve\n" +
                "solo el embed_url al navegador.",
            }),
          ],
        }).node
      })
    }

    /* -------------------------------------------------------------- root */

    const host = h("div")

    function renderAll() {
      fill(
        host,
        h(
          "button.settings__profile",
          { type: "button", onClick: () => ctx.toast({ title: state.owner, text: "Cuenta local" }) },
          h("span.settings__avatar", { text: state.owner[0] ?? "H" }),
          h(
            "span",
            null,
            h("span.settings__name", { text: state.owner, style: { display: "block" } }),
            h("span.settings__sub", {
              text: "ID de Hyper · iCloud, Multimedia y Compras",
              style: { display: "block" },
            }),
          ),
        ),

        list({
          rows: [
            row({
              label: "Modo avión",
              glyph: "airplane",
              glyphColor: "var(--orange)",
              accessory: switchControl(state.airplane, (on) => set({ airplane: on })),
            }),
            row({
              label: "Wi-Fi",
              glyph: "hotspot",
              glyphColor: "var(--tint)",
              value: state.airplane ? "No" : state.wifi ? "Hyper-5G" : "No",
              chevron: true,
              onClick: () => {
                set({ wifi: !state.wifi })
                renderAll()
              },
            }),
            row({
              label: "Bluetooth",
              glyph: "bluetooth",
              glyphColor: "var(--tint)",
              value: state.bluetooth ? "Sí" : "No",
              chevron: true,
              onClick: () => {
                set({ bluetooth: !state.bluetooth })
                renderAll()
              },
            }),
          ],
        }),

        list({
          rows: [
            row({
              label: "Notificaciones",
              glyph: "bell",
              glyphColor: "var(--red)",
              chevron: true,
              onClick: () => ctx.toast({ title: "Notificaciones", text: "Todas activadas" }),
            }),
            row({
              label: "Sonidos y vibración",
              glyph: "speaker",
              glyphColor: "var(--pink)",
              chevron: true,
              onClick: () => ctx.toast({ title: "Sonidos", text: `Volumen al ${Math.round(state.volume * 100)}%` }),
            }),
            row({
              label: "Modo concentración",
              glyph: "focus",
              glyphColor: "var(--purple)",
              value: state.dnd ? "Activado" : "Desactivado",
              chevron: true,
              onClick: () => {
                set({ dnd: !state.dnd })
                renderAll()
              },
            }),
          ],
        }),

        list({
          rows: [
            row({ label: "General", glyph: "gear", glyphColor: "var(--gray)", chevron: true, onClick: openGeneral }),
            row({
              label: "Pantalla y brillo",
              glyph: "sun",
              glyphColor: "var(--indigo)",
              value: state.appearance === "dark" ? "Oscuro" : "Claro",
              chevron: true,
              onClick: openDisplay,
            }),
            row({
              label: "Fondo de pantalla",
              glyph: "photo",
              glyphColor: "var(--teal)",
              chevron: true,
              onClick: openWallpaper,
            }),
            row({
              label: "Accesibilidad",
              glyph: "hand",
              glyphColor: "var(--tint)",
              chevron: true,
              onClick: openAccessibility,
            }),
          ],
        }),

        list({
          header: "Navegador virtual",
          footer: "Controla el ordenador virtual que Safari transmite a esta pantalla.",
          rows: [
            row({
              label: "Hyperbeam",
              glyph: "hyperbeam",
              glyphColor: "var(--tint)",
              chevron: true,
              onClick: openHyperbeam,
            }),
            row({
              label: "Sala",
              glyph: "hyperbeam",
              glyphColor: "#7c5cff",
              chevron: true,
              onClick: () => ctx.openApp("room"),
            }),
          ],
        }),
      )

      // Keep the live wallpaper preview honest.
      const avatar = host.querySelector(".settings__avatar")
      if (avatar) avatar.style.backgroundImage = wallpaperCss()
    }

    const view = screen({ title: "Ajustes", body: host })
    fill(root, view.node)
    renderAll()

    return {}
  },
}

export default settings
