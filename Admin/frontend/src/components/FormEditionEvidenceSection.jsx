import { useState, useEffect, useMemo, useCallback } from 'react'
import { ShieldCheck, Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formEditionPolicyApi } from '../services/api'

// Release 0b-1: the minimal screen for resolving USCIS form-edition acceptance, shown as a section of the Form Governance page. Exactly admin and
// team_lead can see it (Form Governance only renders it for them, it checks the role itself, and the API uses the same two roles). Nothing here
// changes how forms are used today: the gate is shown for information only and is NOT enforced anywhere yet.
export const EVIDENCE_ROLES = ['admin', 'team_lead']

const errorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const Badge = ({ tone = 'gray', children }) => {
  const tones = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', gray: 'bg-gray-100 text-gray-700', blue: 'bg-primary/10 text-primary' }
  return <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${tones[tone] || tones.gray}`}>{children}</span>
}

const REASON_LABELS = {
  no_policy: 'no decision recorded yet',
  not_accepted_by_uscis: 'USCIS does not accept this edition',
  grandfathered_serve_only: 'live before the gate - usable, not yet verified for filing',
  held: 'on hold',
  decision_not_verified: 'decision not verified',
  decision_past_review_date: 'decision past its review date',
  decision_conflicting: 'decision conflicts with the form on file',
  edition_not_yet_effective: 'edition not yet effective',
  edition_no_longer_accepted: 'edition no longer accepted',
  invalid_edition_identifier: 'edition date unknown',
  gate_error: 'could not be checked',
}

const CHECK_LABELS = {
  source_fetched: 'Official page fetched',
  source_official: 'Source is an https uscis.gov page',
  source_fresh: 'Page fetched just now',
  quote_verbatim: 'Quote appears word-for-word in the fetched page',
  edition_in_snapshot: 'The fetched page names this edition',
  quote_names_edition: 'The quoted sentence itself names the edition',
  template_edition_matches: 'Matches the form on file (edition date)',
  pdf_checksum_matches: 'Official PDF is identical to the imported PDF',
  dates_match_quote: 'Dates entered appear in the quoted text',
}

const DECISION_LABELS = { accepted: 'Accepted for filing', not_accepted: 'Not accepted', held: 'On hold' }

export function GateBadge({ gate }) {
  if (!gate) return null
  if (gate.allowed) return <Badge tone="green">Would allow</Badge>
  if (gate.decision === 'not_accepted') return <Badge tone="red">Blocked: not accepted</Badge>
  if (gate.decision === 'grandfathered') return <Badge tone="gray">Serve-only</Badge>
  return <Badge tone="amber">Would hold</Badge>
}

const reasonText = (gate) => (gate?.reasons || []).map((reason) => REASON_LABELS[reason] || reason).join('; ')

function VerificationResults({ verification }) {
  const tone = verification.overall === 'verified' ? 'green' : verification.overall === 'conflicting' ? 'red' : 'amber'
  return (
    <div className="space-y-2" data-testid="verification-results">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">Verification</span>
        <Badge tone={tone}>{verification.overall === 'verified' ? 'Verified' : verification.overall === 'conflicting' ? 'Conflicts with the form on file' : 'Could not be verified'}</Badge>
      </div>
      <ul className="space-y-1">
        {verification.checks.map((check) => (
          <li key={check.name} className="flex items-start gap-2 text-sm">
            {check.passed ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 shrink-0" /> : check.severity === 'advisory' ? <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 text-red-600 shrink-0" />}
            <span>
              <span className="font-medium text-foreground">{CHECK_LABELS[check.name] || check.name}</span>
              {check.severity === 'advisory' && <span className="text-muted-foreground"> (advisory)</span>}
              <span className="block text-muted-foreground">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EvidencePanel({ edition, onClose, onDone }) {
  const [form, setForm] = useState({ sourceUrl: edition.sourcePageUrl || '', quote: '', effectiveDate: '', rejectionDate: '', graceUntil: '' })
  const [step, setStep] = useState('submit') // submit -> decide -> done
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [decision, setDecision] = useState('held')
  const [rationale, setRationale] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [recorded, setRecorded] = useState(null)

  const set = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }))
  const verified = result?.verification?.overall === 'verified'

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await formEditionPolicyApi.submitEvidence({ formCode: edition.formCode, editionIdentifier: edition.editionIdentifier, ...form })
      setResult(response.data.data)
      setDecision(response.data.data.verification.overall === 'verified' ? 'accepted' : 'held')
      setStep('decide')
    } catch (err) {
      setError(errorMessage(err, 'Could not submit the evidence. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const record = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await formEditionPolicyApi.recordDecision(result.evidenceCaseId, {
        decision,
        rationale,
        confirmation: { confirmed: true, decision, formCode: edition.formCode, editionIdentifier: edition.editionIdentifier },
      })
      setRecorded(response.data.data)
      setStep('done')
    } catch (err) {
      setError(errorMessage(err, 'Could not record the decision. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const confirmationText = `I confirm: ${DECISION_LABELS[decision]} for Form ${edition.formCode}, edition ${edition.editionIdentifier}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Edition evidence" className="w-full max-w-2xl max-h-full overflow-y-auto rounded-2xl bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Form {edition.formCode} - edition {edition.editionIdentifier}</h2>
            <p className="text-sm text-muted-foreground">Record what USCIS says about whether this edition can be filed. The system fetches the page itself and checks your quote against it.</p>
          </div>
          <button type="button" onClick={step === 'done' ? onDone : onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {step === 'submit' && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-foreground">Official USCIS page (https://...uscis.gov)
              <input className="input-field mt-1 w-full" value={form.sourceUrl} onChange={set('sourceUrl')} placeholder="https://www.uscis.gov/..." />
            </label>
            <label className="block text-sm font-medium text-foreground">Exact sentence(s) from that page (copied word for word)
              <textarea className="input-field mt-1 w-full" rows={4} value={form.quote} onChange={set('quote')} placeholder="Paste the sentence that says which edition is accepted" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[['effectiveDate', 'Effective date (if stated)'], ['rejectionDate', 'Stops being accepted (if stated)'], ['graceUntil', 'Grace period until (if stated)']].map(([name, label]) => (
                <label key={name} className="block text-sm font-medium text-foreground">{label}
                  <input type="date" className="input-field mt-1 w-full" value={form[name]} onChange={set(name)} />
                </label>
              ))}
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn-primary" disabled={busy || !form.sourceUrl.trim() || !form.quote.trim()} onClick={submit}>{busy ? 'Fetching and checking...' : 'Fetch and verify'}</button>
            </div>
          </div>
        )}

        {step === 'decide' && result && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3 bg-muted/40">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Your quote</p>
              <p className="text-sm text-foreground mt-1">&ldquo;{form.quote}&rdquo;</p>
              {result.snapshot && <p className="text-xs text-muted-foreground mt-2">Fetched from {result.snapshot.finalUrl} - snapshot {result.snapshot.hash.slice(0, 12)}...</p>}
            </div>
            <VerificationResults verification={result.verification} />
            <div className="text-sm"><span className="font-medium text-foreground">What the gate would do now: </span><GateBadge gate={result.gate} /> <span className="text-muted-foreground">{reasonText(result.gate)}</span></div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Your decision</p>
              {[['accepted', 'USCIS accepts this edition for filing'], ['not_accepted', 'USCIS does not accept this edition'], ['held', 'Keep this edition on hold']].map(([value, label]) => (
                <label key={value} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="decision" value={value} checked={decision === value} disabled={value === 'accepted' && !verified} onChange={() => { setDecision(value); setConfirmed(false) }} className="mt-1" />
                  <span>{label}{value === 'accepted' && !verified && <span className="block text-muted-foreground">Needs verified evidence.</span>}</span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground">A matching quote proves the text is on the official page, not that the conclusion is right: the decision is yours. If you submitted this evidence yourself, a different admin or team lead has to record an acceptance.</p>
              <label className="block text-sm font-medium text-foreground">Why (kept in the audit trail)
                <textarea className="input-field mt-1 w-full" rows={2} value={rationale} onChange={(event) => setRationale(event.target.value)} />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                <span className="font-medium text-foreground">{confirmationText}</span>
              </label>
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn-primary" disabled={busy || !confirmed || rationale.trim().length < 10 || (decision === 'accepted' && !verified)} onClick={record}>{busy ? 'Recording...' : 'Record decision'}</button>
            </div>
          </div>
        )}

        {step === 'done' && recorded && (
          <div className="space-y-3" data-testid="decision-recorded">
            <p className="text-sm text-foreground">Decision recorded: <span className="font-semibold">{DECISION_LABELS[recorded.decision.decision]}</span> (version {recorded.decision.version}).</p>
            <div className="text-sm"><span className="font-medium text-foreground">What the gate would do now: </span><GateBadge gate={recorded.gate} /> <span className="text-muted-foreground">{reasonText(recorded.gate)}</span></div>
            <p className="text-xs text-muted-foreground">This is for information: the gate is not enforced anywhere yet, so nothing about how this form is used has changed.</p>
            <div className="flex justify-end"><button type="button" className="btn-primary" onClick={onDone}>Done</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'awaiting', label: 'Awaiting promotion' },
  { key: 'attention', label: 'Needs evidence' },
]

const FormEditionEvidenceSection = () => {
  const { user } = useAuth()
  const allowed = EVIDENCE_ROLES.includes(user?.role)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [active, setActive] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await formEditionPolicyApi.editions()
      setRows(response.data.data || [])
    } catch (err) {
      setError(errorMessage(err, 'Could not load the editions.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  const visible = useMemo(() => rows.filter((row) => {
    if (search && !`${row.formCode} ${row.editionIdentifier || ''}`.toLowerCase().includes(search.trim().toLowerCase())) return false
    if (filter === 'live') return row.live
    if (filter === 'awaiting') return row.awaitingPromotion
    if (filter === 'attention') return !row.gate.allowed
    return true
  }), [rows, search, filter])

  if (!allowed) return null

  return (
    <div className="card space-y-4" data-testid="form-edition-evidence">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Form Edition Evidence</h2>
          <p className="text-sm text-muted-foreground mt-1">Record what USCIS officially says about which edition of a form can be filed. The system fetches the official page and checks your quote against it. Nothing here changes how forms work today: the result is shown for information and is not enforced yet.</p>
        </div>
        <button type="button" onClick={load} className="btn-secondary text-sm flex items-center gap-1 shrink-0" disabled={loading}><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="input-field w-full pl-9" placeholder="Search form or edition..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="inline-flex" role="group" aria-label="Filter editions">
            {FILTERS.map((item, index) => (
              <button key={item.key} type="button" onClick={() => setFilter(item.key)} aria-pressed={filter === item.key}
                className={`border px-3 py-1.5 text-xs font-semibold ${index === 0 ? 'rounded-l-lg' : '-ml-px'} ${index === FILTERS.length - 1 ? 'rounded-r-lg' : ''} ${filter === item.key ? 'border-primary-600 bg-primary-600 text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading editions...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Form</th><th className="py-2 pr-3">Edition</th><th className="py-2 pr-3">On file</th><th className="py-2 pr-3">Decision</th><th className="py-2 pr-3">Gate (not enforced)</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No editions match.</td></tr>}
                {visible.map((row) => (
                  <tr key={`${row.formCode}-${row.version}-${row.templateStatus}`} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium text-foreground">{row.formCode}</td>
                    <td className="py-2 pr-3">{row.editionIdentifier || <span className="text-muted-foreground">unknown</span>}{row.editionIdentifier && !row.editionDateTrusted && <span className="ml-2"><Badge tone="amber">date not verified</Badge></span>}</td>
                    <td className="py-2 pr-3"><Badge tone={row.live ? 'green' : row.awaitingPromotion ? 'amber' : 'gray'}>{row.live ? 'Live' : row.awaitingPromotion ? 'Awaiting promotion' : row.templateStatus}</Badge></td>
                    <td className="py-2 pr-3">{row.decision ? <Badge tone={row.decision.decision === 'accepted' ? 'green' : row.decision.decision === 'not_accepted' ? 'red' : 'gray'}>{DECISION_LABELS[row.decision.decision] || row.decision.decision}</Badge> : <span className="text-muted-foreground">none</span>}</td>
                    <td className="py-2 pr-3"><GateBadge gate={row.gate} /><span className="block text-xs text-muted-foreground">{reasonText(row.gate)}</span></td>
                    <td className="py-2 text-right">
                      <button type="button" className="btn-secondary text-xs" disabled={!row.canSubmitEvidence} title={row.canSubmitEvidence ? '' : 'This edition has no edition date on file'} onClick={() => setActive(row)}>Add evidence</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {active && <EvidencePanel edition={active} onClose={() => setActive(null)} onDone={() => { setActive(null); load() }} />}
    </div>
  )
}

export default FormEditionEvidenceSection
