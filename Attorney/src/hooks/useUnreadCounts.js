import { useEffect, useState } from 'react'
import { attorneyApi } from '../services/api'

// Sidebar badge counts, polled. "messages" is unread Feedback (the
// portal's only messaging channel) across every assigned case — the same
// number the dashboard's "Unread feedback" stat and the case list's badges
// already add up to (all three read from feedbackService.unreadCountsByCase
// on the backend, just at different aggregation levels).
export default function useUnreadCounts() {
  const [counts, setCounts] = useState({ messages: 0 })

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
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return counts
}
