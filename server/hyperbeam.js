/**
 * Thin wrapper around the Hyperbeam REST API.
 *
 * The API key is a server-side secret: it can start virtual computers that cost
 * money, so it never leaves this process. The browser only ever receives the
 * `embed_url`, which is a capability URL scoped to a single session.
 *
 * Docs: https://docs.hyperbeam.com/rest-api
 */

const DEFAULTS = {
  apiUrl: "https://engine.hyperbeam.com/v0",
  width: 1280,
  height: 720,
  startUrl: "https://www.google.com",
  offlineTimeout: 60,
}

export class HyperbeamError extends Error {
  constructor(message, { status = 500, body = null } = {}) {
    super(message)
    this.name = "HyperbeamError"
    this.status = status
    this.body = body
  }
}

export class HyperbeamClient {
  constructor(config = {}) {
    const apiKey = config.apiKey || ""
    if (!apiKey) {
      // How to fix this depends on where the server is running, so the caller
      // appends the instruction that actually applies.
      throw new HyperbeamError("Falta la clave HYPERBEAM_API_KEY.", { status: 500 })
    }
    this.apiKey = apiKey
    this.apiUrl = (config.apiUrl || DEFAULTS.apiUrl).replace(/\/+$/, "")
    this.width = config.width || DEFAULTS.width
    this.height = config.height || DEFAULTS.height
    this.startUrl = config.startUrl || DEFAULTS.startUrl
    this.offlineTimeout = config.offlineTimeout ?? DEFAULTS.offlineTimeout
  }

  /** True when the configured key is a test key (limited minutes). */
  get isTestKey() {
    return this.apiKey.startsWith("sk_test_")
  }

  async #request(path, { method = "GET", body } = {}) {
    let res
    try {
      res = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (cause) {
      throw new HyperbeamError(
        `Could not reach the Hyperbeam API at ${this.apiUrl}. Check your network or proxy. (${cause.message})`,
        { status: 502 },
      )
    }

    const text = await res.text()
    let parsed = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { raw: text }
      }
    }

    if (!res.ok) {
      const detail = parsed?.error || parsed?.message || parsed?.raw || res.statusText
      throw new HyperbeamError(`Hyperbeam API ${res.status}: ${detail}`, {
        status: res.status,
        body: parsed,
      })
    }
    return parsed
  }

  /**
   * Start a virtual computer.
   * Resolves to `{ session_id, embed_url, admin_token }`.
   */
  async createSession({ startUrl, width, height } = {}) {
    return this.#request("/vm", {
      method: "POST",
      body: {
        start_url: startUrl || this.startUrl,
        width: width || this.width,
        height: height || this.height,
        offline_timeout: this.offlineTimeout,
      },
    })
  }

  /** Fetch the current state of a session. */
  async getSession(sessionId) {
    return this.#request(`/vm/${encodeURIComponent(sessionId)}`)
  }

  /** Terminate a session so it stops consuming minutes. */
  async deleteSession(sessionId) {
    return this.#request(`/vm/${encodeURIComponent(sessionId)}`, { method: "DELETE" })
  }
}

export { DEFAULTS }
