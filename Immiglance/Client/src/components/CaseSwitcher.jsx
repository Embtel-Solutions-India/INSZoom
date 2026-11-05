import { useEffect, useRef, useState } from "react";
import { useActiveCase } from "../context/ActiveCaseContext";

// Header case menu for a person with two or more cases (one login, many cases). The button looks like the case line it replaces (case number,
// visa, name); the menu lists every case with its visa, the person's role on it and its status. Picking one opens that case's dashboard.
const roleLabel = { client: "", employer: "Employer", "employer (delegate)": "Employer", petitioner: "Petitioner", employee: "Employee", beneficiary: "Beneficiary" };
const statusLabel = (value) => String(value || "").replace(/_/g, " ");

export default function CaseSwitcher({ caseRef, visaLabel, displayName, onSwitched }) {
  const { cases, activeCaseId, selectCase } = useActiveCase();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (id) => {
    setOpen(false);
    if (id === activeCaseId) return;
    selectCase(id);
    onSwitched?.();
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Open another case (${cases.length} cases)`}
        className="flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-secondary"
      >
        <span className="min-w-0">
          <span className="mono block truncate text-sm font-bold text-foreground">{caseRef}</span>
          <span className="block truncate text-xs text-muted-foreground">{visaLabel} — {displayName}</span>
        </span>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{cases.length} cases</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-1 shadow-xl" role="listbox" aria-label="Your cases">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your cases</p>
          {cases.map((row) => {
            const active = row._id === activeCaseId;
            const role = roleLabel[row.capacity] ?? "";
            return (
              <button
                key={row._id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(row._id)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${active ? "bg-primary/10" : "hover:bg-secondary"}`}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-sm ${active ? "font-bold text-primary" : "font-semibold text-foreground"}`}>{row.visaType || "Case"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[row.caseNumber, role, statusLabel(row.status)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {active && <span className="shrink-0 text-[11px] font-semibold text-primary">Open</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
