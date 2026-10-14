const assert = require("node:assert/strict");
const test = require("node:test");
const { EB1C_CHECKLIST_DEFINITIONS: [employer, employee] } = require("../eb1cChecklists");
const { isQuestionVisible, validateResponse, validateQuestionValue } = require("../questionnaire.service");
const registry = require("../../employment-workflow/questionnaires/registry");
const CanonicalFieldRegistryService = require("../../form-mapping/services/CanonicalFieldRegistryService");
const { getCaseStructure } = require("../../../config/visaCategories");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const { ENTRIES } = require("../../form-registry/seeds/checklistMappings.seed");

// EB-1C employer + employee checklists. DB-free; the end-to-end behaviour is in eb1c-e2e.test.js.
const all = [...employer.questions, ...employee.questions];
const byKey = new Map(all.map((q) => [q.key, q]));
const visible = (def, answers) => new Set(def.questions.filter((q) => isQuestionVisible(q, answers, { role: "client" })).map((q) => q.key));

test("two templates, employer / employee roles, titled as specified; EB-1C is an employer_employee case", () => {
  assert.equal(employer.title, "EB-1C Employer/Petitioner Checklist");
  assert.equal(employee.title, "EB-1C Employee/Beneficiary Checklist");
  assert.deepEqual([employer.checklistRole, employee.checklistRole], ["employer", "employee"]);
  assert.equal(getCaseStructure("EB-1C"), "employer_employee");
  assert.ok(registry.getDefinition("EB-1C") && registry.getDefinition("EB-1C").key === "eb1c");
});

test("all 43 numbered requirements are present exactly once, with their exact labels", () => {
  const numbers = all.map((q) => q.metadata.itemNumber).filter(Boolean);
  const distinct = new Set(numbers.map((n) => String(n).replace(/[ab]$/, "")));
  assert.deepEqual([...distinct].map(Number).sort((a, b) => a - b), Array.from({ length: 43 }, (_, i) => i + 1));
  const label = (key) => byKey.get(key).label;
  assert.equal(label("eb1c_us_articles_of_incorporation"), "Articles of Incorporation");
  assert.equal(label("eb1c_us_premises_photographs"), "Photographs of business premises (inside and outside – showing company name, logo, address, and staff at work)");
  assert.equal(label("eb1c_qualifying_us_entity_board_resolution"), "Board Resolution approving establishment of U.S. entity.");
  assert.equal(label("eb1c_beneficiary_i94"), "I-94 of beneficiary.");
  assert.equal(label("eb1c_spouse_marriage_certificate"), "Marriage Certificate (if applicable).");
  assert.equal(employer.questions.filter((q) => q.type === "file").length, 29);
  assert.equal(employee.questions.filter((q) => q.type === "file" && !/spouse|child/.test(q.key)).length, 10);
});

test("required follows the platform convention (requirementLogic.js): passport, essential documents and gating answers are required, everything else stays optional", () => {
  const { isPassportInformation } = require("../passportInformation");
  // a question is EITHER required (and then not flagged optional, so it really blocks Submit) OR optional (flagged, never blocks)
  all.forEach((q) => {
    if (q.required) assert.notEqual(q.metadata.optional, true, `${q.key}: a required question must not carry the optional flag`);
    else assert.equal(q.metadata.optional, true, `${q.key}: not required, so optional`);
    if (isPassportInformation(q)) assert.equal(q.required, true, `${q.key}: passport information is always required`);
  });
  const requiredKeys = all.filter((q) => q.required).map((q) => q.key);
  assert.ok(requiredKeys.includes("eb1c_beneficiary_i94") && requiredKeys.includes("eb1c_beneficiary_passport"), "the beneficiary's I-94 and passport are required");
  assert.ok(all.some((q) => !q.required), "supporting evidence stays optional");
});

