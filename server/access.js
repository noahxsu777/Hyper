/**
 * Who may open the shared browser.
 *
 * Joining a room, chatting and playing the in-app games cost nothing. The one
 * thing that costs money is the virtual computer, so that is the only thing
 * gated: with ACCESS_CODES set, starting a shared browser needs a customer's
 * code, and the minutes it uses are attributed to that customer.
 *
 *   ACCESS_CODES="Acme Corp=7Hk2-93xQ-mWpL,Globex=Zr4t-81bN-cYvD"
 *
 * Unset, everything is open (development, or a single-tenant install).
 */

import { createHash, timingSafeEqual } from "node:crypto"

const digest = (value) => createHash("sha256").update(String(value)).digest()

export class AccessControl {
  /** @param {string|undefined} spec comma/newline separated `label=code` pairs */
  constructor(spec) {
    /** @type {{ label: string, hash: Buffer }[]} */
    this.entries = []
    this.weak = []

    for (const part of String(spec ?? "").split(/[,\n]/)) {
      const item = part.trim()
      if (!item) continue
      const at = item.indexOf("=")
      // Bare code with no label: the customer is named after its first chars.
      const label = at > 0 ? item.slice(0, at).trim() : `cliente-${this.entries.length + 1}`
      const code = at > 0 ? item.slice(at + 1).trim() : item
      if (!code) continue
      if (code.length < 8) this.weak.push(label)
      this.entries.push({ label, hash: digest(code) })
    }
  }

  get enabled() {
    return this.entries.length > 0
  }

  /** The customer a code belongs to, or null. Constant-time per entry. */
  check(code) {
    const supplied = String(code ?? "").trim()
    if (!supplied) return null
    const probe = digest(supplied)
    let found = null
    for (const entry of this.entries) {
      if (timingSafeEqual(probe, entry.hash)) found = entry.label
    }
    return found
  }
}

/** Compare an admin bearer token without leaking its length or prefix. */
export function sameToken(supplied, expected) {
  if (!expected || !supplied) return false
  return timingSafeEqual(digest(supplied), digest(expected))
}
