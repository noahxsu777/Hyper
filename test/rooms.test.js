import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { createRoomHub } from "../server/rooms.js"
import { sleep } from "./helpers.js"

function fakeSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    send(payload) {
      this.sent.push(JSON.parse(payload))
    },
    close() {
      this.readyState = 3
    },
  }
}

const hubWith = (options = {}) => createRoomHub(http.createServer(), options)

describe("who runs the room", () => {
  let hub
  before(() => {
    hub = hubWith({ ownerGraceMs: 40 })
  })
  after(() => hub.close())

  it("the first person in is the owner", () => {
    const room = hub.createRoom("OWNER1")
    room.join(fakeSocket(), { name: "Ana", clientId: "ana" })
    assert.equal(room.roleOf("ana"), "owner")
    assert.equal(room.creatorClientId, "ana")
  })

  it("keeps the creator as owner across a refresh", () => {
    const room = hub.createRoom("OWNER2")
    const first = fakeSocket()
    room.join(first, { name: "Ana", clientId: "ana" })
    room.leave(first)
    room.join(fakeSocket(), { name: "Ana", clientId: "ana" })
    assert.equal(room.roleOf("ana"), "owner")
  })

  it("hands the room to a stand-in, then gives it back to the creator whenever they return", async () => {
    const room = hub.createRoom("OWNER3")
    const ana = fakeSocket()
    room.join(ana, { name: "Ana", clientId: "ana" })
    room.join(fakeSocket(), { name: "Beto", clientId: "beto" })

    room.leave(ana)
    await sleep(120)
    assert.equal(room.roleOf("beto"), "owner")

    room.join(fakeSocket(), { name: "Ana", clientId: "ana" })
    assert.equal(room.roleOf("ana"), "owner")
    assert.equal(room.roleOf("beto"), "guest")
  })

  it("a lock keeps strangers out but never the creator", async () => {
    const room = hub.createRoom("OWNER4")
    const ana = fakeSocket()
    room.join(ana, { name: "Ana", clientId: "ana" })
    room.join(fakeSocket(), { name: "Beto", clientId: "beto" })
    room.leave(ana)
    await sleep(120)
    room.setLocked("beto", true)

    assert.equal(room.join(fakeSocket(), { name: "Eve", clientId: "eve" }).ok, false)
    assert.equal(room.join(fakeSocket(), { name: "Ana", clientId: "ana" }).ok, true)
  })
})

describe("limits", () => {
  it("turns people away from a full room, but not its creator", () => {
    const hub = hubWith({ maxViewersPerRoom: 2 })
    const room = hub.createRoom("LIMIT1")
    room.join(fakeSocket(), { name: "Ana", clientId: "ana" })
    room.join(fakeSocket(), { name: "Beto", clientId: "beto" })
    const refused = room.join(fakeSocket(), { name: "Carla", clientId: "carla" })
    assert.equal(refused.ok, false)
    assert.match(refused.reason, /llena/)
    hub.close()
  })

  it("slows down someone flooding the chat and tells them once", () => {
    const hub = hubWith()
    const room = hub.createRoom("LIMIT2")
    const socket = fakeSocket()
    room.join(socket, { name: "Ana", clientId: "ana" })
    for (let i = 0; i < 40; i++) room.handle(socket, { type: "chat", text: `hola ${i}` })

    const posted = room.history.filter((entry) => entry.kind === "chat").length
    assert.ok(posted >= 5 && posted <= 7, `expected a burst of about 5, got ${posted}`)
    const warnings = socket.sent.filter((m) => m.type === "app-denied")
    assert.equal(warnings.length, 1)
    hub.close()
  })
})

describe("restarts", () => {
  it("a restored empty room shuts its computer down on the clock it already had", () => {
    const realSetTimeout = globalThis.setTimeout
    const delays = []
    globalThis.setTimeout = (fn, delay, ...rest) => {
      delays.push(delay)
      return realSetTimeout(fn, delay, ...rest)
    }
    const hour = 60 * 60 * 1000
    const hub = hubWith({ emptyTtlMs: 24 * hour, idleSessionMs: 2 * hour })
    try {
      hub.restore([
        {
          code: "RESTOR",
          ownerClientId: "ana",
          creatorClientId: "ana",
          customer: "Acme",
          session: { session_id: "sess_1", created_at: Date.now() - 2 * hour },
          emptySince: Date.now() - hour,
        },
      ])
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    const idle = delays[1]
    assert.ok(Math.abs(idle - hour) < 5000, `idle timer should have about an hour left, got ${Math.round(idle / 60000)} min`)
    assert.equal(hub.rooms()[0].customer, "Acme")
    assert.equal(hub.serialize()[0].customer, "Acme")
    hub.close()
  })

  it("old state files without a creator fall back to the last owner", () => {
    const hub = hubWith()
    hub.restore([{ code: "OLDONE", ownerClientId: "ana" }])
    assert.equal(hub.rooms()[0].creatorClientId, "ana")
    hub.close()
  })
})
