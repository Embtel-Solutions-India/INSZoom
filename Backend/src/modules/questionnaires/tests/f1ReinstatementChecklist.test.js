const test = require("node:test");
const assert = require("node:assert/strict");
const { F1_REINSTATEMENT_CHECKLIST_DEFINITIONS } = require("../f1ReinstatementChecklist");
const { getCaseStructure, VISA_CATEGORIES } = require("../../../config/visaCategories");
const { categoryForVisa } = require("../../../integrations/ghl/ghlAuxOutbound");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");

const [def] = F1_REINSTATEMENT_CHECKLIST_DEFINITIONS;

test("F-1 Reinstatement is a registered single-party case type with its exact name", () => {
  assert.equal(getCaseStructure("F1REINSTATEMENT"), "single");
  assert.equal(VISA_CATEGORIES.F1REINSTATEMENT.label, "F-1 Reinstatement");
  assert.equal(def.title, "F-1 Reinstatement");
  assert.equal(def.visaType, "F1REINSTATEMENT");
  assert.equal(def.checklistRole, "client");
  assert.equal(def.isDefault, true);
});

test("every question and upload is optional and nothing is pre-filled or pre-selected", () => {
  assert.ok(def.questions.length > 0);
  def.questions.forEach((question) => {
    assert.equal(question.required, false, `${question.key} must be optional`);
    assert.ok(!(question.metadata && "defaultValue" in question.metadata), `${question.key} must not carry a default answer`);
  });
  const text = JSON.stringify(def);
  ["Dhaka", "1230"].forEach((example) => assert.ok(!text.includes(example), `no legacy example value ${example}`));
  // a country is only ever an option in the list, never a pre-selected answer
  def.questions.forEach((question) => assert.ok(!("value" in question) && !("defaultValue" in question) && !("answer" in question), `${question.key} carries no answer`));
});

test("keeps the supplied sections, application-type options and conditional change-of-status fields", () => {
  assert.deepEqual(def.sections, [
    "Applicant Information", "Most Recent Entry into the USA", "Physical Address Outside the USA", "Application Type",
    "Information About the Sponsor", "Employment & Financial Information (If Any)", "Documents required from applicant",
    "Documents required from sponsor", "Reinstatement Letter Questionnaire",
  ]);
  const appType = def.questions.find((question) => question.key === "client_applicationType");
  assert.equal(appType.type, "radio");
  assert.deepEqual(appType.options.map((option) => option.value), ["Reinstatement to student status", "An extension of stay in my current status", "Change of status"]);
  ["client_changeOfStatusNewStatus", "client_changeOfStatusEffectiveDate", "client_changeOfStatusRequested"].forEach((key) => {
    const question = def.questions.find((item) => item.key === key);
    assert.deepEqual(question.conditionalLogic.rules, [{ questionKey: "client_applicationType", operator: "equals", value: "Change of status" }]);
  });
});

test("sponsor answers stay out of the applicant's canonical namespace; the new I-20 is an upload, not a form", () => {
  def.questions.filter((question) => question.key.startsWith("client_sponsor")).forEach((question) => assert.equal(question.mapping, undefined));
  const newI20 = def.questions.find((question) => question.key === "f1reinst_doc_newI20");
  assert.equal(newI20.type, "file");
});

test("Form I-539 is the one automatically-created USCIS form; I-765, I-20 and DS forms are not attached", () => {
  const rows = mappings.filter((row) => row.visaType === "F1REINSTATEMENT");
  const formNumbers = rows.map((row) => row.formNumber).sort();
  assert.deepEqual(formNumbers, ["G-28", "I-539", "I-539A", "I-907"]);
  assert.ok(!formNumbers.includes("I-765") && !formNumbers.includes("I-20"));
});

test("F-1 Reinstatement is a non-immigrant case; green-card categories stay immigrant", () => {
  assert.equal(categoryForVisa("F1REINSTATEMENT", "", []), "non_immigrant");
  assert.equal(categoryForVisa("IR-1", "", []), "immigrant");
  assert.equal(categoryForVisa("F2A", "", []), "immigrant");
  assert.equal(categoryForVisa("H-1B", "", []), "non_immigrant");
});
