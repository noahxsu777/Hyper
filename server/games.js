/**
 * The board games, rules included.
 *
 * The rules live here, on the server, and nowhere else. A move arrives as an
 * intention ("from 12 to 21"), gets validated against the real state, and only
 * then does the room hear about it. The alternative — clients agreeing among
 * themselves — works right up until one browser lies, and then everyone's
 * board is wrong forever.
 *
 * Every game speaks the same tiny interface:
 *   create()              → fresh state
 *   move(state, seat, m)  → { ok: true, state } | { ok: false, error }
 *
 * Seats are "p1" and "p2". State is plain JSON, safe to broadcast: boards,
 * turns and winners, never identities.
 */

/* ------------------------------------------------------------ shared bits */

const other = (seat) => (seat === "p1" ? "p2" : "p1")

/** Wrong-turn and game-over guards, identical for every game. */
function guard(state, seat) {
  if (state.winner || state.over) return "La partida ya ha terminado."
  if (state.turn !== seat) return "No es tu turno."
  return null
}

/* ---------------------------------------------------------- tres en raya */

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

const ttt = {
  create: () => ({ board: Array(9).fill(null), turn: "p1", winner: null }),

  move(state, seat, { cell }) {
    const bad = guard(state, seat)
    if (bad) return { ok: false, error: bad }
    const i = Number(cell)
    if (!Number.isInteger(i) || i < 0 || i > 8) return { ok: false, error: "Casilla inválida." }
    if (state.board[i]) return { ok: false, error: "Esa casilla está ocupada." }

    const board = [...state.board]
    board[i] = seat
    const won = TTT_LINES.some((line) => line.every((c) => board[c] === seat))
    const full = board.every(Boolean)
    return {
      ok: true,
      state: { board, turn: other(seat), winner: won ? seat : full ? "draw" : null, line: won ? TTT_LINES.find((l) => l.every((c) => board[c] === seat)) : null },
    }
  },
}

/* --------------------------------------------------------- cuatro en raya */

const C4_COLS = 7
const C4_ROWS = 6
const c4At = (board, r, c) => board[r * C4_COLS + c]

function c4Wins(board, seat) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      if (c4At(board, r, c) !== seat) continue
      for (const [dr, dc] of dirs) {
        let run = 1
        while (
          run < 4 &&
          r + dr * run >= 0 && r + dr * run < C4_ROWS &&
          c + dc * run >= 0 && c + dc * run < C4_COLS &&
          c4At(board, r + dr * run, c + dc * run) === seat
        ) run++
        if (run === 4) return true
      }
    }
  }
  return false
}

const c4 = {
  create: () => ({ board: Array(C4_COLS * C4_ROWS).fill(null), turn: "p1", winner: null }),

  move(state, seat, { col }) {
    const bad = guard(state, seat)
    if (bad) return { ok: false, error: bad }
    const c = Number(col)
    if (!Number.isInteger(c) || c < 0 || c >= C4_COLS) return { ok: false, error: "Columna inválida." }

    // The disc falls: highest row index is the bottom of the board.
    let row = -1
    for (let r = C4_ROWS - 1; r >= 0; r--) {
      if (!c4At(state.board, r, c)) { row = r; break }
    }
    if (row === -1) return { ok: false, error: "Esa columna está llena." }

    const board = [...state.board]
    board[row * C4_COLS + c] = seat
    const won = c4Wins(board, seat)
    const full = board.every(Boolean)
    return { ok: true, state: { board, turn: other(seat), winner: won ? seat : full ? "draw" : null } }
  },
}

/* ------------------------------------------------------------------ damas */
/*
 * English rules, because they are the ones everyone half-remembers the same
 * way: men move and capture one diagonal step forward, kings one step in any
 * diagonal, captures are mandatory, and a capture chain continues with the
 * same piece until it runs dry. Crowning ends the move.
 *
 * p1 starts at the bottom (rows 5-7) moving up; p2 mirrors it.
 */

