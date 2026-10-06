// Form I-907 Information Checklist: definition, conditional logic, case-type wiring and the
// I-907 crosswalk's contract with it. Pure tests - no database.
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPremiumProcessingChecklist, PART1_QUESTIONS, PART2_QUESTIONS, questionKeyForPath } = require("../premiumProcessingChecklist");
const { evaluateConditionGroup } = require("../condition-evaluator");
const { MAPPED_EDGES, classifyField } = require("../../form-mapping/config/i907-crosswalk");
const visaCategories = require("../../../config/visaCategories");
const registrySeed = require("../../form-registry/seeds/visaFormMappings.seed");
const checklistSeed = require("../../form-registry/seeds/checklistMappings.seed");

const checklist = buildPremiumProcessingChecklist();
const byPath = (path) => checklist.questions.find((question) => question.metadata.sourcePath === path);
const visible = (path, answers) => evaluateConditionGroup(byPath(path).conditionalLogic, answers);

test("Premium Processing is a single-party case type whose only form is I-907", () => {
  assert.equal(visaCategories.getCaseStructure("Premium Processing"), "single");
  assert.deepEqual(visaCategories.getFormIds("Premium Processing"), ["i-907"]);
});

test("the checklist is the case's default 'client' checklist and keeps the existing Questionnaire key", () => {
  assert.equal(checklist.key, "i907_premium_processing_profile");
  assert.equal(checklist.checklistRole, "client");
  assert.equal(checklist.isDefault, true);
  assert.deepEqual(checklist.visaTypes, ["PremiumProcessing"]);
  assert.equal(checklist.reconcileMetadata, true);
  assert.deepEqual(checklist.sections, ["Information About the Person Filing This Request", "Information About the Request"]);
});

