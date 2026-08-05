/**
 * Persistent OS state.
 *
 * One object, saved to localStorage on every mutation, with a tiny pub/sub so
 * the status bar, Control Center and Settings all stay in sync when any of them
 * flips a switch.
 */

const KEY = "hyper-ios:v1"

export const WALLPAPERS = [
  {
    id: "sonoma",
    name: "Sonoma",
    css: "linear-gradient(160deg,#ff8a3d 0%,#f03d8f 34%,#8a2fd6 66%,#1b1464 100%)",
  },
  {
    id: "abyss",
    name: "Abismo",
    css: "radial-gradient(120% 90% at 20% 10%,#1f6feb 0%,#0b1f52 45%,#04050f 100%)",
  },
  {
    id: "aurora",
    name: "Aurora",
    css: "linear-gradient(200deg,#0f2027 0%,#12694f 40%,#38ef7d 72%,#c9ffd6 100%)",
  },
  {
    id: "dune",
    name: "Duna",
    css: "linear-gradient(180deg,#f6d365 0%,#fda085 45%,#a8467a 100%)",
  },
  {
    id: "graphite",
    name: "Grafito",
    css: "linear-gradient(155deg,#3a3a44 0%,#1a1a20 50%,#0a0a0d 100%)",
  },
  {
    id: "bloom",
    name: "Flor",
    css: "radial-gradient(90% 70% at 75% 20%,#ff5fa2 0%,#7b2ff7 45%,#160b2e 100%)",
  },
]

const DEFAULTS = {
  owner: "Noah",
  appearance: "dark",
  wallpaper: "sonoma",
  reduceMotion: false,
  wifi: true,
  bluetooth: true,
  airplane: false,
  dnd: false,
  rotationLock: false,
  brightness: 0.82,
  volume: 0.6,
  passcodeEnabled: false,
  notes: [
    {
      id: "welcome",
      title: "Bienvenido a Hyper",
      body:
        "Bienvenido a Hyper\n\nEste es un iOS completo dentro del navegador.\n\n• Safari abre un navegador virtual real (Hyperbeam)\n• Desliza hacia arriba para volver al inicio\n• Desliza hacia abajo en el inicio para Spotlight\n• Desliza desde la esquina superior derecha para el Centro de control",
      updatedAt: Date.now() - 1000 * 60 * 42,
    },
    {
      id: "ideas",
      title: "Lista de la compra",
      body: "Lista de la compra\n\n- Café\n- Pan\n- Aguacates\n- Cable USB-C",
      updatedAt: Date.now() - 1000 * 60 * 60 * 26,
    },
  ],
  chats: [
    {
      id: "ana",
      name: "Ana",
      color: "#ff375f",
      messages: [
        { from: "them", text: "¿Ya probaste el navegador virtual?", at: Date.now() - 1000 * 60 * 55 },
        { from: "me", text: "Sí, abre Safari desde el dock 👀", at: Date.now() - 1000 * 60 * 54 },
        { from: "them", text: "Se ve igualito a un iPhone", at: Date.now() - 1000 * 60 * 52 },
      ],
    },
    {
      id: "equipo",
      name: "Equipo",
      color: "#0a84ff",
      messages: [
        { from: "them", text: "Demo mañana a las 10", at: Date.now() - 1000 * 60 * 60 * 5 },
      ],
    },
    {
      id: "papa",
      name: "Papá",
      color: "#30d158",
      messages: [{ from: "them", text: "Llámame cuando puedas", at: Date.now() - 1000 * 60 * 60 * 20 }],
    },
  ],
  installed: [],
  homeUrl: "https://www.google.com",
  // Sala (the Hyperbeam room)
  roomName: "Cinema",
  roomChat: [],
  reminders: null,
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULTS)
    const saved = JSON.parse(raw)
    // Shallow merge keeps new defaults available after an upgrade.
    return { ...structuredClone(DEFAULTS), ...saved }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

const listeners = new Set()

export const state = load()

/** Persist and notify. Pass the changed keys for targeted listeners. */
export function commit(keys = []) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* private mode, quota — the OS still works in memory */
  }
  const changed = Array.isArray(keys) ? keys : [keys]
  for (const fn of listeners) fn(changed, state)
}

/** Set one or more values and persist. */
export function set(patch) {
  Object.assign(state, patch)
  commit(Object.keys(patch))
}

/** Toggle a boolean setting and return the new value. */
export function toggle(key) {
  state[key] = !state[key]
  commit([key])
  return state[key]
}

/** Subscribe to changes; returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function wallpaperCss(id = state.wallpaper) {
  return (WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]).css
}

/** Restore factory settings. */
export function reset() {
  localStorage.removeItem(KEY)
  Object.assign(state, structuredClone(DEFAULTS))
  commit(Object.keys(state))
}
