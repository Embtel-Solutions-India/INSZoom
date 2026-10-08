import { useCallback, useEffect, useRef, useState } from 'react'
import { ghlApi } from '../services/api'
import { useSocket } from '../contexts/SocketContext'

// State for the GoHighLevel pipeline board.
//
// Moves are OPTIMISTIC: the card changes column in local state the instant it is
// dropped, and the request to OUR backend runs in the background. The backend
// (not this hook) pushes the change to GHL, retrying on its own, so nothing about
// GHL ever reaches the UI as an error and a slow GHL can never hold the board.
//
// Only a failed request to our own backend rolls a card back.

const REFRESH_DEBOUNCE_MS = 250
const SAFETY_REFRESH_MS = 60_000 // heals any missed socket event; only runs when the board is idle

const newMoveId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const errorMessage = (error) =>
  error?.response?.data?.message || error?.userMessage || error?.message || 'Something went wrong'

export default function usePipelineBoard() {
  const { subscribe, connected } = useSocket()
  const [columns, setColumns] = useState([])
  const [status, setStatus] = useState({ loading: true, error: null, disabled: false, configured: true })
  const [notice, setNotice] = useState(null)

  const columnsRef = useRef([])
  const confirmedRef = useRef(new Map()) // cardId -> stage key the server last confirmed
  const latestRef = useRef(new Map()) // cardId -> { seq, to } — the most recent local intent
  const queueRef = useRef(new Map()) // cardId -> promise chain (one request at a time per card)
  const ownMoveIds = useRef(new Set())
  const inFlight = useRef(0)
  const dragging = useRef(false)
  const dirty = useRef(false)
  const fetchSeq = useRef(0)
  const seqCounter = useRef(0)
  const refreshTimer = useRef(null)
  const noticeTimer = useRef(null)
  const mounted = useRef(true)

  const commit = useCallback((next) => {
    columnsRef.current = next
    setColumns(next)
  }, [])

  const notify = useCallback((type, text) => {
    setNotice({ type, text })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 6000)
  }, [])

  const rememberConfirmed = (cols) => {
    const map = new Map()
    cols.forEach((col) => col.cards.forEach((card) => map.set(card._id, col.key)))
    confirmedRef.current = map
  }

  const refresh = useCallback(async ({ silent = false } = {}) => {
    const seq = ++fetchSeq.current
    if (!silent) setStatus((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await ghlApi.board()
      if (!mounted.current || seq !== fetchSeq.current) return
      const data = res.data || {}
      const cols = data.columns || []
      rememberConfirmed(cols)
      commit(cols)
      setStatus({ loading: false, error: null, disabled: false, configured: data.configured !== false })
    } catch (error) {
      if (!mounted.current || seq !== fetchSeq.current) return
      if (error?.response?.status === 503) {
        setStatus({ loading: false, error: null, disabled: true, configured: false })
        return
      }
      // Keep showing the last good board on a transient failure.
      setStatus((s) => ({ ...s, loading: false, error: columnsRef.current.length ? null : errorMessage(error) }))
    }
  }, [commit])

  const idleCheck = useCallback(() => {
    if (inFlight.current === 0 && !dragging.current && dirty.current) {
      dirty.current = false
      refresh({ silent: true })
    }
  }, [refresh])

  // Refresh requests that arrive mid-drag or mid-move are deferred until idle, so
  // a server snapshot can never yank a card out from under the user.
  const requestRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      if (dragging.current || inFlight.current > 0) {
        dirty.current = true
        return
      }
      refresh({ silent: true })
    }, REFRESH_DEBOUNCE_MS)
  }, [refresh])

  const setDragging = useCallback((flag) => {
    dragging.current = flag
    if (!flag) idleCheck()
  }, [idleCheck])

  const relocate = (cols, cardId, toKey, patch) => {
    let moved = null
    const without = cols.map((col) => {
      const found = col.cards.find((c) => c._id === cardId)
      if (!found) return col
      moved = { ...found, ...patch }
      return { ...col, total: Math.max(0, col.total - 1), cards: col.cards.filter((c) => c._id !== cardId) }
    })
    if (!moved) return cols
    return without.map((col) => (col.key === toKey ? { ...col, total: col.total + 1, cards: [{ ...moved, unifiedStageKey: toKey }, ...col.cards] } : col))
  }

  const patchCard = (cardId, patch) =>
    commit(columnsRef.current.map((col) => (col.cards.some((c) => c._id === cardId) ? { ...col, cards: col.cards.map((c) => (c._id === cardId ? { ...c, ...patch } : c)) } : col)))

  const moveCard = useCallback((cardId, toKey) => {
    const from = columnsRef.current.find((col) => col.cards.some((c) => c._id === cardId))
    if (!from || from.key === toKey || !columnsRef.current.some((col) => col.key === toKey)) return

    const seq = ++seqCounter.current
    latestRef.current.set(cardId, { seq, to: toKey })
    const moveId = newMoveId()
    ownMoveIds.current.add(moveId)
    setTimeout(() => ownMoveIds.current.delete(moveId), 60_000)

    // 1. Instant: the card is already in its new column before any network call.
    commit(relocate(columnsRef.current, cardId, toKey))

    // 2. Background: one request at a time per card, and a move that was already
    // overtaken by a newer drop of the same card is never even sent (last drop wins).
    inFlight.current += 1
    const previous = queueRef.current.get(cardId) || Promise.resolve()
    const task = previous.then(async () => {
      try {
        if (latestRef.current.get(cardId)?.seq !== seq) return
        if (confirmedRef.current.get(cardId) === toKey) return // dragged back to where the server already has it
        const res = await ghlApi.moveStage(cardId, { unifiedStageKey: toKey, moveId })
        confirmedRef.current.set(cardId, toKey)
        const syncStatus = res.data?.card?.syncStatus
        if (syncStatus) patchCard(cardId, { syncStatus })
      } catch (error) {
        // Our own backend refused or was unreachable. (GHL problems never land here:
        // the backend accepts the move and retries GHL by itself.)
        dirty.current = true
        if (latestRef.current.get(cardId)?.seq === seq) {
          const back = confirmedRef.current.get(cardId)
          if (back) commit(relocate(columnsRef.current, cardId, back))
          notify('error', `Couldn't move the case: ${errorMessage(error)}`)
        }
      } finally {
        inFlight.current -= 1
        idleCheck()
      }
    })
    queueRef.current.set(cardId, task.catch(() => {}))
  }, [commit, idleCheck, notify])

  const loadMore = useCallback(async (columnKey) => {
    const col = columnsRef.current.find((c) => c.key === columnKey)
    if (!col || !col.hasMore) return
    try {
      const res = await ghlApi.board({ column: columnKey, skip: col.cards.length })
      const incoming = res.data?.columns?.[0]
      if (!incoming) return
      const have = new Set(columnsRef.current.flatMap((c) => c.cards.map((card) => card._id)))
      const fresh = incoming.cards.filter((card) => !have.has(card._id))
      fresh.forEach((card) => confirmedRef.current.set(card._id, columnKey))
      commit(columnsRef.current.map((c) => (c.key === columnKey ? { ...c, cards: [...c.cards, ...fresh], total: incoming.total, hasMore: incoming.hasMore } : c)))
    } catch (error) {
      notify('error', `Couldn't load more cases: ${errorMessage(error)}`)
    }
  }, [commit, notify])

  // Initial load, plus a slow safety refresh that heals any missed event.
  useEffect(() => {
    mounted.current = true
    refresh()
    const safety = setInterval(requestRefresh, SAFETY_REFRESH_MS)
    return () => {
      mounted.current = false
      clearInterval(safety)
      clearTimeout(refreshTimer.current)
      clearTimeout(noticeTimer.current)
    }
  }, [refresh, requestRefresh])

  // Live updates. Every event funnels into one debounced, idle-aware refresh.
  // `subscribe` silently does nothing until the socket exists, and on a hard
  // refresh this page's effects run before the provider creates it — so we
  // (re)subscribe whenever `connected` changes instead of only once at mount.
  useEffect(() => {
    const onPipeline = (payload) => {
      if (payload?.moveId && ownMoveIds.current.has(payload.moveId)) return // echo of our own move
      requestRefresh()
    }
    const unsubs = [
      subscribe('ghl:pipeline:updated', onPipeline),
      subscribe('case:assigned', requestRefresh), // a case newly assigned to (or taken from) this person
      subscribe('case:unassigned', requestRefresh),
      subscribe('case:created', requestRefresh),
    ]
    return () => unsubs.forEach((off) => typeof off === 'function' && off())
  }, [subscribe, connected, requestRefresh])

  // After a socket reconnect we may have missed events.
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) requestRefresh()
    wasConnected.current = connected
  }, [connected, requestRefresh])

  return { columns, status, notice, dismissNotice: () => setNotice(null), moveCard, loadMore, refresh, setDragging, connected }
}
