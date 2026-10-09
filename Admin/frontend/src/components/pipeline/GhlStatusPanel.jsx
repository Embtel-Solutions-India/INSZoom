import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { ghlApi } from '../../services/api'

const ago = (value) => {
  if (!value) return 'never'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} d ago`
}

const Row = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 py-1 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium text-foreground">{children}</span>
  </div>
)

const Ok = ({ ok, children }) => (
  <span className={`inline-flex items-center gap-1 ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>
    {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
    {children}
  </span>
)

const apiMessage = (error) => error?.response?.data?.message || error?.message || 'Request failed'

// Admin / super-admin only. Integration health plus the two one-time actions: confirm the stage mapping, then sync.
export default function GhlStatusPanel({ onChanged }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setData((await ghlApi.status()).data)
    } catch (err) {
      setError(apiMessage(err))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (name, fn) => {
    setBusy(name)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(apiMessage(err))
    } finally {
      setBusy('')
      load()
    }
  }

  if (!data) return <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{error || 'Loading integration status…'}</div>
  if (!data.enabled) return <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">The GoHighLevel integration is switched off (GHL_ENABLED is not true on the server).</div>

  const counts = data.counts || {}
  const healthy = data.status === 'healthy'
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">GoHighLevel integration</h2>
        <button type="button" onClick={load} className="text-muted-foreground hover:text-foreground" aria-label="Refresh status"><RefreshCw className="h-4 w-4" /></button>
      </div>

      <div className="divide-y divide-border">
        <Row label="Status"><Ok ok={healthy}>{data.status === 'config_mismatch' ? 'Stage config changed: review' : data.status}</Ok></Row>
        {(data.pipelines || []).map((p) => (
          <Row key={p.id} label={p.category === 'non_immigrant' ? 'Non-Immigrant pipeline' : 'Immigrant pipeline'}>
            <Ok ok={!p.error}>{p.name}</Ok>
          </Row>
        ))}
        <Row label="Stage mapping"><Ok ok={data.mappingsConfirmed}>{data.mappingsConfirmed ? 'Confirmed' : 'Needs confirmation'}</Ok></Row>
        <Row label="Webhook signing key"><Ok ok={data.webhookKeyConfigured}>{data.webhookKeyConfigured ? 'Configured' : 'Missing'}</Ok></Row>
        <Row label="Last webhook">{ago(data.lastWebhookAt)}</Row>
        <Row label="Last import">{ago(data.lastInitialSyncAt)}</Row>
        <Row label="Queued / failed pushes to GHL">{counts.pendingJobs || 0} / <span className={counts.failedJobs ? 'text-red-700' : ''}>{counts.failedJobs || 0}</span></Row>
        <Row label="Webhook events needing attention">{(counts.failedEvents || 0) + (counts.deadEvents || 0)}</Row>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!data.mappingsConfirmed || data.status === 'config_mismatch' ? (
          <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => run('preview', async () => setPreview((await ghlApi.setupPreview()).data))}>
            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Review stages'}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          disabled={Boolean(busy) || !data.mappingsConfirmed}
          title={data.mappingsConfirmed ? 'Import every opportunity from both pipelines (existing cases are not duplicated)' : 'Confirm the stage mapping first'}
          onClick={() => run('sync', async () => { setResult((await ghlApi.syncNow()).data); onChanged?.() })}
        >
          {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sync now'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={Boolean(busy) || !data.mappingsConfirmed}
          title="Compare every opportunity with GoHighLevel now and bring this system in line (this also runs automatically every 30 seconds)"
          onClick={() => run('reconcile', async () => { setResult((await ghlApi.reconcileNow()).data); onChanged?.() })}
        >
          {busy === 'reconcile' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reconcile now'}
        </button>
      </div>

      {preview ? (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {preview.ok ? (
            <>
              <p className="mb-1 font-medium text-foreground">Each pipeline gets its own board:</p>
              {(preview.pipelines || []).map((p) => (
                <p key={p.id} className="text-muted-foreground"><span className="font-medium text-foreground">{p.name}</span> ({p.stages.length} stages): {p.stages.map((c) => c.name).join(' → ')}</p>
              ))}
              {!preview.confirmed ? (
                <button type="button" className="btn-primary mt-2" disabled={Boolean(busy)} onClick={() => run('confirm', async () => { await ghlApi.confirmMapping(); setPreview(null) })}>
                  Confirm mapping
                </button>
              ) : null}
            </>
          ) : (
            <>
              <p className="mb-1 font-medium text-red-700">The stage setup needs attention:</p>
              <ul className="list-disc pl-5 text-muted-foreground">{[...(preview.problems || []), ...(preview.drift || []).map((d) => `${d.type}: ${d.name || d.from || d.ghlStageId || d.ghlPipelineId}`)].map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {(result.pipelines || []).map((p) => (
            <p key={p.pipeline}>{p.pipeline}: {p.fetched} found, {p.created} created, {p.existing} already imported{p.failed ? `, ${p.failed} failed` : ''}</p>
          ))}
          {result.problems?.length ? <p className="text-red-700">{result.problems.join('; ')}</p> : null}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  )
}
