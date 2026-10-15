import { useState } from "react";
import { casesApi } from "../../services/api";
import ConfirmDialog from "./ConfirmDialog";

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

  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const handleWithdraw = async () => {
    setConfirmWithdraw(false);
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
    if (!invited) return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-secondary text-muted-foreground ring-1 ring-inset ring-border">Not invited</span>;
    if (sendResult === "failed") return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-destructive/10 text-destructive">Invitation Failed</span>;
    if (sendResult === "pending") return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-accent text-accent-foreground">Invitation Queued</span>;
    return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-accent text-accent-foreground">Invited</span>;
  };

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      {confirmWithdraw && (
        <ConfirmDialog
          title={`Withdraw ${child.clientName || "this employee"}?`}
          message={"Their information is kept for your records, but they won't be included in this filing."}
          confirmLabel="Withdraw"
          tone="danger"
          onConfirm={handleWithdraw}
          onCancel={() => setConfirmWithdraw(false)}
        />
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{child.caseNumber}</span>
        {statusPill()}
      </div>

      {invited ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{child.clientName} — {child.clientEmail}</p>
          <div className="flex items-center gap-3 shrink-0">
            <button type="button" onClick={handleResend} disabled={sending} className="text-xs font-semibold text-foreground hover:text-foreground disabled:opacity-40">
              {sending ? "Sending…" : "Resend"}
            </button>
            <button type="button" onClick={() => setConfirmWithdraw(true)} disabled={withdrawing} className="text-xs font-semibold text-destructive hover:text-destructive/80 disabled:opacity-40">
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-ring"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={sending}
          />
          <input
            type="email"
            className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-ring"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={sending}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="sm:col-span-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send Invite"}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
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
    <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Invite Employees</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Send each employee their own secure link to complete their own questionnaire.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddEmployee}
          disabled={addingSlot}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground hover:bg-secondary disabled:opacity-40"
        >
          {addingSlot ? "Adding…" : "+ Add Employee"}
        </button>
      </div>
      {addError && <p className="text-xs text-destructive">{addError}</p>}
      <div className="space-y-3">
        {children.map((child) => (
          <InviteRow key={child._id} principalCaseId={principalCaseId} child={child} onInvited={onChanged} onChanged={onChanged} />
        ))}
        {children.length === 0 && <p className="text-sm text-muted-foreground">No employee slots on this case yet.</p>}
      </div>
    </div>
  );
}
