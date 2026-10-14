// DB-free content checks of the O-1B employer + employee checklists (exact supplied wording, canonical targets, everything optional).
const assert = require("node:assert/strict");
const test = require("node:test");
const { O1B_CHECKLIST_DEFINITIONS, CRITERIA } = require("../o1bChecklists");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const { O1B_CANONICAL_FIELDS } = require("../../canonical/config/o1bCanonicalPaths");

const [employer, employee] = O1B_CHECKLIST_DEFINITIONS;
const byNo = (definition) => new Map(definition.questions.map((question) => [question.metadata.itemNumber, question]));

test("both checklists are registered once, for O-1B only", () => {
  assert.equal(employer.key, "o1b_employer_checklist");
  assert.equal(employee.key, "o1b_employee_checklist");
  assert.equal(EMPLOYMENT_CHECKLIST_DEFINITIONS.filter((d) => /^o1b_/.test(d.key)).length, 2);
  const shared = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((d) => d.key === "o1_employer_checklist");
  assert.ok(!shared.visaTypes.some((v) => /O-?1B/i.test(v)), "the shared O-1 pair no longer matches O-1B (no case gets both versions)");
  assert.ok(!shared.visaTypes.some((v) => /O-?1A/i.test(v)), "O-1A has its own dedicated pair too");
  assert.ok(employer.visaTypes.includes("O-1B") && employer.visaTypes.includes("O1B"));
});

test("employer questions E1-E19 exist with the exact names, types and targets", () => {
  const q = byNo(employer);
  assert.equal(employer.questions.length, 19);
  const expect = {
    E1: ["Company Name:", "text"], E2: ["Company Address (complete address):", "textarea"], E3: ["Federal Employer Identification Number (FEIN):", "text"],
    E4: ["Type of Business:", "text"], E5: ["Year Established:", "number"], E6: ["Total number of employees:", "number"],
    E7: ["Gross annual income of the company:", "currency"], E8: ["Net annual income of the company:", "currency"],
    E9: ["First name of signing person:", "text"], E10: ["Last name of signing person:", "text"], E11: ["Designation/ Title of the signing person:", "text"],
    E12: ["Email of the signing person:", "email"], E13: ["Mobile Phone Number of the signing person:", "phone"], E14: ["Website Link:", "text"],
    E15: ["Salary as per offer letter:", "currency"], E17: ["Copy of Article of Incorporation", "file"], E18: ["Copy of Business License", "file"], E19: ["Blank Letterhead in word", "file"],
  };
  for (const [no, [label, type]] of Object.entries(expect)) { assert.equal(q.get(no).label, label, no); assert.equal(q.get(no).type, type, no); }
  assert.equal(q.get("E16").type, "repeating_group");
  assert.deepEqual(q.get("E16").metadata.repeatableFields.map((f) => f.key), ["address", "companyOrEndClientName"]);
  assert.equal(q.get("E14").metadata.format, "url");
});

test("employee questions B1-B30 and the six criteria use the exact supplied text", () => {
  const q = byNo(employee);
  assert.equal(employee.questions.length, 37, "30 + the B20 follow-up + 6 criteria");
  assert.equal(q.get("B5").label, "Date of birth (mm/dd/yyyy):");
  assert.equal(q.get("B5").type, "date");
  ["B14", "B15", "B17", "B18", "B19", "B20"].forEach((no) => assert.equal(q.get(no).type, "boolean", no));
  assert.equal(q.get("B16").type, "repeating_group");
  assert.deepEqual(q.get("B16").metadata.repeatableFields.map((f) => f.key), ["fullName", "relationship", "dateOfBirth", "countryOfCitizenship"]);
  assert.equal(q.get("B20a").label, "If Yes, please explain.");
  assert.equal(q.get("B20a").conditionalLogic.rules[0].questionKey, q.get("B20").key);
  for (let i = 21; i <= 30; i += 1) assert.equal(q.get(`B${i}`).type, "file", `B${i}`);
  assert.equal(CRITERIA.length, 6);
  CRITERIA.forEach(([id, label], index) => {
    const question = q.get(`C${index + 1}`);
    assert.equal(question.label, label);
    assert.equal(question.type, "file");
    assert.equal(question.mapping.canonicalPath, `beneficiary.o1bEvidence.${id}`);
  });
  assert.match(q.get("C5").label, /author's authority, expertise, and knowledge/);
});

test("every question and upload is optional and carries a canonical target; new paths are registered", () => {
  const registered = new Set(O1B_CANONICAL_FIELDS.map((f) => f.path));
  const shared = new Set(["company.name", "company.ein", "company.industry", "person.firstName", "person.lastName", "person.dob", "contact.address.formatted"]);
  [employer, employee].forEach((definition) => definition.questions.forEach((question) => {
    assert.equal(question.required, false, question.key);
    assert.equal(question.metadata.optional, true, question.key);
    assert.ok(question.mapping?.canonicalPath, `${question.key} has a canonical path`);
  }));
  employee.questions.filter((x) => /^beneficiary\.(documents|o1bEvidence)/.test(x.mapping.canonicalPath)).forEach((x) => assert.ok(registered.has(x.mapping.canonicalPath), x.mapping.canonicalPath));
  assert.ok(shared.size);
});

test("document questions keep documentType == key and are attachments, never scalar values", () => {
  [...employer.questions, ...employee.questions].filter((x) => x.type === "file").forEach((x) => assert.equal(x.metadata.documentType, x.key));
});
