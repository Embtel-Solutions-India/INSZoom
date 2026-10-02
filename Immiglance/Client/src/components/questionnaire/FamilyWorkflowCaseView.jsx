import { useEffect, useState } from "react";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import useCaseChecklists from "../../hooks/useCaseChecklists";
import { CaseRoleChecklistView } from "./CaseRoleChecklist";
import FamilyCompletionModeBanner from "../checklist/FamilyCompletionModeBanner";
import { familyWorkflowApi } from "../../services/api";

// One role's slice of the case — a role can have MORE than one checklist
// assigned (e.g. the petitioner role carries both the I-130 Petitioner
// Checklist AND the I-864 Sponsor Checklist; the beneficiary role can carry
// both the Green Card Checklist and the optional GC-NVC checklist). Each
// checklist gets its OWN isolated useQuestionnaireAnswers instance keyed by
// referenceId, switched via a small tab bar within this one role's card -
// this is the actual fix for the cross-contamination bug: the old shared
// single-hook/"effectiveRole" pattern let a save on one checklist land
// against whichever questionnaire the hook was last pointed at, including
// across roles. Two sibling RoleChecklistGroup instances (one for
// petitioner, one for beneficiary) never share a hook at all.
function RoleChecklistGroup({ caseId, targetRole, checklists, roleLabel, readOnly = false, submitted = false, onSubmit }) {
  const [activeReferenceId, setActiveReferenceId] = useState(checklists[0]?.referenceId);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  useEffect(() => {
    if (!checklists.some((c) => c.referenceId === activeReferenceId)) {
      setActiveReferenceId(checklists[0]?.referenceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklists.map((c) => c.referenceId).join(",")]);

  const qa = useQuestionnaireAnswers(caseId, targetRole, { referenceId: activeReferenceId });
  const active = checklists.find((c) => c.referenceId === activeReferenceId);
  // A submitted checklist is NOT locked: the client can keep editing and
  // re-submit, and every edit lands on the same Answer records Admin and the
  // Attorney Portal read, so all three stay in sync.

  // Submit needs every checklist in this role complete: the active one is
  // judged live (unsaved edits included), the others from server progress.
  const otherIncomplete = checklists.filter(
    (c) => c.referenceId !== activeReferenceId && (c.progress?.answeredRequired || 0) < (c.progress?.totalRequired || 0)
  );
  const remainingRequired = qa.missingRequiredCount + otherIncomplete.length;
  const canSubmit = !qa.initialLoading && !qa.error && remainingRequired === 0 && !qa.uploadsInFlight;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await qa.commitAll();
      await onSubmit();
    } catch (err) {
      setSubmitError(err.response?.data?.message || "Could not submit — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {checklists.length > 1 && (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
          {checklists.map((checklist) => (
            <button
              key={checklist.referenceId}
              type="button"
              onClick={() => setActiveReferenceId(checklist.referenceId)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                checklist.referenceId === activeReferenceId
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {checklist.title}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{roleLabel} — {active?.title}</p>
      <CaseRoleChecklistView qa={qa} caseId={caseId} readOnly={readOnly} />
      {!readOnly && onSubmit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {submitted ? "Submitted — you can still make changes and update your submission" : "Done filling this in?"}
            </p>
            {!canSubmit && remainingRequired > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                {qa.missingRequiredCount > 0
                  ? `${qa.missingRequiredCount} required item${qa.missingRequiredCount === 1 ? "" : "s"} remaining in this checklist`
                  : `Complete the other ${roleLabel.toLowerCase()} tab${otherIncomplete.length === 1 ? "" : "s"} first`}
              </p>
            )}
            {submitError && <p className="mt-1 text-xs font-semibold text-red-600">{submitError}</p>}
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting…" : submitted ? "Update submission" : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
}

// Top-level workspace for a family-workflow (I-130/Green Card) Case —
// createFamilyCase's ONE shared Case with a petitionerUser and a
// beneficiaryUser, never a separate child Case per participant (that's the
// DIFFERENT caseRole=principal/caseStructure=family architecture
// PrincipalCaseWorkspace.jsx serves - explicitly not used here per product
// direction: "no child cases like the employer or employee... write
// petitioner info and beneficiary info in the same case").
//
// Rendered by Documents.jsx instead of the legacy shared-hook/tab-bar path
// whenever the case is family-shaped, mirroring the employer/employee
// "Employee's part" card at the bottom of the employer's own checklist
// (PrincipalCaseWorkspace's inline employeeSections) - a "Beneficiary" card
// the petitioner can expand to fill the beneficiary's section themselves
// (familyCompletionMode "petitioner_completes") or monitor an invited
// beneficiary's progress (familyCompletionMode "invite_beneficiary").
export default function FamilyWorkflowCaseView({ activeCase, allowedRoles, onCaseChanged }) {
  const caseId = activeCase._id;
  const { checklists, loading: checklistsLoading, refetch: refetchChecklists } = useCaseChecklists(caseId);
  const [beneficiaryExpanded, setBeneficiaryExpanded] = useState(false);

  const isPetitioner = allowedRoles?.includes("petitioner");
  const isBeneficiary = allowedRoles?.includes("beneficiary");
  const petitionerChecklists = checklists.filter((c) => c.targetRole === "petitioner");
  const beneficiaryChecklists = checklists.filter((c) => c.targetRole === "beneficiary");

  const beneficiaryProgress = beneficiaryChecklists.length
    ? Math.round(beneficiaryChecklists.reduce((sum, c) => sum + (c.progress?.percent || 0), 0) / beneficiaryChecklists.length)
    : 0;
  // The petitioner fills (and submits) the beneficiary's section unless a real
  // invite is out - an unset mode (""), which cases created outside the invite
  // flow have, used to leave this card read-only with no Submit button at all.
  const beneficiaryInvited = activeCase.familyCompletionMode === "invite_beneficiary" && Boolean(activeCase.beneficiaryInvite?.email || activeCase.beneficiaryUser);
  const isPetitionerCompletes = !beneficiaryInvited;
  const petitionerSubmitted = activeCase.familyWorkflow?.petitionerStatus === "submitted";
  const beneficiarySubmitted = activeCase.familyWorkflow?.beneficiaryStatus === "submitted";

  // Marks the logged-in participant's OWN side submitted (family-workflow.
  // controller.js's submitParticipantInfo) - a case-level status, not a
  // per-checklist one, matching the role the caller is filling (petitioner
  // vs beneficiary), same as the legacy page's own submit action.
  const submit = async (role) => {
    await familyWorkflowApi.submit(caseId, role);
    await refetchChecklists();
    await onCaseChanged?.();
  };

  if (checklistsLoading) return <p className="text-sm text-slate-400">Loading…</p>;

  // A logged-in beneficiary (not also the petitioner) only ever sees their
  // own checklist(s) - no petitioner data, no Beneficiary card (that card is
  // the petitioner's own tool for monitoring/filling the beneficiary side).
  if (isBeneficiary && !isPetitioner) {
    return beneficiaryChecklists.length
      ? (
        <RoleChecklistGroup
          caseId={caseId}
          targetRole="beneficiary"
          checklists={beneficiaryChecklists}
          roleLabel="Beneficiary Checklist"
          submitted={beneficiarySubmitted}
          onSubmit={() => submit("beneficiary")}
        />
      )
      : <p className="text-sm text-slate-400">No checklist is available for this case yet.</p>;
  }

  return (
    <div className="space-y-6">
      <FamilyCompletionModeBanner activeCase={activeCase} onChanged={async () => { await refetchChecklists(); await onCaseChanged?.(); }} />

      {petitionerChecklists.length > 0 ? (
        <RoleChecklistGroup
          caseId={caseId}
          targetRole="petitioner"
          checklists={petitionerChecklists}
          roleLabel="Petitioner Checklist"
          submitted={petitionerSubmitted}
          onSubmit={() => submit("petitioner")}
        />
      ) : (
        <p className="text-sm text-slate-400">No petitioner checklist is available for this case yet.</p>
      )}

      {beneficiaryChecklists.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setBeneficiaryExpanded((value) => !value)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <div>
              <p className="text-sm font-bold text-slate-900">Beneficiary Checklist</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {isPetitionerCompletes ? "You're completing this yourself" : "Your family member's own section"} · {beneficiaryProgress}% complete
              </p>
            </div>
            <span className="text-slate-400 shrink-0 text-lg leading-none" aria-hidden="true">{beneficiaryExpanded ? "▾" : "▸"}</span>
          </button>
          {beneficiaryExpanded && (
            <div className="border-t border-slate-200 p-5">
              <RoleChecklistGroup
                caseId={caseId}
                targetRole="beneficiary"
                checklists={beneficiaryChecklists}
                roleLabel="Beneficiary Checklist"
                readOnly={!isPetitionerCompletes}
                submitted={beneficiarySubmitted}
                onSubmit={isPetitionerCompletes ? () => submit("beneficiary") : undefined}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
