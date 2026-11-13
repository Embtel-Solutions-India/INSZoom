// A subtype's own checklist is assigned only to a case of that subtype (Indian Timeline types). DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../immigration-knowledge-engine.service");
const filingTypes = require("../../../config/filingTypes");

const applies = (key, petitionSubType) => Engine.subtypeChecklistApplies({ key }, { visaType: "OCI", petitionSubType });

test("an OCI case gets only its own subtype's checklist, never another OCI subtype's", () => {
  const oci = filingTypes.listFilingTypes().filter((type) => type.visaType === "OCI" && type.questionnaireKey);
  assert.ok(oci.length >= 5);
  for (const own of oci) {
    for (const other of oci) assert.equal(applies(other.questionnaireKey, own.key), other.key === own.key, `${other.key} on a ${own.key} case`);
  }
});

test("a case with no (or an unknown) subtype gets none of the subtype checklists; other checklists are untouched", () => {
  const ociKey = filingTypes.getFilingType("OCI_MINOR_FOREIGN_CITIZEN_HELD").questionnaireKey;
  assert.equal(applies(ociKey, undefined), false);
  assert.equal(applies(ociKey, "NOT_A_SUBTYPE"), false);
  assert.equal(applies("h1b_employer_checklist", undefined), true);
  assert.equal(applies("l1a_document_checklist", "OCI_MINOR_FOREIGN_CITIZEN_HELD"), true);
});

test("the E-Tourist Visa and US Passport Minor checklists follow the same rule", () => {
  const eTourist = filingTypes.getFilingType("INDIAN_ETOURIST_SUBTYPE_2").questionnaireKey;
  const business = filingTypes.getFilingType("INDIAN_ETOURIST_BUSINESS").questionnaireKey;
  assert.equal(Engine.subtypeChecklistApplies({ key: eTourist }, { petitionSubType: "INDIAN_ETOURIST_SUBTYPE_2" }), true);
  assert.equal(Engine.subtypeChecklistApplies({ key: business }, { petitionSubType: "INDIAN_ETOURIST_SUBTYPE_2" }), false);
});

test("a subtype's own checklist is self-contained: its documents are never also added to the case's separate document list", () => {
  const ociKey = filingTypes.getFilingType("OCI_MINOR_FOREIGN_CITIZEN_HELD").questionnaireKey;
  const ids = Engine.selfContainedQuestionnaireIds([{ _id: "a", key: ociKey }, { _id: "b", key: "h1b_employee_checklist" }]);
  assert.deepEqual([...ids], ["a"]);
});
