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
