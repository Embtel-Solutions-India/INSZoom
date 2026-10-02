import { useCallback, useEffect, useMemo, useState } from 'react'
import { informationRequestsApi, questionnairesApi } from '../services/api'

// What the person has to provide. "Document" becomes a file row (multi-file
// "Add entry" upload); everything else becomes a typed question row.
const REQUEST_TYPES = [
  { value: 'document', label: 'Document upload' },
  { value: 'text', label: 'Short text answer' },
  { value: 'textarea', label: 'Long text answer' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'yes_no', label: 'Yes / No question' },
  { value: 'select', label: 'Choice from a list' },
]
const STATUS_STYLES = {
  open: 'bg-amber-100 text-amber-800',
  submitted: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  closed: 'bg-secondary text-muted-foreground',
}
const EMPTY_FORM = { recipientId: '', name: '', itemKind: 'document', documentCategory: 'Identity', optionsText: '', description: '' }

const kindLabel = (kind) => REQUEST_TYPES.find((item) => item.value === kind)?.label || 'Request'
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '')

function AnswerPreview({ request, onOpenFile, busyKey }) {
  const answer = request.answer
  if (!answer) return null
  const files = answer.files || []
  const text = Array.isArray(answer.value) ? answer.value.join(', ') : answer.value
  if (!files.length && (text === undefined || text === null || text === '')) return null
  return (
    <div className="mt-2 rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Response</p>
      {files.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {files.map((file) => (
            <button
              key={file.storageKey}
              type="button"
              onClick={() => onOpenFile(request, file)}
              disabled={busyKey === file.storageKey}
              className="max-w-full truncate rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary"
            >
              {file.originalName || 'Open file'}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{String(text)}</p>
      )}
    </div>
  )
}

export default function InformationRequestPanel({ caseId, caseData, onCaseUpdated }) {
  const [recipients, setRecipients] = useState([])
  const [requests, setRequests] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [busyKey, setBusyKey] = useState('')

  const load = useCallback(async () => {
    if (!caseId) return
    try {
      const [recipientResponse, requestResponse] = await Promise.all([
        informationRequestsApi.recipients(caseId),
        informationRequestsApi.list(caseId),
      ])
      const list = recipientResponse.data?.recipients || []
      setRecipients(list)
      setRequests(requestResponse.data?.requests || [])
      setForm((current) => (current.recipientId || !list.length ? current : { ...current, recipientId: list[0].id }))
    } catch {
      setMessage({ type: 'error', text: 'Unable to load recipients for this case.' })
    }
  }, [caseId])

  // Re-load when the case record changes (e.g. a client answer arrives and the case refetches).
  useEffect(() => { load() }, [load, caseData?.updatedAt, caseData?.informationRequests?.length])

  const openRequests = useMemo(() => requests.filter((request) => request.status === 'open').length, [requests])
  const update = (patch) => setForm((current) => ({ ...current, ...patch }))

  const handleSend = async (event) => {
    event.preventDefault()
    const name = form.name.trim()
    const options = form.optionsText.split('\n').map((item) => item.trim()).filter(Boolean)
    if (!form.recipientId) return setMessage({ type: 'error', text: 'Choose who this request goes to.' })
    if (name.length < 2) return setMessage({ type: 'error', text: 'Type the name of the document or information you need.' })
    if (form.itemKind === 'select' && options.length < 2) return setMessage({ type: 'error', text: 'Add at least two choices, one per line.' })
    setSending(true)
    setMessage({ type: '', text: '' })
    try {
      const response = await informationRequestsApi.create(caseId, {
        recipientId: form.recipientId,
        name,
        itemKind: form.itemKind,
        options: form.itemKind === 'select' ? options : undefined,
        description: form.description.trim() || undefined,
      })
      onCaseUpdated?.(response.data?.case)
      setForm((current) => ({ ...EMPTY_FORM, recipientId: current.recipientId, itemKind: current.itemKind }))
      setMessage({ type: 'success', text: `Request sent to ${response.data?.recipient?.name || 'the recipient'}. It now appears in their checklist and they were notified.` })
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.errors?.[0]?.msg || error.response?.data?.message || 'Unable to send the request.' })
    } finally {
      setSending(false)
    }
  }

  const openFile = async (request, file) => {
    setBusyKey(file.storageKey)
    try {
      const response = await questionnairesApi.downloadAnswerFile(request.questionnaireId, {
        responseId: request.responseId, questionKey: request.questionKey, storageKey: file.storageKey, inline: true,
      })
      const url = URL.createObjectURL(response.data)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      setMessage({ type: 'error', text: 'Unable to open this file.' })
    } finally {
      setBusyKey('')
    }
  }

  const label = 'mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">Request information</h3>
        </div>
        <span className="w-fit shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">{openRequests} open</span>
      </div>

      <form onSubmit={handleSend} className="rounded-lg border border-border bg-muted/40 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <label className={label} htmlFor="ir-name">Document / item name</label>
            <input
              id="ir-name"
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
              className="input-field !py-1.5 text-sm"
              maxLength={200}
              autoComplete="off"
              placeholder="e.g. Updated passport copy"
            />
          </div>
          <div>
            <label className={label} htmlFor="ir-type">Type</label>
            <select id="ir-type" value={form.itemKind} onChange={(event) => update({ itemKind: event.target.value })} className="input-field !py-1.5 text-sm">
              {REQUEST_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="ir-recipient">Send to</label>
            <select id="ir-recipient" value={form.recipientId} onChange={(event) => update({ recipientId: event.target.value })} className="input-field !py-1.5 text-sm" disabled={!recipients.length}>
              {!recipients.length && <option value="">No participants on this case</option>}
              {recipients.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
        </div>
        {form.itemKind === 'select' && (
          <div className="mt-2">
            <label className={label} htmlFor="ir-options">Choices (one per line)</label>
            <textarea id="ir-options" value={form.optionsText} onChange={(event) => update({ optionsText: event.target.value })} className="input-field text-sm min-h-[64px]" placeholder="Option A, then Option B on the next line" />
          </div>
        )}
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className={label} htmlFor="ir-notes">Additional description <span className="font-normal normal-case">(optional)</span></label>
            <input id="ir-notes" value={form.description} onChange={(event) => update({ description: event.target.value })} className="input-field !py-1.5 text-sm" maxLength={2000} placeholder="Add any instructions or context" />
          </div>
          <button type="submit" disabled={sending || !recipients.length} className="btn-primary w-auto shrink-0 self-start !px-4 !py-1.5 text-sm disabled:opacity-60 sm:self-auto">
            {sending ? 'Sending...' : 'Send Request'}
          </button>
        </div>
        {message.text && (
          <p role="status" className={`mt-2 text-xs font-medium ${message.type === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>{message.text}</p>
        )}
      </form>

      <div className="mt-5">
        <h4 className="mb-2 text-sm font-semibold text-foreground">Recent requests</h4>
        {requests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">No information requests yet.</p>
        ) : (
          <ul className="space-y-2">
            {requests.slice().reverse().slice(0, 8).map((request) => (
              <li key={request._id} className="rounded-lg border border-border bg-muted px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-foreground">{request.title}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {kindLabel(request.itemKind)}
                      {request.documentCategory ? ` - ${request.documentCategory}` : ''}
                      {' | To: '}
                      {request.recipientName || request.recipientRole || request.target}
                      {request.recipientEmail ? ` (${request.recipientEmail})` : ''}
                      {request.requestedAt ? ` | ${formatDate(request.requestedAt)}` : ''}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${STATUS_STYLES[request.status] || STATUS_STYLES.closed}`}>
                    {String(request.status || 'open').replace(/_/g, ' ')}
                  </span>
                </div>
                {request.description && <p className="mt-1 text-sm text-muted-foreground">{request.description}</p>}
                <AnswerPreview request={request} onOpenFile={openFile} busyKey={busyKey} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
