import { useEffect, useState } from "react";
import { casesApi, questionnairesApi } from "../../services/api";
import AddEmployeeModal from "./AddEmployeeModal";
import ConfirmDialog from "./ConfirmDialog";

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

// One employee card's progress bars — reads the same listCaseChecklists
// endpoint CRMCaseDetail.jsx (Admin) already uses for its own documents
// progress, so the dashboard never has to load a child's full questionnaire
// just to show two percentages.
//
// An INVITED employee's card reads the same numbers: the employer is allowed a read-only view of the employee's progress (backend
// employer-view-access.js), and the card re-reads them every `pollMs` so what the employee saves or submits shows up without a reload.
function useChildProgress(childId, targetRole, enabled, pollMs = 0) {
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) { setProgress(null); setLoading(false); return undefined; }
    let cancelled = false;
    const read = (initial) => {
      if (initial) setLoading(true);
      return questionnairesApi.listCaseChecklists(childId)
        .then((res) => {
          if (cancelled) return;
          const checklists = res?.checklists || res?.data?.checklists || [];
          const entry = checklists.find((c) => c.targetRole === targetRole) || checklists[0] || null;
          setProgress(entry || null);
        })
        // a failed background refresh keeps the numbers already on screen; only the first read may leave the card without bars
        .catch(() => { if (!cancelled && initial) setProgress(null); })
        .finally(() => { if (!cancelled && initial) setLoading(false); });
    };
    read(true);
    const timer = pollMs ? setInterval(() => { if (!document.hidden) read(false); }, pollMs) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [childId, targetRole, enabled, pollMs]);

  return { progress, loading };
}

// Exact numbers from the server (answered / visible questions) - never estimated here. Shows "56% · 5 of 9" when the counts are known.
function ProgressBar({ label, done, total, percent }) {
  const pct = typeof percent === "number" ? percent : (total ? Math.round((done / total) * 100) : 0);
  const counts = typeof done === "number" && typeof total === "number";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-semibold text-foreground tabular-nums">
          {pct}%
          {counts && <span className="ml-1.5 font-normal text-muted-foreground">{done} of {total}</span>}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: "#0f766e" }} />
      </div>
    </div>
  );
}

// Status pills: the same labels as the Admin CRM's own Employees panel. No rainbow: a deep teal (the theme's accent) for any employee who is
// moving - invited, in progress, ready, completed - a quiet grey for one who has not started or was withdrawn, and red only for a failed invite.
const PILL = "bg-accent text-accent-foreground ring-1 ring-inset ring-accent-foreground/10";
const QUIET_PILL = "bg-secondary text-muted-foreground ring-1 ring-inset ring-border";
const STATUS_STYLES = {
  "Not Started": QUIET_PILL,
  "Invited": PILL,
  "Invitation Failed": "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
  "In Progress": PILL,
  "Ready for Review": PILL,
  "Completed": PILL,
  "Withdrawn": QUIET_PILL,
};

