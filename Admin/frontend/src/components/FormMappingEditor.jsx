import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2, Play, CheckCircle2, AlertTriangle } from 'lucide-react'
import { formGovernanceApi } from '../services/api'
import ConfirmModal from './ConfirmModal'

// Form Governance: the "Used by these case types" table, editable. One row = one visa type -> this form registry row. An admin can change how the
// form is assigned, which checklist(s) it sends, whether each checklist is compulsory / conditional / added by a case manager, and the condition.
// Everything is validated and stored by the server (PUT /form-registry/mappings/:id/checklists); "Apply to cases in progress" then gives the change to
// the cases already open for that visa type (previewed first), while new cases pick it up on their own.

const readErrorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

export const FORM_ASSIGNMENTS = [
  { value: 'AUTO_CREATE', label: 'Automatic — created on the case immediately' },
  { value: 'CONDITIONAL', label: 'Conditional — added when it applies' },
  { value: 'LATER_STAGE', label: 'Later stage — added at a later step' },
  { value: 'REFERENCE', label: 'Reference only' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable' },
]

export const CHECKLIST_ASSIGNMENTS = [
  { value: 'AUTO', label: 'Compulsory — sent automatically', short: 'Compulsory', tip: 'Sent to every case of this visa type automatically' },
  { value: 'CONDITIONAL', label: 'Conditional — only when its condition is met', short: 'Conditional', tip: 'Sent only while its condition is true for the case' },
  { value: 'EXPLICIT_CM', label: 'Case manager adds it', short: 'Case manager adds', tip: 'Never automatic — a case manager adds it by hand' },
]

const ROLE_OPTIONS = [
  { value: '', label: 'Any role' },
  { value: 'employer', label: 'Employer' },
  { value: 'employee', label: 'Employee' },
  { value: 'petitioner', label: 'Petitioner' },
  { value: 'beneficiary', label: 'Beneficiary' },
  { value: 'joint_sponsor', label: 'Joint sponsor' },
  { value: 'client', label: 'Client' },
  { value: 'business_plan', label: 'Business plan' },
  { value: 'supporting_documents', label: 'Supporting documents' },
]

// The only case fields a condition may use (the server enforces the same list).
const CONDITION_FIELDS = [
  { value: 'visaType', label: 'Visa type' },
  { value: 'visaCategory', label: 'Visa category' },
  { value: 'caseType', label: 'Case type' },
  { value: 'petitionType', label: 'Petition type' },
  { value: 'petitionSubType', label: 'Petition sub-type' },
  { value: 'processingPath', label: 'Filing path' },
  { value: 'premiumProcessing', label: 'Premium processing requested', boolean: true },
  { value: 'attorneyOnRecord', label: 'Attorney of record', boolean: true },
  { value: 'newOfficePetition', label: 'New office petition', boolean: true },
  { value: 'hasJointSponsor', label: 'Joint sponsor added', boolean: true },
]
const FIELD_BY_VALUE = Object.fromEntries(CONDITION_FIELDS.map((field) => [field.value, field]))
const PROCESSING_PATHS = ['CONSULAR', 'ADJUSTMENT_OF_STATUS', 'CHANGE_OF_STATUS', 'EXTENSION_OF_STATUS', 'PETITION_ONLY', 'EMPLOYMENT_AUTHORIZATION', 'TRAVEL_DOCUMENT', 'POST_APPROVAL', 'NVC', 'OTHER']
const OPERATORS = [
  { value: 'equals', label: 'is' },
  { value: 'notEquals', label: 'is not' },
  { value: 'in', label: 'is one of' },
  { value: 'notIn', label: 'is not one of' },
  { value: 'exists', label: 'has a value / is empty' },
]

const newRule = () => ({ field: 'processingPath', operator: 'equals', value: '' })

// stored tree -> editor model. A tree the editor cannot represent (nested groups) is kept untouched (`raw`) and only replaced if the admin edits it.
function conditionToUi(node) {
  if (!node) return { mode: 'all', rules: [], raw: null }
  const mode = Array.isArray(node.all) ? 'all' : Array.isArray(node.any) ? 'any' : null
  if (!mode) return { mode: 'all', rules: [{ ...node }], raw: null }
  const children = node[mode]
  if (children.every((child) => child && child.field)) return { mode, rules: children.map((child) => ({ ...child })), raw: null }
  return { mode, rules: [], raw: node }
}

function conditionFromUi(ui) {
  if (!ui) return null
  if (ui.raw) return ui.raw
  const rules = (ui.rules || []).filter((rule) => rule.field).map((rule) => ({ field: rule.field, operator: rule.operator, value: rule.value }))
  if (!rules.length) return null
  return rules.length === 1 ? rules[0] : { [ui.mode]: rules }
}

const valueText = (value) => (Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value ?? ''))

