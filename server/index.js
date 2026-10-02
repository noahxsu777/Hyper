import "dotenv/config"

import express from "express"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { HyperbeamClient, HyperbeamError } from "./hyperbeam.js"
import { GiphyClient } from "./giphy.js"
import { YouTubeClient, YouTubeError } from "./youtube.js"
import { createRoomHub } from "./rooms.js"
import { loadBrand, publicBrand, renderIndex, manifest, renderIcon, ICON_SIZES } from "./brand.js"
import { AccessControl, sameToken } from "./access.js"
import { UsageLog } from "./usage.js"
import { securityHeaders, rateLimit } from "./security.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")
const PORT = Number(process.env.PORT) || 3000

/** In production the browser gets friendly messages; the details go to the log. */
const PRODUCTION = process.env.NODE_ENV === "production"

/**
 * The longest an EMPTY room may keep its shared browser, whatever its host
 * picks in Settings. The room's default is 2 minutes (ROOM_IDLE_SESSION_MS).
 */
const MAX_IDLE_SESSION_MS = Number(process.env.ROOM_IDLE_SESSION_MAX_MS) || 30 * 60 * 1000

const config = {
  apiKey: process.env.HYPERBEAM_API_KEY,
  apiUrl: process.env.HYPERBEAM_API_URL,
  width: Number(process.env.HB_WIDTH) || undefined,
  height: Number(process.env.HB_HEIGHT) || undefined,
  startUrl: process.env.HB_START_URL,
  // Hyperbeam's own "nobody is connected" clock is the backstop for a server
  // that dies without cleaning up. It must not be shorter than the longest
  // delay a host can choose, or that choice would be cut short from outside.
  offlineTimeout: process.env.HB_OFFLINE_TIMEOUT
    ? Number(process.env.HB_OFFLINE_TIMEOUT)
    : Math.ceil(MAX_IDLE_SESSION_MS / 1000) + 60,
  // 0 desactiva el reloj de inactividad, que es lo que cortaba las películas.
  inactiveTimeout: process.env.HB_INACTIVE_TIMEOUT ? Number(process.env.HB_INACTIVE_TIMEOUT) : undefined,
  absoluteTimeout: process.env.HB_ABSOLUTE_TIMEOUT ? Number(process.env.HB_ABSOLUTE_TIMEOUT) : undefined,
  userAgent: process.env.HB_USER_AGENT,
  lockControl: ["1", "true"].includes(String(process.env.HB_LOCK_CONTROL).toLowerCase()),
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

/** What an end user may read about a missing key: not how to fix it. */
const UNAVAILABLE = "El navegador compartido no está disponible ahora mismo."
const publicConfigError = () => (PRODUCTION ? UNAVAILABLE : configError)

/**
 * Every room runs at most one virtual computer, and one room's browser is
 * nobody else's business. A test key would not survive a VM per person.
 */
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 25

/**
 * Hard ceiling on virtual computers alive at once, whoever asks. This is the
 * bill's upper bound: rooms are free, machines are not. 0 lifts the cap.
 */
const MAX_SESSIONS = process.env.MAX_SESSIONS === undefined ? 10 : Math.max(0, Number(process.env.MAX_SESSIONS) || 0)

const TRUST_PROXY = process.env.TRUST_PROXY ? ["1", "true"].includes(process.env.TRUST_PROXY) : HOSTED

const brand = loadBrand(process.env)
const access = new AccessControl(process.env.ACCESS_CODES)
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN ?? "").length >= 16 ? process.env.ADMIN_TOKEN : null

const STATE_FILE = process.env.ROOM_STATE_FILE || path.join(ROOT, "rooms-state.json")
const usage = new UsageLog(process.env.USAGE_FILE || path.join(path.dirname(STATE_FILE), "usage.jsonl"))

/** GIFs are proxied so the key never reaches the browser. */
const giphy = new GiphyClient(process.env.GIPHY_API_KEY)

/** YouTube search for the room's synced player; no key of ours involved. */
const youtube = new YouTubeClient({ apiUrl: process.env.YOUTUBE_API_URL || undefined })

const app = express()
app.disable("x-powered-by")
app.set("trust proxy", TRUST_PROXY ? 1 : false)
app.use(
  securityHeaders({
    // Embedding the app in a customer's own site is opt-in, one origin at a time.
    frameAncestors: (process.env.FRAME_ANCESTORS || "'none'").replace(/[;\r\n]/g, ""),
  }),
)
app.use(express.json({ limit: "16kb" }))

