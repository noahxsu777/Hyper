/**
 * SF-Symbols-flavoured icon set.
 * Every glyph is drawn on a 24×24 grid so it scales cleanly from a 14px status
 * bar chevron to a 48px app-store hero.
 */

const F = 'fill="currentColor" stroke="none"'

const PATHS = {
  /* ---- navigation & chrome -------------------------------------------- */
  "chevron-right": '<path d="M9 5l7 7-7 7"/>',
  "chevron-left": '<path d="M15 5l-7 7 7 7"/>',
  "chevron-down": '<path d="M5 9l7 7 7-7"/>',
  "chevron-up": '<path d="M5 15l7-7 7 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  ellipsis: `<circle cx="5" cy="12" r="1.7" ${F}/><circle cx="12" cy="12" r="1.7" ${F}/><circle cx="19" cy="12" r="1.7" ${F}/>`,
  trash:
    '<path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0110.7 4h2.6a1.2 1.2 0 011.2 1.2V7"/><path d="M6.5 7l.9 12.1A1.5 1.5 0 008.9 20.5h6.2a1.5 1.5 0 001.5-1.4L17.5 7"/>',
  share:
    '<path d="M12 15V3.5M12 3.5L8.5 7M12 3.5L15.5 7"/><path d="M6 11H5a1 1 0 00-1 1v7.5a1 1 0 001 1h14a1 1 0 001-1V12a1 1 0 00-1-1h-1"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 015.5 4H10a2 2 0 012 2v13a2 2 0 00-2-2H5.5A1.5 1.5 0 014 15.5z"/><path d="M20 5.5A1.5 1.5 0 0018.5 4H14a2 2 0 00-2 2v13a2 2 0 012-2h4.5a1.5 1.5 0 001.5-1.5z"/>',
  tabs: '<rect x="3" y="6" width="13" height="13" rx="2.5"/><path d="M7.5 6V4.6A1.6 1.6 0 019.1 3h9.3A2.6 2.6 0 0121 5.6v9.3a1.6 1.6 0 01-1.6 1.6H18"/>',
  reload: '<path d="M20 12a8 8 0 11-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>',
  "arrow-left": '<path d="M20 12H4.5M11 5l-7 7 7 7"/>',
  "arrow-right": '<path d="M4 12h15.5M13 5l7 7-7 7"/>',
  "arrow-up": '<path d="M12 20V4.5M5 11l7-7 7 7"/>',
  send: `<path d="M21 3L10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8z" />`,
  back: '<path d="M15 5l-7 7 7 7"/>',

  /* ---- status bar ------------------------------------------------------ */
  cellular: `<g ${F}><rect x="1" y="14" width="3" height="5" rx="1"/><rect x="6.5" y="11" width="3" height="8" rx="1"/><rect x="12" y="8" width="3" height="11" rx="1"/><rect x="17.5" y="5" width="3" height="14" rx="1"/></g>`,
  wifi: '<path d="M2.5 8.5a15 15 0 0119 0"/><path d="M6 12.4a10 10 0 0112 0"/><path d="M9.3 16.2a5 5 0 015.4 0"/><circle cx="12" cy="19.6" r="1.1" fill="currentColor"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.2 10.5V7.8a3.8 3.8 0 017.6 0v2.7"/>',
  "lock-open": '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.2 10.5V7.8a3.8 3.8 0 017.6-.4"/>',

  /* ---- control center -------------------------------------------------- */
  airplane: `<path d="M10.6 3.3a1.4 1.4 0 012.8 0V9l7.6 4.4v2.2l-7.6-2.3v4.1l2.6 1.9v1.5L12 20l-4 .8v-1.5l2.6-1.9v-4.1L3 15.6v-2.2L10.6 9z" ${F}/>`,
  bluetooth: '<path d="M7.5 7.5L16.5 16 12 20V4l4.5 4L7.5 16.5"/>',
  airdrop: '<path d="M7 16a7 7 0 1110 0"/><path d="M9.8 13.4a3.2 3.2 0 014.4 0"/><circle cx="12" cy="10.8" r="1.2" fill="currentColor"/><path d="M12 13v8"/>',
  hotspot: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.5 6.5a7.8 7.8 0 000 11M17.5 6.5a7.8 7.8 0 010 11"/>',
  flashlight:
    '<path d="M9 3h6l-.8 4.2a2 2 0 01-.5 1L13 9v10.5a1 1 0 01-1 1h0a1 1 0 01-1-1V9l-.7-.8a2 2 0 01-.5-1z"/>',
  camera:
    '<rect x="3" y="6.5" width="18" height="13" rx="3.2"/><circle cx="12" cy="13" r="3.8"/><path d="M8.5 6.5l1.2-2.2h4.6l1.2 2.2"/>',
  timer:
    '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.6"/><path d="M9.5 3h5"/>',
  calculator:
    '<rect x="4" y="2.5" width="16" height="19" rx="3"/><rect x="7" y="5.5" width="10" height="3.5" rx="1"/><circle cx="8.5" cy="13" r="1.1" fill="currentColor"/><circle cx="12" cy="13" r="1.1" fill="currentColor"/><circle cx="15.5" cy="13" r="1.1" fill="currentColor"/><circle cx="8.5" cy="17.5" r="1.1" fill="currentColor"/><circle cx="12" cy="17.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="17.5" r="1.1" fill="currentColor"/>',
  rotate: '<path d="M6 9a8 8 0 0113.5-1.5"/><path d="M19.8 3.5V8h-4.5"/><rect x="8" y="12" width="8" height="9" rx="2"/>',
  focus: '<path d="M12 3a9 9 0 108.5 12A7 7 0 0112 3z"/>',
  screen: '<rect x="2.5" y="4.5" width="19" height="12" rx="2"/><path d="M8 20h8"/>',

  /* ---- media ----------------------------------------------------------- */
  play: `<path d="M7 4.8v14.4a.8.8 0 001.24.67l11-7.2a.8.8 0 000-1.34l-11-7.2A.8.8 0 007 4.8z" ${F}/>`,
  pause: `<g ${F}><rect x="6.5" y="4.5" width="4" height="15" rx="1.4"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.4"/></g>`,
  backward: `<g ${F}><path d="M11.5 6v12a.7.7 0 01-1.1.58L2.6 12.6a.7.7 0 010-1.16l7.8-5.98A.7.7 0 0111.5 6z"/><path d="M22 6v12a.7.7 0 01-1.1.58l-7.8-5.98a.7.7 0 010-1.16l7.8-5.98A.7.7 0 0122 6z"/></g>`,
  forward: `<g ${F}><path d="M12.5 6v12a.7.7 0 001.1.58l7.8-5.98a.7.7 0 000-1.16L13.6 5.46A.7.7 0 0012.5 6z"/><path d="M2 6v12a.7.7 0 001.1.58l7.8-5.98a.7.7 0 000-1.16L3.1 5.46A.7.7 0 002 6z"/></g>`,
  speaker: `<path d="M11 4.6L6.4 8.5H3.2a.7.7 0 00-.7.7v5.6a.7.7 0 00.7.7h3.2l4.6 3.9a.7.7 0 001.2-.55V5.15A.7.7 0 0011 4.6z" ${F}/><path d="M15.5 9a4.2 4.2 0 010 6M18.2 6.4a8 8 0 010 11.2"/>`,
  "speaker-off": `<path d="M11 4.6L6.4 8.5H3.2a.7.7 0 00-.7.7v5.6a.7.7 0 00.7.7h3.2l4.6 3.9a.7.7 0 001.2-.55V5.15A.7.7 0 0011 4.6z" ${F}/><path d="M16 9.5l5 5M21 9.5l-5 5"/>`,
  shuffle: '<path d="M3 6h3.5l9 12H21M3 18h3.5l3-4M14.5 8l1.5-2H21"/><path d="M18.5 3.5L21 6l-2.5 2.5M18.5 15.5L21 18l-2.5 2.5"/>',
  repeat: '<path d="M4 9.5A3.5 3.5 0 017.5 6h12M20 14.5a3.5 3.5 0 01-3.5 3.5h-12"/><path d="M17 3.5L19.5 6 17 8.5M7 15.5L4.5 18 7 20.5"/>',
  heart:
    '<path d="M12 20s-7.6-4.7-9.1-9.2A5 5 0 0112 6.6a5 5 0 019.1 4.2C19.6 15.3 12 20 12 20z"/>',

  /* ---- weather --------------------------------------------------------- */
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
  cloud: '<path d="M7.5 18.5h9.2a3.8 3.8 0 00.4-7.6 5.6 5.6 0 00-10.8-1.2 3.9 3.9 0 001.2 8.8z"/>',
  "cloud-sun":
    '<circle cx="8" cy="7.5" r="2.8"/><path d="M8 2.4v1.4M2.9 7.5h1.4M4.4 3.9l1 1M11.6 3.9l-1 1"/><path d="M10 19.5h7.4a3.3 3.3 0 00.3-6.6 4.9 4.9 0 00-9.4-1 3.4 3.4 0 001.7 7.6z"/>',
  "cloud-rain":
    '<path d="M7.8 15.5h8.6a3.5 3.5 0 00.4-7 5.2 5.2 0 00-10-1.1 3.6 3.6 0 001 8.1z"/><path d="M9 18.4l-.8 2.4M13 18.4l-.8 2.4M17 18.4l-.8 2.4"/>',
  drop: '<path d="M12 3.5s5.5 6.1 5.5 9.7a5.5 5.5 0 11-11 0C6.5 9.6 12 3.5 12 3.5z"/>',
  wind: '<path d="M3 8.5h10.5a2.8 2.8 0 10-2.8-2.8"/><path d="M3 13h14a2.8 2.8 0 11-2.8 2.8"/><path d="M3 17.5h6.5"/>',
  thermometer:
    '<path d="M14 14.2V5.5a2 2 0 10-4 0v8.7a4 4 0 104 0z"/><circle cx="12" cy="17.5" r="1.6" fill="currentColor"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/>',
  sunrise:
    '<path d="M12 3.5v5M8.5 6.5L12 3l3.5 3.5M2.5 15h19M5 19h14"/><path d="M6.5 15a5.5 5.5 0 0111 0"/>',

  /* ---- apps ------------------------------------------------------------ */
  compass:
    '<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2.1 5.5-5.5 2.1 2.1-5.5z" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8l1 2.4 2.6-.6 1.2 2.3 2.5.4-.4 2.6 2 1.7-1.6 2 1 2.4-2.3 1.2-.2 2.6-2.6-.2-1.7 2-2-1.6-2.4 1-1.2-2.3-2.6-.2.2-2.6-2-1.7 1.6-2-1-2.4L4.4 8l.2-2.6 2.6.2z"/>',
  note: '<path d="M5 4.5h14v11.2L14.7 20H5z"/><path d="M19 15.6h-4.3V20"/><path d="M8 9h8M8 12.5h6"/>',
  photo:
    '<rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.5" cy="10" r="1.8"/><path d="M3.5 17l4.8-4.6a2 2 0 012.8 0l3 3 1.7-1.6a2 2 0 012.8 0l2 1.9"/>',
  music:
    '<path d="M9.2 17.8V6.4l10.6-1.9v11.2"/><circle cx="6.6" cy="17.8" r="2.6"/><circle cx="17.2" cy="15.7" r="2.6"/>',
  message:
    '<path d="M12 3.8c5 0 9 3.3 9 7.5s-4 7.5-9 7.5a11 11 0 01-2.7-.33L5 20.3l1.1-3.2A7.9 7.9 0 013 11.3C3 7.1 7 3.8 12 3.8z"/>',
  calendar:
    '<rect x="3.2" y="5" width="17.6" height="15.5" rx="3"/><path d="M3.2 9.6h17.6M8 3.5v3M16 3.5v3"/>',
  store: '<path d="M12 3.6l7.6 13.2a1 1 0 01-.87 1.5H5.27a1 1 0 01-.87-1.5z"/><path d="M9.4 18.3l-1.6 2.6M14.6 18.3l1.6 2.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6.6V12l3.6 2.2"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18 14 14 0 010-18z"/>',
  stopwatch:
    '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9"/><path d="M9.6 2.8h4.8M18.6 6.3l1.6-1.6"/>',
  alarm:
    '<circle cx="12" cy="13.2" r="7.2"/><path d="M12 9.4v3.8l2.6 1.6"/><path d="M3.4 6.2A4.6 4.6 0 016.8 2.8M20.6 6.2a4.6 4.6 0 00-3.4-3.4"/>',
  reminders:
    '<circle cx="6.5" cy="7" r="2.6"/><circle cx="6.5" cy="16.5" r="2.6"/><path d="M12 7h8M12 16.5h8"/>',
  mail: '<rect x="2.8" y="5" width="18.4" height="14" rx="3"/><path d="M3.4 7.5l7.5 5.4a2 2 0 002.2 0l7.5-5.4"/>',
  phone:
    '<path d="M6.4 3.5h2.5l1.7 4-2 1.5a12.5 12.5 0 006.4 6.4l1.5-2 4 1.7v2.5a2 2 0 01-2.2 2C11.6 19 5 12.4 4.4 5.7a2 2 0 012-2.2z"/>',
  maps: '<path d="M9 4.2L3.5 6.4v13.4L9 17.6l6 2.2 5.5-2.2V4.2L15 6.4z"/><path d="M9 4.2v13.4M15 6.4v13.4"/>',
  files: '<path d="M3.5 7.5a2 2 0 012-2h3.6l2 2.4h7.4a2 2 0 012 2v8.6a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>',
  health:
    '<path d="M12 20.5s-8-4.9-8-10.1A4.6 4.6 0 0112 7.4a4.6 4.6 0 018 3c0 5.2-8 10.1-8 10.1z"/>',
  wallet:
    '<rect x="2.8" y="5.5" width="18.4" height="13" rx="3"/><path d="M2.8 10h18.4"/><circle cx="17.2" cy="14.2" r="1.3" fill="currentColor"/>',
  contacts:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="12" cy="10" r="2.8"/><path d="M7 17.4a5.4 5.4 0 0110 0"/>',
  tv: '<rect x="2.8" y="4.5" width="18.4" height="12.5" rx="2.5"/><path d="M8 20.5h8"/>',
  podcast:
    '<circle cx="12" cy="8" r="2.6"/><path d="M9.6 20.4l.8-6.4h3.2l.8 6.4z"/><path d="M6.6 12.4a7 7 0 0110.8 0"/>',
  home: '<path d="M4 10.6L12 4l8 6.6V19a1.6 1.6 0 01-1.6 1.6h-3.2V14h-6.4v6.6H5.6A1.6 1.6 0 014 19z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.9" r="1.15" fill="currentColor"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1112 0v5.5l1.5 2.2H4.5z"/><path d="M9.8 21a2.4 2.4 0 004.4 0"/>',
  star: '<path d="M12 3.6l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z"/>',
  power: '<path d="M12 3.5v8"/><path d="M7.2 6.6a7.5 7.5 0 109.6 0"/>',
  key: '<circle cx="7.5" cy="12" r="3.8"/><path d="M11.3 12H21M18 12v3.4M15 12v2.6"/>',
  shield: '<path d="M12 3.2l7 2.6v6.1c0 4.3-2.9 7.6-7 8.9-4.1-1.3-7-4.6-7-8.9V5.8z"/>',
  cloud2: '<path d="M7.5 18.5h9.2a3.8 3.8 0 00.4-7.6 5.6 5.6 0 00-10.8-1.2 3.9 3.9 0 001.2 8.8z"/>',
  battery:
    '<rect x="2.5" y="8" width="16.5" height="9" rx="2.6"/><path d="M21.5 11.4v2.2"/><rect x="4.6" y="10" width="8" height="5" rx="1.2" fill="currentColor" stroke="none"/>',
  hand: '<path d="M8.5 11V5.4a1.6 1.6 0 013.2 0V11m0-1.2V4.2a1.6 1.6 0 013.2 0V11m0-.6a1.6 1.6 0 013.2 0v5.4A5.5 5.5 0 0112.6 21h-1a5 5 0 01-4.2-2.4L5 14.8a1.6 1.6 0 012.5-2l1 1.2"/>',
  face: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10.2" r="1.1" fill="currentColor"/><circle cx="15" cy="10.2" r="1.1" fill="currentColor"/><path d="M8.6 15a4.6 4.6 0 006.8 0"/>',
  text: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/>',
  keyboard:
    '<rect x="2.2" y="5.5" width="19.6" height="13" rx="2.6"/><path d="M6 9h.01M9.5 9h.01M13 9h.01M16.5 9h.01M6 12.2h.01M9.5 12.2h.01M13 12.2h.01M16.5 12.2h.01" stroke-width="2.2"/><path d="M8 15.4h8"/>',
  hyperbeam:
    '<path d="M4 5.5v13M20 5.5v13M4 12h16"/><circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/>',
}

/**
 * Render an icon as an SVG string.
 * @param {keyof PATHS} name
 * @param {{size?: number, width?: number, stroke?: number, className?: string}} opts
 */
export function icon(name, opts = {}) {
  const body = PATHS[name]
  if (!body) {
    console.warn(`[icons] unknown glyph "${name}"`)
    return ""
  }
  const size = opts.size ?? 24
  const stroke = opts.stroke ?? 1.7
  const cls = opts.className ? ` class="${opts.className}"` : ""
  return `<svg${cls} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

/** Render an icon as a real element, ready to append. */
export function iconEl(name, opts = {}) {
  const wrapper = document.createElement("span")
  wrapper.style.display = "contents"
  wrapper.innerHTML = icon(name, opts)
  return wrapper.firstElementChild ?? wrapper
}

export const iconNames = Object.keys(PATHS)
