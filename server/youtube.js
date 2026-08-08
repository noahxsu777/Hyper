/**
 * YouTube search, proxied through us.
 *
 * It talks to InnerTube, the API youtube.com's own web player uses. The key
 * below is not a secret and not ours: it ships inside YouTube's public web
 * page for every visitor, quota-free. We keep the call server-side anyway so
 * the browser only ever talks to this app, and so a key change is one edit.
 *
 * It can break the day YouTube reshapes its private API — the search box
 * fails soft (the room shows the error and pasted links keep working).
 */

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/search"
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
const CLIENT = { clientName: "WEB", clientVersion: "2.20240101.00.00" }

export class YouTubeError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = "YouTubeError"
    this.status = status
  }
}

/** Walk InnerTube's deeply nested answer and keep only what a tile needs. */
function extractVideos(data) {
  const found = []
  const walk = (node) => {
    if (!node || typeof node !== "object" || found.length >= 20) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node.videoRenderer?.videoId) {
      const video = node.videoRenderer
      found.push({
        id: video.videoId,
        title: video.title?.runs?.[0]?.text ?? "",
        channel: video.ownerText?.runs?.[0]?.text ?? "",
        duration: video.lengthText?.simpleText ?? "",
        // The smallest thumbnail is plenty for a result tile.
        thumb: video.thumbnail?.thumbnails?.[0]?.url ?? `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
      })
      return
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(data)
  return found
}

export class YouTubeClient {
  constructor({ apiUrl = INNERTUBE_URL, apiKey = INNERTUBE_KEY } = {}) {
    this.apiUrl = apiUrl
    this.apiKey = apiKey
  }

  /** Search videos. Resolves to [{ id, title, channel, duration, thumb }]. */
  async search(query) {
    let res
    try {
      res = await fetch(`${this.apiUrl}?key=${this.apiKey}&prettyPrint=false`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { client: CLIENT },
          query: String(query).slice(0, 100),
          // "Videos only", so films and playlists do not clutter the grid.
          params: "EgIQAQ%3D%3D",
        }),
      })
    } catch (cause) {
      throw new YouTubeError(`No se pudo hablar con YouTube. (${cause.message})`)
    }
    if (!res.ok) throw new YouTubeError(`La búsqueda de YouTube respondió ${res.status}.`, res.status === 404 ? 502 : res.status)
    const data = await res.json().catch(() => null)
    const videos = extractVideos(data)
    if (!videos.length && !data) throw new YouTubeError("YouTube devolvió una respuesta que no se entiende.")
    return videos
  }
}
