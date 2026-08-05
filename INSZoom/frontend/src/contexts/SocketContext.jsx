import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from './AuthContext'

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
const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api').replace(/\/api\/?$/, '')

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
      // A function (not a static object) so every reconnection attempt reads
      // the current token from storage, not just the one captured when this
      // effect first ran. The axios response interceptor in services/api.js
      // silently rotates the token into localStorage on a 401 without going
      // through this context's `token` state — without this, the socket
      // would keep retrying with a now-invalid token until a full page reload.
      auth: (callback) => callback({ token: localStorage.getItem('token') || token }),
      transports: ['websocket', 'polling'],
      reconnection: true,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('notifications:join')
      socket.emit('role:join')
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', () => setConnected(false))

    return () => {
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