test("question keys are unique and follow the approved field paths", () => {
  const keys = checklist.questions.map((question) => question.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(PART1_QUESTIONS.length + PART2_QUESTIONS.length, 32);
  assert.equal(questionKeyForPath("i907.filer.last_name"), "i907_filer_last_name");
  assert.ok(keys.includes("i907_company_ein") && keys.includes("i907_address_same_as_physical"));
});

test("required / conditional flags follow the approved table", () => {
  const required = (path) => byPath(path).required;
  ["i907.filer.last_name", "i907.filer.first_name", "i907.mailing_address.street", "i907.mailing_address.city",
    "i907.mailing_address.country", "i907.address.same_as_physical", "i907.related_case.form_number",
    "i907.related_case.receipt_number", "i907.petitioner.last_name", "i907.petitioner.first_name",
    "i907.beneficiary.last_name", "i907.beneficiary.first_name"].forEach((path) => assert.equal(required(path), true, path));
  ["i907.filer.alien_registration_number", "i907.filer.uscis_online_account_number", "i907.mailing_address.unit",
    "i907.physical_address.unit", "i907.related_case.company_name"].forEach((path) => assert.equal(required(path), false, path));
});

test("mailing state/ZIP only for a U.S. address; province/postal only for a non-U.S. address", () => {
  const us = { i907_mailing_address_country: "United States" };
  const india = { i907_mailing_address_country: "India" };
  assert.equal(visible("i907.mailing_address.state", us), true);
  assert.equal(visible("i907.mailing_address.zip_code", us), true);
  assert.equal(visible("i907.mailing_address.province", us), false);
  assert.equal(visible("i907.mailing_address.state", india), false);
  assert.equal(visible("i907.mailing_address.province", india), true);
  assert.equal(visible("i907.mailing_address.postal_code", india), true);
  assert.equal(visible("i907.mailing_address.province", {}), false, "nothing until a country is chosen");
});

test("physical address appears only when it differs from the mailing address", () => {
  assert.equal(visible("i907.physical_address.street", { i907_address_same_as_physical: "Yes" }), false);
  assert.equal(visible("i907.physical_address.street", {}), false);
  assert.equal(visible("i907.physical_address.street", { i907_address_same_as_physical: "No" }), true);
  assert.equal(visible("i907.physical_address.state", { i907_address_same_as_physical: "No", i907_physical_address_country: "United States" }), true);
  assert.equal(visible("i907.physical_address.state", { i907_address_same_as_physical: "No", i907_physical_address_country: "India" }), false);
  assert.equal(visible("i907.physical_address.province", { i907_address_same_as_physical: "No", i907_physical_address_country: "India" }), true);
});

test("point of contact and EIN apply only when a company/organization is named", () => {
  ["i907.company_poc.last_name", "i907.company_poc.first_name", "i907.company_poc.position_title", "i907.company.ein"].forEach((path) => {
    assert.equal(visible(path, {}), false, path);
    assert.equal(visible(path, { i907_related_case_company_name: "Acme Inc" }), true, path);
  });
});

test("every I-907 crosswalk source key exists in the checklist; no two edges share a PDF field", () => {
  const keys = new Set(checklist.questions.map((question) => question.key));
  for (const edge of MAPPED_EDGES.filter((item) => item.source !== "case.visaType")) {
    const match = /^raw\.questionnaireAnswers\.(.+)\.value$/.exec(edge.source);
    assert.ok(match, `${edge.fieldName}: source must be a questionnaire answer`);
    assert.ok(keys.has(match[1]), `${edge.fieldName}: unknown checklist key ${match[1]}`);
  }
  assert.equal(new Set(MAPPED_EDGES.map((edge) => edge.fieldName)).size, MAPPED_EDGES.length);
  // every checklist question that has a form destination is mapped at least once
  const mappedKeys = new Set(MAPPED_EDGES.map((edge) => /Answers.(.+).value$/.exec(edge.source)?.[1]));
  const unmapped = [...keys].filter((key) => !mappedKeys.has(key));
  assert.deepEqual(unmapped, [], "every checklist answer lands on the I-907");
});

test("classifyField buckets: barcode is USCIS-only, mapped field is mapped, middle name stays manual", () => {
  assert.equal(classifyField({ fieldName: "form1[0].#pageSet[0].Page1[0].PDF417BarCode1[0]" }).status, "uscis_use_only");
  assert.equal(classifyField({ fieldName: "form1[0].#subform[0].Pt1Line3_FamilyName[0]" }).status, "mapped");
  assert.equal(classifyField({ fieldName: "form1[0].#subform[0].Pt1Line3_MiddleName[0]" }).status, "manual_entry");
});

test("registry: Premium Processing I-907 is AUTO on its own case type; every other I-907 row stays CONDITIONAL", () => {
  const { mappings } = registrySeed;
  const own = mappings.find((row) => row.visaType === "Premium Processing" && row.formNumber === "I-907");
  assert.equal(own.provisioningType, "AUTO_CREATE");
  assert.equal(own.initialCaseCreation, true);
  const others = mappings.filter((row) => row.formNumber === "I-907" && row.visaType !== "Premium Processing");
  assert.ok(others.length > 10);
  assert.ok(others.every((row) => row.provisioningType === "CONDITIONAL"));
  assert.deepEqual(mappings.filter((row) => row.visaType === "PERM"), [], "PERM has no registry rows at all");
});

test("checklist registry: Premium Processing is mapped; other I-907 rows only offer it explicitly", () => {
  const find = (visaType, formNumber) => checklistSeed.ENTRIES.find((entry) => entry.visaType === visaType && entry.formNumber === formNumber);
  assert.deepEqual(find("Premium Processing", "I-907").checklistMappings.map((m) => [m.checklistKey, m.assignmentType]), [["i907_premium_processing_profile", "AUTO"]]);
  const h1b = find("H-1B", "I-907").checklistMappings;
  const added = h1b.find((m) => m.checklistKey === "i907_premium_processing_profile");
  assert.equal(added.assignmentType, "EXPLICIT_CM", "never auto-assigned to an ordinary case");
  assert.ok(h1b.some((m) => m.checklistKey === "h1b_employer_checklist"), "existing mappings are kept");
});
