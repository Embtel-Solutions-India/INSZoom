// Regression test for the Phase 3A fix: h4_ead_questionnaire used to map
// its "Information about You"/"Last Arrival in USA" fields to an invented
// "applicant.*" canonicalPath namespace that CanonicalBuilderService.
// addQuestionnaireCandidates never translates (it consumes
// question.mapping.canonicalPath verbatim) - so those fields silently
// mapped nothing. This asserts no question in h4_ead_questionnaire ever
// carries a canonicalPath outside the real registry again, and that the
// specific fields fixed in Phase 3A resolve to the same paths the sibling
// H-4 questionnaires (already fixed in Phase 2) use.
const assert = require("node:assert/strict");
const test = require("node:test");

const h4Checklist = require("../h4Checklist");
const CanonicalFieldRegistryService = require("../../form-mapping/services/CanonicalFieldRegistryService");

function buildEad() {
  const definition = h4Checklist.H4_CHECKLIST_DEFINITIONS.find((d) => d.key === "h4_ead_questionnaire");
  assert.ok(definition, "h4_ead_questionnaire must be present in H4_CHECKLIST_DEFINITIONS");
  return definition;
}

test("h4_ead_questionnaire: no question maps to the invented applicant.* namespace", () => {
  const questionnaire = buildEad();
  const offenders = questionnaire.questions.filter((q) => q.mapping?.canonicalPath?.startsWith("applicant."));
  assert.deepEqual(offenders.map((q) => q.key), [], "no question should map to applicant.* anymore");
});

test("h4_ead_questionnaire: every mapped canonicalPath resolves to a real CanonicalFieldRegistryService.BASE_FIELDS entry", () => {
  const questionnaire = buildEad();
  const knownPaths = new Set(CanonicalFieldRegistryService.list().map((f) => f.path));
  const mapped = questionnaire.questions.filter((q) => q.mapping?.canonicalPath);
  assert.ok(mapped.length > 0, "sanity: some questions should still be mapped");
  mapped.forEach((q) => {
    assert.ok(knownPaths.has(q.mapping.canonicalPath), `${q.key} -> "${q.mapping.canonicalPath}" is not a real canonical field`);
  });
});

test("h4_ead_questionnaire: the specific Phase 3A fields resolve to the same paths as the fixed sibling H-4 questionnaires", () => {
  const questionnaire = buildEad();
  const byKey = new Map(questionnaire.questions.map((q) => [q.key, q]));
  const expected = {
    client_familyName: "person.lastName",
    client_givenName: "person.firstName",
    client_middleName: "person.middleName",
    client_gender: "person.gender",
    client_dateOfBirth: "person.dob",
    client_aNumber: "person.alienNumber",
    client_usMailingAddress: "contact.address.line1",
    client_i94Number: "immigration.i94.number",
    client_passportNumber: "person.passport.number",
    client_countryOfPassportIssuance: "person.passport.country",
    client_passportExpirationDate: "person.passport.expirationDate",
    client_currentNonimmigrantStatus: "immigration.currentStatus",
  };
  Object.entries(expected).forEach(([key, canonicalPath]) => {
    assert.equal(byKey.get(key)?.mapping?.canonicalPath, canonicalPath, `${key} should map to ${canonicalPath}`);
  });
});
