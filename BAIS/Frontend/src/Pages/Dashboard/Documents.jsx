import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { isEmployeeAccount } from "../../utils/auth";
import { profileApi, casesApi, employmentWorkflowApi, familyWorkflowApi } from "../../services/api";
import { useMyCase, useMyProfile } from "../../hooks/useMyCaseProfile";
import useDocumentChecklist from "../../hooks/useDocumentChecklist";
import useCaseDocumentChecklist from "../../hooks/useCaseDocumentChecklist";
import useCaseChecklists from "../../hooks/useCaseChecklists";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import { buildCaseCategories } from "../../components/DocumentChecklist";
import ChecklistItemRow from "../../components/checklist/ChecklistItemRow";
import DocumentUploadControl from "../../components/checklist/DocumentUploadControl";
import StatusLegend from "../../components/checklist/StatusLegend";
import EmployeeHandoffModal from "../../components/checklist/EmployeeHandoffModal";
import CaseIntakeExtras from "../../components/checklist/CaseIntakeExtras";
import QuestionInput, { AutofillButton } from "../../components/questionnaire/QuestionInput";
import PrefillBadge from "../../components/PrefillBadge";
import {
  resolveApplicableChecklistRoles,
  EMPLOYER_SHAPE_ROLES,
  isFileQuestion,
  isQuestionRequired,
  questionKey,
  sectionKey,
  titleFromKey,
  matchingAutofillSources,
} from "../../utils/questionnaireEngine";
import { STATUS, fieldItemStatus, documentItemStatus, isEmptyAnswerValue } from "../../utils/checklistStatus";
import { dedupeSectionsByLabel } from "../../utils/dedupeChecklistSections";

const ROLE_GROUP_LABEL = { employer: "Employer", business_plan: "Business plan", employee: "Employee" };

// Builds this role's slice of the page — its reusable-document baseline plus
// its questionnaire sections — tagged with roleGroup (for the rail heading)
// and, on every field/document item, the qa instance that owns it (qaSource)
// so the shared render loop below can call the right saveAnswer/saveFiles
// without needing a single global `qa`.
function buildRoleSections(qa, reusableCategories, roleGroup) {
  const prefix = roleGroup || "x";
  const docSections = reusableCategories.map((cat) => ({
    id: `doc-${prefix}-${cat.id}`,
    label: cat.label,
    roleGroup,
    qaSource: qa,
    items: cat.docs.map((doc) => ({
      id: `doc-${prefix}-${doc.id}`,
      type: "document",
      label: doc.label,
      help: doc.description,
      required: doc.required,
      docId: doc.id,
      category: cat.id,
    })),
  }));
  const questionnaireSections = (qa.sections || [])
    .map((section) => {
      const key = sectionKey(section);
      const questions = qa.questionsBySection.get(key) || [];
      return {
        id: `q-${prefix}-${key}`,
        label: section.title,
        roleGroup,
        qaSource: qa,
        autofillSources: matchingAutofillSources(questions),
        items: questions.map((question) => ({
          id: `q-${prefix}-${questionKey(question)}`,
          type: isFileQuestion(question) ? "document" : "field",
          label: question.label,
          help: question.description || question.helpText,
          required: isQuestionRequired(question, qa.answers),
          question,
          qaSource: qa,
        })),
      };
    })
    .filter((section) => section.items.length > 0);
  // Dedupe is scoped to this ONE role's own combined list — a same-labeled
  // item belonging to a DIFFERENT role (e.g. the employer's own "Passport"
  // vs. the employee's own "Passport") is a different person's document and
  // must never be collapsed together.
  return dedupeSectionsByLabel([...docSections, ...questionnaireSections]);
}

// Merges save-state/lastSavedAt/statusMessage across however many qa
// instances are currently active, so the header shows one combined line
// instead of one per role.
function combineQaStatus(activeQAs) {
  if (!activeQAs.length) return { saveState: "idle", lastSavedAt: "", statusMessage: "" };
  const saveState = activeQAs.some((qa) => qa.saveState === "saving") ? "saving"
    : activeQAs.some((qa) => qa.saveState === "error") ? "error"
    : activeQAs.some((qa) => qa.saveState === "pending") ? "pending"
    : activeQAs.some((qa) => qa.lastSavedAt) ? "saved" : "idle";
  const lastSavedAt = activeQAs.map((qa) => qa.lastSavedAt).filter(Boolean).sort().slice(-1)[0] || "";
  const statusMessage = activeQAs.map((qa) => qa.statusMessage).find(Boolean) || "";
  return { saveState, lastSavedAt, statusMessage };
}

