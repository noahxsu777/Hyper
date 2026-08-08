/**
 * The room's apps: what the shared screen shows when it is not the Hyperbeam
 * browser. Synced YouTube, a Twitch channel, Netflix start cues, and board
 * games whose rules live on the server.
 *
 * This module draws and sends intentions; the server owns every decision.
 */

import { fill, h } from "./core/dom.js"
import { icon } from "./core/icons.js"
import { api } from "./core/api.js"

/* ------------------------------------------------------------- catalog */

export const APP_CATALOG = [
  {
    id: "youtube", section: "Medios", name: "YouTube", mark: "▶", tone: "#ff0033",
    desc: "Vídeos y música, sincronizados para toda la sala",
  },
  {
    id: "twitch", section: "Medios", name: "Twitch", mark: "T", tone: "#9146ff",
    desc: "Streams en vivo, todos en el mismo canal",
  },
  {
    id: "netflix", section: "Medios", name: "Netflix", mark: "N", tone: "#e50914",
    desc: "Cada uno con su cuenta; la sala sincroniza el play",
  },
  {
    id: "c4", section: "Juegos", name: "Cuatro en raya", mark: "●", tone: "#e5484d",
    desc: "Conecta cuatro fichas en una fila",
  },
  {
    id: "chess", section: "Juegos", name: "Ajedrez", mark: "♞", tone: "#9b9ba5",
    desc: "Con todas las reglas: enroque, al paso, jaque mate",
  },
  {
    id: "damas", section: "Juegos", name: "Damas", mark: "◉", tone: "#f5a623",
    desc: "Captura obligatoria y damas coronadas",
  },
  {
    id: "ttt", section: "Juegos", name: "Tres en raya", mark: "✕", tone: "#30a46c",
    desc: "El clásico de tres en línea",
  },
]

/**
 * Everything this module needs from the room, handed over once:
 * { send, canModerate, you, sheet, toast, container, cueLayer, browserLive }
 */
let ctx = null
export function initApps(context) {
  ctx = context
}

/* -------------------------------------------------------------- gallery */

export function openAppsGallery() {
  ctx.sheet((close) => {
    const grid = h("div.apps__grid")
    const search = h("input.field", {
      type: "search",
      placeholder: "Buscar apps…",
      "aria-label": "Buscar apps",
      onInput: () => draw(search.value),
    })

    const blocked = ctx.browserLive()

    const draw = (query = "") => {
      const q = query.trim().toLowerCase()
      const matches = APP_CATALOG.filter(
        (app) => !q || app.name.toLowerCase().includes(q) || app.desc.toLowerCase().includes(q),
      )
      const sections = [...new Set(matches.map((app) => app.section))]
      fill(
        grid,
        matches.length === 0 ? h("p.apps__none", { text: "Ninguna app se llama así." }) : null,
        ...sections.flatMap((section) => [
          h("div.apps__section", { text: section }),
          h(
            "div.apps__tiles",
            null,
            ...matches
              .filter((app) => app.section === section)
              .map((app) =>
                h(
                  "button.app-tile",
                  {
                    type: "button",
                    disabled: blocked,
                    onClick: () => {
                      ctx.send({ action: "open", app: app.id })
                      close()
                    },
                  },
                  h("span.app-tile__mark", { text: app.mark, style: { background: app.tone } }),
                  h("span.app-tile__name", { text: app.name }),
                  h("span.app-tile__desc", { text: app.desc }),
                ),
              ),
          ),
        ]),
      )
    }

    draw()
    setTimeout(() => search.focus({ preventScroll: true }), 60)

    return [
      h("div.sheet__title", { text: "Apps de la sala" }),
      h("div.sheet__text", {
        text: blocked
          ? "El navegador compartido está en marcha. Ciérralo para usar las apps: la pantalla es una."
          : "Se abren para toda la sala, sin gastar minutos del navegador compartido.",
      }),
      search,
      grid,
      h("button.btn", { type: "button", dataset: { tone: "quiet" }, text: "Cerrar", onClick: close }),
    ]
  })
}

/* -------------------------------------------------------- the active view */

/**
 * One live view at a time. Board games are cheap and redraw whole; YouTube
 * and Twitch keep a stable root, because re-inserting an iframe reloads it.
 */
let view = null

