import { useEffect, useRef } from "react";

// A reminder shown to the CLIENT, on every case type (employer/employee, family, single party, premium processing), after Save progress succeeds. It is wording only - it changes no
// save, submit or notification behaviour anywhere; it just nudges the client to finish and submit the required items.
// Centered, themed popup (same look as GrantAccessModal).
export default function SaveProgressNoticeModal({ open, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    dialogRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="save-progress-notice-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl outline-none">
        <h2 id="save-progress-notice-title" className="text-base font-bold text-foreground">Your progress is saved</h2>
        <p className="mt-3 rounded-xl bg-primary/10 p-4 text-sm leading-relaxed text-muted-foreground ring-1 ring-inset ring-primary/10">
          Your work up to here has been saved, so you will not have to start from the first question when you come back.
          <strong className="mt-2 block text-foreground">Nothing will go to your case manager until you submit the checklist. Your case manager will start working on your case only after you submit it.</strong>
        </p>
        <button type="button" onClick={onClose} className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90">Got it</button>
      </div>
    </div>
  );
}
