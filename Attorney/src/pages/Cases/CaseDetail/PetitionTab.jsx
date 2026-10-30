import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { Loader2, Eye, FileText } from 'lucide-react'
import { petitionReviewApi } from '../../../services/api'
import { useSocket } from '../../../context/SocketContext'
import PetitionViewer from '../../../components/petition/PetitionViewer'
import { prefetchPetition } from '../../../components/petition/usePetitionStream'

const dateLabel = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}

// The petitions the case manager sent for THIS attorney's review - only the list. Open shows the petition across the whole screen (80%) with the case's Feedback conversation
// beside it (20%), exactly like the client's Petition page. Nothing the case manager has not sent is ever listed, and a new release appears here live (and is also e-mailed
// and pushed to the browser).
export default function PetitionTab() {
  const { caseId } = useParams()
  const { refreshToken } = useOutletContext()
  const { subscribe, connected } = useSocket()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState(null)

  const load = useCallback(
    () =>
      petitionReviewApi
        .list(caseId)
        .then(({ data }) => { setItems(data?.data?.items || []); setError('') })
        .catch((err) => setError(err.response?.data?.message || 'Could not load the petitions.')),
    [caseId]
  )

  useEffect(() => { load() }, [load, refreshToken])

  // live: a petition sent for review while this page is open shows up at once
  useEffect(() => {
    if (!connected) return undefined
    return subscribe('petition:review', (payload) => {
      if (String(payload?.caseId) === String(caseId)) load()
    })
  }, [connected, subscribe, caseId, load])

  if (error && !items) return <p className="text-sm text-destructive">{error}</p>
  if (!items) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <div className="card text-center py-10">
          <FileText className="w-8 h-8 mx-auto text-muted-foreground/60" />
          <p className="mt-3 text-sm font-semibold text-foreground">No petition has been sent for your review yet</p>
          <p className="mt-1 text-sm text-muted-foreground">When the case manager sends the petition for attorney review it appears here, and you are notified by email and in your browser.</p>
        </div>
      ) : (
        <ul className="card !p-0 divide-y divide-border">
          {items.map((item) => (
            <li key={item.documentId} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{item.fileName}</p>
                <p className="text-xs text-muted-foreground">Sent for your review {dateLabel(item.sentAt)}</p>
                {item.note && <p className="mt-1 text-xs text-foreground/80 whitespace-pre-wrap break-words">Note from the case manager: {item.note}</p>}
              </div>
              <button
                type="button"
                onClick={() => setViewing(item)}
                onMouseEnter={() => prefetchPetition(item.documentId)}
                onFocus={() => prefetchPetition(item.documentId)}
                className="btn-primary inline-flex items-center gap-1.5"
              >
                <Eye className="w-4 h-4" /> Open
              </button>
            </li>
          ))}
        </ul>
      )}

      {viewing && <PetitionViewer item={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
