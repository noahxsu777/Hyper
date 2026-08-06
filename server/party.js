/**
 * The watch-party room: presence and chat over WebSocket.
 *
 * Hyperbeam already synchronises the picture — every viewer is looking at the
 * same Chromium — so all this has to do is keep the people around it in sync:
 * who is here, what they say, and when the virtual computer starts or stops.
 */

import { randomBytes } from "node:crypto"
import { WebSocketServer } from "ws"

const HISTORY_LIMIT = 120
const NAME_LIMIT = 24
const TEXT_LIMIT = 800

/**
 * The stickers the room can send. Kept here rather than on the client so the
 * server is the one deciding what may end up in everyone's chat: a client can
 * only ask for an id from this list.
 */
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

/**
 * Chat commands that play an animation for everyone and then vanish.
 *
 * They deliberately leave nothing in the history: an effect is a moment in the
 * room, not a message, so someone joining later does not get a screen full of
 * hearts fired off before they arrived.
 */
export const COMMANDS = [
  {
    command: "!love",
    effect: "love",
    label: "corazones",
    url: "https://lottie.host/embed/1037deaf-4596-4b2b-a283-78ed6138d9c4/g45P88pxAF.lottie",
    duration: 5000,
  },
]

const COMMAND_BY_NAME = new Map(COMMANDS.map((entry) => [entry.command, entry]))

/** @typedef {{ id: string, name: string, joinedAt: number }} Viewer */

