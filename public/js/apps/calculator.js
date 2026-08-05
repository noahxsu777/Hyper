/** Calculator, matching the real one's key layout, precedence and quirks. */

import { fill, h } from "../core/dom.js"

const KEYS = [
  { label: "AC", kind: "fn", action: "clear" },
  { label: "+/−", kind: "fn", action: "negate" },
  { label: "%", kind: "fn", action: "percent" },
  { label: "÷", kind: "op", action: "op", op: "/" },
  { label: "7", action: "digit" },
  { label: "8", action: "digit" },
  { label: "9", action: "digit" },
  { label: "×", kind: "op", action: "op", op: "*" },
  { label: "4", action: "digit" },
  { label: "5", action: "digit" },
  { label: "6", action: "digit" },
  { label: "−", kind: "op", action: "op", op: "-" },
  { label: "1", action: "digit" },
  { label: "2", action: "digit" },
  { label: "3", action: "digit" },
  { label: "+", kind: "op", action: "op", op: "+" },
  { label: "0", action: "digit", wide: true },
  { label: ",", action: "decimal" },
  { label: "=", kind: "op", action: "equals" },
]

const format = (value) => {
  if (!Number.isFinite(value)) return "Error"
  const rounded = Math.abs(value) < 1e-10 && value !== 0 ? 0 : value
  const text =
    Math.abs(rounded) >= 1e9 || (Math.abs(rounded) < 1e-4 && rounded !== 0)
      ? rounded.toExponential(5)
      : String(Number(rounded.toPrecision(12)))
  const [whole, decimals] = text.split(".")
  const grouped = Number(whole).toLocaleString("es-ES", { maximumFractionDigits: 0 })
  return decimals ? `${grouped},${decimals}` : grouped
}

export const calculator = {
  id: "calculator",
  name: "Calculadora",
  tagline: "Cálculos rápidos",
  icon: "calculator",
  gradient: "linear-gradient(160deg,#4a4a4f,#1c1c1e)",

  mount(root, ctx) {
    // `entry` is what the user is typing; `accumulator` is the pending left side.
    let entry = "0"
    let accumulator = null
    let pendingOp = null
    let replaceEntry = true
    let lastOperand = null

    const valueEl = h("div.calc__value", { text: "0" })
    const exprEl = h("div.calc__expr", { text: "" })
    const pad = h("div.calc__pad")

    const opSymbols = { "+": "+", "-": "−", "*": "×", "/": "÷" }

    function render() {
      valueEl.textContent = entry
      const length = entry.replace(/[^\d]/g, "").length
      valueEl.dataset.long = length > 9 ? "very" : length > 6 ? "true" : "false"
      exprEl.textContent =
        accumulator != null && pendingOp ? `${format(accumulator)} ${opSymbols[pendingOp]}` : ""

      for (const button of pad.children) {
        if (button.dataset.op) {
          button.dataset.armed = String(button.dataset.op === pendingOp && replaceEntry)
        }
      }
    }

    const current = () => Number(entry.replace(/\./g, "").replace(",", "."))

    function apply(a, op, b) {
      switch (op) {
        case "+":
          return a + b
        case "-":
          return a - b
        case "*":
          return a * b
        case "/":
          return b === 0 ? NaN : a / b
        default:
          return b
      }
    }

    function press(key) {
      switch (key.action) {
        case "digit": {
          if (replaceEntry) {
            entry = key.label
            replaceEntry = false
          } else if (entry.replace(/[^\d]/g, "").length < 12) {
            entry = entry === "0" ? key.label : entry + key.label
          }
          break
        }
        case "decimal": {
          if (replaceEntry) {
            entry = "0,"
            replaceEntry = false
          } else if (!entry.includes(",")) {
            entry += ","
          }
          break
        }
        case "negate": {
          entry = entry.startsWith("-") ? entry.slice(1) : `-${entry}`
          break
        }
        case "percent": {
          const base = accumulator ?? 0
          const value =
            pendingOp === "+" || pendingOp === "-" ? (base * current()) / 100 : current() / 100
          entry = format(value)
          break
        }
        case "op": {
          if (pendingOp && !replaceEntry) {
            accumulator = apply(accumulator, pendingOp, current())
            entry = format(accumulator)
          } else {
            accumulator = current()
          }
          pendingOp = key.op
          replaceEntry = true
          lastOperand = null
          break
        }
        case "equals": {
          if (pendingOp) {
            const operand = replaceEntry && lastOperand != null ? lastOperand : current()
            lastOperand = operand
            const result = apply(accumulator ?? 0, pendingOp, operand)
            accumulator = result
            entry = format(result)
            replaceEntry = true
          }
          break
        }
        case "clear": {
          entry = "0"
          accumulator = null
          pendingOp = null
          lastOperand = null
          replaceEntry = true
          break
        }
      }
      render()
    }

    fill(
      pad,
      ...KEYS.map((key) =>
        h("button.calc__key", {
          type: "button",
          text: key.label,
          dataset: {
            kind: key.kind ?? "digit",
            wide: String(Boolean(key.wide)),
            ...(key.op ? { op: key.op } : {}),
          },
          onClick: () => press(key),
        }),
      ),
    )

    fill(
      root,
      h(
        "div",
        { style: { display: "contents" } },
        h("div", { style: { flex: "1" } }),
        h("div.calc__display", null, exprEl, valueEl),
        pad,
      ),
    )
    root.classList.add("calc")

    const onKey = (event) => {
      const map = {
        Enter: KEYS.find((k) => k.action === "equals"),
        "=": KEYS.find((k) => k.action === "equals"),
        Escape: KEYS.find((k) => k.action === "clear"),
        Backspace: null,
        "+": KEYS.find((k) => k.op === "+"),
        "-": KEYS.find((k) => k.op === "-"),
        "*": KEYS.find((k) => k.op === "*"),
        "/": KEYS.find((k) => k.op === "/"),
        "%": KEYS.find((k) => k.action === "percent"),
        ",": KEYS.find((k) => k.action === "decimal"),
        ".": KEYS.find((k) => k.action === "decimal"),
      }
      if (event.key === "Backspace") {
        entry = entry.length > 1 ? entry.slice(0, -1) : "0"
        if (entry === "-") entry = "0"
        render()
        return
      }
      if (/^\d$/.test(event.key)) {
        press({ action: "digit", label: event.key })
        return
      }
      const key = map[event.key]
      if (key) {
        event.preventDefault()
        press(key)
      }
    }
    window.addEventListener("keydown", onKey)

    render()

    return {
      destroy() {
        window.removeEventListener("keydown", onKey)
      },
    }
  },
}

export default calculator
