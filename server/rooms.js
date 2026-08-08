/**
 * Rooms.
 *
 * Each room is its own party: its own people, chat, shared browser and rules.
 * Everything lives in this process's memory, which is why the app must run on a
 * single machine — see the deployment notes in the README.
 *
 * Three roles, narrowing as they go:
 *   owner       opens the room, runs it, hands out and takes back moderation
 *   moderator   drives the film and removes people
 *   guest       watches and talks
 */

import { randomBytes } from "node:crypto"
import { WebSocketServer } from "ws"

import { isGiphyUrl } from "./giphy.js"
import { GAMES } from "./games.js"

const HISTORY_LIMIT = 120
const NAME_LIMIT = 24
const TEXT_LIMIT = 800
const CODE_LENGTH = 6
/** No O/0 or I/1: these codes get read aloud and typed on phones. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** Stickers the room may send. The server owns the list so a client cannot invent one. */
export const STICKERS = [
  { id: "popcorn", char: "🍿" },
  { id: "lol", char: "😂" },
  { id: "heart", char: "❤️" },
  { id: "fire", char: "🔥" },
  { id: "clap", char: "👏" },
  { id: "shock", char: "😱" },
  { id: "cry", char: "😭" },
  { id: "eyes", char: "👀" },
  { id: "sleep", char: "😴" },
  { id: "thumbs", char: "👍" },
  { id: "boo", char: "👎" },
  { id: "skull", char: "💀" },
  { id: "party", char: "🎉" },
  { id: "cool", char: "😎" },
  { id: "think", char: "🤔" },
  { id: "star", char: "⭐" },
  { id: "hush", char: "🤫" },
  { id: "rewind", char: "⏪" },
]

const STICKER_BY_ID = new Map(STICKERS.map((sticker) => [sticker.id, sticker]))

/** Chat commands that play an animation for everyone and then vanish. */
export const COMMANDS = [
  {
    command: "!love",
    effect: "love",
    label: "corazones",
    kind: "lottie",
    url: "https://lottie.host/embed/1037deaf-4596-4b2b-a283-78ed6138d9c4/g45P88pxAF.lottie",
    duration: 5000,
  },
  {
    command: "!pork",
    effect: "pork",
    label: "cerdito",
    kind: "lottie",
    url: "https://lottie.host/embed/ede82963-9b15-4bc5-9998-bcf97282de95/UtBtT5mG7E.lottie",
    duration: 5000,
  },
  {
    command: "!drag",
    effect: "drag",
    label: "dragonite",
    kind: "image",
    url: "https://images.wikidexcdn.net/mwuploads/wikidex/a/a6/latest/20230518040921/Dragonite.png",
    duration: 5000,
  },
]

const COMMAND_BY_NAME = new Map(COMMANDS.map((entry) => [entry.command, entry]))

const clean = (value, limit) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit)

const secret = () => randomBytes(24).toString("base64url")

/* ------------------------------------------------------------------- apps */

/** For the system messages; the client has its own richer catalog. */
const APP_NAMES = {
  youtube: "YouTube",
  twitch: "Twitch",
  netflix: "Netflix sincronizado",
  ttt: "Tres en raya",
  c4: "Cuatro en raya",
  damas: "Damas",
  chess: "Ajedrez",
}

/**
 * Whatever someone pasted, reduced to a video id or nothing. Accepting only
 * the id — never the URL — is what keeps this from becoming a way to embed
 * arbitrary pages on everyone's screen.
 */
function ytVideoId(value) {
  const raw = String(value ?? "").trim()
  if (/^[\w-]{11}$/.test(raw)) return raw
  try {
    const url = new URL(raw)
    if (!/(^|\.)youtube\.com$/.test(url.hostname) && !/(^|\.)youtu\.be$/.test(url.hostname)) return null
    if (url.hostname.endsWith("youtu.be")) {
      const id = url.pathname.slice(1).split("/")[0]
      return /^[\w-]{11}$/.test(id) ? id : null
    }
    const v = url.searchParams.get("v")
    if (v && /^[\w-]{11}$/.test(v)) return v
    const path = url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/)
    return path ? path[1] : null
  } catch {
    return null
  }
}

