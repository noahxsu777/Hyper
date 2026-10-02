/** Client for our own backend, which brokers the Hyperbeam REST API. */

/**
 * Proof of who we are in a room, handed over the socket on join. The server
 * decides what it entitles us to; we just carry it.
 */
let roomToken = null
export const setRoomToken = (token) => {
  roomToken = token
}

/**
 * The customer's code for opening a shared browser. Only that one request
 * carries it: nothing else on the server has any use for it.
 */
let accessCode = ""
export const setAccessCode = (code) => {
  accessCode = String(code ?? "").trim()
}

async function request(path, { headers, ...options } = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(roomToken ? { "x-room-token": roomToken } : {}),
      ...headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* a proxy's HTML error page: fall through to the status line below */
  }
  if (!res.ok) {
    const error = new Error(data?.error || (res.status === 429 ? "Demasiadas peticiones. Espera un momento." : `${res.status} ${res.statusText}`))
    error.status = res.status
    error.code = data?.code ?? null
    error.details = data?.details ?? null
    throw error
  }
  return data
}

export const api = {
  /** Backend + key status, safe to show in the room settings. */
  config: () => request("/api/config"),

  /** GIFs, proxied so the GIPHY key stays on the server. */
  gifs: (query = "", offset = 0) =>
    request(`/api/gifs?q=${encodeURIComponent(query)}&offset=${offset}`),

  /** YouTube search for the synced player, proxied through our server. */
  youtube: (query) => request(`/api/youtube?q=${encodeURIComponent(query)}`),

  /** Open a new room; resolves to its code. */
  createRoom: () => request("/api/rooms", { method: "POST" }),

  /** Rooms anyone may walk into: unlocked, and with people in them. */
  listRooms: () => request("/api/rooms"),

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
    request(`/api/rooms/${encodeURIComponent(code)}/session`, {
      method: "POST",
      body: options,
      headers: accessCode ? { "x-access-code": accessCode } : {},
    }),

  /**
   * The admin token and priority that let a host or moderator steer the shared
   * browser through Hyperbeam's permissions. Resolves to null for anyone else.
   */
  async sessionControl(code) {
    try {
      return await request(`/api/rooms/${encodeURIComponent(code)}/session/control`)
    } catch (err) {
      if (err.status === 403 || err.status === 404 || err.status === 401) return null
      throw err
    }
  },

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
