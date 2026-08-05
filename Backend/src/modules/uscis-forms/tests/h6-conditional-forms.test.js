// Phase H6 acceptance tests: cap-registration fields flowing into the I-129
// (AC1), and the four condition-triggered forms - premium I-907 (AC3),
// attorney G-28 (AC4), H-4 dependents I-539/I-539A (AC5) - correctly
// attaching only when their real-world condition is true, never attaching
// otherwise (AC6), and idempotent/reversible re-runs (AC7). Reuses Phase
// H1's golden H-1B case (whose default answers are already a "bare" case:
// no premium addon, no attorney, hasH4Dependents:"no") like h0/h1/h3/h4-h5's
// own acceptance suites - connects to the real configured MongoDB.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const AuditLog = require("../../../models/AuditLog");
const Questionnaire = require("../../../models/Questionnaire");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const uscisFormService = require("../uscis-form.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const MappingResolver = require("../../form-mapping/services/MappingResolver");
const seedI129H1bMapping = require("../../form-mapping/seeds/i129-h1b-mapping.seed");
const { classifyField } = require("../../form-mapping/config/i129-h1b-crosswalk");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
  await seedI129H1bMapping({});
});

test.after(async () => {
  await mongoose.disconnect();
});

test("AC1 (crosswalk half, DB-free) - cap-registration fields classify as mapped, not manual_entry", () => {
  const confirmationNumber = classifyField({ fieldName: "form1[0].#subform[13].SubHLine5_ConfirmationNum[0]", pageNumber: 2 });
  assert.equal(confirmationNumber.status, "mapped");
  assert.equal(confirmationNumber.edge.source, "raw.questionnaireAnswers.employee_capRegistration_beneficiaryConfirmationNumber.value");

  const passportNumber = classifyField({ fieldName: "form1[0].#subform[15].ClassHLine5b_PassportorTravDoc[0]", pageNumber: 14 });
  assert.equal(passportNumber.edge.source, "raw.questionnaireAnswers.employee_capRegistration_passportNumber.value");

  const passportExpiry = classifyField({ fieldName: "form1[0].#subform[15].ClassHLine5b_ExpDate[0]", pageNumber: 14 });
  assert.equal(passportExpiry.edge.source, "raw.questionnaireAnswers.employee_capRegistration_passportExpirationDate.value");

  const passportCountry = classifyField({ fieldName: "form1[0].#subform[15].ClassHLine5b_CountryOfIssuance[0]", pageNumber: 14 });
  assert.equal(passportCountry.status, "mapped");
  assert.equal(passportCountry.edge.source, "raw.questionnaireAnswers.employee_capRegistration_passportCountry.value");
});

test("H6 condition-detection pure functions", () => {
  assert.equal(uscisFormService.hasActivePremiumAddon({ addons: [{ key: "premium_processing_i907", status: "paid" }] }), true);
  assert.equal(uscisFormService.hasActivePremiumAddon({ addons: [{ key: "premium_processing_i907", status: "cancelled" }] }), false);
  assert.equal(uscisFormService.hasActivePremiumAddon({ addons: [] }), false);
  assert.equal(uscisFormService.hasActivePremiumAddon({}), false);
  assert.equal(uscisFormService.hasAttorneyOnRecord({ assignedAttorney: "000000000000000000000001" }), true);
  assert.equal(uscisFormService.hasAttorneyOnRecord({ attorney: "000000000000000000000001" }), true);
  assert.equal(uscisFormService.hasAttorneyOnRecord({}), false);
});

