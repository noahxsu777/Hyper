/**
 * Photos.
 *
 * There are no image files in this project on purpose — every "photo" is a
 * generated gradient, so the OS stays a single self-contained bundle.
 */

import { fill, h, seeded } from "../core/dom.js"
import { icon } from "../core/icons.js"
import { action, screen, tabBar } from "../ui/kit.js"

const PALETTES = [
  ["#ff9a9e", "#fad0c4", "#fbc2eb"],
  ["#a1c4fd", "#c2e9fb", "#e2ebf0"],
  ["#fbc7d4", "#9796f0", "#4a47a3"],
  ["#f6d365", "#fda085", "#f76b1c"],
  ["#84fab0", "#8fd3f4", "#3a7bd5"],
  ["#30cfd0", "#330867", "#1a1a40"],
  ["#ffecd2", "#fcb69f", "#e96443"],
  ["#5ee7df", "#b490ca", "#6a11cb"],
  ["#c79081", "#dfa579", "#8e5b3a"],
]

const ALBUMS = [
  { id: "recents", name: "Recientes", count: 36 },
  { id: "favorites", name: "Favoritos", count: 9 },
  { id: "travel", name: "Viajes", count: 18 },
  { id: "screenshots", name: "Capturas", count: 12 },
]

function makePhotos(count, seedPrefix) {
  return Array.from({ length: count }, (_, index) => {
    const seed = `${seedPrefix}-${index}`
    const palette = PALETTES[Math.floor(seeded(seed) * PALETTES.length)]
    const angle = Math.round(seeded(`${seed}-a`) * 360)
    return {
      id: seed,
      css: `linear-gradient(${angle}deg, ${palette[0]} 0%, ${palette[1]} 50%, ${palette[2]} 100%)`,
      date: new Date(Date.now() - index * 86400000 * 1.7),
      favorite: seeded(`${seed}-f`) > 0.75,
    }
  })
}

export const photos = {
  id: "photos",
  name: "Fotos",
  tagline: "Biblioteca",
  icon: "photo",
  gradient: "linear-gradient(160deg,#fff 0%,#ffe9a8 30%,#ff8fb1 65%,#8ecbff 100%)",

  mount(root, ctx) {
    const library = makePhotos(36, "library")
    let tab = "library"
    const host = h("div.app__body")

    function openViewer(photo, index) {
      const canvas = h("div.photo-viewer__canvas", null, h("div", { style: { background: photo.css } }))
      const viewer = h(
        "div.photo-viewer",
        null,
        h(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "calc(var(--safe-top) - 4px) 16px 6px",
            },
          },
          h("button.navbar__action", {
            type: "button",
            html: icon("back", { size: 20 }),
            onClick: () => viewer.remove(),
          }),
          h("div", {
            text: photo.date.toLocaleDateString("es-ES", { day: "numeric", month: "long" }),
            style: { fontSize: "13px", fontWeight: "600" },
          }),
          h("span", { style: { width: "40px" } }),
        ),
        canvas,
        h(
          "div.photo-viewer__bar",
          null,
          h("button", {
            type: "button",
            "aria-label": "Compartir",
            html: icon("share", { size: 23 }),
            onClick: () => ctx.toast({ title: "Compartir", text: "Foto copiada", glyph: "share" }),
          }),
          h("button", {
            type: "button",
            "aria-label": "Favorito",
            html: icon("heart", { size: 23 }),
            onClick: (event) => {
              photo.favorite = !photo.favorite
              event.currentTarget.style.color = photo.favorite ? "var(--red)" : "var(--tint)"
            },
            style: { color: photo.favorite ? "var(--red)" : "var(--tint)" },
          }),
          h("button", {
            type: "button",
            "aria-label": "Información",
            html: icon("info", { size: 23 }),
            onClick: () =>
              ctx.toast({
                title: `Foto ${index + 1} de ${library.length}`,
                text: photo.date.toLocaleString("es-ES"),
                glyph: "photo",
              }),
          }),
          h("button", {
            type: "button",
            "aria-label": "Eliminar",
            html: icon("trash", { size: 23 }),
            onClick: () => {
              viewer.remove()
              ctx.toast({ title: "Eliminada", text: "Movida a Eliminados", glyph: "trash", color: "var(--red)" })
            },
          }),
        ),
      )
      root.append(viewer)
    }

    function renderLibrary() {
      return h(
        "div.photo-grid",
        null,
        ...library.map((photo, index) =>
          h(
            "button",
            { type: "button", onClick: () => openViewer(photo, index) },
            h("span", { style: { background: photo.css } }),
          ),
        ),
      )
    }

    function renderAlbums() {
      return h(
        "div",
        { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", padding: "0 16px 24px" } },
        ...ALBUMS.map((album) => {
          const cover = makePhotos(1, album.id)[0]
          return h(
            "button",
            {
              type: "button",
              style: { textAlign: "left" },
              onClick: () => {
                tab = "library"
                renderTab()
              },
            },
            h("span", {
              style: {
                display: "block",
                aspectRatio: "1",
                borderRadius: "10px",
                background: cover.css,
                marginBottom: "6px",
              },
            }),
            h("span", { text: album.name, style: { display: "block", fontSize: "15px" } }),
            h("span", {
              text: String(album.count),
              style: { display: "block", fontSize: "13px", color: "var(--label-2)" },
            }),
          )
        }),
      )
    }

    function renderFavorites() {
      const favorites = library.filter((photo) => photo.favorite)
      return h(
        "div.photo-grid",
        null,
        ...favorites.map((photo, index) =>
          h(
            "button",
            { type: "button", onClick: () => openViewer(photo, index) },
            h("span", { style: { background: photo.css } }),
          ),
        ),
      )
    }

    function renderTab() {
      const views = { library: renderLibrary, albums: renderAlbums, favorites: renderFavorites }
      fill(host, views[tab]())
      header.setTitle({ library: "Biblioteca", albums: "Álbumes", favorites: "Favoritos" }[tab])
    }

    const tabs = tabBar(
      [
        { id: "library", label: "Biblioteca", glyph: "photo" },
        { id: "albums", label: "Álbumes", glyph: "files" },
        { id: "favorites", label: "Favoritos", glyph: "heart" },
      ],
      tab,
      (next) => {
        tab = next
        renderTab()
      },
    )

    const header = screen({
      title: "Biblioteca",
      right: action("Seleccionar", () => ctx.toast({ title: "Seleccionar", text: "No implementado" }), {
        side: "right",
      }),
    })

    fill(root, header.navbar, host, tabs)
    host.addEventListener("scroll", () => {
      header.navbar.dataset.scrolled = String(host.scrollTop > 14)
    })
    renderTab()

    return {}
  },
}

export default photos
