import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from '../auth/AuthContext'
import { getAccessToken } from '../services/api'

const SocketContext = createContext()

export const useSocket = () => {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}

// Mirrors Admin/frontend/src/contexts/SocketContext.jsx exactly (same
// backend, same realtime.gateway.js) - this portal previously had no
// socket connection at all, so attorney feedback messages only ever
// reached the recipient as a notification-bell ping, never a live-appended
// thread update. Derives the realtime origin from the REST API base URL
// the same way ("http://localhost:7000/api" -> "http://localhost:7000").
const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api').replace(/\/api\/?$/, '') || window.location.origin

export const SocketProvider = ({ children }) => {
  const { user } = useAuth()
  const [connected, setConnected] = useState(false)
  const socketRef = useRef(null)

  useEffect(() => {
    const token = getAccessToken()
    if (!token || !user) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setConnected(false)
      return
    }

    const socket = io(SOCKET_URL, {
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
  }, [user?._id, user?.id])

  const subscribe = useCallback((event, handler) => {
    const socket = socketRef.current
    if (!socket) return () => {}
    socket.on(event, handler)
    return () => socket.off(event, handler)
  }, [])

  const value = useMemo(
    () => ({ socket: socketRef.current, connected, subscribe }),
    [connected, subscribe]
  )

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}
