/**
 * Client half of the room socket: presence, chat and "the browser just opened".
 * Reconnects on its own, because a dropped socket should not end the film.
 */

export function connectParty({ name, clientId, onEvent }) {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`

  let socket = null
  let closed = false
  let attempt = 0
  let retryTimer = null
  let currentName = name

  function open() {
    if (closed) return
    socket = new WebSocket(url)

    socket.addEventListener("open", () => {
      attempt = 0
      onEvent({ type: "status", status: "connected" })
      socket.send(JSON.stringify({ type: "join", name: currentName, clientId }))
    })

    socket.addEventListener("message", (event) => {
      try {
        onEvent(JSON.parse(event.data))
      } catch {
        /* ignore anything that is not JSON */
      }
    })

    socket.addEventListener("close", () => {
      if (closed) return
      onEvent({ type: "status", status: "reconnecting" })
      // Back off, but never wait more than a few seconds — people are waiting.
      const delay = Math.min(6000, 600 * 2 ** attempt++)
      retryTimer = setTimeout(open, delay)
    })

    socket.addEventListener("error", () => socket.close())
  }

  open()

  const send = (payload) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }

  return {
    chat: (text) => send({ type: "chat", text }),
    sticker: (id) => send({ type: "sticker", id }),
    audio: (patch) => send({ type: "audio", ...patch }),
    rename(next) {
      currentName = next
      send({ type: "rename", name: next })
    },
    close() {
      closed = true
      clearTimeout(retryTimer)
      socket?.close()
    },
  }
}
