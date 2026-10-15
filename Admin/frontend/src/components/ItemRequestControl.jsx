import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { informationRequestsApi } from '../services/api'

// The per-item "Request" control of the case's checklist answers (text answers and documents, sent or not):
//   * a small Request button on every row; a chip shows when the item has been requested ("Requested") or was received ("Received")
//   * the popup (centered, themed) takes the details the case manager wants the client to see, then e-mails the client
//   * the item becomes REQUIRED FOR THIS CASE ONLY - the client cannot submit the checklist without it
//   * asking again for an item that is already requested re-sends the e-mail; a request can be withdrawn
// All calls go through informationRequestsApi.requestItem / cancelItemRequest (backend: information-requests, scope existing_question).

const CHIP = {
  open: { label: 'Requested', className: 'bg-amber-100 text-amber-800' },
  submitted: { label: 'Received', className: 'bg-green-100 text-green-800' },
  approved: { label: 'Received', className: 'bg-green-100 text-green-800' },
  rejected: { label: 'Requested', className: 'bg-amber-100 text-amber-800' },
}

export function itemRequestFor(requests, questionKey) {
  return (requests?.items || []).find((item) => item.questionKey === questionKey && item.status !== 'closed') || null
}

function RequestModal({ question, existing, requests, onClose, onDone }) {
  const [note, setNote] = useState(existing?.note || '')
  const [recipients, setRecipients] = useState([])
  const [recipientId, setRecipientId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const textRef = useRef(null)
  const isDocument = question.type === 'file' || question.type === 'file-multiple'

  useEffect(() => {
    textRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const send = async () => {
    setBusy('send')
    setError('')
    try {
      const response = await informationRequestsApi.requestItem(requests.caseId, {
        questionKey: question.key,
        targetRole: requests.targetRole || undefined,
        referenceId: requests.referenceId || undefined,
        note: note.trim() || undefined,
        recipientId: recipientId || undefined,
      })
      await onDone(response.data?.resent ? 'Request re-sent to the client.' : 'Request sent. The client was e-mailed and this item is now required for this case.')
    } catch (err) {
      const data = err.response?.data
      if (data?.code === 'RECIPIENT_REQUIRED' && data.recipients?.length) {
        setRecipients(data.recipients)
        setRecipientId(data.recipients[0].id)
        setError('Choose who this request should go to, then send it again.')
      } else {
        setError(data?.errors?.[0]?.msg || data?.message || 'Unable to send the request.')
      }
    } finally {
      setBusy('')
    }
  }

  const withdraw = async () => {
    setBusy('withdraw')
    setError('')
    try {
      await informationRequestsApi.cancelItemRequest(requests.caseId, existing.requestId)
      await onDone('Request withdrawn. This item is no longer required.')
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to withdraw the request.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="item-request-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl">
        <h2 id="item-request-title" className="text-lg font-bold text-foreground">
          {existing ? 'Request again' : 'Request from the client'}
        </h2>
        <p className="mt-1 text-sm font-semibold text-foreground">{question.label}</p>
        <p className="text-xs text-muted-foreground">{isDocument ? 'Document upload' : 'Information'}{existing ? ` · ${CHIP[existing.status]?.label || 'Requested'}` : ''}</p>

        <label htmlFor="item-request-note" className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          What do you need from the client? <span className="font-normal normal-case">(optional)</span>
        </label>
        <textarea
          id="item-request-note"
          ref={textRef}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          className="input-field mt-1 min-h-[88px] text-sm"
          placeholder={isDocument ? 'e.g. The scan is blurry - please upload a clear copy of all pages.' : 'e.g. Please confirm the exact figure from your latest pay slip.'}
        />
        <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
          The client is e-mailed this request with your details. The item becomes <strong>required for this case only</strong>, so the client must provide it before they can submit.
        </p>

        {recipients.length > 0 && (
          <div className="mt-3">
            <label htmlFor="item-request-recipient" className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Send to</label>
            <select id="item-request-recipient" value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className="input-field mt-1 text-sm">
              {recipients.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{error}</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          {existing && (
            <button type="button" onClick={withdraw} disabled={Boolean(busy)} className="btn-secondary text-sm text-rose-600 disabled:opacity-50">
              {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw request'}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} disabled={Boolean(busy)} className="btn-secondary text-sm disabled:opacity-50">Cancel</button>
          <button type="button" onClick={send} disabled={Boolean(busy)} className="btn-primary text-sm disabled:opacity-50">
            {busy === 'send' ? 'Sending…' : existing ? 'Re-send request' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ItemRequestControl({ question, requests }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  if (!requests?.caseId) return null
  const existing = itemRequestFor(requests, question.key)
  const chip = existing ? (CHIP[existing.status] || CHIP.open) : null

  const done = async (text) => {
    setOpen(false)
    setMessage(text)
    try { await requests.onChanged?.() } catch { /* the request itself was saved; a failed refresh only delays the chip */ }
    setTimeout(() => setMessage(''), 6000)
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
      {chip && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${chip.className}`} title={existing.note || undefined}>{chip.label}</span>}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-semibold text-foreground hover:bg-secondary"
        aria-label={`${existing ? 'Request again' : 'Request'}: ${question.label}`}
      >
        <Send className="h-3 w-3" aria-hidden="true" />
        {existing ? 'Request again' : 'Request'}
      </button>
      {message && <span role="status" className="text-[11px] font-medium text-muted-foreground">{message}</span>}
      {open && <RequestModal question={question} existing={existing} requests={requests} onClose={() => setOpen(false)} onDone={done} />}
    </span>
  )
}
