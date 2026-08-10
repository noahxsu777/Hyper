import "dotenv/config"

import express from "express"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { HyperbeamClient, HyperbeamError } from "./hyperbeam.js"
import { GiphyClient } from "./giphy.js"
import { YouTubeClient, YouTubeError } from "./youtube.js"
import { createRoomHub } from "./rooms.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")
const PORT = Number(process.env.PORT) || 3000

const config = {
  apiKey: process.env.HYPERBEAM_API_KEY,
  apiUrl: process.env.HYPERBEAM_API_URL,
  width: Number(process.env.HB_WIDTH) || undefined,
  height: Number(process.env.HB_HEIGHT) || undefined,
  startUrl: process.env.HB_START_URL,
  offlineTimeout: process.env.HB_OFFLINE_TIMEOUT ? Number(process.env.HB_OFFLINE_TIMEOUT) : undefined,
  // 0 desactiva el reloj de inactividad, que es lo que cortaba las películas.
  inactiveTimeout: process.env.HB_INACTIVE_TIMEOUT ? Number(process.env.HB_INACTIVE_TIMEOUT) : undefined,
  absoluteTimeout: process.env.HB_ABSOLUTE_TIMEOUT ? Number(process.env.HB_ABSOLUTE_TIMEOUT) : undefined,
  userAgent: process.env.HB_USER_AGENT,
}

// Fly (and most hosts) set an app name in the environment. Telling someone on
// a deployed server to "copy .env.example to .env" is useless advice: there is
// no shell to copy it in, and the fix is a secret instead.
const HOSTED = Boolean(process.env.FLY_APP_NAME || process.env.RAILWAY_PROJECT_ID || process.env.RENDER)
const KEY_HINT = process.env.FLY_APP_NAME
  ? "Defínela en Fly con: fly secrets set HYPERBEAM_API_KEY=sk_test_…"
  : HOSTED
    ? "Defínela como variable de entorno del servicio."
    : "Copia .env.example a .env y pon tu clave dentro."

/** @type {HyperbeamClient|null} */
let hyperbeam = null
/** @type {string|null} */
let configError = null
try {
  hyperbeam = new HyperbeamClient(config)
} catch (err) {
  configError = `${err.message} ${KEY_HINT}`
}

/**
 * Every room runs at most one virtual computer, and one room's browser is
 * nobody else's business. A test key would not survive a VM per person.
 */
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 25

/** GIFs are proxied so the key never reaches the browser. */
const giphy = new GiphyClient(process.env.GIPHY_API_KEY)

/** YouTube search for the room's synced player; no key of ours involved. */
const youtube = new YouTubeClient({ apiUrl: process.env.YOUTUBE_API_URL || undefined })

const app = express()
app.use(express.json())
app.disable("x-powered-by")
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }))

// The Hyperbeam web SDK, served locally so a room loads without a CDN.
app.use(
  "/vendor/hyperbeam.js",
  express.static(path.join(ROOT, "node_modules/@hyperbeam/web/dist/index.js")),
)

/* ---------------------------------------------------------------- config */

app.get("/api/config", (_req, res) => {
  res.json({
    configured: Boolean(hyperbeam),
    error: configError,
    testKey: hyperbeam?.isTestKey ?? false,
    startUrl: hyperbeam?.startUrl ?? null,
    width: hyperbeam?.width ?? null,
    height: hyperbeam?.height ?? null,
    userAgent: hyperbeam?.userAgent ?? null,
    activeUserAgent: hyperbeam?.activeUserAgent ?? null,
    inactiveTimeout: hyperbeam?.inactiveTimeout ?? null,
    // Los segundos sin nadie conectado que la API aceptó de verdad.
    activeOfflineTimeout: hyperbeam?.activeOfflineTimeout ?? null,
    // Null hasta la primera sesión: hasta entonces no sabemos si esta cuenta
    // acepta configurar los relojes, y la sala no debería dar por hecho que sí.
    timeoutsApplied: hyperbeam?.timeoutsApplied ?? null,
    rooms: hub.size,
    maxRooms: MAX_ROOMS,
    giphy: giphy.configured,
  })
})

