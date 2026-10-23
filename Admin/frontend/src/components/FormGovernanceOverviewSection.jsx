import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formPipelineApi, governanceOpsApi } from '../services/api'
import ConfirmModal from './ConfirmModal'
import { StateBadge, STATE_TEXT, stageLabel } from './FormPipelineJobsSection'
import { Badge, Tile, READ_ROLES, RETRY_ROLES, POLL_MS, unwrap, errorMessage, formatAge, formatDuration, when } from './governanceShared'

// Phase 5 operations overview: what the form pipeline is doing, what is stuck and why, how long each step takes, what the recent automatic checks did. Plain words; read-only
// apart from Retry on a stuck job (super_admin / admin - the existing pipeline retry).
const RUN_TEXT = { catalog_sync: 'Check of every USCIS form', edition_upgrade: 'New-edition check', monitoring: 'USCIS page monitoring', autopilot: 'Automatic registry check', edition_check: 'Edition acceptance check', scheduled_sync: 'Scheduled check' }
const runName = (kind) => RUN_TEXT[kind] || String(kind || 'Check').replace(/_/g, ' ')

const workerLine = (pipeline) => {
  if (!pipeline) return ''
  if (pipeline.mode === 'inline') return 'Forms are processed inside the main server, one at a time as they are requested.'
  return pipeline.worker?.alive ? 'The background worker is running.' : 'No background worker is running - queued work will wait until one starts.'
}