/** Twitch channel names are plain handles; anything else is not a channel. */
function twitchChannel(value) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/^.*twitch\.tv\//, "").split(/[/?#]/)[0]
  return /^[a-z0-9_]{3,25}$/.test(raw) ? raw : null
}

/**
 * One party.
 */
class Room {
  constructor(code, { ownerGraceMs, emptyTtlMs, idleSessionMs, onEmpty, onIdleSession }) {
    this.code = code
    this.createdAt = Date.now()
    this.ownerGraceMs = ownerGraceMs
    this.emptyTtlMs = emptyTtlMs
    this.idleSessionMs = idleSessionMs
    this.onEmpty = onEmpty
    this.onIdleSession = onIdleSession

    /** @type {Map<import("ws").WebSocket, object>} */
    this.viewers = new Map()
    this.history = []
    this.audio = { volume: 100, muted: false }
    this.nextId = 1

    /** Ownership follows the browser, not the socket: phones drop sockets constantly. */
    this.ownerClientId = null
    this.moderators = new Set()
    this.banned = new Set()
    /** A locked room lets nobody new in; the people already inside stay. */
    this.locked = false

    /** The shared Hyperbeam computer, owned by this room alone. */
    this.session = null
    this.inflight = null

    /**
     * What the room's screen is doing instead of the browser: a synced video,
     * a live channel, a board game, or nothing. One screen, one activity.
     */
    this.activity = null

    /**
     * Companions: browser extensions synced to this room's Netflix. They are
     * remotes, not people — no roster entry, no chat, no seats. One of them
     * may hold the remote control, proved with its owner's room token.
     * @type {Map<import("ws").WebSocket, { control: { clientId: string, name: string } | null }>}
     */
    this.companions = new Map()

    this.handoverTimer = null
    this.emptyTimer = null
    this.idleSessionTimer = null
    this.goodbyes = new Map()
  }

  /* ------------------------------------------------------------- plumbing */

