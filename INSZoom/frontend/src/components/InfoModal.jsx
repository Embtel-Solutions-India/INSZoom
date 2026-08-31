import { useEffect, useRef } from 'react'
import { Info, AlertTriangle } from 'lucide-react'

// Phase 12 (P12-S2): generic themed replacement for every remaining
// window.alert() call across INSZoom that isn't the case-creation success
// message (which has its own CaseCreatedSuccessModal). variant="error" swaps
// the icon/accent for the handful of alert() calls that were reporting a
// failure rather than confirming success.
export default function InfoModal({ title, message, onClose, variant = 'info' }) {
  const closeButtonRef = useRef(null)
  const titleId = 'info-modal-title'
  const descriptionId = 'info-modal-description'
  const isError = variant === 'error'

  useEffect(() => {
    closeButtonRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
      >
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${isError ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
          {isError ? <AlertTriangle className="h-8 w-8" aria-hidden="true" /> : <Info className="h-8 w-8" aria-hidden="true" />}
        </div>
        <h2 id={titleId} className="text-xl font-bold text-gray-900">
          {title || (isError ? 'Something went wrong' : 'Notice')}
        </h2>
        <p id={descriptionId} className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600">
          {message}
        </p>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="btn-primary mt-6 w-full justify-center"
        >
          OK
        </button>
      </div>
    </div>
  )
}
