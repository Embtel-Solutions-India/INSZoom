import { useState } from 'react'

// Unlock is team_lead+ only (enforced server-side too) — reverts a
// finalized/locked version back to "assembled" so letters/exhibits can be
// edited again. Requires a reason, written into history + AuditLog.
export default function UnlockModal({ onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    setSubmitting(true)
    setError('')
    try {
      await onConfirm({ reason })
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to unlock package')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Unlock Petition</h3>
        <p className="text-sm text-gray-600 mb-4">
          This reopens the finalized version for editing. Anyone finalizing again will need to regenerate the filing PDF before it can be filed.
        </p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input-field"
            placeholder="Why does this need to be unlocked?"
            disabled={submitting}
          />
        </div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 mb-4">{error}</div>}
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1" disabled={submitting}>Cancel</button>
          <button type="button" onClick={handleConfirm} className="btn-primary flex-1" disabled={submitting || !reason.trim()}>
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}