export function renderActivity(activity) {
  const host = ctx.container
  if (!activity) {
    view?.destroy?.()
    view = null
    host.hidden = true
    fill(host)
    return
  }

  host.hidden = false
  const key = activity.kind === "game" ? `game:${activity.game}` : activity.kind
  if (!view || view.key !== key) {
    view?.destroy?.()
    view = buildView(activity)
    view.key = key
    fill(host, view.root)
  }
  view.update(activity)
}

/** The film's personal volume, forwarded to whichever player is up. */
let appVolume = 100
export function setAppVolume(volume) {
  appVolume = volume
  view?.setVolume?.(volume)
}

function buildView(activity) {
  switch (activity.kind) {
    case "youtube": return youtubeView()
    case "twitch": return twitchView()
    case "netflix": return netflixView()
    case "game": return gameView(activity.game)
    default: return { root: h("div"), update() {} }
  }
}

/** Shared frame: coloured mark, title, and the close button for moderators. */
function appBar(appId, extra = null) {
  const app = APP_CATALOG.find((entry) => entry.id === appId)
  return h(
    "header.appview__bar",
    null,
    h("span.app-tile__mark", { text: app.mark, style: { background: app.tone } }),
    h("span.appview__title", { text: app.name }),
    extra,
    h("span.appview__spacer"),
    ctx.canModerate()
      ? h("button.icon-btn", {
          type: "button",
          "aria-label": "Cerrar la app",
          html: icon("x", { size: 17 }),
          onClick: () => ctx.send({ action: "close" }),
        })
      : null,
  )
}

/* -------------------------------------------------------------- youtube */

let ytApiPromise = null

/**
 * YouTube's IFrame API, fetched once. It can fail — an ad blocker, a captive
 * portal — and the room must degrade to words instead of a black rectangle.
 */
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 10000)
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer)
        resolve(window.YT)
      }
      const script = document.createElement("script")
      script.src = "https://www.youtube.com/iframe_api"
      script.onerror = () => {
        clearTimeout(timer)
        reject(new Error("network"))
      }
      document.head.append(script)
    }).catch((error) => {
      ytApiPromise = null
      throw error
    })
  }
  return ytApiPromise
}

