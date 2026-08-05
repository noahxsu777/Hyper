/** Reusable UIKit-shaped building blocks shared by every app. */

import { append, fill, h, wait } from "../core/dom.js"
import { icon } from "../core/icons.js"

/**
 * Standard app scaffold: a large-title nav bar that collapses on scroll, a
 * scrollable body, and an optional tab bar.
 * @returns {{node: HTMLElement, body: HTMLElement, navbar: HTMLElement, setTitle(t:string):void}}
 */
export function screen({ title, left, right, body = [], tabs, subtitle } = {}) {
  const titleEl = h("div.navbar__title", { text: title ?? "" })
  const largeEl = h("h1.navbar__large", { text: title ?? "" })

  const navbar = h(
    "div.navbar",
    { dataset: { scrolled: "false" } },
    h(
      "div.navbar__row",
      null,
      left ?? h("span.navbar__action"),
      titleEl,
      right ?? h("span.navbar__action.navbar__action--right"),
    ),
    title ? largeEl : null,
    subtitle ? h("div", { class: "row__sub", text: subtitle, style: { paddingBottom: "6px" } }) : null,
  )

  const bodyEl = h("div.app__body")
  append(bodyEl, [body])

  bodyEl.addEventListener("scroll", () => {
    navbar.dataset.scrolled = String(bodyEl.scrollTop > 14)
  })

  const node = h("div", { style: { display: "contents" } })
  append(node, [navbar, bodyEl, tabs ?? null])

  return {
    node,
    navbar,
    body: bodyEl,
    setTitle(next) {
      titleEl.textContent = next
      largeEl.textContent = next
    },
  }
}

/** A tappable text/glyph action for the nav bar. */
export function action(label, onClick, { glyph, side = "left", tone } = {}) {
  return h(
    "button.navbar__action",
    {
      type: "button",
      class: side === "right" ? "navbar__action--right" : "",
      style: tone ? { color: tone } : null,
      onClick,
    },
    glyph ? h("span", { html: icon(glyph, { size: 20, stroke: 2.1 }) }) : null,
    label ? h("span", { text: label }) : null,
  )
}

/** Back chevron used by pushed sub-pages. */
export function backAction(label, onClick) {
  return action(label ?? "Atrás", onClick, { glyph: "back" })
}

/** An inset grouped list. */
export function list({ header, footer, rows = [] } = {}) {
  return h(
    "div",
    { style: { display: "contents" } },
    header ? h("div.list__header", { text: header }) : null,
    h("div.list", null, ...rows.filter(Boolean)),
    footer ? h("div.list__footer", { text: footer }) : null,
  )
}

/**
 * A list row. Pass `onClick` to make it a button, `value`/`chevron` for the
 * usual Settings look, `accessory` for anything custom (a switch, a badge).
 */
export function row({
  label,
  sub,
  value,
  glyph,
  glyphColor,
  chevron,
  accessory,
  onClick,
  insetIcon,
  tone,
} = {}) {
  const children = [
    glyph
      ? h("span.row__icon", {
          style: { background: glyphColor ?? "var(--gray)" },
          html: icon(glyph, { size: 19, stroke: 1.9 }),
        })
      : null,
    h(
      "span.row__label",
      { style: tone ? { color: tone } : null },
      h("span", { text: label ?? "", style: { display: "block" } }),
      sub ? h("span.row__sub", { text: sub, style: { display: "block" } }) : null,
    ),
    value != null ? h("span.row__value", { text: String(value) }) : null,
    accessory ?? null,
    chevron ? h("span.row__chevron", { html: icon("chevron-right", { size: 13, stroke: 2.4 }) }) : null,
  ]

  return h(
    onClick ? "button.row" : "div.row",
    {
      type: onClick ? "button" : null,
      class: insetIcon || glyph ? "row--inset-icon" : "",
      onClick,
    },
    ...children,
  )
}

/** iOS switch. `onChange(next)` receives the new value. */
export function switchControl(initial, onChange) {
  const node = h("button.switch", {
    type: "button",
    role: "switch",
    "aria-checked": String(Boolean(initial)),
    dataset: { on: String(Boolean(initial)) },
  })
  node.addEventListener("click", () => {
    const next = node.dataset.on !== "true"
    node.dataset.on = String(next)
    node.setAttribute("aria-checked", String(next))
    onChange?.(next)
  })
  return node
}

/** Segmented control. `options` is `[{ id, label }]`. */
export function segmented(options, activeId, onChange) {
  const node = h("div.segmented")
  const buttons = options.map((option) =>
    h("button", {
      type: "button",
      text: option.label,
      dataset: { active: String(option.id === activeId) },
      onClick: () => {
        for (const button of buttons) button.dataset.active = "false"
        buttons[options.indexOf(option)].dataset.active = "true"
        onChange?.(option.id)
      },
    }),
  )
  append(node, buttons)
  return node
}

/** Bottom tab bar. `items` is `[{ id, label, glyph }]`. */
export function tabBar(items, activeId, onChange) {
  const node = h("div.tabbar")
  const buttons = items.map((item) =>
    h(
      "button",
      {
        type: "button",
        dataset: { active: String(item.id === activeId) },
        onClick: () => {
          for (const button of buttons) button.dataset.active = "false"
          buttons[items.indexOf(item)].dataset.active = "true"
          onChange?.(item.id)
        },
      },
      h("span", { html: icon(item.glyph, { size: 25, stroke: 1.6 }) }),
      h("span", { text: item.label }),
    ),
  )
  append(node, buttons)
  return node
}

/**
 * Push a sub-page over the app root, iOS navigation-controller style.
 * Returns a `pop()` that plays the reverse animation.
 */
export function pushPage(root, build) {
  const page = h("div.subpage")
  const pop = async () => {
    page.dataset.closing = "true"
    await wait(220)
    page.remove()
  }
  append(page, [build(pop)])
  root.append(page)
  return pop
}

/** Placeholder for an empty collection. */
export function emptyState({ glyph = "info", title, text } = {}) {
  return h(
    "div.empty-state",
    null,
    h("span", { html: icon(glyph, { size: 52, stroke: 1.3 }) }),
    title ? h("h3", { text: title }) : null,
    text ? h("p", { text }) : null,
  )
}

export { fill, h }
