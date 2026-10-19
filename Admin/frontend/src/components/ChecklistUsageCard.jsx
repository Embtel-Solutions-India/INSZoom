import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import api, { questionnairesApi } from '../services/api'
import ConfirmModal from './ConfirmModal'

// "Where this checklist is used" - three links, each one real and editable:
//   Visa / case types   new cases of these visas get the checklist (and each shows how many cases are open now, and the forms it feeds)
//   Forms               the forms that are filled in from this checklist's answers (the same link the Form Governance page edits)
//   Cases               the cases that hold it right now; assigning here is ONE case only, never its case type
// All the work is done by the server (questionnaires/checklist-usage.service.js); this only shows it and sends the actions.

const readMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const FORM_ASSIGNMENT_LABELS = { AUTO: 'Compulsory', CONDITIONAL: 'Conditional', EXPLICIT_CM: 'Case manager adds it' }
const ROLE_OPTIONS = [
  { value: '', label: "The checklist's own role" },
  { value: 'client', label: 'Client' },
  { value: 'employer', label: 'Employer' },
  { value: 'employee', label: 'Employee' },
  { value: 'petitioner', label: 'Petitioner' },
  { value: 'beneficiary', label: 'Beneficiary' },
  { value: 'business_plan', label: 'Business plan' },
]

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const SectionTitle = ({ children, hint }) => (
  <div className="mb-2">
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>
    {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
  </div>
)

export default function ChecklistUsageCard({ questionnaire, visaOptions = [], isPublished, onChanged }) {
  const questionnaireId = questionnaire?._id
  const [usage, setUsage] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState(null) // { tone: 'ok' | 'error', text }
  const [busy, setBusy] = useState('')

  const [visaToAdd, setVisaToAdd] = useState('')

  const [formQuery, setFormQuery] = useState('')
  const [formResults, setFormResults] = useState([])
  const [formAssignment, setFormAssignment] = useState('AUTO')
  const debouncedFormQuery = useDebounced(formQuery)

  const [caseQuery, setCaseQuery] = useState('')
  const [caseResults, setCaseResults] = useState([])
  const [pickedCase, setPickedCase] = useState(null)
  const [assignRole, setAssignRole] = useState('')
  const debouncedCaseQuery = useDebounced(caseQuery)
  const [removeCaseTarget, setRemoveCaseTarget] = useState(null)
  const [progressByCase, setProgressByCase] = useState({})
  const latestId = useRef(questionnaireId)
  latestId.current = questionnaireId

  const load = useCallback(async () => {
    if (!questionnaireId) return
    try {
      const response = await questionnairesApi.usage(questionnaireId)
      if (latestId.current === questionnaireId) { setUsage(response.data.data); setLoadError('') }
    } catch (error) {
      if (latestId.current === questionnaireId) setLoadError(readMessage(error, 'Could not load where this checklist is used.'))
    }
  }, [questionnaireId])

  useEffect(() => {
    setUsage(null); setNotice(null); setFormQuery(''); setCaseQuery(''); setPickedCase(null); setProgressByCase({})
    load()
  }, [load])

  // forms: search the registry as the admin types
  useEffect(() => {
    const text = debouncedFormQuery.trim()
    if (!questionnaireId || !text) { setFormResults([]); return undefined }
    let cancelled = false
    questionnairesApi.formOptions(questionnaireId, { q: text, limit: 12 })
      .then((response) => { if (!cancelled) setFormResults(response.data.data || []) })
      .catch(() => { if (!cancelled) setFormResults([]) })
    return () => { cancelled = true }
  }, [questionnaireId, debouncedFormQuery])

  // cases: search by case number / client as the admin types (server-side, so every case can be found - not just the first page of a list)
  useEffect(() => {
    const text = debouncedCaseQuery.trim()
    if (!text || (pickedCase && text === pickedCase.label)) { setCaseResults([]); return undefined }
    let cancelled = false
    api.get('/cases', { params: { search: text, limit: 8 } })
      .then((response) => { if (!cancelled) setCaseResults(response.data.cases || response.data.data || []) })
      .catch(() => { if (!cancelled) setCaseResults([]) })
    return () => { cancelled = true }
  }, [debouncedCaseQuery, pickedCase])

  const run = async (key, task, successText) => {
    setBusy(key)
    setNotice(null)
    try {
      await task()
      if (successText) setNotice({ tone: 'ok', text: successText })
      await load()
      onChanged?.()
    } catch (error) {
      setNotice({ tone: 'error', text: readMessage(error, 'That did not go through.') })
    } finally {
      setBusy('')
    }
  }

  const mappedCodes = new Set((usage?.visaTypes || []).map((item) => String(item.visaType).replace(/[^a-z0-9]+/gi, '').toUpperCase()))
  const availableVisas = visaOptions.filter((option) => !mappedCodes.has(option.visaType))

  const addVisa = () => run('visa', () => questionnairesApi.addVisaMapping(questionnaireId, visaToAdd).then(() => setVisaToAdd('')), `Mapped to ${visaToAdd}. New ${visaToAdd} cases get this checklist.`)
  const removeVisa = (visaType) => {
    if (!window.confirm(`Stop sending this checklist to new ${visaType} cases? Cases that already have it keep it.`)) return
    run('visa', () => questionnairesApi.removeVisaMapping(questionnaireId, visaType), `${visaType} removed. Existing cases keep the checklist.`)
  }
  const addForm = (option) => run(`form:${option.mappingId}`, () => questionnairesApi.addFormMapping(questionnaireId, { mappingId: option.mappingId, assignmentType: formAssignment }).then(() => { setFormQuery(''); setFormResults([]) }),
    `${option.formNumber} (${option.visaType}) now uses this checklist. Forms fill in from its answers through the form's field mapping.`)
  const removeForm = (form) => run(`form:${form.mappingId}`, () => questionnairesApi.removeFormMapping(questionnaireId, form.mappingId), `${form.formNumber} (${form.visaType}) no longer uses this checklist.`)
  const assignCase = () => run('assign', async () => {
    const response = await questionnairesApi.assign(questionnaireId, { caseId: pickedCase._id, targetRole: assignRole || undefined })
    setNotice({ tone: 'ok', text: response.data?.data?.alreadyAssigned ? 'That case already has this checklist.' : `Assigned to ${pickedCase.label}. Only this case gets it; a case manager reviews and approves it like any other checklist.` })
    setPickedCase(null); setCaseQuery(''); setCaseResults([])
  })
  const confirmRemoveCase = () => {
    const target = removeCaseTarget
    setRemoveCaseTarget(null)
    run(`case:${target.caseId}`, () => questionnairesApi.removeCaseChecklist(target.caseId, { checklistId: target.checklistId, reason: 'Removed from the Questionnaire page' }), `Removed from ${target.caseNumber}.`)
  }
  const loadCaseProgress = async (item) => {
    try {
      const response = await questionnairesApi.progress(questionnaireId, { caseId: item.caseId })
      setProgressByCase((prev) => ({ ...prev, [item.caseId]: response.data.data.progress?.completionPercentage ?? 0 }))
    } catch (error) {
      setProgressByCase((prev) => ({ ...prev, [item.caseId]: null }))
    }
  }

  if (!questionnaire) return null

  return (
    <div className="card space-y-5">
      <div>
        <h3 className="font-semibold text-foreground">Where this checklist is used</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Changes to the questions apply to new cases of the visa types below once published. A case keeps the version it already has. Assigning to a case affects that case only.
        </p>
      </div>

      {notice && (
        <p className={`rounded-md border px-3 py-2 text-sm ${notice.tone === 'ok' ? 'border-primary/30 bg-primary/5 text-primary' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</p>
      )}
      {loadError && <p className="text-sm text-red-700">{loadError}</p>}
      {!usage && !loadError && <p className="text-sm text-muted-foreground">Loading…</p>}

      {usage && (
        <>
          <div>
            <SectionTitle hint="New cases of these visas receive this checklist.">Visa / case types</SectionTitle>
            {usage.visaTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not mapped to any visa yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {usage.visaTypes.map((item) => (
                  <li key={item.visaType} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-medium text-foreground w-28 shrink-0">{item.visaType}</span>
                    <span className="text-xs text-muted-foreground w-24 shrink-0">{item.openCases} open case{item.openCases === 1 ? '' : 's'}</span>
                    <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground" title={item.forms.map((form) => `${form.formNumber} ${form.formName}`).join(', ')}>
                      {item.forms.length ? item.forms.map((form) => form.formNumber).join(', ') : 'No form uses it yet'}
                    </span>
                    {item.removable && (
                      <button type="button" onClick={() => removeVisa(item.visaType)} disabled={busy === 'visa'} title={`Stop sending to new ${item.visaType} cases`} className="text-muted-foreground hover:text-red-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2 max-w-lg">
              <select className="input-field text-sm" value={visaToAdd} onChange={(event) => setVisaToAdd(event.target.value)}>
                <option value="">Add a visa / case type…</option>
                {availableVisas.map((option) => <option key={option.visaType} value={option.visaType}>{option.label}</option>)}
              </select>
              <button type="button" onClick={addVisa} disabled={!visaToAdd || busy === 'visa'} className="btn-primary shrink-0 text-sm disabled:opacity-50">Add</button>
            </div>
          </div>

          <div>
            <SectionTitle hint="These forms are filled in from this checklist's answers, through each form's field mapping.">Forms</SectionTitle>
            {usage.forms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No form uses this checklist yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {usage.forms.map((form) => (
                  <li key={form.mappingId} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Link to={`/form-governance/${encodeURIComponent(form.formNumber)}`} className="font-medium text-primary hover:underline w-20 shrink-0" title="Open this form's mapping">{form.formNumber}</Link>
                    <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground" title={form.formName}>{form.formName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{form.visaType} · {FORM_ASSIGNMENT_LABELS[form.assignmentType] || form.assignmentType}</span>
                    <button type="button" onClick={() => removeForm(form)} disabled={busy === `form:${form.mappingId}`} title="Stop using this checklist for this form" className="text-muted-foreground hover:text-red-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 max-w-lg">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input className="input-field pl-9 text-sm" placeholder="Find a form to connect (e.g. I-129, H-1B)…" value={formQuery} onChange={(event) => setFormQuery(event.target.value)} />
                </div>
                <select className="input-field !w-auto text-sm" value={formAssignment} onChange={(event) => setFormAssignment(event.target.value)} title="How the checklist is sent for this form">
                  <option value="AUTO">Compulsory</option>
                  <option value="EXPLICIT_CM">Case manager adds it</option>
                </select>
              </div>
              {formResults.length > 0 && (
                <ul className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-sm divide-y divide-border">
                  {formResults.map((option) => (
                    <li key={option.mappingId}>
                      <button type="button" disabled={option.alreadyMapped || busy === `form:${option.mappingId}`} onClick={() => addForm(option)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted disabled:opacity-50 flex items-center gap-2">
                        <span className="font-medium text-foreground w-20 shrink-0">{option.formNumber}</span>
                        <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{option.formName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{option.alreadyMapped ? 'already connected' : option.visaType}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground mt-1">Connecting a form also sends this checklist to new cases of that visa type. Conditions are set on the Form Governance page.</p>
            </div>
          </div>

          <div>
            <SectionTitle hint={`${usage.totalCases} case${usage.totalCases === 1 ? '' : 's'} hold this checklist${usage.totalCases > usage.listedCases ? ` (showing the latest ${usage.listedCases})` : ''}.`}>Cases</SectionTitle>
            {usage.cases.length > 0 && (
              <ul className="max-h-64 overflow-y-auto divide-y divide-border rounded-md border border-border">
                {usage.cases.map((item) => (
                  <li key={item.caseId} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Link to={`/crm-cases/${item.caseId}`} className="font-medium text-primary hover:underline w-28 shrink-0">{item.caseNumber}</Link>
                    <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{item.clientName || '—'} · {item.visaType}</span>
                    <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
                      {progressByCase[item.caseId] === undefined
                        ? <button type="button" onClick={() => loadCaseProgress(item)} className="text-primary hover:underline">Progress</button>
                        : progressByCase[item.caseId] === null ? '—' : `${progressByCase[item.caseId]}%`}
                    </span>
                    <button type="button" onClick={() => setRemoveCaseTarget(item)} disabled={busy === `case:${item.caseId}`} title="Remove this checklist from this case" className="text-muted-foreground hover:text-red-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 max-w-lg space-y-2">
              <div className="relative">
                <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  className="input-field pl-9 text-sm"
                  placeholder="Type a case number or client name to assign this checklist to that case…"
                  value={caseQuery}
                  onChange={(event) => { setCaseQuery(event.target.value); setPickedCase(null) }}
                />
              </div>
              {caseResults.length > 0 && (
                <ul className="max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-sm divide-y divide-border">
                  {caseResults.map((item) => {
                    const label = `${item.caseNumber || item.caseId} · ${item.clientName || ''}`.trim()
                    return (
                      <li key={item._id}>
                        <button type="button" onClick={() => { setPickedCase({ _id: item._id, label }); setCaseQuery(label); setCaseResults([]) }} className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2">
                          <span className="font-medium text-foreground">{item.caseNumber || item.caseId}</span>
                          <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{item.clientName} · {item.visaType}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="flex items-center gap-2">
                <select className="input-field text-sm" value={assignRole} onChange={(event) => setAssignRole(event.target.value)} title="Which side of the case completes it">
                  {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button type="button" onClick={assignCase} disabled={!pickedCase || busy === 'assign'} className="btn-primary shrink-0 text-sm disabled:opacity-50">{busy === 'assign' ? 'Assigning…' : 'Assign to this case'}</button>
              </div>
              {isPublished === false && <p className="text-xs text-muted-foreground">This version is still a draft; it is sent to the case as it is now.</p>}
            </div>
          </div>
        </>
      )}

      {removeCaseTarget && (
        <ConfirmModal
          tone="danger"
          title={`Remove this checklist from ${removeCaseTarget.caseNumber}?`}
          message="The client no longer sees it and it is not sent again. Answers already given stay on record. Other cases are not affected."
          confirmLabel="Remove from this case"
          onConfirm={confirmRemoveCase}
          onCancel={() => setRemoveCaseTarget(null)}
        />
      )}
    </div>
  )
}
