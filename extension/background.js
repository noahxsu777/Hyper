/**
 * The extension's spine: one WebSocket to the room, relayed to every Netflix
 * tab. The room's server decides everything; this is a wire.
 *
 * MV3 service workers get killed when idle, so all config lives in storage
 * and the socket is rebuilt on demand. The server pings every 30 seconds,
 * which also keeps the worker alive while connected.
 */

let socket = null
let current = { status: "off", detail: "", control: false, activity: null, at: 0 }
let retryTimer = null

/** The room link the user pasted, reduced to a socket URL and a code. */
function parseLink(link) {
  const url = new URL(String(link).trim())
  const code = url.pathname.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6)
  if (code.length !== 6) throw new Error("El enlace no lleva el código de la sala.")
  return { ws: `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}/ws`, code }
}

function setStatus(status, detail = "") {
  current.status = status
  current.detail = detail
  chrome.runtime.sendMessage({ cmd: "status", ...current }).catch(() => {})
}

function pushToTabs() {
  chrome.tabs.query({ url: "*://www.netflix.com/*" }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs
        .sendMessage(tab.id, {
          cmd: "apply",
          activity: current.activity,
          control: current.control,
          at: current.at,
        })
        .catch(() => {})
    }
  })
}

async function connect() {
  const { link, mando } = await chrome.storage.local.get(["link", "mando"])
  clearTimeout(retryTimer)
  if (socket) {
    socket.onclose = null
    socket.close()
    socket = null
  }

  let target
  try {
    target = parseLink(link)
  } catch (error) {
    setStatus("error", error.message)
    return
  }

  setStatus("connecting", "Conectando con la sala…")
  socket = new WebSocket(target.ws)

  socket.onopen = () => {
    socket.send(
      JSON.stringify({ type: "companion", code: target.code, control: mando || undefined }),
    )
  }

  socket.onmessage = (event) => {
    let data
    try {
      data = JSON.parse(event.data)
    } catch {
      return
    }
    if (data.type === "welcome-companion") {
      current.control = Boolean(data.control)
      current.activity = data.activity
      current.at = Date.now()
      setStatus("on", current.control ? "Vinculado, con el mando." : "Vinculado, siguiendo la sala.")
      pushToTabs()
    }
    if (data.type === "activity") {
      current.activity = data.activity
      current.at = Date.now()
      pushToTabs()
    }
    if (data.type === "no-room") setStatus("error", "Esa sala no existe (¿se cerró?).")
    if (data.type === "app-denied") setStatus("on", data.reason)
  }

  socket.onclose = async () => {
    socket = null
    const { on } = await chrome.storage.local.get("on")
    if (!on) return setStatus("off", "")
    setStatus("connecting", "Se cortó; reintentando…")
    retryTimer = setTimeout(connect, 3000)
  }

  socket.onerror = () => socket?.close()
}

function disconnect() {
  clearTimeout(retryTimer)
  if (socket) {
    socket.onclose = null
    socket.close()
    socket = null
  }
  current = { status: "off", detail: "", control: false, activity: null, at: 0 }
  setStatus("off", "")
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.cmd === "connect") {
    chrome.storage.local
      .set({ link: msg.link, mando: msg.mando ?? "", on: true })
      .then(connect)
    sendResponse({ ok: true })
  }
  if (msg.cmd === "disconnect") {
    chrome.storage.local.set({ on: false }).then(disconnect)
    sendResponse({ ok: true })
  }
  if (msg.cmd === "get") sendResponse(current)
  // A Netflix tab woke up and wants the room's state.
  if (msg.cmd === "hello") {
    if (!socket) {
      chrome.storage.local.get("on").then(({ on }) => {
        if (on) connect()
      })
    }
    pushToTabs()
    sendResponse({ ok: true })
  }
  // The controlling tab reports what its player just did.
  if (msg.cmd === "report") {
    if (socket?.readyState === WebSocket.OPEN && current.control) {
      socket.send(
        JSON.stringify({
          type: "app",
          action: "sync",
          playing: Boolean(msg.playing),
          position: Number(msg.position) || 0,
        }),
      )
    }
    sendResponse({ ok: true })
  }
  return false
})

// After a browser restart, pick the connection back up without being asked.
chrome.storage.local.get("on").then(({ on }) => {
  if (on) connect()
})