function StuckList({ title, help, jobs, canRetry, onRetry, busyId }) {
  return (
    <section className="space-y-2" data-testid={`stuck-${title}`}>
      <h3 className="text-sm font-semibold text-foreground">{title} <span className="text-muted-foreground font-normal">({jobs.length})</span></h3>
      <p className="text-xs text-muted-foreground">{help}</p>
      {jobs.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {jobs.map((job) => (
            <li key={job.jobId} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2"><strong>{job.formCode}</strong> <StateBadge state={job.state} /> <span className="text-muted-foreground">at: {stageLabel(job.currentStage)}</span></div>
                {job.lastError?.message && <p className="text-red-700">{job.lastError.message}</p>}
                <p className="text-xs text-muted-foreground">Tried {job.attempts ?? 0} time{job.attempts === 1 ? '' : 's'} · waiting {formatAge(job.ageMs)}{job.nextAttemptAt ? ` · next try ${when(job.nextAttemptAt)}` : ''}</p>
              </div>
              {canRetry && <button type="button" className="btn-secondary text-xs shrink-0" disabled={busyId === job.jobId} onClick={() => onRetry(job)}>Retry</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const FormGovernanceOverviewSection = () => {
  const { user } = useAuth()
  const allowed = READ_ROLES.includes(user?.role)
  const canRetry = RETRY_ROLES.includes(user?.role)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      setData(unwrap(await governanceOpsApi.overview()))
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'Could not load the operations overview.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!allowed) return undefined
    load()
    const timer = setInterval(() => { if (!document.hidden) load(true) }, POLL_MS)
    return () => clearInterval(timer)
  }, [allowed, load])

  const retry = async () => {
    const job = confirm
    if (!job) return
    setBusyId(job.jobId)
    try {
      await formPipelineApi.retry(String(job.jobId))
      setNotice(`${job.formCode} was put back in the queue.`)
      setConfirm(null)
      await load(true)
    } catch (err) {
      setNotice(errorMessage(err, 'Could not retry this one.'))
      setConfirm(null)
    } finally {
      setBusyId('')
    }
  }

  if (!allowed) return null

  const pipeline = data?.pipeline
  const metrics = data?.metrics || {}
  const timings = pipeline?.stageTimings || []
  const slowest = Math.max(1, ...timings.map((row) => Number(row.p95Ms) || 0))
  const oldest = pipeline?.oldestUnresolved

  return (
    <div className="card space-y-5" data-testid="governance-overview">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Activity className="w-5 h-5" /> Operations overview</h2>
          <p className="text-sm text-muted-foreground mt-1">How the automatic form handling is doing right now, what is stuck and why. It refreshes by itself.{data?.generatedAt ? ` Updated ${when(data.generatedAt)}.` : ''}</p>
        </div>
        <button type="button" onClick={() => load()} className="btn-secondary text-sm flex items-center gap-1 shrink-0" disabled={loading}><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      {notice && <div role="status" className="text-sm rounded-lg border border-primary px-3 py-2">{notice}</div>}
      {error && <div role="alert" className="text-sm rounded-lg border border-red-300 text-red-700 px-3 py-2">{error}</div>}
      {loading && !data ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {pipeline && (
        <>
          <div className="space-y-2" data-testid="overview-pipeline">
            <p className="text-sm text-muted-foreground">{workerLine(pipeline)}</p>
            <div className="flex flex-wrap gap-3">
              {Object.keys(STATE_TEXT).map((state) => <span key={state} className="inline-flex items-center gap-1 text-sm"><StateBadge state={state} /> <strong>{pipeline.counts?.[state] ?? 0}</strong></span>)}
            </div>
            <p className="text-sm" data-testid="overview-oldest">
              {oldest ? <>The longest-waiting item is <strong>{oldest.formCode}</strong> (<StateBadge state={oldest.state} />), waiting <strong>{formatAge(oldest.ageMs)}</strong>.</> : 'Nothing is waiting - every form is up to date.'}
            </p>
            <p className="text-sm text-muted-foreground" data-testid="overview-retries">Retries: {pipeline.retries?.total ?? 0} in total, {pipeline.retries?.last24h ?? 0} in the last 24 hours.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="overview-metrics">
            <Tile label="Editions made live (24 h)" value={metrics.promotions24h} />
            <Tile label="Problems (24 h)" value={metrics.failures24h} tone={metrics.failures24h ? 'red' : undefined} />
            <Tile label="Waiting for a decision now" value={metrics.heldNow} tone={metrics.heldNow ? 'amber' : undefined} hint="USCIS has not confirmed these editions are accepted yet." />
            <Tile label="Failed - needs an admin now" value={metrics.deadLetterNow} tone={metrics.deadLetterNow ? 'red' : undefined} />
            {metrics.aiSuggestions24h !== undefined && <Tile label="AI suggestions (24 h)" value={metrics.aiSuggestions24h} />}
            <Tile label="Case forms on an older edition" value={metrics.frozenCasesOpen} hint="Finished or filed case forms that stay on the edition they were filed on." />
          </div>

          <section className="space-y-2" data-testid="overview-timings">
            <h3 className="text-sm font-semibold text-foreground">How long each step takes</h3>
            {timings.length === 0 ? <p className="text-sm text-muted-foreground">No timings yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Step</th><th className="py-1 pr-3">Times</th><th className="py-1 pr-3">Average</th><th className="py-1">Slowest 5%</th></tr></thead>
                <tbody>
                  {timings.map((row) => (
                    <tr key={row.stage} className="border-t border-border/60">
                      <td className="py-1.5 pr-3">{stageLabel(row.stage)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.count}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{formatDuration(row.avgMs)}</td>
                      <td className="py-1.5"><div className="flex items-center gap-2"><div className="h-2 rounded bg-primary/40" style={{ width: `${Math.max(4, Math.round(((Number(row.p95Ms) || 0) / slowest) * 100))}px` }} aria-hidden="true" /><span className="tabular-nums">{formatDuration(row.p95Ms)}</span></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <StuckList title="Needs attention" help="The form file or USCIS page could not be used. These are retried slowly, or when a new edition appears." jobs={data.blocked || []} canRetry={canRetry} onRetry={setConfirm} busyId={busyId} />
            <StuckList title="Waiting for a decision" help="USCIS has not confirmed that the new edition is accepted, so it is not made live. A retry only re-checks - it never skips the check." jobs={data.held || []} canRetry={canRetry} onRetry={setConfirm} busyId={busyId} />
          </div>

          <section className="space-y-2" data-testid="overview-runs">
            <h3 className="text-sm font-semibold text-foreground">Recent automatic checks</h3>
            {(data.runs || []).length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="divide-y divide-border/60 rounded-lg border border-border">
                {data.runs.map((run, index) => (
                  <li key={`${run.kind}-${run.startedAt}-${index}`} className="p-3 text-sm space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2"><strong>{runName(run.kind)}</strong> <span className="text-muted-foreground">{when(run.startedAt)} · took {formatDuration(run.durationMs)}</span> {run.error ? <Badge tone="red">Problem</Badge> : <Badge tone="green">Done</Badge>}</div>
                    <p className="text-muted-foreground">Looked at {run.checked ?? 0} · changed {run.changed ?? 0} · made live {run.promoted ?? 0} · waiting for a decision {run.held ?? 0} · failed {run.failed ?? 0}</p>
                    {run.error && <p className="text-red-700">{run.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {confirm && (
        <ConfirmModal
          title={`Retry ${confirm.formCode}?`}
          message={confirm.state === 'held' ? `${confirm.formCode} is waiting for USCIS to be confirmed. A retry checks again - it will still not be made live until USCIS's acceptance is on record.` : `${confirm.formCode} will be put back in the queue and tried again now.`}
          confirmLabel={busyId ? 'Working…' : 'Yes, retry'}
          cancelLabel="No"
          busy={Boolean(busyId)}
          onConfirm={retry}
          onCancel={() => { if (!busyId) setConfirm(null) }}
        />
      )}
    </div>
  )
}

export default FormGovernanceOverviewSection
