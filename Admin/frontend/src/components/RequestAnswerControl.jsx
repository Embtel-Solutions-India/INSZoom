import { useEffect, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { questionnairesApi, invalidateCachedGet } from '../services/api'

// Lets the case manager fill an information request ON THE CLIENT'S BEHALF: type the answer, or upload the document(s). It goes through the same
// answer endpoints the checklist panels use, so the backend does everything else: the request flips to Received, an uploaded file becomes a Document
// (Uploaded Documents / Documents tab), and the answer shows in the requested-documents group of Required Documents. Announcing 'case-answers-changed'
// makes the open case page re-read all of those at once; the server also tells every other open session (client portal, other staff).

const ELIGIBLE_STATUSES = ['open', 'submitted']
const YES_NO = ['Yes', 'No']
const fieldClass = 'input-field !py-1.5 text-sm'

const asText = (value) => (Array.isArray(value) ? value.join(', ') : value === undefined || value === null ? '' : String(value))
const errorText = (error) => error?.response?.data?.message || error?.response?.data?.errors?.[0]?.msg || error?.message || 'Could not save this. Please try again.'

export default function RequestAnswerControl({ request, caseId, onSaved }) {
  const isDocument = request?.itemKind === 'document'
  const [value, setValue] = useState(() => (isDocument ? '' : asText(request?.answer?.value)))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const fileInput = useRef(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // keep the box in step with the stored answer when the list reloads (a client or another staff member answered)
  const stored = asText(request?.answer?.value)
  useEffect(() => { if (!isDocument) setValue(stored) }, [stored, isDocument])

  const eligible = request && request.questionnaireId && request.questionKey && request.responseId && ELIGIBLE_STATUSES.includes(request.status || 'open')
  if (!eligible) return null

  const base = { caseId, targetRole: request.recipientRole || undefined, referenceId: request.referenceId || undefined, responseId: request.responseId }

  const finish = async (successText) => {
    invalidateCachedGet(`/questionnaires/case/${caseId}`)
    try { window.dispatchEvent(new CustomEvent('case-answers-changed', { detail: { caseId: String(caseId) } })) } catch { /* cosmetic refresh only */ }
    await onSaved?.()
    if (alive.current) setMessage({ type: 'success', text: successText })
  }

  const run = async (task, successText) => {
    setBusy(true)
    setMessage({ type: '', text: '' })
    try {
      await task()
      await finish(successText)
    } catch (error) {
      if (alive.current) setMessage({ type: 'error', text: errorText(error) })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const saveText = (event) => {
    event.preventDefault()
    const text = String(value).trim()
    if (!text) { setMessage({ type: 'error', text: 'Enter the answer first.' }); return }
    run(() => questionnairesApi.saveAnswer(request.questionnaireId, { ...base, answers: [{ questionKey: request.questionKey, value: text }] }), 'Saved for the client.')
  }

  const uploadFiles = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))
    Object.entries({ ...base, questionKey: request.questionKey }).forEach(([key, item]) => { if (item) formData.append(key, item) })
    run(() => questionnairesApi.saveFileAnswer(request.questionnaireId, formData), files.length > 1 ? `${files.length} files uploaded for the client.` : 'File uploaded for the client.')
  }

  const received = request.status === 'submitted'
  let input
  if (request.itemKind === 'yes_no' || request.itemKind === 'select') {
    const options = request.itemKind === 'yes_no' ? YES_NO : request.options || []
    input = (
      <select aria-label={`Answer for ${request.title}`} value={value} onChange={(event) => setValue(event.target.value)} className={fieldClass}>
        <option value="">Choose…</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  } else if (request.itemKind === 'textarea') {
    input = <textarea aria-label={`Answer for ${request.title}`} value={value} onChange={(event) => setValue(event.target.value)} className={`${fieldClass} min-h-[72px]`} maxLength={5000} />
  } else {
    const type = request.itemKind === 'number' ? 'number' : request.itemKind === 'date' ? 'date' : 'text'
    input = <input aria-label={`Answer for ${request.title}`} type={type} value={value} onChange={(event) => setValue(event.target.value)} className={fieldClass} maxLength={500} />
  }

  return (
    <div className="mt-2 border-t border-border pt-2" data-testid="request-answer-control">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{received ? 'Add or update for the client' : 'Provide for the client'}</p>
      {isDocument ? (
        <div>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={uploadFiles} aria-label={`Upload for ${request.title}`} />
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60">
            <Paperclip className="h-3.5 w-3.5" /> {busy ? 'Uploading…' : received ? 'Upload another file' : 'Upload file'}
          </button>
        </div>
      ) : (
        <form onSubmit={saveText} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">{input}</div>
          <button type="submit" disabled={busy} className="btn-primary w-auto shrink-0 !px-4 !py-1.5 text-sm disabled:opacity-60">{busy ? 'Saving…' : received ? 'Update' : 'Save'}</button>
        </form>
      )}
      {message.text && <p role="status" className={`mt-1 text-xs font-medium ${message.type === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message.text}</p>}
    </div>
  )
}