export function conditionSummary(node) {
  if (!node) return ''
  if (Array.isArray(node.all) || Array.isArray(node.any)) {
    const mode = Array.isArray(node.all) ? 'all' : 'any'
    return node[mode].map(conditionSummary).join(mode === 'all' ? ' AND ' : ' OR ')
  }
  const label = FIELD_BY_VALUE[node.field]?.label || node.field
  const operator = { equals: 'is', notEquals: 'is not', in: 'is one of', notIn: 'is not one of' }[node.operator]
  if (node.operator === 'exists') return `${label} ${node.value ? 'has a value' : 'is empty'}`
  return `${label} ${operator || node.operator} ${valueText(node.value)}`
}

function ConditionEditor({ value, onChange, disabled }) {
  const rules = value.rules || []
  const update = (index, patch) => onChange({ ...value, raw: null, rules: rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) })
  if (value.raw) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        This condition combines several groups: {conditionSummary(value.raw)}.{' '}
        <button type="button" className="underline" disabled={disabled} onClick={() => onChange({ mode: 'all', rules: [newRule()], raw: null })}>Replace it with a simple condition</button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {rules.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Applies when
          <select className="input-field !w-auto !py-1 text-xs" value={value.mode} disabled={disabled} onChange={(event) => onChange({ ...value, mode: event.target.value })}>
            <option value="all">all of these are true</option>
            <option value="any">any of these is true</option>
          </select>
        </label>
      )}
      {rules.map((rule, index) => {
        const field = FIELD_BY_VALUE[rule.field] || {}
        const isBoolean = Boolean(field.boolean)
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select className="input-field !w-auto !py-1 text-sm" value={rule.field} disabled={disabled} onChange={(event) => {
              const next = FIELD_BY_VALUE[event.target.value]
              update(index, { field: event.target.value, operator: 'equals', value: next?.boolean ? true : '' })
            }}>
              {CONDITION_FIELDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {isBoolean ? (
              <select className="input-field !w-auto !py-1 text-sm" value={String(rule.value === true || rule.value === 'true')} disabled={disabled} onChange={(event) => update(index, { operator: 'equals', value: event.target.value === 'true' })}>
                <option value="true">is yes</option>
                <option value="false">is no</option>
              </select>
            ) : (
              <>
                <select className="input-field !w-auto !py-1 text-sm" value={rule.operator} disabled={disabled} onChange={(event) => update(index, { operator: event.target.value, value: event.target.value === 'exists' ? true : (event.target.value === 'in' || event.target.value === 'notIn') ? valueText(rule.value) : (Array.isArray(rule.value) ? rule.value.join(', ') : rule.value) })}>
                  {OPERATORS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {rule.operator === 'exists' ? (
                  <select className="input-field !w-auto !py-1 text-sm" value={String(rule.value === true || rule.value === 'true')} disabled={disabled} onChange={(event) => update(index, { value: event.target.value === 'true' })}>
                    <option value="true">has a value</option>
                    <option value="false">is empty</option>
                  </select>
                ) : (
                  <>
                    <input
                      className="input-field !w-56 !py-1 text-sm"
                      list={rule.field === 'processingPath' ? 'form-mapping-processing-paths' : undefined}
                      placeholder={rule.operator === 'in' || rule.operator === 'notIn' ? 'value, value, …' : 'value'}
                      value={valueText(rule.value)}
                      disabled={disabled}
                      onChange={(event) => update(index, { value: event.target.value })}
                    />
                  </>
                )}
              </>
            )}
            <button type="button" className="p-1 text-muted-foreground hover:text-red-600 disabled:opacity-50" disabled={disabled} onClick={() => onChange({ ...value, rules: rules.filter((_, i) => i !== index) })} aria-label="Remove rule">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
      <datalist id="form-mapping-processing-paths">{PROCESSING_PATHS.map((path) => <option key={path} value={path} />)}</datalist>
      <button type="button" className="text-xs font-medium text-primary hover:underline disabled:opacity-50" disabled={disabled} onClick={() => onChange({ ...value, raw: null, rules: [...rules, newRule()] })}>
        + Add a rule
      </button>
    </div>
  )
}

const draftFromAssociation = (assoc) => ({
  provisioningType: assoc.provisioningType,
  trigger: conditionToUi(assoc.triggerCondition),
  checklists: (assoc.checklistMappings || []).map((entry) => ({
    checklistKey: entry.checklistKey,
    role: entry.role || '',
    assignmentType: entry.assignmentType,
    condition: conditionToUi(entry.condition),
    notes: entry.notes || '',
  })),
})

function ChecklistChips({ assoc }) {
  if (!assoc.checklistMappings?.length) return <span className="text-muted-foreground">No checklist mapped yet</span>
  const tone = { AUTO: 'bg-green-100 text-green-800', CONDITIONAL: 'bg-amber-100 text-amber-800', EXPLICIT_CM: 'bg-primary/10 text-primary' }
  return (
    <div className="flex flex-wrap gap-1">
      {assoc.checklistMappings.map((entry, index) => {
        const kind = CHECKLIST_ASSIGNMENTS.find((item) => item.value === entry.assignmentType)
        const when = entry.assignmentType === 'CONDITIONAL' && entry.condition ? ` — ${conditionSummary(entry.condition)}` : ''
        return (
          <span key={`${entry.checklistKey}-${entry.role}-${index}`} className={`px-2 py-0.5 rounded text-xs ${tone[entry.assignmentType] || 'bg-gray-100 text-gray-700'}`} title={`${kind?.tip || ''}${when}`}>
            {entry.title || entry.checklistKey}{entry.role ? ` (${entry.role})` : ''} · {kind?.short || entry.assignmentType}{when}
          </span>
        )
      })}
    </div>
  )
}

function RowEditor({ assoc, formCode, checklistOptions, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => draftFromAssociation(assoc))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null) // { autofill }
  const [apply, setApply] = useState({ state: 'idle' }) // idle | counting | ready | running | done | error

  const optionByKey = useMemo(() => new Map(checklistOptions.map((option) => [option.key, option])), [checklistOptions])
  const setChecklist = (index, patch) => setDraft((prev) => ({ ...prev, checklists: prev.checklists.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) }))
  const changed = saved === null // after a save the form is read-only until reopened

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        provisioningType: draft.provisioningType,
        triggerCondition: conditionFromUi(draft.trigger),
        checklistMappings: draft.checklists.map((entry) => ({
          checklistKey: entry.checklistKey,
          role: entry.role,
          assignmentType: entry.assignmentType,
          condition: entry.assignmentType === 'CONDITIONAL' ? conditionFromUi(entry.condition) : null,
          notes: entry.notes,
        })),
      }
      const response = await formGovernanceApi.updateMappingChecklists(assoc.mappingId, payload)
      setSaved({ autofill: response.data.data.autofill || {} })
      setApply({ state: 'idle' })
      onSaved(`${formCode} · ${assoc.visaType}: saved. New cases use it from now on.`)
    } catch (err) {
      setError(readErrorMessage(err, 'Could not save this mapping.'))
    } finally {
      setSaving(false)
    }
  }

  const countCases = async () => {
    setApply({ state: 'counting' })
    try {
      const response = await formGovernanceApi.applyMappingToCases(assoc.mappingId, { dryRun: true })
      setApply({ state: 'ready', total: response.data.data.total })
    } catch (err) {
      setApply({ state: 'error', message: readErrorMessage(err, 'Could not count the open cases.') })
    }
  }

  const applyToCases = async () => {
    setApply((prev) => ({ ...prev, state: 'running', processed: 0, failed: [] }))
    let cursor
    let processed = 0
    let formsAdded = 0
    let formsAutofilled = 0
    const failed = []
    try {
      // pages of cases, so one request never runs long; every page is idempotent (a checklist or form a case already has is never added twice)
      for (;;) {
        const response = await formGovernanceApi.applyMappingToCases(assoc.mappingId, { dryRun: false, cursor, limit: 20 })
        const result = response.data.data
        processed += result.processed
        formsAdded += result.formsAdded || 0
        formsAutofilled += result.formsAutofilled || 0
        failed.push(...(result.failed || []))
        setApply((prev) => ({ ...prev, state: 'running', processed, failed: [...failed] }))
        if (result.done || !result.nextCursor) break
        cursor = result.nextCursor
      }
      setApply((prev) => ({ ...prev, state: 'done', processed, formsAdded, formsAutofilled, failed }))
    } catch (err) {
      setApply((prev) => ({ ...prev, state: 'error', message: readErrorMessage(err, 'Stopped part-way. Nothing is duplicated if you run it again.'), processed, failed }))
    }
  }

  const hasAutomatic = draft.checklists.some((entry) => entry.assignmentType !== 'EXPLICIT_CM')

  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div>
        <div className="font-medium text-foreground">{assoc.visaType} → {formCode}</div>
        <p className="text-xs text-muted-foreground">Cases of this visa type use these settings. The form is filled in from the checklist answers through the field mapping below.</p>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">How this form is added to a case</label>
        <select className="input-field !w-auto text-sm" value={draft.provisioningType} disabled={!changed || saving} onChange={(event) => setDraft((prev) => ({ ...prev, provisioningType: event.target.value }))}>
          {FORM_ASSIGNMENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Only when (optional condition for the form itself)</div>
          <ConditionEditor value={draft.trigger} disabled={!changed || saving} onChange={(trigger) => setDraft((prev) => ({ ...prev, trigger }))} />
          {!draft.trigger.rules.length && !draft.trigger.raw && <p className="text-xs text-muted-foreground">No condition — it applies to every case of this visa type (and filing path).</p>}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground">Checklists sent to the client for this form</div>
        {!draft.checklists.length && <p className="text-sm text-muted-foreground">No checklist yet — add one so the client can provide the information this form needs.</p>}
        {draft.checklists.map((entry, index) => {
          const known = optionByKey.has(entry.checklistKey)
          const summary = saved?.autofill?.[entry.checklistKey]
          return (
            <div key={index} className="rounded border border-border bg-card p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select className="input-field !w-72 max-w-full text-sm" value={entry.checklistKey} disabled={!changed || saving} onChange={(event) => setChecklist(index, { checklistKey: event.target.value })}>
                  <option value="">Choose a checklist…</option>
                  {!known && entry.checklistKey && <option value={entry.checklistKey}>{entry.checklistKey}</option>}
                  {checklistOptions.map((option) => <option key={option.key} value={option.key}>{option.title}{option.checklistRole ? ` (${option.checklistRole})` : ''}</option>)}
                </select>
                <select className="input-field !w-auto text-sm" value={entry.role} disabled={!changed || saving} onChange={(event) => setChecklist(index, { role: event.target.value })} title="Which side of the filing completes it">
                  {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select className="input-field !w-auto text-sm" value={entry.assignmentType} disabled={!changed || saving} onChange={(event) => setChecklist(index, { assignmentType: event.target.value, condition: event.target.value === 'CONDITIONAL' && !entry.condition.rules.length ? { mode: 'all', rules: [newRule()], raw: null } : entry.condition })}>
                  {CHECKLIST_ASSIGNMENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button type="button" className="ml-auto p-1.5 rounded text-red-600 hover:bg-red-50 disabled:opacity-50" disabled={!changed || saving} onClick={() => setDraft((prev) => ({ ...prev, checklists: prev.checklists.filter((_, i) => i !== index) }))} title="Remove this checklist from the form">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {entry.assignmentType === 'CONDITIONAL' && (
                <div className="pl-1">
                  <div className="text-xs text-muted-foreground mb-1">Send this checklist only when</div>
                  <ConditionEditor value={entry.condition} disabled={!changed || saving} onChange={(condition) => setChecklist(index, { condition })} />
                </div>
              )}
              {summary?.checked && (
                summary.fields > 0 ? (
                  <p className="flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Fills {summary.fields} field{summary.fields === 1 ? '' : 's'} of {formCode} from {summary.questions} checklist question{summary.questions === 1 ? '' : 's'}.</p>
                ) : (
                  <p className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> None of this checklist's questions reach a field of {formCode} yet, so it will not autofill anything. Map its questions to the form's fields first.</p>
                )
              )}
            </div>
          )
        })}
        <button type="button" className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50" disabled={!changed || saving} onClick={() => setDraft((prev) => ({ ...prev, checklists: [...prev.checklists, { checklistKey: '', role: '', assignmentType: 'AUTO', condition: { mode: 'all', rules: [], raw: null }, notes: '' }] }))}>
          <Plus className="h-4 w-4" /> Add checklist
        </button>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {changed ? (
          <>
            <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={saving || draft.checklists.some((entry) => !entry.checklistKey)} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn-secondary text-sm" disabled={saving} onClick={onClose}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>Close</button>
        )}
      </div>

      {saved && (
        <div className="rounded border border-border bg-card p-3 space-y-2">
          <div className="text-sm font-medium text-foreground">Cases already in progress</div>
          <p className="text-xs text-muted-foreground">
            New {assoc.visaType} cases already use these settings. To give the checklists to the open {assoc.visaType} cases too, apply them here. A checklist a case already has is never added twice, and nothing is taken away from a case that already has it.
            {hasAutomatic ? '' : ' (Only compulsory and condition-met checklists are added; "case manager adds it" ones are never automatic.)'}
          </p>
          {apply.state === 'idle' && <button type="button" className="btn-secondary text-sm flex items-center gap-1" onClick={countCases}><Play className="h-4 w-4" /> Check open cases</button>}
          {apply.state === 'counting' && <p className="text-sm text-muted-foreground">Counting open cases…</p>}
          {apply.state === 'ready' && (
            apply.total ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">{apply.total} open {assoc.visaType} case{apply.total === 1 ? '' : 's'}.</span>
                <button type="button" className="btn-primary text-sm" onClick={applyToCases}>Apply to {apply.total} case{apply.total === 1 ? '' : 's'}</button>
                <span className="text-xs text-muted-foreground">Cases that need approval first send the checklist to their case manager; others notify the client.</span>
              </div>
            ) : <p className="text-sm text-muted-foreground">No open {assoc.visaType} cases — nothing to apply.</p>
          )}
          {apply.state === 'running' && <p className="text-sm text-foreground">Applying… {apply.processed || 0} case{apply.processed === 1 ? '' : 's'} done.</p>}
          {apply.state === 'done' && (
            <p className="text-sm text-green-700">Applied to {apply.processed} case{apply.processed === 1 ? '' : 's'}: {apply.formsAdded || 0} form{apply.formsAdded === 1 ? '' : 's'} added to cases, {apply.formsAutofilled || 0} auto-filled from the checklist data (cases with unresolved data conflicts get the form but are not auto-filled until the conflict is resolved).{apply.failed?.length ? ` ${apply.failed.length} could not be updated: ${apply.failed.map((item) => item.caseNumber || item.caseId).join(', ')}.` : ''}</p>
          )}
          {apply.state === 'error' && <p className="text-sm text-red-700">{apply.message}</p>}
        </div>
      )}
    </div>
  )
}

