import { useEffect, useRef, useState } from 'react'
import { Truck } from 'lucide-react'
import { lifecycleApi } from '../services/api'
import { displayTrackingNumber, isValidTrackingNumber } from '../utils/fedexTracking'

// Shown automatically when a case is moved to Submitted (FedEx), from the Pipeline or from the case page: asks the internal team for the FedEx tracking number of that case's filing
// (for an employer matter, of that EMPLOYEE's case). The number is saved on the case's USCIS Tracking record (carrier FedEx), where it is copied / edited afterwards, and the client portal
// shows it with a link to FedEx. "Add later" closes it; the case's USCIS Tracking tab keeps reminding until a number exists. A number already on file is pre-filled.
export default function FedexNumberModal({ caseId, caseNumber, label = '', onClose }) {
  const [value, setValue] = useState('')
  // What the shipment cost (US dollars): INTERNAL only, never shown to the client. The box is always there with the number (this popup is only for the internal team; the server ignores
  // an amount from any other role). It is sent only when the person typed in it, so a saved amount is never overwritten by an empty box that has not finished loading.
  const [amount, setAmount] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    let cancelled = false
    lifecycleApi.tracking(caseId)
      .then((response) => {
        const number = response.data?.tracking?.filing?.trackingNumber
        if (!cancelled && number) setValue((current) => current || displayTrackingNumber(number))
        const sent = response.data?.fedexAmount
        if (!cancelled && sent !== undefined && sent !== null) setAmount((current) => current || String(sent))
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
    if (!isValidTrackingNumber(value)) {
      setError('Enter a valid FedEx tracking number (8 to 34 letters or digits).')
      inputRef.current?.focus()
      return
    }
    if (amountTouched && amount.trim() !== '' && !(Number(amount) >= 0)) {
      setError('Enter a valid FedEx amount (a number, 0 or more), or leave it empty.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (amountTouched) await lifecycleApi.saveFedexNumber(caseId, value, amount)
      else await lifecycleApi.saveFedexNumber(caseId, value)
      window.dispatchEvent(new CustomEvent('fedex-number-saved', { detail: { caseId } }))
      onClose(true)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the tracking number. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation">
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="fedex-modal-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl" data-testid="fedex-number-modal">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Truck className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 id="fedex-modal-title" className="text-center text-xl font-bold text-foreground">Add the FedEx tracking number</h2>
        <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">{caseNumber}{label ? ` · ${label}` : ''}</span> has moved to Submitted (FedEx).
          Enter the FedEx tracking number for this filing; the client sees it in their portal with a link to track the shipment.
        </p>
        <label htmlFor="fedex-number-input" className="mt-5 block text-sm font-medium text-foreground">FedEx tracking number</label>
        <input
          id="fedex-number-input"
          ref={inputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          value={value}
          onChange={(event) => { setValue(event.target.value); if (error) setError('') }}
          placeholder="e.g. 7946 4479 0138"
          disabled={busy}
          className="input-field mt-1.5 font-mono"
          aria-invalid={Boolean(error)}
        />
        {(
          <>
            <label htmlFor="fedex-amount-input" className="mt-4 block text-sm font-medium text-foreground">FedEx amount (USD) <span className="font-normal text-muted-foreground">· optional, internal only</span></label>
            <input
              id="fedex-amount-input"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setAmountTouched(true); if (error) setError('') }}
              placeholder="e.g. 45.80"
              disabled={busy}
              className="input-field mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">For the internal team only. The client never sees the amount, only the tracking number.</p>
          </>
        )}
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">
          This number is saved in the case&apos;s USCIS Tracking tab. To change it later, update it there.
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => onClose(false)} disabled={busy} className="btn-secondary flex-1 justify-center disabled:opacity-50">Add later</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1 justify-center disabled:opacity-50">{busy ? 'Saving…' : 'Save details'}</button>
        </div>
      </form>
    </div>
  )
}
