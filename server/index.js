import "dotenv/config"

import express from "express"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { HyperbeamClient, HyperbeamError } from "./hyperbeam.js"
import { createParty } from "./party.js"

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
 * One virtual computer for the whole party: everybody watches the same screen,
 * which is the entire point, and a test key is not spent on a VM per viewer.
 * @type {{ session_id: string, embed_url: string, admin_token: string, created_at: number }|null}
 */
let current = null
/** @type {Promise<any>|null} Guard so simultaneous joins share one API call. */
let inflight = null

/** What the browser is allowed to see. `admin_token` never leaves this process. */
function publicSession(session) {
  return session
    ? { sessionId: session.session_id, embedUrl: session.embed_url, createdAt: session.created_at }
    : null
}

const app = express()
app.use(express.json())
app.disable("x-powered-by")
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }))

// The Hyperbeam web SDK, served locally so the room loads without a CDN.
app.use(
  "/vendor/hyperbeam.js",
  express.static(path.join(ROOT, "node_modules/@hyperbeam/web/dist/index.js")),
)

app.get("/api/config", (_req, res) => {
  res.json({
    configured: Boolean(hyperbeam),
    error: configError,
    testKey: hyperbeam?.isTestKey ?? false,
    startUrl: hyperbeam?.startUrl ?? null,
    width: hyperbeam?.width ?? null,
    height: hyperbeam?.height ?? null,
    roomName: process.env.ROOM_NAME || "Sala de cine",
    userAgent: hyperbeam?.userAgent ?? null,
  })
})

app.get("/api/session", (_req, res) => {
  if (!current) return res.status(404).json({ error: "No hay ninguna sesión activa" })
  res.json(publicSession(current))
})

/** Open the shared browser, or join the one already running. */
app.post("/api/session", async (req, res, next) => {
  if (!hyperbeam) return res.status(500).json({ error: configError })
  try {
    if (current && !req.body?.fresh) return res.json(publicSession(current))
    if (current && req.body?.fresh) await terminate()

    if (!inflight) {
      inflight = hyperbeam
        .createSession({ startUrl: req.body?.startUrl })
        .then((session) => {
          current = { ...session, created_at: Date.now() }
          party.sessionStarted(publicSession(current))
          return current
        })
        .finally(() => {
          inflight = null
        })
    }
    res.json(publicSession(await inflight))
  } catch (err) {
    next(err)
  }
})

app.delete("/api/session", async (_req, res, next) => {
  try {
    const had = Boolean(current)
    await terminate()
    res.json({ terminated: had })
  } catch (err) {
    next(err)
  }
})

async function terminate() {
  if (!current || !hyperbeam) return
  const { session_id: sessionId } = current
  current = null
  party.sessionEnded()
  try {
    await hyperbeam.deleteSession(sessionId)
  } catch (err) {
    // A session Hyperbeam already reaped is not an error on our side.
    console.warn(`[hyperbeam] no se pudo terminar ${sessionId}: ${err.message}`)
  }
}

// Single page: any other path serves the room.
app.get(/^\/(?!api\/|vendor\/).*/, (_req, res) => {
  res.sendFile(path.join(ROOT, "public/index.html"))
})

app.use((err, _req, res, _next) => {
  if (err instanceof HyperbeamError) {
    console.error(`[hyperbeam] ${err.message}`)
    return res.status(err.status).json({ error: err.message, details: err.body })
  }
  console.error(err)
  res.status(500).json({ error: "Error interno del servidor" })
})

const server = app.listen(PORT, () => {
  console.log(`\n  Watch party lista en http://localhost:${PORT}`)
  console.log("  Comparte esa dirección para ver algo juntos.\n")
  if (configError) {
    console.warn(`  ⚠  ${configError}`)
    console.warn("     La sala abre, pero no puede arrancar el navegador compartido.\n")
  } else if (hyperbeam.isTestKey) {
    console.log("  ℹ  Clave de prueba: los minutos son limitados.\n")
  }
})

const party = createParty(server, { getSession: () => publicSession(current) })

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log("\nCerrando la sala y apagando el navegador compartido…")
    await terminate()
    party.close()
    server.close(() => process.exit(0))
  })
}