const D_SIZE = 8
const dRC = (i) => [Math.floor(i / D_SIZE), i % D_SIZE]
const dIX = (r, c) => r * D_SIZE + c
const dOn = (r, c) => r >= 0 && r < D_SIZE && c >= 0 && c < D_SIZE
const dMine = (piece, seat) => piece && piece.startsWith(seat === "p1" ? "1" : "2")
const dDirs = (piece, seat) =>
  piece.endsWith("k")
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : seat === "p1"
      ? [[-1, -1], [-1, 1]]
      : [[1, -1], [1, 1]]

/** Every capture available to one piece, or to a whole seat. */
function dJumps(board, seat, only = null) {
  const jumps = []
  for (let i = 0; i < board.length; i++) {
    if (only !== null && i !== only) continue
    const piece = board[i]
    if (!dMine(piece, seat)) continue
    const [r, c] = dRC(i)
    for (const [dr, dc] of dDirs(piece, seat)) {
      const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc
      if (!dOn(tr, tc) || board[dIX(tr, tc)]) continue
      const mid = board[dIX(mr, mc)]
      if (mid && !dMine(mid, seat)) jumps.push({ from: i, to: dIX(tr, tc), over: dIX(mr, mc) })
    }
  }
  return jumps
}

function dSteps(board, seat) {
  const steps = []
  for (let i = 0; i < board.length; i++) {
    const piece = board[i]
    if (!dMine(piece, seat)) continue
    const [r, c] = dRC(i)
    for (const [dr, dc] of dDirs(piece, seat)) {
      const tr = r + dr, tc = c + dc
      if (dOn(tr, tc) && !board[dIX(tr, tc)]) steps.push({ from: i, to: dIX(tr, tc) })
    }
  }
  return steps
}

const damas = {
  create() {
    const board = Array(64).fill(null)
    for (let i = 0; i < 64; i++) {
      const [r, c] = dRC(i)
      if ((r + c) % 2 !== 1) continue
      if (r < 3) board[i] = "2"
      if (r > 4) board[i] = "1"
    }
    return { board, turn: "p1", winner: null, chain: null }
  },

  move(state, seat, { from, to }) {
    const bad = guard(state, seat)
    if (bad) return { ok: false, error: bad }
    const f = Number(from), t = Number(to)
    if (!Number.isInteger(f) || !Number.isInteger(t) || f < 0 || f > 63 || t < 0 || t > 63) {
      return { ok: false, error: "Movimiento inválido." }
    }
    if (!dMine(state.board[f], seat)) return { ok: false, error: "Esa pieza no es tuya." }

    // Mid-chain, the only legal move is the next jump of the same piece.
    const jumps = dJumps(state.board, seat, state.chain)
    const jump = jumps.find((j) => j.from === f && j.to === t)

    if (!jump) {
      if (state.chain !== null) return { ok: false, error: "Tienes que seguir capturando con la misma pieza." }
      if (jumps.length) return { ok: false, error: "Hay captura obligatoria." }
      const step = dSteps(state.board, seat).find((s) => s.from === f && s.to === t)
      if (!step) return { ok: false, error: "Ese movimiento no vale." }
    }

    const board = [...state.board]
    let piece = board[f]
    board[f] = null
    if (jump) board[jump.over] = null

    // Crowning: reaching the far row makes a king and ends the move.
    const [tr] = dRC(t)
    const crowns = !piece.endsWith("k") && ((seat === "p1" && tr === 0) || (seat === "p2" && tr === 7))
    if (crowns) piece += "k"
    board[t] = piece

    let turn = other(seat)
    let chain = null
    if (jump && !crowns && dJumps(board, seat, t).length) {
      turn = seat
      chain = t
    }

    // The other side loses when nothing is left to do.
    let winner = null
    if (turn !== seat) {
      const theyCanMove = dJumps(board, turn).length || dSteps(board, turn).length
      if (!theyCanMove) winner = seat
    }

    return { ok: true, state: { board, turn, winner, chain } }
  },
}

/* ----------------------------------------------------------------- ajedrez */
/*
 * Full legality: sliding pieces, castling (not out of, through or into
 * check), en passant, promotion (queen unless told otherwise), and mate and
 * stalemate detection. p1 is white, at the bottom, and row 0 is black's home
 * rank. No clocks and no repetition rules — for that there is the reset
 * button and the chat.
 */

