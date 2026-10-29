import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'

// Remembers WHICH list a case was opened from (Cases, Corporations or Clients) so the case page's back button returns there, and says so.
// Case pages are kept alive (KeepAliveOutlet), so the origin is recorded per case on every arrival, not once at mount.
// A page reached any other way (dashboard, search, pasted link, refresh) has no origin and keeps the old type-based back button.
const LIST_LABELS = { '/crm-cases': 'Cases', '/corporations': 'Corporations', '/clients': 'Clients' }
const DETAIL = /^\/crm-cases\/([^/]+)\/?$/
const MAX_REMEMBERED = 60

let lastList = null // { path, label } of the list page the user was last on, or null when they were on some other page
let currentDetailId = null // the case page being viewed, so a tab/query change on the same case does not re-record
const originByCase = new Map()
const listeners = new Set()

export function recordLocation(pathname, search = '') {
  const detail = DETAIL.exec(pathname)
  if (!detail) {
    const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
    lastList = LIST_LABELS[clean] ? { path: `${clean}${search}`, label: LIST_LABELS[clean] } : null
    currentDetailId = null
    return
  }
  const id = detail[1]
  if (id === currentDetailId) return
  // Opened from a list: that list. Moving between cases (parent <-> employee): the origin carries over.
  originByCase.set(id, currentDetailId ? originByCase.get(currentDetailId) || null : lastList)
  currentDetailId = id
  if (originByCase.size > MAX_REMEMBERED) originByCase.delete(originByCase.keys().next().value)
}

export const getCaseOrigin = (id) => originByCase.get(String(id)) || null

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Mounted once in the layout. Recording happens during render (once per navigation) so the case page, which renders after the layout,
// already sees the right origin on its first paint; the effect then wakes any kept-alive case page that was not re-rendered.
export function useCaseOriginTracker() {
  const location = useLocation()
  const seen = useRef(null)
  if (seen.current !== location.key) {
    seen.current = location.key
    recordLocation(location.pathname, location.search)
  }
  useEffect(() => { listeners.forEach((listener) => listener()) }, [location.key])
}

export const useCaseOrigin = (id) => useSyncExternalStore(subscribe, () => getCaseOrigin(id), () => null)

export function resetCaseOrigin() {
  lastList = null
  currentDetailId = null
  originByCase.clear()
}