  send(socket, payload) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
  }

  broadcast(payload) {
    const message = JSON.stringify(payload)
    for (const socket of this.viewers.keys()) {
      if (socket.readyState === socket.OPEN) socket.send(message)
    }
  }

  viewerByClientId(clientId) {
    return [...this.viewers.values()].find((viewer) => viewer.clientId === clientId) ?? null
  }

  ownerViewer() {
    return this.ownerClientId ? this.viewerByClientId(this.ownerClientId) : null
  }

  roleOf(clientId) {
    if (clientId && clientId === this.ownerClientId) return "owner"
    if (clientId && this.moderators.has(clientId)) return "moderator"
    return "guest"
  }

  /** Moderators and the owner may drive the film and remove people. */
  canModerate(clientId) {
    const role = this.roleOf(clientId)
    return role === "owner" || role === "moderator"
  }

  roster() {
    return [...this.viewers.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(({ id, name, clientId }) => ({ id, name, role: this.roleOf(clientId) }))
  }

  state() {
    return {
      code: this.code,
      locked: this.locked,
      ownerId: this.ownerViewer()?.id ?? null,
      viewers: this.roster(),
    }
  }

  announce() {
    this.broadcast({ type: "presence", ...this.state() })
  }

  system(text) {
    const entry = { id: `s${this.nextId++}`, name: "", text, at: Date.now(), kind: "system" }
    this.history.push(entry)
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
    this.broadcast({ type: "chat", message: entry })
  }

  /* ------------------------------------------------------------ ownership */

  claimOwnership(viewer) {
    clearTimeout(this.handoverTimer)
    this.handoverTimer = null
    this.ownerClientId = viewer.clientId
    this.moderators.delete(viewer.clientId)
    this.sendRole(viewer)
  }

  /** Tell one viewer what they may do, and hand over the token that proves it. */
  sendRole(viewer) {
    this.send(viewer.socket, {
      type: "role",
      role: this.roleOf(viewer.clientId),
      token: viewer.token,
      ownerId: this.ownerViewer()?.id ?? null,
    })
  }

  scheduleHandover() {
    clearTimeout(this.handoverTimer)
    this.handoverTimer = setTimeout(() => {
      this.handoverTimer = null
      if (this.ownerViewer()) return // they came back

      // Prefer a moderator: the owner already trusted them with the room.
      const candidates = [...this.viewers.values()].sort((a, b) => a.joinedAt - b.joinedAt)
      const next = candidates.find((v) => this.moderators.has(v.clientId)) ?? candidates[0]
      this.ownerClientId = null
      if (!next) return
      this.claimOwnership(next)
      this.system(`${next.name} ahora lleva la sala`)
      this.announce()
    }, this.ownerGraceMs)
    this.handoverTimer.unref?.()
  }

  /* ----------------------------------------------------------------- join */

  /** @returns {{ ok: true, viewer: object } | { ok: false, reason: string }} */
  join(socket, { name, clientId }) {
    if (this.banned.has(clientId)) {
      return { ok: false, reason: "Te han expulsado de esta sala." }
    }

    const returning = this.viewerByClientId(clientId)
    if (this.locked && !returning && this.ownerClientId && this.ownerClientId !== clientId) {
      return { ok: false, reason: "La sala está cerrada." }
    }

    let viewer
    if (returning) {
      const stale = returning.socket
      this.viewers.delete(stale)
      if (stale !== socket) stale.close()
      viewer = { ...returning, name, socket }
    } else {
      viewer = {
        id: `v${this.nextId++}`,
        clientId,
        name,
        joinedAt: Date.now(),
        token: secret(),
        socket,
      }
    }
    this.viewers.set(socket, viewer)

    clearTimeout(this.emptyTimer)
    this.emptyTimer = null
    clearTimeout(this.idleSessionTimer)
    this.idleSessionTimer = null

    const goodbye = this.goodbyes.get(clientId)
    if (goodbye) {
      clearTimeout(goodbye)
      this.goodbyes.delete(clientId)
    }

    // First one in owns the room; a returning owner gets it straight back.
    if (!this.ownerClientId || this.ownerClientId === clientId) this.claimOwnership(viewer)

    this.send(socket, {
      type: "welcome",
      you: { id: viewer.id, name: viewer.name },
      role: this.roleOf(clientId),
      token: viewer.token,
      history: this.history,
      stickers: STICKERS,
      commands: COMMANDS.map(({ command, label }) => ({ command, label })),
      audio: this.audio,
      session: this.publicSession(),
      activity: this.publicActivity(),
      ...this.state(),
    })
    this.announce()
    if (!returning && !goodbye) this.system(`${viewer.name} se ha unido`)
    return { ok: true, viewer }
  }

  leave(socket) {
    const viewer = this.viewers.get(socket)
    this.viewers.delete(socket)
    if (!viewer) return
    this.announce()

    // Locking a phone drops the socket. Give them a moment before the room
    // announces a departure they never meant.
    clearTimeout(this.goodbyes.get(viewer.clientId))
    const goodbye = setTimeout(() => {
      this.goodbyes.delete(viewer.clientId)
      if (this.viewerByClientId(viewer.clientId)) return
      this.system(`${viewer.name} ha salido`)
    }, 15000)
    goodbye.unref?.()
    this.goodbyes.set(viewer.clientId, goodbye)

    if (this.viewers.size === 0) {
      // Ojo con no cancelar el relevo aquí. Una sala vacía conserva a su
      // anfitrión durante la gracia —para eso está—, pero si el reloj se para,
      // lo conserva para siempre: el siguiente que entre se encuentra una sala
      // con un dueño que no está, sin poder abrir nada. Al vencer la gracia sin
      // nadie dentro, `scheduleHandover` deja la sala libre para quien llegue.
      if (this.ownerClientId === viewer.clientId) this.scheduleHandover()

      // Dos relojes distintos, porque cuestan cosas distintas.
      //
      // La máquina virtual cuesta dinero por minuto, así que se apaga pronto.
      // La sala en sí es un objeto en memoria: no cuesta nada, y tirarla es lo
      // que hacía que bloquear el móvil un par de minutos a media película
      // dejara el código muerto y el chat perdido. Así que se recuerda mucho
      // más tiempo, y quien vuelve encuentra su sala donde la dejó.
      this.idleSessionTimer = setTimeout(() => {
        this.idleSessionTimer = null
        if (this.viewers.size === 0) this.onIdleSession?.(this)
      }, this.idleSessionMs)
      this.idleSessionTimer.unref?.()

      this.emptyTimer = setTimeout(() => this.onEmpty?.(this), this.emptyTtlMs)
      this.emptyTimer.unref?.()
      return
    }

    if (this.ownerClientId === viewer.clientId) this.scheduleHandover()
  }

  /* ----------------------------------------------------------- moderation */

  setRole(actorClientId, targetId, role) {
    if (this.roleOf(actorClientId) !== "owner") return
    const target = [...this.viewers.values()].find((viewer) => viewer.id === targetId)
    if (!target || target.clientId === this.ownerClientId) return

    if (role === "moderator") {
      if (this.moderators.has(target.clientId)) return
      this.moderators.add(target.clientId)
      this.system(`${target.name} ahora es moderador`)
    } else {
      if (!this.moderators.has(target.clientId)) return
      this.moderators.delete(target.clientId)
      this.system(`${target.name} ya no es moderador`)
    }
    this.sendRole(target)
    this.announce()
  }

  kick(actorClientId, targetId, { ban = true } = {}) {
    if (!this.canModerate(actorClientId)) return
    const target = [...this.viewers.values()].find((viewer) => viewer.id === targetId)
    if (!target) return

    // Nobody removes the owner, and a moderator cannot remove another moderator.
    if (target.clientId === this.ownerClientId) return
    if (this.roleOf(actorClientId) === "moderator" && this.moderators.has(target.clientId)) return

    if (ban) this.banned.add(target.clientId)
    this.moderators.delete(target.clientId)
    this.send(target.socket, { type: "kicked", reason: "Te han expulsado de la sala." })
    const socket = target.socket
    this.viewers.delete(socket)
    setTimeout(() => socket.close(), 100)
    this.system(`${target.name} fue expulsado`)
    this.announce()
  }

  setLocked(actorClientId, locked) {
    if (this.roleOf(actorClientId) !== "owner") return
    if (this.locked === Boolean(locked)) return
    this.locked = Boolean(locked)
    this.system(this.locked ? "La sala está cerrada" : "La sala está abierta")
    this.announce()
  }

  /* -------------------------------------------------------------- session */

  /* ------------------------------------------------------------ activity */

  /** Where the shared video actually is right now, clock included. */
  livePosition() {
    const a = this.activity
    if (!a || (a.kind !== "youtube" && a.kind !== "netflix")) return 0
    return Math.max(0, a.position + (a.playing ? (Date.now() - a.at) / 1000 : 0))
  }

  /**
   * The activity as the room may see it. Seats publish the viewer's room id
   * and name, never the clientId: the clientId is what proves who you are,
   * and broadcasting it would hand that proof to everyone else.
   */
  publicActivity() {
    const a = this.activity
    if (!a) return null
    switch (a.kind) {
      case "youtube":
        return { kind: "youtube", videoId: a.videoId, playing: a.playing, position: this.livePosition() }
      case "twitch":
        return { kind: "twitch", channel: a.channel }
      case "netflix":
        return {
          kind: "netflix",
          title: a.title,
          playing: a.playing,
          position: this.livePosition(),
          companions: this.companions.size,
        }
      case "game": {
        const seat = (held) => {
          if (!held) return null
          const live = this.viewerByClientId(held.clientId)
          return { id: live?.id ?? null, name: live?.name ?? held.name, here: Boolean(live) }
        }
        return { kind: "game", game: a.game, state: a.state, seats: { p1: seat(a.seats.p1), p2: seat(a.seats.p2) } }
      }
      default:
        return null
    }
  }

  setActivity(activity) {
    this.activity = activity
    const message = { type: "activity", activity: this.publicActivity() }
    this.broadcast(message)
    for (const socket of this.companions.keys()) this.send(socket, message)
  }

  /* ---------------------------------------------------------- companions */

  joinCompanion(socket, controlToken) {
    let control = null
    if (controlToken) {
      // The mando code is a moderator's own room token: it proves both who
      // they are and that the room lets them drive.
      const owner = [...this.viewers.values()].find((viewer) => viewer.token === controlToken)
      if (owner && this.canModerate(owner.clientId)) {
        control = { clientId: owner.clientId, name: owner.name }
      } else {
        this.send(socket, { type: "app-denied", reason: "Ese código de mando no vale." })
      }
    }
    this.companions.set(socket, { control })
    this.send(socket, {
      type: "welcome-companion",
      control: Boolean(control),
      activity: this.publicActivity(),
    })
    if (this.activity) this.setActivity(this.activity) // republish the count
  }

  leaveCompanion(socket) {
    if (this.companions.delete(socket) && this.activity) this.setActivity(this.activity)
  }

  handleCompanion(socket, payload) {
    const entry = this.companions.get(socket)
    if (!entry?.control || payload.type !== "app") return
    // A companion is a remote for the video, nothing more: it cannot open or
    // close apps, sit at games, or speak. Role checks run again inside.
    if (!["sync", "play", "pause", "seek", "title"].includes(payload.action)) return
    this.handleApp({ clientId: entry.control.clientId, name: entry.control.name, socket }, payload)
  }

  deny(socket, reason) {
    this.send(socket, { type: "app-denied", reason })
  }

  /** Which seat this person holds in the current game, if any. */
  seatOf(clientId) {
    const a = this.activity
    if (a?.kind !== "game") return null
    if (a.seats.p1?.clientId === clientId) return "p1"
    if (a.seats.p2?.clientId === clientId) return "p2"
    return null
  }

  handleApp(viewer, payload) {
    const mod = this.canModerate(viewer.clientId)
    const a = this.activity

    switch (payload.action) {
      /* What is on the screen is the moderators' call, same as the film. */
      case "open": {
        if (!mod) return this.deny(viewer.socket, "Solo quien lleva la sala puede abrir apps.")
        if (this.session) {
          return this.deny(viewer.socket, "Cierra el navegador compartido para usar las apps.")
        }
        const app = String(payload.app)
        if (app === "youtube") {
          const videoId = ytVideoId(payload.video)
          this.setActivity({ kind: "youtube", videoId, playing: Boolean(videoId), position: 0, at: Date.now() })
        } else if (app === "twitch") {
          this.setActivity({ kind: "twitch", channel: twitchChannel(payload.channel) })
        } else if (app === "netflix") {
          this.setActivity({ kind: "netflix", title: "", playing: false, position: 0, at: Date.now() })
        } else if (GAMES[app]) {
          this.setActivity({ kind: "game", game: app, state: GAMES[app].create(), seats: { p1: null, p2: null } })
        } else return
        this.system(`${viewer.name} ha abierto ${APP_NAMES[app] ?? app}`)
        return
      }

      case "close":
        if (!mod) return this.deny(viewer.socket, "Solo quien lleva la sala puede cerrar la app.")
        if (!a) return
        this.setActivity(null)
        this.system(`${viewer.name} ha cerrado ${APP_NAMES[a.kind === "game" ? a.game : a.kind] ?? "la app"}`)
        return

      /* ------------------------------------------------- youtube controls */

      case "video": {
        if (!mod || a?.kind !== "youtube") return
        const videoId = ytVideoId(payload.video)
        if (!videoId) return this.deny(viewer.socket, "Eso no parece un enlace de YouTube.")
        this.setActivity({ ...a, videoId, playing: true, position: 0, at: Date.now() })
        return
      }

      case "play":
      case "pause": {
        if (!mod || (a?.kind !== "youtube" && a?.kind !== "netflix")) return
        const position = this.livePosition()
        this.setActivity({ ...a, playing: payload.action === "play", position, at: Date.now() })
        return
      }

      case "seek": {
        if (!mod || (a?.kind !== "youtube" && a?.kind !== "netflix")) return
        const position = Math.min(86400, Math.max(0, Number(payload.position) || 0))
        this.setActivity({ ...a, position, at: Date.now() })
        return
      }

      /* One event with both facts, for the extension that mirrors a real
         player: "it is playing and it is at second N". */
      case "sync": {
        if (!mod || a?.kind !== "netflix") return
        const position = Math.min(86400, Math.max(0, Number(payload.position) || 0))
        this.setActivity({ ...a, playing: Boolean(payload.playing), position, at: Date.now() })
        return
      }

      /* -------------------------------------------------- twitch controls */

      case "channel": {
        if (!mod || a?.kind !== "twitch") return
        const channel = twitchChannel(payload.channel)
        if (!channel) return this.deny(viewer.socket, "Eso no parece un canal de Twitch.")
        this.setActivity({ ...a, channel })
        return
      }

      /* ------------------------------------------------- netflix controls */

      case "title": {
        if (!mod || a?.kind !== "netflix") return
        this.setActivity({ ...a, title: clean(payload.title, 80) })
        return
      }

      case "cue": {
        // Ephemeral by design: a countdown that happened is not state.
        if (!mod || a?.kind !== "netflix") return
        const cue = String(payload.cue)
        if (!["countdown", "play", "pause"].includes(cue)) return
        this.broadcast({ type: "cue", cue, by: viewer.name, at: Date.now() })
        return
      }

      /* ------------------------------------------------------------ games */
      /* Opening a game is gated; playing one is for everyone in the room.  */

      case "sit": {
        if (a?.kind !== "game") return
        const seat = payload.seat === "p2" ? "p2" : "p1"
        const held = a.seats[seat]
        // A seat is takeable when empty, or when whoever held it is gone.
        if (held && this.viewerByClientId(held.clientId)) {
          return this.deny(viewer.socket, "Ese asiento está ocupado.")
        }
        if (this.seatOf(viewer.clientId)) return this.deny(viewer.socket, "Ya estás jugando.")
        a.seats[seat] = { clientId: viewer.clientId, name: viewer.name }
        this.setActivity(a)
        return
      }

      case "stand": {
        if (a?.kind !== "game") return
        const seat = this.seatOf(viewer.clientId)
        if (!seat) return
        a.seats[seat] = null
        // A game missing a player is not a game in progress any more.
        a.state = GAMES[a.game].create()
        this.setActivity(a)
        return
      }

      case "reset": {
        if (a?.kind !== "game") return
        if (!mod && !this.seatOf(viewer.clientId)) {
          return this.deny(viewer.socket, "Solo los jugadores pueden reiniciar la partida.")
        }
        a.state = GAMES[a.game].create()
        this.setActivity(a)
        return
      }

      case "move": {
        if (a?.kind !== "game") return
        const seat = this.seatOf(viewer.clientId)
        if (!seat) return this.deny(viewer.socket, "Siéntate para jugar.")
        if (!a.seats.p1 || !a.seats.p2) return this.deny(viewer.socket, "Falta el otro jugador.")
        const result = GAMES[a.game].move(a.state, seat, payload.move ?? {})
        if (!result.ok) return this.deny(viewer.socket, result.error)
        a.state = result.state
        this.setActivity(a)
        if (result.state.winner === "draw") this.system(`Tablas en ${APP_NAMES[a.game]}`)
        else if (result.state.winner) {
          const name = a.seats[result.state.winner]?.name ?? "alguien"
          this.system(`${name} gana en ${APP_NAMES[a.game]}`)
        }
        return
      }
    }
  }

  /**
   * What a stranger may know about this room from the landing page: enough to
   * decide whether to walk in, and nothing else. No chat, no roster, no token.
   */
  summary() {
    return {
      code: this.code,
      host: this.ownerViewer()?.name ?? null,
      viewers: this.viewers.size,
      live: Boolean(this.session),
      openedAt: this.createdAt,
    }
  }

  /**
   * Whether this room belongs on a public list. A locked room is someone's
   * private evening: it still works by code for whoever was invited, but
   * advertising it to the whole internet is not what the lock is for. An empty
   * room is not "open" either — it is a room being remembered.
   */
  get listed() {
    return !this.locked && this.viewers.size > 0
  }

  publicSession() {
    return this.session
      ? {
          sessionId: this.session.session_id,
          embedUrl: this.session.embed_url,
          createdAt: this.session.created_at,
        }
      : null
  }

  setSession(session) {
    this.session = session
    // One screen: the shared browser and an app cannot both hold it.
    if (this.activity) this.setActivity(null)
    this.broadcast({ type: "session", session: this.publicSession() })
    this.system("Se ha abierto el navegador de la sala")
  }

  clearSession() {
    if (!this.session) return
    this.session = null
    this.broadcast({ type: "session", session: null })
    this.system("Se ha cerrado el navegador de la sala")
  }

  /* -------------------------------------------------------------- messages */

  handle(socket, payload) {
    const viewer = this.viewers.get(socket)
    if (!viewer) return

    switch (payload.type) {
      case "chat": {
        const text = clean(payload.text, TEXT_LIMIT)
        if (!text) return

        // A command is played, not said: it never reaches the history.
        const command = COMMAND_BY_NAME.get(text.toLowerCase())
        if (command) {
          this.broadcast({
            type: "effect",
            effect: command.effect,
            kind: command.kind ?? "lottie",
            url: command.url,
            duration: command.duration,
            by: viewer.name,
            byId: viewer.id,
          })
          return
        }
        this.post({ ...this.entry(viewer), text, kind: "chat" })
        return
      }

      case "gif": {
        // The client picked this from our own proxy, but it is still a URL
        // arriving over a socket: only GIPHY's own hosts get into the chat.
        if (!isGiphyUrl(payload.url)) return
        this.post({
          ...this.entry(viewer),
          url: String(payload.url),
          width: Math.min(600, Math.max(1, Number(payload.width) || 200)),
          height: Math.min(600, Math.max(1, Number(payload.height) || 200)),
          kind: "gif",
        })
        return
      }

      case "sticker": {
        const sticker = STICKER_BY_ID.get(String(payload.id))
        if (!sticker) return
        this.post({
          ...this.entry(viewer),
          sticker: sticker.id,
          char: sticker.char,
          kind: "sticker",
        })
        return
      }

      case "app":
        this.handleApp(viewer, payload)
        return

      case "audio": {
        // The film's volume belongs to whoever is running the room.
        if (!this.canModerate(viewer.clientId)) return
        if (typeof payload.volume === "number") {
          this.audio.volume = Math.round(Math.min(100, Math.max(0, payload.volume)))
        }
        if (typeof payload.muted === "boolean") this.audio.muted = payload.muted
        this.broadcast({ type: "audio", audio: this.audio, by: viewer.id })
        return
      }

      case "rename": {
        const name = clean(payload.name, NAME_LIMIT)
        if (!name || name === viewer.name) return
        const previous = viewer.name
        viewer.name = name
        this.send(socket, { type: "you", you: { id: viewer.id, name } })
        this.announce()
        this.system(`${previous} ahora es ${name}`)
        return
      }

      case "role":
        this.setRole(viewer.clientId, String(payload.targetId), payload.role === "moderator" ? "moderator" : "guest")
        return

      case "kick":
        this.kick(viewer.clientId, String(payload.targetId))
        return

      case "lock":
        this.setLocked(viewer.clientId, payload.locked)
        return
    }
  }

  entry(viewer) {
    return { id: `m${this.nextId++}`, name: viewer.name, viewerId: viewer.id, at: Date.now() }
  }

  post(entry) {
    this.history.push(entry)
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
    this.broadcast({ type: "chat", message: entry })
  }

  dispose() {
    clearTimeout(this.handoverTimer)
    clearTimeout(this.emptyTimer)
    clearTimeout(this.idleSessionTimer)
    for (const timer of this.goodbyes.values()) clearTimeout(timer)
    this.goodbyes.clear()
    for (const socket of this.viewers.keys()) socket.close()
    this.viewers.clear()
    for (const socket of this.companions.keys()) socket.close()
    this.companions.clear()
  }
}

