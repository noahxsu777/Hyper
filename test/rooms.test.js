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

describe("automatic shutdown of an empty room", () => {
  it("defaults to two minutes, and only the owner can change it, within the operator's ceiling", () => {
    const hub = hubWith()
    const room = hub.createRoom("AUTOF1")
    room.join(fakeSocket(), { name: "Ana", clientId: "ana" })
    room.join(fakeSocket(), { name: "Beto", clientId: "beto" })
    assert.equal(room.state().autoOffMin, 2)

    room.setAutoOff("beto", 10)
    assert.equal(room.state().autoOffMin, 2, "a guest cannot change it")
    room.setAutoOff("ana", 10)
    assert.equal(room.state().autoOffMin, 10)
    room.setAutoOff("ana", 60)
    assert.equal(room.state().autoOffMin, 10, "an hour is above the 30 minute ceiling")
    room.setAutoOff("ana", 3)
    assert.equal(room.state().autoOffMin, 10, "only offered values are accepted")
    assert.deepEqual(room.autoOffOptions(), [1, 2, 5, 10, 15, 30])
    hub.close()
  })

  it("the room's own setting is the delay its timer waits", () => {
    const realSetTimeout = globalThis.setTimeout
    const delays = []
    globalThis.setTimeout = (fn, delay, ...rest) => {
      delays.push(delay)
      return realSetTimeout(fn, delay, ...rest)
    }
    const hub = hubWith()
    try {
      const room = hub.createRoom("AUTOF2")
      const ana = fakeSocket()
      room.join(ana, { name: "Ana", clientId: "ana" })
      room.setAutoOff("ana", 5)
      room.leave(ana)
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    assert.ok(delays.includes(5 * 60 * 1000), `expected a 5 minute timer among ${delays}`)
    assert.ok(!delays.includes(2 * 60 * 1000))
    hub.close()
  })

  it("survives a restart, but a hand-edited state file cannot lift the ceiling", () => {
    const hub = hubWith({ maxIdleSessionMs: 10 * 60 * 1000 })
    hub.restore([
      { code: "AUTOF3", autoOffMs: 5 * 60 * 1000 },
      { code: "AUTOF4", autoOffMs: 6 * 60 * 60 * 1000 },
    ])
    const byCode = Object.fromEntries(hub.rooms().map((room) => [room.code, room]))
    assert.equal(byCode.AUTOF3.autoOffMs, 5 * 60 * 1000)
    assert.equal(byCode.AUTOF4.autoOffMs, 2 * 60 * 1000)
    assert.equal(hub.serialize().find((entry) => entry.code === "AUTOF3").autoOffMs, 5 * 60 * 1000)
    hub.close()
  })

  it("tells the people who come back why the browser is gone", () => {
    const hub = hubWith()
    const room = hub.createRoom("AUTOF5")
    room.session = { session_id: "sess_1" }
    room.clearSession("idle")
    const last = room.history.at(-1)
    assert.equal(last.kind, "system")
    assert.match(last.text, /se apagó solo porque la sala se quedó vacía/)
    hub.close()
  })
})

describe("reactions over the screen", () => {
  it("broadcasts only known stickers, and not faster than a person can tap", () => {
    const hub = hubWith()
    const room = hub.createRoom("BURST1")
    const ana = fakeSocket()
    const beto = fakeSocket()
    room.join(ana, { name: "Ana", clientId: "ana" })
    room.join(beto, { name: "Beto", clientId: "beto" })

    room.handle(ana, { type: "burst", id: "popcorn" })
    const seen = beto.sent.filter((m) => m.type === "burst")
    assert.equal(seen.length, 1)
    assert.equal(seen[0].char, "🍿")

    room.handle(ana, { type: "burst", id: "not-a-sticker" })
    room.handle(ana, { type: "burst", id: "<script>" })
    assert.equal(beto.sent.filter((m) => m.type === "burst").length, 1)

    for (let i = 0; i < 100; i++) room.handle(ana, { type: "burst", id: "fire" })
    const total = beto.sent.filter((m) => m.type === "burst").length
    assert.ok(total <= 12, `a flood must be cut to the burst allowance, got ${total}`)
    hub.close()
  })
})

describe("polls", () => {
  const setup = () => {
    const hub = hubWith()
    const room = hub.createRoom("POLL01")
    const sockets = { ana: fakeSocket(), beto: fakeSocket(), carla: fakeSocket() }
    room.join(sockets.ana, { name: "Ana", clientId: "ana" })
    room.join(sockets.beto, { name: "Beto", clientId: "beto" })
    room.join(sockets.carla, { name: "Carla", clientId: "carla" })
    const lastPoll = (who) => sockets[who].sent.filter((m) => m.type === "poll").at(-1)?.poll
    return { hub, room, sockets, lastPoll }
  }

  it("only the people running the room can open one, and it needs a question and two real options", () => {
    const { hub, room, sockets, lastPoll } = setup()
    room.handle(sockets.beto, { type: "poll-open", question: "¿Qué vemos?", options: ["Dune", "Alien"] })
    assert.equal(lastPoll("ana"), undefined)
    assert.match(sockets.beto.sent.at(-1).reason, /Solo quien lleva la sala/)

    room.handle(sockets.ana, { type: "poll-open", question: "", options: ["Dune", "Alien"] })
    room.handle(sockets.ana, { type: "poll-open", question: "¿Qué vemos?", options: ["Dune", "dune", "  ", ""] })
    assert.equal(lastPoll("ana"), undefined, "duplicates and blanks do not count as options")

    room.handle(sockets.ana, { type: "poll-open", question: "¿Qué vemos?", options: ["Dune", "Alien", "Dune", ...Array(10).fill(0).map((_, i) => `Peli ${i}`)] })
    const poll = lastPoll("ana")
    assert.equal(poll.question, "¿Qué vemos?")
    assert.equal(poll.options.length, 6, "capped at six options")
    assert.deepEqual(poll.options.slice(0, 2).map((o) => o.text), ["Dune", "Alien"])
    hub.close()
  })

  it("counts one vote per person, lets them change it, and shows each person their own pick", () => {
    const { hub, room, sockets, lastPoll } = setup()
    room.handle(sockets.ana, { type: "poll-open", question: "¿Qué vemos?", options: ["Dune", "Alien"] })
    const [dune, alien] = lastPoll("ana").options

    room.handle(sockets.beto, { type: "poll-vote", optionId: dune.id })
    room.handle(sockets.carla, { type: "poll-vote", optionId: dune.id })
    room.handle(sockets.beto, { type: "poll-vote", optionId: alien.id })
    room.handle(sockets.carla, { type: "poll-vote", optionId: "o99" })

    assert.deepEqual(lastPoll("ana").options.map((o) => o.votes), [1, 1])
    assert.equal(lastPoll("ana").total, 2)
    assert.equal(lastPoll("beto").mine, alien.id)
    assert.equal(lastPoll("carla").mine, dune.id)
    assert.equal(lastPoll("ana").mine, null)
    hub.close()
  })

  it("closing announces the winner and stops further votes; a late joiner sees the live poll", () => {
    const { hub, room, sockets, lastPoll } = setup()
    room.handle(sockets.ana, { type: "poll-open", question: "¿Qué vemos?", options: ["Dune", "Alien"] })
    const [dune, alien] = lastPoll("ana").options
    room.handle(sockets.beto, { type: "poll-vote", optionId: alien.id })
    room.handle(sockets.carla, { type: "poll-vote", optionId: alien.id })

    const late = fakeSocket()
    room.join(late, { name: "Dani", clientId: "dani" })
    assert.equal(late.sent.find((m) => m.type === "welcome").poll.total, 2)

    room.handle(sockets.beto, { type: "poll-close" })
    assert.equal(lastPoll("ana").open, true, "a guest cannot close it")
    room.handle(sockets.ana, { type: "poll-close" })
    assert.equal(lastPoll("ana").open, false)
    assert.match(room.history.at(-1).text, /gana «Alien» con 2 votos/)

    room.handle(sockets.ana, { type: "poll-vote", optionId: dune.id })
    assert.equal(lastPoll("ana").total, 2, "closed polls take no votes")

    room.handle(sockets.ana, { type: "poll-clear" })
    assert.equal(lastPoll("ana"), null)
    hub.close()
  })

  it("reports ties and empty polls honestly", () => {
    const { hub, room, sockets, lastPoll } = setup()
    room.handle(sockets.ana, { type: "poll-open", question: "¿Y ahora?", options: ["A", "B"] })
    room.handle(sockets.ana, { type: "poll-close" })
    assert.match(room.history.at(-1).text, /nadie votó/)

    room.handle(sockets.ana, { type: "poll-open", question: "¿Y ahora?", options: ["A", "B"] })
    const [a, b] = lastPoll("ana").options
    room.handle(sockets.beto, { type: "poll-vote", optionId: a.id })
    room.handle(sockets.carla, { type: "poll-vote", optionId: b.id })
    room.handle(sockets.ana, { type: "poll-close" })
    assert.match(room.history.at(-1).text, /empate entre «A» y «B»/)
    hub.close()
  })
})
