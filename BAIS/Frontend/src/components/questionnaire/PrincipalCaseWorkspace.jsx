import { useEffect, useState } from "react";
import { casesApi } from "../../services/api";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import CaseRoleChecklist, { CaseRoleChecklistView } from "./CaseRoleChecklist";
import DataEntryModeModal from "./DataEntryModeModal";
import InvitePanel from "./InvitePanel";

// Top-level orchestrator for a caseRole=principal Case — the employer/
// petitioner questionnaire (rendered through the SAME card-based
// ChecklistItemRow UI + OCR autofill the original single-Case
// employer_employee flow already used, via CaseRoleChecklist — see that
// file's own comment for why per-Case targeting gives free per-employee data
// isolation), the one-time fill-self-vs-invite choice, and (depending on
// that choice) either the per-employee tabs or the invite panel. Rendered by
// Documents.jsx only when activeCase.caseRole === 'principal' (a genuinely
// new-architecture case with real child Cases).
export default function PrincipalCaseWorkspace({ activeCase }) {
  const principalId = activeCase._id;
  const isFamily = activeCase.caseStructure === "family";
  const employerTargetRole = isFamily ? "petitioner" : "employer";
  const employeeTargetRole = isFamily ? "beneficiary" : "employee";

  const [dataEntryMode, setDataEntryMode] = useState(activeCase.dataEntryMode);
  const [children, setChildren] = useState([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [activeChildId, setActiveChildId] = useState(null);

  // Called here (not inside CaseRoleChecklist) so this component can also
  // read employerQa.answers to gate the data-entry-mode modal below, without
  // fetching the same case+role questionnaire twice.
  const employerQa = useQuestionnaireAnswers(principalId, employerTargetRole);

  const fetchChildren = async () => {
    setLoadingChildren(true);
    try {
      const relatedRes = await casesApi.getRelated(principalId);
      // Invariant 5: a removed child's data is preserved server-side, but it
      // no longer shows as an active tab/invite slot here.
      const activeChildren = (relatedRes?.childCases || []).filter((c) => c.status !== "removed");
      setChildren(activeChildren);
      setActiveChildId((current) => current || activeChildren[0]?._id || null);
    } catch (err) {
      console.error("Failed to load matter data:", err);
    } finally {
      setLoadingChildren(false);
    }
  };

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principalId]);

  const employerHasAnyAnswer = Object.values(employerQa.answers || {}).some(
    (value) => value !== "" && value !== null && value !== undefined
  );
  // Only shown for employer_employee/family, only while dataEntryMode is
  // still 'not_set', and only once the employer has actually entered
  // something (so it doesn't interrupt them the instant the page loads).
  const showModeModal = dataEntryMode === "not_set" && employerHasAnyAnswer;

  const handleModeSelected = (mode) => setDataEntryMode(mode);

  const handleRemove = async (childId) => {
    if (!window.confirm("Remove this employee from the case? Their information will be preserved, but they'll no longer appear here.")) return;
    try {
      await casesApi.removeEmployee(childId);
      await fetchChildren();
    } catch (err) {
      alert(err.message || "Failed to remove employee");
    }
  };

  const activeChild = children.find((c) => c._id === activeChildId) || null;

  return (
    <div className="space-y-6">
      <CaseRoleChecklistView qa={employerQa} caseId={principalId} />

      {showModeModal && (
        <DataEntryModeModal principalCaseId={principalId} isFamily={isFamily} onModeSelected={handleModeSelected} />
      )}

      {loadingChildren ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          {dataEntryMode === "invite" && (
            <InvitePanel principalCaseId={principalId} children={children} onChanged={fetchChildren} />
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
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleRemove(activeChild._id)}
                      className="text-xs font-semibold text-red-600 hover:text-red-700"
                    >
                      Remove this employee
                    </button>
                  </div>
                  <CaseRoleChecklist key={activeChild._id} caseId={activeChild._id} targetRole={employeeTargetRole} />
                </div>
              )}
              {!activeChild && <p className="text-sm text-slate-400">No employees on this case yet.</p>}
            </div>
          )}

          {dataEntryMode === "not_set" && !employerHasAnyAnswer && (
            <p className="text-sm text-slate-400">
              Complete the {isFamily ? "petitioner" : "employer"} information above to continue.
            </p>
          )}
        </>
      )}
    </div>
  );
}