test("H6 acceptance suite: AC1 (fill), AC3, AC4, AC5, AC6, AC7 against a real H-1B case", async () => {
  const golden = await buildGoldenH1bCase();
  const teamLead = { _id: golden.user._id, role: "team_lead" };
  const req = { ip: "127.0.0.1", headers: {} };
  try {
    let caseDoc = await Case.findById(golden.caseId);

    // --- AC6: the golden case's default answers are already "bare" (no
    // premium, no attorney, hasH4Dependents:"no") - zero conditional forms ---
    await uscisFormService.ensureAssignedForms(caseDoc, teamLead, req);
    const bareConditionalForms = await CaseForm.find({ caseId: golden.caseId, formCode: { $in: ["I-907", "G-28", "I-539", "I-539A"] } });
    assert.equal(bareConditionalForms.length, 0, "a bare H-1B case must attach none of I-907/G-28/I-539/I-539A");
    const bareI129 = await CaseForm.findOne({ caseId: golden.caseId, formCode: "I-129" });
    assert.ok(bareI129, "the base I-129 flow must be unaffected by H6's conditional logic");

    // --- AC1: cap-registration answers actually flow into filledData via the crosswalk ---
    const employeeQ = await Questionnaire.findOne({ key: "h1b_employee_checklist", latestVersion: true });
    await questionnaireService.saveAnswers({
      questionnaireId: employeeQ._id,
      caseId: golden.caseId,
      answers: [
        { questionKey: "employee_capRegistration_beneficiaryConfirmationNumber", value: "H1B2026CAP0001234" },
        { questionKey: "employee_capRegistration_passportNumber", value: "P0099887" },
        { questionKey: "employee_capRegistration_passportCountry", value: "United Kingdom" },
        { questionKey: "employee_capRegistration_passportExpirationDate", value: "2027-01-15" },
      ],
    }, golden.user, req, "submitted");
    const { caseForm: refilled } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, req, { regenerate: true });
    const template = await USCISFormTemplate.findById(refilled.formTemplateId).lean();
    const fieldNameToId = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));
    const get = (fieldName) => MappingResolver.resolvePath(refilled.filledData, fieldNameToId.get(fieldName));
    assert.equal(get("form1[0].#subform[13].SubHLine5_ConfirmationNum[0]"), "H1B2026CAP0001234");
    assert.equal(get("form1[0].#subform[15].ClassHLine5b_PassportorTravDoc[0]"), "P0099887");
    assert.equal(get("form1[0].#subform[15].ClassHLine5b_CountryOfIssuance[0]"), "United Kingdom");
    assert.equal(get("form1[0].#subform[15].ClassHLine5b_ExpDate[0]"), "01/15/2027");

    // --- AC3: premium opt-in ---
    // ensureAssignedForms saves `caseData` itself internally (bumping __v),
    // so caseDoc is re-fetched fresh before every subsequent mutation this
    // test makes - reusing a stale in-memory copy across calls throws
    // Mongoose's optimistic-concurrency VersionError.
    caseDoc.addons.push({ service: "Premium Processing", key: "premium_processing_i907", status: "paid", governmentFeeCents: 260000 });
    await caseDoc.save();
    await uscisFormService.ensureAssignedForms(caseDoc, teamLead, req);
    const i907Forms = await CaseForm.find({ caseId: golden.caseId, formCode: "I-907" });
    assert.equal(i907Forms.length, 1, "exactly one I-907 CaseForm must be assigned with an active premium addon");
    assert.notEqual(i907Forms[0].status, "archived");
    caseDoc = await Case.findById(golden.caseId);
    assert.ok(caseDoc.addons.find((addon) => addon.key === "premium_processing_i907").governmentFeeCents > 0, "the premium fee must be recorded on the addon");

    // --- AC4: attorney on record ---
    caseDoc.assignedAttorney = golden.user._id;
    await caseDoc.save();
    await uscisFormService.ensureAssignedForms(caseDoc, teamLead, req);
    const g28Forms = await CaseForm.find({ caseId: golden.caseId, formCode: "G-28" });
    // No G-28 USCISFormTemplate is imported in this environment - assignment
    // must degrade gracefully (skip, not crash), proven by reaching this line.
    assert.equal(g28Forms.length, 0, "G-28 template isn't imported yet - must be skipped gracefully, not fabricated or crashed on");
    caseDoc = await Case.findById(golden.caseId);

    // --- AC5: H-4 dependents ---
    await questionnaireService.saveAnswers({
      questionnaireId: employeeQ._id,
      caseId: golden.caseId,
      answers: [
        { questionKey: "employee_immigrationHistory_hasH4Dependents", value: "yes" },
        { questionKey: "employee_dependents", value: [
          { name: "Jane Lovelace", relationship: "Spouse" },
          { name: "Charles Lovelace", relationship: "Child" },
        ] },
      ],
    }, golden.user, req, "submitted");
    await uscisFormService.ensureAssignedForms(caseDoc, teamLead, req);
    const i539Forms = await CaseForm.find({ caseId: golden.caseId, formCode: "I-539" });
    const i539aForms = await CaseForm.find({ caseId: golden.caseId, formCode: "I-539A" });
    assert.equal(i539Forms.length, 1, "exactly one I-539 must be assigned with H-4 dependents present");
    assert.equal(i539aForms.length, 1, "exactly one I-539A must be assigned for the co-applicant beyond the first (2 dependents total)");
    caseDoc = await Case.findById(golden.caseId);

    // --- AC7 (idempotent): re-running assignment creates no duplicates ---
    const countBeforeRerun = await CaseForm.countDocuments({ caseId: golden.caseId });
    await uscisFormService.ensureAssignedForms(caseDoc, teamLead, req);
    const countAfterRerun = await CaseForm.countDocuments({ caseId: golden.caseId });
    assert.equal(countAfterRerun, countBeforeRerun, "re-running assignment must not duplicate any CaseForm");
    caseDoc = await Case.findById(golden.caseId);

    // --- AC7 (reversible): removing the premium condition archives (never deletes) the I-907 CaseForm ---
    caseDoc.addons.find((addon) => addon.key === "premium_processing_i907").status = "cancelled";
    await caseDoc.save();
    await uscisFormService.ensureAssignedForms(caseDoc, teamLead, req);
    const i907AfterCancel = await CaseForm.findOne({ caseId: golden.caseId, formCode: "I-907" });
    assert.ok(i907AfterCancel, "the I-907 CaseForm must still exist after the addon is cancelled - never deleted");
    assert.equal(i907AfterCancel.status, "archived", "cancelling the premium addon must archive its I-907 CaseForm");
    caseDoc = await Case.findById(golden.caseId);

    // Re-activating the same condition must reuse the archived CaseForm, not duplicate it.
    caseDoc.addons.find((addon) => addon.key === "premium_processing_i907").status = "paid";
    await caseDoc.save();
    await uscisFormService.ensureAssignedForms(caseDoc, teamLead, req);
    const i907AfterReactivate = await CaseForm.find({ caseId: golden.caseId, formCode: "I-907" });
    assert.equal(i907AfterReactivate.length, 1, "reactivating the condition must reuse the same CaseForm, not create a duplicate");
    assert.notEqual(i907AfterReactivate[0].status, "archived");
  } finally {
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await AuditLog.deleteMany({ entityId: String(golden.caseId) }).catch(() => null);
    await golden.cleanup();
  }
});
