import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { ghlApi } from '../../services/api'

// Admin only (inside the GoHighLevel integration panel): is the two-way sync alive, are webhooks arriving, and which cards are stuck and why. Every change is retried automatically for as
// long as it takes; "Retry all now" only skips the waiting. Reads GET /integrations/ghl/sync-health; polls gently (30 s) while it is open.
const KIND = {
  card_deleted: { label: 'Deleted in GHL', tone: 'bg-slate-200 text-slate-700' },
  needs_attention: { label: 'Needs attention', tone: 'bg-red-100 text-red-700' },
  waiting_email: { label: 'Waiting for e-mail', tone: 'bg-amber-100 text-amber-800' },
  retrying: { label: 'Retrying', tone: 'bg-amber-100 text-amber-800' },
}

const ago = (value) => {
  if (!value) return 'never'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} d ago`
}
const inFuture = (value) => {
  if (!value) return 'now'
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  if (seconds <= 5) return 'now'
  if (seconds < 90) return `in ${seconds}s`
  return `in ${Math.round(seconds / 60)} min`
}

const Row = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 py-1 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium text-foreground">{children}</span>
  </div>
)

export default function SyncHealthSection({ onChanged }) {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      setHealth((await ghlApi.syncHealth()).data)
      setError('')
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load the sync health.')
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, 30000)
    return () => clearInterval(timer)
  }, [load])

  const retryAll = async () => {
    setBusy('all'); setNote('')
    try {
      const { data } = await ghlApi.retryAll()
      setNote(data.moved ? `${data.moved} waiting change${data.moved === 1 ? '' : 's'} will be tried again now.` : 'Nothing was waiting.')
      onChanged?.()
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not retry.')
    } finally {
      setBusy('')
      load()
    }
  }
  const retryOne = async (jobId) => {
    setBusy(jobId)
    try { await ghlApi.retryJob(jobId); onChanged?.() } catch (err) { setError(err?.response?.data?.message || 'Could not retry.') } finally { setBusy(''); load() }
  }

  if (!health) return <p className="mt-3 text-sm text-muted-foreground">{error || 'Loading sync health…'}</p>
  const webhooks = health.webhooks || {}
  const stale = health.reconcile?.ageSeconds != null && health.reconcile.ageSeconds > 180
  const problems = health.problems || []

  return (
    <div className="mt-4 border-t border-border pt-3" data-testid="sync-health">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Sync health</h3>
        <button type="button" onClick={load} className="text-muted-foreground hover:text-foreground" aria-label="Refresh sync health"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <div className="divide-y divide-border">
        <Row label="Last sync pass (every 30 s)">
          <span className={`inline-flex items-center gap-1 ${stale ? 'text-amber-700' : 'text-emerald-700'}`}>
            {stale ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {ago(health.reconcile?.lastAt)}{health.reconcile?.tookMs != null ? ` · took ${(health.reconcile.tookMs / 1000).toFixed(1)}s` : ''}
          </span>
        </Row>
        <Row label="Webhooks received (24 h)">
          <span className={webhooks.last24h ? 'text-emerald-700' : 'text-amber-700'}>{webhooks.last24h || 0}</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">last: {ago(webhooks.lastReceivedAt)}</span>
        </Row>
        <Row label="Waiting / retrying to send">{health.jobs?.pending || 0} / <span className={health.jobs?.retrying ? 'text-amber-700' : ''}>{health.jobs?.retrying || 0}</span></Row>
        {health.reconcile?.orphanedCards ? <Row label="Cards in GHL without a case">{health.reconcile.orphanedCards}</Row> : null}
      </div>
      {!webhooks.last24h ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          No webhook has arrived from GoHighLevel. Changes still sync every 30 seconds, but not instantly. In GoHighLevel, send Opportunity events to this server&apos;s <span className="font-mono">/api/integrations/ghl/webhook</span> address{webhooks.configured ? '' : ' (the signing key is not set on the server yet)'}.
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{problems.length ? `${problems.length} card${problems.length === 1 ? '' : 's'} not in sync` : 'Everything is in sync'}</h4>
        <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={retryAll} data-testid="retry-all">
          {busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Retry all now'}
        </button>
      </div>
      {note ? <p className="mt-1 text-xs text-emerald-700">{note}</p> : null}
      {error ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : null}
      {problems.length ? (
        <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {problems.map((item) => {
            const kind = KIND[item.kind] || KIND.retrying
            return (
              <li key={item.caseId} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{item.caseNumber}{item.name ? ` · ${item.name}` : ''}</p>
                  <p className="text-xs leading-5 text-muted-foreground">{item.text}{item.jobId ? ` · next try ${inFuture(item.nextAttemptAt)}` : ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${kind.tone}`}>{kind.label}</span>
                  {item.jobId ? <button type="button" className="rounded-full border border-border px-2 py-0.5 text-[0.7rem] font-medium hover:bg-muted" disabled={Boolean(busy)} onClick={() => retryOne(item.jobId)}>{busy === item.jobId ? '…' : 'Retry'}</button> : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
