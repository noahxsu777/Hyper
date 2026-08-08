/** Client for our own backend, which brokers the Hyperbeam REST API. */

/**
 * Proof of who we are in a room, handed over the socket on join. The server
 * decides what it entitles us to; we just carry it.
 */
let roomToken = null
export const setRoomToken = (token) => {
  roomToken = token
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(roomToken ? { "x-room-token": roomToken } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const error = new Error(data?.error || `${res.status} ${res.statusText}`)
    error.status = res.status
    error.details = data?.details ?? null
    throw error
  }
  return data
}

export const api = {
  /** Backend + key status, safe to show in the room settings. */
  config: () => request("/api/config"),

  /** Open a new room; resolves to its code. */
  createRoom: () => request("/api/rooms", { method: "POST" }),

  /** Does this code lead anywhere? Resolves to null when it does not. */
  async findRoom(code) {
    try {
      return await request(`/api/rooms/${encodeURIComponent(code)}`)
    } catch (err) {
      if (err.status === 404) return null
      throw err
    }
  },

  /** Start this room's shared browser, or join the one already running. */
  startSession: (code, options = {}) =>
    request(`/api/rooms/${encodeURIComponent(code)}/session`, { method: "POST", body: options }),

  /** The room's running session, or null when there is none. */
  async getSession(code) {
    try {
      return await request(`/api/rooms/${encodeURIComponent(code)}/session`)
    } catch (err) {
      if (err.status === 404) return null
      throw err
    }
  },

  /** Shut the room's browser down so it stops consuming minutes. */
  endSession: (code) =>
    request(`/api/rooms/${encodeURIComponent(code)}/session`, { method: "DELETE" }),
}

/**
 * Turn whatever the user typed into a URL: a bare domain becomes https://, and
 * anything else becomes a search.
 */
export function toUrl(input) {
  const value = String(input ?? "").trim()
  if (!value) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
  const looksLikeDomain = /^[^\s/]+\.[a-z]{2,}(\/.*)?$/i.test(value)
  if (looksLikeDomain) return `https://${value}`
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}

/** Short label for the address bar, the way Safari shows just the host. */
export function prettyHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url ?? ""
  }
}

/** Room codes are six characters, upper case, no punctuation. */
export const normalizeCode = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6)
