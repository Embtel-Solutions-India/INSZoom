import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Search, Settings2, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import usePipelineBoard from '../hooks/usePipelineBoard'
import Board from '../components/pipeline/Board'
import GhlStatusPanel from '../components/pipeline/GhlStatusPanel'

const ADMIN_ROLES = ['super_admin', 'admin']

// One page, two audiences. Admin / super admin / team lead get every GHL case;
// a case manager gets "My Pipeline" with only the cases assigned to them. The
// restriction is enforced by the backend, not by this page. Both boards read
// and write the same case records, so a move in either is a move in both (and in GHL).
export default function Pipeline() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isCaseManager = user?.role === 'case_manager'
  const isAdmin = ADMIN_ROLES.includes(user?.role)
  const { columns, status, notice, dismissNotice, moveCard, loadMore, refresh, setDragging, connected } = usePipelineBoard()
  const [filter, setFilter] = useState('')
  const [showPanel, setShowPanel] = useState(false)
  const openCase = useCallback((id) => navigate(`/crm-cases/${id}`), [navigate])

  const title = isCaseManager ? 'My Pipeline' : 'Pipeline'
  const subtitle = isCaseManager
    ? 'Only the cases assigned to you. Moving a card here updates your team lead’s board and GoHighLevel automatically.'
    : 'Every GoHighLevel case from both pipelines on one board. Drag a card to move it; GoHighLevel is updated in the background.'

  let body
  if (status.loading && !columns.length) {
    body = (
      <div className="flex gap-3 overflow-hidden" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-64 w-72 shrink-0 animate-pulse rounded-xl bg-muted" />)}
      </div>
    )
  } else if (status.disabled) {
    body = <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">The GoHighLevel pipeline isn’t enabled yet.</div>
  } else if (status.error) {
    body = (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-red-700">{status.error}</p>
        <button type="button" className="btn-secondary mt-3" onClick={() => refresh()}>Try again</button>
      </div>
    )
  } else if (!status.configured) {
    body = (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        {isAdmin ? 'The pipeline stages haven’t been confirmed yet. Open “Integration” above to review and confirm them, then run Sync now.' : 'The pipeline is still being set up. Please check back soon.'}
      </div>
    )
  } else {
    body = <Board columns={columns} onMove={moveCard} onOpen={openCase} onLoadMore={loadMore} onDragStateChange={setDragging} filter={filter} />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter loaded cases"
              aria-label="Filter loaded cases"
              className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-2 text-sm"
            />
          </div>
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} title={connected ? 'Live updates on' : 'Reconnecting…'} />
          <button type="button" className="btn-secondary flex items-center gap-1.5" onClick={() => refresh({ silent: true })} aria-label="Refresh board">
            <RefreshCw className="h-4 w-4" />
          </button>
          {isAdmin ? (
            <button type="button" className="btn-secondary flex items-center gap-1.5" onClick={() => setShowPanel((v) => !v)} aria-expanded={showPanel}>
              <Settings2 className="h-4 w-4" /> Integration
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div role="alert" className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-border bg-card text-foreground'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={dismissNotice} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {isAdmin && showPanel ? <GhlStatusPanel onChanged={() => refresh({ silent: true })} /> : null}
      {body}
    </div>
  )
}
