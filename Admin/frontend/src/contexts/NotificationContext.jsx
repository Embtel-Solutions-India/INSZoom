import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from './AuthContext'
import { useSocket } from './SocketContext'
import api from '../services/api'
import { onForegroundMessage } from '../services/notificationService';

const NotificationContext = createContext()

export const useNotifications = () => {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
}

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  const { token, user } = useAuth()
  const { subscribe, connected } = useSocket()
  const inFlightRef = useRef({ notifications: false, unreadCount: false, unreadMessages: false })

  const normalizeNotificationResponse = (payload) => {
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.notifications)) return payload.notifications
    return []
  }

  const normalizeCountResponse = (payload) => {
    const value = payload?.count ?? payload?.unreadCount ?? payload?.total ?? 0
    return Number.isFinite(Number(value)) ? Number(value) : 0
  }

  const logFetchError = (label, error) => {
    if (error?.response) {
      console.warn(`${label}: ${error.response.status} ${error.response.data?.message || 'request failed'}`)
      return
    }
    console.warn(`${label}: ${error?.message || 'request failed'}`)
  }

  const fetchNotifications = useCallback(async () => {
    if (!token) return
    if (inFlightRef.current.notifications) return
    inFlightRef.current.notifications = true
    try {
      const response = await api.get('/notifications')
      setNotifications(normalizeNotificationResponse(response.data))
    } catch (error) {
      logFetchError('Unable to fetch notifications', error)
      setNotifications((current) => Array.isArray(current) ? current : [])
    } finally {
      inFlightRef.current.notifications = false
    }
  }, [token])

  const fetchUnreadCount = useCallback(async () => {
    if (!token) return
    if (inFlightRef.current.unreadCount) return
    inFlightRef.current.unreadCount = true
    try {
      const response = await api.get('/notifications/unread-count')
      setUnreadCount(normalizeCountResponse(response.data))
    } catch (error) {
      logFetchError('Unable to fetch notification count', error)
      setUnreadCount((current) => Number.isFinite(Number(current)) ? current : 0)
    } finally {
      inFlightRef.current.unreadCount = false
    }
  }, [token])

  const fetchUnreadMessageCount = useCallback(async () => {
    if (!token) return
    if (inFlightRef.current.unreadMessages) return
    inFlightRef.current.unreadMessages = true
    try {
      const response = await api.get('/messages/unread-count')
      setUnreadMessageCount(normalizeCountResponse(response.data))
    } catch (error) {
      // Never replace a bounded count request with a full message listing.
      // That fallback amplified transient pool pressure into another large
      // query on every authenticated page and every polling tick.
      logFetchError('Unable to fetch unread message count', error)
      setUnreadMessageCount((current) => Number.isFinite(Number(current)) ? current : 0)
    } finally {
      inFlightRef.current.unreadMessages = false
    }
  }, [token])

  const markAsRead = useCallback(async (notificationId) => {
    try {
      await api.put(`/notifications/${notificationId}/read`, {})
      setNotifications(prev =>
        prev.map(n => n._id === notificationId ? { ...n, isRead: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Error marking notification as read:', error)
    }
  }, [])

  const markAllAsRead = useCallback(async () => {
    try {
      await api.put('/notifications/mark-all-read', {})
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch (error) {
      console.error('Error marking all notifications as read:', error)
    }
  }, [])

  useEffect(() => onForegroundMessage((payload) => {
    setNotifications((prev) => [{
      _id: `fcm-${Date.now()}`,
      title: payload?.notification?.title,
      message: payload?.notification?.body,
      link: payload?.data?.link,
      isRead: false,
      createdAt: new Date().toISOString(),
    }, ...prev]);
    // optionally trigger your existing unread-count refetch / toast here
  }), []);

  useEffect(() => {
    if (!token) return

    fetchUnreadCount()
    fetchUnreadMessageCount()

    // Poll notifications + unread count every 30 seconds to keep the bell live
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchUnreadCount()
    }, 30000) // poll every 30 seconds

    // Poll for unread messages every 60 seconds as a fallback; the socket
    // subscription below keeps this live in the common case.
    const messagePoll = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchUnreadMessageCount()
    }, 60000)

    return () => {
      clearInterval(interval)
      clearInterval(messagePoll)
    }
  }, [token, user?._id, user?.id, fetchNotifications, fetchUnreadCount, fetchUnreadMessageCount])

  // Instantly refresh the bell + message badge the moment a new message or
  // notification arrives anywhere, instead of waiting on the next poll tick.
  useEffect(() => {
    if (!token) return
    const unsubscribeMessage = subscribe('message:new', () => {
      fetchUnreadMessageCount()
    })
    const unsubscribeNotification = subscribe('notification:new', (notification) => {
      setNotifications((prev) => [notification, ...prev])
      setUnreadCount((prev) => prev + 1)
    })
    return () => {
      unsubscribeMessage()
      unsubscribeNotification()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, connected])

  const value = useMemo(() => ({
    notifications,
    unreadCount,
    unreadMessageCount,
    fetchNotifications,
    fetchUnreadMessageCount,
    markAsRead,
    markAllAsRead
  }), [notifications, unreadCount, unreadMessageCount, fetchNotifications, fetchUnreadMessageCount, markAsRead, markAllAsRead])

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}
