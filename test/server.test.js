import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { fakeHyperbeam, startServer, tab, until, sleep } from "./helpers.js"

describe("production defaults", () => {
  let server
  before(async () => {
    server = await startServer({ NODE_ENV: "production" })
  })
  after(() => server.stop())

  it("sends security headers on every response", async () => {
    const { headers } = await server.json("/")
    assert.equal(headers.get("x-content-type-options"), "nosniff")
    assert.equal(headers.get("x-frame-options"), "DENY")
    assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/)
    assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin")
    assert.equal(headers.get("x-powered-by"), null)
  })

  it("never tells a customer's guest how to fix the server", async () => {
    const { data } = await server.json("/api/config")
    assert.equal(data.configured, false)
    assert.doesNotMatch(JSON.stringify(data), /HYPERBEAM_API_KEY|\.env|fly secrets/)
    for (const operatorField of ["testKey", "userAgent", "startUrl", "inactiveTimeout"]) {
      assert.equal(operatorField in data, false, `${operatorField} must not be public`)
    }
  })

  it("answers /healthz for the host's health check", async () => {
    const { status, data } = await server.json("/healthz")
    assert.equal(status, 200)
    assert.equal(data.ok, true)
  })

  it("serves the app at / and at a room code, but 404s a missing file or API route", async () => {
    assert.equal((await server.json("/")).status, 200)
    const room = await server.json("/ABC123")
    assert.equal(room.status, 200)
    assert.match(room.text, /<div class="app"/)
    assert.equal((await server.json("/js/does-not-exist.js")).status, 404)
    const api = await server.json("/api/nope")
    assert.equal(api.status, 404)
    assert.equal(api.data.error, "No encontrado.")
  })

  it("rejects oversized and malformed request bodies", async () => {
    const big = await fetch(`${server.base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ junk: "x".repeat(40_000) }),
    })
    assert.equal(big.status, 413)
    const bad = await fetch(`${server.base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    assert.equal(bad.status, 400)
  })

  it("the usage panel does not exist without ADMIN_TOKEN", async () => {
    assert.equal((await server.json("/api/admin/usage")).status, 404)
  })

  it("rate-limits room creation per address", async () => {
    let limited = null
    for (let i = 0; i < 15 && !limited; i++) {
      const res = await server.json("/api/rooms", { method: "POST" })
      if (res.status === 429) limited = res
    }
    assert.ok(limited, "expected a 429 within 15 requests")
    assert.ok(Number(limited.headers.get("retry-after")) >= 1)
    assert.equal(limited.data.code, "rate_limited")
  })
})

describe("white label", () => {
  let server
  before(async () => {
    server = await startServer({
      BRAND_NAME: "Cine <b>Nova</b>",
      BRAND_SHORT_NAME: "Nova",
      BRAND_ACCENT: "#ff375f",
      BRAND_TAGLINE: "Tu cine privado.",
      BRAND_SUPPORT_URL: "https://example.com/ayuda",
      BRAND_TERMS_URL: "javascript:alert(1)",
    })
  })
  after(() => server.stop())

  it("puts the brand in the page, escaped", async () => {
    const { text } = await server.json("/")
    // Angle brackets are stripped from the name before it is ever escaped.
    assert.match(text, /<title>Cine {2}b Nova \/b<\/title>/)
    assert.doesNotMatch(text, /<b>/)
    assert.match(text, /--accent:#ff375f/)
    assert.match(text, /apple-mobile-web-app-title" content="Nova"/)
    assert.doesNotMatch(text, /%BRAND_/)
  })

  it("exposes the brand to the app, and refuses a script URL as a link", async () => {
    const { data } = await server.json("/api/config")
    assert.equal(data.brand.supportUrl, "https://example.com/ayuda")
    assert.equal(data.brand.termsUrl, null)
    assert.equal(data.brand.tagline, "Tu cine privado.")
  })

  it("serves a web manifest so it installs as an app", async () => {
    const { headers, data } = await server.json("/manifest.webmanifest")
    assert.match(headers.get("content-type"), /manifest\+json/)
    assert.equal(data.display, "standalone")
    assert.equal(data.short_name, "Nova")
    assert.ok(data.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"))
  })

  it("draws real PNG icons in the brand colour, and only the sizes it links to", async () => {
    for (const size of [32, 180, 192, 512]) {
      const res = await fetch(`${server.base}/icons/icon-${size}.png`)
      assert.equal(res.status, 200)
      const bytes = Buffer.from(await res.arrayBuffer())
      assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      assert.equal(bytes.readUInt32BE(16), size)
      assert.equal(bytes.readUInt32BE(20), size)
    }
    assert.equal((await fetch(`${server.base}/icons/icon-100.png`)).status, 404)
  })
})

describe("access codes, machine cap and usage", () => {
  let server
  let hb
  const CODE = "acme-1234-secret"
  const admin = { authorization: "Bearer 0123456789abcdef0123" }

  before(async () => {
    hb = await fakeHyperbeam()
    server = await startServer({
      NODE_ENV: "production",
      HYPERBEAM_API_KEY: "sk_test_fake",
      HYPERBEAM_API_URL: hb.url,
      ACCESS_CODES: `Acme=${CODE}`,
      ADMIN_TOKEN: "0123456789abcdef0123",
      MAX_SESSIONS: "1",
      RATE_LIMIT_MULTIPLIER: "10",
    })
  })
  after(async () => {
    await server.stop()
    await hb.close()
  })

  const join = async (name, clientId, code) => {
    const t = tab(server, code, clientId, name)
    await t.ready()
    return t
  }
  const newRoom = async () => (await server.json("/api/rooms", { method: "POST" })).data.code
  const start = (room, t, code) =>
    server.json(`/api/rooms/${room}/session`, {
      method: "POST",
      headers: { "x-room-token": t.token, ...(code ? { "x-access-code": code } : {}) },
      body: {},
    })

  it("announces that a code is needed", async () => {
    assert.equal((await server.json("/api/config")).data.accessRequired, true)
  })

  it("lets a guest in for free but not start a browser", async () => {
    const code = await newRoom()
    const host = await join("Ana", "ana-1", code)
    const guest = await join("Beto", "beto-1", code)
    const res = await start(code, guest, CODE)
    assert.equal(res.status, 403)
    assert.equal(hb.state.created, 0)
    host.close()
    guest.close()
  })

  it("refuses to start without a code, or with a wrong one, and spends nothing", async () => {
    const code = await newRoom()
    const host = await join("Ana", "ana-2", code)
    const none = await start(code, host)
    assert.equal(none.status, 401)
    assert.equal(none.data.code, "access_required")
    const wrong = await start(code, host, "not-the-code")
    assert.equal(wrong.status, 401)
    assert.equal(wrong.data.code, "access_invalid")
    assert.equal(hb.state.created, 0)
    host.close()
  })

  it("with the right code starts one computer, even if the button is hit three times at once", async () => {
    const code = await newRoom()
    const host = await join("Ana", "ana-3", code)
    const results = await Promise.all([start(code, host, CODE), start(code, host, CODE), start(code, host, CODE)])
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200])
    assert.equal(new Set(results.map((r) => r.data.sessionId)).size, 1)
    assert.equal(hb.state.created, 1)
    assert.equal(hb.alive.size, 1)

    // The room is now licensed: no code needed to join its browser again.
    assert.equal((await start(code, host)).status, 200)
    assert.equal(hb.state.created, 1)

    // The cap is 1: a second room cannot start a second computer.
    const other = await newRoom()
    const otherHost = await join("Carla", "carla-1", other)
    const capped = await start(other, otherHost, CODE)
    assert.equal(capped.status, 503)
    assert.equal(capped.data.code, "capacity")
    assert.equal(hb.alive.size, 1)

    // Closing the first frees the slot, and the minutes are billed to Acme.
    await sleep(60)
    const closed = await server.json(`/api/rooms/${code}/session`, { method: "DELETE", headers: { "x-room-token": host.token } })
    assert.equal(closed.data.terminated, true)
    assert.equal(hb.alive.size, 0)
    assert.equal((await start(other, otherHost, CODE)).status, 200)
    assert.equal(hb.alive.size, 1)

    // A licensed room restarts its own browser with no code at all.
    await server.json(`/api/rooms/${other}/session`, { method: "DELETE", headers: { "x-room-token": otherHost.token } })
    assert.equal((await start(other, otherHost)).status, 200)
    host.close()
    otherHost.close()
  })

  it("reports minutes per customer, and only to the admin", async () => {
    assert.equal((await server.json("/api/admin/usage")).status, 401)
    assert.equal((await server.json("/api/admin/usage", { headers: { authorization: "Bearer wrong-wrong-wrong-wrong" } })).status, 401)
    const { status, data } = await server.json("/api/admin/usage", { headers: admin })
    assert.equal(status, 200)
    const acme = data.customers.find((c) => c.customer === "Acme")
    assert.ok(acme, "Acme should have finished sessions")
    assert.ok(acme.sessions >= 2)
    assert.ok(data.live.some((s) => s.customer === "Acme"))
    assert.equal(data.sessions.max, 1)
  })

})

describe("provider problems", () => {
  it("shows a quota problem to guests as a plain sentence, not an upstream error", async () => {
    const hb = await fakeHyperbeam()
    const server = await startServer({ NODE_ENV: "production", HYPERBEAM_API_KEY: "sk_test_fake", HYPERBEAM_API_URL: hb.url })
    try {
      const { data: { code } } = await server.json("/api/rooms", { method: "POST" })
      const host = tab(server, code, "dani", "Dani")
      await host.ready()
      hb.state.failWith = { status: 402, message: "Monthly minutes quota exceeded for account acct_secret" }
      const res = await server.json(`/api/rooms/${code}/session`, { method: "POST", headers: { "x-room-token": host.token }, body: {} })
      assert.equal(res.status, 402)
      assert.doesNotMatch(JSON.stringify(res.data), /acct_secret|Hyperbeam API|quota/i)
      assert.match(res.data.error, /cupo/i)
      assert.equal(hb.alive.size, 0)
      assert.ok(server.log.includes("[ALERTA]"), "the operator must see the alarm in the log")

      // Once the provider recovers, the same room can start.
      hb.state.failWith = null
      const retry = await server.json(`/api/rooms/${code}/session`, { method: "POST", headers: { "x-room-token": host.token }, body: {} })
      assert.equal(retry.status, 200)
      host.close()
    } finally {
      await server.stop()
      await hb.close()
    }
  })
})

describe("shutting down", () => {
  it("empty rooms give their computer back on the idle clock, and SIGTERM gives back the rest", async () => {
    const hb = await fakeHyperbeam()
    const server = await startServer({
      HYPERBEAM_API_KEY: "sk_test_fake",
      HYPERBEAM_API_URL: hb.url,
      ROOM_IDLE_SESSION_MS: "700",
    })
    try {
      const { data: { code } } = await server.json("/api/rooms", { method: "POST" })
      const host = tab(server, code, "ana", "Ana")
      await host.ready()
      const started = await server.json(`/api/rooms/${code}/session`, { method: "POST", headers: { "x-room-token": host.token }, body: {} })
      assert.equal(started.status, 200)
      assert.equal(hb.alive.size, 1)

      host.close()
      await until(() => hb.alive.size === 0, "idle computer to be deleted", 4000)

      const again = tab(server, code, "ana", "Ana")
      await again.ready()
      const history = again.events.find((e) => e.type === "welcome").history
      assert.ok(
        history.some((m) => m.kind === "system" && /se apagó solo porque la sala se quedó vacía/.test(m.text)),
        "whoever comes back must be told why the browser is gone",
      )
      await server.json(`/api/rooms/${code}/session`, { method: "POST", headers: { "x-room-token": again.token }, body: {} })
      assert.equal(hb.alive.size, 1)
      await server.stop("SIGTERM")
      assert.equal(hb.alive.size, 0, "SIGTERM must delete every running computer")
    } finally {
      await server.stop().catch(() => {})
      await hb.close()
    }
  })
})

describe("the host's shutdown setting, over the wire", () => {
  it("starts at the default, follows the owner, ignores guests and anything above the ceiling", async () => {
    const server = await startServer({ ROOM_IDLE_SESSION_MS: "120000", ROOM_IDLE_SESSION_MAX_MS: "600000" })
    try {
      const { data: { code } } = await server.json("/api/rooms", { method: "POST" })
      const host = tab(server, code, "ana", "Ana")
      await host.ready()
      const guest = tab(server, code, "beto", "Beto")
      await guest.ready()

      const welcome = host.events.find((e) => e.type === "welcome")
      assert.equal(welcome.autoOffMin, 2)
      assert.deepEqual(welcome.autoOffOptions, [1, 2, 5, 10], "options stop at the operator's 10 minute ceiling")

      guest.send({ type: "autooff", minutes: 5 })
      host.send({ type: "autooff", minutes: 30 })
      await sleep(150)
      const latest = () => host.events.filter((e) => e.type === "presence").at(-1)?.autoOffMin
      assert.equal(latest() ?? 2, 2)

      host.send({ type: "autooff", minutes: 5 })
      await until(() => latest() === 5, "presence to carry the new delay")
      guest.close()
      host.close()
    } finally {
      await server.stop()
    }
  })
})

describe("steering the shared browser", () => {
  const start = (server, code, t) =>
    server.json(`/api/rooms/${code}/session`, { method: "POST", headers: { "x-room-token": t.token }, body: {} })
  const control = (server, code, t) =>
    server.json(`/api/rooms/${code}/session/control`, { headers: { "x-room-token": t.token } })

  it("hands the admin token to the host and to moderators, and to nobody else", async () => {
    const hb = await fakeHyperbeam()
    const server = await startServer({ HYPERBEAM_API_KEY: "sk_test_fake", HYPERBEAM_API_URL: hb.url })
    try {
      const { data: { code } } = await server.json("/api/rooms", { method: "POST" })
      const host = tab(server, code, "ana", "Ana")
      await host.ready()
      const guest = tab(server, code, "beto", "Beto")
      await guest.ready()

      assert.equal((await control(server, code, host)).status, 404, "no session yet")
      await start(server, code, host)

      const mine = await control(server, code, host)
      assert.equal(mine.status, 200)
      assert.equal(mine.data.adminToken, "adm-sess_1")
      assert.equal(mine.data.priority, 2)
      assert.equal(mine.headers.get("cache-control"), "no-store")

      assert.equal((await control(server, code, guest)).status, 403)

      // Crowning someone hands them the wheel too, one step below the host.
      const guestId = host.viewers.find((v) => v.name === "Beto").id
      host.send({ type: "role", targetId: guestId, role: "moderator" })
      await until(() => guest.role === "moderator", "Beto to be crowned")
      const theirs = await control(server, code, guest)
      assert.equal(theirs.status, 200)
      assert.equal(theirs.data.priority, 1)

      // The token travels only through that route: never in a broadcast.
      const everything = JSON.stringify([...host.events, ...guest.events])
      assert.doesNotMatch(everything, /adm-sess/)
      assert.equal((await server.json(`/api/rooms/${code}/session`)).data.controlLocked, false)

      // A host who refreshes is the same person, and gets the same token back.
      host.close()
      await sleep(100)
      const refreshed = tab(server, code, "ana", "Ana")
      await refreshed.ready()
      const again = await control(server, code, refreshed)
      assert.equal(again.data.adminToken, "adm-sess_1")
      assert.equal(again.data.priority, 2)
      refreshed.close()
      guest.close()
    } finally {
      await server.stop()
      await hb.close()
    }
  })

  it("strict control asks Hyperbeam for locked sessions, and tells the host it is on", async () => {
    const hb = await fakeHyperbeam()
    const server = await startServer({ HYPERBEAM_API_KEY: "sk_test_fake", HYPERBEAM_API_URL: hb.url, HB_LOCK_CONTROL: "true" })
    try {
      const { data: { code } } = await server.json("/api/rooms", { method: "POST" })
      const host = tab(server, code, "ana", "Ana")
      await host.ready()
      const started = await start(server, code, host)
      assert.equal(started.data.controlLocked, true)
      assert.equal(hb.state.bodies[0].control_disable_default, true)
      assert.equal((await control(server, code, host)).data.controlLocked, true)
      host.close()
    } finally {
      await server.stop()
      await hb.close()
    }
  })

  it("if the API refuses strict control, the session still opens and strict mode steps aside for good", async () => {
    const hb = await fakeHyperbeam()
    hb.state.rejectKeys = ["control_disable_default"]
    const server = await startServer({ HYPERBEAM_API_KEY: "sk_test_fake", HYPERBEAM_API_URL: hb.url, HB_LOCK_CONTROL: "true" })
    try {
      const { data: { code } } = await server.json("/api/rooms", { method: "POST" })
      const host = tab(server, code, "ana", "Ana")
      await host.ready()
      const first = await start(server, code, host)
      assert.equal(first.status, 200, "a refused flag must not cost the film")
      assert.equal(first.data.controlLocked, false)
      assert.match(server.log, /rechaz[óo] control_disable_default/)
      const attemptsForFirst = hb.state.bodies.length

      // The next session does not even try the flag again.
      await server.json(`/api/rooms/${code}/session`, { method: "DELETE", headers: { "x-room-token": host.token } })
      const bodiesBefore = hb.state.bodies.length
      await start(server, code, host)
      assert.ok(hb.state.bodies.slice(bodiesBefore).every((body) => !("control_disable_default" in body)))
      assert.ok(attemptsForFirst > 1)
      host.close()
    } finally {
      await server.stop()
      await hb.close()
    }
  })

  it("a bad key is not mistaken for a bad flag", async () => {
    const hb = await fakeHyperbeam()
    hb.state.failWith = { status: 401, message: "invalid key" }
    const server = await startServer({ HYPERBEAM_API_KEY: "sk_test_fake", HYPERBEAM_API_URL: hb.url, HB_LOCK_CONTROL: "true" })
    try {
      const { data: { code } } = await server.json("/api/rooms", { method: "POST" })
      const host = tab(server, code, "ana", "Ana")
      await host.ready()
      const res = await start(server, code, host)
      assert.equal(res.status, 401)
      // Strict mode stays armed: the failure said nothing about the flag.
      hb.state.failWith = null
      assert.equal((await start(server, code, host)).data.controlLocked, true)
      host.close()
    } finally {
      await server.stop()
      await hb.close()
    }
  })
})
