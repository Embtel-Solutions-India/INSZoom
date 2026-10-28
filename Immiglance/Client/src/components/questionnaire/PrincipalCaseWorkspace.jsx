import { useEffect, useState } from "react";
import { casesApi } from "../../services/api";
import useCaseDataChanged from "../../hooks/useCaseDataChanged";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import { CaseRoleChecklistView } from "./CaseRoleChecklist";
import DataEntryModeModal from "./DataEntryModeModal";
import EmployeeDashboard from "./EmployeeDashboard";
import EmployeePacketStepper from "./EmployeePacketStepper";
import GrantAccessModal from "./GrantAccessModal";
import ConfirmDialog from "./ConfirmDialog";

// how often a read-only view of an invited employee's file re-reads it (what they save or submit appears without a reload)
const READ_ONLY_REFRESH_MS = 20000;

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
  // true while the employer is LOOKING at an invited employee's information (the employee holds the file): nothing is editable
  const [activeReadOnly, setActiveReadOnly] = useState(false);
  // the grant-access popup: { child, saveFirst } - saveFirst = opened from the employee's own form, whose entries are saved before access is given
  const [grantTarget, setGrantTarget] = useState(null);
  const [takingBack, setTakingBack] = useState(false);
  const [confirmTakeBack, setConfirmTakeBack] = useState(false);
  const [notice, setNotice] = useState("");

  // Called here (not inside CaseRoleChecklistView) so this component can also
  // read employerQa.answers to gate the data-entry-mode modal below, without
  // fetching the same case+role questionnaire twice.
  const employerQa = useQuestionnaireAnswers(principalId, employerTargetRole);
  // Always called (hooks can't be conditional) — disabled until a card is
  // actually opened, matching CaseRoleChecklist's own disabled-when-readOnly
  // pattern for this same hook.
  const employeeQa = useQuestionnaireAnswers(activeChildId, employeeTargetRole, {
    disabled: !activeChildId || activeReadOnly,
    pollMs: activeReadOnly ? READ_ONLY_REFRESH_MS : 0,
  });

  const openChild = (childId, options = {}) => {
    setNotice("");
    setActiveReadOnly(Boolean(options.readOnly));
    setActiveChildId(childId);
  };
  const closeChild = () => { setActiveChildId(null); setActiveReadOnly(false); };


  const fetchChildren = async (silent = false) => {
    if (!silent) setLoadingChildren(true);
    try {
      // only the employee slots are read here: ask for just the principal/child links (it is polled every 30 s)
      const relatedRes = await casesApi.getRelated(principalId, { scope: "children" });
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

  // An employee added, removed or restored by staff in Admin shows up here at once (the 30 s poll above stays as the fallback).
  useCaseDataChanged(principalId, (payload) => {
    if (!payload?.scope || payload.scope.includes("employees")) fetchChildren(true);
  });

  const employerHasAnyAnswer = Object.values(employerQa.answers || {}).some(
    (value) => value !== "" && value !== null && value !== undefined
  );
  // Only shown for employer_employee/family, only while dataEntryMode is
  // still 'not_set', and only once the employer has actually entered
  // something (so it doesn't interrupt them the instant the page loads).
  const showModeModal = dataEntryMode === "not_set" && employerHasAnyAnswer;

  const handleModeSelected = (mode) => setDataEntryMode(mode);

  const activeChild = children.find((c) => c._id === activeChildId) || null;

  // Switch from the read-only view back to "employer fills": the invitation is withdrawn, everything the employee entered is kept
  // (answers belong to the case, not to the account holding it) and the same screen becomes editable.
  const handleTakeBack = async () => {
    if (!activeChild) return;
    setConfirmTakeBack(false);
    setTakingBack(true);
    try {
      const res = await casesApi.setEmployeeDataEntryMode(principalId, activeChild._id, { mode: "fill_self" });
      if (!res?.success) throw new Error(res?.message || "Could not change this employee's workflow");
      setActiveReadOnly(false);
      await fetchChildren(true);
      await employeeQa.refetch?.();
    } catch (err) {
      setNotice(err.message || "Could not change this employee's workflow");
    } finally {
      setTakingBack(false);
    }
  };

  // The grant-access popup's two steps: (1) the employer's pending entries are saved (when opened from the employee's own form),
  // (2) the file is handed to the employee. A failed save aborts the grant, so nothing is ever lost.
  const grantChild = grantTarget?.child || null;
  const handleGrant = async ({ name, email }) => {
    const res = await casesApi.setEmployeeDataEntryMode(principalId, grantChild._id, { mode: "invite", employeeName: name, employeeEmail: email });
    if (!res?.success) throw new Error(res?.message || "Access could not be granted.");
    setGrantTarget(null);
    closeChild();
    setNotice(res.message || "Access granted.");
    fetchChildren(true);
  };

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

      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
      )}

      {confirmTakeBack && activeChild && (
        <ConfirmDialog
          title={`Fill in ${activeChild.clientName || "this employee"}'s information yourself?`}
          message={"Their access will be withdrawn. Everything they have already entered is kept."}
          confirmLabel="Yes, I'll fill it in"
          onConfirm={handleTakeBack}
          onCancel={() => setConfirmTakeBack(false)}
        />
      )}

      {grantChild && (
        <GrantAccessModal
          employeeName={grantChild.clientName || ""}
          employeeEmail={grantChild.clientEmail || ""}
          returning={Boolean(grantChild.clientName && grantChild.clientEmail)}
          beforeGrant={grantTarget.saveFirst ? () => employeeQa.commitAll() : undefined}
          onGrant={handleGrant}
          onClose={() => setGrantTarget(null)}
        />
      )}

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
          readOnly={activeReadOnly}
          onTakeBack={activeReadOnly ? () => setConfirmTakeBack(true) : undefined}
          takingBack={takingBack}
          onGrantAccess={!activeReadOnly ? () => setGrantTarget({ child: activeChild, saveFirst: true }) : undefined}
          onExit={closeChild}
          onSubmitted={() => { closeChild(); fetchChildren(); }}
        />
      ) : (dataEntryMode === "invite" || dataEntryMode === "fill_self") ? (
        <EmployeeDashboard
          principalId={principalId}
          children={children}
          dataEntryMode={dataEntryMode}
          defaultVisaType={activeCase.visaType}
          targetRole={employeeTargetRole}
          onOpen={openChild}
          onChanged={fetchChildren}
          onGrantAccess={(child) => setGrantTarget({ child, saveFirst: false })}
        />
      ) : (
        <p className="text-sm text-slate-400">
          Complete the {isFamily ? "petitioner" : "employer"} information above to continue.
        </p>
      )}
    </div>
  );
}
