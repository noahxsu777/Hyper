// Shared test plumbing: a fake Hyperbeam API that counts live virtual
// computers (that count is the bill), a real server process, and browser-like
// WebSocket "tabs".

import http from "node:http"
import net from "node:net"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { WebSocket } from "ws"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", reject)
    probe.listen(0, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** Wait until `check()` is truthy, or fail with `message` after `timeout` ms. */
export async function until(check, message, timeout = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return
    await sleep(25)
  }
  throw new Error(`Timed out waiting for: ${message}`)
}

/** Hyperbeam stand-in. `alive` is the set of virtual computers still billing. */
export async function fakeHyperbeam() {
  const alive = new Set()
  const state = { created: 0, failWith: null }
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    if (req.method === "POST" && req.url === "/v0/vm") {
      if (state.failWith) {
        res.statusCode = state.failWith.status
        return res.end(JSON.stringify({ error: state.failWith.message }))
      }
      const id = `sess_${++state.created}`
      alive.add(id)
      return res.end(JSON.stringify({ session_id: id, embed_url: `https://fake.invalid/${id}`, admin_token: "x" }))
    }
    const match = req.url.match(/^\/v0\/vm\/([^/]+)$/)
    if (match && req.method === "DELETE") {
      alive.delete(match[1])
      return res.end("{}")
    }
    res.statusCode = 404
    res.end("{}")
  })
  await new Promise((resolve) => server.listen(0, resolve))
  return {
    alive,
    state,
    url: `http://localhost:${server.address().port}/v0`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** Start server/index.js as a child process on a free port. */
export async function startServer(env = {}) {
  const port = await freePort()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "party-test-"))
  const child = spawn("node", ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      ROOM_STATE_FILE: path.join(dir, "rooms-state.json"),
      USAGE_FILE: path.join(dir, "usage.jsonl"),
      HYPERBEAM_API_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const server = { port, base: `http://localhost:${port}`, dir, child, log: "" }
  child.stdout.on("data", (d) => (server.log += d))
  child.stderr.on("data", (d) => (server.log += d))
  server.exited = new Promise((resolve) => child.once("exit", resolve))
  await until(
    async () => {
      try {
        return (await fetch(`${server.base}/healthz`)).ok
      } catch {
        return false
      }
    },
    `server on port ${port} to answer\n${server.log}`,
    8000,
  )
  server.stop = async (signal = "SIGKILL") => {
    if (child.exitCode === null) child.kill(signal)
    await server.exited
    fs.rmSync(dir, { recursive: true, force: true })
  }
  server.json = async (url, { method = "GET", headers = {}, body } = {}) => {
    const res = await fetch(`${server.base}${url}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, data, text }
  }
  return server
}

/** A browser tab: one socket that remembers what the server told it. */
export function tab(server, code, clientId, name) {
  const t = { role: null, token: null, events: [], viewers: [], denied: null, closed: false }
  t.ws = new WebSocket(`ws://localhost:${server.port}/ws`)
  t.ws.on("open", () => t.ws.send(JSON.stringify({ type: "join", code, name, clientId })))
  t.ws.on("message", (raw) => {
    const event = JSON.parse(String(raw))
    t.events.push(event)
    if (event.type === "welcome" || event.type === "role") {
      t.role = event.role
      t.token = event.token
    }
    if (event.type === "presence" || event.type === "welcome") t.viewers = event.viewers
    if (event.type === "denied") t.denied = event.reason
    if (event.type === "app-denied") t.appDenied = event.reason
  })
  t.ws.on("close", () => (t.closed = true))
  t.send = (payload) => t.ws.send(JSON.stringify(payload))
  t.close = () => t.ws.close()
  t.ready = () => until(() => t.role || t.denied, `tab ${name} to be welcomed or denied`)
  return t
}