/* ------------------------------------------------------------ rate limits */

// A whole office can sit behind one address, so a customer that outgrows these
// defaults raises them all at once with RATE_LIMIT_MULTIPLIER=3 instead of
// editing code.
const RATE_SCALE = Math.max(0.1, Number(process.env.RATE_LIMIT_MULTIPLIER) || 1)
const limit = (windowMs, max, message) =>
  rateLimit({ windowMs, max: Math.ceil(max * RATE_SCALE), message, trustProxy: TRUST_PROXY })
const limits = {
  createRoom: limit(10 * 60 * 1000, 12, "Estás creando salas demasiado deprisa. Espera un momento."),
  // Opening a browser spends money and takes the access code, so wrong guesses
  // count too: this is also what slows down someone trying codes at random.
  session: limit(10 * 60 * 1000, 20, "Demasiados intentos de abrir el navegador. Espera un momento."),
  lookup: limit(60 * 1000, 120, "Demasiadas peticiones. Espera un momento."),
  search: limit(60 * 1000, 60, "Demasiadas búsquedas. Espera un momento."),
  admin: limit(60 * 1000, 20, "Demasiadas peticiones."),
}

/* ------------------------------------------------------------ static files */

const PUBLIC_DIR = path.join(ROOT, "public")
const INDEX_HTML = renderIndex(fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8"), brand)
const ASSETS_DIR = process.env.BRAND_ASSETS_DIR ? path.resolve(process.env.BRAND_ASSETS_DIR) : null

const sendIndex = (_req, res) => {
  res.set("Cache-Control", "no-cache").type("html").send(INDEX_HTML)
}
app.get(["/", "/index.html"], sendIndex)

app.get("/manifest.webmanifest", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600").type("application/manifest+json").send(JSON.stringify(manifest(brand)))
})

// Icons are drawn from the brand colour, unless the customer dropped their own
// icon-<size>.png files into BRAND_ASSETS_DIR.
app.get("/icons/icon-:size.png", (req, res) => {
  const size = Number(req.params.size)
  if (!ICON_SIZES.has(size)) return res.status(404).end()
  if (ASSETS_DIR) {
    const custom = path.join(ASSETS_DIR, `icon-${size}.png`)
    if (fs.existsSync(custom)) return res.sendFile(custom, { maxAge: "1d" })
  }
  res.set("Cache-Control", "public, max-age=86400").type("png").send(renderIcon(size, brand))
})

app.use(express.static(PUBLIC_DIR, { index: false }))

// The Hyperbeam web SDK, served locally so a room loads without a CDN.
app.use(
  "/vendor/hyperbeam.js",
  express.static(path.join(ROOT, "node_modules/@hyperbeam/web/dist/index.js")),
)

/* ----------------------------------------------------------------- health */

app.get("/healthz", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ ok: true, uptime: Math.round(process.uptime()), rooms: hub.size })
})

/* ---------------------------------------------------------------- config */

app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store")
  const body = {
    configured: Boolean(hyperbeam),
    error: configError ? publicConfigError() : null,
    brand: publicBrand(brand),
    accessRequired: access.enabled,
    width: hyperbeam?.width ?? null,
    height: hyperbeam?.height ?? null,
    rooms: hub.size,
    maxRooms: MAX_ROOMS,
    giphy: giphy.configured,
  }
  // Operator diagnostics: useful while setting up, not something to hand every
  // guest of a customer's room.
  if (!PRODUCTION) {
    Object.assign(body, {
      testKey: hyperbeam?.isTestKey ?? false,
      startUrl: hyperbeam?.startUrl ?? null,
      userAgent: hyperbeam?.userAgent ?? null,
      activeUserAgent: hyperbeam?.activeUserAgent ?? null,
      inactiveTimeout: hyperbeam?.inactiveTimeout ?? null,
      // Los segundos sin nadie conectado que la API aceptó de verdad.
      activeOfflineTimeout: hyperbeam?.activeOfflineTimeout ?? null,
      // Null hasta la primera sesión: hasta entonces no sabemos si esta cuenta
      // acepta configurar los relojes, y la sala no debería dar por hecho que sí.
      timeoutsApplied: hyperbeam?.timeoutsApplied ?? null,
      // Whether strict control is asked for, and whether the API took it.
      lockControl: hyperbeam?.lockControl ?? false,
      controlLockApplied: hyperbeam?.controlLockApplied ?? null,
    })
  }
  res.json(body)
})

