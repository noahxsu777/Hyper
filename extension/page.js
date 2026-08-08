/**
 * The hands on Netflix's player. Runs in the page's own world, because
 * that is where `netflix.appContext` lives.
 *
 * It drives the player through the same internal API Netflix's UI uses —
 * the one every party extension relies on. Netflix can rename it any day;
 * when that happens this file fails quietly and the room's countdown is
 * still there.
 *
 * Times: Netflix speaks milliseconds, the room speaks seconds.
 */

function findPlayer() {
  try {
    const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer
    const sessionId = videoPlayer?.getAllPlayerSessionIds?.()?.[0]
    return sessionId ? videoPlayer.getVideoPlayerBySessionId(sessionId) : null
  } catch {
    return null
  }
}

let control = false

/* Follow the room: land on its clock, then match play/pause. */
window.addEventListener("message", (event) => {
  if (event.source !== window) return
  const data = event.data
  if (data?.__watchparty !== "apply") return

  control = Boolean(data.control)
  const activity = data.activity
  if (!activity || activity.kind !== "netflix") return
  if (control) return // the controller is the source of truth, not a follower

  const player = findPlayer()
  if (!player) return

  const age = (Date.now() - (data.at || Date.now())) / 1000
  const target = (Number(activity.position) + (activity.playing ? age : 0)) * 1000
  try {
    if (Math.abs(player.getCurrentTime() - target) > 2500) player.seek(target)
    if (activity.playing && !player.isPlaying()) player.play()
    if (!activity.playing && player.isPlaying()) player.pause()
  } catch {
    /* mid-load; the next event lands */
  }
})

/* Announce ourselves, then — if we hold the mando — report what the player
   does, so pressing play in Netflix moves the whole room. */
let previous = null
setInterval(() => {
  const player = findPlayer()
  if (!player) {
    previous = null
    return
  }
  if (previous === null) {
    window.postMessage({ __watchparty: "hello" }, "*")
    previous = { playing: player.isPlaying(), time: player.getCurrentTime(), wall: Date.now() }
    return
  }

  let playing, time
  try {
    playing = player.isPlaying()
    time = player.getCurrentTime()
  } catch {
    return
  }

  if (control) {
    const expected = previous.time + (previous.playing ? Date.now() - previous.wall : 0)
    const jumped = Math.abs(time - expected) > 2500
    if (playing !== previous.playing || jumped) {
      window.postMessage({ __watchparty: "report", playing, position: time / 1000 }, "*")
    }
  }
  previous = { playing, time, wall: Date.now() }
}, 800)
