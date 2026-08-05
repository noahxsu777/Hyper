import "dotenv/config"

import express from "express"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { HyperbeamClient, HyperbeamError } from "./hyperbeam.js"

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
}

/** @type {HyperbeamClient|null} */
let hyperbeam = null
/** @type {string|null} */
let configError = null
try {
  hyperbeam = new HyperbeamClient(config)
} catch (err) {
  configError = err.message
}

/**
 * A single virtual computer is shared by every visitor: that is the whole point
 * of Hyperbeam (multiplayer browsing) and it keeps test-key minutes from being
 * burned by one VM per tab.
 * @type {{ session_id: string, embed_url: string, admin_token: string, created_at: number }|null}
 */
let current = null
/** @type {Promise<any>|null} Guard so concurrent requests share one API call. */
let inflight = null

const app = express()
app.use(express.json())
app.disable("x-powered-by")

app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }))

// The Hyperbeam web SDK, served locally so the OS boots without a CDN.
app.use(
  "/vendor/hyperbeam.js",
  express.static(path.join(ROOT, "node_modules/@hyperbeam/web/dist/index.js")),
)

/** What the client is allowed to know about the backend. */
app.get("/api/config", (_req, res) => {
  res.json({
    configured: Boolean(hyperbeam),
    error: configError,
    testKey: hyperbeam?.isTestKey ?? false,
    startUrl: hyperbeam?.startUrl ?? null,
    width: hyperbeam?.width ?? null,
    height: hyperbeam?.height ?? null,
    hasSession: Boolean(current),
  })
})

/** The embed payload for the browser. `admin_token` stays on the server. */
function publicSession(session) {
  return {
    sessionId: session.session_id,
    embedUrl: session.embed_url,
    createdAt: session.created_at,
  }
}

/** Current session, if any. */
app.get("/api/session", (_req, res) => {
  if (!current) return res.status(404).json({ error: "No active session" })
  res.json(publicSession(current))
})

/** Join the shared virtual computer, starting it on first use. */
app.post("/api/session", async (req, res, next) => {
  if (!hyperbeam) {
    return res.status(500).json({ error: configError })
  }
  try {
    if (current && !req.body?.fresh) {
      return res.json(publicSession(current))
    }
    if (current && req.body?.fresh) {
      await terminate()
    }
    if (!inflight) {
      inflight = hyperbeam
        .createSession({ startUrl: req.body?.startUrl })
        .then((session) => {
          current = { ...session, created_at: Date.now() }
          return current
        })
        .finally(() => {
          inflight = null
        })
    }
    const session = await inflight
    res.json(publicSession(session))
  } catch (err) {
    next(err)
  }
})

/** Shut the virtual computer down. */
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
  try {
    await hyperbeam.deleteSession(sessionId)
  } catch (err) {
    // A session that already expired on Hyperbeam's side is not an error here.
    console.warn(`[hyperbeam] could not terminate ${sessionId}: ${err.message}`)
  }
}

// Single-page app: anything that is not an API route serves the OS shell.
app.get(/^\/(?!api\/|vendor\/).*/, (_req, res) => {
  res.sendFile(path.join(ROOT, "public/index.html"))
})

app.use((err, _req, res, _next) => {
  if (err instanceof HyperbeamError) {
    console.error(`[hyperbeam] ${err.message}`)
    return res.status(err.status).json({ error: err.message, details: err.body })
  }
  console.error(err)
  res.status(500).json({ error: "Internal server error" })
})

const server = app.listen(PORT, () => {
  console.log(`\n  Hyper iOS running at http://localhost:${PORT}\n`)
  if (configError) {
    console.warn(`  ⚠  ${configError}`)
    console.warn("     The OS boots, but Safari cannot start a virtual browser.\n")
  } else if (hyperbeam.isTestKey) {
    console.log("  ℹ  Using a test key — virtual browser minutes are limited.\n")
  }
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log("\nShutting down, terminating the virtual computer…")
    await terminate()
    server.close(() => process.exit(0))
  })
}
