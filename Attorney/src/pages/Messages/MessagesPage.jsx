import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MessageSquare } from 'lucide-react'
import { attorneyApi } from '../../services/api'

// Top-level "Messages" hub — the ONLY place messaging lives in this portal
// (no per-case Messages/Feedback tab any more). Lists every assigned case
// with its unread count; opening one goes to /messages/:caseId, a standalone
// page outside the case's own tab navigation.
export default function MessagesPage() {
  const [cases, setCases] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    attorneyApi
      .cases()
      .then(({ data }) => setCases(data.cases || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load your cases.'))
  }, [])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!cases) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-foreground font-serif">Messages</h1>
      <p className="text-sm text-muted-foreground -mt-2">
        Message the case team (case manager, team lead, admin) on any of your assigned cases.
      </p>

      <div className="card !p-0">
        {cases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No cases have been assigned to you yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {cases.map((item) => (
              <li key={item._id}>
                <Link to={`/messages/${item._id}`} className="flex items-center justify-between px-5 py-3 hover:bg-secondary transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.caseNumber || item.caseId}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.clientName} · {item.visaType}</p>
                  </div>
                  {item.unreadFeedback > 0 && (
                    <span className="rounded-full bg-destructive text-destructive-foreground text-xs font-bold px-2 py-0.5 shrink-0 ml-3">
                      {item.unreadFeedback}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
