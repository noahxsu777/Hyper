/**
 * Music.
 *
 * There is no audio file to ship, so playback is simulated: the progress bar,
 * scrubbing, track changes and the Dynamic Island all behave as if there were.
 */

import { clamp, fill, h } from "../core/dom.js"
import { drag } from "../core/gestures.js"
import { icon } from "../core/icons.js"
import { set, state } from "../core/store.js"
import { action, list, row, screen, tabBar } from "../ui/kit.js"

const LIBRARY = [
  { id: "1", title: "Midnight Drive", artist: "Neon Harbor", length: 214, art: ["#ff375f", "#bf5af2"] },
  { id: "2", title: "Costa Azul", artist: "Marea", length: 187, art: ["#0a84ff", "#40c8e0"] },
  { id: "3", title: "Ruido Blanco", artist: "Sala 9", length: 243, art: ["#8e8e93", "#1c1c1e"] },
  { id: "4", title: "Verano del 98", artist: "Los Cometas", length: 199, art: ["#ff9f0a", "#ff453a"] },
  { id: "5", title: "Silencio", artist: "Aria", length: 268, art: ["#30d158", "#0a84ff"] },
  { id: "6", title: "Tarde de Abril", artist: "Nube Lenta", length: 176, art: ["#bf5af2", "#5e5ce6"] },
]

const clockText = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

const artCss = (track) => `linear-gradient(150deg, ${track.art[0]}, ${track.art[1]})`

export const music = {
  id: "music",
  name: "Música",
  tagline: "Reproductor",
  icon: "music",
  gradient: "linear-gradient(160deg,#fc5c7d 0%,#f5386a 50%,#c1121f 100%)",

  mount(root, ctx) {
    let index = 0
    let position = 0
    let playing = false
    let tab = "now"
    let ticker = null
    const host = h("div.app__body")

    const track = () => LIBRARY[index]

    function play() {
      playing = true
      ctx.island({ text: `${track().title} · ${track().artist}`, tone: "ok" })
      clearInterval(ticker)
      ticker = setInterval(() => {
        position += 0.25
        if (position >= track().length) next()
        else paint()
      }, 250)
      renderTab()
    }

    function pause() {
      playing = false
      clearInterval(ticker)
      ticker = null
      renderTab()
    }

    function next() {
      index = (index + 1) % LIBRARY.length
      position = 0
      if (playing) play()
      else renderTab()
    }

    function previous() {
      if (position > 4) position = 0
      else index = (index - 1 + LIBRARY.length) % LIBRARY.length
      if (playing) play()
      else renderTab()
    }

    let paint = () => {}

    function renderNowPlaying() {
      const art = h("div.music__art", {
        style: { background: artCss(track()) },
        dataset: { playing: String(playing) },
      })
      const fillBar = h("span")
      const scrub = h("div.music__scrub", null, fillBar)
      const elapsed = h("span", { text: clockText(position) })
      const remaining = h("span", { text: `-${clockText(track().length - position)}` })

      paint = () => {
        fillBar.style.width = `${(position / track().length) * 100}%`
        elapsed.textContent = clockText(position)
        remaining.textContent = `-${clockText(Math.max(0, track().length - position))}`
      }
      paint()

      const seek = (clientX) => {
        const rect = scrub.getBoundingClientRect()
        position = clamp((clientX - rect.left) / rect.width, 0, 1) * track().length
        paint()
      }
      drag(scrub, { onStart: (detail) => seek(detail.startX), onMove: (detail) => seek(detail.x) })

      const volume = h("input", {
        type: "range",
        min: "0",
        max: "100",
        value: String(Math.round(state.volume * 100)),
        onInput: (event) => set({ volume: Number(event.target.value) / 100 }),
      })

      return h(
        "div",
        null,
        art,
        h(
          "div.music__meta",
          null,
          h("div.music__title", { text: track().title }),
          h("div.music__artist", { text: track().artist }),
        ),
        scrub,
        h("div.music__times", null, elapsed, remaining),
        h(
          "div.music__controls",
          null,
          h("button", { type: "button", "aria-label": "Anterior", html: icon("backward", { size: 32 }), onClick: previous }),
          h("button", {
            type: "button",
            "aria-label": playing ? "Pausa" : "Reproducir",
            dataset: { role: "play" },
            html: icon(playing ? "pause" : "play", { size: 46 }),
            onClick: () => (playing ? pause() : play()),
          }),
          h("button", { type: "button", "aria-label": "Siguiente", html: icon("forward", { size: 32 }), onClick: next }),
        ),
        h(
          "div.music__volume",
          null,
          h("span", { html: icon("speaker-off", { size: 15 }) }),
          volume,
          h("span", { html: icon("speaker", { size: 15 }) }),
        ),
      )
    }

    function renderLibrary() {
      return list({
        header: "Reproducidas recientemente",
        rows: LIBRARY.map((item, itemIndex) =>
          row({
            label: item.title,
            sub: item.artist,
            value: clockText(item.length),
            onClick: () => {
              index = itemIndex
              position = 0
              tab = "now"
              play()
            },
            accessory: null,
          }),
        ),
      })
    }

    function renderTab() {
      fill(host, tab === "now" ? renderNowPlaying() : renderLibrary())
      header.setTitle(tab === "now" ? "Reproduciendo" : "Biblioteca")

      // Album art for library rows, which the generic row builder cannot express.
      if (tab === "library") {
        host.querySelectorAll(".row").forEach((node, rowIndex) => {
          node.prepend(
            h("span.track-row__art", { style: { background: artCss(LIBRARY[rowIndex]) } }),
          )
        })
      }
    }

    const tabs = tabBar(
      [
        { id: "now", label: "Reproduciendo", glyph: "play" },
        { id: "library", label: "Biblioteca", glyph: "music" },
      ],
      tab,
      (next_) => {
        tab = next_
        renderTab()
      },
    )

    const header = screen({
      title: "Reproduciendo",
      right: action(null, () => ctx.toast({ title: "Opciones", text: "No implementado" }), {
        glyph: "ellipsis",
        side: "right",
      }),
    })

    fill(root, header.navbar, host, tabs)
    host.addEventListener("scroll", () => {
      header.navbar.dataset.scrolled = String(host.scrollTop > 14)
    })
    renderTab()

    return {
      destroy() {
        clearInterval(ticker)
        ctx.hideIsland()
      },
    }
  },
}

export default music
