const assert = require("node:assert/strict");
const test = require("node:test");
const CanonicalBuilderService = require("../services/CanonicalBuilderService");
const CanonicalMergeService = require("../services/CanonicalMergeService");
const IntelligentQuestionnaireService = require("../../questionnaires/intelligent-questionnaire.service");

// Simulates the shared Beneficiary record after a PRIOR case (Case A, H-1B)
// wrote its own petition-specific answers onto it via the client-intake ->
// beneficiary-sync pipeline (client-intake.service.js's flattenIntakeData +
// beneficiary.service.js's mapClientToBeneficiary). Beneficiary is shared
// across every case a person has (Case.beneficiary is many-cases-to-one), so
// this is real, persistent, cross-case state - not per-case data.
const staleBeneficiaryFromCaseA = {
  firstName: "Ada",
  lastName: "Lovelace",
  fullName: "Ada Lovelace",
  dateOfBirth: "1990-01-01",
  passportNumber: "X1234567",
  employmentHistory: [{ employer: "Case A Corp (H-1B petitioner)", title: "Engineer" }],
  currentVisaStatus: "H-1B",
  visaType: "H-1B",
};

test("addMappedObjectCandidates does not surface case-scoped beneficiary fields (current status / petition visa type) as candidates", () => {
  const candidates = [];
  CanonicalBuilderService.addMappedObjectCandidates(candidates, "beneficiary", staleBeneficiaryFromCaseA, "beneficiary-1");
  const targets = candidates.map((candidate) => candidate.path);

  assert.ok(!targets.includes("immigration.currentStatus"), "current visa status must not source from the shared beneficiary record");
  assert.ok(!targets.includes("immigration.currentVisaType"), "petition visa type must not source from the shared beneficiary record");
  // Person-stable identity fields on the very same object must still flow through.
  assert.ok(targets.includes("person.passport.number"));
  assert.ok(targets.includes("person.fullName"));
});

test("addRepeatableCollections does not inherit a prior case's employment history from the shared beneficiary record, but still preserves the current case's own employment answers and other person-stable histories", () => {
  const freshCaseProfile = {};
  CanonicalBuilderService.addRepeatableCollections(freshCaseProfile, {
    beneficiary: staleBeneficiaryFromCaseA,
    education: undefined,
  });
  assert.deepEqual(freshCaseProfile.employment, [], "a brand-new case must not inherit Case A's employer/wage history");

  const caseWithOwnAnswers = { employment: [{ employer: "Case B Corp (this case's own answer)" }] };
  CanonicalBuilderService.addRepeatableCollections(caseWithOwnAnswers, { beneficiary: staleBeneficiaryFromCaseA });
  assert.equal(caseWithOwnAnswers.employment[0].employer, "Case B Corp (this case's own answer)", "the current case's own employment answers must not be overwritten by the beneficiary fallback");
});

test("a brand-new case's buildCaseQuestionState.prefill excludes a prior case's petition-specific answers but still prefills person-stable identity fields", () => {
  const candidates = [];
  CanonicalBuilderService.addMappedObjectCandidates(candidates, "beneficiary", staleBeneficiaryFromCaseA, "beneficiary-1");
  const merged = CanonicalMergeService.merge(candidates);
  CanonicalBuilderService.addRepeatableCollections(merged.profile, { beneficiary: staleBeneficiaryFromCaseA });

  const questions = [
    { _id: "q1", key: "fullName", mapping: { canonicalPath: "person.fullName" } },
    { _id: "q2", key: "passportNumber", mapping: { canonicalPath: "person.passport.number" } },
    { _id: "q3", key: "currentEmployer", mapping: { canonicalPath: "employment" } },
    { _id: "q4", key: "currentStatus", mapping: { canonicalPath: "immigration.currentStatus" } },
    { _id: "q5", key: "petitionVisaType", mapping: { canonicalPath: "immigration.currentVisaType" } },
  ];
  const state = IntelligentQuestionnaireService.buildCaseQuestionState(questions, merged, []);

  assert.ok(!("currentEmployer" in state.prefill), "Case B must not inherit Case A's employer/wage answers");
  assert.ok(!("currentStatus" in state.prefill), "Case B must not inherit a stale cross-case current-status value");
  assert.ok(!("petitionVisaType" in state.prefill), "Case B must not inherit Case A's petition visa type");
});

test("a brand-new case's buildCaseQuestionState.prefill still includes person-stable identity fields (name, passport) from the shared beneficiary record", () => {
  const candidates = [];
  CanonicalBuilderService.addMappedObjectCandidates(candidates, "beneficiary", staleBeneficiaryFromCaseA, "beneficiary-1");
  const merged = CanonicalMergeService.merge(candidates);
  CanonicalBuilderService.addRepeatableCollections(merged.profile, { beneficiary: staleBeneficiaryFromCaseA });

  const questions = [
    { _id: "q1", key: "fullName", mapping: { canonicalPath: "person.fullName" } },
    { _id: "q2", key: "passportNumber", mapping: { canonicalPath: "person.passport.number" } },
  ];
  const state = IntelligentQuestionnaireService.buildCaseQuestionState(questions, merged, []);

  assert.ok("fullName" in state.prefill, "person-stable full name should still prefill from the shared beneficiary record");
  assert.ok("passportNumber" in state.prefill, "person-stable passport number should still prefill from the shared beneficiary record");
  assert.equal(state.prefill.passportNumber.value, "X1234567");
});