/* ------------------------------------------------------------------ giphy */

app.get("/api/gifs", limits.search, async (req, res, next) => {
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

app.get("/api/youtube", limits.search, async (req, res, next) => {
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
app.post("/api/rooms", limits.createRoom, (_req, res) => {
  // At the cap, an empty room nobody has used in hours yields its slot; only
  // when every room has people in it does anyone get turned away.
  if (hub.size >= MAX_ROOMS) hub.evictOldestEmpty()
  if (hub.size >= MAX_ROOMS) {
    return res.status(503).json({
      error: "Todas las salas están llenas ahora mismo. Prueba en un momento.",
      code: "capacity",
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
app.get("/api/rooms", limits.lookup, (_req, res) => {
  const rooms = hub
    .rooms()
    .filter((room) => room.listed)
    .sort((a, b) => b.viewers.size - a.viewers.size || a.createdAt - b.createdAt)
    .map((room) => room.summary())
  res.json({ rooms })
})

/** Does this code lead anywhere, and will it let someone in? */
app.get("/api/rooms/:code", limits.lookup, (req, res) => {
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

/**
 * What the people running the room need to steer the shared browser through
 * Hyperbeam's own permission system: the session's admin token. It goes to the
 * owner and moderators only, and is asked for again on every attach, so a
 * refreshed host gets it back (the room knows them by their browser, not by
 * their socket). It is never part of the public session, the welcome message
 * or any broadcast.
 */
app.get("/api/rooms/:code/session/control", limits.lookup, (req, res) => {
  const auth = authorize(req, res)
  if (!auth) return
  const { room, role } = auth
  if (!room.session) return res.status(404).json({ error: "No hay ninguna sesión activa" })
  res.set("Cache-Control", "no-store").json({
    adminToken: room.session.admin_token ?? null,
    controlLocked: Boolean(room.session.control_locked),
    // The owner outranks moderators when two people reach for the wheel.
    priority: role === "owner" ? 2 : 1,
  })
})

/** The room's shared browser. */
app.get("/api/rooms/:code/session", limits.lookup, (req, res) => {
  const room = hub.getRoom(req.params.code)
  if (!room) return res.status(404).json({ error: "Esa sala no existe." })
  if (!room.session) return res.status(404).json({ error: "No hay ninguna sesión activa" })
  res.json(room.publicSession())
})

/** Virtual computers alive or being started right now. */
const liveSessions = () => hub.rooms().filter((room) => room.session || room.inflight).length

app.post("/api/rooms/:code/session", limits.session, async (req, res, next) => {
  if (!hyperbeam) return res.status(503).json({ error: publicConfigError(), code: "unavailable" })
  const auth = authorize(req, res)
  if (!auth) return
  const { room } = auth

  try {
    // Joining a browser that is already running costs nothing, so it is never gated.
    if (room.session && !req.body?.fresh) return res.json(room.publicSession())

    // Starting one costs minutes. A room is licensed by the first valid code and
    // stays licensed: its later starts need no code, and the minutes are billed
    // to that customer.
    let customer = room.customer
    if (access.enabled && !customer) {
      const supplied = req.get("x-access-code")
      customer = access.check(supplied)
      if (!customer) {
        return res.status(401).json({
          code: supplied ? "access_invalid" : "access_required",
          error: supplied
            ? "Ese código de acceso no es válido."
            : "Hace falta un código de acceso para abrir el navegador compartido.",
        })
      }
    }

    if (room.session && req.body?.fresh) await terminate(room, "fresh")

    if (!room.inflight) {
      // Checked and claimed in the same tick, so two rooms cannot both take the last slot.
      if (MAX_SESSIONS && liveSessions() >= MAX_SESSIONS) {
        console.warn(`[hyperbeam] tope de ${MAX_SESSIONS} navegadores alcanzado; rechazada la sala ${room.code}`)
        return res.status(503).json({
          code: "capacity",
          error: "Ahora mismo no hay navegadores compartidos libres. Prueba de nuevo en unos minutos.",
        })
      }
      room.inflight = hyperbeam
        .createSession({ startUrl: req.body?.startUrl })
        .then((session) => {
          if (customer) room.customer = customer
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

// Closing a browser saves money, so it is never held back by the opening limit.
app.delete("/api/rooms/:code/session", limits.lookup, async (req, res, next) => {
  const auth = authorize(req, res)
  if (!auth) return
  try {
    const had = Boolean(auth.room.session)
    await terminate(auth.room, "closed")
    res.json({ terminated: had })
  } catch (err) {
    next(err)
  }
})

/** Shut a room's virtual computer down so it stops consuming minutes. */
async function terminate(room, reason = "closed") {
  const session = room.session
  if (!session || !hyperbeam) return
  room.clearSession(reason)
  // Recorded before the call that can fail: the minutes were used either way.
  usage.record({
    customer: room.customer,
    room: room.code,
    sessionId: session.session_id,
    startedAt: session.created_at ?? Date.now(),
    endedAt: Date.now(),
    reason,
  })
  try {
    await hyperbeam.deleteSession(session.session_id)
  } catch (err) {
    // A session Hyperbeam already reaped is not an error on our side.
    console.warn(`[hyperbeam] no se pudo terminar ${session.session_id}: ${err.message}`)
  }
}

/* ----------------------------------------------------------------- admin */

/**
 * What the operator bills from: minutes per customer, and what is running now.
 * Off unless ADMIN_TOKEN is set (16+ characters).
 *   curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://app/api/admin/usage?since=2026-10-01"
 */
app.get("/api/admin/usage", limits.admin, (req, res) => {
  if (!ADMIN_TOKEN) return res.status(404).json({ error: "No encontrado." })
  const bearer = String(req.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!sameToken(bearer, ADMIN_TOKEN)) return res.status(401).json({ error: "No autorizado." })

  const since = Number(req.query.since) || Date.parse(String(req.query.since ?? "")) || 0
  const now = Date.now()
  res.set("Cache-Control", "no-store").json({
    since,
    customers: usage.summary(since),
    live: hub
      .rooms()
      .filter((room) => room.session)
      .map((room) => ({
        room: room.code,
        customer: room.customer ?? "(sin cliente)",
        startedAt: room.session.created_at,
        minutes: Math.round(((now - (room.session.created_at ?? now)) / 60000) * 100) / 100,
        viewers: room.viewers.size,
      })),
    sessions: { live: liveSessions(), max: MAX_SESSIONS },
    rooms: { open: hub.size, max: MAX_ROOMS },
  })
})

/* ---------------------------------------------------------------- fallback */

app.use("/api", (_req, res) => res.status(404).json({ error: "No encontrado." }))

// Single page: any path that is not a file serves the app, so /ABC123 opens
// that room. A path with a dot is a file that does not exist: a real 404.
app.get(/^\/(?!vendor\/|icons\/)[^.]*$/, sendIndex)

/**
 * Hyperbeam's own words are for the log. A customer's guest does not need to
 * read an upstream status code, and "quota exceeded" in particular is the
 * operator's problem, so it is flagged loudly there.
 */
function publicHyperbeamError(err) {
  const quota = err.status === 402 || err.status === 429 || /quota|credit|minutes|billing|exceed/i.test(err.message)
  if (quota) console.error("[ALERTA][hyperbeam] posible cupo agotado:", err.message)
  else if (err.status === 401 || err.status === 403) console.error("[ALERTA][hyperbeam] clave rechazada:", err.message)
  if (!PRODUCTION) return err.message
  if (quota) return "Se ha agotado el cupo de navegadores compartidos. Avisa a quien administra el servicio."
  if (err.status === 502) return "No se pudo contactar con el servicio de navegadores. Inténtalo de nuevo en un momento."
  return "No se pudo abrir el navegador compartido. Inténtalo de nuevo."
}

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Petición demasiado grande." })
  if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: "Petición no válida." })
  if (err instanceof YouTubeError) {
    console.error(`[youtube] ${err.message}`)
    return res.status(err.status ?? 502).json({ error: PRODUCTION ? "La búsqueda de YouTube no está disponible." : err.message })
  }
  if (err?.name === "GiphyError") {
    console.error(`[giphy] ${err.message}`)
    return res.status(err.status ?? 502).json({ error: PRODUCTION ? "Los GIFs no están disponibles ahora mismo." : err.message })
  }
  if (err instanceof HyperbeamError) {
    console.error(`[hyperbeam] ${err.message}`)
    const body = { error: publicHyperbeamError(err) }
    if (!PRODUCTION) body.details = err.body
    return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json(body)
  }
  console.error(err)
  res.status(500).json({ error: "Error interno del servidor" })
})

const server = app.listen(PORT, () => {
  console.log(`\n  ${brand.name} lista en http://localhost:${PORT}`)
  console.log(`  Modo: ${PRODUCTION ? "producción" : "desarrollo"} · máx. ${MAX_ROOMS} salas, ${MAX_SESSIONS || "∞"} navegadores a la vez`)
  console.log(
    access.enabled
      ? `  Acceso: ${access.entries.length} cliente(s) con código para abrir el navegador compartido`
      : "  Acceso: abierto (sin ACCESS_CODES, cualquiera puede abrir un navegador)",
  )
  if (access.weak.length) console.warn(`  ⚠  Códigos de menos de 8 caracteres: ${access.weak.join(", ")}`)
  if (process.env.ADMIN_TOKEN && !ADMIN_TOKEN) console.warn("  ⚠  ADMIN_TOKEN necesita 16 caracteres como mínimo; el panel de uso queda desactivado.")
  console.log(ADMIN_TOKEN ? "  Uso por cliente en /api/admin/usage" : "  Panel de uso desactivado (define ADMIN_TOKEN)")
  console.log("")
  if (configError) {
    console.warn(`  ⚠  ${configError}`)
    console.warn("     Las salas abren, pero no pueden arrancar el navegador compartido.\n")
  } else if (hyperbeam.isTestKey) {
    console.log(`  ${PRODUCTION ? "⚠" : "ℹ"}  Clave de prueba: los minutos son limitados.\n`)
  }
})

const hub = createRoomHub(server, {
  ownerGraceMs: Number(process.env.ROOM_OWNER_GRACE_MS) || undefined,
  emptyTtlMs: Number(process.env.ROOM_EMPTY_TTL_MS) || undefined,
  idleSessionMs: Number(process.env.ROOM_IDLE_SESSION_MS) || undefined,
  maxIdleSessionMs: MAX_IDLE_SESSION_MS,
  maxRooms: MAX_ROOMS,
  maxViewersPerRoom: process.env.MAX_VIEWERS_PER_ROOM === undefined ? 50 : Number(process.env.MAX_VIEWERS_PER_ROOM) || 0,
  maxSocketsPerIp: Number(process.env.MAX_SOCKETS_PER_IP) || 30,
  trustProxy: TRUST_PROXY,
  // Nadie mirando: el navegador compartido se apaga aunque la sala siga
  // existiendo. La sala es memoria; la máquina virtual son minutos.
  onIdleSession: (room) => {
    terminate(room, "idle").catch(() => {})
  },
  // An abandoned room must not leave a virtual computer running behind it.
  onRoomClosed: (room) => {
    terminate(room, "room-closed").catch(() => {})
  },
})

/* ------------------------------------------------------------ persistence */
/*
 * Rooms live in memory, and memory dies with the process. The skeleton of
 * every room — code, owner, moderators, rules, even its running session — is
 * written to disk every few seconds and restored on boot, so a crash or a
 * machine restart no longer greets people with "esa sala ya no existe".
 * (A redeploy replaces the disk unless a volume is mounted; for that case, a
 * known code walks back in and revives the room by itself.)
 */
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

let shuttingDown = false
async function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log("\nCerrando las salas y apagando los navegadores compartidos…")
  await Promise.all(hub.rooms().map((room) => terminate(room, "shutdown").catch(() => {})))
  // After the terminations, so the file does not resurrect dead sessions.
  saveState()
  hub.close()
  server.close(() => process.exit(exitCode))
  // A stuck connection must not keep the machine, and its meter, running.
  setTimeout(() => process.exit(exitCode), 5000).unref()
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(0))

// One bad promise must not take every room down with it, but an exception we
// did not expect leaves the process in an unknown state: shut down cleanly so
// no virtual computer is left running, and let the host restart us.
process.on("unhandledRejection", (reason) => console.error("[error] promesa sin manejar:", reason))
process.on("uncaughtException", (err) => {
  console.error("[error] excepción sin capturar:", err)
  shutdown(1)
})
