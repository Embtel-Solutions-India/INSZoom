import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { authApi, profileApi } from "../../services/api";
import { VISA_CATEGORIES, VISA_TYPES } from "../../config/visaConfig";

// Identity-only, by design — visa-specific fields, documents, the checklist,
// and case-specific data (including Premium Processing/I-907) all live on
// the Documents page now (see components/checklist/CaseIntakeExtras.jsx).
const INITIAL = {
  firstName: "",
  lastName: "",
  email: "",
  primaryPhone: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  country: "",
  visaCategory: "",
  visaType: "",
};

function initials(firstName, lastName, email) {
  const name = `${firstName || ""} ${lastName || ""}`.trim();
  if (name) return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (email || "?").slice(0, 1).toUpperCase();
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

export default function Profile() {
  const { user } = useAuth();
  const [data, setData] = useState(INITIAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);

  // Change Password — separate form/state from the profile fields above;
  // deliberately not part of `data`/handleSave so a failed password change
  // never blocks or gets bundled with a profile-fields save.
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => { document.title = "Profile | BAIS Immigration Portal"; }, []);

  useEffect(() => {
    let mounted = true;
    // casesApi.my() used to be fetched alongside this and discarded unread —
    // every field this page needs (activeCase below) already comes from
    // getIntake()'s embedded intake.case, so it was a full 16-populate case
    // fetch for nothing on every Profile page load.
    profileApi.getIntake().then((intakeResult) => {
      if (!mounted) return;
      const intake = intakeResult?.intake;
      const client = intake?.client || {};
      const activeCase = intake?.case || {};
      setData({
        firstName: client.firstName || "",
        lastName: client.lastName || "",
        email: client.email || user?.email || "",
        primaryPhone: client.primaryPhone || "",
        address: client.address || "",
        city: client.city || "",
        state: client.state || "",
        zipCode: client.zipCode || "",
        country: client.country || "",
        // The case is the authoritative source once one exists — it's set at
        // case-creation time from whatever the client picked in the intake
        // questionnaire (see buildCasePayloadFromIntake in Intake.jsx), and
        // stays populated even for clients whose own Client-record fields
        // were never separately filled in.
        visaCategory: activeCase.visaCategory || client.visaCategory || "",
        visaType: activeCase.visaType || client.visaType || "",
      });
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { mounted = false; };
  }, [user?.email]);

  // Explicit save only — no autosave. Only this page's own fields are sent;
  // the backend merges partial intake saves (Object.assign onto the client
  // doc), so this can never clobber the case-details/I-907 fields saved
  // from the Documents page.
  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await profileApi.saveIntake(data, {});
      setMessage("Saved");
      setDirty(false);
    } catch (error) {
      setMessage(error.message || "Unable to save");
    } finally {
      setSaving(false);
    }
  };

  const update = (field, value) => {
    setData((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setMessage("");
  };

  const updatePasswordField = (field, value) => {
    setPasswordForm((current) => ({ ...current, [field]: value }));
    setPasswordError("");
    setPasswordMessage("");
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    setPasswordMessage("");
    const { currentPassword, newPassword, confirmNewPassword } = passwordForm;
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordError("Please fill in all three fields.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setPasswordMessage("Password changed successfully.");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
    } catch (error) {
      setPasswordError(error.message || "Unable to change password. Check your current password and try again.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const visaTypes = useMemo(() => {
    const list = VISA_TYPES[data.visaCategory] || [];
    return list.map((item) => (typeof item === "string" ? item : item.type || item.label || item.value)).filter(Boolean);
  }, [data.visaCategory]);

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-400">Loading profile…</div>;
  }

  const fullName = `${data.firstName} ${data.lastName}`.trim() || "Your profile";

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-14">
      <div className="mx-auto max-w-lg">
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-20 h-20 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">
            {initials(data.firstName, data.lastName, data.email)}
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{fullName}</h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="First name">
              <input id="profile-firstName" name="firstName" className={inputClass} value={data.firstName} onChange={(e) => update("firstName", e.target.value)} />
            </Field>
            <Field label="Last name">
              <input id="profile-lastName" name="lastName" className={inputClass} value={data.lastName} onChange={(e) => update("lastName", e.target.value)} />
            </Field>
          </div>

          <Field label="Email (username)">
            <input
              type="email"
              id="profile-email"
              name="email"
              readOnly
              disabled
              className={`${inputClass} bg-slate-50 text-slate-500 cursor-not-allowed`}
              value={user?.email || data.email}
            />
          </Field>

          <Field label="Phone">
            <input id="profile-primaryPhone" name="primaryPhone" className={inputClass} value={data.primaryPhone} onChange={(e) => update("primaryPhone", e.target.value)} />
          </Field>

          <Field label="Address">
            <input id="profile-address" name="address" className={`${inputClass} mb-2.5`} placeholder="Street address" value={data.address} onChange={(e) => update("address", e.target.value)} />
            <div className="grid grid-cols-2 gap-2.5">
              <input id="profile-city" name="city" className={inputClass} placeholder="City" value={data.city} onChange={(e) => update("city", e.target.value)} />
              <input id="profile-state" name="state" className={inputClass} placeholder="State" value={data.state} onChange={(e) => update("state", e.target.value)} />
              <input id="profile-zipCode" name="zipCode" className={inputClass} placeholder="ZIP code" value={data.zipCode} onChange={(e) => update("zipCode", e.target.value)} />
              <input id="profile-country" name="country" className={inputClass} placeholder="Country" value={data.country} onChange={(e) => update("country", e.target.value)} />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Visa category">
              <select id="profile-visaCategory" name="visaCategory" className={inputClass} value={data.visaCategory} onChange={(e) => update("visaCategory", e.target.value)}>
                <option value="">Select</option>
                {/* The intake questionnaire stores its own category vocabulary
                    (e.g. "employment", "naturalization") which doesn't line up
                    with this dropdown's canonical ids — show whatever value was
                    actually autofilled instead of silently hiding it as blank. */}
                {data.visaCategory && !VISA_CATEGORIES.some((item) => item.id === data.visaCategory) && (
                  <option value={data.visaCategory}>{data.visaCategory}</option>
                )}
                {VISA_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Visa to apply for">
              <select id="profile-visaType" name="visaType" className={inputClass} value={data.visaType} onChange={(e) => update("visaType", e.target.value)} disabled={!data.visaCategory}>
                <option value="">Select</option>
                {data.visaType && !visaTypes.includes(data.visaType) && (
                  <option value={data.visaType}>{data.visaType}</option>
                )}
                {visaTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs text-slate-400">{message}</p>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Change Password</h2>

          <Field label="Current password">
            <input
              type="password"
              id="password-current"
              name="currentPassword"
              autoComplete="current-password"
              className={inputClass}
              value={passwordForm.currentPassword}
              onChange={(e) => updatePasswordField("currentPassword", e.target.value)}
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              id="password-new"
              name="newPassword"
              autoComplete="new-password"
              className={inputClass}
              value={passwordForm.newPassword}
              onChange={(e) => updatePasswordField("newPassword", e.target.value)}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              id="password-confirm"
              name="confirmNewPassword"
              autoComplete="new-password"
              className={inputClass}
              value={passwordForm.confirmNewPassword}
              onChange={(e) => updatePasswordField("confirmNewPassword", e.target.value)}
            />
          </Field>

          {passwordError && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {passwordError}
            </p>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">{passwordMessage}</p>
            <button
              type="button"
              onClick={handleChangePassword}
              disabled={passwordSaving}
              className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {passwordSaving ? "Changing…" : "Change Password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
