/** Clock — world clock, alarms, stopwatch with laps, and a countdown timer. */

import { fill, h } from "../core/dom.js"
import { action, list, row, screen, switchControl, tabBar } from "../ui/kit.js"

const CITIES = [
  { city: "Madrid", zone: "Europe/Madrid" },
  { city: "Ciudad de México", zone: "America/Mexico_City" },
  { city: "Nueva York", zone: "America/New_York" },
  { city: "Tokio", zone: "Asia/Tokyo" },
  { city: "Londres", zone: "Europe/London" },
  { city: "Buenos Aires", zone: "America/Argentina/Buenos_Aires" },
]

const pad = (value, size = 2) => String(value).padStart(size, "0")

const splitTime = (ms) => ({
  minutes: Math.floor(ms / 60000),
  seconds: Math.floor((ms % 60000) / 1000),
  hundredths: Math.floor((ms % 1000) / 10),
})

const stopwatchText = (ms) => {
  const { minutes, seconds, hundredths } = splitTime(ms)
  return `${pad(minutes)}:${pad(seconds)},${pad(hundredths)}`
}

const timerText = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

export const clock = {
  id: "clock",
  name: "Reloj",
  tagline: "Alarmas y cronómetro",
  icon: "clock",
  gradient: "linear-gradient(160deg,#2c2c31,#0b0b0d)",

  mount(root, ctx) {
    let tab = "world"
    const intervals = new Set()
    const host = h("div.app__body")

    const every = (ms, fn) => {
      const id = setInterval(fn, ms)
      intervals.add(id)
      return id
    }

    /* ------------------------------------------------------------- world */

    function renderWorld() {
      const rows = CITIES.map(({ city, zone }) => {
        const now = new Date()
        const time = now.toLocaleTimeString("es-ES", {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
        const localHour = Number(
          now.toLocaleString("en-US", { timeZone: zone, hour: "2-digit", hour12: false }).slice(0, 2),
        )
        const here = new Date().getHours()
        const delta = Math.round(((localHour - here + 36) % 24) - 12)
        return row({
          label: city,
          sub: delta === 0 ? "Misma hora" : `${delta > 0 ? "+" : ""}${delta} h`,
          value: time,
        })
      })
      return list({ rows })
    }

    /* ------------------------------------------------------------ alarms */

    const alarms = [
      { id: "a1", time: "07:00", label: "Despertar", on: true, days: "Lun a Vie" },
      { id: "a2", time: "13:30", label: "Comida", on: false, days: "Todos los días" },
      { id: "a3", time: "22:45", label: "Dormir", on: true, days: "Todos los días" },
    ]

    function renderAlarms() {
      return list({
        header: "Otras",
        rows: alarms.map((alarm) =>
          row({
            label: alarm.time,
            sub: `${alarm.label} · ${alarm.days}`,
            accessory: switchControl(alarm.on, (next) => {
              alarm.on = next
              ctx.toast({
                title: next ? "Alarma activada" : "Alarma desactivada",
                text: `${alarm.time} · ${alarm.label}`,
                glyph: "alarm",
                color: "var(--orange)",
              })
            }),
          }),
        ),
      })
    }

    /* --------------------------------------------------------- stopwatch */

    const stopwatch = { elapsed: 0, running: false, startedAt: 0, laps: [] }

    function renderStopwatch() {
      const display = h("div.clock-face__time", { text: stopwatchText(stopwatch.elapsed) })
      const lapsHost = h("div.stopwatch__laps")

      const primary = h("button.round-btn", {
        type: "button",
        dataset: { tone: stopwatch.running ? "stop" : "start" },
        text: stopwatch.running ? "Parar" : "Iniciar",
      })
      const secondary = h("button.round-btn", {
        type: "button",
        dataset: { tone: "neutral" },
        text: stopwatch.running ? "Vuelta" : "Restablecer",
        disabled: !stopwatch.running && stopwatch.elapsed === 0,
      })

      const paint = () => {
        display.textContent = stopwatchText(
          stopwatch.running ? stopwatch.elapsed + (performance.now() - stopwatch.startedAt) : stopwatch.elapsed,
        )
      }

      const paintLaps = () => {
        fill(
          lapsHost,
          ...stopwatch.laps
            .map((lap, index) =>
              h(
                "div.lap",
                null,
                h("span", { text: `Vuelta ${stopwatch.laps.length - index}` }),
                h("span", { text: stopwatchText(lap) }),
              ),
            )
            .reverse(),
        )
      }

      primary.addEventListener("click", () => {
        if (stopwatch.running) {
          stopwatch.elapsed += performance.now() - stopwatch.startedAt
          stopwatch.running = false
        } else {
          stopwatch.startedAt = performance.now()
          stopwatch.running = true
        }
        renderTab()
      })

      secondary.addEventListener("click", () => {
        if (stopwatch.running) {
          const total = stopwatch.elapsed + (performance.now() - stopwatch.startedAt)
          const previous = stopwatch.laps.reduce((sum, lap) => sum + lap, 0)
          stopwatch.laps.push(total - previous)
          paintLaps()
        } else {
          stopwatch.elapsed = 0
          stopwatch.laps = []
          renderTab()
        }
      })

      every(37, paint)
      paintLaps()

      return h(
        "div",
        null,
        h("div.clock-face", null, display),
        h("div.round-actions", null, secondary, primary),
        lapsHost,
      )
    }

    /* ------------------------------------------------------------- timer */

    const timer = { total: 5 * 60 * 1000, remaining: 5 * 60 * 1000, running: false, endsAt: 0 }

    function renderTimer() {
      const circumference = 2 * Math.PI * 108
      const progress = timer.total ? timer.remaining / timer.total : 0

      const ring = h("span", {
        html: `<svg viewBox="0 0 240 240">
          <circle cx="120" cy="120" r="108" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="9"/>
          <circle class="timer-progress" cx="120" cy="120" r="108" fill="none" stroke="var(--orange)"
            stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - progress)}"/>
        </svg>`,
      })

      const value = h("div.timer-ring__value", { text: timerText(timer.remaining) })
      const wrap = h("div.timer-ring__wrap", null, ring, value)

      const minutesInput = h("input", {
        type: "range",
        min: "1",
        max: "60",
        value: String(Math.round(timer.total / 60000)),
        style: { width: "100%" },
        disabled: timer.running,
        onInput: (event) => {
          timer.total = Number(event.target.value) * 60000
          timer.remaining = timer.total
          value.textContent = timerText(timer.remaining)
          minutesLabel.textContent = `${event.target.value} min`
        },
      })
      const minutesLabel = h("div.clock-face__label", {
        text: `${Math.round(timer.total / 60000)} min`,
      })

      const primary = h("button.round-btn", {
        type: "button",
        dataset: { tone: timer.running ? "stop" : "start" },
        text: timer.running ? "Pausa" : "Iniciar",
        onClick: () => {
          if (timer.running) {
            timer.remaining = Math.max(0, timer.endsAt - Date.now())
            timer.running = false
          } else {
            if (timer.remaining <= 0) timer.remaining = timer.total
            timer.endsAt = Date.now() + timer.remaining
            timer.running = true
          }
          renderTab()
        },
      })

      const cancel = h("button.round-btn", {
        type: "button",
        dataset: { tone: "neutral" },
        text: "Cancelar",
        disabled: !timer.running && timer.remaining === timer.total,
        onClick: () => {
          timer.running = false
          timer.remaining = timer.total
          renderTab()
        },
      })

      every(120, () => {
        if (!timer.running) return
        timer.remaining = Math.max(0, timer.endsAt - Date.now())
        value.textContent = timerText(timer.remaining)
        const circle = ring.querySelector(".timer-progress")
        if (circle) {
          circle.setAttribute(
            "stroke-dashoffset",
            String(circumference * (1 - timer.remaining / timer.total)),
          )
        }
        if (timer.remaining === 0) {
          timer.running = false
          ctx.toast({
            title: "Temporizador",
            text: "Se acabó el tiempo",
            glyph: "timer",
            color: "var(--orange)",
          })
          ctx.island({ text: "Temporizador terminado", tone: "ok" })
          renderTab()
        }
      })

      return h(
        "div",
        null,
        h("div.timer-ring", null, wrap),
        h("div.clock-face", { style: { paddingTop: "0" } }, minutesLabel),
        h("div", { style: { padding: "0 40px" } }, minutesInput),
        h("div.round-actions", null, cancel, primary),
      )
    }

    /* ------------------------------------------------------------ plumbing */

    function clearIntervals() {
      for (const id of intervals) clearInterval(id)
      intervals.clear()
    }

    function renderTab() {
      clearIntervals()
      const views = {
        world: renderWorld,
        alarms: renderAlarms,
        stopwatch: renderStopwatch,
        timer: renderTimer,
      }
      fill(host, views[tab]())
      header.setTitle(
        { world: "Reloj mundial", alarms: "Alarma", stopwatch: "Cronómetro", timer: "Temporizador" }[tab],
      )
      if (tab === "world") every(10000, () => tab === "world" && fill(host, renderWorld()))
    }

    const tabs = tabBar(
      [
        { id: "world", label: "Mundial", glyph: "globe" },
        { id: "alarms", label: "Alarma", glyph: "alarm" },
        { id: "stopwatch", label: "Cronómetro", glyph: "stopwatch" },
        { id: "timer", label: "Temporiz.", glyph: "timer" },
      ],
      tab,
      (next) => {
        tab = next
        renderTab()
      },
    )

    const header = screen({
      title: "Reloj mundial",
      right: action("Editar", () => ctx.toast({ title: "Editar", text: "No implementado" }), {
        side: "right",
      }),
    })

    fill(root, header.navbar, host, tabs)
    host.addEventListener("scroll", () => {
      header.navbar.dataset.scrolled = String(host.scrollTop > 14)
    })
    renderTab()

    return {
      destroy: clearIntervals,
    }
  },
}

export default clock
