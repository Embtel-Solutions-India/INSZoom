import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { notificationsApi } from '../services/api'
import { onForegroundMessage, requestPermissionAndGetToken } from '../services/notificationService'
import { useSocket } from '../context/SocketContext'

export default function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const { subscribe, connected } = useSocket()
  // Mirrors Admin's Layout.jsx exactly: the browser permission prompt has
  // never had anywhere to fire from in this portal at all (confirmed - no
  // component called requestPermissionAndGetToken), so an attorney could
  // never actually receive a background push regardless of how correctly
  // the backend/service-worker/FCM plumbing was wired. This banner is that
  // missing entry point.
  const [pushPermission, setPushPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  const [enablingPush, setEnablingPush] = useState(false)

  const enablePush = async () => {
    setEnablingPush(true)
    try {
      await requestPermissionAndGetToken()
    } finally {
      setPushPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
      setEnablingPush(false)
    }
  }

  const load = useCallback(() => {
    notificationsApi
      .list({ unread: true, limit: 10 })
      .then(({ data }) => setItems(data?.notifications || data?.data || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const detach = onForegroundMessage(() => load())
    // 60s polling stays as a fallback (same as Admin's NotificationContext) -
    // the socket subscription below is what makes the bell instant in the
    // common case instead of waiting on the next tick.
    const interval = setInterval(load, 60_000)
    return () => {
      detach()
      clearInterval(interval)
    }
  }, [load])

  // SocketContext already joins a `notifications:join` room on connect
  // (see its own comment) but nothing was listening for what lands there -
  // this is the fix: instant bell refresh on any new notification or
  // feedback message, the same way Admin's NotificationContext subscribes
  // to 'notification:new'/'message:new'.
  useEffect(() => {
    if (!connected) return
    const unsubNotification = subscribe('notification:new', () => load())
    const unsubFeedback = subscribe('feedback:new', () => load())
    return () => {
      unsubNotification()
      unsubFeedback()
    }
  }, [connected, subscribe, load])

  useEffect(() => {
    const onClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const openNotification = async (notification) => {
    setOpen(false)
    await notificationsApi.markManyRead([notification._id]).catch(() => {})
    load()
    if (notification.link) navigate(notification.link)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label="Notifications"
        className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
      >
        <Bell className="w-5 h-5" />
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {items.length > 99 ? '99+' : items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-16 sm:top-auto mt-0 sm:mt-2 sm:w-80 bg-popover rounded-lg shadow-none border border-border z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-popover-foreground">Notifications</h3>
          </div>
          {pushPermission === 'default' && (
            <div className="px-4 py-2.5 border-b border-border bg-accent flex items-center justify-between gap-3">
              <p className="text-xs text-accent-foreground leading-snug">Get notified instantly, even when this tab isn&apos;t open.</p>
              <button
                onClick={enablePush}
                disabled={enablingPush}
                className="shrink-0 text-xs font-semibold text-primary-foreground bg-primary px-2.5 py-1 rounded-md disabled:opacity-60"
              >
                {enablingPush ? 'Enabling…' : 'Enable'}
              </button>
            </div>
          )}
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Bell className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground mt-2">You&apos;re all caught up.</p>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((notification) => (
                <li key={notification._id}>
                  <button
                    onClick={() => openNotification(notification)}
                    className="w-full text-left px-4 py-3 hover:bg-secondary border-b border-border last:border-0"
                  >
                    <p className="text-sm font-medium text-popover-foreground">{notification.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{notification.message}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
