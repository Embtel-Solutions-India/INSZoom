import { Fragment, useState, useEffect, useMemo, useCallback } from 'react'
import { ShieldCheck, Search, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formEditionPolicyApi } from '../services/api'

// Releases 0b-1 / 0b-2: USCIS form-edition acceptance, shown as a section of the Form Governance page. Exactly admin and team_lead can see it
// (Form Governance only renders it for them, it checks the role itself, and the API uses the same two roles). Nobody submits evidence by hand:
// "Check now" asks the backend to fetch the official USCIS page and it records a decision only when the page explicitly says so.
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

const DECISION_LABELS = { accepted: 'Accepted for filing', not_accepted: 'Not accepted', held: 'On hold' }

// What the automatic check found. Nobody types a URL or a quote: the system finds the official page, fetches it and looks for an explicit statement.
const OUTCOME_TEXT = {
  accepted: { tone: 'green', text: "USCIS's page explicitly says this edition is accepted. It was recorded as accepted for filing." },
  not_accepted: { tone: 'red', text: "USCIS's page says this edition is NOT accepted. It was recorded as not accepted and will not be activated." },
  unchanged: { tone: 'gray', text: 'Already checked recently - nothing changed.' },
  no_explicit_statement: { tone: 'amber', text: "USCIS's page has no explicit statement about this edition, so nothing was recorded. The edition stays on hold." },
  held_unverified: { tone: 'amber', text: 'A statement was found but could not be fully verified against the page, so nothing was recorded. The edition stays on hold.' },
  no_official_page: { tone: 'amber', text: 'No official USCIS page is on file for this form, so it could not be checked.' },
  fetch_failed: { tone: 'amber', text: 'The USCIS page could not be fetched right now. Nothing was recorded - try again later.' },
  no_template: { tone: 'amber', text: 'This edition is no longer on file.' },
  edition_date_not_trusted: { tone: 'amber', text: 'The edition date on file is not verified, so it cannot be checked automatically.' },
  supplement_not_listed: { tone: 'amber', text: "The parent form's USCIS page does not list this supplement, and no official PDF could be read for it. Nothing was recorded." },
  official_pdf_edition_differs: { tone: 'amber', text: 'The official PDF on uscis.gov prints a different edition than the one on file, so this edition is not the current one. Nothing was recorded.' },
  locked_not_accepted: { tone: 'red', text: 'This edition is already recorded as not accepted and cannot be changed automatically.' },
}

export const outcomeOf = (result) => OUTCOME_TEXT[result?.outcome] || { tone: 'amber', text: 'The check finished without a result. Nothing was recorded.' }

export function GateBadge({ gate }) {
  if (!gate) return null
  if (gate.allowed) return <Badge tone="green">Allowed</Badge>
  if (gate.decision === 'not_accepted') return <Badge tone="red">Blocked: not accepted</Badge>
  if (gate.decision === 'grandfathered') return <Badge tone="gray">Serve-only</Badge>
  return <Badge tone="amber">On hold</Badge>
}

const reasonText = (gate) => (gate?.reasons || []).map((reason) => REASON_LABELS[reason] || reason).join('; ')

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'awaiting', label: 'Awaiting promotion' },
  { key: 'attention', label: 'Needs evidence' },
]

const keyOf = (row) => `${row.formCode}|${row.editionIdentifier}`

const FormEditionEvidenceSection = () => {
  const { user } = useAuth()
  const allowed = EVIDENCE_ROLES.includes(user?.role)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [checking, setChecking] = useState('')
  const [outcomes, setOutcomes] = useState({})

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

  const checkNow = async (row) => {
    const key = keyOf(row)
    setChecking(key)
    try {
      const response = await formEditionPolicyApi.autoCheck(row.formCode, row.editionIdentifier)
      setOutcomes((current) => ({ ...current, [key]: response.data.data }))
      await load()
    } catch (err) {
      setOutcomes((current) => ({ ...current, [key]: { outcome: 'error', message: errorMessage(err, 'Could not run the check. Please try again.') } }))
    } finally {
      setChecking('')
    }
  }

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
          <p className="text-sm text-muted-foreground mt-1">The system reads USCIS&apos;s own page for each form and records an edition as accepted (or not accepted) only when the page says so explicitly. You do not enter anything. A new edition is not made live until it is accepted; editions already live keep working.</p>
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
                  <th className="py-2 pr-3">Form</th><th className="py-2 pr-3">Edition</th><th className="py-2 pr-3">On file</th><th className="py-2 pr-3">Decision</th><th className="py-2 pr-3">Gate</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No editions match.</td></tr>}
                {visible.map((row) => {
                  const outcome = outcomes[keyOf(row)]
                  const shown = outcomeOf(outcome)
                  return (
                    <Fragment key={`${row.formCode}-${row.version}-${row.templateStatus}`}>
                      <tr className="border-t border-border">
                        <td className="py-2 pr-3 font-medium text-foreground">{row.formCode}</td>
                        <td className="py-2 pr-3">{row.editionIdentifier || <span className="text-muted-foreground">unknown</span>}{row.editionIdentifier && !row.editionDateTrusted && <span className="ml-2"><Badge tone="amber">date not verified</Badge></span>}</td>
                        <td className="py-2 pr-3"><Badge tone={row.live ? 'green' : row.awaitingPromotion ? 'amber' : 'gray'}>{row.live ? 'Live' : row.awaitingPromotion ? 'Awaiting promotion' : row.templateStatus}</Badge></td>
                        <td className="py-2 pr-3">{row.decision ? <Badge tone={row.decision.decision === 'accepted' ? 'green' : row.decision.decision === 'not_accepted' ? 'red' : 'gray'}>{DECISION_LABELS[row.decision.decision] || row.decision.decision}</Badge> : <span className="text-muted-foreground">none</span>}</td>
                        <td className="py-2 pr-3"><GateBadge gate={row.gate} /><span className="block text-xs text-muted-foreground">{reasonText(row.gate)}</span></td>
                        <td className="py-2 text-right">
                          <button type="button" className="btn-secondary text-xs" disabled={!row.canSubmitEvidence || Boolean(checking)} title={row.canSubmitEvidence ? '' : 'This edition has no edition date on file'} onClick={() => checkNow(row)}>{checking === keyOf(row) ? 'Checking...' : 'Check now'}</button>
                        </td>
                      </tr>
                      {outcome && (
                        <tr data-testid="check-outcome">
                          <td colSpan={6} className="pb-2">
                            {outcome.outcome === 'error'
                              ? <p role="alert" className="text-sm text-red-600">{outcome.message}</p>
                              : <p className="text-sm"><Badge tone={shown.tone}>Check result</Badge> <span className="text-muted-foreground">{shown.text}</span>{outcome.sourceUrl && <span className="text-xs text-muted-foreground"> Source: {outcome.sourceUrl}</span>}</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default FormEditionEvidenceSection
