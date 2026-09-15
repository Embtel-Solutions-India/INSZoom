import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { authApi, casesApi, employeeProfileApi, profileApi } from "../../services/api";
import { VISA_CATEGORIES, VISA_TYPES } from "../../config/visaConfig";
import { isEmployeeAccount } from "../../utils/auth";

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
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/15 transition-all duration-150";

function canonicalValue(profile, path) {
  return path.split(".").reduce((current, key) => current?.[key], profile?.canonicalData)?.value || "";
}

export default function Profile() {
  const { user } = useAuth();
  const [data, setData] = useState(INITIAL);
  const [activeCaseId, setActiveCaseId] = useState("");
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

  useEffect(() => { document.title = "Profile | Immiglance"; }, []);

  useEffect(() => {
    let mounted = true;
    if (isEmployeeAccount(user)) {
      casesApi.my().then(async (caseResult) => {
        if (!mounted) return;
        const activeCase = caseResult?.case || caseResult?.data?.case || caseResult || {};
        setActiveCaseId(activeCase._id || "");
        const profileResult = activeCase._id ? await employeeProfileApi.get(activeCase._id).catch(() => null) : null;
        const profile = profileResult?.profile || {};
        setData({
          firstName: canonicalValue(profile, "firstName"),
          lastName: canonicalValue(profile, "lastName"),
          email: canonicalValue(profile, "email") || user?.email || "",
          primaryPhone: canonicalValue(profile, "phone"),
          address: canonicalValue(profile, "currentAddress.street"),
          city: canonicalValue(profile, "currentAddress.city"),
          state: canonicalValue(profile, "currentAddress.state"),
          zipCode: canonicalValue(profile, "currentAddress.zipCode"),
          country: canonicalValue(profile, "currentAddress.country"),
          visaCategory: activeCase.visaCategory || "",
          visaType: activeCase.visaType || "",
        });
        setLoading(false);
      }).catch(() => setLoading(false));
      return () => { mounted = false; };
    }
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
  }, [user]);

  // Explicit save only — no autosave. Only this page's own fields are sent;
  // the backend merges partial intake saves (Object.assign onto the client
  // doc), so this can never clobber the case-details/I-907 fields saved
  // from the Documents page.
  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      if (isEmployeeAccount(user)) {
        if (!activeCaseId) throw new Error("Unable to resolve your case profile.");
        await employeeProfileApi.upsert(activeCaseId, {
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.primaryPhone,
          "currentAddress.street": data.address,
          "currentAddress.city": data.city,
          "currentAddress.state": data.state,
          "currentAddress.zipCode": data.zipCode,
          "currentAddress.country": data.country,
        });
      } else {
        await profileApi.saveIntake(data, {});
      }
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
    return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">Loading profile…</div>;
  }

  const fullName = `${data.firstName} ${data.lastName}`.trim() || "Your profile";
  const visaCategoryLabel = VISA_CATEGORIES.find((item) => item.id === data.visaCategory)?.label || data.visaCategory || "Not selected";

  return (
    <div className="min-h-screen bg-background">
      {/* ── Overview header (matches Dashboard's Case Overview header) ── */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-2">
        <h1 className="font-serif text-2xl font-bold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Your details and selected visa for this case.</p>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-7 space-y-6">
        {/* ── Client + visa summary (read-at-a-glance, matches Immiglance reference) ── */}
        <div className="bg-card rounded-lg border border-card-border p-6">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              {initials(data.firstName, data.lastName, data.email)}
            </div>
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-bold text-foreground truncate">{fullName}</h2>
              <p className="text-sm text-muted-foreground truncate">{user?.email || data.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-5 border-t border-border">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Visa Category</p>
              <p className="text-sm font-semibold text-foreground">{visaCategoryLabel}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Visa Type</p>
              <p className="text-sm font-semibold text-foreground">{data.visaType || "Not selected"}</p>
            </div>
          </div>
        </div>

        {/* ── Personal information (editable) ── */}
        <div className="bg-card rounded-lg border border-card-border p-6 space-y-4">
          <h2 className="font-serif text-lg font-bold text-foreground mb-1">Personal Information</h2>

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
              className={`${inputClass} bg-secondary text-muted-foreground cursor-not-allowed`}
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

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">{message}</p>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {/* ── Security ── */}
        <div className="bg-card rounded-lg border border-card-border p-6 space-y-4">
          <h2 className="font-serif text-lg font-bold text-foreground mb-1">Change Password</h2>

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
            <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-2.5">
              {passwordError}
            </p>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{passwordMessage}</p>
            <button
              type="button"
              onClick={handleChangePassword}
              disabled={passwordSaving}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {passwordSaving ? "Changing…" : "Change Password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
