import { useMemo, useState } from 'react'
import { governanceOpsApi } from '../services/api'
import { stageLabel } from './FormPipelineJobsSection'
import { Badge, STATUS_STATE, unwrap, errorMessage, when, words, plainPath } from './governanceShared'

// Phase 5, one form at a time: the seven SEPARATE statuses (a form can import fine and still not be releasable), the certification checks, the step timeline, the boxes
// whose mapping could not be carried over, and a plain explanation when an edition went live with an override or is on hold. Read-only.
const CHIPS = [
  ['import', 'Import', 'Was the form downloaded and read correctly?'],
  ['mapping', 'Mapping', 'Are the form boxes matched to client data?'],
  ['coverage', 'Coverage', 'How many boxes are matched, and which are not?'],
  ['certification', 'Certification', 'Does the form fill correctly in tests?'],
  ['release', 'Release', 'May this edition go live?'],
  ['editionPolicy', 'USCIS acceptance', 'Has USCIS confirmed this edition is accepted?'],
  ['monitoring', 'Monitoring', 'Is the form being checked for new editions?'],
]

const CHECK_TEXT = {
  pdf_fillable: 'The PDF can be filled in',
  mapping_valid: 'The field mapping is valid',
  fill_roundtrip: 'A filled form is not blank and survives saving',
  party_markers: "Each person's data lands only in that person's boxes",
  widget_inputs: 'Tick boxes, drop-downs and dates get values they can hold',
  viewer_download: 'The filled PDF opens and downloads',
  components_slice: 'Every supplement can be cut out of the form',
}
// the same table the server uses (CERT_CHECK_POLICY): five must pass, two can be overridden by an admin with a written reason
const OVERRIDABLE = new Set(['viewer_download', 'components_slice'])
const severityOf = (check) => check.severity || (OVERRIDABLE.has(check.name) ? 'non_critical' : 'critical')

const DECISION_TEXT = {
  promote: { label: 'Ready to go live', tone: 'green' },
  restricted_degraded: { label: 'Can go live with a written override', tone: 'amber' },
  approval_required: { label: 'A person must approve the changes first', tone: 'amber' },
  held: { label: 'Waiting for USCIS to be confirmed', tone: 'amber' },
  blocked: { label: 'Blocked', tone: 'red' },
}
const OUTCOME_TEXT = { pass: { label: 'Passed', tone: 'green' }, degraded: { label: 'Overridden', tone: 'amber' }, approval_required: { label: 'Needs approval', tone: 'amber' }, held: { label: 'Waiting', tone: 'amber' }, blocked: { label: 'Failed', tone: 'red' } }
const STEP_TONE = { done: 'green', failed: 'red', skipped: 'gray', running: 'blue', pending: 'gray' }
const STEP_TEXT = { done: 'Done', failed: 'Failed', skipped: 'Skipped', running: 'Running', pending: 'Waiting' }

function Chip({ id, label, help, status }) {
  const info = STATUS_STATE[status?.state] || STATUS_STATE.unknown
  return (
    <div className="rounded-lg border border-border p-3 space-y-1" data-testid={`status-${id}`} title={help}>
      <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground">{label}</span><Badge tone={info.tone}>{info.label}</Badge></div>
      <p className="text-xs text-muted-foreground">{status?.detail || help}</p>
    </div>
  )
}