const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const xRC = (i) => [i >> 3, i & 7]
const xIX = (r, c) => r * 8 + c
const xOn = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8

function attacked(board, i, by) {
  const [r, c] = xRC(i)
  for (const [dr, dc] of KN) {
    if (xOn(r + dr, c + dc) && board[xIX(r + dr, c + dc)] === by + "N") return true
  }
  for (const [dr, dc] of [...ORTH, ...DIAG]) {
    if (xOn(r + dr, c + dc) && board[xIX(r + dr, c + dc)] === by + "K") return true
  }
  // A white pawn attacks the two squares above it, so the square is attacked
  // from below (higher row index); black mirrors it.
  const pr = by === "w" ? r + 1 : r - 1
  for (const dc of [-1, 1]) {
    if (xOn(pr, c + dc) && board[xIX(pr, c + dc)] === by + "P") return true
  }
  for (const [dirs, kinds] of [[ORTH, "RQ"], [DIAG, "BQ"]]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc
      while (xOn(rr, cc)) {
        const piece = board[xIX(rr, cc)]
        if (piece) {
          if (piece[0] === by && kinds.includes(piece[1])) return true
          break
        }
        rr += dr; cc += dc
      }
    }
  }
  return false
}

const kingOf = (board, color) => board.indexOf(color + "K")

/** Pseudo-legal moves for the piece on square i. */
function pieceMoves(state, i) {
  const { board } = state
  const piece = board[i]
  const color = piece[0]
  const [r, c] = xRC(i)
  const moves = []
  const push = (to, extra = {}) => moves.push({ from: i, to, ...extra })

  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc
      while (xOn(rr, cc)) {
        const target = board[xIX(rr, cc)]
        if (!target) push(xIX(rr, cc))
        else {
          if (target[0] !== color) push(xIX(rr, cc))
          break
        }
        rr += dr; cc += dc
      }
    }
  }

  switch (piece[1]) {
    case "P": {
      const dir = color === "w" ? -1 : 1
      const home = color === "w" ? 6 : 1
      const last = color === "w" ? 0 : 7
      const step = (to) => (xRC(to)[0] === last ? push(to, { promo: true }) : push(to))
      if (xOn(r + dir, c) && !board[xIX(r + dir, c)]) {
        step(xIX(r + dir, c))
        if (r === home && !board[xIX(r + 2 * dir, c)]) push(xIX(r + 2 * dir, c), { double: true })
      }
      for (const dc of [-1, 1]) {
        if (!xOn(r + dir, c + dc)) continue
        const to = xIX(r + dir, c + dc)
        const target = board[to]
        if (target && target[0] !== color) step(to)
        else if (to === state.ep) push(to, { ep: true })
      }
      break
    }
    case "N":
      for (const [dr, dc] of KN) {
        if (!xOn(r + dr, c + dc)) continue
        const target = board[xIX(r + dr, c + dc)]
        if (!target || target[0] !== color) push(xIX(r + dr, c + dc))
      }
      break
    case "B": slide(DIAG); break
    case "R": slide(ORTH); break
    case "Q": slide([...ORTH, ...DIAG]); break
    case "K": {
      for (const [dr, dc] of [...ORTH, ...DIAG]) {
        if (!xOn(r + dr, c + dc)) continue
        const target = board[xIX(r + dr, c + dc)]
        if (!target || target[0] !== color) push(xIX(r + dr, c + dc))
      }
      // Castling: rights intact, path empty, and the king never touches an
      // attacked square on the way.
      const home = color === "w" ? 7 : 0
      const enemy = color === "w" ? "b" : "w"
      if (r === home && c === 4 && !attacked(board, i, enemy)) {
        const rights = state.castle
        if (rights[color + "K"] && !board[xIX(home, 5)] && !board[xIX(home, 6)] &&
            board[xIX(home, 7)] === color + "R" &&
            !attacked(board, xIX(home, 5), enemy) && !attacked(board, xIX(home, 6), enemy)) {
          push(xIX(home, 6), { castle: "K" })
        }
        if (rights[color + "Q"] && !board[xIX(home, 3)] && !board[xIX(home, 2)] && !board[xIX(home, 1)] &&
            board[xIX(home, 0)] === color + "R" &&
            !attacked(board, xIX(home, 3), enemy) && !attacked(board, xIX(home, 2), enemy)) {
          push(xIX(home, 2), { castle: "Q" })
        }
      }
      break
    }
  }
  return moves
}

