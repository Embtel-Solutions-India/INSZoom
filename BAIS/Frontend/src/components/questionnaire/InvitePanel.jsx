import { useState } from "react";
import { casesApi } from "../../services/api";

// One row per child case. INVARIANT: in invite mode the employer never sees
// any employee questionnaire data here — only name/email entry and the
// resulting invite status, exactly what this panel renders.
function InviteRow({ principalCaseId, child, onInvited }) {
  const [name, setName] = useState(child.clientName || "");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">{child.caseNumber}</span>
        {invited ? (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700">Invited</span>
        ) : (
          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-700">Not invited</span>
        )}
      </div>

      {invited ? (
        <p className="text-sm text-slate-500">{child.clientName} — {child.clientEmail}</p>
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
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Invite Employees</h2>
        <p className="text-sm text-slate-500 mt-1">
          Send each employee their own secure link to complete their own questionnaire.
        </p>
      </div>
      <div className="space-y-3">
        {children.map((child) => (
          <InviteRow key={child._id} principalCaseId={principalCaseId} child={child} onInvited={onChanged} />
        ))}
        {children.length === 0 && <p className="text-sm text-slate-400">No employee slots on this case yet.</p>}
      </div>
    </div>
  );
}
