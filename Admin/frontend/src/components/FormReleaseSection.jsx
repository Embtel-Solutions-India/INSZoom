import { useState, useEffect, useMemo, useCallback } from 'react'
import { ShieldCheck, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formGovernanceApi, formReleaseApi } from '../services/api'
import ConfirmModal from './ConfirmModal'
import FormReleasePreImagePanel, { SNAPSHOT_ROLES } from './FormReleasePreImagePanel'

// Phase 3 release safety, as a section of the Form Governance page: for one form, can its edition go live and if not why (the release gate), what moving the open case forms
// onto it would do (a dry run that writes nothing, with the frozen case forms listed), rolling an edition back, running the recovery check, and - for admins only - the saved
// copies kept before a case form was moved. Read: super_admin / admin / team_lead (the roles the API allows). Rollback and the recovery check: super_admin / admin.
export const READ_ROLES = ['super_admin', 'admin', 'team_lead']
export const CHANGE_ROLES = ['super_admin', 'admin']
export { SNAPSHOT_ROLES }
export const REASON_MIN = 10

export const DECISION_TEXT = {
  promote: { label: 'Ready to go live', tone: 'green', help: 'Every check passes.' },
  restricted_degraded: { label: 'Ready, with an approved exception', tone: 'amber', help: 'Only checks that may be overridden failed, and an admin gave a written reason.' },
  approval_required: { label: 'A person must approve the changes first', tone: 'amber', help: 'This edition changed fields that have mappings; a reviewer has to acknowledge the differences.' },
  held: { label: 'Waiting for USCIS confirmation', tone: 'amber', help: 'It is not recorded that USCIS accepts this edition yet, so it cannot go live.' },
  blocked: { label: 'Cannot go live', tone: 'red', help: 'A required check failed (or USCIS does not accept this edition).' },
}

export const CHECK_TEXT = {
  preconditions: 'Approved, field mapping active, not retired by USCIS',
  approved: 'Approved for activation',
  mapping_active: 'Field mapping is active',
  not_deprecated: 'Not a deprecated edition',
  certification: 'Test fill and correctness checks passed',
  edition_policy: 'USCIS accepts this edition',
  edition_diff: 'Changes since the previous edition reviewed',
}

const OUTCOME_TEXT = {
  pass: { label: 'OK', tone: 'green' },
  degraded: { label: 'Exception', tone: 'amber' },
  held: { label: 'Waiting', tone: 'amber' },
  approval_required: { label: 'Needs approval', tone: 'amber' },
  blocked: { label: 'Fails', tone: 'red' },
}

const errorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const Badge = ({ tone = 'gray', children, title }) => {
  const tones = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', gray: 'bg-gray-100 text-gray-700', blue: 'bg-primary/10 text-primary' }
  return <span title={title} className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${tones[tone] || tones.gray}`}>{children}</span>
}

export const DecisionBadge = ({ decision }) => {
  const info = DECISION_TEXT[decision] || { label: decision || 'Unknown', tone: 'gray', help: '' }
  return <Badge tone={info.tone} title={info.help}>{info.label}</Badge>
}

const Stat = ({ label, value, tone }) => (
  <div className="rounded-lg border border-border px-3 py-2">
    <div className={`text-lg font-semibold ${tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-foreground'}`}>{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
)

function GatePanel({ gate }) {
  const info = DECISION_TEXT[gate.decision] || {}
  return (
    <div className="space-y-2" data-testid="release-gate">
      <div className="flex flex-wrap items-center gap-2"><DecisionBadge decision={gate.decision} /> <span className="text-sm text-muted-foreground">{info.help}</span></div>
      {gate.error && gate.decision !== 'promote' && <p className="text-sm text-foreground"><strong>First thing in the way:</strong> {gate.error}</p>}
      <ul className="space-y-1 text-sm">
        {(gate.checks || []).map((check) => {
          const outcome = OUTCOME_TEXT[check.outcome] || { label: check.outcome, tone: 'gray' }
          return <li key={check.name} className="flex flex-wrap items-baseline gap-2"><Badge tone={outcome.tone}>{outcome.label}</Badge><span className="font-medium text-foreground">{CHECK_TEXT[check.name] || check.name}</span>{check.detail && <span className="text-muted-foreground">- {check.detail}</span>}</li>
        })}
      </ul>
    </div>
  )
}

function PlanPanel({ plan }) {
  const frozen = plan.frozen?.report || []
  const diff = (plan.fieldDiff || [])[0]?.summary
  return (
    <div className="space-y-3" data-testid="migration-plan">
      <p className="text-sm text-muted-foreground">If this edition goes live, the open case forms of the older edition would be moved onto it with every saved answer. This is a preview - nothing was changed.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="case forms on older editions" value={plan.considered ?? 0} />
        <Stat label="would move" value={plan.wouldMigrate ?? 0} />
        <Stat label="stay where they are (filed, locked or approved)" value={plan.frozen?.count ?? 0} />
        <Stat label="blocked - need a person" value={plan.blocked ?? 0} tone={plan.blocked ? 'red' : undefined} />
        <Stat label="answers that clash on one box" value={(plan.collisions || []).length} tone={(plan.collisions || []).length ? 'red' : undefined} />
        <Stat label="typed-in answers carried over" value={plan.protectedValuesAffected?.manualOverrides ?? 0} />
        <Stat label="reviewer-approved answers carried over" value={plan.protectedValuesAffected?.verified ?? 0} />
        <Stat label="answers with no box on the new edition (kept aside)" value={plan.archivedValues ?? 0} tone={plan.archivedValues ? 'amber' : undefined} />
      </div>
      {plan.inProgress > 0 && <p className="text-sm text-amber-800">{plan.inProgress} case form{plan.inProgress === 1 ? ' is' : 's are'} partway through an earlier move; the recovery check will finish {plan.inProgress === 1 ? 'it' : 'them'}.</p>}
      {diff && diff.totalChanges > 0 && <p className="text-sm text-muted-foreground">Form boxes changed from the older edition: {diff.added} added, {diff.removed} removed, {diff.renamed} renamed, {diff.modified} changed.</p>}
      {(plan.unresolved || []).length > 0 && (
        <p role="alert" className="text-sm text-red-700">{plan.unresolved.length} answer{plan.unresolved.length === 1 ? '' : 's'} cannot be moved safely and would keep their case form on the older edition until a person decides.</p>
      )}
      <div>
        <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Frozen case forms - they stay on the edition they were filed on ({frozen.length})</div>
        {frozen.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
          <ul className="space-y-1 text-sm" data-testid="frozen-list">
            {frozen.map((item) => (
              <li key={item.caseFormId}>
                Case <strong>{item.caseNumber || item.caseId}</strong> · {String(item.status).replace(/_/g, ' ')}{item.isLocked ? ' (locked)' : ''} · edition {item.fromEdition || '?'}
                {item.priority && <> <Badge tone="red" title="USCIS no longer accepts the edition this form was filed on">Priority</Badge></>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function FormReleaseSection({ forms: formsProp }) {
  const { user } = useAuth()
  const role = user?.role
  const allowed = READ_ROLES.includes(role)
  const canChange = CHANGE_ROLES.includes(role)
  const canSeeCopies = SNAPSHOT_ROLES.includes(role) // exactly admin
  const [catalog, setCatalog] = useState(formsProp || null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null) // { formCode, templateId, version }
  const [gate, setGate] = useState(null)
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [modalError, setModalError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rolledBack, setRolledBack] = useState(null)
  const [recovery, setRecovery] = useState('')
  const [recovering, setRecovering] = useState(false)

  useEffect(() => { if (formsProp) setCatalog(formsProp) }, [formsProp])
  useEffect(() => {
    if (!allowed || formsProp) return undefined
    let cancelled = false
    formGovernanceApi.catalog()
      .then((response) => { if (!cancelled) setCatalog(response.data.data || []) })
      .catch((err) => { if (!cancelled) setError(errorMessage(err, 'Could not load the list of forms.')) })
    return () => { cancelled = true }
  }, [allowed, formsProp])

  const options = useMemo(() => (catalog || []).filter((row) => row.templateId && !row.isSupplement).filter((row) => !search || `${row.formCode} ${row.title || ''}`.toLowerCase().includes(search.toLowerCase())), [catalog, search])

  const load = useCallback(async (row, { keepResult = false } = {}) => {
    setSelected({ formCode: row.formCode, templateId: String(row.templateId), version: row.templateVersion, status: row.templateStatus })
    setGate(null); setPlan(null); setError(''); if (!keepResult) setRolledBack(null); setLoading('gate')
    // the gate and the plan are independent: one failing never hides the other
    const [gateResult, planResult] = await Promise.allSettled([formReleaseApi.gate(String(row.templateId)), formReleaseApi.migrationPlan(row.formCode, String(row.templateId))])
    if (gateResult.status === 'fulfilled') setGate(gateResult.value.data.data); else setError(errorMessage(gateResult.reason, 'Could not read the release checks.'))
    if (planResult.status === 'fulfilled') setPlan(planResult.value.data.data); else setError((current) => current || errorMessage(planResult.reason, 'Could not preview the case-form move.'))
    setLoading('')
  }, [])

  const runRecovery = async () => {
    setRecovering(true); setRecovery('')
    try {
      const { promotions = [], migrations = {} } = (await formReleaseApi.reconcile()).data.data || {}
      const parts = []
      if (promotions.length) parts.push(`${promotions.length} interrupted edition change${promotions.length === 1 ? '' : 's'} sorted out (${promotions.map((item) => `${item.formCode}: ${String(item.outcome).replace(/_/g, ' ')}`).join('; ')})`)
      if (migrations.resumed) parts.push(`${migrations.resumed} case-form move${migrations.resumed === 1 ? '' : 's'} finished`)
      if (migrations.reconciliationRequired) parts.push(`${migrations.reconciliationRequired} case form${migrations.reconciliationRequired === 1 ? '' : 's'} need a person (newer edits were found)`)
      if (migrations.failed) parts.push(`${migrations.failed} could not be finished`)
      setRecovery(parts.length ? `Recovery check done: ${parts.join('; ')}.` : 'Recovery check done: nothing was interrupted, nothing needed fixing.')
    } catch (err) {
      setRecovery(errorMessage(err, 'The recovery check could not run.'))
    } finally {
      setRecovering(false)
    }
  }

  const rollback = async () => {
    if (reason.trim().length < REASON_MIN) { setModalError(`Write why (at least ${REASON_MIN} characters) - it is kept in the audit trail.`); return }
    setBusy(true); setModalError('')
    try {
      const report = (await formReleaseApi.rollback(selected.formCode, { reason: reason.trim() })).data.data
      setRolledBack(report); setRollbackOpen(false); setReason('')
      setNotice(`${selected.formCode} was rolled back to edition ${report.restored?.version}.`)
      const row = (catalog || []).find((item) => item.formCode === selected.formCode)
      if (row) load({ ...row, templateId: report.restored?.id || row.templateId, templateVersion: report.restored?.version, templateStatus: 'active' }, { keepResult: true })
    } catch (err) {
      setModalError(errorMessage(err, 'The rollback was refused.'))
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) return null

  return (
    <div className="card space-y-5" data-testid="form-release">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Release Safety</h2>
          <p className="text-sm text-muted-foreground mt-1">Before a new USCIS edition goes live: are all the checks green, and what would happen to the cases already open? Pick a form to see. Nothing on this page changes anything until you confirm an action.</p>
        </div>
        {canChange && <button type="button" className="btn-secondary text-sm flex items-center gap-1 shrink-0" onClick={runRecovery} disabled={recovering}><RefreshCw className="w-4 h-4" /> {recovering ? 'Checking...' : 'Run recovery check'}</button>}
      </div>
      {recovery && <p role="status" className="text-sm text-foreground">{recovery}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

      <div className="space-y-2">
        <label className="relative block max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="input w-full pl-8" placeholder="Search forms (e.g. I-131)" aria-label="Search forms" />
        </label>
        {catalog === null ? <p className="text-sm text-muted-foreground">Loading forms...</p> : (
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label="Forms">
            {options.length === 0 && <span className="text-sm text-muted-foreground">No forms match.</span>}
            {options.map((row) => (
              <button key={row.formCode} type="button" onClick={() => load(row)} aria-pressed={selected?.formCode === row.formCode}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${selected?.formCode === row.formCode ? 'border-primary-600 bg-primary-600 text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>{row.formCode}</button>
            ))}
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {selected && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-foreground">{selected.formCode} <span className="font-normal text-muted-foreground">edition {selected.version || '?'}{selected.status ? ` (${String(selected.status).replace(/_/g, ' ')})` : ''}</span></h3>
          {loading ? <p className="text-sm text-muted-foreground">Checking...</p> : (
            <>
              {gate && <GatePanel gate={gate} />}
              {plan && <PlanPanel plan={plan} />}
            </>
          )}
          {canChange && (
            <div className="border-t border-border pt-3">
              <button type="button" className="btn-secondary text-sm flex items-center gap-1" onClick={() => { setRollbackOpen(true); setReason(''); setModalError('') }}><RotateCcw className="w-4 h-4" /> Roll {selected.formCode} back to the previous edition</button>
              <p className="mt-1 text-xs text-muted-foreground">Puts the last certified edition back as the live one. Case forms are not moved back.</p>
            </div>
          )}
          {rolledBack && (
            <div role="status" className="rounded-lg bg-muted/40 p-3 text-sm space-y-1" data-testid="rollback-result">
              <p><strong>Rolled back:</strong> {rolledBack.formCode} edition {rolledBack.restored?.version} is live again (it replaced {rolledBack.replaced?.version || 'nothing'}).</p>
              {(rolledBack.caseFormsToReconcile || []).length === 0 ? <p className="text-muted-foreground">No case form was on the replaced edition.</p> : (
                <>
                  <p className="text-amber-800">{rolledBack.caseFormsToReconcile.length} case form{rolledBack.caseFormsToReconcile.length === 1 ? ' is' : 's are'} still on the replaced edition and need an admin to reconcile {rolledBack.caseFormsToReconcile.length === 1 ? 'it' : 'them'}:</p>
                  <ul className="list-disc pl-5" data-testid="reconcile-list">{rolledBack.caseFormsToReconcile.map((item) => <li key={item.caseFormId}>Case form {item.caseFormId} (case {item.caseId}) · {String(item.status).replace(/_/g, ' ')}</li>)}</ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {canSeeCopies && <FormReleasePreImagePanel />}

      {rollbackOpen && selected && (
        <ConfirmModal
          title={`Roll ${selected.formCode} back?`}
          message={`The previous certified edition of ${selected.formCode} will become the live one again. The same safety checks apply, and it only works if USCIS still accepts that edition.\n\nCase forms are NOT moved back (that could lose answers entered since). After the rollback you get a list of the case forms still on the replaced edition so an admin can reconcile them.`}
          confirmLabel="Yes, roll back"
          tone="danger"
          busy={busy}
          error={modalError}
          onConfirm={rollback}
          onCancel={() => { if (!busy) setRollbackOpen(false) }}
        >
          <label className="mt-3 block text-left text-sm">
            <span className="block text-xs font-medium text-muted-foreground mb-1">Why? (required - kept in the audit trail)</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="input w-full" rows={3} />
          </label>
        </ConfirmModal>
      )}
    </div>
  )
}