function StatusPill({ label }) {
  const dotColor = { "Not Started": "bg-muted-foreground/50", "Withdrawn": "bg-muted-foreground/50", "Invitation Failed": "bg-destructive" }[label] || "bg-accent-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full ${STATUS_STYLES[label] || "bg-secondary text-muted-foreground"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}

function statusPillFor(child, dataEntryMode, progress) {
  if (progress?.status === "submitted" || progress?.status === "approved") {
    return progress.status === "approved" ? "Completed" : "Ready for Review";
  }
  const percent = progress?.progress?.percent ?? 0;
  if (dataEntryMode === "invite") {
    if (child.clientEmail && percent > 0) return percent >= 100 ? "Ready for Review" : "In Progress";
    return child.clientEmail ? "Invited" : "Not Started";
  }
  if (percent >= 100) return "Ready for Review";
  if (percent > 0) return "In Progress";
  return "Not Started";
}

function EmployeeCard({ child, dataEntryMode: caseDefaultMode, targetRole, onOpen, onInviteSent, onResend, onWithdraw, onGrantAccess }) {
  // Each employee has their own workflow; an employee without an individual choice follows the case-wide default.
  const dataEntryMode = child.employeeDataEntryMode || caseDefaultMode;
  // The employee's name and email, whoever typed them (the case team in Admin, or the employer here) - the case holds them once for both portals.
  const contact = child.employeeContact || { name: child.clientName || "", email: child.clientEmail || "" };
  const displayName = child.clientName || contact.name;
  const identified = Boolean(displayName) || dataEntryMode === "fill_self";
  const invited = dataEntryMode === "invite" && Boolean(child.clientEmail);
  // Once an employee is invited, ownership of their checklist/answers transfers to their own account (inviteEmployee pulls the child
  // case off the employer's caseIds): the employer cannot EDIT it any more, but may READ it (backend employer-view-access.js) - so the
  // card shows the employee's real, live progress and offers a read-only view of what they have filled in.
  const { progress, loading } = useChildProgress(child._id, targetRole, true, invited ? 30000 : 0);
  // an employee who had access before and whose information the employer took back: access can be given again in one step
  const returning = !invited && Boolean(child.clientEmail) && Boolean(child.clientName) && dataEntryMode !== "invite";
  const [inviting, setInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [name, setName] = useState(contact.name || "");
  const [email, setEmail] = useState(contact.email || "");
  const [idName, setIdName] = useState(contact.name || "");
  const [idEmail, setIdEmail] = useState(contact.email || "");
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [confirmFillSelf, setConfirmFillSelf] = useState(false);

  const pillLabel = statusPillFor(child, dataEntryMode, progress);
  // A slot nobody has decided for yet (no explicit choice, no employee named, nothing entered) asks the employer who
  // fills it in, instead of silently assuming "employer fills".
  // Until the employee's name and email are known the card asks for them (before anything else, whichever way the employer chooses to proceed).
  const identityMissing = !invited && pillLabel !== "Withdrawn" && (!contact.name || !contact.email);
  const undecided = !child.employeeDataEntryMode && !child.clientName && caseDefaultMode !== "invite" && !(progress?.progress?.percent > 0) && pillLabel !== "Withdrawn";

  const handleSaveIdentity = async () => {
    if (!idName.trim() && !idEmail.trim()) { setError("Enter the employee's name and email."); return; }
    setSavingIdentity(true);
    setError("");
    try {
      const payload = {};
      if (idName.trim()) payload.name = idName.trim();
      if (idEmail.trim()) payload.email = idEmail.trim();
      const res = await casesApi.setEmployeeIdentity(child.principalId, child._id, payload);
      if (res?.success === false) setError(res.message || "Could not save the employee details");
      else onInviteSent();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not save the employee details");
    } finally {
      setSavingIdentity(false);
    }
  };

  const handleSwitchToFillSelf = async () => {
    setConfirmFillSelf(false);
    setSwitching(true);
    setError("");
    try {
      const res = await casesApi.setEmployeeDataEntryMode(child.principalId, child._id, { mode: "fill_self" });
      if (res?.success) onInviteSent();
      else setError(res?.message || "Could not change this employee's workflow");
    } catch (err) {
      setError(err.message || "Could not change this employee's workflow");
    } finally {
      setSwitching(false);
    }
  };

  const handleChooseFillSelf = async () => {
    setSwitching(true);
    setError("");
    try {
      const res = await casesApi.setEmployeeDataEntryMode(child.principalId, child._id, { mode: "fill_self" });
      if (res?.success) onInviteSent();
      else setError(res?.message || "Could not save your choice");
    } catch (err) {
      setError(err.message || "Could not save your choice");
    } finally {
      setSwitching(false);
    }
  };

  const handleSendInvite = async () => {
    if (!name.trim() || !email.trim()) { setError("Name and email are required."); return; }
    setInviting(true);
    setError("");
    try {
      const res = await casesApi.setEmployeeDataEntryMode(child.principalId, child._id, { mode: "invite", employeeName: name.trim(), employeeEmail: email.trim() });
      if (res?.success) onInviteSent();
      else setError(res?.message || "Failed to send invite");
    } catch (err) {
      setError(err.message || "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border bg-card p-6 space-y-4 transition-shadow ${
        identified || dataEntryMode === "invite"
          ? "border-border shadow-[0_1px_3px_rgba(15,23,42,0.05)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.07)]"
          : "border-dashed border-border"
      } ${pillLabel === "Withdrawn" ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${identified ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
            {identified ? initials(displayName) : "?"}
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-bold truncate ${identified ? "text-foreground" : "text-muted-foreground italic font-medium"}`}>
              {displayName || "Employee Slot"}
            </p>
            {contact.email && <p className="text-xs text-muted-foreground truncate">{contact.email}</p>}
            <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">{child.caseNumber}</p>
            <span className="mt-1.5 mr-1.5 inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold tracking-wide text-foreground ring-1 ring-inset ring-border">
              {child.petitionSubType && child.petitionSubType !== child.visaType ? `${child.visaType} · ${child.petitionSubType}` : child.visaType}
            </span>
            <span
              className="mt-1.5 inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              title={dataEntryMode === "invite" ? "This employee fills in their own information" : "You fill in this employee's information"}
            >
              {undecided ? "Choose who fills" : dataEntryMode === "invite" ? "Employee fills (invited)" : "Employer fills"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill label={pillLabel} />
          {pillLabel !== "Withdrawn" && (
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((v) => !v)} className="text-muted-foreground hover:text-foreground px-1 leading-none" aria-label="Employee workflow options">⋯</button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-lg z-10 py-1">
                  {invited && (
                    <>
                      <button type="button" onClick={() => { setMenuOpen(false); onOpen(child._id, { readOnly: true }); }} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-secondary">View information (read only)</button>
                      <button type="button" onClick={() => { setMenuOpen(false); onResend(child._id); }} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-secondary">Resend invite</button>
                      <button type="button" disabled={switching} onClick={() => { setMenuOpen(false); setConfirmFillSelf(true); }} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">I'll fill this myself instead</button>
                    </>
                  )}
                  {!invited && (
                    <button type="button" onClick={() => { setMenuOpen(false); if (returning) onGrantAccess?.(child); else { setShowInviteForm(true); setError(""); } }} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-secondary">
                      {returning ? `Grant access to ${child.clientName} again` : "Invite this employee to fill it in"}
                    </button>
                  )}
                  <button type="button" onClick={() => { setMenuOpen(false); onWithdraw(child._id); }} className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">Withdraw</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!loading && progress && (
        <div className="space-y-2.5" data-testid="employee-progress">
          <ProgressBar label="Documents" done={progress.documentProgress?.answeredTotal} total={progress.documentProgress?.totalQuestions} percent={progress.documentProgress?.percent} />
          <ProgressBar
            label="Information"
            done={(progress.textProgress || progress.progress)?.answeredTotal}
            total={(progress.textProgress || progress.progress)?.totalQuestions}
            percent={(progress.textProgress || progress.progress)?.percent}
          />
        </div>
      )}

      {error && !showInviteForm && !identityMissing && <p className="text-xs text-destructive">{error}</p>}

      {identityMissing && !showInviteForm && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-3" data-testid="employee-identity-request">
          <p className="text-xs font-semibold text-foreground">Add this employee's name and email</p>
          <p className="text-[11px] text-muted-foreground">We need to know who this employee is before their information can be filled in or an invitation sent.</p>
          <input className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-ring" placeholder="Full name" value={idName} onChange={(e) => setIdName(e.target.value)} disabled={savingIdentity} aria-label="Employee full name" />
          <input type="email" className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-ring" placeholder="Email address" value={idEmail} onChange={(e) => setIdEmail(e.target.value)} disabled={savingIdentity} aria-label="Employee email" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button type="button" onClick={handleSaveIdentity} disabled={savingIdentity} className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {savingIdentity ? "Saving…" : "Save details"}
          </button>
        </div>
      )}

      {showInviteForm ? (
        <div className="space-y-2 animate-in fade-in duration-150">
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-ring" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} disabled={inviting} />
          <input type="email" className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-ring" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} disabled={inviting} />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={handleSendInvite} disabled={inviting} className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
              {inviting ? "Sending…" : "Send Invite"}
            </button>
            <button type="button" onClick={() => { setShowInviteForm(false); setError(""); }} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground">Cancel</button>
          </div>
        </div>
      ) : undecided && identityMissing ? null : undecided ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Who will fill in this employee's information?</p>
          <div className="flex gap-2">
            <button type="button" disabled={switching} onClick={handleChooseFillSelf} className="flex-1 rounded-lg bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {switching ? "Saving…" : "I'll fill it myself"}
            </button>
            <button type="button" disabled={switching} onClick={() => { setShowInviteForm(true); setError(""); }} className="flex-1 rounded-lg border border-border px-3 py-2.5 text-xs font-bold text-foreground hover:bg-secondary">
              Invite employee
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">You can change this later from this card.</p>
        </div>
      ) : invited ? (
        <div className="space-y-2">
          <p className="text-center text-xs text-muted-foreground py-1.5">
            {pillLabel === "Ready for Review" || pillLabel === "Completed"
              ? `${child.clientName} has submitted their information.`
              : pillLabel === "In Progress"
                ? `${child.clientName} is filling in their information.`
                : `Waiting for ${child.clientName} to start their information.`}
          </p>
          <button type="button" onClick={() => onOpen(child._id, { readOnly: true })} className="w-full rounded-lg bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors">
            View what {child.clientName} filled in
            <span className="ml-1.5 rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Read only</span>
          </button>
          <button type="button" disabled={switching} onClick={() => setConfirmFillSelf(true)} className="w-full rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50">
            I'll fill this myself instead
          </button>
        </div>
      ) : dataEntryMode === "invite" ? (
        <button type="button" onClick={() => setShowInviteForm(true)} className="w-full rounded-lg border border-border px-3 py-2.5 text-xs font-bold text-foreground hover:bg-secondary hover:border-primary/40 transition-colors">
          Invite Employee
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(child._id)}
          className="w-full rounded-lg bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {pillLabel === "Not Started" ? "Fill Information" : pillLabel === "Ready for Review" || pillLabel === "Completed" ? "Review" : "Continue"}
        </button>
      )}
      {!showInviteForm && !undecided && !invited && dataEntryMode !== "invite" && pillLabel !== "Withdrawn" && (
        returning ? (
          <button type="button" onClick={() => onGrantAccess?.(child)} className="w-full rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
            Grant access to {child.clientName} again
          </button>
        ) : (
          <button type="button" onClick={() => { setShowInviteForm(true); setError(""); }} className="w-full rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary">
            Invite employee to fill it instead
          </button>
        )
      )}
      {confirmFillSelf && (
        <ConfirmDialog
          title={`Fill in ${child.clientName || "this employee"}'s information yourself?`}
          message={"Their invitation will be cancelled and they will lose access to this case. Anything already entered is kept."}
          confirmLabel="Yes, I'll fill it in"
          busy={switching}
          onConfirm={handleSwitchToFillSelf}
          onCancel={() => setConfirmFillSelf(false)}
        />
      )}
    </div>
  );
}

function AddEmployeeGhostCard({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border-2 border-dashed border-border p-6 flex items-center justify-center text-sm font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors min-h-28"
    >
      + Add Employee
    </button>
  );
}

// Landing page shown after the fill_self/invite mode choice — replaces the
// old plain tab bar with one card per employee slot, matching the Admin
// CRM's own Employees panel (status pills, resend/withdraw) so both portals
// present the same matter consistently.
export default function EmployeeDashboard({ principalId, children, dataEntryMode, targetRole, defaultVisaType, onOpen, onChanged, onGrantAccess }) {
  const [actionError, setActionError] = useState("");
  const [showAddEmployee, setShowAddEmployee] = useState(false);

  const handleAddEmployee = () => setShowAddEmployee(true);

  const handleResend = async (childId) => {
    try {
      await casesApi.resendEmployeeInvite(principalId, childId);
      onChanged();
    } catch (err) {
      setActionError(err.message || "Failed to resend invite");
    }
  };

  // Withdrawing asks first, in a themed dialog (the target child is held until the employer confirms).
  const [withdrawTarget, setWithdrawTarget] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const handleWithdraw = (childId) => setWithdrawTarget(children.find((child) => child._id === childId) || { _id: childId });
  const confirmWithdraw = async () => {
    setWithdrawing(true);
    try {
      await casesApi.removeEmployee(withdrawTarget._id);
      setWithdrawTarget(null);
      onChanged();
    } catch (err) {
      setWithdrawTarget(null);
      setActionError(err.message || "Failed to withdraw employee");
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">Employees ({children.length})</h2>
      </div>
      {actionError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{actionError}</div>
      )}
      {withdrawTarget && (
        <ConfirmDialog
          title={`Withdraw ${withdrawTarget.clientName || "this employee"}?`}
          message={"Their information is kept for your records, but they won't be included in this filing."}
          confirmLabel="Withdraw"
          tone="danger"
          busy={withdrawing}
          onConfirm={confirmWithdraw}
          onCancel={() => setWithdrawTarget(null)}
        />
      )}
      {showAddEmployee && (
        <AddEmployeeModal
          principalId={principalId}
          defaultVisaType={defaultVisaType}
          onClose={() => setShowAddEmployee(false)}
          onAdded={(message) => { setShowAddEmployee(false); if (message) setActionError(message); onChanged(); }}
        />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {children.map((child) => (
          <EmployeeCard
            key={child._id}
            child={{ ...child, principalId }}
            dataEntryMode={dataEntryMode}
            targetRole={targetRole}
            onOpen={onOpen}
            onInviteSent={onChanged}
            onResend={handleResend}
            onWithdraw={handleWithdraw}
            onGrantAccess={onGrantAccess}
          />
        ))}
        <AddEmployeeGhostCard onClick={handleAddEmployee} />
        {children.length === 0 && <p className="text-sm text-muted-foreground col-span-full">No employees on this case yet.</p>}
      </div>
    </div>
  );
}
