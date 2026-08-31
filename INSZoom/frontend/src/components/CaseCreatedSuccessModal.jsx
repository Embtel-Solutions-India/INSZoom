import { useEffect, useRef } from 'react'
import { CheckCircle } from 'lucide-react'

export default function CaseCreatedSuccessModal({ caseNumber, onClose }) {
  const closeButtonRef = useRef(null)
  const titleId = 'case-created-success-title'
  const descriptionId = 'case-created-success-description'

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
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 id={titleId} className="text-xl font-bold text-gray-900">
          Yay! New case created
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-gray-600">
          {caseNumber
            ? `Case ${caseNumber} has been successfully created and added.`
            : 'Your new case has been successfully created and added.'}
        </p>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="btn-primary mt-6 w-full justify-center"
        >
          OK, Thanks
        </button>
      </div>
    </div>
  )
}
