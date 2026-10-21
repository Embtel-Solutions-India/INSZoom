import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from './AuthContext'
import { getAccessToken } from '../services/api'

const SocketContext = createContext()

export const useSocket = () => {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}

// Derive the realtime server origin from the REST API base URL
// (e.g. "http://localhost:7000/api" -> "http://localhost:7000"), since
// Socket.IO is attached directly to the shared HTTP server, not under /api.
// Strip "/api" to get the realtime origin. A relative base ("/api") strips to
// "" — fall back to the current origin so the socket connects same-origin and is
// proxied to the backend. Absolute URLs are returned unchanged.
const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api').replace(/\/api\/?$/, '') || window.location.origin

// Like useSocket, but returns null instead of throwing when there is no SocketProvider (a component that only wants live updates as a bonus must keep working without one).
export const useOptionalSocket = () => useContext(SocketContext) || null

export const SocketProvider = ({ children }) => {
  const { token, user } = useAuth()
  const [connected, setConnected] = useState(false)
  const socketRef = useRef(null)

  useEffect(() => {
    if (!token || !user) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setConnected(false)
      return
    }

    const socket = io(SOCKET_URL, {
      // Read the current in-memory access token on every reconnect.
      auth: (callback) => callback({ token: getAccessToken() || token }),
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('notifications:join')
      socket.emit('role:join')
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', () => setConnected(false))

    // Live case changes - an answer saved or a document uploaded from the client portal, by another staff member or in another tab. The case page
    // already refreshes its questionnaire panels, Required Documents, checklist approval and Documents tab on 'case-answers-changed' (the event a save
    // made on this page raises), so the server's signal is handed to it. The tab that made the change has refreshed itself already, so it skips its own.
    socket.on('case:data_changed', (payload) => {
      try {
        if (!payload?.caseId) return
        const own = payload.actorId && String(payload.actorId) === String(user?._id || user?.id || '')
        if (own && document.hasFocus()) return
        window.dispatchEvent(new CustomEvent('case-answers-changed', { detail: { caseId: String(payload.caseId), remote: true } }))
      } catch { /* a live update must never break the socket */ }
    })

    // A page holding an open WebSocket cannot enter the browser's back/forward
    // cache; the browser logs "WebSocket ... failed: Page entered Back-Forward
    // Cache" and drops it anyway. Close the socket as the page is hidden for
    // the cache, and reconnect when it is restored.
    const handlePageHide = () => socket.disconnect()
    const handlePageShow = (event) => { if (event.persisted) socket.connect() }
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      socket.disconnect()
      socketRef.current = null
    }
    // Re-connect whenever the authenticated user or token changes
  }, [token, user?._id, user?.id])

  // Subscribe to a socket event for the lifetime of a component; returns an
  // unsubscribe function. Safe to call before the socket has connected.
  const subscribe = useCallback((event, handler) => {
    const socket = socketRef.current
    if (!socket) return () => {}
    socket.on(event, handler)
    return () => socket.off(event, handler)
  }, [])

  // socketRef.current isn't reactive state, but it's always updated in the
  // same effect run that flips `connected` — recomputing the value whenever
  // `connected` changes keeps `socket` in sync exactly like before, while
  // still giving unrelated re-renders a stable reference.
  const value = useMemo(
    () => ({ socket: socketRef.current, connected, subscribe }),
    [connected, subscribe]
  )

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}
