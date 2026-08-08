/** The little window: paste the room link, press the button, done. */

const link = document.getElementById("link")
const mando = document.getElementById("mando")
const go = document.getElementById("go")
const status = document.getElementById("status")

let connected = false

function paint(state) {
  connected = state.status === "on" || state.status === "connecting"
  go.textContent = connected ? "Desvincular" : "Vincular"
  go.className = connected ? "off" : ""
  status.dataset.tone = state.status === "error" ? "error" : state.status === "on" ? "on" : ""
  status.textContent =
    state.detail ||
    (state.status === "on" ? "Vinculado." : state.status === "connecting" ? "Conectando…" : "")
}

chrome.storage.local.get(["link", "mando"]).then((saved) => {
  if (saved.link) link.value = saved.link
  if (saved.mando) mando.value = saved.mando
})

chrome.runtime.sendMessage({ cmd: "get" }).then(paint).catch(() => {})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.cmd === "status") paint(msg)
})

go.addEventListener("click", () => {
  if (connected) {
    chrome.runtime.sendMessage({ cmd: "disconnect" }).catch(() => {})
    paint({ status: "off" })
    return
  }
  chrome.runtime
    .sendMessage({ cmd: "connect", link: link.value, mando: mando.value.trim() })
    .catch(() => {})
  paint({ status: "connecting" })
})