const mmss = (seconds) => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function youtubeView() {
  let player = null
  let playerId = null
  let dead = false
  let failed = false
  // The room's clock: position at the moment the last event arrived.
  let synced = { position: 0, playing: false, receivedAt: Date.now(), videoId: null }

  const localPosition = () =>
    synced.position + (synced.playing ? (Date.now() - synced.receivedAt) / 1000 : 0)

  const playerHost = h("div.appview__player", null, h("div"))
  const note = h("p.appview__note", { hidden: true })
  const results = h("div.ytsearch", { hidden: true })
  const body = h("div.appview__body", null, playerHost, note, results)
  const foot = h("footer.appview__foot")
  const root = h("div.appview__frame", null, appBar("youtube"), body, foot)

  const say = (text) => {
    note.hidden = !text
    note.textContent = text ?? ""
  }

  async function ensurePlayer(videoId) {
    if (failed) return
    try {
      const YT = await loadYouTubeApi()
      if (dead) return
      if (!player) {
        player = new YT.Player(playerHost.firstChild, {
          videoId,
          width: "100%",
          height: "100%",
          // Our bar is the only remote control; the iframe's own UI would let
          // anyone drive their copy out of sync.
          playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1 },
          events: {
            onReady: () => {
              playerId = videoId
              player.setVolume(appVolume)
              applySync(true)
            },
            onError: () => say("YouTube no quiere reproducir ese vídeo aquí."),
          },
        })
      } else if (playerId !== videoId) {
        playerId = videoId
        player.loadVideoById(videoId, localPosition())
      }
    } catch {
      failed = true
      say("No se pudo cargar el reproductor de YouTube. Comprueba la conexión y vuelve a abrir la app.")
    }
  }

  /** Pull the local player onto the room's clock. */
  function applySync(hard = false) {
    if (!player?.seekTo || playerId !== synced.videoId) return
    const drift = Math.abs((player.getCurrentTime?.() ?? 0) - localPosition())
    if (hard || drift > 1.5) player.seekTo(localPosition(), true)
    if (synced.playing) player.playVideo?.()
    else player.pauseVideo?.()
  }

  const timeLabel = h("span.appview__time", { text: "0:00" })
  const seekBar = h("input", {
    type: "range", min: "0", max: "100", step: "1", value: "0",
    "aria-label": "Posición del vídeo",
    onInput: () => ctx.send({ action: "seek", position: Number(seekBar.value) }),
  })

  const ticker = setInterval(() => {
    if (!synced.videoId) return
    timeLabel.textContent = mmss(localPosition())
    const duration = player?.getDuration?.() ?? 0
    if (duration > 0) {
      seekBar.max = String(Math.floor(duration))
      if (document.activeElement !== seekBar) seekBar.value = String(Math.floor(localPosition()))
    }
    if (synced.playing) applySync()
  }, 750)

  /* One box, two behaviours: a pasted link plays straight away, and anything
     else is a search — the GroupTube way. The search runs through our server,
     which asks YouTube's own web API; no key of ours is involved. */

  const looksLikeVideo = (value) =>
    /^[\w-]{11}$/.test(value.trim()) || /youtube\.com|youtu\.be/.test(value)

  const playVideo = (video) => {
    ctx.send({ action: synced.videoId ? "video" : "open", app: "youtube", video })
    results.hidden = true
    fill(results)
  }

  async function searchVideos(query) {
    results.hidden = false
    fill(results, h("div.spinner"), h("p.appview__note", { text: `Buscando «${query}»…` }))
    try {
      const { videos } = await api.youtube(query)
      fill(
        results,
        h("button.icon-btn.ytsearch__close", {
          type: "button",
          "aria-label": "Cerrar la búsqueda",
          html: icon("x", { size: 16 }),
          onClick: () => {
            results.hidden = true
            fill(results)
          },
        }),
        videos.length === 0 ? h("p.appview__note", { text: "Nada con ese nombre." }) : null,
        h(
          "div.ytsearch__grid",
          null,
          ...videos.map((video) =>
            h(
              "button.ytresult",
              { type: "button", onClick: () => playVideo(video.id) },
              h(
                "span.ytresult__thumb",
                null,
                h("img", { src: video.thumb, alt: "", loading: "lazy" }),
                video.duration ? h("span.ytresult__time", { text: video.duration }) : null,
              ),
              h("span.ytresult__title", { text: video.title }),
              h("span.ytresult__channel", { text: video.channel }),
            ),
          ),
        ),
      )
    } catch (error) {
      fill(
        results,
        h("p.appview__note", { text: `La búsqueda no funcionó: ${error.message}` }),
        h("p.appview__note", { text: "Pegar un enlace de YouTube sigue funcionando." }),
      )
    }
  }

  const videoField = h("input.field", {
    type: "search",
    placeholder: "Busca en YouTube o pega un enlace",
    "aria-label": "Buscar en YouTube",
  })
  const sendVideo = () => {
    const value = videoField.value.trim()
    if (!value) return
    if (looksLikeVideo(value)) playVideo(value)
    else searchVideos(value)
    videoField.value = ""
  }
  videoField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendVideo()
  })

  function drawFoot() {
    if (!ctx.canModerate()) {
      fill(foot, h("span.appview__note", { text: "Quien lleva la sala elige el vídeo. Tú controlas tu volumen." }))
      return
    }
    fill(
      foot,
      h("button.ctrl", {
        type: "button",
        dataset: { primary: "true" },
        "aria-label": synced.playing ? "Pausar para todos" : "Reproducir para todos",
        disabled: !synced.videoId,
        html: icon(synced.playing ? "pause" : "play", { size: 18 }),
        onClick: () => ctx.send({ action: synced.playing ? "pause" : "play" }),
      }),
      timeLabel,
      seekBar,
      h("div.appview__pick", null, videoField, h("button.btn", { type: "button", text: "Buscar", onClick: sendVideo })),
    )
  }

  return {
    root,
    update(activity) {
      const changed = activity.videoId !== synced.videoId
      synced = {
        videoId: activity.videoId,
        playing: Boolean(activity.playing),
        position: Number(activity.position) || 0,
        receivedAt: Date.now(),
      }
      playerHost.hidden = !synced.videoId
      if (!synced.videoId) say("Busca un vídeo o pega un enlace para empezar.")
      else {
        if (!failed) say(null)
        ensurePlayer(synced.videoId).then(() => {
          if (!dead && !changed) applySync()
        })
      }
      drawFoot()
    },
    setVolume(volume) {
      player?.setVolume?.(volume)
    },
    destroy() {
      dead = true
      clearInterval(ticker)
      try { player?.destroy?.() } catch { /* already gone */ }
    },
  }
}

/* --------------------------------------------------------------- twitch */

