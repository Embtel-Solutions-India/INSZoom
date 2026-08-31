// Phase 13 - CaseForms belong to the case, not the questionnaire.
//
// Confirms the ONE real gap found by investigation: uscisFormService.
// ensureAssignedForms() (already correct and already idempotent - unchanged
// by this phase) used to run ONLY from inside generateForms(), which
// hard-gated on questionnaire/document/review completion. That meant a
// CaseForm did not exist until a case manager clicked "Generate USCIS
// Forms" AND every readiness gate had already passed.
//
// This suite proves the fix without touching (and without re-testing, since
// h1b-golden-path.test.js already covers them) AutoFillService, SyncStateService,
// reverse sync, conflict handling, sibling fan-out, the renderer, or the
// CaseForm model itself:
//   1. CaseLifecycleOrchestrator.provisionRequiredForms() (called from
//      initializeCase()/onAssignment()) assigns CaseForms immediately, with
//      no questionnaire, no documents, no client answers at all.
//   2. generateForms() no longer throws QUESTIONNAIRE_INCOMPLETE/
//      DOCUMENTS_INCOMPLETE/DOCUMENT_REVIEW_INCOMPLETE, and actually runs
//      autofill against the already-provisioned form instead of returning
//      early without touching it.
//   3. Answering real questionnaire data later and calling generateForms()
//      again autofills the existing CaseForm - it does not create a second
//      one.
//   4. A case-manager manual override (AutoFillService.overrideField, the
//      same call saveField() makes) survives a subsequent autofill run.
//   5. Editing a field through the real interactive-review save path and
//      reloading the CaseForm fresh from the database (closing/reopening
//      the form) still shows the saved value - the existing field-value-first
//      persistence path, no new PDF artifact needed.
//   6. Concurrent/repeated provisioning calls never create a duplicate
//      CaseForm for the same (caseId, formTemplateId).
const assert = require("node:assert/strict");
const test = require("node:test");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const { BASE } = require("../../../test-utils/fixtures/h1b-golden");

const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const Answer = require("../../../models/Answer");
const AuditLog = require("../../../models/AuditLog");
const User = require("../../../models/User");
const Beneficiary = require("../../../models/Beneficiary");
const Company = require("../../../models/Company");
const Questionnaire = require("../../../models/Questionnaire");

