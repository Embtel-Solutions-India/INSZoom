import { useEffect, useRef, useState } from "react";

// Centered, themed confirmation shown when an employer GIVES an employee access to their own information (first invitation, or giving it
// back to the same employee after filling part of it in). Whatever the employer has typed is SAVED FIRST (`beforeGrant`); if that save
// fails nothing is granted, so no entry can be lost. Then `onGrant` hands the file over. The employee sees everything the employer
// entered, and the employer keeps a read-only view of the employee's progress.
//
// Props:
//   employeeName / employeeEmail  known employee (a returning one) - shown, not asked again; empty = the employer types them
//   returning                     true when this employee had access before ("grant access again" wording)
//   beforeGrant                   async () => void - saves the employer's pending entries (throw to abort)
//   onGrant                       async ({ name, email }) => void - performs the hand-over (throw to show the error)
//   onClose                       dismiss without granting
export default function GrantAccessModal({ employeeName = "", employeeEmail = "", returning = false, beforeGrant, onGrant, onClose }) {
  const [name, setName] = useState(employeeName);
  const [email, setEmail] = useState(employeeEmail);
  const [phase, setPhase] = useState("idle"); // idle | saving | granting
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const known = Boolean(employeeName && employeeEmail);
  const busy = phase !== "idle";
  const who = (known ? employeeName : name.trim()) || "the employee";

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape" && !busy) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const confirm = async (event) => {
    event?.preventDefault();
    setError("");
    const grantName = (known ? employeeName : name).trim();
    const grantEmail = (known ? employeeEmail : email).trim();
    if (!grantName || !grantEmail) { setError("Enter the employee's name and email."); return; }
    try {
      setPhase("saving");
      if (beforeGrant) await beforeGrant();
    } catch (saveError) {
      setPhase("idle");
      setError(`Your progress could not be saved, so access was not granted. ${saveError?.response?.message || saveError?.message || "Please try again."}`);
      return;
    }
    try {
      setPhase("granting");
      await onGrant({ name: grantName, email: grantEmail });
    } catch (grantError) {
      setPhase("idle");
      setError(`${grantError?.message || "Access could not be granted."} Your progress has been saved.`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose?.(); }}>
      <form
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="grant-access-title"
        onSubmit={confirm}
        className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl outline-none"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="grant-access-title" className="text-base font-bold text-foreground">
              {returning ? `Grant access to ${who} again?` : `Give ${who} access?`}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {returning ? "Hand this information back to the same employee." : "Invite the employee to fill in their own information."}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-muted-foreground hover:text-foreground disabled:opacity-40">✕</button>
        </div>

        <ul className="mb-4 space-y-2 rounded-xl bg-primary/10 p-4 text-xs text-muted-foreground ring-1 ring-inset ring-primary/10">
          <li className="flex gap-2"><span aria-hidden>1.</span><span><strong className="text-foreground">Your progress is saved first.</strong> Everything you have filled in is stored before access is granted - nothing is lost.</span></li>
          <li className="flex gap-2"><span aria-hidden>2.</span><span><strong className="text-foreground">{who === "the employee" ? "The employee" : who} sees your entries</strong> when they sign in, and can review, correct and complete the rest.</span></li>
          <li className="flex gap-2"><span aria-hidden>3.</span><span><strong className="text-foreground">You get a read-only view</strong> of what they fill in. You can take the information back at any time.</span></li>
          <li className="flex gap-2"><span aria-hidden>4.</span><span>{returning ? "They will be notified by email that access was given again." : "They will receive an invitation email."}</span></li>
        </ul>

        {!known && (
          <div className="mb-4 space-y-2">
            <input className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-ring" placeholder="Employee full name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            <input type="email" className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-ring" placeholder="Employee email address" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          </div>
        )}
        {known && <p className="mb-4 text-xs text-muted-foreground">Access goes to <strong className="text-foreground">{employeeName}</strong> ({employeeEmail}).</p>}

        {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-40">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {phase === "saving" ? "Saving your progress…" : phase === "granting" ? "Granting access…" : "Save progress & grant access"}
          </button>
        </div>
      </form>
    </div>
  );
}