/* ------------------------------------------------------------------ giphy */

app.get("/api/gifs", async (req, res, next) => {
  const query = String(req.query.q ?? "").trim().slice(0, 80)
  const offset = Math.min(500, Math.max(0, Number(req.query.offset) || 0))
  try {
    const gifs = query ? await giphy.search(query, offset) : await giphy.trending(offset)
    res.json({ gifs })
  } catch (err) {
    next(err)
  }
})

/* --------------------------------------------------------------- youtube */

app.get("/api/youtube", async (req, res, next) => {
  const query = String(req.query.q ?? "").trim().slice(0, 100)
  if (!query) return res.json({ videos: [] })
  try {
    res.json({ videos: await youtube.search(query) })
  } catch (err) {
    next(err)
  }
})

/* ----------------------------------------------------------------- rooms */

/** Open a new room and hand back its code. */
app.post("/api/rooms", (_req, res) => {
  // At the cap, an empty room nobody has used in hours yields its slot; only
  // when every room has people in it does anyone get turned away.
  if (hub.size >= MAX_ROOMS) hub.evictOldestEmpty()
  if (hub.size >= MAX_ROOMS) {
    return res.status(503).json({
      error: "Todas las salas están llenas ahora mismo. Prueba en un momento.",
    })
  }
  const room = hub.createRoom()
  res.json({ code: room.code })
})

/**
 * The rooms anyone may walk into, for the landing page.
 *
 * Only rooms that are open in both senses: unlocked, and with someone actually
 * in them. Busiest first, because a room with people in it is the one worth
 * joining; ties go to whoever opened first.
 */
app.get("/api/rooms", (_req, res) => {
  const rooms = hub
    .rooms()
    .filter((room) => room.listed)
    .sort((a, b) => b.viewers.size - a.viewers.size || a.createdAt - b.createdAt)
    .map((room) => room.summary())
  res.json({ rooms })
})

/** Does this code lead anywhere, and will it let someone in? */
app.get("/api/rooms/:code", (req, res) => {
  const room = hub.getRoom(req.params.code)
  if (!room) return res.status(404).json({ error: "Esa sala no existe." })
  res.json({
    code: room.code,
    locked: room.locked,
    viewers: room.viewers.size,
    live: Boolean(room.session),
  })
})

/**
 * Resolve the token a client was handed on join, and check it is allowed to do
 * this. Driving the shared browser is a moderator's job or the owner's.
 */
function authorize(req, res) {
  const auth = hub.authenticate(req.get("x-room-token") || req.body?.token)
  if (!auth) {
    res.status(401).json({ error: "Entra en la sala antes de hacer esto." })
    return null
  }
  if (auth.room.code !== hub.normalizeCode(req.params.code)) {
    res.status(403).json({ error: "Ese permiso no es de esta sala." })
    return null
  }
  if (!auth.room.canModerate(auth.viewer.clientId)) {
    res.status(403).json({ error: "Solo quien lleva la sala puede hacer esto." })
    return null
  }
  return auth
}

/** The room's shared browser. */
app.get("/api/rooms/:code/session", (req, res) => {
  const room = hub.getRoom(req.params.code)
  if (!room) return res.status(404).json({ error: "Esa sala no existe." })
  if (!room.session) return res.status(404).json({ error: "No hay ninguna sesión activa" })
  res.json(room.publicSession())
})

app.post("/api/rooms/:code/session", async (req, res, next) => {
  if (!hyperbeam) return res.status(500).json({ error: configError })
  const auth = authorize(req, res)
  if (!auth) return
  const { room } = auth

  try {
    if (room.session && !req.body?.fresh) return res.json(room.publicSession())
    if (room.session && req.body?.fresh) await terminate(room)

    if (!room.inflight) {
      room.inflight = hyperbeam
        .createSession({ startUrl: req.body?.startUrl })
        .then((session) => {
          room.setSession({ ...session, created_at: Date.now() })
          return room.publicSession()
        })
        .finally(() => {
          room.inflight = null
        })
    }
    res.json(await room.inflight)
  } catch (err) {
    next(err)
  }
})

