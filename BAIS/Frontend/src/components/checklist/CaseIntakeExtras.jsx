import { useEffect, useState } from "react";
import { casesApi, profileApi } from "../../services/api";

// Case-specific data collection that used to live on Profile.jsx (moved here
// per the client-portal overhaul — Profile is identity-only now; anything
// visa/case-specific belongs on the Documents page alongside the rest of the
// checklist). Covers: dynamic per-visa case fields, and — when the case has
// the paid Premium Processing addon — the I-907 filer/request data USCIS
// requires for that filing. Self-contained: loads and autosaves its own
// slice of the client intake record independently of the rest of this page,
// and only ever sends its OWN fields — the backend merges partial intake
// saves onto the client doc (Object.assign), so this can never clobber the
// identity fields Profile.jsx saves separately.

const emptyI907 = {
  alienRegistrationNumber: "",
  uscisOnlineAccountNumber: "",
  filerFamilyName: "",
  filerGivenName: "",
  companyOrganizationName: "",
  mailingStreet: "",
  mailingApt: "",
  mailingCity: "",
  mailingState: "",
  mailingZipCode: "",
  mailingProvince: "",
  mailingPostalCode: "",
  mailingCountry: "",
  samePhysicalAddress: "Yes",
  physicalStreet: "",
  physicalApt: "",
  physicalCity: "",
  physicalState: "",
  physicalZipCode: "",
  physicalProvince: "",
  physicalPostalCode: "",
  physicalCountry: "",
  relatedFormNumber: "",
  relatedReceiptNumber: "",
  relatedReceiptNumber2: "",
  petitionerFamilyName: "",
  petitionerGivenName: "",
  beneficiaryFamilyName: "",
  beneficiaryGivenName: "",
  pointOfContactFamilyName: "",
  pointOfContactGivenName: "",
  pointOfContactTitle: "",
  ein: "",
};

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

function hasPremiumProcessingAddon(activeCase) {
  return (activeCase?.addons || []).some((addon) => addon.key === "premium_processing_i907" && addon.status !== "cancelled");
}

function hasI907ProfileQuestionnaire(activeCase) {
  return (activeCase?.questionnaireReferences || activeCase?.questionnaires || []).some((reference) => {
    const text = `${reference?.title || ""} ${reference?.questionnaireKey || ""} ${reference?.key || ""}`.toLowerCase();
    return text.includes("i-907") || text.includes("i907") || text.includes("premium processing");
  });
}

function receiptNumberForCase(activeCase) {
  return activeCase?.uscisReceiptNumber
    || activeCase?.uscisNumber
    || activeCase?.receiptTracking?.receiptNumber
    || activeCase?.immigrationLifecycle?.tracking?.filing?.receiptNumber
    || "";
}

function buildI907Data(client = {}, activeCase = {}) {
  const saved = client.i907 || client.intakeData?.i907 || {};
  return {
    ...emptyI907,
    ...saved,
    filerFamilyName: saved.filerFamilyName || client.lastName || "",
    filerGivenName: saved.filerGivenName || client.firstName || "",
    mailingStreet: saved.mailingStreet || client.address || "",
    mailingApt: saved.mailingApt || client.apartment || "",
    mailingCity: saved.mailingCity || client.city || "",
    mailingState: saved.mailingState || client.state || "",
    mailingZipCode: saved.mailingZipCode || client.zipCode || "",
    mailingCountry: saved.mailingCountry || client.country || "",
    relatedFormNumber: saved.relatedFormNumber || activeCase.petitionType || activeCase.visaType || "",
    relatedReceiptNumber: saved.relatedReceiptNumber || receiptNumberForCase(activeCase),
    beneficiaryFamilyName: saved.beneficiaryFamilyName || client.lastName || "",
    beneficiaryGivenName: saved.beneficiaryGivenName || client.firstName || "",
  };
}

function textValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.68rem] font-bold uppercase tracking-wide text-slate-500">
        {label}{required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function Input({ label, required, ...props }) {
  return (
    <Field label={label} required={required}>
      <input {...props} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[0.82rem] text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100" />
    </Field>
  );
}

function Select({ label, required, options, ...props }) {
  return (
    <Field label={label} required={required}>
      <select {...props} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[0.82rem] text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100">
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option.value || option} value={option.value || option}>{option.label || option}</option>
        ))}
      </select>
    </Field>
  );
}

export default function CaseIntakeExtras({ caseId }) {
  const [caseData, setCaseData] = useState(null);
  const [dynamicCaseInformation, setDynamicCaseInformation] = useState({});
  const [i907, setI907] = useState(emptyI907);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([profileApi.getIntake(), casesApi.my()]).then(([intakeResult, caseResult]) => {
      if (!mounted) return;
      const intake = intakeResult.status === "fulfilled" ? intakeResult.value?.intake : null;
      const activeCase = caseResult.status === "fulfilled" ? (caseResult.value?.case || caseResult.value) : intake?.case;
      const nextCase = activeCase || intake?.case || {};
      const client = intake?.client || {};
      setCaseData(nextCase);
      setDynamicCaseInformation(client.dynamicCaseInformation || client.intakeData?.dynamicCaseInformation || {});
      setI907(buildI907Data(client, nextCase));
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { mounted = false; };
  }, [caseId]);

  useEffect(() => {
    if (!dirty) return undefined;
    const timer = setTimeout(() => {
      setSaving(true);
      profileApi.saveIntake({ dynamicCaseInformation, i907 }, { caseId, autoSave: true })
        .catch(() => null)
        .finally(() => { setSaving(false); setDirty(false); });
    }, 1000);
    return () => clearTimeout(timer);
  }, [dynamicCaseInformation, i907, dirty, caseId]);

  const updateDynamic = (field, value) => {
    setDynamicCaseInformation((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };
  const updateI907 = (field, value) => {
    setI907((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };

  if (loading) return null;

  const showPremiumProcessing = hasPremiumProcessingAddon(caseData) || hasI907ProfileQuestionnaire(caseData);
  const caseFields = CASE_FIELD_SETS[classifyVisa(caseData?.visaCategory, caseData?.visaType)];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Case details</h2>
            <p className="text-xs text-slate-500 mt-0.5">Additional details specific to your case.</p>
          </div>
          {saving && <span className="text-xs text-slate-400">Saving…</span>}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {caseFields.map(([field, label]) => (
            <Input key={field} label={label} value={textValue(dynamicCaseInformation[field])} onChange={(e) => updateDynamic(field, e.target.value)} />
          ))}
        </div>
      </section>

      {showPremiumProcessing && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900 mb-1">Form I-907 — Premium Processing</h2>
          <p className="text-xs text-slate-500 mb-4">Required information for your Premium Processing request.</p>

          <div className="space-y-6">
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Filer identity</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Input label="Alien Registration Number (A-Number)" value={textValue(i907.alienRegistrationNumber)} onChange={(e) => updateI907("alienRegistrationNumber", e.target.value)} />
                <Input label="USCIS Online Account Number" value={textValue(i907.uscisOnlineAccountNumber)} onChange={(e) => updateI907("uscisOnlineAccountNumber", e.target.value)} />
                <Input label="Company or Organization Named in Related Case" value={textValue(i907.companyOrganizationName)} onChange={(e) => updateI907("companyOrganizationName", e.target.value)} />
                <Input label="Family Name (Last Name)" required value={textValue(i907.filerFamilyName)} onChange={(e) => updateI907("filerFamilyName", e.target.value)} />
                <Input label="Given Name (First Name)" required value={textValue(i907.filerGivenName)} onChange={(e) => updateI907("filerGivenName", e.target.value)} />
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Mailing address</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Input label="Street Number and Name" required value={textValue(i907.mailingStreet)} onChange={(e) => updateI907("mailingStreet", e.target.value)} />
                <Input label="Apt/Ste/Flr" value={textValue(i907.mailingApt)} onChange={(e) => updateI907("mailingApt", e.target.value)} />
                <Input label="City or Town" required value={textValue(i907.mailingCity)} onChange={(e) => updateI907("mailingCity", e.target.value)} />
                <Input label="State" required value={textValue(i907.mailingState)} onChange={(e) => updateI907("mailingState", e.target.value)} />
                <Input label="ZIP Code" required value={textValue(i907.mailingZipCode)} onChange={(e) => updateI907("mailingZipCode", e.target.value)} />
                <Input label="Country" required value={textValue(i907.mailingCountry)} onChange={(e) => updateI907("mailingCountry", e.target.value)} />
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Physical address</p>
              <div className="mb-4 max-w-sm">
                <Select label="Same as Mailing Address?" required value={textValue(i907.samePhysicalAddress || "Yes")} onChange={(e) => updateI907("samePhysicalAddress", e.target.value)} options={["Yes", "No"]} />
              </div>
              {i907.samePhysicalAddress === "No" && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Input label="Street Number and Name" value={textValue(i907.physicalStreet)} onChange={(e) => updateI907("physicalStreet", e.target.value)} />
                  <Input label="City or Town" value={textValue(i907.physicalCity)} onChange={(e) => updateI907("physicalCity", e.target.value)} />
                  <Input label="State" value={textValue(i907.physicalState)} onChange={(e) => updateI907("physicalState", e.target.value)} />
                  <Input label="ZIP Code" value={textValue(i907.physicalZipCode)} onChange={(e) => updateI907("physicalZipCode", e.target.value)} />
                  <Input label="Country" value={textValue(i907.physicalCountry)} onChange={(e) => updateI907("physicalCountry", e.target.value)} />
                </div>
              )}
            </div>

            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Related petition or application</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Input label="Form Number of Related Petition or Application" required value={textValue(i907.relatedFormNumber)} onChange={(e) => updateI907("relatedFormNumber", e.target.value)} />
                <Input label="Receipt Number of Related Petition or Application" required value={textValue(i907.relatedReceiptNumber)} onChange={(e) => updateI907("relatedReceiptNumber", e.target.value)} />
                <Input label="Additional Receipt Number" value={textValue(i907.relatedReceiptNumber2)} onChange={(e) => updateI907("relatedReceiptNumber2", e.target.value)} />
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Related case people</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input label="Petitioner or Applicant Family Name" value={textValue(i907.petitionerFamilyName)} onChange={(e) => updateI907("petitionerFamilyName", e.target.value)} />
                <Input label="Petitioner or Applicant Given Name" value={textValue(i907.petitionerGivenName)} onChange={(e) => updateI907("petitionerGivenName", e.target.value)} />
                <Input label="Beneficiary Family Name" required value={textValue(i907.beneficiaryFamilyName)} onChange={(e) => updateI907("beneficiaryFamilyName", e.target.value)} />
                <Input label="Beneficiary Given Name" required value={textValue(i907.beneficiaryGivenName)} onChange={(e) => updateI907("beneficiaryGivenName", e.target.value)} />
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Company point of contact</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Input label="Point of Contact Family Name" value={textValue(i907.pointOfContactFamilyName)} onChange={(e) => updateI907("pointOfContactFamilyName", e.target.value)} />
                <Input label="Point of Contact Given Name" value={textValue(i907.pointOfContactGivenName)} onChange={(e) => updateI907("pointOfContactGivenName", e.target.value)} />
                <Input label="Position Title" value={textValue(i907.pointOfContactTitle)} onChange={(e) => updateI907("pointOfContactTitle", e.target.value)} />
                <Input label="Company or Organization EIN" value={textValue(i907.ein)} onChange={(e) => updateI907("ein", e.target.value)} />
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
