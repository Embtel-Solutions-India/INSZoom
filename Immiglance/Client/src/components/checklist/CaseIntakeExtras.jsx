import { useEffect, useState } from "react";
import { profileApi } from "../../services/api";

// Case-specific data collection that used to live on Profile.jsx (moved here per the client-portal
// overhaul - Profile is identity-only now; anything visa/case-specific belongs on the Documents page
// alongside the rest of the checklist): the dynamic per-visa case fields. The Form I-907 Premium
// Processing information is now a real checklist - see questionnaire/PremiumProcessingChecklist.jsx.
// Self-contained: loads and autosaves its own slice of the client intake record, only ever sending its
// OWN fields, so it can never clobber the identity fields Profile.jsx saves separately.

const CASE_FIELD_SETS = {
  employment: [
    ["employerName", "Employer Name"],
    ["employerAddress", "Employer Address"],
    ["jobTitle", "Offered Job Title"],
    ["worksiteLocation", "Worksite Location"],
  ],
  student: [
    ["universityName", "University Name"],
    ["sevisId", "SEVIS ID"],
    ["programName", "Program"],
    ["programStartDate", "Program Start Date"],
  ],
  marriage: [
    ["spouseLegalName", "Spouse Legal Name"],
    ["marriageDate", "Marriage Date"],
    ["marriagePlace", "Marriage Place"],
    ["spouseImmigrationStatus", "Spouse Immigration Status"],
  ],
  default: [
    ["caseGoal", "Immigration Goal"],
    ["importantDates", "Important Dates"],
    ["specialCircumstances", "Special Circumstances"],
  ],
};

function classifyVisa(visaCategory, visaType) {
  const text = `${visaCategory || ""} ${visaType || ""}`.toLowerCase();
  if (/(h-?1|l-?1|o-?1|eb|employment|work)/.test(text)) return "employment";
  if (/(f-?1|student|study|university)/.test(text)) return "student";
  if (/(marriage|spouse|k-?1|cr-?1|ir-?1)/.test(text)) return "marriage";
  return "default";
}

function textValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.68rem] font-bold uppercase tracking-wide text-muted-foreground">
        {label}{required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function Input({ label, required, ...props }) {
  return (
    <Field label={label} required={required}>
      <input {...props} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[0.82rem] text-foreground outline-none hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/15" />
    </Field>
  );
}

// caseData: the already-resolved case object for this checklist, from the
// Documents page's own useMyCase()/employer case-list resolution — this used
// to independently re-fetch via casesApi.my() here, which (a) duplicated a
// 16-populate query the page had already made, uncached, and (b) for an
// employer viewing a specific sponsored case, casesApi.my() resolves to the
// wrong case entirely ("my own case", not the caseId being viewed).
export default function CaseIntakeExtras({ caseId, caseData: providedCaseData }) {
  const [caseData, setCaseData] = useState(null);
  const [dynamicCaseInformation, setDynamicCaseInformation] = useState({});
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    profileApi.getIntake().then((intakeResult) => {
      if (!mounted) return;
      const intake = intakeResult?.intake;
      const nextCase = providedCaseData || intake?.case || {};
      const client = intake?.client || {};
      setCaseData(nextCase);
      setDynamicCaseInformation(client.dynamicCaseInformation || client.intakeData?.dynamicCaseInformation || {});
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { mounted = false; };
  }, [caseId, providedCaseData]);

  useEffect(() => {
    if (!dirty) return undefined;
    const timer = setTimeout(() => {
      setSaving(true);
      profileApi.saveIntake({ dynamicCaseInformation }, { caseId, autoSave: true })
        .catch(() => null)
        .finally(() => { setSaving(false); setDirty(false); });
    }, 1000);
    return () => clearTimeout(timer);
  }, [dynamicCaseInformation, dirty, caseId]);

  const updateDynamic = (field, value) => {
    setDynamicCaseInformation((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };
  if (loading) return null;

  const caseFields = CASE_FIELD_SETS[classifyVisa(caseData?.visaCategory, caseData?.visaType)];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Case details</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Additional details specific to your case.</p>
          </div>
          {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {caseFields.map(([field, label]) => (
            <Input key={field} id={`case-field-${field}`} name={field} label={label} value={textValue(dynamicCaseInformation[field])} onChange={(e) => updateDynamic(field, e.target.value)} />
          ))}
        </div>
      </section>
    </div>
  );
}
