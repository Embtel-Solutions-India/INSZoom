import { useEffect, useRef } from "react";

// Themed confirmation dialog, centered on screen - the replacement for the browser's native confirm box in the employer/employee flows.
// Closes on Escape or a click outside; `busy` locks both buttons while the confirmed action runs; `tone="danger"` colours the confirm button
// for destructive actions (withdrawing an employee). Same look as GrantAccessModal.
export default function ConfirmDialog({ title, message, confirmLabel = "Yes", cancelLabel = "Cancel", tone = "default", busy = false, error = "", onConfirm, onCancel }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape" && !busy) onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const confirmClass = tone === "danger" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel?.(); }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-xl">
        <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-xl ${tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`} aria-hidden="true">
          {tone === "danger" ? "!" : "?"}
        </div>
        <h2 id="confirm-dialog-title" className="text-base font-bold text-foreground">{title}</h2>
        <p id="confirm-dialog-message" className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{message}</p>
        {error && <p role="alert" className="mt-3 text-xs font-medium text-destructive">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-40">
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" onClick={onConfirm} disabled={busy} className={`flex-1 rounded-lg px-4 py-2.5 text-xs font-bold disabled:opacity-50 ${confirmClass}`}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
