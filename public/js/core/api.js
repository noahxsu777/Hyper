/** Client for our own backend, which brokers the Hyperbeam REST API. */

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const error = new Error(data?.error || `${res.status} ${res.statusText}`)
    error.status = res.status
    error.details = data?.details ?? null
    throw error
  }
  return data
}

export const api = {
  /** Backend + key status, safe to show in Settings. */
  config: () => request("/api/config"),

  /** Join the shared virtual computer, starting it if needed. */
  createSession: (options = {}) => request("/api/session", { method: "POST", body: options }),

  /** The running session, or null when there is none. */
  async getSession() {
    try {
      return await request("/api/session")
    } catch (err) {
      if (err.status === 404) return null
      throw err
    }
  },

  /** Shut the virtual computer down so it stops consuming minutes. */
  endSession: () => request("/api/session", { method: "DELETE" }),
}

/**
 * Turn whatever the user typed into a URL: a bare domain becomes https://, and
 * anything else becomes a search.
 */
export function toUrl(input) {
  const value = String(input ?? "").trim()
  if (!value) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
  const looksLikeDomain = /^[^\s/]+\.[a-z]{2,}(\/.*)?$/i.test(value)
  if (looksLikeDomain) return `https://${value}`
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}

/** Short label for the address bar, the way Safari shows just the host. */
export function prettyHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url ?? ""
  }
}