function twitchView() {
  let current = null
  const frameHost = h("div.appview__player")
  const note = h("p.appview__note", { hidden: true })
  const body = h("div.appview__body", null, frameHost, note)
  const foot = h("footer.appview__foot")
  const root = h("div.appview__frame", null, appBar("twitch"), body, foot)

  const channelField = h("input.field", {
    type: "text",
    placeholder: "Nombre del canal",
    "aria-label": "Canal de Twitch",
  })
  const sendChannel = () => {
    if (channelField.value.trim()) ctx.send({ action: "channel", channel: channelField.value })
    channelField.value = ""
  }
  channelField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendChannel()
  })

  return {
    root,
    update(activity) {
      if (activity.channel && activity.channel !== current) {
        current = activity.channel
        // Twitch's embed insists on knowing its host; live is its own sync.
        const src = `https://player.twitch.tv/?channel=${encodeURIComponent(current)}&parent=${location.hostname}&autoplay=true`
        fill(frameHost, h("iframe", { src, allowfullscreen: "true", allow: "autoplay; fullscreen" }))
      }
      note.hidden = Boolean(current)
      note.textContent = current ? "" : "Di qué canal ve la sala."
      fill(
        foot,
        current ? h("span.appview__time", { text: `twitch.tv/${current}` }) : null,
        ctx.canModerate()
          ? h("div.appview__pick", null, channelField, h("button.btn", { type: "button", text: "Cambiar", onClick: sendChannel }))
          : h("span.appview__note", { text: "Quien lleva la sala elige el canal." }),
      )
    },
    destroy() {
      fill(frameHost)
    },
  }
}

/* -------------------------------------------------------------- netflix */

