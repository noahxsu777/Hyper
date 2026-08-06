/** The few preferences that survive a reload: who you are and how loud it is. */

const KEY = "watch-party:v1"

const DEFAULTS = {
  /**
   * Who this browser is, across reloads and locked screens. The room uses it to
   * recognise someone coming back instead of counting them twice — and to keep
   * the host their room.
   */
  clientId: "",
  name: "",
  volume: 0.85,
  muted: false,
  theatre: false,
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export const state = load()

if (!state.clientId) {
  state.clientId =
    globalThis.crypto?.randomUUID?.() ?? `c${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* private mode: identity lasts for this tab only */
  }
}

export function set(patch) {
  Object.assign(state, patch)
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* private mode — the session still works, it just will not be remembered */
  }
}

/** Stable colour per person, so the same name always looks the same. */
const COLOURS = [
  "#ff375f",
  "#ff9f0a",
  "#30d158",
  "#40c8e0",
  "#0a84ff",
  "#7c5cff",
  "#bf5af2",
  "#ff6482",
]

export function colourFor(seed = "") {
  // Viewer ids arrive as v1, v2, v3… — walking the palette in that order
  // guarantees that two people who joined back to back never share a colour.
  const sequence = /^v(\d+)/.exec(seed)
  if (sequence) return COLOURS[(Number(sequence[1]) - 1) % COLOURS.length]

  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return COLOURS[(hash >>> 0) % COLOURS.length]
}

export function initialsFor(name = "") {
  const trimmed = name.trim()
  return trimmed ? trimmed[0].toUpperCase() : "?"
}
