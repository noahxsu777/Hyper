/**
 * Pointer-based gesture helpers.
 *
 * iOS is a gesture-first OS, so the whole shell is driven by these: swipe up to
 * go home, swipe down on the home screen for Spotlight, swipe from the top-right
 * corner for Control Center.
 */

/**
 * Track a drag on `el`.
 * Handlers receive `{ dx, dy, x, y, startX, startY, duration, vx, vy, event }`.
 * Return `false` from `onStart` to ignore the gesture.
 */
export function drag(el, { onStart, onMove, onEnd, threshold = 0 } = {}) {
  let active = null

  function pointerDown(event) {
    if (event.button != null && event.button !== 0) return
    const started = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
      at: performance.now(),
      moved: false,
      event,
    }
    if (onStart && onStart(started) === false) return
    active = started
    // Deliberately no setPointerCapture: capturing retargets the follow-up
    // `click` to the capturing element, which would swallow taps on the
    // buttons inside it. Tracking on `window` keeps taps and drags working.
    window.addEventListener("pointermove", pointerMove)
    window.addEventListener("pointerup", pointerUp)
    window.addEventListener("pointercancel", pointerUp)
  }

  function pointerMove(event) {
    if (!active || event.pointerId !== active.id) return
    active.x = event.clientX
    active.y = event.clientY
    active.dx = active.x - active.startX
    active.dy = active.y - active.startY
    active.event = event
    if (!active.moved && Math.hypot(active.dx, active.dy) < threshold) return
    active.moved = true
    onMove?.(active)
  }

  function pointerUp(event) {
    if (!active || event.pointerId !== active.id) return
    const duration = Math.max(1, performance.now() - active.at)
    const detail = {
      ...active,
      duration,
      vx: active.dx / duration,
      vy: active.dy / duration,
      event,
    }
    active = null
    stopTracking()
    onEnd?.(detail)
  }

  function stopTracking() {
    window.removeEventListener("pointermove", pointerMove)
    window.removeEventListener("pointerup", pointerUp)
    window.removeEventListener("pointercancel", pointerUp)
  }

  el.addEventListener("pointerdown", pointerDown)

  return () => {
    el.removeEventListener("pointerdown", pointerDown)
    stopTracking()
    active = null
  }
}

/**
 * Recognise a directional swipe anywhere inside `el`.
 * `zone(startX, startY, rect)` decides whether a touch may begin the gesture.
 */
export function swipe(el, { direction = "up", zone, distance = 60, velocity = 0.35, onSwipe }) {
  return drag(el, {
    threshold: 6,
    onStart(detail) {
      const rect = el.getBoundingClientRect()
      const x = detail.startX - rect.left
      const y = detail.startY - rect.top
      if (zone && !zone(x, y, rect)) return false
      return true
    },
    onEnd(detail) {
      const { dx, dy, vx, vy } = detail
      const passes =
        {
          up: () => -dy > distance || -vy > velocity,
          down: () => dy > distance || vy > velocity,
          left: () => -dx > distance || -vx > velocity,
          right: () => dx > distance || vx > velocity,
        }[direction]?.() ?? false

      const dominant =
        direction === "up" || direction === "down"
          ? Math.abs(dy) > Math.abs(dx)
          : Math.abs(dx) > Math.abs(dy)

      if (passes && dominant) onSwipe?.(detail)
    },
  })
}
