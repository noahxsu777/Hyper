/**
 * GIPHY, proxied.
 *
 * The key stays on this side so it is not sitting in everyone's page source,
 * and the browser only ever sees a trimmed list of GIFs: id, a URL, and the
 * size needed to lay them out without the grid jumping around.
 */

const API = "https://api.giphy.com/v1/gifs"
const LIMIT = 24

export class GiphyError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = "GiphyError"
    this.status = status
  }
}

/** Only these hosts may end up in a room's chat. */
export function isGiphyUrl(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === "https:" && /(^|\.)giphy\.com$/.test(url.hostname)
  } catch {
    return false
  }
}

/** Keep the smallest rendition that still looks right in a chat column. */
function trim(gif) {
  const image = gif.images?.fixed_width ?? gif.images?.downsized ?? gif.images?.original
  if (!image?.url) return null
  return {
    id: gif.id,
    url: image.url,
    width: Number(image.width) || 200,
    height: Number(image.height) || 200,
    title: gif.title || "GIF",
  }
}

export class GiphyClient {
  constructor(apiKey) {
    this.apiKey = apiKey || ""
  }

  get configured() {
    return Boolean(this.apiKey)
  }

  async #request(path, params) {
    if (!this.configured) {
      throw new GiphyError("Falta GIPHY_API_KEY en el servidor.", 500)
    }
    const query = new URLSearchParams({
      api_key: this.apiKey,
      limit: String(LIMIT),
      rating: "pg-13",
      lang: "es",
      ...params,
    })

    let res
    try {
      res = await fetch(`${API}${path}?${query}`)
    } catch (cause) {
      throw new GiphyError(`No se pudo hablar con GIPHY: ${cause.message}`)
    }
    if (!res.ok) throw new GiphyError(`GIPHY respondió ${res.status}`, res.status)

    const body = await res.json()
    return (body.data ?? []).map(trim).filter(Boolean)
  }

  trending(offset = 0) {
    return this.#request("/trending", { offset: String(offset) })
  }

  search(query, offset = 0) {
    return this.#request("/search", { q: query, offset: String(offset) })
  }
}
