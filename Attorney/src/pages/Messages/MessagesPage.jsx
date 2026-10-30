import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Loader2, MessageSquare, Search } from 'lucide-react'
import { attorneyApi } from '../../services/api'
import { useAuth } from '../../auth/AuthContext'
import { useSocket } from '../../context/SocketContext'
import MessageThread from '../../components/MessageThread'
import { caseIdentity } from '../../utils/caseIdentity'
import CaseMeta from '../../components/CaseMeta'

// Top-level "Messages" page — the ONLY place messaging lives in this portal
// (no per-case Messages/Feedback tab in the case navigation). Same split shape
// as the Admin portal's Messaging page: assigned cases (each one is a
// staff-only conversation with its case team) on the left, the open chat on the
// right with the composer docked at the bottom. Served at /messages (nothing
// selected) and /messages/:caseId (that case's chat open) — the URL stays the
// source of truth so notification links and refresh keep working. On phones
// only one pane shows at a time.

function getInitials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
}

export default function MessagesPage() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { subscribe } = useSocket()
  const selfId = String(user?._id || user?.id || '')
  const [cases, setCases] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    attorneyApi
      .cases()
      .then(({ data }) => setCases(data.cases || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load your cases.'))
  }, [])

  // Opening a chat marks it read (MessageThread does the API call) — clear its badge here too.
  useEffect(() => {
    if (!caseId) return
    setCases((current) => (current ? current.map((item) => (String(item._id) === String(caseId) ? { ...item, unreadFeedback: 0 } : item)) : current))
  }, [caseId])

  // A new case-team message on a chat that is not open bumps that row's badge.
  useEffect(() => {
    const unsubscribe = subscribe('feedback:new', (incoming) => {
      const authorId = String(incoming.authorId?._id || incoming.authorId || '')
      if (authorId === selfId || String(incoming.caseId) === String(caseId)) return
      setCases((current) => (current ? current.map((item) => (String(item._id) === String(incoming.caseId) ? { ...item, unreadFeedback: (item.unreadFeedback || 0) + 1 } : item)) : current))
    })
    return unsubscribe
  }, [subscribe, caseId, selfId])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!cases || !term) return cases || []
    return cases.filter((item) => [item.caseNumber, item.caseId, item.clientName, item.visaType].some((value) => (value || '').toLowerCase().includes(term)))
  }, [cases, search])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!cases) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  const selected = caseId ? cases.find((item) => String(item._id) === String(caseId)) : null

  return (
    <div className="card !p-0 overflow-hidden flex h-[calc(100vh-5.5rem)] sm:h-[calc(100vh-6rem)] lg:h-[calc(100vh-7rem)] min-h-[420px]">
      {/* Left: the cases (conversations) we can message about */}
      <div className={`w-full md:w-80 lg:w-96 border-r border-border flex-col shrink-0 ${caseId ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-3 border-b border-border space-y-2.5">
          <h1 className="text-base font-semibold text-foreground">Messages</h1>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search cases..."
              aria-label="Search cases"
              className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center py-12">
              <MessageSquare className="w-8 h-8 mb-2 text-muted-foreground/50" />
              <p className="text-sm">{cases.length === 0 ? 'No cases have been assigned to you yet.' : 'No cases match your search.'}</p>
            </div>
          ) : (
            filtered.map((item) => {
              const active = String(item._id) === String(caseId)
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => navigate(`/messages/${item._id}`)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 border-b border-border border-l-4 transition-colors ${
                    active ? 'bg-secondary border-l-primary' : 'hover:bg-muted border-l-transparent'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {getInitials(item.clientName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{caseIdentity(item).name}</p>
                    <CaseMeta email={caseIdentity(item).email} caseId={item.caseNumber || item.caseId} visa={item.visaType} className="text-xs" />
                  </div>
                  {item.unreadFeedback > 0 && (
                    <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center text-xs font-semibold rounded-full bg-primary text-primary-foreground">
                      {item.unreadFeedback}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right: the open chat */}
      <div className={`flex-1 min-w-0 flex-col ${caseId ? 'flex' : 'hidden md:flex'}`}>
        {!caseId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="w-10 h-10 mb-3" />
            <p className="text-sm">Select a case to message the case team</p>
          </div>
        ) : !selected ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <h2 className="text-lg font-bold text-foreground font-serif mb-1">Access denied</h2>
            <p className="text-sm text-muted-foreground">You do not have access to this case.</p>
            <Link to="/messages" className="mt-3 text-xs text-primary hover:underline">Back to Messages</Link>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => navigate('/messages')}
                aria-label="Back to Messages"
                className="md:hidden text-muted-foreground hover:text-foreground shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground truncate">{caseIdentity(selected).name}</h2>
                <CaseMeta email={caseIdentity(selected).email} caseId={selected.caseNumber || selected.caseId} visa={selected.visaType} className="text-xs" />
              </div>
              <Link to={`/cases/${selected._id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0">
                View case <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <div className="flex-1 min-h-0">
              <MessageThread key={selected._id} caseId={selected._id} fill />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
