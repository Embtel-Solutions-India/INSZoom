import { useState } from 'react'

const METHODS = [
  { value: 'usps', label: 'USPS' },
  { value: 'fedex', label: 'FedEx' },
  { value: 'ups', label: 'UPS' },
  { value: 'dhl', label: 'DHL' },
  { value: 'online', label: 'USCIS Online Filing' },
]

// Records the physical/electronic filing of an already-finalized package, and
// separately the USCIS receipt number once it arrives — mirrors the two
// backend endpoints (recordFiling / recordReceipt) as two stages of one modal
// rather than two separate flows, since a case manager works through them in
// sequence for the same package.
export default function FilingForm({ pkg, onCancel, onRecordFiling, onRecordReceipt }) {
  const alreadyFiled = pkg.status === 'filed'
  const [method, setMethod] = useState(pkg.filing?.method || 'usps')
  const [addressUsed, setAddressUsed] = useState(pkg.filing?.addressUsed || '')
  const [shippedAt, setShippedAt] = useState(pkg.filing?.shippedAt ? pkg.filing.shippedAt.slice(0, 10) : '')
  const [trackingNumber, setTrackingNumber] = useState(pkg.filing?.trackingNumber || '')
  const [receiptNumber, setReceiptNumber] = useState(pkg.filing?.receiptNumber || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleRecordFiling = async () => {
    setSubmitting(true)
    setError('')
    try {
      await onRecordFiling({ method, addressUsed, shippedAt: shippedAt || undefined, trackingNumber })
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to record filing')
      setSubmitting(false)
    }
  }

  const handleRecordReceipt = async () => {
    setSubmitting(true)
    setError('')
    try {
      await onRecordReceipt({ receiptNumber })
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to record receipt')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <h3 className="text-xl font-bold text-gray-900 mb-4">{alreadyFiled ? 'Filing Details' : 'Record Filing'}</h3>

        {!alreadyFiled ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="input-field" disabled={submitting}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {method !== 'online' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address Used</label>
                <textarea value={addressUsed} onChange={(e) => setAddressUsed(e.target.value)} className="input-field" placeholder="USCIS lockbox / service center address" disabled={submitting} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipped Date</label>
              <input type="date" value={shippedAt} onChange={(e) => setShippedAt(e.target.value)} className="input-field" disabled={submitting} />
            </div>
            {method !== 'online' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tracking Number</label>
                <input type="text" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className="input-field" placeholder="Optional" disabled={submitting} />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <span className="font-medium text-gray-900">{METHODS.find((m) => m.value === pkg.filing?.method)?.label || pkg.filing?.method}</span>
              {pkg.filing?.trackingNumber ? ` · ${pkg.filing.trackingNumber}` : ''}
              {pkg.filing?.shippedAt ? ` · shipped ${new Date(pkg.filing.shippedAt).toLocaleDateString()}` : ''}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Number</label>
              <input type="text" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} className="input-field" placeholder="e.g. EAC2612345678" disabled={submitting} />
            </div>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 mt-4">{error}</div>}

        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1" disabled={submitting}>Close</button>
          {!alreadyFiled ? (
            <button type="button" onClick={handleRecordFiling} className="btn-primary flex-1" disabled={submitting}>
              {submitting ? 'Recording…' : 'Record Filing'}
            </button>
          ) : (
            <button type="button" onClick={handleRecordReceipt} className="btn-primary flex-1" disabled={submitting || !receiptNumber.trim()}>
              {submitting ? 'Saving…' : 'Save Receipt'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
