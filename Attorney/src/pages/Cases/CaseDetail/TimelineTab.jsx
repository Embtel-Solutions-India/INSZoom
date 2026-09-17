import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { caseDataApi } from '../../../services/api'

export default function TimelineTab() {
  const { caseId } = useParams()
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    caseDataApi
      .timeline(caseId)
      .then(({ data }) => setEvents(data.timeline || data.events || data.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load the timeline.'))
  }, [caseId])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!events) return <Loader2 className="w-6 h-6 animate-spin text-primary" />
  if (!events.length) {
    return <p className="text-sm text-muted-foreground card text-center">No timeline events yet.</p>
  }

  return (
    <ol className="card !p-0 divide-y divide-border">
      {events.map((event, index) => (
        <li key={event._id || index} className="px-5 py-3">
          <p className="text-sm font-semibold text-foreground">{event.title || event.event || event.type}</p>
          <p className="text-xs text-muted-foreground">
            {event.description || event.message || ''}
            {event.createdAt || event.date ? ` · ${new Date(event.createdAt || event.date).toLocaleString()}` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}
