import { useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { lifecycleApi } from '../services/api'
import { cleanReceiptNumber, isValidReceiptNumber } from '../utils/uscisReceipt'

// Shown when a case moved to Submitted was submitted ONLINE: asks the internal team for the USCIS receipt number (three letters + ten digits). Saved on the case's USCIS Tracking record
// (the "USCIS Receipt Number" field of the Tracking tab). "Add later" closes it without saving; the number can be added any time in the Tracking tab. A number already on file is pre-filled.
// onClose(true) = saved, onClose(false) = left for later.
export default function ReceiptNumberModal({ caseId, caseNumber, label = '', onClose }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    let cancelled = false
    lifecycleApi.tracking(caseId)
      .then((response) => {
        const number = response.data?.tracking?.filing?.receiptNumber
        if (!cancelled && number) setValue((current) => current || String(number))
      })
      .catch(() => {}) // a number is simply not pre-filled
    return () => { cancelled = true }
  }, [caseId])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const save = async (event) => {
    event?.preventDefault()
    if (busy) return
    if (!isValidReceiptNumber(value)) {
      setError('Enter a valid USCIS receipt number: three letters followed by ten digits (for example IOE1234567890), or choose Add later.')
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    setError('')
    try {
      await lifecycleApi.saveReceiptNumber(caseId, cleanReceiptNumber(value))
      window.dispatchEvent(new CustomEvent('receipt-number-saved', { detail: { caseId } }))
      onClose(true)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the receipt number. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation">
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl" data-testid="receipt-number-modal">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <FileText className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 id="receipt-modal-title" className="text-center text-xl font-bold text-foreground">Add the USCIS receipt number</h2>
        <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">{caseNumber}{label ? ` · ${label}` : ''}</span> has moved to Submitted (online).
          Enter the USCIS receipt number for this filing.
        </p>
        <label htmlFor="receipt-number-input" className="mt-5 block text-sm font-medium text-foreground">USCIS receipt number</label>
        <input
          id="receipt-number-input"
          ref={inputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          maxLength={13}
          value={value}
          onChange={(event) => { setValue(event.target.value.toUpperCase()); if (error) setError('') }}
          placeholder="e.g. IOE1234567890"
          disabled={busy}
          className="input-field mt-1.5 font-mono"
          aria-invalid={Boolean(error)}
        />
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">
          This number is saved in the case&apos;s USCIS Tracking tab, under USCIS Receipt Number. You can add it later in that tab.
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => onClose(false)} disabled={busy} className="btn-secondary flex-1 justify-center disabled:opacity-50">Add later</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1 justify-center disabled:opacity-50">{busy ? 'Saving…' : 'Continue'}</button>
        </div>
      </form>
    </div>
  )
}
