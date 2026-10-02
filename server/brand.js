/**
 * White-label branding.
 *
 * Everything a customer would want to change to make this look like their own
 * product comes from environment variables: name, tagline, accent colour and
 * links. The app icons are drawn here from that accent colour, so a rebrand is
 * a config change and not a design job.
 */

import { deflateSync } from "node:zlib"

const HEX = /^#[0-9a-f]{6}$/i
const DEFAULT_ACCENT = "#7c5cff"

const clean = (value, limit) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .trim()
    .slice(0, limit)

/** Only absolute http(s) URLs: these end up in href attributes. */
function safeUrl(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch {
    return null
  }
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`
const mix = (rgb, target, amount) => rgb.map((v, i) => v + (target[i] - v) * amount)

/**
 * @param {Record<string, string|undefined>} env
 */
export function loadBrand(env = process.env) {
  const accent = HEX.test(env.BRAND_ACCENT ?? "") ? env.BRAND_ACCENT.toLowerCase() : DEFAULT_ACCENT
  const rgb = hexToRgb(accent)
  const name = clean(env.BRAND_NAME, 40) || "Watch Party"

  return {
    name,
    shortName: clean(env.BRAND_SHORT_NAME, 14) || name.slice(0, 14),
    tagline:
      clean(env.BRAND_TAGLINE, 180) ||
      "Un solo navegador para toda la sala. Pon una película y la veis a la vez, en la misma pantalla y al mismo segundo.",
    accent,
    accentSoft: toHex(mix(rgb, [255, 255, 255], 0.35)),
    accentDeep: toHex(mix(rgb, [0, 0, 0], 0.28)),
    accentRgb: rgb.join(", "),
    logoUrl: safeUrl(env.BRAND_LOGO_URL),
    supportUrl: safeUrl(env.BRAND_SUPPORT_URL),
    termsUrl: safeUrl(env.BRAND_TERMS_URL),
    privacyUrl: safeUrl(env.BRAND_PRIVACY_URL),
  }
}

/** What the browser is allowed to know about the brand. */
export const publicBrand = (brand) => ({
  name: brand.name,
  shortName: brand.shortName,
  tagline: brand.tagline,
  logoUrl: brand.logoUrl,
  supportUrl: brand.supportUrl,
  termsUrl: brand.termsUrl,
  privacyUrl: brand.privacyUrl,
})

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

/** Fill the placeholders in public/index.html. */
export function renderIndex(template, brand) {
  const style = `:root{--accent:${brand.accent};--accent-soft:${brand.accentSoft};--accent-deep:${brand.accentDeep};--accent-rgb:${brand.accentRgb}}`
  const values = {
    BRAND_NAME: escapeHtml(brand.name),
    BRAND_SHORT: escapeHtml(brand.shortName),
    BRAND_DESCRIPTION: escapeHtml(brand.tagline),
    BRAND_THEME: brand.accent,
    BRAND_STYLE: style,
  }
  return template.replace(/%(BRAND_[A-Z_]+)%/g, (_, key) => values[key] ?? "")
}

export function manifest(brand) {
  return {
    name: brand.name,
    short_name: brand.shortName,
    description: brand.tagline,
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}

/* ------------------------------------------------------------------ icons */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, "ascii")
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** Is (x, y) inside the triangle abc? */
function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

const iconCache = new Map()

/**
 * A square, fully opaque PNG: an accent gradient with a white play triangle.
 * Opaque and unrounded on purpose — iOS rounds the corners itself and paints
 * transparency black, and Android's maskable icons want a full-bleed square.
 */
export function renderIcon(size, brand) {
  const key = `${size}:${brand.accent}`
  if (iconCache.has(key)) return iconCache.get(key)

  const top = hexToRgb(brand.accentSoft)
  const bottom = hexToRgb(brand.accentDeep)
  // Same triangle as the favicon, on a 100-unit grid, kept well inside the
  // central 80% so a circular mask never clips it.
  const tri = [
    [38, 32],
    [68, 50],
    [38, 68],
  ].map(([x, y]) => [(x / 100) * size, (y / 100) * size])
  const SAMPLES = 3

  const stride = size * 3 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      // Diagonal gradient, soft corner top-left to deep corner bottom-right.
      const t = (x + y) / (2 * (size - 1))
      let covered = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inTriangle(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES, tri[0], tri[1], tri[2])) covered += 1
        }
      }
      const white = covered / (SAMPLES * SAMPLES)
      for (let c = 0; c < 3; c++) {
        const base = top[c] + (bottom[c] - top[c]) * t
        raw[y * stride + 1 + x * 3 + c] = Math.round(base + (255 - base) * white)
      }
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
  iconCache.set(key, png)
  return png
}

/** The sizes the page links to. Anything else is a 404, not a render-on-demand. */
export const ICON_SIZES = new Set([32, 180, 192, 512])