app.delete("/api/rooms/:code/session", async (req, res, next) => {
  const auth = authorize(req, res)
  if (!auth) return
  try {
    const had = Boolean(auth.room.session)
    await terminate(auth.room)
    res.json({ terminated: had })
  } catch (err) {
    next(err)
  }
})

/** Shut a room's virtual computer down so it stops consuming minutes. */
async function terminate(room) {
  const session = room.session
  if (!session || !hyperbeam) return
  room.clearSession()
  try {
    await hyperbeam.deleteSession(session.session_id)
  } catch (err) {
    // A session Hyperbeam already reaped is not an error on our side.
    console.warn(`[hyperbeam] no se pudo terminar ${session.session_id}: ${err.message}`)
  }
}

// Single page: any other path serves the app, so /ABC123 opens that room.
app.get(/^\/(?!api\/|vendor\/).*/, (_req, res) => {
  res.sendFile(path.join(ROOT, "public/index.html"))
})

app.use((err, _req, res, _next) => {
  if (err instanceof YouTubeError) {
    console.error(`[youtube] ${err.message}`)
    return res.status(err.status ?? 502).json({ error: err.message })
  }
  if (err?.name === "GiphyError") {
    console.error(`[giphy] ${err.message}`)
    return res.status(err.status ?? 502).json({ error: err.message })
  }
  if (err instanceof HyperbeamError) {
    console.error(`[hyperbeam] ${err.message}`)
    return res.status(err.status).json({ error: err.message, details: err.body })
  }
  console.error(err)
  res.status(500).json({ error: "Error interno del servidor" })
})

const server = app.listen(PORT, () => {
  console.log(`\n  Watch party lista en http://localhost:${PORT}`)
  console.log("  Crea una sala y comparte su código.\n")
  if (configError) {
    console.warn(`  ⚠  ${configError}`)
    console.warn("     Las salas abren, pero no pueden arrancar el navegador compartido.\n")
  } else if (hyperbeam.isTestKey) {
    console.log("  ℹ  Clave de prueba: los minutos son limitados.\n")
  }
})

const hub = createRoomHub(server, {
  ownerGraceMs: Number(process.env.ROOM_OWNER_GRACE_MS) || undefined,
  emptyTtlMs: Number(process.env.ROOM_EMPTY_TTL_MS) || undefined,
  idleSessionMs: Number(process.env.ROOM_IDLE_SESSION_MS) || undefined,
  maxRooms: MAX_ROOMS,
  // Nadie mirando: el navegador compartido se apaga aunque la sala siga
  // existiendo. La sala es memoria; la máquina virtual son minutos.
  onIdleSession: (room) => {
    terminate(room).catch(() => {})
  },
  // An abandoned room must not leave a virtual computer running behind it.
  onRoomClosed: (room) => {
    terminate(room).catch(() => {})
  },
})

/* ------------------------------------------------------------ persistence */
/*
 * Rooms live in memory, and memory dies with the process. The skeleton of
 * every room — code, owner, moderators, rules, even its running session — is
 * written to disk every few seconds and restored on boot, so a crash or a
 * machine restart no longer greets people with "esa sala ya no existe".
 * (A redeploy replaces the disk; for that case, a known code walks back in
 * and revives the room by itself.)
 */
const STATE_FILE = process.env.ROOM_STATE_FILE || path.join(ROOT, "rooms-state.json")

try {
  const restored = hub.restore(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")))
  if (restored) console.log(`  Restauradas ${restored} salas de ${STATE_FILE}`)
} catch {
  /* first boot, or no state to restore */
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(hub.serialize()))
  } catch (err) {
    console.warn(`[salas] no se pudo guardar el estado: ${err.message}`)
  }
}
setInterval(saveState, 15000).unref()

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log("\nCerrando las salas y apagando los navegadores compartidos…")
    await Promise.all(hub.rooms().map((room) => terminate(room).catch(() => {})))
    // After the terminations, so the file does not resurrect dead sessions.
    saveState()
    hub.close()
    server.close(() => process.exit(0))
  })
}
