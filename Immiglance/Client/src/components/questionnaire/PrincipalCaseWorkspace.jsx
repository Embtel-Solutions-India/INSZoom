import { useEffect, useState } from "react";
import { casesApi } from "../../services/api";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import { CaseRoleChecklistView } from "./CaseRoleChecklist";
import DataEntryModeModal from "./DataEntryModeModal";
import EmployeeDashboard from "./EmployeeDashboard";
import EmployeePacketStepper from "./EmployeePacketStepper";

// Top-level orchestrator for a caseRole=principal Case: the employer/
// petitioner questionnaire (rendered through the SAME card-based
// ChecklistItemRow UI + OCR autofill the original single-Case
// employer_employee flow already used, via CaseRoleChecklistView — see that
// file's own comment for why per-Case targeting gives free per-employee data
// isolation), the one-time fill-self-vs-invite choice, and — regardless of
// that choice — one shared Employee Dashboard (cards, not tabs) that opens
// into a per-employee Documents → Information → Review packet. Rendered by
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
  // Unlike the old tab bar, nothing opens by default — the dashboard grid is
  // the landing page every time, exactly like Documents.jsx's own landing
  // page for a single-party case.
  const [activeChildId, setActiveChildId] = useState(null);

  // Called here (not inside CaseRoleChecklistView) so this component can also
  // read employerQa.answers to gate the data-entry-mode modal below, without
  // fetching the same case+role questionnaire twice.
  const employerQa = useQuestionnaireAnswers(principalId, employerTargetRole);
  // Always called (hooks can't be conditional) — disabled until a card is
  // actually opened, matching CaseRoleChecklist's own disabled-when-readOnly
  // pattern for this same hook.
  const employeeQa = useQuestionnaireAnswers(activeChildId, employeeTargetRole, { disabled: !activeChildId });

  const fetchChildren = async (silent = false) => {
    if (!silent) setLoadingChildren(true);
    try {
      const relatedRes = await casesApi.getRelated(principalId);
      // Invariant 5: a removed child's data is preserved server-side, but it
      // no longer shows as an active card/invite slot here.
      const activeChildren = (relatedRes?.childCases || []).filter((c) => c.status !== "removed");
      setChildren(activeChildren);
    } catch (err) {
      console.error("Failed to load matter data:", err);
    } finally {
      setLoadingChildren(false);
    }
  };

  useEffect(() => {
    fetchChildren();
    // Stay in sync with what staff do in the Admin portal (invites, workflow switches, submissions).
    const timer = setInterval(() => fetchChildren(true), 30000);
    return () => clearInterval(timer);
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

  const activeChild = children.find((c) => c._id === activeChildId) || null;

  return (
    <div className="space-y-6">
      {/* Bug fix (real-browser test): this used to render unconditionally,
          which meant opening an employee's packet still showed the
          employer's own full multi-section questionnaire above it — the
          packet stepper existed but was buried at the bottom of an already
          long page instead of being the focused, distraction-free view
          §7A.4 calls for. Hidden while a packet is open; EmployeePacketStepper
          has its own header (employee name + "All employees" back link). */}
      {!activeChildId && <CaseRoleChecklistView qa={employerQa} caseId={principalId} />}

      {showModeModal && (
        <DataEntryModeModal principalCaseId={principalId} isFamily={isFamily} onModeSelected={handleModeSelected} />
      )}

      {loadingChildren ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : activeChild ? (
        <EmployeePacketStepper
          qa={employeeQa}
          caseId={activeChild._id}
          employeeLabel={activeChild.clientName || activeChild.caseNumber}
          onExit={() => setActiveChildId(null)}
          onSubmitted={() => { setActiveChildId(null); fetchChildren(); }}
        />
      ) : (dataEntryMode === "invite" || dataEntryMode === "fill_self") ? (
        <EmployeeDashboard
          principalId={principalId}
          children={children}
          dataEntryMode={dataEntryMode}
          defaultVisaType={activeCase.visaType}
          targetRole={employeeTargetRole}
          onOpen={setActiveChildId}
          onChanged={fetchChildren}
        />
      ) : (
        <p className="text-sm text-slate-400">
          Complete the {isFamily ? "petitioner" : "employer"} information above to continue.
        </p>
      )}
    </div>
  );
}
