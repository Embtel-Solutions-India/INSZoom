import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { casesApi, profileApi } from "../../services/api";
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

  useEffect(() => { document.title = "Profile | BAIS Immigration Portal"; }, []);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([profileApi.getIntake(), casesApi.my()]).then(([intakeResult]) => {
      if (!mounted) return;
      const intake = intakeResult.status === "fulfilled" ? intakeResult.value?.intake : null;
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
              <input className={inputClass} value={data.firstName} onChange={(e) => update("firstName", e.target.value)} />
            </Field>
            <Field label="Last name">
              <input className={inputClass} value={data.lastName} onChange={(e) => update("lastName", e.target.value)} />
            </Field>
          </div>

          <Field label="Email">
            <input type="email" className={inputClass} value={data.email} onChange={(e) => update("email", e.target.value)} />
          </Field>

          <Field label="Phone">
            <input className={inputClass} value={data.primaryPhone} onChange={(e) => update("primaryPhone", e.target.value)} />
          </Field>

          <Field label="Address">
            <input className={`${inputClass} mb-2.5`} placeholder="Street address" value={data.address} onChange={(e) => update("address", e.target.value)} />
            <div className="grid grid-cols-2 gap-2.5">
              <input className={inputClass} placeholder="City" value={data.city} onChange={(e) => update("city", e.target.value)} />
              <input className={inputClass} placeholder="State" value={data.state} onChange={(e) => update("state", e.target.value)} />
              <input className={inputClass} placeholder="ZIP code" value={data.zipCode} onChange={(e) => update("zipCode", e.target.value)} />
              <input className={inputClass} placeholder="Country" value={data.country} onChange={(e) => update("country", e.target.value)} />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Visa category">
              <select className={inputClass} value={data.visaCategory} onChange={(e) => update("visaCategory", e.target.value)}>
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
              <select className={inputClass} value={data.visaType} onChange={(e) => update("visaType", e.target.value)} disabled={!data.visaCategory}>
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
      </div>
    </div>
  );
}
