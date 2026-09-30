// Generic render of a resolved case Questionnaire's answers — the
// single-source-of-truth replacement for CRMCaseDetail.jsx's old hand-written,
// H-1B-only renderH1BEmployerPanel()/renderH1BEmployeePanel() (which read from
// a masterData.h1bEmployer/h1bEmployee path nothing writes anymore). Renders
// whatever fields/sections/answers the assigned Questionnaire actually has, for
// any visa type — no visa-specific branching lives in this file or its caller.
//
// Editable when the caller passes onSaveAnswer/onSaveFile (every call site in
// CRMCaseDetail.jsx does) — lets a case manager correct a value the client
// submitted, or replace an uploaded file/image, directly from this panel.
// Only simple scalar question types (text/select/date/boolean/etc.) get an
// edit control; composite types (address/person/employment/...) and
// repeating groups stay read-only here — editing those safely needs their own
// structured sub-form, not a generic one, and isn't part of this pass.

import { useState } from 'react'
import { Pencil, X, Loader2, Paperclip } from 'lucide-react'

const EDITABLE_SCALAR_TYPES = new Set([
  'text', 'textarea', 'number', 'currency', 'percent', 'date', 'datetime',
  'email', 'phone', 'select', 'multiselect', 'multi_select', 'radio', 'checkbox', 'boolean',
])

function formatAnswerValue(question, value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ') : null
  if (question.type === 'date' || question.type === 'datetime') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString()
  }
  return String(value)
}

// Normalizes a raw stored value to whatever shape the matching <input>/
// <select> needs, and back. Kept symmetric with formatAnswerValue/
// normalizeAnswerValue's backend counterpart so an edited value round-trips
// through the same validation the question already enforces server-side.
function toInputValue(question, value) {
  if (question.type === 'date' || question.type === 'datetime') {
    if (!value) return ''
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
  }
  if (question.type === 'multiselect' || question.type === 'multi_select') {
    return Array.isArray(value) ? value : (value ? [value] : [])
  }
  if (question.type === 'boolean') return value === true
  if (value === undefined || value === null) return ''
  return value
}

function fromInputValue(question, raw) {
  if (question.type === 'number' || question.type === 'currency' || question.type === 'percent') {
    if (raw === '') return null
    const num = Number(raw)
    return Number.isNaN(num) ? raw : num
  }
  return raw
}

function sectionTitleFor(questionnaire, sectionKey) {
  return questionnaire?.sections?.find((section) => section.key === sectionKey)?.title
    || questionnaire?.pages?.find((page) => page.key === sectionKey)?.title
    || sectionKey
}

function AnswerRow({ label, value }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}:</span>{' '}
      <span className="font-semibold text-foreground">{value ?? 'Needed'}</span>
    </p>
  )
}

