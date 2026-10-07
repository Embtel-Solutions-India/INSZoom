import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2, Loader2, Info } from 'lucide-react'
import { questionnairesApi, invalidateCachedGet } from '../services/api'

// How a question's answer is collected, in plain words (what the client actually sees).
const TYPE_LABELS = {
  text: 'Short answer', textarea: 'Long answer', number: 'Number', currency: 'Amount', percent: 'Percentage', date: 'Date', datetime: 'Date & time',
  radio: 'Yes / No (choice)', select: 'Dropdown', multiselect: 'Multiple choice', multi_select: 'Multiple choice', checkbox: 'Checkbox', boolean: 'Yes / No',
  file: 'Document upload', email: 'Email', phone: 'Phone number', address: 'Address', person: 'Person details', employment: 'Employment details',
}
const typeLabel = (type) => TYPE_LABELS[type] || String(type || 'text').replace(/_/g, ' ')

// The order the CLIENT sees: sections in the questionnaire's own section order, the questions of each section by their
// order number, and every document-upload question in a final "Documents" step (mirrors the client portal's checklist).
function arrangeLikeClient(questions, sections) {
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0)
  const orderedSections = [...(sections || [])].sort(byOrder)
  const known = new Set(orderedSections.map((section) => section.key))
  const isFile = (question) => question.type === 'file' || question.type === 'file-multiple'
  const fields = questions.filter((question) => !isFile(question))
  const groups = orderedSections.map((section) => ({ key: section.key, title: section.title, items: fields.filter((question) => (question.sectionKey || 'general') === section.key).sort(byOrder) }))
  const strays = fields.filter((question) => !known.has(question.sectionKey || 'general'))
  if (strays.length) groups.push({ key: 'general', title: 'Other', items: strays.sort(byOrder) })
  const documents = questions.filter(isFile).sort(byOrder)
  if (documents.length) groups.push({ key: '__documents', title: 'Documents', items: documents })
  return groups.filter((group) => group.items.length)
}

const NEW_TYPES = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Long answer' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'radio', label: 'Yes / No' },
  { value: 'file', label: 'Document upload' },
]

// Edit one checklist FOR THIS CASE ONLY: change a question's wording / required flag, add a question, remove a
// question. The first change gives this case its own copy of the checklist; the shared template and every other case
// are never touched. (Answers a client or staff member already gave are edited in the answer panels, and stay
// attached when a question is edited or removed.)
export default function ChecklistEditorModal({ caseId, checklist, onClose, onSaved }) {
  const [questions, setQuestions] = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [drafts, setDrafts] = useState({})
  const [adding, setAdding] = useState({ label: '', type: 'text' })

  // `quiet` re-reads the list after a change WITHOUT swapping it for the loading state, so the list (and the scroll
  // position inside it) stays exactly where the user was.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      invalidateCachedGet(`/questionnaires/case/${caseId}`)
      const params = { targetRole: checklist.targetRole }
      if (checklist.referenceId) params.referenceId = checklist.referenceId
      const response = await questionnairesApi.getForCase(caseId, params)
      const data = response.data?.data || {}
      const all = [...(data.questions || []), ...(data.hiddenQuestions || [])]
      const unique = [...new Map(all.map((question) => [question.key, question])).values()]
        .filter((question) => question.active !== false && question.type !== 'page_break' && question.type !== 'section_break')
      setQuestions(unique)
      setSections(data.questionnaire?.sections || [])
      if (!quiet) setDrafts({})
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not load this checklist.')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [caseId, checklist.targetRole, checklist.referenceId])

  useEffect(() => { load(false) }, [load])

  const send = async (key, body) => {
    setBusyKey(key)
    setError('')
    try {
      await questionnairesApi.editCaseChecklist(caseId, { checklistId: checklist.checklistId, ...body })
      // a removed question leaves the list immediately, in place; nothing else moves
      if (body.op === 'remove') setQuestions((current) => current.filter((question) => question.key !== body.questionKey))
      if (body.questionKey) setDrafts((current) => { const next = { ...current }; delete next[body.questionKey]; return next })
      await load(true)
      await onSaved?.()
      return true
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not save this change.')
      return false
    } finally {
      setBusyKey('')
    }
  }

  const groups = useMemo(() => arrangeLikeClient(questions, sections), [questions, sections])

  const draftOf = (question) => drafts[question.key] || {}
  const setDraft = (question, patch) => setDrafts((current) => ({ ...current, [question.key]: { ...current[question.key], ...patch } }))
  const isDirty = (question) => {
    const draft = draftOf(question)
    return draft.label !== undefined && draft.label !== question.label
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation">
      <div role="dialog" aria-modal="true" aria-label={`Edit ${checklist.title}`} className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">Edit checklist - {checklist.title}</h2>
            <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800" data-testid="case-only-notice">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span><b>This updates the checklist for this case only.</b> The shared template and other cases are not changed. What you edit here is what the client will see.</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <p role="alert" className="mb-3 text-sm font-medium text-rose-600">{error}</p>}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading questions…</p>
          ) : (
            <ul className="space-y-3">
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <li className="pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground" aria-hidden="true">{group.title}</li>
                  {group.items.map((question) => {
                const draft = draftOf(question)
                const label = draft.label !== undefined ? draft.label : question.label
                return (
                  <li key={question.key} className="rounded-xl border border-border p-3">
                    <label className="block text-xs font-medium text-muted-foreground">
                      Question
                      <textarea rows={2} value={label} onChange={(event) => setDraft(question, { label: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                    </label>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Answer type</span>
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 font-semibold text-foreground" data-testid={`answer-type-${question.key}`}>{typeLabel(question.type)}</span>
                        {['radio', 'select', 'multiselect', 'multi_select'].includes(question.type) && (question.options || []).length > 0 && (
                          <span className="min-w-0 truncate text-muted-foreground" title={(question.options || []).map((option) => option.label ?? option).join(', ')}>
                            Options: {(question.options || []).map((option) => option.label ?? option).join(', ')}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className="btn-primary text-xs disabled:opacity-50" disabled={!isDirty(question) || busyKey === question.key}
                          onClick={() => send(question.key, { op: 'update', questionKey: question.key, patch: { label } })}>
                          {busyKey === question.key ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs text-rose-700" disabled={busyKey === question.key}
                          onClick={() => { if (window.confirm('Remove this question from this case\'s checklist? Answers already given are kept on record.')) send(question.key, { op: 'remove', questionKey: question.key }) }}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
                </Fragment>
              ))}
              {!questions.length && <li className="text-sm text-muted-foreground">This checklist has no questions.</li>}
            </ul>
          )}

          <div className="mt-5 rounded-xl border border-dashed border-border p-3">
            <p className="text-sm font-semibold text-foreground">Add a question</p>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_160px]">
              <input value={adding.label} onChange={(event) => setAdding((current) => ({ ...current, label: event.target.value }))} placeholder="Question text" className="rounded-lg border border-border bg-card px-3 py-2 text-sm" aria-label="New question text" />
              <select value={adding.type} onChange={(event) => setAdding((current) => ({ ...current, type: event.target.value }))} className="rounded-lg border border-border bg-card px-3 py-2 text-sm" aria-label="New question type">
                {NEW_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Answer type: <b className="text-foreground">{typeLabel(adding.type)}</b></span>
              <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-50" disabled={!adding.label.trim() || busyKey === '__add'}
                onClick={async () => { if (await send('__add', { op: 'add', patch: adding })) setAdding({ label: '', type: 'text' }) }}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {busyKey === '__add' ? 'Adding…' : 'Add question'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-border px-6 py-3">
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
