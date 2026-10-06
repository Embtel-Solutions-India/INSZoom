import { createContext, useContext, useEffect, useRef } from 'react'
import { matchPath, useLocation, useOutlet, UNSAFE_LocationContext as LocationContext } from 'react-router-dom'

// Keeps the main work pages ALIVE while you move around: leaving the cases list
// for a case (or a case for the list) hides the page instead of destroying it,
// so coming back is instant - no reload, no loading spinner, same filters, same
// open tab, same scroll position. Pages not in KEEP_ALIVE_ROUTES behave exactly
// as before.
//
// - Each kept page lives under its own key (the pathname), so /crm-cases/A and
//   /crm-cases/B are separate, and both stay loaded.
// - A hidden page is given the location it last had, so it does not react to
//   navigation that happens elsewhere (its own URL params/filters stay put).
// - Bounded: at most MAX_KEPT pages, and a page not visited for MAX_HIDDEN_MS is
//   dropped (the next visit loads it fresh), so nothing stays stale forever.
// - After a page that was away for a while becomes active again, pages that
//   register with useRouteRevisit() refresh their data silently in the background.
export const KEEP_ALIVE_ROUTES = [
  '/dashboard',
  '/leads',
  '/crm-cases',
  '/crm-cases/:id',
  '/uscis-forms',
  '/form-governance',
  '/form-governance/:formCode',
  '/tasks',
  '/tasks/my-tasks',
  '/tasks/all',
  '/tasks/team-tasks',
  '/tasks/:id',
  '/case-managers',
  '/case-managers/:id',
]
const MAX_KEPT = 12
const MAX_HIDDEN_MS = 15 * 60 * 1000
const REVISIT_AFTER_MS = 20 * 1000 // away at least this long -> refresh quietly on return

const KeepAliveKeyContext = createContext(null)

const isKeepable = (pathname, routes) => routes.some((pattern) => matchPath({ path: pattern, end: true }, pathname))

export default function KeepAliveOutlet({ routes = KEEP_ALIVE_ROUTES, maxKept = MAX_KEPT, maxHiddenMs = MAX_HIDDEN_MS }) {
  const outlet = useOutlet()
  const location = useLocation()
  const locationContext = useContext(LocationContext)
  const cache = useRef(new Map()) // pathname -> { element, locationContext, hiddenAt }
  const previousKey = useRef(null)

  const key = location.pathname.replace(/\/+$/, '') || '/'
  const keepable = isKeepable(key, routes)
  const now = Date.now()

  // Drop pages that have been away too long (never the one being shown).
  for (const [entryKey, entry] of cache.current) {
    if (entryKey !== key && entry.hiddenAt && now - entry.hiddenAt > maxHiddenMs) cache.current.delete(entryKey)
  }

  if (keepable && outlet) {
    const existing = cache.current.get(key)
    // The page being opened was away so long it counts as stale: start it fresh
    // (a new generation gives it a new React key, so it really remounts).
    const expired = existing && existing.hiddenAt && now - existing.hiddenAt > maxHiddenMs
    // awayFor survives a double render (StrictMode): it is only reset once the revisit was announced
    const awayFor = existing && !expired ? (existing.hiddenAt ? now - existing.hiddenAt : existing.awayFor) : 0
    cache.current.set(key, { element: outlet, locationContext, hiddenAt: 0, awayFor, lastSeen: now, generation: existing ? existing.generation + (expired ? 1 : 0) : 0 })
  }
  // Mark everything else as hidden since now (keeps its last element + location).
  for (const [entryKey, entry] of cache.current) {
    if (entryKey !== key && !entry.hiddenAt) entry.hiddenAt = now
  }
  // Bound the number of kept pages: forget the least recently shown hidden ones.
  if (cache.current.size > maxKept) {
    const hidden = [...cache.current.entries()].filter(([entryKey]) => entryKey !== key).sort((a, b) => a[1].lastSeen - b[1].lastSeen)
    while (cache.current.size > maxKept && hidden.length) cache.current.delete(hidden.shift()[0])
  }

  // Tell a page that is shown again after a while, once it is on screen.
  useEffect(() => {
    if (previousKey.current !== key) {
      const entry = cache.current.get(key)
      if (entry && entry.awayFor > REVISIT_AFTER_MS) {
        window.dispatchEvent(new CustomEvent('keepalive:revisit', { detail: { key } }))
      }
      if (entry) entry.awayFor = 0
      previousKey.current = key
    }
  })

  return (
    <>
      {[...cache.current.entries()].map(([entryKey, entry]) => {
        const active = keepable && entryKey === key
        return (
          <div key={`${entryKey}#${entry.generation}`} hidden={!active} data-keepalive={entryKey}>
            <LocationContext.Provider value={active ? locationContext : entry.locationContext}>
              <KeepAliveKeyContext.Provider value={entryKey}>{entry.element}</KeepAliveKeyContext.Provider>
            </LocationContext.Provider>
          </div>
        )
      })}
      {!keepable && outlet}
    </>
  )
}

// A kept page calls this to refresh its data quietly when it comes back after
// being away a while. The callback must NOT show a full-page loading state.
export function useRouteRevisit(callback) {
  const key = useContext(KeepAliveKeyContext)
  const latest = useRef(callback)
  latest.current = callback
  useEffect(() => {
    if (!key) return undefined
    const handler = (event) => { if (event.detail?.key === key) latest.current?.() }
    window.addEventListener('keepalive:revisit', handler)
    return () => window.removeEventListener('keepalive:revisit', handler)
  }, [key])
}
