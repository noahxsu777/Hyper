/**
 * Weather.
 *
 * The forecast is generated from a seeded pseudo-random function so the numbers
 * stay stable between renders instead of jittering on every repaint.
 */

import { fill, h, seeded } from "../core/dom.js"
import { icon } from "../core/icons.js"

const CONDITIONS = [
  { id: "sun", label: "Despejado", glyph: "sun" },
  { id: "partly", label: "Parcialmente nublado", glyph: "cloud-sun" },
  { id: "cloud", label: "Nublado", glyph: "cloud" },
  { id: "rain", label: "Lluvia", glyph: "cloud-rain" },
]

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

function forecast(city) {
  const base = 14 + Math.round(seeded(city) * 12)
  const days = Array.from({ length: 7 }, (_, index) => {
    const noise = seeded(`${city}-${index}`)
    const hi = base + Math.round(noise * 9)
    const lo = hi - 5 - Math.round(seeded(`${city}-lo-${index}`) * 5)
    return {
      index,
      hi,
      lo,
      condition: CONDITIONS[Math.floor(seeded(`${city}-c-${index}`) * CONDITIONS.length)],
    }
  })
  const hours = Array.from({ length: 12 }, (_, index) => {
    const hour = (new Date().getHours() + index) % 24
    const noise = seeded(`${city}-h-${index}`)
    return {
      hour,
      temp: days[0].lo + Math.round(noise * (days[0].hi - days[0].lo)),
      condition: CONDITIONS[Math.floor(seeded(`${city}-hc-${index}`) * CONDITIONS.length)],
    }
  })
  return {
    city,
    now: hours[0].temp,
    condition: days[0].condition,
    hi: days[0].hi,
    lo: days[0].lo,
    days,
    hours,
    humidity: 40 + Math.round(seeded(`${city}-hum`) * 45),
    wind: 4 + Math.round(seeded(`${city}-wind`) * 22),
    uv: Math.round(seeded(`${city}-uv`) * 9),
    feels: hours[0].temp + (seeded(`${city}-feel`) > 0.5 ? 1 : -1),
    visibility: 6 + Math.round(seeded(`${city}-vis`) * 10),
  }
}

export const weather = {
  id: "weather",
  name: "Tiempo",
  tagline: "Previsión",
  icon: "cloud-sun",
  gradient: "linear-gradient(160deg,#5ac8fa 0%,#2f7fd8 60%,#1b3f7a 100%)",

  mount(root) {
    const data = forecast("Madrid")
    const today = new Date().getDay()

    const hourly = h(
      "div.weather__card",
      null,
      h(
        "div.weather__card__title",
        null,
        h("span", { html: icon("clock", { size: 14 }) }),
        `${data.condition.label} durante todo el día.`,
      ),
      h(
        "div.weather__hours",
        null,
        ...data.hours.map((entry, index) =>
          h(
            "div.weather__hour",
            null,
            h("span", { text: index === 0 ? "Ahora" : `${entry.hour}` }),
            h("span", { html: icon(entry.condition.glyph, { size: 24 }) }),
            h("b", { text: `${entry.temp}°` }),
          ),
        ),
      ),
    )

    const allLows = Math.min(...data.days.map((day) => day.lo))
    const allHighs = Math.max(...data.days.map((day) => day.hi))
    const span = Math.max(1, allHighs - allLows)

    const daily = h(
      "div.weather__card",
      null,
      h(
        "div.weather__card__title",
        null,
        h("span", { html: icon("calendar", { size: 14 }) }),
        "Previsión para 7 días",
      ),
      ...data.days.map((day, index) =>
        h(
          "div.weather__day",
          null,
          h("span.weather__day__name", { text: index === 0 ? "Hoy" : DAYS[(today + index) % 7] }),
          h("span", { html: icon(day.condition.glyph, { size: 24 }) }),
          h("span.weather__day__lo", { text: `${day.lo}°` }),
          h(
            "span.weather__bar",
            null,
            h("span", {
              style: {
                left: `${((day.lo - allLows) / span) * 100}%`,
                right: `${((allHighs - day.hi) / span) * 100}%`,
              },
            }),
          ),
          h("span.weather__day__hi", { text: `${day.hi}°` }),
        ),
      ),
    )

    const tile = (label, value, note, glyph) =>
      h(
        "div.weather__tile",
        null,
        h("b", null, h("span", { html: icon(glyph, { size: 12 }), style: { display: "inline-block", verticalAlign: "-2px", marginRight: "4px" } }), label),
        h("strong", { text: value }),
        note ? h("p", { text: note }) : null,
      )

    const body = h(
      "div.app__body.weather__body",
      null,
      h(
        "div.weather__hero",
        null,
        h("div.weather__city", { text: data.city }),
        h("div.weather__temp", { text: `${data.now}°` }),
        h("div.weather__cond", { text: data.condition.label }),
        h("div.weather__range", { text: `Máx.: ${data.hi}°   Mín.: ${data.lo}°` }),
      ),
      hourly,
      daily,
      h(
        "div.weather__grid",
        null,
        tile("Sensación", `${data.feels}°`, "Similar a la temperatura real.", "thermometer"),
        tile("Humedad", `${data.humidity}%`, "Punto de rocío moderado.", "drop"),
        tile("Viento", `${data.wind} km/h`, "Ráfagas suaves del noroeste.", "wind"),
        tile("Índice UV", String(data.uv), data.uv > 5 ? "Usa protección solar." : "Bajo todo el día.", "sun"),
        tile("Visibilidad", `${data.visibility} km`, "Aire despejado.", "eye"),
        tile("Amanecer", "07:24", "Atardecer a las 21:36.", "sunrise"),
      ),
    )

    fill(root, body)
    root.classList.add("weather")
    return {}
  },
}

export default weather
