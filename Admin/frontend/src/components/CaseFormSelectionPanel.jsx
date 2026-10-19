import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, X, Trash2, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import { caseFormsApi, questionnairesApi } from '../services/api'

// Case Manager control over a case's USCIS forms. The Case Manager types a form (number or name), adds it, and sees how the case's checklists feed it; changes are
// staged, reviewed, then applied in one atomic request. The server decides everything (selectability, dependencies, confirmation, revision) - this only presents it.

const readError = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const AVAILABILITY = {
  ready: { label: 'Ready', dot: 'bg-emerald-500' },
  mapping_incomplete: { label: 'Mapping incomplete', dot: 'bg-amber-500' },
  no_template: { label: 'Template not imported', dot: 'bg-slate-300' },
  not_eligible: { label: 'Not available', dot: 'bg-red-500' },
}
const availabilityOf = (entry) => (entry.availability !== 'ready' && entry.availability !== 'not_eligible' && entry.provisionable === false && entry.availability !== 'no_template'
  ? { label: 'Awaiting activation', dot: 'bg-amber-500' }
  : AVAILABILITY[entry.availability] || AVAILABILITY.no_template)

const Status = ({ state }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
    <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} aria-hidden="true" />{state.label}
  </span>
)

// One form, on two lines, that can never overlap its neighbours: the main line is the form number (or, for a component, its plain name), the second line the title
// (or "part of I-129"). Both truncate; the full text is in the tooltip.
function FormLabel({ formCode, componentCode, parentFormCode, title, muted = false }) {
  const isComponent = Boolean(componentCode)
  const main = isComponent ? (title || formCode) : formCode
  const second = isComponent ? `Part of ${parentFormCode || 'its parent form'}` : (title && title !== formCode ? title : '')
  return (
    <div className="min-w-0 flex-1" title={`${main}${second ? ` - ${second}` : ''}`}>
      <div className={`truncate text-sm font-medium ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{main}</div>
      {second && <div className="truncate text-xs text-muted-foreground">{second}</div>}
    </div>
  )
}

function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer) }, [value, delay])
  return debounced
}

const needsConfirm = (item) => Boolean(item.caseFormStatus) && (!['pending', 'archived'].includes(item.caseFormStatus) || Number(item.completionPercent) > 0)
const needsReason = (item) => item.locked || ['approved', 'ready_for_pdf', 'generated', 'finalized'].includes(item.caseFormStatus)

export default function CaseFormSelectionPanel({ caseId, onClose, onChanged }) {
  const [selection, setSelection] = useState(null)
  const [targetCaseId, setTargetCaseId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [staged, setStaged] = useState([]) // forms to add: { key, entry, coverage, coverageLoading, assignKeys: [] }
  const [removals, setRemovals] = useState({}) // key -> { item, reason, confirm, cascade, acknowledge }
  const [candidateChecklists, setCandidateChecklists] = useState({}) // key -> [{ key, title }] chosen by the Case Manager
  const [checklistQuery, setChecklistQuery] = useState({}) // key -> text
  const [checklistHits, setChecklistHits] = useState({})
  const [applying, setApplying] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const [showRemoved, setShowRemoved] = useState(false)
  const debouncedQuery = useDebounced(query)
  const inputRef = useRef(null)

  const load = useCallback(async (target) => {
    setLoading(true)
    setError('')
    try {
      const response = await caseFormsApi.getSelection(caseId, target ? { targetCaseId: target } : {})
      const data = response.data.data
      setSelection(data)
      if (data.target?.caseId) setTargetCaseId(String(data.target.caseId))
    } catch (err) {
      setError(readError(err, 'Could not load this case\'s forms.'))
    } finally {
      setLoading(false)
    }
  }, [caseId])

  useEffect(() => { load() }, [load])

  // suggestions while typing
  useEffect(() => {
    const text = debouncedQuery.trim()
    if (!text) { setSuggestions([]); return undefined }
    let cancelled = false
    caseFormsApi.catalog({ q: text, onlySelectable: true, limit: 8 })
      .then((response) => { if (!cancelled) setSuggestions(response.data.data.items || []) })
      .catch(() => { if (!cancelled) setSuggestions([]) })
    return () => { cancelled = true }
  }, [debouncedQuery])

  const activeKeys = useMemo(() => new Set((selection?.items || []).map((item) => item.key)), [selection])
  const stagedKeys = useMemo(() => new Set(staged.map((item) => item.key)), [staged])

  const loadCoverage = useCallback(async (entry, extraKeys = []) => {
    const key = `${entry.formCode}|${entry.componentCode || ''}`
    setStaged((prev) => prev.map((item) => (item.key === key ? { ...item, coverageLoading: true } : item)))
    try {
      const response = await caseFormsApi.coverage(caseId, { targetCaseId, formCode: entry.formCode, componentCode: entry.componentCode || undefined, checklistKeys: extraKeys.join(',') || undefined })
      setStaged((prev) => prev.map((item) => (item.key === key ? { ...item, coverage: response.data.data, coverageLoading: false, assignKeys: item.assignKeys ?? (response.data.data.suggestedChecklists || []).map((c) => c.key) } : item)))
    } catch (err) {
      setStaged((prev) => prev.map((item) => (item.key === key ? { ...item, coverageLoading: false, coverageError: readError(err, 'Could not check the checklists.') } : item)))
    }
  }, [caseId, targetCaseId])

  const stage = (entry) => {
    const key = `${entry.formCode}|${entry.componentCode || ''}`
    if (stagedKeys.has(key)) return
    setStaged((prev) => [...prev, { key, entry, coverage: null, coverageLoading: true, assignKeys: null }])
    setQuery(''); setSuggestions([]); setOutcome(null)
    inputRef.current?.focus()
    loadCoverage(entry)
  }

  // "Add": the typed text is resolved by the server to ONE form; an ambiguous or unknown name is explained, never guessed
  const addTyped = async () => {
    const text = query.trim()
    if (!text) return
    try {
      const response = await caseFormsApi.resolve(text)
      const { match, candidates } = response.data.data
      if (match) return stage(match)
      if (candidates?.length) { setSuggestions(candidates); setError(`"${text}" matches more than one form. Pick one from the list.`) } else setError(`No USCIS form matches "${text}".`)
    } catch (err) {
      setError(readError(err, 'Could not look that form up.'))
    }
  }

  const unstage = (key) => setStaged((prev) => prev.filter((item) => item.key !== key))
  const toggleRemoval = (item) => setRemovals((prev) => {
    const next = { ...prev }
    if (next[item.key]) delete next[item.key]
    else next[item.key] = { item, reason: '', confirm: false, cascade: false, acknowledge: false }
    return next
  })
  const patchRemoval = (key, patch) => setRemovals((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  // any checklist can be linked to the form for this case
  useEffect(() => {
    const entries = Object.entries(checklistQuery).filter(([, text]) => text && text.trim().length > 1)
    entries.forEach(([key, text]) => {
      questionnairesApi.list({ isTemplate: true, latestVersion: true, search: text.trim(), limit: 6 })
        .then((response) => setChecklistHits((prev) => ({ ...prev, [key]: response.data.data || [] })))
        .catch(() => setChecklistHits((prev) => ({ ...prev, [key]: [] })))
    })
  }, [checklistQuery])

  const chooseChecklist = (stagedItem, template) => {
    const picked = candidateChecklists[stagedItem.key] || []
    if (picked.some((item) => item.key === template.key)) return
    const nextPicked = [...picked, { key: template.key, title: template.title }]
    setCandidateChecklists((prev) => ({ ...prev, [stagedItem.key]: nextPicked }))
    setChecklistQuery((prev) => ({ ...prev, [stagedItem.key]: '' }))
    setChecklistHits((prev) => ({ ...prev, [stagedItem.key]: [] }))
    setStaged((prev) => prev.map((item) => (item.key === stagedItem.key ? { ...item, assignKeys: [...(item.assignKeys || []), template.key] } : item)))
    loadCoverage(stagedItem.entry, nextPicked.map((item) => item.key))
  }
  const toggleAssign = (stagedItem, checklistKey) => setStaged((prev) => prev.map((item) => (item.key === stagedItem.key
    ? { ...item, assignKeys: (item.assignKeys || []).includes(checklistKey) ? item.assignKeys.filter((k) => k !== checklistKey) : [...(item.assignKeys || []), checklistKey] }
    : item)))

  const removalReady = Object.values(removals).every((entry) => (!needsConfirm(entry.item) || entry.confirm) && (!needsReason(entry.item) || entry.reason.trim()) && (!entry.item.requiredByPackage || entry.acknowledge))
  const nothingToApply = staged.length === 0 && Object.keys(removals).length === 0

  const apply = async () => {
    setApplying(true)
    setError('')
    setOutcome(null)
    try {
      const response = await caseFormsApi.updateSelection(caseId, {
        targetCaseId,
        expectedRevision: selection.revision,
        add: staged.map((item) => ({ formCode: item.entry.formCode, componentCode: item.entry.componentCode || undefined })),
        remove: Object.values(removals).map((entry) => ({ formCode: entry.item.formCode, componentCode: entry.item.componentCode || undefined, reason: entry.reason.trim() || undefined, confirm: entry.confirm, cascadeComponents: entry.cascade, acknowledgeWaiver: entry.acknowledge })),
        assignChecklistKeys: [...new Set(staged.flatMap((item) => item.assignKeys || []))],
        autofill: true,
      })
      const data = response.data.data
      setSelection(data.selection)
      setOutcome(data)
      setStaged((prev) => prev.filter((item) => data.results.some((result) => result.action !== 'removed' && result.status === 'failed' && `${result.formCode}|${result.componentCode || ''}` === item.key)))
      setRemovals({})
      onChanged?.()
    } catch (err) {
      const code = err?.response?.data?.code
      if (code === 'STALE_SELECTION_REVISION') { await load(targetCaseId); setError('Someone else changed this case\'s forms. The list was reloaded; review your changes and apply again.') }
      else setError(readError(err, 'Could not save the changes.'))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label="Manage forms">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-lg font-bold text-foreground">Manage forms</h2>
            <p className="text-sm text-muted-foreground">You decide which USCIS forms this case has. Nothing is added or restored automatically once you take control.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {selection?.needsTarget && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">Which person's forms?</label>
              <select className="input-field text-sm" value={targetCaseId} onChange={(event) => { setTargetCaseId(event.target.value); load(event.target.value) }}>
                <option value="">Choose…</option>
                {selection.targets.map((item) => <option key={item.caseId} value={item.caseId}>{item.caseNumber} · {item.clientName}</option>)}
              </select>
            </div>
          )}

          {selection && !selection.needsTarget && (
            <>
              {/* add */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Add a form</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={inputRef}
                      className="input-field pl-9 text-sm"
                      placeholder="Type a form number or name, e.g. I-765 or employment authorization"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTyped() } }}
                    />
                  </div>
                  <button type="button" onClick={addTyped} disabled={!query.trim()} className="btn-primary text-sm disabled:opacity-50"><Plus className="mr-1 inline h-4 w-4" />Add</button>
                </div>
                {suggestions.length > 0 && (
                  <ul className="mt-1 max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border bg-card shadow-sm">
                    {suggestions.map((entry) => {
                      const key = `${entry.formCode}|${entry.componentCode || ''}`
                      const already = activeKeys.has(key) || stagedKeys.has(key)
                      return (
                        <li key={entry.key}>
                          <button type="button" disabled={already} onClick={() => stage(entry)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">
                            <FormLabel formCode={entry.formCode} componentCode={entry.componentCode} parentFormCode={entry.parentFormCode} title={entry.title} />
                            <span className="shrink-0 text-xs text-muted-foreground">{already ? 'already on this case' : <Status state={availabilityOf(entry)} />}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* staged additions with their checklist link */}
              {staged.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To add</h3>
                  {staged.map((item) => (
                    <div key={item.key} className="rounded-lg border border-border p-3">
                      <div className="flex items-center gap-3">
                        <FormLabel formCode={item.entry.formCode} componentCode={item.entry.componentCode} parentFormCode={item.entry.parentFormCode} title={item.entry.title} />
                        <Status state={availabilityOf(item.entry)} />
                        <button type="button" onClick={() => unstage(item.key)} className="text-muted-foreground hover:text-red-600" aria-label={`Do not add ${item.entry.formCode}`}><X className="h-4 w-4" /></button>
                      </div>
                      {item.entry.availabilityNote && <p className="mt-1 text-xs text-muted-foreground">{item.entry.availabilityNote}</p>}
                      <div className="mt-2 rounded-md bg-muted/50 p-3 text-xs">
                        <div className="font-medium text-foreground">How this case's checklists fill the form</div>
                        {item.coverageLoading && <p className="mt-1 text-muted-foreground">Checking the checklists…</p>}
                        {item.coverageError && <p className="mt-1 text-red-700">{item.coverageError}</p>}
                        {item.coverage && (
                          <div className="mt-1 space-y-2">
                            <p className="text-muted-foreground">{item.coverage.summary}</p>
                            <ul className="space-y-1">
                              {item.coverage.checklists.map((checklist) => (
                                <li key={checklist.key} className="flex min-w-0 items-center gap-2">
                                  {!checklist.heldByCase ? (
                                    <input type="checkbox" checked={(item.assignKeys || []).includes(checklist.key)} onChange={() => toggleAssign(item, checklist.key)} aria-label={`Send ${checklist.title} to this case`} />
                                  ) : <span className="w-3" />}
                                  <span className="min-w-0 flex-1 truncate text-foreground">{checklist.title}</span>
                                  <span className="shrink-0 text-muted-foreground">{checklist.heldByCase ? 'on this case' : 'not on this case'} · {checklist.fieldsFed} field{checklist.fieldsFed === 1 ? '' : 's'}</span>
                                </li>
                              ))}
                              {(item.coverage.suggestedChecklists || []).filter((s) => !item.coverage.checklists.some((c) => c.key === s.key)).map((suggested) => (
                                <li key={suggested.key} className="flex items-center gap-2">
                                  <input type="checkbox" checked={(item.assignKeys || []).includes(suggested.key)} onChange={() => toggleAssign(item, suggested.key)} aria-label={`Send ${suggested.title} to this case`} />
                                  <span className="min-w-0 flex-1 truncate text-foreground">{suggested.title}</span>
                                  <span className="shrink-0 text-muted-foreground">made for this form · not on this case</span>
                                </li>
                              ))}
                            </ul>
                            <div className="relative max-w-sm">
                              <input
                                className="input-field text-xs"
                                placeholder="Link another checklist to this form…"
                                value={checklistQuery[item.key] || ''}
                                onChange={(event) => setChecklistQuery((prev) => ({ ...prev, [item.key]: event.target.value }))}
                              />
                              {(checklistHits[item.key] || []).length > 0 && (
                                <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-border bg-card shadow-sm">
                                  {checklistHits[item.key].map((template) => (
                                    <li key={template._id}><button type="button" onClick={() => chooseChecklist(item, template)} className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted">{template.title}</button></li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <p className="text-muted-foreground">A ticked checklist is sent to this case only; it goes through the case's normal checklist approval.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* current forms */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this case ({selection.items.length})</h3>
                {selection.items.length === 0 ? <p className="text-sm text-muted-foreground">No forms yet. Add one above.</p> : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {selection.items.map((item) => {
                      const removal = removals[item.key]
                      return (
                        <li key={item.key} className="px-3 py-2 text-sm">
                          <div className="flex items-center gap-3">
                            <div className={removal ? 'min-w-0 flex-1 line-through opacity-60' : 'min-w-0 flex-1'}>
                              <FormLabel formCode={item.formCode} componentCode={item.componentCode} parentFormCode={item.parentFormCode} title={item.title} />
                            </div>
                            <span className="max-w-[11rem] shrink-0 truncate text-right text-xs text-muted-foreground">{item.origin === 'automatic' ? 'automatic · ' : ''}{item.caseFormStatus ? item.caseFormStatus.replaceAll('_', ' ') : item.selectionStatus?.replaceAll('_', ' ')}{item.completionPercent != null ? ` · ${item.completionPercent}%` : ''}</span>
                            <button type="button" onClick={() => toggleRemoval(item)} className={`shrink-0 ${removal ? 'text-primary' : 'text-muted-foreground hover:text-red-600'}`} title={removal ? 'Keep this form' : 'Remove from this case'} aria-label={removal ? `Keep ${item.formCode}` : `Remove ${item.formCode}`}>
                              {removal ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          </div>
                          {removal && (
                            <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-3 text-xs">
                              <p className="text-muted-foreground">The form is removed from active work. Its answers, history and generated files are kept and can be restored.</p>
                              {selection.items.some((other) => other.parentFormCode === item.formCode) && (
                                <label className="flex items-center gap-2"><input type="checkbox" checked={removal.cascade} onChange={(event) => patchRemoval(item.key, { cascade: event.target.checked })} /> Also remove its component forms</label>
                              )}
                              {needsConfirm(item) && <label className="flex items-center gap-2"><input type="checkbox" checked={removal.confirm} onChange={(event) => patchRemoval(item.key, { confirm: event.target.checked })} /> This form already holds information; I understand it is kept but no longer used</label>}
                              {item.requiredByPackage && <label className="flex items-center gap-2"><input type="checkbox" checked={removal.acknowledge} onChange={(event) => patchRemoval(item.key, { acknowledge: event.target.checked })} /> The filing package normally requires {item.formCode}; it is not part of this filing</label>}
                              <input className="input-field text-xs" placeholder={needsReason(item) ? 'Reason (required)' : 'Reason (optional)'} value={removal.reason} onChange={(event) => patchRemoval(item.key, { reason: event.target.value })} />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* removed */}
              {selection.removed.length > 0 && (
                <div>
                  <button type="button" onClick={() => setShowRemoved((value) => !value)} className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                    {showRemoved ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Removed forms ({selection.removed.length})
                  </button>
                  {showRemoved && (
                    <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                      {selection.removed.map((item) => (
                        <li key={item.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <FormLabel formCode={item.formCode} componentCode={item.componentCode} parentFormCode={item.parentFormCode} title={`${item.title}${item.waivedRequirement ? ' · acknowledged as not part of the filing' : ''}`} muted />
                          <button type="button" onClick={() => stage({ formCode: item.formCode, componentCode: item.componentCode, title: item.title, availability: item.availability, availabilityNote: item.availabilityNote })} className="shrink-0 text-xs text-primary hover:underline">Add back</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* what happened */}
              {outcome && (
                <div className="space-y-2 rounded-md border border-border p-3 text-sm">
                  <div className="font-medium text-foreground">{outcome.partial ? 'Some changes could not be made' : 'Changes saved'}</div>
                  <ul className="space-y-1 text-xs">
                    {outcome.results.map((result, index) => (
                      <li key={index} className={result.status === 'ok' ? 'text-muted-foreground' : 'text-red-700'}>
                        {result.formCode}{result.componentCode ? ` (${result.componentCode})` : ''}: {result.status === 'ok' ? (result.selectionStatus === 'pending_acquisition' ? `recorded - ${result.message}` : `${result.action}${result.message ? ` - ${result.message}` : ''}`) : result.message}
                      </li>
                    ))}
                    {(outcome.autofill || []).map((fill, index) => (
                      <li key={`fill-${index}`} className={fill.status === 'filled' ? 'text-primary' : 'text-muted-foreground'}>
                        {fill.formCode}: {fill.status === 'filled' ? `auto-filled${fill.completion?.percent != null ? ` (${fill.completion.percent}% complete)` : ''}` : fill.status === 'skipped' ? fill.message : `not filled - ${fill.message}`}
                        {fill.status === 'filled' && fill.report?.summary && (
                          <span className="block text-muted-foreground">
                            {fill.report.summary.populated} box{fill.report.summary.populated === 1 ? '' : 'es'} filled
                            {fill.report.summary.needsClientInformation ? `, ${fill.report.summary.needsClientInformation} waiting for client information` : ''}
                            {fill.report.summary.needsStaffInput ? `, ${fill.report.summary.needsStaffInput} required box${fill.report.summary.needsStaffInput === 1 ? '' : 'es'} no checklist can fill (staff input)` : ''}
                            {fill.report.summary.conflicts ? `, ${fill.report.summary.conflicts} data conflict(s) to resolve` : ''}
                            {fill.report.summary.status === 'complete' ? ' - nothing required is missing' : ''}
                          </span>
                        )}
                      </li>
                    ))}
                    {(outcome.assignedChecklists || []).map((checklist) => (
                      <li key={checklist.key} className="text-muted-foreground">{checklist.title || checklist.key}: {checklist.error ? `not sent - ${checklist.error}` : checklist.alreadyAssigned ? 'already on this case' : 'sent to this case'}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            {nothingToApply ? 'No changes yet.' : `${staged.length} to add, ${Object.keys(removals).length} to remove.`}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Close</button>
            <button type="button" onClick={apply} disabled={applying || nothingToApply || !removalReady || !selection || selection.needsTarget} className="btn-primary text-sm disabled:opacity-50">
              {applying ? 'Applying…' : 'Apply changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
