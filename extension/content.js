/**
 * The bridge. The page script (page.js, MAIN world) can reach Netflix's
 * player but not the extension; this isolated script can reach the extension
 * but not the player. They talk through postMessage, and nothing else.
 */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.cmd === "apply") {
    window.postMessage(
      { __watchparty: "apply", activity: msg.activity, control: msg.control, at: msg.at },
      "*",
    )
  }
})

window.addEventListener("message", (event) => {
  if (event.source !== window) return
  const data = event.data
  if (data?.__watchparty === "hello") {
    chrome.runtime.sendMessage({ cmd: "hello" }).catch(() => {})
  }
  if (data?.__watchparty === "report") {
    chrome.runtime
      .sendMessage({ cmd: "report", playing: data.playing, position: data.position })
      .catch(() => {})
  }
})
