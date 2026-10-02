import { useState } from "react";
import { familyWorkflowApi } from "../../services/api";

// The petitioner's own "invite my family member" / "I'll fill it myself"
// choice, self-serve from their own dashboard — previously this was a
// one-time pick only a CASE MANAGER made at case creation
// (familyCompletionMode in the Admin CreateCaseModal payload), with no way
// for the petitioner to change it themselves afterward (e.g. the invite
// email bounced, or they've decided to just do it themselves). Only ever
// rendered for the petitioner (Documents.jsx gates this on
// allowedRoles.includes("petitioner")) — the beneficiary never sees this.
export default function FamilyCompletionModeBanner({ activeCase, onChanged }) {
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [email, setEmail] = useState(activeCase?.beneficiaryInvite?.email || "");
  const [name, setName] = useState(activeCase?.beneficiaryInvite?.name || "");
  const [phone, setPhone] = useState(activeCase?.beneficiaryInvite?.phone || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // "Invited" = a real invite is out. An unset mode ("") is the same as
  // filling it yourself, so it offers the invite instead of claiming one was sent.
  const beneficiaryEmail = activeCase?.beneficiaryInvite?.email;
  const beneficiaryName = activeCase?.beneficiaryInvite?.name || activeCase?.beneficiaryUser?.name || activeCase?.beneficiaryUser?.displayName;
  const isInvited = activeCase?.familyCompletionMode === "invite_beneficiary" && Boolean(beneficiaryEmail);
  const isPetitionerCompletes = !isInvited;

  const switchToSelfComplete = async () => {
    setSaving(true);
    setError("");
    try {
      await familyWorkflowApi.setCompletionMode(activeCase._id, { familyCompletionMode: "petitioner_completes" });
      await onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update this — please try again.");
    } finally {
      setSaving(false);
    }
  };

  const submitInvite = async (event) => {
    event.preventDefault();
    if (!email.trim() || !phone.trim()) {
      setError("Their email and mobile number are both required to send the invite.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await familyWorkflowApi.setCompletionMode(activeCase._id, {
        familyCompletionMode: "invite_beneficiary",
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim(),
      });
      setShowInviteForm(false);
      await onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || "Could not send the invite — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
      {error && <p className="mb-2 text-xs font-medium text-destructive">{error}</p>}

      {!showInviteForm && isPetitionerCompletes && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">You're completing your family member's information yourself.</p>
          <button
            type="button"
            onClick={() => setShowInviteForm(true)}
            className="text-xs font-semibold text-primary hover:underline shrink-0"
          >
            Invite them to fill it in instead
          </button>
        </div>
      )}

      {!showInviteForm && !isPetitionerCompletes && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">
            {beneficiaryName ? `${beneficiaryName} (${beneficiaryEmail})` : beneficiaryEmail} has been invited to complete their own section.
          </p>
          <button
            type="button"
            onClick={switchToSelfComplete}
            disabled={saving}
            className="text-xs font-semibold text-primary hover:underline disabled:opacity-50 shrink-0"
          >
            {saving ? "Switching…" : "Switch to filling it myself instead"}
          </button>
        </div>
      )}

      {showInviteForm && (
        <form onSubmit={submitInvite} className="space-y-2">
          <p className="text-sm font-medium text-foreground">Invite your family member to complete their own section</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input type="text" placeholder="Their name" value={name} onChange={(e) => setName(e.target.value)} className="input-field text-sm" />
            <input type="email" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field text-sm" required />
            <input type="tel" placeholder="Their mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} className="input-field text-sm" required />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
              {saving ? "Sending…" : "Send Invite"}
            </button>
            <button type="button" onClick={() => setShowInviteForm(false)} disabled={saving} className="text-xs font-semibold text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