/** Apply without asking questions; legality was someone else's job. */
function applyMove(state, move, promo = "Q") {
  const board = [...state.board]
  const piece = board[move.from]
  const color = piece[0]
  const castle = { ...state.castle }

  board[move.from] = null
  board[move.to] = piece

  if (move.ep) {
    // The captured pawn is beside the destination, not on it.
    const [, tc] = xRC(move.to)
    const [fr] = xRC(move.from)
    board[xIX(fr, tc)] = null
  }
  if (move.castle) {
    const home = color === "w" ? 7 : 0
    if (move.castle === "K") { board[xIX(home, 5)] = board[xIX(home, 7)]; board[xIX(home, 7)] = null }
    else { board[xIX(home, 3)] = board[xIX(home, 0)]; board[xIX(home, 0)] = null }
  }
  if (move.promo) board[move.to] = color + promo

  // Moving a king or rook — or capturing a rook at home — spends the rights.
  if (piece[1] === "K") { castle[color + "K"] = false; castle[color + "Q"] = false }
  for (const [sq, right] of [[xIX(7, 0), "wQ"], [xIX(7, 7), "wK"], [xIX(0, 0), "bQ"], [xIX(0, 7), "bK"]]) {
    if (move.from === sq || move.to === sq) castle[right] = false
  }

  const ep = move.double ? (move.from + move.to) / 2 : null
  return { board, turn: color === "w" ? "b" : "w", castle, ep }
}

function legalMoves(state, color) {
  const enemy = color === "w" ? "b" : "w"
  const moves = []
  for (let i = 0; i < 64; i++) {
    if (!state.board[i] || state.board[i][0] !== color) continue
    for (const move of pieceMoves(state, i)) {
      const next = applyMove(state, move)
      if (!attacked(next.board, kingOf(next.board, color), enemy)) moves.push(move)
    }
  }
  return moves
}

const chess = {
  create() {
    const board = Array(64).fill(null)
    const back = ["R", "N", "B", "Q", "K", "B", "N", "R"]
    back.forEach((p, c) => {
      board[xIX(0, c)] = "b" + p
      board[xIX(7, c)] = "w" + p
      board[xIX(1, c)] = "bP"
      board[xIX(6, c)] = "wP"
    })
    return {
      board, turn: "p1", winner: null, over: null, check: false,
      castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: null,
    }
  },

  move(state, seat, { from, to, promo }) {
    const bad = guard(state, seat)
    if (bad) return { ok: false, error: bad }
    const color = seat === "p1" ? "w" : "b"
    const f = Number(from), t = Number(to)

    const inner = { ...state, turn: color }
    const move = legalMoves(inner, color).find((m) => m.from === f && m.to === t)
    if (!move) {
      if (state.board[f]?.[0] !== color) return { ok: false, error: "Esa pieza no es tuya." }
      return { ok: false, error: state.check ? "Tu rey está en jaque." : "Ese movimiento no es legal." }
    }

    const wanted = String(promo ?? "Q").toUpperCase()
    const next = applyMove(inner, move, ["Q", "R", "B", "N"].includes(wanted) ? wanted : "Q")

    const enemyColor = next.turn
    const enemyState = { ...state, board: next.board, castle: next.castle, ep: next.ep, turn: enemyColor }
    const check = attacked(next.board, kingOf(next.board, enemyColor), color)
    const stuck = legalMoves(enemyState, enemyColor).length === 0

    return {
      ok: true,
      state: {
        board: next.board,
        castle: next.castle,
        ep: next.ep,
        check,
        turn: other(seat),
        winner: stuck && check ? seat : stuck ? "draw" : null,
        over: stuck ? (check ? "mate" : "stalemate") : null,
      },
    }
  },

  // Exposed for tests: the whole point of chess is the rules.
  _legalMoves: legalMoves,
  _applyMove: applyMove,
}

/* ------------------------------------------------------------------ export */

export const GAMES = { ttt, c4, damas, chess }
