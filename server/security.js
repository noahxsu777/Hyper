/**
 * Production hardening that needs no dependencies: response headers, a
 * fixed-window rate limiter for HTTP, and a token bucket for sockets.
 *
 * The limits exist for two reasons. One is abuse. The other is money: every
 * shared browser is a virtual computer billed by the minute, so anything that
 * lets a stranger open rooms or browsers in a loop is a way to spend the
 * operator's budget.
 */

/**
 * Headers every response carries.
 *
 * The Content-Security-Policy here is deliberately the safe subset: it stops
 * the app being framed, <base>/<object> tricks and cross-site form posts, none
 * of which the app uses. A full script-src/connect-src policy would also have
 * to list every Hyperbeam, YouTube, Twitch and GIPHY host the page talks to,
 * and getting that list wrong silently breaks the shared screen — so it is a
 * deploy-time decision, not a default.
 */
export function securityHeaders({ frameAncestors = "'none'" } = {}) {
  const csp = [
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ")

  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
    res.setHeader("Content-Security-Policy", csp)
    // Older browsers ignore frame-ancestors; this is its legacy twin.
    if (frameAncestors === "'none'") res.setHeader("X-Frame-Options", "DENY")
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000")
    next()
  }
}

/**
 * The address a request really came from. Behind a proxy (Fly, Render…) the
 * socket belongs to the proxy, so the last hop it appended is the client; with
 * no proxy that header is attacker-controlled and must not be believed.
 */
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const fly = req.headers["fly-client-ip"]
    if (typeof fly === "string" && fly) return fly.trim()
    const forwarded = req.headers["x-forwarded-for"]
    if (typeof forwarded === "string" && forwarded) return forwarded.split(",").pop().trim()
  }
  return req.socket?.remoteAddress ?? "unknown"
}

/**
 * Fixed-window limiter keyed by client address.
 * @param {{ windowMs: number, max: number, message: string, trustProxy?: boolean }} options
 */
export function rateLimit({ windowMs, max, message, trustProxy = false }) {
  const hits = new Map()
  const MAX_TRACKED = 50_000

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key)
  }, windowMs)
  sweep.unref?.()

  return (req, res, next) => {
    const now = Date.now()
    const key = clientIp(req, { trustProxy })
    let entry = hits.get(key)
    if (!entry || entry.reset <= now) {
      // Under a flood of distinct addresses the table must not become the leak.
      if (hits.size >= MAX_TRACKED) hits.clear()
      entry = { count: 0, reset: now + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1

    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.reset - now) / 1000))))
      return res.status(429).json({ error: message, code: "rate_limited" })
    }
    next()
  }
}

/**
 * Token bucket for one socket: `burst` messages at once, refilled at `perSecond`.
 * Mutates and returns whether this message may pass.
 */
export function takeToken(bucket, { burst, perSecond }, now = Date.now()) {
  if (bucket.at === undefined) {
    bucket.tokens = burst
    bucket.at = now
  }
  bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / 1000) * perSecond)
  bucket.at = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}
