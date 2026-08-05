/** Boot sequence: build the OS, register the apps, wire the global gestures. */

import { $, clamp } from "./core/dom.js"
import { drag } from "./core/gestures.js"
import { state } from "./core/store.js"
import { OS } from "./os.js"
import { APPS } from "./apps/registry.js"
import { mountControlCenter } from "./ui/controlcenter.js"
import { mountLockScreen } from "./ui/lockscreen.js"
import { mountSpotlight } from "./ui/spotlight.js"
import { mountSpringboard } from "./ui/springboard.js"
import { mountStatusBar } from "./ui/statusbar.js"

const device = $("#device")
const os = new OS(device)

os.register(APPS)

mountStatusBar(os)
mountLockScreen(os)
mountSpringboard(os, APPS)
mountControlCenter(os)
mountSpotlight(os, APPS)

/* --------------------------------------------------------------------------
   Home indicator: tap to go home, drag up to dismiss the running app.
   -------------------------------------------------------------------------- */

const homeIndicator = $("#homeIndicator")
const appLayer = os.appLayer

homeIndicator.addEventListener("click", () => os.goHome())
homeIndicator.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    os.goHome()
  }
})

// Dragging up from the bottom edge shrinks the app toward the home screen,
// exactly like the real swipe-up-to-close gesture.
drag(device, {
  threshold: 4,
  onStart(detail) {
    const rect = device.getBoundingClientRect()
    const fromBottomEdge = detail.startY - rect.top > rect.height - 34
    if (!fromBottomEdge || os.locked) return false
    if (!os.running && os.overlay === "none") return false
    return true
  },
  onMove(detail) {
    if (!os.running || state.reduceMotion) return
    const rect = device.getBoundingClientRect()
    const progress = clamp(-detail.dy / rect.height, 0, 1)
    appLayer.dataset.dragging = "true"
    appLayer.style.transform = `scale(${1 - progress * 0.3}) translateY(${detail.dy * 0.25}px)`
    appLayer.style.opacity = String(1 - progress * 0.35)
  },
  onEnd(detail) {
    delete appLayer.dataset.dragging
    appLayer.style.transform = ""
    appLayer.style.opacity = ""
    const dismissed = -detail.dy > 90 || -detail.vy > 0.5
    if (dismissed || !detail.moved) os.goHome()
  },
})

/* --------------------------------------------------------------------------
   Keyboard shortcuts — handy on a desktop browser.
   -------------------------------------------------------------------------- */

window.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)

  if (event.key === "Escape") {
    if (os.locked) return
    os.goHome()
    return
  }
  if (typing) return

  if (event.key === "Enter" && os.locked) os.unlock()
  if (event.key.toLowerCase() === "l" && event.metaKey) {
    event.preventDefault()
    os.lock()
  }
  if (event.key === " " && os.locked) {
    event.preventDefault()
    os.unlock()
  }
})

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

os.boot().then(() => {
  // A gentle nudge toward the one app that is doing something real.
  setTimeout(() => {
    if (!os.locked) return
    os.showIsland({ text: "Desliza para abrir", tone: "ok", duration: 3000 })
  }, 1200)
})

// Exposed for debugging from the console.
window.hyperOS = os