test("canonical targets: the supplied paths, all registered; website URLs are validated URLs, not a replacement for the upload", () => {
  const registered = new Set(CanonicalFieldRegistryService.list({}).map((f) => f.path));
  all.forEach((q) => assert.ok(registered.has(q.mapping.canonicalPath), `${q.mapping.canonicalPath} registered`));
  assert.equal(byKey.get("eb1c_us_articles_of_incorporation").mapping.canonicalPath, "petitioner.usCompany.documents.articlesOfIncorporation");
  assert.equal(byKey.get("eb1c_foreign_letterhead_word").mapping.canonicalPath, "petitioner.foreignCompany.documents.letterheadWordFile");
  assert.equal(byKey.get("eb1c_beneficiary_passport").mapping.canonicalPath, "beneficiary.immigration.passportAllPages");
  assert.equal(byKey.get("eb1c_child_2_birth_certificate").mapping.canonicalPath, "beneficiary.family.children[1].documents.birthCertificate");
  const url = byKey.get("eb1c_us_website_url");
  assert.equal(url.mapping.canonicalPath, "petitioner.usCompany.websiteUrl");
  assert.equal(validateQuestionValue(url, "https://www.example.com").errors.length, 0);
  assert.equal(validateQuestionValue(url, "not a url").errors.length, 1);
  assert.equal(byKey.get("eb1c_us_website_screenshots").type, "file", "the screenshot upload remains");
  assert.equal(byKey.get("eb1c_us_website_screenshots").metadata.groupId, url.metadata.groupId);
});

test("family documents appear only when the optional answers say so; each child has its own uploads; unanswered = unknown", () => {
  const base = visible(employee, {});
  assert.ok(![...base].some((k) => /spouse_|child_/.test(k.replace("eb1c_has_", ""))), "nothing family-related is shown while unanswered");
  const some = visible(employee, { eb1c_has_spouse: "Yes", eb1c_has_children: "Yes", eb1c_child_count: 2 });
  ["eb1c_spouse_passport", "eb1c_child_1_passport", "eb1c_child_2_passport", "eb1c_child_2_i94"].forEach((k) => assert.ok(some.has(k), k));
  assert.ok(!some.has("eb1c_child_3_passport"));
  assert.ok(!visible(employee, { eb1c_has_spouse: "No" }).has("eb1c_spouse_passport"));
  assert.notEqual(byKey.get("eb1c_child_1_passport").mapping.canonicalPath, byKey.get("eb1c_child_2_passport").mapping.canonicalPath);
});

test("duty percentages: optional, 0-100, and the four must add up to 100 only when all four are given", () => {
  const keys = ["eb1c_duties_managing_function_pct", "eb1c_duties_supervision_pct", "eb1c_duties_personnel_authority_pct", "eb1c_duties_operational_discretion_pct"];
  assert.equal(validateQuestionValue(byKey.get(keys[0]), 101).errors.length, 1);
  const run = (answers) => validateResponse({ _id: "q", key: employee.key, version: 1 }, employee.questions, answers, { role: "client" });
  assert.equal(run({}).valid, true, "blank is fine");
  assert.equal(run({ [keys[0]]: 40, [keys[1]]: 30 }).valid, true, "a partial set is never judged");
  assert.equal(run({ [keys[0]]: 40, [keys[1]]: 30, [keys[2]]: 20, [keys[3]]: 10 }).valid, true);
  const bad = run({ [keys[0]]: 40, [keys[1]]: 30, [keys[2]]: 20, [keys[3]]: 20 });
  assert.equal(bad.valid, false);
  assert.match(bad.errors[0].message, /add up to 100/);
  assert.equal(byKey.get("eb1c_beneficiary_duties_evidence").type, "file", "item 29's upload stays the primary answer");
});

test("registry: I-140 is the auto form for both checklists; I-485 / I-765 / I-131 / I-693 / I-907 / G-28 stay conditional; no I-864", () => {
  const rows = mappings.filter((m) => m.visaType === "EB-1C");
  assert.equal(rows.find((m) => m.formNumber === "I-140").provisioningType, "AUTO_CREATE");
  ["I-485", "I-765", "I-131", "I-693", "I-907", "G-28"].forEach((f) => assert.equal(rows.find((m) => m.formNumber === f).provisioningType, "CONDITIONAL", f));
  assert.ok(!rows.some((m) => m.formNumber === "I-864"));
  const i140 = ENTRIES.find((e) => e.visaType === "EB-1C" && e.formNumber === "I-140");
  assert.deepEqual(i140.checklistMappings.map((c) => [c.checklistKey, c.role]), [["eb1c_employer_checklist", "employer"], ["eb1c_employee_checklist", "employee"]]);
});