export function createParty(server, { path = "/ws", getSession, ownerGraceMs } = {}) {
  const wss = new WebSocketServer({ server, path })

  /** @type {Map<import("ws").WebSocket, Viewer>} */
  const viewers = new Map()
  /** @type {Array<{id: string, name: string, text: string, at: number, kind: string}>} */
  const history = []
  let nextId = 1

  /**
   * The film's own volume, which belongs to the room rather than to any one
   * viewer: whoever changes it changes it for everybody, so the server holds
   * the value and hands it to people who arrive later.
   */
  const audio = { volume: 100, muted: false }

  /**
   * Whoever opens the room owns it: they choose what is on and everyone else
   * watches. Ownership is a capability, not a checkbox — the owner is handed a
   * secret the HTTP routes demand before they will start or stop the browser,
   * so hiding the buttons is not the only thing standing in the way.
   *
   * It is pinned to the browser that claimed it, not to the socket. Phones
   * drop sockets constantly — locking the screen is enough — and losing the
   * room because you glanced at a notification would be absurd.
   */
  let ownerClientId = null
  let ownerToken = null
  let handoverTimer = null

  /** How long the room waits for its owner before letting someone else run it. */
  const OWNER_GRACE_MS = ownerGraceMs ?? 3 * 60 * 1000

  /** Departure notices in flight, so a quick return cancels its own goodbye. */
  const goodbyes = new Map()

  const viewerByClientId = (clientId) =>
    [...viewers.values()].find((viewer) => viewer.clientId === clientId) ?? null

  const ownerViewer = () => (ownerClientId ? viewerByClientId(ownerClientId) : null)

  function claimOwnership(viewer) {
    clearTimeout(handoverTimer)
    handoverTimer = null
    ownerClientId = viewer.clientId
    ownerToken = randomBytes(24).toString("base64url")
    send(viewer.socket, { type: "owner", you: true, token: ownerToken, ownerId: viewer.id })
  }

  /** Hand the room over only once its owner has really gone for good. */
  function scheduleHandover() {
    clearTimeout(handoverTimer)
    handoverTimer = setTimeout(() => {
      handoverTimer = null
      if (ownerViewer()) return // they came back
      const next = [...viewers.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]
      ownerClientId = null
      ownerToken = null
      if (!next) return
      claimOwnership(next)
      system(`${next.name} ahora lleva la sala`)
      announcePresence()
    }, OWNER_GRACE_MS)
    handoverTimer.unref?.()
  }

  const clean = (value, limit) =>
    String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, limit)

  function send(socket, payload) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
  }

  function broadcast(payload, { except } = {}) {
    const message = JSON.stringify(payload)
    for (const socket of viewers.keys()) {
      if (socket !== except && socket.readyState === socket.OPEN) socket.send(message)
    }
  }

  function roster() {
    return [...viewers.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(({ id, name }) => ({ id, name }))
  }

  function announcePresence() {
    broadcast({ type: "presence", viewers: roster(), ownerId: ownerViewer()?.id ?? null })
  }

  /** Post a system line ("X se ha unido") into the chat. */
  function system(text) {
    const entry = { id: `s${nextId++}`, name: "", text, at: Date.now(), kind: "system" }
    history.push(entry)
    if (history.length > HISTORY_LIMIT) history.shift()
    broadcast({ type: "chat", message: entry })
  }

  wss.on("connection", (socket) => {
    socket.isAlive = true
    socket.on("pong", () => {
      socket.isAlive = true
    })

    socket.on("message", (raw) => {
      let payload
      try {
        payload = JSON.parse(String(raw))
      } catch {
        return
      }

      if (payload.type === "join") {
        const name = clean(payload.name, NAME_LIMIT) || `Invitado ${nextId}`
        const clientId = clean(payload.clientId, 64) || `anon-${nextId}`

        // Coming back from a locked screen or a refresh is the same person, not
        // a second one. Retire the stale socket and keep the identity.
        const returning = viewerByClientId(clientId)
        let viewer
        if (returning) {
          const staleSocket = returning.socket
          viewers.delete(staleSocket)
          if (staleSocket !== socket) staleSocket.close()
          viewer = { ...returning, name, socket }
        } else {
          viewer = { id: `v${nextId++}`, clientId, name, joinedAt: Date.now(), socket }
        }
        viewers.set(socket, viewer)

        // They are back before the room finished saying goodbye.
        const goodbye = goodbyes.get(clientId)
        if (goodbye) {
          clearTimeout(goodbye)
          goodbyes.delete(clientId)
        }

        if (!ownerClientId) claimOwnership(viewer)
        else if (ownerClientId === clientId) claimOwnership(viewer) // the owner is back

        send(socket, {
          type: "welcome",
          you: { id: viewer.id, name: viewer.name },
          viewers: roster(),
          history,
          ownerId: ownerViewer()?.id ?? null,
          stickers: STICKERS,
          commands: COMMANDS.map(({ command, label }) => ({ command, label })),
          audio,
          session: getSession?.() ?? null,
        })
        announcePresence()
        if (!returning && !goodbye) system(`${viewer.name} se ha unido`)
        return
      }

      const viewer = viewers.get(socket)
      if (!viewer) return

      if (payload.type === "chat") {
        const text = clean(payload.text, TEXT_LIMIT)
        if (!text) return

        // A command is played, not said: it never reaches the history.
        const command = COMMAND_BY_NAME.get(text.toLowerCase())
        if (command) {
          broadcast({
            type: "effect",
            effect: command.effect,
            url: command.url,
            duration: command.duration,
            by: viewer.name,
            byId: viewer.id,
          })
          return
        }

        const entry = {
          id: `m${nextId++}`,
          name: viewer.name,
          viewerId: viewer.id,
          text,
          at: Date.now(),
          kind: "chat",
        }
        history.push(entry)
        if (history.length > HISTORY_LIMIT) history.shift()
        broadcast({ type: "chat", message: entry })
        return
      }

      if (payload.type === "sticker") {
        const sticker = STICKER_BY_ID.get(String(payload.id))
        if (!sticker) return
        const entry = {
          id: `m${nextId++}`,
          name: viewer.name,
          viewerId: viewer.id,
          sticker: sticker.id,
          char: sticker.char,
          at: Date.now(),
          kind: "sticker",
        }
        history.push(entry)
        if (history.length > HISTORY_LIMIT) history.shift()
        broadcast({ type: "chat", message: entry })
        return
      }

      if (payload.type === "audio") {
        if (ownerClientId !== viewer.clientId) return
        // Only the viewer who moved the control drives the remote player; the
        // rest just follow, otherwise every client would send its own key
        // presses and the volume would move several times over.
        if (typeof payload.volume === "number") {
          audio.volume = Math.round(Math.min(100, Math.max(0, payload.volume)))
        }
        if (typeof payload.muted === "boolean") audio.muted = payload.muted
        broadcast({ type: "audio", audio, by: viewer.id })
        return
      }

      if (payload.type === "rename") {
        const name = clean(payload.name, NAME_LIMIT)
        if (!name || name === viewer.name) return
        const previous = viewer.name
        viewer.name = name
        send(socket, { type: "you", you: { id: viewer.id, name } })
        announcePresence()
        system(`${previous} ahora es ${name}`)
      }
    })

    socket.on("close", () => {
      const viewer = viewers.get(socket)
      viewers.delete(socket)
      if (!viewer) return
      announcePresence()

      // Locking a phone drops the socket. Wait a little before telling the room
      // someone left, or the chat fills with goodbyes they never meant.
      clearTimeout(goodbyes.get(viewer.clientId))
      const goodbye = setTimeout(() => {
        goodbyes.delete(viewer.clientId)
        if (viewerByClientId(viewer.clientId)) return
        system(`${viewer.name} ha salido`)
      }, 15000)
      goodbye.unref?.()
      goodbyes.set(viewer.clientId, goodbye)

      // An empty room is a finished party: whoever turns up next starts a new
      // one. Holding the room for a host nobody is waiting for would just lock
      // the next person out for no reason.
      if (viewers.size === 0) {
        clearTimeout(handoverTimer)
        handoverTimer = null
        ownerClientId = null
        ownerToken = null
        return
      }

      if (ownerClientId === viewer.clientId) scheduleHandover()
    })
  })

  // Drop sockets that stopped answering so the roster stays honest.
  const heartbeat = setInterval(() => {
    for (const socket of viewers.keys()) {
      if (!socket.isAlive) {
        socket.terminate()
        continue
      }
      socket.isAlive = false
      socket.ping()
    }
  }, 30000)
  heartbeat.unref?.()

  return {
    /** Tell everyone the virtual computer started, so their players attach too. */
    sessionStarted(session) {
      broadcast({ type: "session", session })
      system("Se ha abierto el navegador de la sala")
    },
    sessionEnded() {
      broadcast({ type: "session", session: null })
      system("Se ha cerrado el navegador de la sala")
    },
    get size() {
      return viewers.size
    },
    /** The HTTP routes ask this before starting or stopping the browser. */
    isOwner(token) {
      return Boolean(ownerToken) && token === ownerToken
    },
    get hasOwner() {
      return Boolean(ownerClientId)
    },
    close() {
      clearInterval(heartbeat)
      wss.close()
    },
  }
}
