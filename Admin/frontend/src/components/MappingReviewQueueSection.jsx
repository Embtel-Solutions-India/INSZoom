import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { governanceOpsApi } from '../services/api'
import { Badge, unwrap, errorMessage, words, plainPath } from './governanceShared'

// Phase 5 mapping-review queue (read-only): boxes whose mapping is waiting for a person - suggested, not yet confirmed, or flagged by the checks. Fixing one happens in the
// existing mapping editor of that form; this list only shows what needs a look and why.
const STATUS_TEXT = { needs_review: { label: 'Needs a look', tone: 'amber' }, rejected: { label: 'Turned down', tone: 'red' }, active: { label: 'In use', tone: 'green' } }
const ORIGIN_TEXT = { authored: 'Written by a person', legacy: 'Existing mapping', inferred: 'Worked out by the system', ai: 'AI suggestion', scored: 'Matched by similar wording' }

const MappingReviewQueueSection = () => {
  const [formCode, setFormCode] = useState('')
  const [status, setStatus] = useState('')
  const [origin, setOrigin] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(unwrap(await governanceOpsApi.mappingReview({ formCode: formCode.trim() || undefined })))
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'Could not load the mapping review queue.'))
    } finally {
      setLoading(false)
    }
  }, [formCode])

  useEffect(() => { load() }, [load])

  const items = useMemo(() => (data?.items || []).filter((item) => (!status || item.status === status) && (!origin || item.origin === origin)), [data, status, origin])

  return (
    <div className="space-y-3" data-testid="mapping-review-queue">
      <p className="text-sm text-muted-foreground">Boxes whose mapping is waiting for a person. This list is read-only - open the form&apos;s mapping editor to confirm or change one.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">Form<input className="input text-sm block" aria-label="Form" placeholder="All forms" value={formCode} onChange={(event) => setFormCode(event.target.value.toUpperCase())} /></label>
        <label className="text-xs text-muted-foreground">Status<select className="input text-sm block" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All</option>{Object.entries(STATUS_TEXT).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select></label>
        <label className="text-xs text-muted-foreground">Where it came from<select className="input text-sm block" aria-label="Where it came from" value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="">All</option>{Object.entries(ORIGIN_TEXT).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <span className="text-sm text-muted-foreground" data-testid="queue-count">{loading ? 'Loading…' : `${items.length} of ${data?.total ?? 0}`}</span>
      </div>
      {error && <div role="alert" className="text-sm rounded-lg border border-red-300 text-red-700 px-3 py-2">{error}</div>}
      {!loading && !error && items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting for review.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Form</th><th className="py-1 pr-3">Box</th><th className="py-1 pr-3">Filled from</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Why it needs a look</th><th className="py-1" /></tr></thead>
            <tbody>
              {items.map((item) => {
                const info = STATUS_TEXT[item.status] || { label: words(item.status), tone: 'gray' }
                return (
                  <tr key={`${item.templateId}-${item.targetFieldId}`} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-3 font-medium">{item.formCode}</td>
                    <td className="py-1.5 pr-3">{item.label || words(String(item.targetPdfField || '').split('.').pop())}{item.section ? <span className="block text-xs text-muted-foreground">{item.section}</span> : null}</td>
                    <td className="py-1.5 pr-3">{plainPath(item.sourcePath) || '-'}<span className="block text-xs text-muted-foreground">{ORIGIN_TEXT[item.origin] || words(item.origin)}</span></td>
                    <td className="py-1.5 pr-3"><Badge tone={info.tone}>{info.label}</Badge></td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{(item.reasons || []).length ? item.reasons.map(words).join('; ') : '-'}</td>
                    <td className="py-1.5"><Link className="text-primary text-xs underline whitespace-nowrap" to={`/form-governance/${encodeURIComponent(item.formCode)}`}>Open in mapping editor</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default MappingReviewQueueSection
