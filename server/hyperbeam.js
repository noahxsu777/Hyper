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

  /*
   * Los relojes que apagan la máquina virtual. El importante es el de
   * inactividad: Hyperbeam lo cuenta desde la última vez que alguien tocó el
   * ratón o el teclado *dentro* del navegador compartido, y ver una película es
   * justo eso, no tocar nada. Con el valor por defecto la sesión se cerraba a
   * media película por "inactiva" mientras la sala entera la estaba mirando.
   *
   * Aquí va en 0, que lo desactiva: quien decide cuándo se acaba es la sala.
   */
  inactiveTimeout: 0,
  // Segundos sin nadie conectado antes de que Hyperbeam apague la máquina.
  // Dos horas: salir de la app a compartir el enlace, o que todos bloqueen el
  // móvil un rato, no debe costar la película. Si la API no acepta un valor
  // tan alto, createSession baja el listón en escalera en vez de rendirse.
  offlineTimeout: 7200,
  // Tope absoluto, por si una sala queda colgada sin que nadie la cierre.
  // Seis horas cubre cualquier película y evita que una máquina sangre minutos.
  absoluteTimeout: 6 * 60 * 60,
  // Cuánto antes del cierre avisa Hyperbeam, para que el aviso sirva de algo.
  warningTimeout: 60,
}

export class HyperbeamError extends Error {
  constructor(message, { status = 500, body = null } = {}) {
    super(message)
    this.name = "HyperbeamError"
    this.status = status
    this.body = body
  }
}

/**
 * A 4xx is Hyperbeam saying "not like that": worth retrying with a smaller
 * body. Anything else (network, 5xx) is not our body's fault, and swallowing it
 * would hide a real outage behind a confusing fallback.
 */
const isRejection = (err) =>
  err instanceof HyperbeamError && err.status >= 400 && err.status < 500

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
    this.inactiveTimeout = config.inactiveTimeout ?? DEFAULTS.inactiveTimeout
    this.absoluteTimeout = config.absoluteTimeout ?? DEFAULTS.absoluteTimeout
    this.warningTimeout = config.warningTimeout ?? DEFAULTS.warningTimeout
    // Left unset by default: `user_agent` is only sent when asked for, so an
    // unsupported value can never break a session nobody opted into.
    this.userAgent = config.userAgent || null

    // Lo que la API acabó aceptando. Null hasta que se abre la primera sesión:
    // no lo sabemos antes, y decir que sí sin haberlo pedido sería mentir.
    this.activeUserAgent = null
    this.timeoutsApplied = null
    this.activeOfflineTimeout = null
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
    const base = {
      start_url: startUrl || this.startUrl,
      width: width || this.width,
      height: height || this.height,
    }

    const block = (offline) => ({
      timeout: {
        absolute: this.absoluteTimeout,
        inactive: this.inactiveTimeout,
        offline,
        warning: this.warningTimeout,
      },
    })

    // Whether the API accepts two hours offline, or an hour, or the timeout
    // block at all, is not something this project can verify from here — so
    // the request walks down a ladder instead of guessing: the config we
    // want, then a conservative hour, then no block. Each rung records what
    // was actually applied; none of them pretends.
    const offline = this.offlineTimeout
    const clamped = Math.min(3600, offline)
    const attempts = [
      { body: { ...base, offline_timeout: offline, ...block(offline) }, applied: true, offline },
    ]
    if (clamped !== offline) {
      attempts.push({ body: { ...base, offline_timeout: clamped, ...block(clamped) }, applied: true, offline: clamped })
    }
    attempts.push({ body: { ...base, offline_timeout: clamped }, applied: false, offline: clamped })
    attempts.push({ body: base, applied: false, offline: null })

    let lastError = null
    for (const attempt of attempts) {
      try {
        const session = await this.#createWithUserAgent(attempt.body)
        this.timeoutsApplied = attempt.applied
        this.activeOfflineTimeout = attempt.offline
        if (!attempt.applied) {
          console.warn("[hyperbeam] La sesión abre sin el bloque timeout: puede cerrarse sola por inactividad.")
        } else if (attempt.offline !== offline) {
          console.warn(`[hyperbeam] offline_timeout rebajado a ${attempt.offline}s (la API rechazó ${offline}s).`)
        }
        return session
      } catch (err) {
        if (!isRejection(err)) throw err
        lastError = err
        console.warn(`[hyperbeam] configuración rechazada: ${err.message}; probando una más conservadora`)
      }
    }
    throw lastError
  }

  /**
   * Hyperbeam documents one preset, `chrome_android`. Whether it also takes a
   * raw UA string is not something this project can verify, so we try what was
   * asked for, then the preset that is known to exist, then the default. A
   * rejected user agent should cost a layout, never the film.
   */
  async #createWithUserAgent(body) {
    if (!this.userAgent) {
      const session = await this.#request("/vm", { method: "POST", body })
      this.activeUserAgent = null
      return session
    }

    const attempts = [this.userAgent]
    if (this.userAgent !== "chrome_android") attempts.push("chrome_android")

    for (const agent of attempts) {
      try {
        const session = await this.#request("/vm", {
          method: "POST",
          body: { ...body, user_agent: agent },
        })
        this.activeUserAgent = agent
        return session
      } catch (err) {
        if (!isRejection(err)) throw err
        console.warn(`[hyperbeam] user_agent "${agent}" rechazado: ${err.message}`)
      }
    }

    console.warn("[hyperbeam] Abriendo la sesión con el agente por defecto.")
    this.activeUserAgent = null
    return this.#request("/vm", { method: "POST", body })
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