const CaseLifecycleOrchestrator = require("../case-lifecycle-orchestrator.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const InteractiveFormReviewService = require("../../uscis-forms/interactive-form-review.service");

const req = { ip: "127.0.0.1", headers: {} };
const admin = () => ({ _id: userId, role: "admin" });

let caseId;
let userId;
let beneficiaryId;
let companyId;

test.before(async () => {
  await connectTestDB();
});

test.after(async () => {
  if (caseId) {
    await CaseForm.deleteMany({ caseId });
    await Answer.deleteMany({ caseId });
    await AuditLog.deleteMany({ entityId: caseId.toString() }).catch(() => null);
    await Case.deleteOne({ _id: caseId });
  }
  if (beneficiaryId) await Beneficiary.deleteOne({ _id: beneficiaryId });
  if (companyId) await Company.deleteOne({ _id: companyId });
  if (userId) await User.deleteOne({ _id: userId });
  await disconnectTestDB();
});

test("Phase 13 - CaseForms are provisioned immediately, with no client/questionnaire", async () => {
  const user = await User.create({ email: "phase13.provisioning@example.com", password: "not-a-real-hash", name: `${BASE.beneficiary.firstName} ${BASE.beneficiary.lastName}`, role: "client" });
  userId = user._id;
  const beneficiary = await Beneficiary.create({ user: user._id, firstName: BASE.beneficiary.firstName, lastName: BASE.beneficiary.lastName, dateOfBirth: BASE.beneficiary.dateOfBirth, alienRegistrationNumber: "" });
  beneficiaryId = beneficiary._id;
  const company = await Company.create({ name: BASE.petitioner.legalName, ein: BASE.petitioner.fein });
  companyId = company._id;
  const caseDoc = await Case.create({ caseNumber: "H1B-2025-PHASE13-PROV", visaType: BASE.visaType, user: user._id, beneficiary: beneficiary._id, companyId: company._id, status: "active" });
  caseId = caseDoc._id;

  // --- Criterion 1: no client/questionnaire/documents exist at all yet ---
  assert.equal(await Answer.countDocuments({ caseId }), 0, "sanity: no answers exist yet");
  assert.equal(await CaseForm.countDocuments({ caseId }), 0, "sanity: no CaseForm exists yet");

  await CaseLifecycleOrchestrator.provisionRequiredForms(caseDoc, admin(), req);
  const i129AfterProvision = await CaseForm.findOne({ caseId, formCode: "I-129" });
  assert.ok(i129AfterProvision, "an I-129 CaseForm must exist immediately after provisioning, before any questionnaire is ever answered");
  assert.equal(await CaseForm.countDocuments({ caseId, formCode: "I-129" }), 1);

  // --- Criterion 5 (concurrency): repeated + concurrent calls never duplicate ---
  await Promise.all([
    CaseLifecycleOrchestrator.provisionRequiredForms(caseDoc, admin(), req),
    CaseLifecycleOrchestrator.provisionRequiredForms(caseDoc, admin(), req),
    uscisFormService.ensureAssignedForms(await Case.findById(caseId), admin(), req),
  ]);
  assert.equal(await CaseForm.countDocuments({ caseId, formCode: "I-129" }), 1, "concurrent/repeated provisioning must not create a duplicate CaseForm");

  // --- Criterion 3 (first half): generateForms() must not gate on
  // questionnaire/document completion just to populate the already-
  // provisioned form ---
  const firstRun = await CaseLifecycleOrchestrator.generateForms(caseId, admin(), req);
  assert.equal(firstRun.created.length, 0, "the form was already provisioned - generateForms must not create a second one");
  assert.equal(firstRun.generated.length, 1, "generateForms must still run autofill against the pre-provisioned form, not just return it untouched");
  assert.equal(await CaseForm.countDocuments({ caseId, formCode: "I-129" }), 1, "still exactly one I-129 CaseForm after the first generateForms call");

  // --- Criterion 3 (second half): answering real questionnaire data later
  // autofills the SAME CaseForm, no new one is created ---
  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const employerQ = await Questionnaire.findOne({ key: "h1b_employer_checklist", latestVersion: true });
  await questionnaireService.saveAnswers({
    questionnaireId: employerQ._id,
    caseId,
    answers: [{ questionKey: "employer_company_fullName", value: BASE.petitioner.legalName }],
  }, { _id: userId, role: "client" }, req, "submitted");

  const secondRun = await CaseLifecycleOrchestrator.generateForms(caseId, admin(), req);
  assert.equal(secondRun.created.length, 0, "no new CaseForm should be created just because the questionnaire has data now");
  assert.equal(await CaseForm.countDocuments({ caseId, formCode: "I-129" }), 1, "still exactly one I-129 CaseForm after real data arrives");
  const afterRealData = await CaseForm.findOne({ caseId, formCode: "I-129" }).lean();
  const populatedFieldEntry = Object.entries(afterRealData.fieldValues || {}).find(([, value]) => String(value).includes(BASE.petitioner.legalName.split(" ")[0]));
  assert.ok(populatedFieldEntry, "the employer legal name answered in the questionnaire must show up autofilled in the already-provisioned CaseForm");
  const [mappedFieldName] = populatedFieldEntry;

  // --- Criterion 4: the existing manual-override/conflict system behaves
  // correctly, unchanged by this phase. Overriding a field that already has
  // a database-sourced canonical value (mappedFieldName maps to
  // company.name, already sourced from the Company record) does two things
  // by design, confirmed by direct inspection: the override wins immediately
  // in the CaseForm (staff_override outranks database, priority 700 vs 200),
  // and it records a pending_review conflict for a human to consciously
  // acknowledge - CaseLifecycleOrchestrator.generateForms() correctly
  // refuses to run another blanket autofill while one is outstanding, rather
  // than silently re-deciding a staff call. That refusal is the "correct
  // behavior" this criterion asks for, not something this phase should
  // suppress.
  await AutoFillService.overrideField(caseId, "I-129", mappedFieldName, "PHASE13_MANUAL_OVERRIDE", { _id: userId, role: "case_manager" }, req, "phase13 manual override test");
  const overriddenForm = await CaseForm.findOne({ caseId, formCode: "I-129" }).lean();
  assert.equal(overriddenForm.fieldValues[mappedFieldName], "PHASE13_MANUAL_OVERRIDE", "the manual override must be reflected in the CaseForm immediately");
  await assert.rejects(
    () => CaseLifecycleOrchestrator.generateForms(caseId, admin(), req),
    (error) => error.code === "CANONICAL_NEEDS_REVIEW",
    "generateForms must still refuse to run while a staff-override conflict is pending review - unchanged Phase 11 behavior"
  );
  assert.equal(await CaseForm.countDocuments({ caseId, formCode: "I-129" }), 1, "still exactly one I-129 CaseForm after the override");

  // Resolving the pending conflict in favor of the staff value (the normal
  // next step a case manager takes) unblocks generateForms again, and the
  // override is still intact afterward - proving the refusal above is a
  // review gate, not a stuck state.
  const conflictId = (await Case.findById(caseId).select("canonicalProfile.conflicts").lean()).canonicalProfile.conflicts.find((conflict) => conflict.path === "company.name")?.conflictId;
  assert.ok(conflictId, "the staff-override conflict must be recorded on the canonical profile");
  const CanonicalProfileService = require("../../canonical/services/CanonicalProfileService");
  await CanonicalProfileService.resolveConflict(caseId, { conflictId, value: "PHASE13_MANUAL_OVERRIDE", reason: "phase13 conflict resolution test" }, { _id: userId, role: "case_manager" }, req);
  const afterResolve = await CaseLifecycleOrchestrator.generateForms(caseId, admin(), req);
  assert.equal(afterResolve.created.length, 0, "resolving the conflict must not create a new CaseForm");
  assert.equal(await CaseForm.countDocuments({ caseId, formCode: "I-129" }), 1, "still exactly one I-129 CaseForm after the conflict is resolved and autofill runs again");
  const afterResolveForm = await CaseForm.findOne({ caseId, formCode: "I-129" }).lean();
  assert.equal(afterResolveForm.fieldValues[mappedFieldName], "PHASE13_MANUAL_OVERRIDE", "the override must still be protected from being overwritten once autofill runs again");

  // --- Criterion 2: edit through the real interactive-review save path,
  // reload fresh from the database (closing/reopening the form) - the value
  // must still be there, using the existing field-value-first persistence,
  // no PDF artifact of any kind ---
  const caseFormId = afterResolveForm._id;
  await InteractiveFormReviewService.saveField(caseId, caseFormId, { fieldName: mappedFieldName, value: "PHASE13_ROUNDTRIP", reason: "phase13 roundtrip test" }, { _id: userId, role: "case_manager" }, req);
  const reopened = await CaseForm.findById(caseFormId).lean();
  assert.equal(reopened.fieldValues[mappedFieldName], "PHASE13_ROUNDTRIP", "closing and reopening the form must show the saved edit - durable persistence through the existing save path");
});
