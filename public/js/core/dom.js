/** Tiny DOM helpers. Enough structure to build UIs without a framework. */

/**
 * Create an element.
 * @param {string} tag - "div", or "div.class.other#id"
 * @param {object|null} props - attributes; `class`, `style` (object), `on*` handlers,
 *   `dataset`, `html` for innerHTML, `text` for textContent.
 * @param {...(Node|string|null|undefined|Array)} children
 */
export function h(tag, props = null, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/)
  const el = document.createElement(name || "div")

  for (const token of rest) {
    if (token[0] === ".") el.classList.add(token.slice(1))
    else if (token[0] === "#") el.id = token.slice(1)
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue
      if (key === "class") el.classList.add(...String(value).split(/\s+/).filter(Boolean))
      else if (key === "style" && typeof value === "object") Object.assign(el.style, value)
      else if (key === "dataset") Object.assign(el.dataset, value)
      else if (key === "html") el.innerHTML = value
      else if (key === "text") el.textContent = value
      else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value)
      } else if (value === true) el.setAttribute(key, "")
      else el.setAttribute(key, value)
    }
  }

  append(el, children)
  return el
}

/** Append a nested array of children, skipping nullish entries. */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return parent
}

/** Replace all children of `parent`. */
export function fill(parent, ...children) {
  parent.replaceChildren()
  append(parent, children)
  return parent
}

export const $ = (selector, scope = document) => scope.querySelector(selector)
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)]

/** Wait for `ms`, or for the next animation frame when omitted. */
export const wait = (ms) =>
  new Promise((resolve) =>
    ms == null ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, ms),
  )

/** Clamp `n` into [min, max]. */
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

/** Deterministic pseudo-random in [0,1) from a string seed — stable mock data. */
export function seeded(seed) {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 100000) / 100000
}
