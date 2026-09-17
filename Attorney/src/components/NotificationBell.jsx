import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { notificationsApi } from '../services/api'
import { onForegroundMessage } from '../services/notificationService'

export default function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const containerRef = useRef(null)

  const load = useCallback(() => {
    notificationsApi
      .list({ unread: true, limit: 10 })
      .then(({ data }) => setItems(data?.notifications || data?.data || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const detach = onForegroundMessage(() => load())
    const interval = setInterval(load, 60_000)
    return () => {
      detach()
      clearInterval(interval)
    }
  }, [load])

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
        <div className="absolute right-0 mt-2 w-80 bg-popover rounded-lg shadow-none border border-border z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-popover-foreground">Notifications</h3>
          </div>
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
