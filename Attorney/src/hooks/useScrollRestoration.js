import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// Scroll position for the whole page (the document scrolls; <main> is not a
// scroll container). Two jobs:
//   1. Going BACK to a list (browser back/forward, or a "Back to …" button that
//      links to the parent list) returns to the exact position you left, then
//      STOPS - it keeps nudging only until the data has rendered tall enough,
//      and gives up the moment you scroll yourself.
//   2. Opening a new page starts at the top.
// The native browser restoration is turned off so the two never fight.

const MAX_WAIT_MS = 4000
const SETTLE_MS = 250

// Scroll to `y`, waiting (briefly) for the page to become tall enough - lists
// render after their data loads, so the target may not exist yet. Returns a
// cancel function. Stops by itself once reached, or when the user scrolls.
export function restoreScrollTo(y, { onDone } = {}) {
  if (!y || y <= 0) { window.scrollTo(0, 0); onDone?.(); return () => {} }
  let frame = 0
  let cancelled = false
  let reachedAt = 0
  const started = performance.now()

  const cancelOnUser = () => { cancelled = true }
  const events = ['wheel', 'touchstart', 'keydown', 'mousedown']
  events.forEach((name) => window.addEventListener(name, cancelOnUser, { passive: true, once: true }))

  const finish = () => {
    events.forEach((name) => window.removeEventListener(name, cancelOnUser))
    onDone?.()
  }
  const tick = () => {
    if (cancelled) { finish(); return }
    const tallEnough = document.documentElement.scrollHeight >= y + window.innerHeight - 1
    if (tallEnough || performance.now() - started > MAX_WAIT_MS / 2) window.scrollTo(0, y)
    if (tallEnough && Math.abs(window.scrollY - y) <= 2) {
      reachedAt = reachedAt || performance.now()
      if (performance.now() - reachedAt > SETTLE_MS) { finish(); return } // reached and the layout stopped moving
    } else {
      reachedAt = 0
    }
    if (performance.now() - started > MAX_WAIT_MS) { finish(); return }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => { cancelled = true; cancelAnimationFrame(frame); finish() }
}

export default function useScrollRestoration() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const byEntry = useRef(new Map()) // history entry key -> scrollY (exact back/forward)
  const byPath = useRef(new Map())  // pathname+search -> scrollY (for "Back to list" links)
  const restoring = useRef(false)
  const current = useRef({ key: location.key, path: `${location.pathname}${location.search}` })
  const previousPath = useRef(null)

  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])

  // Remember where we are, except while we are ourselves moving the page.
  useEffect(() => {
    const onScroll = () => {
      if (restoring.current) return
      byEntry.current.set(current.current.key, window.scrollY)
      byPath.current.set(current.current.path, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const path = `${location.pathname}${location.search}`
    const cameFrom = previousPath.current
    current.current = { key: location.key, path }
    previousPath.current = location.pathname

    // Back/forward -> that exact entry. A normal link to a list we left from one of
    // its own pages (e.g. /crm-cases/123 -> /crm-cases) -> where we left the list.
    let target = 0
    if (navigationType === 'POP') target = byEntry.current.get(location.key) ?? 0
    else if (cameFrom && cameFrom.startsWith(`${location.pathname.replace(/\/$/, '')}/`)) target = byPath.current.get(path) ?? 0

    restoring.current = true
    const cancel = restoreScrollTo(target, { onDone: () => { restoring.current = false } })
    return () => { cancel(); restoring.current = false }
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps
}
