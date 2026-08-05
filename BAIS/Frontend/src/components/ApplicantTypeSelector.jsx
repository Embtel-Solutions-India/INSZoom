import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { authApi } from "../services/api";

const OPTIONS = [
  { value: "individual", label: "Individual applicant", description: "I'm filing my own visa or immigration case." },
  { value: "employer", label: "Employer sponsoring employees", description: "I'm a company (or individual) sponsoring one or more employees for a visa." },
];

// Pre-case, account-level choice that gates the Employer workspace/nav —
// server-enforced in Backend's employment-workflow.controller.js
// (isEmployerCapable), never just a frontend nav check. Reused wherever the
// choice needs to be made or changed: PlanSelection (pre-filled from the
// chosen visa, still requires an explicit Confirm click) and Profile
// (changeable at any time, no pre-fill).
export default function ApplicantTypeSelector({ suggested, className = "" }) {
  const { user, updateUser } = useAuth();
  const current = user?.applicantType || "individual";
  const [value, setValue] = useState(current === "individual" && suggested ? suggested : current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = value !== current;

  const confirm = async () => {
    setSaving(true);
    try {
      const response = await authApi.updateApplicantType(value);
      updateUser(response.user || { applicantType: value });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <p className="text-sm font-extrabold text-slate-900">Who is this application for?</p>
      <p className="mt-1 text-xs text-slate-500">This decides whether you see employer tools (for sponsoring employees) or the standard self-applicant flow. You can change it later.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setValue(option.value)}
            className={`rounded-xl border p-4 text-left transition ${value === option.value ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"}`}
          >
            <p className="text-sm font-black text-slate-900">{option.label}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{option.description}</p>
          </button>
        ))}
      </div>
      {dirty ? (
        <button type="button" onClick={confirm} disabled={saving} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">
          {saving ? "Saving..." : "Confirm"}
        </button>
      ) : saved ? (
        <p className="mt-3 text-xs font-bold text-emerald-600">Saved.</p>
      ) : null}
    </div>
  );
}