const FormMappingEditor = ({ formCode, templateId, associations, isAdmin, associationLabel, onChanged }) => {
  const [editingId, setEditingId] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null) // the case type waiting for the remove confirmation
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState(null)
  const [checklistOptions, setChecklistOptions] = useState([])
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (!isAdmin || !editingId || checklistOptions.length) return
    formGovernanceApi.checklistOptions()
      .then((response) => setChecklistOptions(response.data.data || []))
      .catch(() => setChecklistOptions([]))
  }, [isAdmin, editingId, checklistOptions.length])

  const confirmRemove = async () => {
    if (!removeTarget || !templateId) return
    setRemoving(true)
    setRemoveError(null)
    try {
      await formGovernanceApi.removeCaseType(templateId, removeTarget.mappingId)
      setMessage(`${removeTarget.visaType} was removed from ${formCode}. New ${removeTarget.visaType} cases no longer get this form or its checklists.`)
      setRemoveTarget(null)
      setEditingId(null)
      onChanged?.()
    } catch (err) {
      setRemoveError(readErrorMessage(err, 'Could not remove this case type.'))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div>
      {removeTarget && (
        <ConfirmModal
          tone="danger"
          title={`Remove ${removeTarget.visaType} from ${formCode}?`}
          message={`New ${removeTarget.visaType} cases will no longer get ${formCode} or the checklists mapped to it here. Cases that already have the form keep it, with everything entered so far.${removeError ? ` ${removeError}` : ''}`}
          confirmLabel="Remove case type"
          busy={removing}
          onConfirm={confirmRemove}
          onCancel={() => { setRemoveTarget(null); setRemoveError(null) }}
        />
      )}
      {message && <p className="mb-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground uppercase">
              <th className="pr-4 py-1">Case type</th>
              <th className="pr-4 py-1">Assignment</th>
              <th className="pr-4 py-1">Checklist(s) sent to the client</th>
              {isAdmin && <th className="py-1" />}
            </tr>
          </thead>
          <tbody>
            {associations.map((assoc, index) => {
              const rowId = assoc.mappingId || `${assoc.visaType}-${index}`
              const isEditing = editingId === rowId
              return (
                <tr key={rowId} className="border-t align-top">
                  <td className="pr-4 py-2 font-medium text-foreground whitespace-nowrap">
                    {assoc.visaType}
                    {assoc.adminManaged && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title="Changed by an admin on this page">Edited</span>}
                  </td>
                  <td className="pr-4 py-2">
                    <div className="whitespace-nowrap">{associationLabel(assoc)}</div>
                    {assoc.triggerCondition && <div className="text-xs text-muted-foreground max-w-[14rem]">when {conditionSummary(assoc.triggerCondition)}</div>}
                  </td>
                  <td className="pr-4 py-2">
                    <ChecklistChips assoc={assoc} />
                    {isEditing && (
                      <RowEditor
                        assoc={assoc}
                        formCode={formCode}
                        checklistOptions={checklistOptions}
                        onClose={() => { setEditingId(null); onChanged?.() }}
                        onSaved={(text) => { setMessage(text); onChanged?.({ keepOpen: true }) }}
                      />
                    )}
                  </td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      {assoc.mappingId && !isEditing && (
                        <div className="flex flex-nowrap items-center justify-end gap-1.5">
                          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted" onClick={() => { setMessage(null); setEditingId(rowId) }}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button type="button" className="inline-flex items-center rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:border-red-300 hover:bg-red-50 hover:text-red-600" title={`Remove ${assoc.visaType} from ${formCode}`} aria-label={`Remove ${assoc.visaType}`} onClick={() => { setMessage(null); setRemoveTarget(assoc) }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default FormMappingEditor
