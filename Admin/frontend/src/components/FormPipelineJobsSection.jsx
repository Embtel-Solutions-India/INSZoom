import { Fragment, useState, useEffect, useCallback } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formPipelineApi } from '../services/api'

// Phase 1 visibility, as a section of the Form Governance page: what the form import pipeline is doing right now, which forms are stuck and why. Read access is
// super_admin / admin / team_lead (the same roles the API allows); only super_admin and admin can put a stuck job back in the queue.
export const READ_ROLES = ['super_admin', 'admin', 'team_lead']
export const RETRY_ROLES = ['super_admin', 'admin']
export const POLL_MS = 15000

export const STATE_TEXT = {
  pending: { label: 'Waiting', tone: 'gray', help: 'Waiting for its turn (or for its next retry time).' },
  running: { label: 'Running', tone: 'blue', help: 'A worker is working on it now.' },
  blocked: { label: 'Needs attention', tone: 'amber', help: 'The form file or page could not be used. It is retried slowly, or when a new edition appears.' },
  held: { label: 'Waiting for a decision', tone: 'amber', help: 'USCIS has not confirmed this edition is accepted yet, so it is not made live.' },
  dead_letter: { label: 'Failed - needs an admin', tone: 'red', help: 'It failed several times. Nothing more happens until an admin retries it.' },
  done: { label: 'Finished', tone: 'green', help: 'Completed.' },
}

export const STAGE_TEXT = {
  detect: 'Checking USCIS for a new edition',
  import: 'Downloading and reading the form',
  map: 'Matching form boxes to client data',
  certify: 'Testing that the form fills correctly',
  promote: 'Making the new edition live',
  migrate_cases: 'Moving open cases to the new edition',
  finalize: 'Final touches',
}

const TRIGGER_TEXT = { catalog_sync: 'Catalog check', admin_fetch: 'Admin fetch', case_acquire: 'A case needed it', autopilot: 'Automatic check', mapping_save: 'Mapping saved', edition_upgrade: 'New edition', manual_retry: 'Admin retry', script: 'Script', unknown: 'Unknown' }

const errorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const Badge = ({ tone = 'gray', children, title }) => {
  const tones = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', gray: 'bg-gray-100 text-gray-700', blue: 'bg-primary/10 text-primary' }
  return <span title={title} className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${tones[tone] || tones.gray}`}>{children}</span>
}

export const StateBadge = ({ state }) => {
  const info = STATE_TEXT[state] || { label: state, tone: 'gray', help: '' }
  return <Badge tone={info.tone} title={info.help}>{info.label}</Badge>
}

const when = (value) => (value ? new Date(value).toLocaleString() : '-')

export const stageLabel = (stage) => STAGE_TEXT[stage] || stage || '-'

function JobDetail({ job }) {
  const stages = Object.entries(job.stages || {})
  return (
    <div className="rounded-lg bg-muted/40 p-3 space-y-3 text-sm" data-testid="job-detail">
      {job.lastError?.message && (
        <p role="alert" className="text-red-700"><strong>What went wrong:</strong> {job.lastError.message}{job.lastError.stage ? ` (during: ${stageLabel(job.lastError.stage)})` : ''}</p>
      )}
      {job.nextAttemptAt && job.state !== 'done' && <p><strong>Next try:</strong> {when(job.nextAttemptAt)}</p>}
      <p><strong>Attempts:</strong> {job.attempts ?? 0} of {job.maxAttempts ?? '-'} · <strong>Started by:</strong> {TRIGGER_TEXT[job.trigger] || job.trigger}{job.editionKey ? <> · <strong>Edition:</strong> {String(job.editionKey).split('|')[1] || job.editionKey}</> : null}</p>
      {stages.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Steps</div>
          <ul className="space-y-1">
            {stages.map(([name, info]) => (
              <li key={name}>{stageLabel(name)}: <Badge tone={info.status === 'done' ? 'green' : info.status === 'failed' ? 'red' : info.status === 'skipped' ? 'gray' : 'blue'}>{info.status}</Badge>{info.error?.message ? <span className="text-muted-foreground"> - {info.error.message}</span> : null}</li>
            ))}
          </ul>
        </div>
      )}
      {(job.repairsTried || []).length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Automatic repairs tried</div>
          <ul className="space-y-1">{job.repairsTried.map((repair, index) => <li key={index}>{repair.strategy}: {repair.outcome}{repair.verification ? ` (checked: ${repair.verification})` : ''}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

const FILTERS = [{ key: '', label: 'All' }, { key: 'running', label: 'Running' }, { key: 'pending', label: 'Waiting' }, { key: 'blocked', label: 'Needs attention' }, { key: 'held', label: 'Held' }, { key: 'dead_letter', label: 'Failed' }, { key: 'done', label: 'Finished' }]

const FormPipelineJobsSection = () => {
  const { user } = useAuth()
  const allowed = READ_ROLES.includes(user?.role)
  const canRetry = RETRY_ROLES.includes(user?.role)
  const [status, setStatus] = useState(null)
  const [jobs, setJobs] = useState([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState('')
  const [detail, setDetail] = useState({})
  const [retrying, setRetrying] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [statusResponse, jobsResponse] = await Promise.all([formPipelineApi.status(), formPipelineApi.jobs({ state: filter || undefined, limit: 50 })])
      setStatus(statusResponse.data.data)
      setJobs(jobsResponse.data.data || [])
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'Could not load the pipeline jobs.'))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    if (!allowed) return undefined
    load()
    const timer = setInterval(() => { if (!document.hidden) load(true) }, POLL_MS)
    return () => clearInterval(timer)
  }, [allowed, load])

  const toggle = async (job) => {
    const id = String(job._id)
    if (open === id) { setOpen(''); return }
    setOpen(id)
    try {
      const response = await formPipelineApi.job(id)
      setDetail((current) => ({ ...current, [id]: response.data.data }))
    } catch {
      setDetail((current) => ({ ...current, [id]: job })) // the list row already has most of it
    }
  }

  const retry = async (job) => {
    setRetrying(String(job._id))
    setNotice('')
    try {
      await formPipelineApi.retry(String(job._id))
      setNotice(`${job.formCode} was put back in the queue.`)
      await load(true)
    } catch (err) {
      setNotice(errorMessage(err, 'Could not retry this job.'))
    } finally {
      setRetrying('')
    }
  }

  if (!allowed) return null

  const workerText = !status ? '' : status.mode === 'inline' ? 'Runs inside the main server (no separate worker needed).' : status.workerAlive ? 'The background worker is running.' : 'No background worker is running - queued jobs will wait until one starts.'

  return (
    <div className="card space-y-4" data-testid="form-pipeline-jobs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Activity className="w-5 h-5" /> Form Import Progress</h2>
          <p className="text-sm text-muted-foreground mt-1">Every time a form is fetched or checked for a new USCIS edition, the work is tracked here: what it is doing, and - if it is stuck - why. It refreshes by itself.</p>
        </div>
        <button type="button" onClick={() => load()} className="btn-secondary text-sm flex items-center gap-1 shrink-0" disabled={loading}><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      {status && (
        <div className="space-y-2" data-testid="pipeline-status">
          <p className="text-sm text-muted-foreground">{workerText}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATE_TEXT).map(([state]) => <span key={state} className="inline-flex items-center gap-1 text-sm"><StateBadge state={state} /> <strong>{status.counts?.[state] ?? 0}</strong></span>)}
          </div>
        </div>
      )}

      <div className="inline-flex flex-wrap" role="group" aria-label="Filter jobs">
        {FILTERS.map((item, index) => (
          <button key={item.key || 'all'} type="button" onClick={() => setFilter(item.key)} aria-pressed={filter === item.key}
            className={`border px-3 py-1.5 text-xs font-semibold ${index === 0 ? 'rounded-l-lg' : '-ml-px'} ${index === FILTERS.length - 1 ? 'rounded-r-lg' : ''} ${filter === item.key ? 'border-primary-600 bg-primary-600 text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>
            {item.label}
          </button>
        ))}
      </div>

      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="py-2 pr-3">Form</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Now doing</th><th className="py-2 pr-3">Last change</th><th className="py-2" /></tr></thead>
            <tbody>
              {jobs.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No jobs to show.</td></tr>}
              {jobs.map((job) => {
                const id = String(job._id)
                const canRetryThis = canRetry && ['blocked', 'held', 'dead_letter'].includes(job.state)
                return (
                  <Fragment key={id}>
                    <tr className="border-t border-border">
                      <td className="py-2 pr-3 font-medium text-foreground">{job.formCode}</td>
                      <td className="py-2 pr-3"><StateBadge state={job.state} /></td>
                      <td className="py-2 pr-3">{job.state === 'done' ? <span className="text-muted-foreground">-</span> : stageLabel(job.currentStage)}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{when(job.updatedAt)}</td>
                      <td className="py-2 text-right space-x-2">
                        <button type="button" className="btn-secondary text-xs" onClick={() => toggle(job)}>{open === id ? 'Hide details' : 'Details'}</button>
                        {canRetryThis && <button type="button" className="btn-primary text-xs" disabled={Boolean(retrying)} onClick={() => retry(job)}>{retrying === id ? 'Retrying...' : 'Retry'}</button>}
                      </td>
                    </tr>
                    {open === id && <tr><td colSpan={5} className="pb-3"><JobDetail job={detail[id] || job} /></td></tr>}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default FormPipelineJobsSection
