import { useState } from "react";
import { casesApi } from "../../services/api";

// One row per child case. INVARIANT: in invite mode the employer never sees
// any employee questionnaire data here — only name/email entry and the
// resulting invite status, exactly what this panel renders.
function InviteRow({ principalCaseId, child, onInvited, onChanged }) {
  const [name, setName] = useState(child.clientName || "");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // The real per-send result (sent/pending/failed) from the last
  // invite/resend call this session — see case.controller.js's
  // inviteEmployee/resendEmployeeInvite, which only report "sent" once the
  // email provider actually confirms delivery, never optimistically.
  const [sendResult, setSendResult] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);

  // A child whose own clientEmail is set (populated by inviteEmployee) has
  // already been invited — show status instead of the send form.
  const invited = Boolean(child.clientEmail);

  const handleSend = async () => {
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await casesApi.inviteEmployee(principalCaseId, {
        childCaseId: child._id,
        employeeName: name.trim(),
        employeeEmail: email.trim(),
      });
      if (res?.success) {
        setSendResult(res.inviteStatus || "sent");
        onInvited();
      } else {
        setError(res?.message || "Failed to send invite");
      }
    } catch (err) {
      setError(err.message || "Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    setSending(true);
    setError("");
    try {
      const res = await casesApi.resendEmployeeInvite(principalCaseId, child._id);
      setSendResult(res?.inviteStatus || (res?.success ? "sent" : "failed"));
      if (!res?.success) setError(res?.message || "Failed to resend invite");
    } catch (err) {
      setError(err.message || "Failed to resend invite");
      setSendResult("failed");
    } finally {
      setSending(false);
    }
  };

  const handleWithdraw = async () => {
    if (!window.confirm(`Withdraw ${child.clientName || "this employee"}? Their information is kept for your records, but they won't be included in this filing.`)) return;
    setWithdrawing(true);
    setError("");
    try {
      const res = await casesApi.removeEmployee(child._id);
      if (res?.success) onChanged();
      else setError(res?.message || "Failed to withdraw employee");
    } catch (err) {
      setError(err.message || "Failed to withdraw employee");
    } finally {
      setWithdrawing(false);
    }
  };

  const statusPill = () => {
    if (!invited) return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-700">Not invited</span>;
    if (sendResult === "failed") return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700">Invitation Failed</span>;
    if (sendResult === "pending") return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-700">Invitation Queued</span>;
    return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700">Invited</span>;
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">{child.caseNumber}</span>
        {statusPill()}
      </div>

      {invited ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">{child.clientName} — {child.clientEmail}</p>
          <div className="flex items-center gap-3 shrink-0">
            <button type="button" onClick={handleResend} disabled={sending} className="text-xs font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-40">
              {sending ? "Sending…" : "Resend"}
            </button>
            <button type="button" onClick={handleWithdraw} disabled={withdrawing} className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-40">
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={sending}
          />
          <input
            type="email"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={sending}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="sm:col-span-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send Invite"}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function InvitePanel({ principalCaseId, children, onChanged }) {
  const [addingSlot, setAddingSlot] = useState(false);
  const [addError, setAddError] = useState("");

  const handleAddEmployee = async () => {
    setAddingSlot(true);
    setAddError("");
    try {
      const res = await casesApi.addEmployeeSlot(principalCaseId);
      if (res?.success) onChanged();
      else setAddError(res?.message || "Failed to add employee slot");
    } catch (err) {
      setAddError(err.message || "Failed to add employee slot");
    } finally {
      setAddingSlot(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Invite Employees</h2>
          <p className="text-sm text-slate-500 mt-1">
            Send each employee their own secure link to complete their own questionnaire.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddEmployee}
          disabled={addingSlot}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {addingSlot ? "Adding…" : "+ Add Employee"}
        </button>
      </div>
      {addError && <p className="text-xs text-red-600">{addError}</p>}
      <div className="space-y-3">
        {children.map((child) => (
          <InviteRow key={child._id} principalCaseId={principalCaseId} child={child} onInvited={onChanged} onChanged={onChanged} />
        ))}
        {children.length === 0 && <p className="text-sm text-slate-400">No employee slots on this case yet.</p>}
      </div>
    </div>
  );
}
