/**
 * Usage metering: how many virtual-computer minutes each customer consumed.
 *
 * One JSON line per finished session, appended to a file. Plain text on
 * purpose: it survives restarts, can be read with any tool, and billing from
 * it needs no database. Lines are only written when a session ends, so a
 * session still running (or lost to a crash) shows up in `live`, not here.
 */

import fs from "node:fs"
import path from "node:path"

export class UsageLog {
  constructor(file) {
    this.file = file
    if (file) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
      } catch {
        /* the append below reports the real problem */
      }
    }
  }

  record({ customer, room, sessionId, startedAt, endedAt, reason }) {
    if (!this.file) return
    const minutes = Math.max(0, (endedAt - startedAt) / 60000)
    const line = JSON.stringify({
      customer: customer ?? "(sin cliente)",
      room,
      sessionId,
      startedAt,
      endedAt,
      minutes: Math.round(minutes * 100) / 100,
      reason,
    })
    try {
      fs.appendFileSync(this.file, `${line}\n`)
    } catch (err) {
      console.warn(`[uso] no se pudo registrar la sesión ${sessionId}: ${err.message}`)
    }
  }

  /** Totals per customer for sessions that ended at or after `since` (ms). */
  summary(since = 0) {
    const customers = new Map()
    let text = ""
    try {
      text = fs.readFileSync(this.file, "utf8")
    } catch {
      /* no sessions yet */
    }
    for (const line of text.split("\n")) {
      if (!line) continue
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (!(entry.endedAt >= since)) continue
      const total = customers.get(entry.customer) ?? { customer: entry.customer, sessions: 0, minutes: 0 }
      total.sessions += 1
      total.minutes = Math.round((total.minutes + entry.minutes) * 100) / 100
      customers.set(entry.customer, total)
    }
    return [...customers.values()].sort((a, b) => b.minutes - a.minutes)
  }
}