const hms = (seconds) => {
  const s = Math.max(0, Math.floor(seconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  return `${hh ? hh + ":" : ""}${String(mm).padStart(hh ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`
}

function netflixView() {
  const title = h("p.netflix__title")
  const stateLine = h("p.netflix__state")
  const linked = h("p.netflix__linked")
  const foot = h("footer.appview__foot")

  // The room's clock for Netflix, mirroring the YouTube one.
  let synced = { playing: false, position: 0, receivedAt: Date.now() }
  const localPosition = () =>
    synced.position + (synced.playing ? (Date.now() - synced.receivedAt) / 1000 : 0)

  const ticker = setInterval(() => {
    stateLine.textContent = `${synced.playing ? "▶ Reproduciendo" : "⏸ En pausa"} · ${hms(localPosition())}`
  }, 500)

  const titleField = h("input.field", {
    type: "text",
    placeholder: "¿Qué estáis viendo?",
    "aria-label": "Título",
    onChange: () => ctx.send({ action: "title", title: titleField.value }),
  })

  /**
   * The mando code IS the moderator's own room token: it proves to the
   * server both who the extension belongs to and that the room lets them
   * drive. It is theirs already — showing it to them reveals nothing new.
   */
  const linkHelp = h("div.netflix__link", { hidden: true })
  function drawLinkHelp() {
    fill(
      linkHelp,
      h("p.appview__note", {
        text: "Instala la extensión (carpeta extension/ del proyecto, «cargar descomprimida» en chrome://extensions) y pégale estas dos cosas:",
      }),
      h("label.field-label", { text: "Enlace de la sala" }),
      h("input.field", { value: `${location.origin}/${ctx.code()}`, readonly: true, onFocus: (e) => e.target.select() }),
      ctx.canModerate()
        ? h("label.field-label", { text: "Código de mando (solo para ti: convierte tu Netflix en el mando)" })
        : null,
      ctx.canModerate()
        ? h("input.field", { value: ctx.token() ?? "", readonly: true, onFocus: (e) => e.target.select() })
        : null,
      h("p.appview__note", {
        text: "Con la extensión, tu pestaña de Netflix obedece a la sala sola: play, pausa y posición. Sin extensión, sigue la cuenta atrás a mano.",
      }),
    )
  }

  const body = h(
    "div.appview__body.appview__body--netflix",
    null,
    h("div.netflix__mark", { text: "N" }),
    title,
    stateLine,
    linked,
    h(
      "ol.netflix__steps",
      null,
      h("li", { text: "Abre Netflix en otra pestaña, con tu cuenta." }),
      h("li", { text: "Vincúlala con la extensión, o pon el mismo título y espera la señal." }),
      h("li", { text: "Play, pausa y posición viajan solos a las pestañas vinculadas." }),
    ),
    h("button.btn", {
      type: "button",
      dataset: { tone: "quiet" },
      text: "Vincular mi Netflix",
      onClick: () => {
        linkHelp.hidden = !linkHelp.hidden
        if (!linkHelp.hidden) drawLinkHelp()
      },
    }),
    linkHelp,
    h("p.appview__note", {
      text: "Netflix no deja reproducirse dentro de otras webs, así que cada uno reproduce con su cuenta y la sala lleva el compás. Vale igual para Disney+, Prime o Max (la cuenta atrás; la extensión es solo Netflix).",
    }),
  )

  const root = h("div.appview__frame", null, appBar("netflix"), body, foot)

  return {
    root,
    update(activity) {
      synced = {
        playing: Boolean(activity.playing),
        position: Number(activity.position) || 0,
        receivedAt: Date.now(),
      }
      title.textContent = activity.title ? `🎬 ${activity.title}` : ""
      const count = Number(activity.companions) || 0
      linked.textContent = count
        ? `📺 ${count} Netflix ${count === 1 ? "vinculado" : "vinculados"}`
        : ""
      if (document.activeElement !== titleField) titleField.value = activity.title ?? ""
      fill(
        foot,
        ctx.canModerate()
          ? h(
              "div.appview__cues",
              null,
              h("button.ctrl", {
                type: "button",
                dataset: { primary: "true" },
                "aria-label": synced.playing ? "Pausa para todos" : "Play para todos",
                html: icon(synced.playing ? "pause" : "play", { size: 18 }),
                onClick: () => ctx.send({ action: synced.playing ? "pause" : "play" }),
              }),
              titleField,
              h("button.btn", {
                type: "button",
                text: "Cuenta atrás y ¡PLAY!",
                onClick: () => ctx.send({ action: "cue", cue: "countdown" }),
              }),
              h("button.btn", { type: "button", dataset: { tone: "quiet" }, text: "⏸ Pausa", onClick: () => ctx.send({ action: "cue", cue: "pause" }) }),
            )
          : h("span.appview__note", { text: "Atento a la cuenta atrás — o vincula tu Netflix y déjate llevar." }),
      )
    },
    destroy() {
      clearInterval(ticker)
    },
  }
}

/** The big flash everyone sees at once. */
let cueTimers = []
export function showCue(event) {
  const layer = ctx.cueLayer
  cueTimers.forEach(clearTimeout)
  cueTimers = []

  const flash = (text, hold) => {
    layer.hidden = false
    fill(layer, h("div.cue__text", { text }))
    return hold
  }

  const steps =
    event.cue === "countdown"
      ? [["3", 1000], ["2", 1000], ["1", 1000], ["▶ ¡PLAY!", 1600]]
      : event.cue === "play"
        ? [["▶ ¡PLAY!", 1600]]
        : [["⏸ PAUSA", 1600]]

  let delay = 0
  for (const [text, hold] of steps) {
    cueTimers.push(setTimeout(() => flash(text, hold), delay))
    delay += hold
  }
  cueTimers.push(
    setTimeout(() => {
      layer.hidden = true
      fill(layer)
    }, delay),
  )
}

/* ---------------------------------------------------------------- games */

const CHESS_GLYPHS = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" }
const SEAT_TONES = { p1: "var(--accent)", p2: "#e5484d" }

function gameView(game) {
  const boardHost = h("div.gameview__board")
  const seatsBar = h("div.gameview__seats")
  const status = h("p.gameview__status")
  const body = h("div.appview__body.appview__body--game", null, seatsBar, boardHost, status)
  const root = h("div.appview__frame", null, appBar(game), body)

  // Board-local selection (chess and damas pick a piece, then a square).
  let selected = null

  const mySeat = (activity) => {
    const you = ctx.you()
    if (!you) return null
    if (activity.seats.p1?.id === you.id) return "p1"
    if (activity.seats.p2?.id === you.id) return "p2"
    return null
  }

  function drawSeats(activity) {
    const mine = mySeat(activity)
    const pill = (seat) => {
      const held = activity.seats[seat]
      const takeable = !held || !held.here
      return h(
        "div.seat",
        { dataset: { seat } },
        h("span.seat__dot", { style: { background: SEAT_TONES[seat] } }),
        held
          ? h("span.seat__name", { text: held.name + (held.here ? "" : " (fuera)") })
          : h("span.seat__name.seat__name--empty", { text: "Asiento libre" }),
        takeable && !mine
          ? h("button.btn.btn--mini", { type: "button", text: "Jugar", onClick: () => ctx.send({ action: "sit", seat }) })
          : null,
        mine === seat
          ? h("button.btn.btn--mini", { type: "button", dataset: { tone: "quiet" }, text: "Dejar", onClick: () => ctx.send({ action: "stand" }) })
          : null,
      )
    }
    fill(
      seatsBar,
      pill("p1"),
      h("span.gameview__vs", { text: "vs" }),
      pill("p2"),
      h("span.appview__spacer"),
      mine || ctx.canModerate()
        ? h("button.btn.btn--mini", { type: "button", dataset: { tone: "quiet" }, text: "Reiniciar", onClick: () => ctx.send({ action: "reset" }) })
        : null,
    )
  }

  function drawStatus(activity) {
    const { state, seats } = activity
    const nameOf = (seat) => seats[seat]?.name ?? (seat === "p1" ? "Jugador 1" : "Jugador 2")
    const mine = mySeat(activity)
    let text
    if (state.winner === "draw") text = "Tablas."
    else if (state.winner) text = `🏆 Gana ${nameOf(state.winner)}${state.over === "mate" ? " — jaque mate" : ""}.`
    else if (!seats.p1 || !seats.p2) text = "Esperando jugadores: tocad «Jugar»."
    else {
      text = state.turn === mine ? "Te toca." : `Turno de ${nameOf(state.turn)}.`
      if (state.check) text += " ¡Jaque!"
      if (state.chain !== null && state.chain !== undefined) text += " Sigue la captura."
    }
    status.textContent = text
  }

  /** Click plumbing shared by the two pick-then-place boards. */
  const pickOrMove = (activity, index, ownsPiece) => {
    const mine = mySeat(activity)
    if (!mine || activity.state.winner) return
    if (selected === null) {
      if (ownsPiece) selected = index
    } else if (selected === index) {
      selected = null
    } else if (ownsPiece) {
      selected = index
    } else {
      ctx.send({ action: "move", move: { from: selected, to: index } })
      selected = null
    }
    view.update(activity)
  }

  function drawBoard(activity) {
    const { state } = activity
    const mine = mySeat(activity)

    if (game === "ttt") {
      fill(
        boardHost,
        h(
          "div.board.board--ttt",
          null,
          ...state.board.map((cell, i) =>
            h("button.board__cell", {
              type: "button",
              disabled: Boolean(cell) || state.winner || state.turn !== mine,
              dataset: { seat: cell ?? "", win: state.line?.includes(i) ? "true" : "" },
              text: cell === "p1" ? "✕" : cell === "p2" ? "◯" : "",
              onClick: () => ctx.send({ action: "move", move: { cell: i } }),
            }),
          ),
        ),
      )
      return
    }

    if (game === "c4") {
      fill(
        boardHost,
        h(
          "div.board.board--c4",
          null,
          ...state.board.map((cell, i) =>
            h("button.board__cell.board__cell--c4", {
              type: "button",
              disabled: Boolean(state.winner) || state.turn !== mine,
              "aria-label": `Columna ${(i % 7) + 1}`,
              onClick: () => ctx.send({ action: "move", move: { col: i % 7 } }),
            }, h("span.disc", { dataset: { seat: cell ?? "" } })),
          ),
        ),
      )
      return
    }

    // The two classic boards: dark and light squares, pick a piece, place it.
    const cells = state.board.map((piece, i) => {
      const r = Math.floor(i / 8), c = i % 8
      const dark = (r + c) % 2 === 1
      let content = null
      let owns = false

      if (game === "damas" && piece) {
        const seat = piece.startsWith("1") ? "p1" : "p2"
        owns = seat === mine
        content = h("span.disc.disc--damas", { dataset: { seat, king: piece.endsWith("k") ? "true" : "" } })
      }
      if (game === "chess" && piece) {
        const seat = piece[0] === "w" ? "p1" : "p2"
        owns = seat === mine
        content = h("span.chessman", { dataset: { color: piece[0] }, text: CHESS_GLYPHS[piece[1]] })
      }

      return h(
        "button.board__cell.board__cell--classic",
        {
          type: "button",
          dataset: { dark: String(dark), selected: String(selected === i) },
          onClick: () => pickOrMove(activity, i, owns),
        },
        content,
      )
    })

    fill(boardHost, h("div.board.board--classic", { dataset: { game } }, ...cells))
  }

  return {
    root,
    update(activity) {
      drawSeats(activity)
      drawBoard(activity)
      drawStatus(activity)
    },
    destroy() {
      selected = null
    },
  }
}
