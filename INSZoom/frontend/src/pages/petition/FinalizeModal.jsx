import { useState } from 'react'

// Finalize gate: matches the backend contract exactly — blocked (errors)
// can never be overridden here, only warnings can via acknowledgeWarnings.
export default function FinalizeModal({ validation, onCancel, onConfirm }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  const blocked = validation?.status === 'blocked'
  const needsAck = validation?.status === 'warnings'

  const handleConfirm = async () => {
    setSubmitting(true)
    setError('')
    try {
      await onConfirm({ acknowledgeWarnings: needsAck ? acknowledged : undefined })
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to finalize package')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Finalize Petition</h3>
        {blocked ? (
          <p className="text-sm text-gray-600 mb-4">This package still has blocking errors and cannot be finalized. Resolve every error in the validation panel first.</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-4">
              Finalizing regenerates the mailing PDF and presentation copy, locks this version from further edits, and marks it ready for filing.
            </p>
            {needsAck && (
              <label className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} disabled={submitting} />
                <span className="text-amber-800">I've reviewed the outstanding warnings and want to finalize anyway.</span>
              </label>
            )}
          </>
        )}
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 mb-4">{error}</div>}
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1" disabled={submitting}>Cancel</button>
          {!blocked && (
            <button
              type="button"
              onClick={handleConfirm}
              className="btn-primary flex-1"
              disabled={submitting || (needsAck && !acknowledged)}
            >
              {submitting ? 'Finalizing…' : 'Finalize'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
