import { useEffect, useState } from "react";
import { casesApi, questionnairesApi } from "../../services/api";

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

function EmployeeCard({ child, dataEntryMode, targetRole, onOpen, onInviteSent, onResend, onWithdraw }) {
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

  const pillLabel = statusPillFor(child, dataEntryMode, progress);

  const handleSendInvite = async () => {
    if (!name.trim() || !email.trim()) { setError("Name and email are required."); return; }
    setInviting(true);
    setError("");
    try {
      const res = await casesApi.inviteEmployee(child.principalId, { childCaseId: child._id, employeeName: name.trim(), employeeEmail: email.trim() });
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
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill label={pillLabel} />
          {invited && (
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((v) => !v)} className="text-slate-400 hover:text-slate-600 px-1 leading-none">⋯</button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1">
                  <button type="button" onClick={() => { setMenuOpen(false); onResend(child._id); }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Resend invite</button>
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

      {dataEntryMode === "invite" && !invited ? (
        showInviteForm ? (
          <div className="space-y-2 animate-in fade-in duration-150">
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} disabled={inviting} />
            <input type="email" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} disabled={inviting} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={handleSendInvite} disabled={inviting} className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-40">
                {inviting ? "Sending…" : "Send Invite"}
              </button>
              <button type="button" onClick={() => setShowInviteForm(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setShowInviteForm(true)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors">
            Fill Information
          </button>
        )
      ) : invited ? (
        <p className="text-center text-xs text-slate-400 py-1.5">
          {pillLabel === "Ready for Review" || pillLabel === "Completed"
            ? `${child.clientName} has submitted their information.`
            : `Waiting for ${child.clientName} to complete their information.`}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(child._id)}
          className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold text-white hover:bg-slate-700 transition-colors"
        >
          {pillLabel === "Not Started" ? "Fill Information" : pillLabel === "Ready for Review" || pillLabel === "Completed" ? "Review" : "Continue"}
        </button>
      )}
    </div>
  );
}

// PERM has exactly one employee - no "+ Add Employee" (the server refuses it too).
export const isSingleEmployeeMatter = (children = []) => children.some((child) => child?.singleEmployee || child?.visaType === "PERM");

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
export default function EmployeeDashboard({ principalId, children, dataEntryMode, targetRole, onOpen, onChanged }) {
  const [actionError, setActionError] = useState("");

  const handleAddEmployee = async () => {
    try {
      const res = await casesApi.addEmployeeSlot(principalId);
      if (res?.success) onChanged();
      else setActionError(res?.message || "Failed to add employee slot");
    } catch (err) {
      setActionError(err.message || "Failed to add employee slot");
    }
  };

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
        {!isSingleEmployeeMatter(children) && <AddEmployeeGhostCard onClick={handleAddEmployee} />}
        {children.length === 0 && <p className="text-sm text-slate-400 col-span-full">No employees on this case yet.</p>}
      </div>
    </div>
  );
}