// The case Checklist — a single scrollable page combining the reusable
// document baseline (Passport, Resume, Business License, ...) and the case's
// assigned visa questionnaire (fields + conditional documents), grouped into
// thematic sections. Every item — field or document — renders through the
// same ChecklistItemRow so the two never look like two different products.
//
// For an employer-sponsored case (multi-role: employer/business_plan/
// employee), this page renders all applicable roles' sections at once —
// see `useNewArchitecture` below. A non-employer-shaped case (individual/
// family/EB/EB-5/standalone) always renders through the single-role path
// (`legacySections`) instead, since there's only ever one role to show.
export default function Documents() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { caseId: routeCaseId } = useParams();

  const isEmployerAccount = !isEmployeeAccount(user) && (user?.applicantType === "employer" || user?.role === "employer");
  const useEmployerCaseResolution = isEmployerAccount;

  const { data: myCaseData, refetch: refetchMyCase } = useMyCase({ enabled: !useEmployerCaseResolution });
  const { data: profile } = useMyProfile();

  // An employer manages many cases (one per sponsored employee), so a
  // specific case is resolved from THEIR OWN authorized set
  // (employmentWorkflowApi.me().cases) rather than a raw case-by-id fetch —
  // that keeps authorization automatic (a caseId not in this employer's own
  // list simply isn't found, never a lookup into someone else's case).
  const employerMeQuery = useQuery({
    queryKey: ["employment-workflow", "me"],
    queryFn: employmentWorkflowApi.me,
    enabled: useEmployerCaseResolution,
  });
  const employerCases = employerMeQuery.data?.cases || [];
  const resolvedEmployerCase = routeCaseId ? employerCases.find((item) => item._id === routeCaseId) : null;

  const activeCase = useEmployerCaseResolution ? (resolvedEmployerCase || null) : (myCaseData || null);
  const activeCaseId = activeCase?._id || activeCase?.id || null;
  const visaType = activeCase?.visaType || profile?.visaType || profile?.assessmentRecommendedVisa || null;
  const loginRole = String(user?.role || "client").toLowerCase();

  // Server-truth, reload-safe per-role submit status (Bug C/D) — set by
  // POST /:id/submit (employment-workflow.controller.js's
  // submitParticipantInfo), which flips exactly these two fields on the Case
  // itself. Deriving "has this role already submitted" from here (rather
  // than a local boolean) means a page reload mid-flow — e.g. the employer
  // submitted their own side, closed the tab, came back later to finish the
  // employee side — still shows the correct locked/unlocked state per role,
  // instead of resetting to "nothing submitted" like a component-local flag
  // would.
  const employerRoleSubmitted = activeCase?.employerEmployeeWorkflow?.employerStatus === "submitted";
  const employeeRoleSubmitted = activeCase?.employerEmployeeWorkflow?.employeeStatus === "submitted";
  const refetchActiveCase = useEmployerCaseResolution ? employerMeQuery.refetch : refetchMyCase;

  const allowedRoles = resolveApplicableChecklistRoles(activeCase, user);
  const { checklists: assignedChecklists, refetch: refetchChecklists } = useCaseChecklists(activeCaseId);
  const visibleChecklists = allowedRoles ? assignedChecklists.filter((item) => allowedRoles.includes(item.targetRole)) : assignedChecklists;

  // The new simultaneous multi-role page (handoff junction, rail grouping)
  // only ever applies to the employer/employee-invite case shape. A K-1/K-3
  // family case's allowedRoles is ALSO an array (["petitioner"] /
  // ["beneficiary"] / both) — Array.isArray alone isn't enough to
  // distinguish it from the employer shape, so check the actual role
  // values. Family cases fall through to the same legacy single/multi-role
  // path individual cases already use (including its existing generic tab
  // bar for >1 assigned checklist) — that page was never duplicated for
  // family visas, so there is nothing to unify there, and none of the
  // employer-only UI (junction, invite banner, banding) is reachable since
  // it's all gated behind useNewArchitecture.
  const isEmployerShapeCase = Array.isArray(allowedRoles) && allowedRoles.some((role) => EMPLOYER_SHAPE_ROLES.includes(role));
  const isFamilyShapeCase = Boolean(activeCase?.petitionerUser || activeCase?.beneficiaryUser);
  const useNewArchitecture = isEmployerShapeCase;

  const showEmployer = Boolean(allowedRoles?.includes("employer"));
  const showBusinessPlan = Boolean(allowedRoles?.includes("business_plan"));
  // The employee questionnaire *reference* is created lazily on its first
  // getForCase fetch (see useCaseQuestionnaire), not at case creation — so a
  // brand-new case's `assignedChecklists` never contains a "employee" entry
  // until *after* the employer has already chosen employer_completes/invite,
  // which is the very decision this junction exists to let them make. So
  // "does an employee role already exist" can't gate whether to show it.
  // resolveApplicableChecklistRoles only ever grants "employer" for the
  // employer/employee-paired case family this app supports (H-1B/L-1A/O-1/P)
  // — so seeing "employer" at all is itself the right signal.
  const showEmployeeInline = Boolean(allowedRoles?.includes("employee"));
  // Viewer sees only their own employee section (invited-employee login),
  // as opposed to an employer viewing it inline on the employee's behalf.
  const isEmployeeLoginView = useNewArchitecture && showEmployeeInline && !showEmployer;

  // allowedRoles is computed synchronously from data already on hand
  // (activeCase + user — no network round trip), so seed activeRole with its
  // first guess instead of "" — that lets the questionnaire fetch below fire
  // immediately, in parallel with useCaseChecklists, rather than waiting for
  // the checklists list to resolve first just to learn which role to ask
  // for. Without this, the page fetched with the wrong role (falling back to
  // the bare account role, e.g. "client") on first render, got nothing back,
  // then re-fetched with the right role once useCaseChecklists finally
  // responded — the two-wave "a few items, then the rest 15-30s later" load.
  // (Only meaningful on the legacy single-role path — see useNewArchitecture.)
  const [activeRole, setActiveRole] = useState(() => allowedRoles?.[0] || "");
  useEffect(() => {
    if (visibleChecklists.length && !visibleChecklists.some((item) => item.targetRole === activeRole)) {
      setActiveRole(visibleChecklists[0].targetRole || "");
    }
  }, [visibleChecklists, activeRole]);
  const effectiveRole = activeRole || allowedRoles?.[0] || loginRole;

  const { files, handleUpload, handleRemove, uploadsInFlight: reusableUploadsInFlight, awaitUploads: awaitReusableUploads } = useDocumentChecklist({ caseId: activeCaseId });

  // Legacy single-role path — inert (caseId withheld, no fetch) once the new
  // architecture takes over for this case.
  const legacyQA = useQuestionnaireAnswers(useNewArchitecture ? null : activeCaseId, effectiveRole || undefined, { disabled: useNewArchitecture });
  const legacyReusable = useCaseDocumentChecklist(activeCase, effectiveRole);
  const legacyReusableCategories = useMemo(() => buildCaseCategories(legacyReusable.checklist), [legacyReusable.checklist]);

  // New architecture — up to three roles fetched simultaneously. Passing
  // `null` as caseId (not just `disabled: true`) is what actually suppresses
  // the underlying GET for a role that isn't active on this case/mode —
  // `disabled` alone only gates saveAnswer/saveFiles, not the initial fetch.
  const employerQA = useQuestionnaireAnswers(useNewArchitecture && showEmployer ? activeCaseId : null, "employer", { disabled: !(useNewArchitecture && showEmployer) });
  const bizPlanQA = useQuestionnaireAnswers(useNewArchitecture && showBusinessPlan ? activeCaseId : null, "business_plan", { disabled: !(useNewArchitecture && showBusinessPlan) });
  const employeeQA = useQuestionnaireAnswers(useNewArchitecture && showEmployeeInline ? activeCaseId : null, "employee", { disabled: !(useNewArchitecture && showEmployeeInline) });

  const employerReusable = useCaseDocumentChecklist(activeCase, "employer");
  const bizPlanReusable = useCaseDocumentChecklist(activeCase, "business_plan");
  const employeeReusable = useCaseDocumentChecklist(activeCase, "employee");
  const employerReusableCategories = useMemo(() => buildCaseCategories(employerReusable.checklist), [employerReusable.checklist]);
  const bizPlanReusableCategories = useMemo(() => buildCaseCategories(bizPlanReusable.checklist), [bizPlanReusable.checklist]);
  const employeeReusableCategories = useMemo(() => buildCaseCategories(employeeReusable.checklist), [employeeReusable.checklist]);

  // submitted covers the legacy/family/individual single-role path (one
  // submit call, page-wide lock). The new-architecture (employer-sponsored)
  // path locks PER ROLE instead — see employerRoleSubmitted/
  // employeeRoleSubmitted/allRolesSubmitted below — since submitting the
  // employer side must not lock or navigate away from a still-pending inline
  // employee section (Bug C).
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveProgressState, setSaveProgressState] = useState("idle"); // idle | saving | saved | error
  const [submitError, setSubmitError] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("");
  const sectionRefs = useRef({});

  // Handoff junction state — drives the EmployeeHandoffModal below.
  const assignment = activeCase?.questionnaireData?.masterData?.employeeQuestionnaireAssignment || {};
  const [employeePacketMode, setEmployeePacketMode] = useState("");
  const [employeeInviteForm, setEmployeeInviteForm] = useState({ name: "", email: "", phone: "" });
  const [handoffMessage, setHandoffMessage] = useState("");
  // Deliberately separate from activeEmployeeMode below: a successful invite
  // sets activeEmployeeMode as a side effect, but the modal still needs to
  // stay open one more beat to show its own "invitation sent" confirmation
  // step — visibility here is only ever closed by the modal's own onClose.
  const [handoffModalDismissed, setHandoffModalDismissed] = useState(false);
  const activeEmployeeMode = employeePacketMode || assignment.mode || "";
  const [resendingInvite, setResendingInvite] = useState(false);

  useEffect(() => {
    if (!activeCase) return;
    setEmployeePacketMode(activeCase.questionnaireData?.masterData?.employeeQuestionnaireAssignment?.mode || "");
    setEmployeeInviteForm({
      name: activeCase.employeeInvite?.name || activeCase.clientName || "",
      email: activeCase.employeeInvite?.email || activeCase.clientEmail || "",
      phone: activeCase.employeeInvite?.phone || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCase?._id]);

  const chooseEmployerCompletedPacket = async () => {
    setEmployeePacketMode("employer_completes");
    if (!activeCaseId) return;
    // Content-free by design — this call only flips
    // questionnaireData.masterData.employeeQuestionnaireAssignment.mode
    // server-side; the actual questionnaire content lives in the
    // Questionnaire/Answer system rendered inline below.
    await employmentWorkflowApi.saveEmployeeQuestionnaire(activeCaseId, {});
    await refetchActiveCase();
    setHandoffMessage("Employee section unlocked below — complete it on the employee's behalf.");
    refetchChecklists();
  };

  // Accepts the form directly (rather than only reading employeeInviteForm
  // state) so a caller — e.g. EmployeeHandoffModal — can invite immediately
  // without waiting on a state update to land first.
  const inviteEmployeeForQuestionnaire = async (formOverride) => {
    const form = formOverride || employeeInviteForm;
    if (!activeCaseId) return;
    if (!form.email || !form.name || !form.phone) {
      setHandoffMessage("Employee name, email, and mobile number are required to send the invitation.");
      throw new Error("Employee name, email, and mobile number are all required.");
    }
    const response = await employmentWorkflowApi.inviteEmployee(activeCaseId, form);
    await refetchActiveCase();
    setEmployeeInviteForm(form);
    setEmployeePacketMode("invite_employee");
    setHandoffMessage(response.createdAccount ? "Invitation sent — the employee will set their own password by email." : "Existing employee account linked and invited to complete their questionnaire.");
    refetchChecklists();
  };

  const resendEmployeeInvite = async () => {
    if (!activeCaseId || resendingInvite) return;
    setResendingInvite(true);
    try {
      await employmentWorkflowApi.resendEmployeeInvite(activeCaseId);
      setHandoffMessage("A new invitation has been sent to the employee.");
    } catch (error) {
      setHandoffMessage(error.message || "Unable to resend the invitation. Please try again.");
    } finally {
      setResendingInvite(false);
    }
  };

  useEffect(() => { document.title = "Case Checklist | BAIS Immigration Portal"; }, []);

  const legacySections = useMemo(
    () => buildRoleSections(legacyQA, legacyReusableCategories, null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legacyQA.sections, legacyQA.questionsBySection, legacyQA.answers, legacyReusableCategories]
  );

  const newSections = useMemo(() => {
    if (!useNewArchitecture) return [];
    // employer and business_plan are always the SAME person (see
    // assigneeForRole in the backend — both route to caseData.employerUser)
    // — a duplicate label between those two role groups (e.g. "Supporting
    // Evidence" appearing under both) is the same human being asked for the
    // same thing twice, so their combined item list is deduped together.
    // employee is a different person, so its own sections are deduped only
    // against themselves (buildRoleSections already does this internally),
    // never collapsed against the employer's/business plan's.
    const employerPersonSections = dedupeSectionsByLabel([
      ...(showEmployer ? buildRoleSections(employerQA, employerReusableCategories, "employer") : []),
      ...(showBusinessPlan ? buildRoleSections(bizPlanQA, bizPlanReusableCategories, "business_plan") : []),
    ]);
    const employeePersonSections = showEmployeeInline ? buildRoleSections(employeeQA, employeeReusableCategories, "employee") : [];
    return [...employerPersonSections, ...employeePersonSections];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    useNewArchitecture, showEmployer, showBusinessPlan, showEmployeeInline,
    employerQA.sections, employerQA.questionsBySection, employerQA.answers, employerReusableCategories,
    bizPlanQA.sections, bizPlanQA.questionsBySection, bizPlanQA.answers, bizPlanReusableCategories,
    employeeQA.sections, employeeQA.questionsBySection, employeeQA.answers, employeeReusableCategories,
  ]);

  const sections = useNewArchitecture ? newSections : legacySections;
  const activeQAs = useNewArchitecture
    ? [showEmployer && employerQA, showBusinessPlan && bizPlanQA, showEmployeeInline && employeeQA].filter(Boolean)
    : [legacyQA];
  const combinedStatus = combineQaStatus(activeQAs);
  // FIX (unsaved-changes guard, AC-S5): true whenever any active
  // questionnaire has a field edited but not yet committed via Save
  // progress/Submit — read by the beforeunload/popstate guards below.
  const hasUnsavedChanges = activeQAs.some((qa) => qa.dirty);
  const uploadsInFlightCount = reusableUploadsInFlight + activeQAs.reduce((sum, qa) => sum + qa.uploadsInFlight, 0);

  // Shared batched-persistence path (Bug A/B, AC-S3): awaits every upload
  // currently in flight (reusable-document + questionnaire file-question),
  // then batch-saves every active questionnaire's current answers in one
  // request each. Both "Save progress" and "Submit case" call this and only
  // this for persistence — Submit's only extra step is the actual
  // submit-endpoint call + role-aware navigation below.
  const commitAll = async () => {
    await awaitReusableUploads();
    await Promise.all(activeQAs.map((qa) => qa.commitAll()));
  };

  const itemStatus = (item) => {
    if (item.type === "document" && item.docId) return documentItemStatus(files[item.docId] || []);
    if (item.question) {
      const src = item.qaSource || legacyQA;
      const key = questionKey(item.question);
      return fieldItemStatus(src.answerByKey.get(key), src.answers[key]);
    }
    return { status: STATUS.NOT_STARTED };
  };

  const itemIsDone = (item) => itemStatus(item).status !== STATUS.NOT_STARTED;
  const itemIsMissingRequired = (item) => {
    if (!item.required) return false;
    if (item.type === "document" && item.docId) return !(files[item.docId] || []).length;
    if (item.question) {
      const src = item.qaSource || legacyQA;
      return isEmptyAnswerValue(src.answers[questionKey(item.question)]);
    }
    return false;
  };

  const sectionCounts = useMemo(
    () => sections.map((section) => ({
      id: section.id,
      label: section.label,
      roleGroup: section.roleGroup,
      total: section.items.length,
      done: section.items.filter(itemIsDone).length,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, files]
  );

  const overall = sectionCounts.reduce((acc, section) => ({ done: acc.done + section.done, total: acc.total + section.total }), { done: 0, total: 0 });
  const overallPct = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;
  const missingRequiredItems = sections.flatMap((section) => section.items.filter(itemIsMissingRequired));
  // FIX (Bug C): gating "Submit case" on every section's required items
  // (employer + employee combined) meant the employer could never submit
  // their own side while the employee's still-blank inline section existed
  // - scope the gate to whichever role this click will actually submit, so
  // the employer's Submit enables independently of the employee's progress.
  const missingRequiredItemsForSubmit = useNewArchitecture
    ? sections
        .filter((section) => (isEmployeeLoginView || employerRoleSubmitted ? section.roleGroup === "employee" : section.roleGroup === "employer" || section.roleGroup === "business_plan"))
        .flatMap((section) => section.items.filter(itemIsMissingRequired))
    : missingRequiredItems;

  // Distinct role groups actually present, in role order — drives whether
  // the rail shows flat rows (today's look, 0-1 groups) or grouped headings
  // (2+ groups, the new multi-role page).
  const presentRoleGroups = useMemo(() => {
    const seen = new Set();
    const ordered = [];
    sectionCounts.forEach((section) => {
      if (section.roleGroup && !seen.has(section.roleGroup)) {
        seen.add(section.roleGroup);
        ordered.push(section.roleGroup);
      }
    });
    return ordered;
  }, [sectionCounts]);

  useEffect(() => {
    if (!activeSectionId && sections.length) setActiveSectionId(sections[0].id);
  }, [activeSectionId, sections]);

  useEffect(() => {
    const handleScroll = () => {
      const positions = sections
        .map((section) => {
          const el = sectionRefs.current[section.id];
          return el ? { id: section.id, top: el.getBoundingClientRect().top } : null;
        })
        .filter(Boolean);
      const current = positions.filter((entry) => entry.top <= 160).sort((a, b) => b.top - a.top)[0];
      if (current) setActiveSectionId(current.id);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [sections]);

  const scrollToSection = (id) => {
    setActiveSectionId(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onUploadReusable = async (file, category, docId) => {
    await handleUpload(file, category, docId);
  };

  // "Done for THIS viewer" (Bug C) — an employer inviting the employee
  // doesn't wait on the invited employee's own future submission; an
  // employer filling both sides inline (employer_completes) does; an
  // invited employee's own login only ever cares about their own side.
  const allRolesSubmitted = !useNewArchitecture
    ? submitted
    : isEmployeeLoginView
      ? employeeRoleSubmitted
      : activeEmployeeMode === "employer_completes"
        ? employerRoleSubmitted && employeeRoleSubmitted
        : employerRoleSubmitted;
  const nextSubmitRoleTarget = useNewArchitecture
    ? (isEmployeeLoginView ? "employee" : (!employerRoleSubmitted ? "employer" : "employee"))
    : (effectiveRole === "employer" ? "employer" : "employee");

  const handleSaveProgress = async () => {
    if (submitting || saveProgressState === "saving") return;
    setSaveProgressState("saving");
    setSubmitError("");
    try {
      await commitAll();
      setSaveProgressState("saved");
    } catch (error) {
      setSubmitError(error.message || "Unable to save your progress. Please try again.");
      setSaveProgressState("error");
    }
  };

  const handleSubmit = async () => {
    if (missingRequiredItemsForSubmit.length > 0 || allRolesSubmitted || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      // Save-then-submit, never submit-then-save: commitAll() (batched answer
      // save, having already awaited every in-flight upload) always finishes
      // before any submit-endpoint call or navigation, so submitting can
      // never race an unfinished upload/save the way the old per-field
      // autosave + unconditional navigate did (Bug A).
      await commitAll();
      if (activeCaseId) {
        // Three submit paths, checked in order: a family (K-1/K-3) case has
        // its own petitioner/beneficiary submit endpoint — checked first
        // since it would otherwise also satisfy the employer-sponsored
        // branch below (visibleChecklists.length > 0) and 403 at the
        // employment-workflow route. An employer-sponsored case (this case
        // has employer/employee/business_plan checklists assigned) is
        // submitted per-side via the employment-workflow endpoint; a plain
        // individual case uses the standard client-intake submit. Calling
        // the wrong one for an employer/employee-role account 403s at the
        // route (client-intake's /me/submit only allows role "client"/"user").
        if (isFamilyShapeCase) {
          const familyRoleTarget = allowedRoles?.includes("petitioner") ? "petitioner" : "beneficiary";
          await familyWorkflowApi.submit(activeCaseId, familyRoleTarget);
          setSubmitted(true);
          navigate("/dashboard");
        } else if (visibleChecklists.length > 0) {
          await employmentWorkflowApi.submit(activeCaseId, nextSubmitRoleTarget);
          if (!useNewArchitecture) {
            setSubmitted(true);
            navigate("/dashboard");
          } else {
            // Re-fetch the case so employerStatus/employeeStatus (server
            // truth) reflect this submit before deciding whether to navigate
            // — using the refetch's own returned data rather than this
            // render's (now-stale) closure values.
            const refreshed = await refetchActiveCase();
            const freshCase = useEmployerCaseResolution
              ? (refreshed.data?.cases || []).find((item) => item._id === routeCaseId)
              : refreshed.data;
            const freshEmployerSubmitted = freshCase?.employerEmployeeWorkflow?.employerStatus === "submitted";
            const freshEmployeeSubmitted = freshCase?.employerEmployeeWorkflow?.employeeStatus === "submitted";
            const nowAllSubmitted = isEmployeeLoginView
              ? freshEmployeeSubmitted
              : activeEmployeeMode === "employer_completes"
                ? freshEmployerSubmitted && freshEmployeeSubmitted
                : freshEmployerSubmitted;
            if (nowAllSubmitted) {
              navigate("/dashboard");
            } else {
              // Bug C/D: employer side just submitted, but the employee's
              // section is still pending inline (employer_completes) — stay
              // on this page and reveal/scroll to it instead of navigating.
              const firstEmployeeSection = sections.find((section) => section.roleGroup === "employee");
              if (firstEmployeeSection) scrollToSection(firstEmployeeSection.id);
            }
          }
        } else {
          await profileApi.submitIntake(activeCaseId);
          await casesApi.workflow(activeCaseId);
          setSubmitted(true);
          navigate("/dashboard");
        }
      } else {
        setSubmitted(true);
        navigate("/dashboard");
      }
    } catch (error) {
      setSubmitError(error.message || "Unable to submit your checklist. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // FIX (unsaved-changes guard, AC-S5, partial — see report for the one
  // known gap): covers tab close/refresh (beforeunload) and the browser
  // back/forward button (popstate). This app uses a plain <BrowserRouter>
  // (App.jsx), not a Data Router, so React Router's useBlocker — the only
  // API that can also intercept an in-app click on an unrelated nav link —
  // isn't available here; that gap is a router-architecture change out of
  // this page's scope, not something this hook can reach.
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const handlePopState = () => {
      if (hasUnsavedChanges && !window.confirm("You have unsaved changes. Leave without saving?")) {
        window.history.pushState(null, "", window.location.href);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [hasUnsavedChanges]);

  const roleLabel = (targetRole) => visibleChecklists.find((item) => item.targetRole === targetRole)?.title || titleFromKey(targetRole);

  // Employer account, no specific case chosen — never guess which of their
  // (possibly many) sponsored cases to show; send them to the dashboard to
  // pick one instead (the dedicated Employer Workspace page is gone — this
  // page is the only home for employer/employee checklists now).
  if (useEmployerCaseResolution && !routeCaseId) {
    return <Navigate to="/dashboard" replace />;
  }

  // locked defaults to the legacy/family/individual single-role `submitted`
  // flag; the new-architecture path passes employerRoleSubmitted/
  // employeeRoleSubmitted explicitly per section group instead (Bug C) so
  // submitting the employer side never locks a still-pending employee
  // section.
  const renderSections = (list, locked = submitted) => list.map((section) => (
    <section key={section.id} id={section.id} ref={(el) => { sectionRefs.current[section.id] = el; }} className="scroll-mt-40" aria-labelledby={`${section.id}-heading`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${section.id}-heading`} className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.label}</h2>
        <span className="text-xs font-semibold text-slate-400">{section.items.filter(itemIsDone).length}/{section.items.length} complete</span>
      </div>
      {!locked && section.autofillSources?.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {section.autofillSources.map((documentType) => (
            <AutofillButton key={documentType} documentType={documentType} caseId={activeCaseId} disabled={!activeCaseId} onUploaded={(section.qaSource || legacyQA).handleAutofillResult} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {section.items.map((item) => {
          const { status, reason } = itemStatus(item);
          if (item.type === "document" && item.docId) {
            return (
              <ChecklistItemRow key={item.id} id={item.id} type="document" label={item.label} help={item.help} required={item.required} status={status} statusReason={reason}>
                <DocumentUploadControl
                  docId={item.docId}
                  category={item.category}
                  disabled={locked}
                  files={files[item.docId] || []}
                  onUpload={onUploadReusable}
                  onRemove={handleRemove}
                />
              </ChecklistItemRow>
            );
          }
          const question = item.question;
          const src = item.qaSource || legacyQA;
          const key = questionKey(question);
          const value = src.answers[key] ?? question.defaultValue ?? "";
          return (
            <ChecklistItemRow
              key={item.id}
              id={item.id}
              type={item.type}
              label={item.label}
              help={item.help}
              required={item.required}
              status={status}
              statusReason={reason}
              savingLabel={src.savingKey === key ? "Saving…" : undefined}
            >
              <QuestionInput
                question={question}
                value={value}
                disabled={locked}
                saving={src.savingKey === key}
                onChange={(nextValue) => src.saveAnswer(question, nextValue)}
                onFileChange={(uploadedFiles) => src.saveFiles(question, uploadedFiles)}
              />
              <PrefillBadge
                meta={src.prefillMeta[key]}
                onAccept={!locked ? () => src.saveAnswer(question, value) : undefined}
                onReject={!locked ? () => src.saveAnswer(question, "") : undefined}
              />
            </ChecklistItemRow>
          );
        })}
      </div>
    </section>
  ));

  const employerBusinessPlanSections = sections.filter((section) => section.roleGroup === "employer" || section.roleGroup === "business_plan");
  const employeeSections = sections.filter((section) => section.roleGroup === "employee");
  const employerSectionsLocked = useNewArchitecture ? employerRoleSubmitted : submitted;
  const employeeSectionsLocked = useNewArchitecture ? employeeRoleSubmitted : submitted;
  const showHandoffJunction = useNewArchitecture && showEmployer;
  const employeeWaitingOnInvite = showHandoffJunction && !showEmployeeInline && activeEmployeeMode === "invite_employee";
  // The full-screen choice popup appears once the employer's own checklist
  // is done and they haven't picked a path yet for the employee's part.
  // Gated on REQUIRED items only — same criterion "Submit case" itself uses
  // (missingRequiredItems). Requiring every item including optional ones
  // meant an employer who left even one optional field blank (previously
  // most text fields, before required/optional marking was corrected to
  // match the source checklist) could successfully submit yet never see
  // this popup at all.
  const employerSectionsComplete = employerBusinessPlanSections.length > 0 && !employerBusinessPlanSections.some((section) => section.items.some(itemIsMissingRequired));
  const showHandoffModal = showHandoffJunction && !activeEmployeeMode && employerSectionsComplete && !handoffModalDismissed;

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#checklist-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow">
        Skip to checklist
      </a>

      {/* ── Sticky case header ── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Case checklist</p>
              <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">
                {visaType ? `${visaType} intake` : "Your case checklist"}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div aria-live="polite" className="text-xs font-medium text-slate-500">
                {uploadsInFlightCount > 0
                  ? `Uploading… (${uploadsInFlightCount} remaining)`
                  : saveProgressState === "saving" ? "Saving…"
                  : saveProgressState === "saved" && !hasUnsavedChanges ? `Saved${combinedStatus.lastSavedAt ? ` at ${combinedStatus.lastSavedAt}` : ""}`
                  : saveProgressState === "error" ? "Save failed"
                  : hasUnsavedChanges ? "Unsaved changes"
                  : combinedStatus.lastSavedAt ? `Saved at ${combinedStatus.lastSavedAt}` : ""}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={overallPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${overallPct}%` }} />
                </div>
                <span className="text-sm font-semibold text-slate-700">{overall.done} of {overall.total} complete</span>
              </div>
              <button
                type="button"
                onClick={handleSaveProgress}
                disabled={allRolesSubmitted || submitting || saveProgressState === "saving" || uploadsInFlightCount > 0}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {saveProgressState === "saving" ? "Saving…" : "Save progress"}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={missingRequiredItemsForSubmit.length > 0 || allRolesSubmitted || submitting || uploadsInFlightCount > 0}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {allRolesSubmitted ? "Submitted" : submitting ? "Submitting…" : "Submit case"}
              </button>
            </div>
          </div>

          {!useNewArchitecture && visibleChecklists.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Checklist role">
              {visibleChecklists.map((item) => (
                <button
                  key={item.referenceId}
                  type="button"
                  role="tab"
                  aria-selected={activeRole === item.targetRole}
                  onClick={() => setActiveRole(item.targetRole)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    activeRole === item.targetRole ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {item.title || roleLabel(item.targetRole)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mobile section nav — dropdown */}
        <div className="border-t border-slate-100 px-4 py-2 sm:px-6 lg:hidden">
          <label htmlFor="checklist-section-select" className="sr-only">Jump to section</label>
          <select
            id="checklist-section-select"
            value={activeSectionId}
            onChange={(event) => scrollToSection(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            {sectionCounts.map((section) => (
              <option key={section.id} value={section.id}>{section.label} ({section.done}/{section.total})</option>
            ))}
          </select>
        </div>
      </header>

      {allRolesSubmitted && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2.5 text-center text-sm font-semibold text-emerald-800 sm:px-6">
          Your case checklist has been submitted and is now read-only. Your case team will follow up if anything needs attention.
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
        {/* Desktop section nav — sticky rail */}
        <nav aria-label="Checklist sections" className="hidden lg:block">
          <div className="sticky top-24 space-y-1 rounded-xl border border-slate-200 bg-white p-2">
            {presentRoleGroups.length > 1 ? (
              presentRoleGroups.map((roleGroup) => (
                <div key={roleGroup} className="mb-2 last:mb-0">
                  <p className="px-3 pb-1 pt-2 text-[0.68rem] font-bold uppercase tracking-wide text-slate-400">{ROLE_GROUP_LABEL[roleGroup] || titleFromKey(roleGroup)}</p>
                  {sectionCounts.filter((section) => section.roleGroup === roleGroup).map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => scrollToSection(section.id)}
                      aria-current={activeSectionId === section.id ? "true" : undefined}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                        activeSectionId === section.id ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <span className="truncate">{section.label}</span>
                      <span className={`shrink-0 text-xs font-semibold ${section.done === section.total ? "text-emerald-600" : "text-slate-400"}`}>
                        {section.done}/{section.total}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              sectionCounts.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  aria-current={activeSectionId === section.id ? "true" : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                    activeSectionId === section.id ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span className="truncate">{section.label}</span>
                  <span className={`shrink-0 text-xs font-semibold ${section.done === section.total ? "text-emerald-600" : "text-slate-400"}`}>
                    {section.done}/{section.total}
                  </span>
                </button>
              ))
            )}
            {employeeWaitingOnInvite && (
              <div className="mb-2 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-[0.68rem] font-bold uppercase tracking-wide text-slate-400">Employee</p>
                <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700">
                  <span aria-hidden="true">⏳</span> Waiting on employee
                </div>
              </div>
            )}
          </div>
        </nav>

        <main id="checklist-main" className="mt-4 space-y-8 lg:mt-0">
          <StatusLegend />

          {isEmployeeLoginView && activeCase && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Your employer has started a {visaType || "your"} case for you. Complete the sections below, then click Save progress or Submit case.
            </div>
          )}

          {combinedStatus.statusMessage && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">{combinedStatus.statusMessage}</div>
          )}

          {sections.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              Complete your eligibility assessment to see your case-specific checklist.
            </div>
          )}

          {renderSections(useNewArchitecture ? employerBusinessPlanSections : sections, useNewArchitecture ? employerSectionsLocked : submitted)}

          {showHandoffJunction && activeEmployeeMode && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Employee's part</h2>
              {handoffMessage && <p className="mt-2 text-sm text-emerald-700">{handoffMessage}</p>}
              {activeEmployeeMode === "employer_completes" ? (
                <p className="mt-2 text-sm text-slate-600">You're completing the employee's section yourself — it appears below.</p>
              ) : activeEmployeeMode === "invite_employee" ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">Waiting on the employee to complete their own section.</p>
                  <button
                    type="button"
                    onClick={resendEmployeeInvite}
                    disabled={resendingInvite}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resendingInvite ? "Resending…" : "Resend invite"}
                  </button>
                </div>
              ) : null}
            </section>
          )}

          <EmployeeHandoffModal
            open={showHandoffModal}
            onClose={() => setHandoffModalDismissed(true)}
            onChooseFillMyself={chooseEmployerCompletedPacket}
            onInvite={inviteEmployeeForQuestionnaire}
            message={handoffMessage}
            initialForm={employeeInviteForm}
          />

          {useNewArchitecture && showEmployeeInline && employeeSections.length > 0 && (
            showEmployer ? (
              // Employer viewing/filling this inline on the employee's
              // behalf — band it so it's visually distinct from their own
              // sections above. An actual employee login (showEmployer
              // false) just sees their sections plainly, no banner.
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-1">
                <p className="px-4 pt-3 text-xs font-bold uppercase tracking-wide text-emerald-700">Employee — completed by employer</p>
                <div className="space-y-8 p-4">{renderSections(employeeSections, employeeSectionsLocked)}</div>
              </div>
            ) : (
              <div className="space-y-8">{renderSections(employeeSections, employeeSectionsLocked)}</div>
            )
          )}

          {/* Case-specific data collection (moved off Profile — see
              components/checklist/CaseIntakeExtras.jsx) — not shown to an
              employee viewing only their own section. */}
          {!isEmployeeLoginView && activeCaseId && <CaseIntakeExtras caseId={activeCaseId} />}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {missingRequiredItemsForSubmit.length > 0 ? `${missingRequiredItemsForSubmit.length} required item${missingRequiredItemsForSubmit.length === 1 ? "" : "s"} still needed` : "All required items complete"}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {allRolesSubmitted ? "This checklist is read-only after submission." : uploadsInFlightCount > 0 ? `Waiting on ${uploadsInFlightCount} upload${uploadsInFlightCount === 1 ? "" : "s"} to finish before you can save or submit.` : useNewArchitecture && showEmployer ? "Submitting locks the employer side for your case team's review. Save progress any time without submitting." : "Submitting locks this checklist for your case team's review. Save progress any time without submitting."}
              </p>
              {submitError && <p role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">{submitError}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveProgress}
                disabled={allRolesSubmitted || submitting || saveProgressState === "saving" || uploadsInFlightCount > 0}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {saveProgressState === "saving" ? "Saving…" : "Save progress"}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={missingRequiredItemsForSubmit.length > 0 || allRolesSubmitted || submitting || uploadsInFlightCount > 0}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {allRolesSubmitted ? "Submitted" : submitting ? "Submitting…" : "Submit case"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
