import { useState, useCallback } from 'react'
import { Gauge } from 'lucide-react'
import { formGovernanceApi } from '../services/api'

// Phase 2: how well this form's current mapping covers the form, in plain words. Loaded only when opened (the report is computed on demand).
const CLASS_TEXT = {
  intentional: 'left empty on purpose',
  out_of_scope: 'not something the client provides (office-use boxes and the like)',
  optional: 'optional, not mapped',
  unresolved: 'not decided yet',
}

const ORIGIN_TEXT = { authored: 'set by a person', legacy: 'older mappings (not yet re-checked)', inferred: 'worked out by the system', ai: 'suggested by AI', scored: 'matched by name similarity' }

const WARNING_TEXT = {
  LEGACY_CONTRACT_VIOLATIONS: (count) => `${count} older mapping(s) do not follow today's rules. They keep working as before and are not changed automatically.`,
  FLAGGED_DEFAULT_VALUES: (count) => `${count} box(es) are pre-filled with a value that should be reviewed.`,
  REQUIRED_FIELDS_UNMAPPED: (count) => `${count} required box(es) are not filled by any mapping.`,
}

const errorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const Stat = ({ label, value, tone = '' }) => (
  <div className="rounded-lg border border-border p-3">
    <div className={`text-xl font-semibold ${tone}`}>{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
)

export function CoverageReport({ coverage }) {
  const { fields, edges, questions, unpopulatedSources, conflicts, contract, defaults, warnings } = coverage
  const percent = fields.coveragePercent
  return (
    <div className="space-y-4" data-testid="coverage-report">
      <div>
        <div className="flex items-baseline justify-between text-sm"><span>Boxes on the form that a mapping fills</span><strong>{fields.mapped} of {fields.total} ({percent}%)</strong></div>
        <div className="h-2 rounded-full bg-muted mt-1" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className="h-2 rounded-full bg-primary-600" style={{ width: `${percent}%` }} /></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="required boxes with no mapping" value={fields.requiredUnmapped} tone={fields.requiredUnmapped ? 'text-red-700' : 'text-green-700'} />
        <Stat label="rule problems in new/changed mappings" value={contract.errors ?? 0} tone={contract.errors ? 'text-red-700' : 'text-green-700'} />
        <Stat label="questions with no form box" value={questions.withoutPdfField} />
        <Stat label="boxes filled by two mappings" value={conflicts.duplicateTargets} tone={conflicts.duplicateTargets ? 'text-amber-700' : ''} />
      </div>

      <div className="text-sm space-y-1">
        <div className="text-xs font-medium text-muted-foreground uppercase">Boxes no mapping fills</div>
        {Object.entries(fields.unmappedByClass || {}).map(([key, count]) => <div key={key}><strong>{count}</strong> {CLASS_TEXT[key] || key}</div>)}
      </div>

      <div className="text-sm space-y-1">
        <div className="text-xs font-medium text-muted-foreground uppercase">Where the mappings came from</div>
        {Object.entries(edges.byOrigin || {}).map(([key, count]) => <div key={key}><strong>{count}</strong> {ORIGIN_TEXT[key] || key}</div>)}
      </div>

      {(unpopulatedSources.count > 0 || defaults.flaggedCount > 0) && (
        <div className="text-sm space-y-1">
          {unpopulatedSources.count > 0 && <div><strong>{unpopulatedSources.count}</strong> mapping(s) read data that no client record has yet.</div>}
          {defaults.flaggedCount > 0 && <div><strong>{defaults.flaggedCount}</strong> box(es) carry a pre-filled value worth a look.</div>}
        </div>
      )}

      {warnings.length > 0 ? (
        <ul className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3 space-y-1" data-testid="coverage-warnings">
          {warnings.map((warning) => <li key={warning.code}>{(WARNING_TEXT[warning.code] || ((count) => `${warning.code}: ${count}`))(warning.count)}</li>)}
        </ul>
      ) : <p className="text-sm text-green-700">Nothing needs attention.</p>}
    </div>
  )
}

const MappingCoveragePanel = ({ templateId }) => {
  const [shown, setShown] = useState(false)
  const [coverage, setCoverage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await formGovernanceApi.mappingCoverage(templateId)
      setCoverage(response.data.coverage)
    } catch (err) {
      setError(errorMessage(err, 'Could not load the mapping coverage.'))
    } finally {
      setLoading(false)
    }
  }, [templateId])

  if (!templateId) return null

  return (
    <div className="card space-y-3" data-testid="mapping-coverage-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2"><Gauge className="w-5 h-5" /> Mapping coverage</h2>
          <p className="text-sm text-muted-foreground">How completely the current mapping fills this form, and what still needs a decision. Read-only.</p>
        </div>
        <button type="button" className="btn-secondary text-sm" disabled={loading} onClick={() => { if (shown) setShown(false); else { setShown(true); load() } }}>{shown ? 'Hide' : 'Show'} coverage</button>
      </div>
      {shown && (loading ? <p className="text-sm text-muted-foreground">Calculating...</p> : error ? <p role="alert" className="text-sm text-red-600">{error}</p> : coverage && <CoverageReport coverage={coverage} />)}
    </div>
  )
}

export default MappingCoveragePanel