/**
 * The registry: creates rooms, routes sockets to them, and reaps the empty ones.
 */
export function createRoomHub(
  server,
  { path = "/ws", ownerGraceMs, emptyTtlMs, idleSessionMs, onRoomClosed, onIdleSession } = {},
) {
  const wss = new WebSocketServer({ server, path })
  /** @type {Map<string, Room>} */
  const rooms = new Map()

  const grace = ownerGraceMs ?? 3 * 60 * 1000
  // Una sala vacía se recuerda un buen rato: un móvil bloqueado, un túnel o un
  // ascensor no deberían borrar el código que la gente tiene compartido.
  const ttl = emptyTtlMs ?? 15 * 60 * 1000
  // La máquina virtual, en cambio, se apaga en cuanto está claro que nadie la
  // está mirando. Es lo único de esto que cuesta minutos.
  const idleSession = idleSessionMs ?? 90 * 1000

  function newCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      const bytes = randomBytes(CODE_LENGTH)
      let code = ""
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
      }
      if (!rooms.has(code)) return code
    }
    // Astronomically unlikely; still better than looping forever.
    return `${Date.now().toString(36).toUpperCase().slice(-CODE_LENGTH)}`
  }

  function createRoom() {
    const code = newCode()
    const room = new Room(code, {
      ownerGraceMs: grace,
      emptyTtlMs: ttl,
      idleSessionMs: idleSession,
      onEmpty: (finished) => {
        rooms.delete(finished.code)
        finished.dispose()
        onRoomClosed?.(finished)
      },
      onIdleSession: (idle) => onIdleSession?.(idle),
    })
    rooms.set(code, room)
    return room
  }

  const normalizeCode = (value) =>
    String(value ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, CODE_LENGTH)

  const getRoom = (code) => rooms.get(normalizeCode(code)) ?? null

  /** Resolve the token a client was given on join back to its room and viewer. */
  function authenticate(token) {
    if (!token) return null
    for (const room of rooms.values()) {
      const viewer = [...room.viewers.values()].find((entry) => entry.token === token)
      if (viewer) return { room, viewer, role: room.roleOf(viewer.clientId) }
    }
    return null
  }

  wss.on("connection", (socket) => {
    socket.isAlive = true
    socket.on("pong", () => {
      socket.isAlive = true
    })

    /** @type {Room|null} */
    let room = null

    socket.on("message", (raw) => {
      let payload
      try {
        payload = JSON.parse(String(raw))
      } catch {
        return
      }

      // A browser extension syncing someone's Netflix: a remote, not a person.
      if (payload.type === "companion") {
        const target = getRoom(payload.code)
        if (!target) {
          socket.send(JSON.stringify({ type: "no-room", code: normalizeCode(payload.code) }))
          return
        }
        target.joinCompanion(socket, typeof payload.control === "string" ? payload.control : null)
        room = target
        socket.isCompanion = true
        return
      }

      if (socket.isCompanion) {
        room?.handleCompanion(socket, payload)
        return
      }

      if (payload.type === "join") {
        const target = getRoom(payload.code)
        if (!target) {
          socket.send(JSON.stringify({ type: "no-room", code: normalizeCode(payload.code) }))
          return
        }
        const name = clean(payload.name, NAME_LIMIT) || "Invitado"
        const clientId = clean(payload.clientId, 64)
        if (!clientId) return

        const result = target.join(socket, { name, clientId })
        if (!result.ok) {
          socket.send(JSON.stringify({ type: "denied", reason: result.reason }))
          return
        }
        room = target
        return
      }

      room?.handle(socket, payload)
    })

    socket.on("close", () => {
      if (socket.isCompanion) room?.leaveCompanion(socket)
      else room?.leave(socket)
    })
  })

  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const socket of [...room.viewers.keys(), ...room.companions.keys()]) {
        if (!socket.isAlive) {
          socket.terminate()
          continue
        }
        socket.isAlive = false
        socket.ping()
      }
    }
  }, 30000)
  heartbeat.unref?.()

  return {
    createRoom,
    getRoom,
    authenticate,
    normalizeCode,
    get size() {
      return rooms.size
    },
    rooms: () => [...rooms.values()],
    close() {
      clearInterval(heartbeat)
      for (const room of rooms.values()) room.dispose()
      rooms.clear()
      wss.close()
    },
  }
}