function EditableAnswerInput({ question, value, onChange }) {
  const inputClass = 'input-field w-full text-sm py-1'
  if (question.type === 'boolean') {
    return (
      <select className={inputClass} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  if (question.type === 'select' || question.type === 'radio') {
    return (
      <select className={inputClass} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        {(question.options || []).map((option) => (
          <option key={String(option.value)} value={option.value}>{option.label || String(option.value)}</option>
        ))}
      </select>
    )
  }
  if (question.type === 'multiselect' || question.type === 'multi_select') {
    const selected = new Set(Array.isArray(value) ? value.map(String) : [])
    return (
      <select
        multiple
        className={`${inputClass} h-auto`}
        value={Array.isArray(value) ? value : []}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
      >
        {(question.options || []).map((option) => (
          <option key={String(option.value)} value={option.value} selected={selected.has(String(option.value))}>
            {option.label || String(option.value)}
          </option>
        ))}
      </select>
    )
  }
  if (question.type === 'date' || question.type === 'datetime') {
    return <input type="date" className={inputClass} value={value || ''} onChange={(event) => onChange(event.target.value)} />
  }
  if (question.type === 'email') {
    return <input type="email" className={inputClass} value={value || ''} onChange={(event) => onChange(event.target.value)} />
  }
  if (question.type === 'number' || question.type === 'currency' || question.type === 'percent') {
    return <input type="number" className={inputClass} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  }
  if (question.type === 'textarea') {
    return <textarea className={`${inputClass} h-20`} value={value || ''} onChange={(event) => onChange(event.target.value)} />
  }
  return <input type="text" className={inputClass} value={value || ''} onChange={(event) => onChange(event.target.value)} />
}

function RepeatingGroupRows({ question, rows }) {
  const fields = question.metadata?.repeatableFields || []
  return (
    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
      {(rows || []).map((row, index) => (
        <div key={row?.id || index} className="rounded-lg border border-border bg-muted p-3 text-sm">
          <p className="font-semibold text-foreground mb-1">{question.label} {index + 1}</p>
          <p className="text-muted-foreground">
            {fields.length
              ? fields.map((field) => row?.[field.key]).filter(Boolean).join(', ') || 'Needed'
              : Object.values(row || {}).filter(Boolean).join(', ') || 'Needed'}
          </p>
        </div>
      ))}
      {!(rows || []).length && <p className="text-sm text-muted-foreground">Needed</p>}
    </div>
  )
}

function FileAnswerRow({ question, files, onReplace }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const current = files || []
  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await onReplace(question.key, file)
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="rounded-lg border border-border bg-muted p-3 text-sm">
      <p className="font-semibold text-foreground mb-1">{question.label}</p>
      {current.length ? (
        <ul className="space-y-1">
          {current.map((file, index) => (
            <li key={file.storageKey || index} className="flex items-center gap-1 text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              {file.url ? <a href={file.url} target="_blank" rel="noreferrer" className="hover:underline">{file.originalName}</a> : <span>{file.originalName}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Needed</p>
      )}
      {onReplace && (
        <label className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          {current.length ? 'Replace file' : 'Upload file'}
          <input type="file" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export default function QuestionnaireAnswersPanel({ title, questionnaire, fieldQuestions, documentQuestions, answerMap, filesByKey, loading, onSaveAnswer, onSaveFile }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (loading) {
    return (
      <div className="card">
        <p className="text-sm text-muted-foreground">Loading questionnaire…</p>
      </div>
    )
  }
  if (!questionnaire || (!fieldQuestions?.length && !documentQuestions?.length)) return null

  // getQuestionnaireForCase splits questions into fieldQuestions (type !==
  // "file") and documentQuestions (type === "file") - re-merged here so a
  // file/image answer renders in the same section as the plain-text answers
  // around it, instead of needing its own separate panel.
  const allQuestions = [...(fieldQuestions || []), ...(documentQuestions || [])]
  const sectionOrder = []
  const bySection = new Map()
  allQuestions.forEach((question) => {
    const key = question.sectionKey || 'general'
    if (!bySection.has(key)) {
      sectionOrder.push(key)
      bySection.set(key, [])
    }
    bySection.get(key).push(question)
  })

  const canEdit = typeof onSaveAnswer === 'function'
  const startEditing = () => {
    const initial = {}
    fieldQuestions.forEach((question) => {
      if (EDITABLE_SCALAR_TYPES.has(question.type)) {
        initial[question.key] = toInputValue(question, answerMap?.[question.key])
      }
    })
    setDraft(initial)
    setError('')
    setEditing(true)
  }
  const cancelEditing = () => {
    setEditing(false)
    setDraft({})
    setError('')
  }
  const saveChanges = async () => {
    setSaving(true)
    setError('')
    try {
      const changed = fieldQuestions.filter((question) => (
        EDITABLE_SCALAR_TYPES.has(question.type)
        && JSON.stringify(draft[question.key] ?? null) !== JSON.stringify(toInputValue(question, answerMap?.[question.key]) ?? null)
      ))
      for (const question of changed) {
        await onSaveAnswer(question.key, fromInputValue(question, draft[question.key]))
      }
      setEditing(false)
      setDraft({})
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to save changes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-foreground">{title || questionnaire.title}</h3>
        {canEdit && !editing && (
          <button type="button" onClick={startEditing} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button type="button" onClick={cancelEditing} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button type="button" onClick={saveChanges} disabled={saving} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
      <div className="space-y-5">
        {sectionOrder.map((sectionKey) => {
          const questions = bySection.get(sectionKey)
          const repeatingQuestions = questions.filter((q) => q.type === 'repeating_group')
          const fileQuestions = questions.filter((q) => q.type === 'file' || q.type === 'file-multiple')
          const plainQuestions = questions.filter((q) => q.type !== 'repeating_group' && q.type !== 'file' && q.type !== 'file-multiple')
          return (
            <div key={sectionKey}>
              <p className="mb-2 text-sm font-semibold text-foreground">{sectionTitleFor(questionnaire, sectionKey)}</p>
              {plainQuestions.length > 0 && (
                <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  {plainQuestions.map((question) => (
                    editing && EDITABLE_SCALAR_TYPES.has(question.type) ? (
                      <div key={question.key}>
                        <label className="mb-1 block text-xs text-muted-foreground">{question.label}</label>
                        <EditableAnswerInput
                          question={question}
                          value={draft[question.key]}
                          onChange={(value) => setDraft((prev) => ({ ...prev, [question.key]: value }))}
                        />
                      </div>
                    ) : (
                      <AnswerRow key={question.key} label={question.label} value={formatAnswerValue(question, answerMap?.[question.key])} />
                    )
                  ))}
                </div>
              )}
              {fileQuestions.length > 0 && (
                <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {fileQuestions.map((question) => (
                    <FileAnswerRow key={question.key} question={question} files={filesByKey?.[question.key]} onReplace={onSaveFile} />
                  ))}
                </div>
              )}
              {repeatingQuestions.map((question) => (
                <RepeatingGroupRows key={question.key} question={question} rows={answerMap?.[question.key]} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