const FormStatusPanel = ({ forms = [] }) => {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const codes = useMemo(() => [...new Set((forms || []).map((row) => row.formCode).filter(Boolean))].filter((code) => !search || code.toLowerCase().includes(search.toLowerCase())), [forms, search])

  const open = async (formCode) => {
    setSelected(formCode)
    setLoading(true)
    setError('')
    setData(null)
    try {
      setData(unwrap(await governanceOpsApi.formStatus(formCode)))
    } catch (err) {
      setError(errorMessage(err, `Could not load the status of ${formCode}.`))
    } finally {
      setLoading(false)
    }
  }

  const statuses = data?.statuses || {}
  const checks = statuses.certification?.checks || []
  const release = statuses.release
  const decision = DECISION_TEXT[release?.decision]
  const lost = data?.lostEdges || []

  return (
    <div className="space-y-4" data-testid="form-status-panel">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Pick a form to see each part of its status on its own: a form can be imported fine and still not be ready to go live.</p>
        <input className="input text-sm max-w-xs" placeholder="Search forms (for example I-130)" aria-label="Search forms" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {codes.length === 0 ? <span className="text-sm text-muted-foreground">No forms found.</span> : codes.map((code) => (
            <button key={code} type="button" onClick={() => open(code)} aria-pressed={selected === code}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${selected === code ? 'border-primary-600 bg-primary-600 text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>{code}</button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <div role="alert" className="text-sm rounded-lg border border-red-300 text-red-700 px-3 py-2">{error}</div>}

      {data && (
        <div className="space-y-5">
          <h3 className="text-base font-semibold text-foreground">{data.formCode}{(data.editions || []).length ? <span className="text-sm font-normal text-muted-foreground"> · {data.editions.map((edition) => `${edition.version || edition.editionDate} (${words(edition.status)})`).join(', ')}</span> : null}</h3>

          {data.degraded && (
            <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-1" data-testid="degraded-note">
              <strong>Released with an override.</strong>
              <p>{data.degraded.reason ? `Reason given: "${data.degraded.reason}". ` : ''}{(data.degraded.failedChecks || []).length ? `These non-critical checks had failed: ${data.degraded.failedChecks.map((name) => CHECK_TEXT[name] || words(name)).join('; ')}. ` : ''}{data.degraded.at ? `Recorded ${when(data.degraded.at)}.` : ''}</p>
            </div>
          )}
          {data.hold && (
            <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-1" data-testid="hold-note">
              <strong>On hold - waiting for USCIS to be confirmed.</strong>
              <p>This edition is not made live until USCIS&apos;s acceptance of it is on record.{(data.hold.reasons || []).length ? ` Why: ${data.hold.reasons.map(words).join(', ')}.` : ''}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CHIPS.map(([id, label, help]) => <Chip key={id} id={id} label={label} help={help} status={statuses[id]} />)}
          </div>

          <section className="space-y-2" data-testid="cert-checks">
            <h4 className="text-sm font-semibold text-foreground">Certification checks</h4>
            {checks.length === 0 ? <p className="text-sm text-muted-foreground">No certification on record yet.</p> : (
              <ul className="space-y-1.5 text-sm">
                {checks.map((check) => (
                  <li key={check.name} className="flex flex-wrap items-baseline gap-2">
                    <Badge tone={check.passed ? 'green' : severityOf(check) === 'critical' ? 'red' : 'amber'}>{check.passed ? 'Passed' : 'Failed'}</Badge>
                    <span className="font-medium text-foreground">{CHECK_TEXT[check.name] || words(check.name)}</span>
                    <span className="text-xs text-muted-foreground">{severityOf(check) === 'critical' ? 'must pass' : 'an admin can override this with a written reason'}</span>
                    {!check.passed && check.detail && <span className="text-muted-foreground">- {check.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2" data-testid="release-checks">
            <h4 className="text-sm font-semibold text-foreground">Release decision {decision && <Badge tone={decision.tone}>{decision.label}</Badge>}</h4>
            {(release?.checks || []).length === 0 ? <p className="text-sm text-muted-foreground">{release?.detail || 'No release decision yet.'}</p> : (
              <ul className="space-y-1.5 text-sm">
                {release.checks.map((check) => { const outcome = OUTCOME_TEXT[check.outcome] || { label: words(check.outcome), tone: 'gray' }; return <li key={check.name} className="flex flex-wrap items-baseline gap-2"><Badge tone={outcome.tone}>{outcome.label}</Badge><span className="font-medium text-foreground">{words(check.name)}</span>{check.detail && <span className="text-muted-foreground">- {check.detail}</span>}</li> })}
              </ul>
            )}
          </section>

          <section className="space-y-2" data-testid="timeline">
            <h4 className="text-sm font-semibold text-foreground">What happened, step by step</h4>
            {(data.timeline || []).length === 0 ? <p className="text-sm text-muted-foreground">No import has been recorded for this form.</p> : (
              <ol className="space-y-1.5 text-sm">
                {data.timeline.map((step, index) => (
                  <li key={`${step.stage}-${index}`} className="flex flex-wrap items-baseline gap-2">
                    <Badge tone={STEP_TONE[step.status] || 'gray'}>{STEP_TEXT[step.status] || words(step.status)}</Badge>
                    <span className="font-medium text-foreground">{stageLabel(step.stage)}</span>
                    <span className="text-xs text-muted-foreground">{step.startedAt ? when(step.startedAt) : ''}{step.attempts > 1 ? ` · ${step.attempts} tries` : ''}</span>
                    {step.error?.message && <span className="text-red-700">- {step.error.message}</span>}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="space-y-2" data-testid="lost-edges">
            <h4 className="text-sm font-semibold text-foreground">Boxes whose mapping could not be carried to this edition</h4>
            {lost.length === 0 ? <p className="text-sm text-muted-foreground">None - every mapped box was carried over.</p> : (
              <>
                <p className="text-xs text-muted-foreground">These boxes were filled from client data in the previous edition but do not exist (or are not the same box) in this one, so a person has to look at them.</p>
                <ul className="divide-y divide-border/60 rounded-lg border border-border text-sm">
                  {lost.map((edge, index) => <li key={`${edge.targetFieldId}-${index}`} className="p-2.5"><strong>{edge.label || words(String(edge.targetFieldId || '').split('.').pop())}</strong> <span className="text-muted-foreground">was filled from {plainPath(edge.sourcePath) || 'client data'}{edge.reason ? ` - ${words(edge.reason)}` : ''}</span></li>)}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default FormStatusPanel
