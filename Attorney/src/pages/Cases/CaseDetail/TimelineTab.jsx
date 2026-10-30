import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { Loader2, Scale, FolderOpen, FileText, Eye, MessageSquare, CheckCircle2, RotateCcw } from 'lucide-react'
import { attorneyApi } from '../../../services/api'

// YOUR timeline on this case - not the staff's: when the case was assigned to you, when you opened it, the petition you were sent and read, the feedback you gave, and when you
// completed your review. Each line is written as it happens, so it grows live while you work.
const ICON = {
  assigned: Scale,
  first_opened: FolderOpen,
  case_opened: FolderOpen,
  petition_received: FileText,
  petition_viewed: Eye,
  feedback_sent: MessageSquare,
  review_completed: CheckCircle2,
  review_reopened: RotateCcw,
}
const TONE = { review_completed: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' }

const when = (value) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function TimelineTab() {
  const { caseId } = useParams()
  const { refreshToken } = useOutletContext()
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    attorneyApi
      .timeline(caseId)
      .then(({ data }) => { setEvents(data.timeline || []); setError('') })
      .catch((err) => setError(err.response?.data?.message || 'Could not load your timeline.'))
  }, [caseId, refreshToken])

  if (error && !events) return <p className="text-sm text-destructive">{error}</p>
  if (!events) return <Loader2 className="w-6 h-6 animate-spin text-primary" />
  if (!events.length) return <p className="text-sm text-muted-foreground card text-center">Nothing on your timeline yet.</p>

  return (
    <ol className="card !p-0 divide-y divide-border">
      {events.map((event) => {
        const Icon = ICON[event.type] || FolderOpen
        return (
          <li key={event.id} className="flex items-start gap-3 px-4 sm:px-5 py-3.5">
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TONE[event.type] || 'bg-primary/10 text-primary'}`}><Icon className="w-4 h-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{event.title}</p>
              {event.description && <p className="text-xs text-muted-foreground break-words whitespace-pre-wrap">{event.description}</p>}
            </div>
            <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={new Date(event.at).toISOString()}>{when(event.at)}</time>
          </li>
        )
      })}
    </ol>
  )
}
