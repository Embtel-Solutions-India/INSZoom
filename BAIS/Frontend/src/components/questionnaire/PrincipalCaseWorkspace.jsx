import { useEffect, useState } from "react";
import { casesApi, employerProfileApi, employeeProfileApi } from "../../services/api";
import CanonicalProfileForm from "./CanonicalProfileForm";
import { EMPLOYER_FIELD_GROUPS, EMPLOYEE_FIELD_GROUPS } from "./canonicalFieldGroups";
import DataEntryModeModal from "./DataEntryModeModal";
import InvitePanel from "./InvitePanel";

// Top-level orchestrator for a caseRole=principal Case — the Phase 9
// employer/petitioner questionnaire, the one-time fill-self-vs-invite
// choice, and (depending on that choice) either the per-employee tabs or
// the invite panel. Rendered by Documents.jsx only when
// activeCase.caseRole === 'principal' (a genuinely new-architecture case
// with real child Cases) — see PHASE_9_COMPLETION_REPORT.md for why this is
// additive alongside the older employer_employee flow rather than a
// replacement of it.
export default function PrincipalCaseWorkspace({ activeCase }) {
  const principalId = activeCase._id;
  const isFamily = activeCase.caseStructure === "family";

  const [dataEntryMode, setDataEntryMode] = useState(activeCase.dataEntryMode);
  const [employerProfile, setEmployerProfile] = useState(null);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeChildId, setActiveChildId] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [profileRes, relatedRes] = await Promise.all([
        employerProfileApi.get(principalId),
        casesApi.getRelated(principalId),
      ]);
      setEmployerProfile(profileRes?.profile || null);
      // Invariant 5: a removed child's data is preserved server-side, but it
      // no longer shows as an active tab/invite slot here.
      const activeChildren = (relatedRes?.childCases || []).filter((c) => c.status !== "removed");
      setChildren(activeChildren);
      setActiveChildId((current) => current || activeChildren[0]?._id || null);
    } catch (err) {
      console.error("Failed to load matter data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principalId]);

  const employerProfileStarted = Boolean(
    employerProfile?.canonicalData?.legalName?.value || employerProfile?.canonicalData?.contact?.email?.value
  );
  // INVARIANT 6: only shown for employer_employee/family, only while
  // dataEntryMode is still 'not_set', and only once the employer has
  // actually entered something (so it doesn't interrupt them mid-questionnaire).
  const showModeModal = dataEntryMode === "not_set" && employerProfileStarted;

  const handleEmployerSave = async (fields) => {
    const res = await employerProfileApi.upsert(principalId, fields);
    setEmployerProfile(res.profile);
    return res;
  };

  const handleModeSelected = (mode) => setDataEntryMode(mode);

  const handleRemove = async (childId) => {
    if (!window.confirm("Remove this employee from the case? Their information will be preserved, but they'll no longer appear here.")) return;
    try {
      await casesApi.removeEmployee(childId);
      await fetchAll();
    } catch (err) {
      alert(err.message || "Failed to remove employee");
    }
  };

  const activeChild = children.find((c) => c._id === activeChildId) || null;

  return (
    <div className="space-y-6">
      <CanonicalProfileForm
        title={isFamily ? "Petitioner Information" : "Employer Information"}
        fieldGroups={EMPLOYER_FIELD_GROUPS}
        profile={employerProfile}
        onSave={handleEmployerSave}
      />

      {showModeModal && (
        <DataEntryModeModal principalCaseId={principalId} isFamily={isFamily} onModeSelected={handleModeSelected} />
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          {dataEntryMode === "invite" && (
            <InvitePanel principalCaseId={principalId} children={children} onChanged={fetchAll} />
          )}

          {dataEntryMode === "fill_self" && (
            <div className="space-y-4">
              {children.length > 1 && (
                <div className="flex gap-2 border-b border-slate-200 overflow-x-auto">
                  {children.map((child) => (
                    <button
                      key={child._id}
                      type="button"
                      onClick={() => setActiveChildId(child._id)}
                      className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition ${
                        activeChildId === child._id
                          ? "border-slate-900 text-slate-900"
                          : "border-transparent text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      {child.clientName || child.caseNumber}
                    </button>
                  ))}
                </div>
              )}
              {activeChild && (
                <EmployeeTab key={activeChild._id} child={activeChild} onRemove={() => handleRemove(activeChild._id)} />
              )}
              {!activeChild && <p className="text-sm text-slate-400">No employees on this case yet.</p>}
            </div>
          )}

          {dataEntryMode === "not_set" && !employerProfileStarted && (
            <p className="text-sm text-slate-400">
              Complete the {isFamily ? "petitioner" : "employer"} information above to continue.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EmployeeTab({ child, onRemove }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    employeeProfileApi.get(child._id)
      .then((res) => { if (!cancelled) setProfile(res?.profile || null); })
      .catch(() => { if (!cancelled) setProfile(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [child._id]);

  const handleSave = async (fields) => {
    const res = await employeeProfileApi.upsert(child._id, fields);
    setProfile(res.profile);
    return res;
  };

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={onRemove} className="text-xs font-semibold text-red-600 hover:text-red-700">
          Remove this employee
        </button>
      </div>
      <CanonicalProfileForm
        title={child.caseNumber}
        fieldGroups={EMPLOYEE_FIELD_GROUPS}
        profile={profile}
        onSave={handleSave}
      />
    </div>
  );
}
