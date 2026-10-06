import { useEffect, useRef } from 'react'
import { Zap } from 'lucide-react'

// Themed confirmation dialog, centered on screen (same look as InfoModal). Closes on Escape or
// a click outside; `busy` locks both buttons while the confirmed action is running.
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'Cancel',
  busy = false,
  error = '',
  children = null,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null)
  const titleId = 'confirm-modal-title'
  const descriptionId = 'confirm-modal-description'

  useEffect(() => {
    confirmRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, busy])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-2xl"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Zap className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 id={titleId} className="text-xl font-bold text-foreground">{title}</h2>
        <p id={descriptionId} className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{message}</p>
        {children}
        {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary flex-1 justify-center disabled:opacity-50">
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" onClick={onConfirm} disabled={busy} className="btn-primary flex-1 justify-center disabled:opacity-50">
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
