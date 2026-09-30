import { useEffect, useState } from 'react'
import { attorneyApi } from '../services/api'
import { useSocket } from '../context/SocketContext'

// Sidebar badge counts. "messages" is unread Feedback (the
// portal's only messaging channel) across every assigned case — the same
// number the dashboard's "Unread feedback" stat and the case list's badges
// already add up to (all three read from feedbackService.unreadCountsByCase
// on the backend, just at different aggregation levels). 30s polling stays
// as a fallback; the socket subscription below is what makes the badge
// instant in the common case, same as NotificationBell.jsx.
export default function useUnreadCounts() {
  const [counts, setCounts] = useState({ messages: 0 })
  const { subscribe, connected } = useSocket()

  useEffect(() => {
    let cancelled = false
    const load = () => {
      attorneyApi
        .dashboard()
        .then(({ data }) => { if (!cancelled) setCounts((c) => ({ ...c, messages: data.stats?.pendingFeedback ?? 0 })) })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 30_000)
    if (!connected) return () => { cancelled = true; clearInterval(interval) }
    const unsubFeedback = subscribe('feedback:new', load)
    return () => {
      cancelled = true
      clearInterval(interval)
      unsubFeedback()
    }
  }, [connected, subscribe])

  return counts
}
