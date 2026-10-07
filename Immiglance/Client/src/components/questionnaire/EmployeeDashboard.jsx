import { useEffect, useState } from "react";
import { casesApi, questionnairesApi } from "../../services/api";
import AddEmployeeModal from "./AddEmployeeModal";

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

// One employee card's progress bars — reads the same listCaseChecklists
// endpoint CRMCaseDetail.jsx (Admin) already uses for its own documents
// progress, so the dashboard never has to load a child's full questionnaire
// just to show two percentages.
function useChildProgress(childId, targetRole, enabled) {
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) { setProgress(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    questionnairesApi.listCaseChecklists(childId)
      .then((res) => {
        if (cancelled) return;
        const checklists = res?.checklists || res?.data?.checklists || [];
        const entry = checklists.find((c) => c.targetRole === targetRole) || checklists[0] || null;
        setProgress(entry || null);
      })
      .catch(() => { if (!cancelled) setProgress(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [childId, targetRole, enabled]);

  return { progress, loading };
}

function ProgressBar({ label, done, total, percent }) {
  const pct = typeof percent === "number" ? percent : (total ? Math.round((done / total) * 100) : 0);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
        <span>{label}</span>
        <span className="font-semibold text-slate-600">{typeof done === "number" ? `${done} / ${total}` : `${pct}%`}</span>
      </div>
      <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-slate-900 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// §7A.0's shared status-pill palette — identical labels/colors to the Admin
// CRM's own Employees panel, so a case looks the same in both portals.
const STATUS_STYLES = {
  "Not Started": "bg-slate-100 text-slate-500",
  "Invited": "bg-blue-50 text-blue-700",
  "Invitation Failed": "bg-amber-50 text-amber-700",
  "In Progress": "bg-indigo-50 text-indigo-700",
  "Ready for Review": "bg-violet-50 text-violet-700",
  "Completed": "bg-emerald-50 text-emerald-700",
  "Withdrawn": "bg-slate-100 text-slate-400",
};

function StatusPill({ label }) {
  const dotColor = {
    "Not Started": "bg-slate-400", "Invited": "bg-blue-500", "Invitation Failed": "bg-amber-500",
    "In Progress": "bg-indigo-500", "Ready for Review": "bg-violet-500", "Completed": "bg-emerald-500", "Withdrawn": "bg-slate-300",
  }[label] || "bg-slate-400";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full ${STATUS_STYLES[label] || "bg-slate-100 text-slate-500"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}

function statusPillFor(child, dataEntryMode, progress) {
  if (progress?.status === "submitted" || progress?.status === "approved") {
    return progress.status === "approved" ? "Completed" : "Ready for Review";
  }
  if (dataEntryMode === "invite") {
    return child.clientEmail ? "Invited" : "Not Started";
  }
  const percent = progress?.progress?.percent ?? 0;
  if (percent >= 100) return "Ready for Review";
  if (percent > 0) return "In Progress";
  return "Not Started";
}

function EmployeeCard({ child, dataEntryMode: caseDefaultMode, targetRole, onOpen, onInviteSent, onResend, onWithdraw }) {
  // Each employee has their own workflow; an employee without an individual choice follows the case-wide default.
  const dataEntryMode = child.employeeDataEntryMode || caseDefaultMode;
  const identified = Boolean(child.clientName) || dataEntryMode === "fill_self";
  const invited = dataEntryMode === "invite" && Boolean(child.clientEmail);
  // Once an employee is invited, ownership of their checklist/answers
  // transfers to their own account (inviteEmployee pulls the child case off
  // the employer's caseIds) — the employer's own session can no longer read
  // it, by design (see EmployeeSelfServiceView.jsx's own comment on this
  // being an intentional privacy boundary, not a gap). Skip fetching
  // progress numbers we already know the API will 403 on.
  const { progress, loading } = useChildProgress(child._id, targetRole, !invited);
  const [inviting, setInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const pillLabel = statusPillFor(child, dataEntryMode, progress);
  // A slot nobody has decided for yet (no explicit choice, no employee named, nothing entered) asks the employer who
  // fills it in, instead of silently assuming "employer fills".
  const undecided = !child.employeeDataEntryMode && !child.clientName && caseDefaultMode !== "invite" && !(progress?.progress?.percent > 0) && pillLabel !== "Withdrawn";

  const handleSwitchToFillSelf = async () => {
    const who = child.clientName || "this employee";
    if (!window.confirm(`Fill in ${who}'s information yourself? Their invitation will be cancelled and they will lose access to this case. Anything already entered is kept.`)) return;
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
      className={`rounded-xl border bg-white p-6 space-y-4 transition-shadow ${
        identified || dataEntryMode === "invite"
          ? "border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-slate-300"
          : "border-dashed border-slate-300"
      } ${pillLabel === "Withdrawn" ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${identified ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-400"}`}>
            {identified ? initials(child.clientName) : "?"}
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-bold truncate ${identified ? "text-slate-900" : "text-slate-400 italic font-medium"}`}>
              {child.clientName || "Employee Slot"}
            </p>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{child.caseNumber}</p>
            <span className="mt-1.5 mr-1.5 inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
              {child.petitionSubType && child.petitionSubType !== child.visaType ? `${child.visaType} · ${child.petitionSubType}` : child.visaType}
            </span>
            <span
              className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                undecided ? "bg-amber-50 text-amber-700" : dataEntryMode === "invite" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"
              }`}
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
              <button type="button" onClick={() => setMenuOpen((v) => !v)} className="text-slate-400 hover:text-slate-600 px-1 leading-none" aria-label="Employee workflow options">⋯</button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1">
                  {invited && (
                    <>
                      <button type="button" onClick={() => { setMenuOpen(false); onResend(child._id); }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Resend invite</button>
                      <button type="button" disabled={switching} onClick={() => { setMenuOpen(false); handleSwitchToFillSelf(); }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">I'll fill this myself instead</button>
                    </>
                  )}
                  {!invited && (
                    <button type="button" onClick={() => { setMenuOpen(false); setShowInviteForm(true); setError(""); }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Invite this employee to fill it in</button>
                  )}
                  <button type="button" onClick={() => { setMenuOpen(false); onWithdraw(child._id); }} className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">Withdraw</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!loading && progress && (
        <div className="space-y-2.5">
          <ProgressBar label="Documents" done={progress.documentProgress?.answeredTotal} total={progress.documentProgress?.totalQuestions} />
          <ProgressBar label="Questionnaire" percent={progress.progress?.percent} />
        </div>
      )}

      {error && !showInviteForm && <p className="text-xs text-red-600">{error}</p>}

      {showInviteForm ? (
        <div className="space-y-2 animate-in fade-in duration-150">
          <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} disabled={inviting} />
          <input type="email" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} disabled={inviting} />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={handleSendInvite} disabled={inviting} className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-40">
              {inviting ? "Sending…" : "Send Invite"}
            </button>
            <button type="button" onClick={() => { setShowInviteForm(false); setError(""); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button>
          </div>
        </div>
      ) : undecided ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">Who will fill in this employee's information?</p>
          <div className="flex gap-2">
            <button type="button" disabled={switching} onClick={handleChooseFillSelf} className="flex-1 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50">
              {switching ? "Saving…" : "I'll fill it myself"}
            </button>
            <button type="button" disabled={switching} onClick={() => { setShowInviteForm(true); setError(""); }} className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
              Invite employee
            </button>
          </div>
          <p className="text-[11px] text-slate-400">You can change this later from this card.</p>
        </div>
      ) : invited ? (
        <div className="space-y-2">
          <p className="text-center text-xs text-slate-400 py-1.5">
            {pillLabel === "Ready for Review" || pillLabel === "Completed"
              ? `${child.clientName} has submitted their information.`
              : `Waiting for ${child.clientName} to complete their information.`}
          </p>
          <button type="button" disabled={switching} onClick={handleSwitchToFillSelf} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            I'll fill this myself instead
          </button>
        </div>
      ) : dataEntryMode === "invite" ? (
        <button type="button" onClick={() => setShowInviteForm(true)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors">
          Invite Employee
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(child._id)}
          className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold text-white hover:bg-slate-700 transition-colors"
        >
          {pillLabel === "Not Started" ? "Fill Information" : pillLabel === "Ready for Review" || pillLabel === "Completed" ? "Review" : "Continue"}
        </button>
      )}
      {!showInviteForm && !undecided && !invited && dataEntryMode !== "invite" && pillLabel !== "Withdrawn" && (
        <button type="button" onClick={() => { setShowInviteForm(true); setError(""); }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          Invite employee to fill it instead
        </button>
      )}
    </div>
  );
}

function AddEmployeeGhostCard({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border-2 border-dashed border-slate-300 p-6 flex items-center justify-center text-sm font-bold text-slate-400 hover:text-slate-600 hover:border-slate-400 transition-colors min-h-28"
    >
      + Add Employee
    </button>
  );
}

// Landing page shown after the fill_self/invite mode choice — replaces the
// old plain tab bar with one card per employee slot, matching the Admin
// CRM's own Employees panel (status pills, resend/withdraw) so both portals
// present the same matter consistently.
export default function EmployeeDashboard({ principalId, children, dataEntryMode, targetRole, defaultVisaType, onOpen, onChanged }) {
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

  const handleWithdraw = async (childId) => {
    if (!window.confirm("Withdraw this employee? Their information is kept for your records, but they won't be included in this filing.")) return;
    try {
      await casesApi.removeEmployee(childId);
      onChanged();
    } catch (err) {
      setActionError(err.message || "Failed to withdraw employee");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">Employees ({children.length})</h2>
      </div>
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{actionError}</div>
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
          />
        ))}
        <AddEmployeeGhostCard onClick={handleAddEmployee} />
        {children.length === 0 && <p className="text-sm text-slate-400 col-span-full">No employees on this case yet.</p>}
      </div>
    </div>
  );
}
