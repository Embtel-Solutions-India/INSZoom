import { useEffect, useState } from "react";
import { employerProfileApi, employeeProfileApi } from "../../services/api";
import CanonicalProfileForm from "./CanonicalProfileForm";
import { EMPLOYER_FIELD_GROUPS, EMPLOYEE_FIELD_GROUPS } from "./canonicalFieldGroups";

// Rendered by Documents.jsx for an invited employee/beneficiary's own
// session (activeCase.caseRole is 'employee' or 'beneficiary', not
// 'principal'). Shows their own editable questionnaire plus a read-only
// summary of the employer/petitioner — never anything belonging to a
// sibling employee, and never write access to the employer's own data
// (CanonicalProfileForm's readOnly=true here enforces that in the UI; the
// backend's employer-profile write RBAC enforces it independently either way).
export default function EmployeeSelfServiceView({ activeCase }) {
  const [employerProfile, setEmployerProfile] = useState(null);
  const [ownProfile, setOwnProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const principalId = activeCase.parentCase?._id || activeCase.parentCase;
  const isFamily = activeCase.caseStructure === "family";

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      principalId ? employerProfileApi.get(principalId).catch(() => null) : null,
      employeeProfileApi.get(activeCase._id).catch(() => null),
    ]).then(([employerRes, ownRes]) => {
      if (cancelled) return;
      setEmployerProfile(employerRes?.profile || null);
      setOwnProfile(ownRes?.profile || null);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeCase._id, principalId]);

  const handleSave = async (fields) => {
    const res = await employeeProfileApi.upsert(activeCase._id, fields);
    setOwnProfile(res.profile);
    return res;
  };

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <CanonicalProfileForm
        title={isFamily ? "Petitioner Information" : "Employer Information"}
        description="Provided by your employer — for your reference only."
        fieldGroups={EMPLOYER_FIELD_GROUPS}
        profile={employerProfile}
        readOnly
      />
      <CanonicalProfileForm
        title="Your Information"
        fieldGroups={EMPLOYEE_FIELD_GROUPS}
        profile={ownProfile}
        onSave={handleSave}
      />
    </div>
  );
}
