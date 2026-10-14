// DB-free content checks of the O-1A employer + employee checklists (exact supplied wording, answer types, canonical targets, optionality).
const assert = require("node:assert/strict");
const test = require("node:test");
const { O1A_CHECKLIST_DEFINITIONS, CRITERIA } = require("../o1aChecklists");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const { O1A_CANONICAL_FIELDS } = require("../../canonical/config/o1aCanonicalPaths");
const Transform = require("../../canonical/services/CanonicalTransformationService");
const PartyAlias = require("../../canonical/services/PartyAliasService");

const [employer, employee] = O1A_CHECKLIST_DEFINITIONS;
const byNo = (definition) => new Map(definition.questions.map((question) => [question.metadata.itemNumber, question]));
const E = byNo(employer);
const B = byNo(employee);

test("registered once for O-1A only; the shared pair and the O-1B pair do not match O-1A", () => {
  assert.equal(EMPLOYMENT_CHECKLIST_DEFINITIONS.filter((d) => /^o1a_/.test(d.key)).length, 2);
  assert.deepEqual(employer.visaTypes, ["O-1A", "O1A"]);
  const shared = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((d) => d.key === "o1_employer_checklist");
  assert.ok(!shared.visaTypes.some((v) => /O-?1A/i.test(v)));
  const o1b = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((d) => d.key === "o1b_employer_checklist");
  assert.ok(!o1b.visaTypes.some((v) => /O-?1A/i.test(v)));
});

test("employer: exact names, types and canonical targets; structured address and job locations", () => {
  assert.equal(employer.questions.length, 19);
  assert.equal(E.get("E1").label, "Company Name:");
  assert.equal(E.get("E2").type, "address");
  assert.equal(E.get("E2").mapping.canonicalPath, "petitioner.company.address");
  assert.equal(E.get("E5").type, "number");
  assert.equal(E.get("E7").type, "currency");
  assert.equal(E.get("E12").type, "email");
  assert.equal(E.get("E13").type, "phone");
  assert.equal(E.get("E14").metadata.format, "url");
  assert.equal(E.get("E16").type, "repeating_group");
  assert.deepEqual(E.get("E16").metadata.repeatableFields.map((f) => f.key), ["address", "unit", "city", "state", "postalCode", "country", "companyOrEndClientName"]);
  assert.equal(E.get("E19").label, "Blank Letterhead in word format");
  assert.equal(E.get("E19").mapping.canonicalPath, "petitioner.company.documents.blankWordLetterhead");
});

test("employee: exact wording, types and conditional follow-ups; outside-USA section", () => {
  assert.equal(B.get("B4").type, "repeating_group");
  assert.equal(B.get("B5").type, "date");
  assert.equal(B.get("B6").type, "select");
  assert.ok(B.get("B6").options.length > 100 && B.get("B6").options.some((o) => o.value === "Canada"));
  assert.equal(B.get("B9").metadata.sensitive, true);
  assert.equal(B.get("B11").label, "Latest prior petition number");
  assert.equal(B.get("B12").label, "SEVIS Number (Student and Exchange Visitor Information System)");
  assert.equal(B.get("B13").label, "Employment Authorization Document EAD Number (If any)");
  assert.equal(B.get("B14").type, "address");
  assert.equal(B.get("B15").sectionKey, B.get("B16").sectionKey);
  assert.notEqual(B.get("B15").sectionKey, B.get("B14").sectionKey, "consulate + foreign address sit in the outside-USA section");
  ["B17", "B18", "B19", "B20", "B21", "B22", "B23"].forEach((no) => assert.equal(B.get(no).type, "boolean", no));
  assert.equal(B.get("B19a").type, "number");
  assert.equal(B.get("B19a").conditionalLogic.rules[0].questionKey, B.get("B19").key, "the count shows only when dependents = Yes");
  assert.equal(B.get("B23a").conditionalLogic.rules[0].questionKey, B.get("B23").key, "the explanation shows only when denial = Yes");
});

test("documents: exact labels and paths, including the resume wording", () => {
  const docs = [
    "Copy of I-94 (Arrival-Departure record)", "Copy of the passport", "Copy of updated resume (We have )", "Copy of SSN, must be signed by bearer (if any)",
    "Copy of US Driver’s license or State Identification card (if any)", "Academic Certificates with transcripts", "Copy of educational credential evaluation report",
    "Copy of the training/diploma certificates", "Copy of any awards, appraisals, achievements or certifications", "Copy of the previous work experience letters",
    "All I-797 (prior notice/receipt of approvals)",
  ];
  docs.forEach((label, i) => { const q = B.get(`D${i + 1}`); assert.equal(q.label, label); assert.equal(q.type, "file"); });
  assert.equal(B.get("D3").mapping.canonicalPath, "beneficiary.documents.updatedResume");
});

test("ten criteria: exact text, one section each, uploads only", () => {
  assert.equal(CRITERIA.length, 10);
  CRITERIA.forEach(([id, label], i) => {
    const q = B.get(`C${i + 1}`);
    assert.equal(q.label, label);
    assert.equal(q.type, "file");
    assert.equal(q.mapping.canonicalPath, `beneficiary.o1aEvidence.${id}`);
    assert.equal(q.sectionKey, `criterion_${i + 1}`);
  });
  assert.match(B.get("C2").label, /\( If you have \)$/);
  assert.match(B.get("C10").label, /\( If any \)$/);
});

test("everything optional; targets present; documents keyed by documentType", () => {
  const registered = new Set(O1A_CANONICAL_FIELDS.map((f) => f.path));
  [employer, employee].forEach((d) => d.questions.forEach((q) => {
    assert.equal(q.required, false, q.key);
    assert.equal(q.metadata.optional, true, q.key);
    assert.ok(q.mapping?.canonicalPath, q.key);
    if (q.type === "file") assert.equal(q.metadata.documentType, q.key);
  }));
  employee.questions.filter((q) => /^beneficiary\.o1aEvidence/.test(q.mapping.canonicalPath)).forEach((q) => assert.ok(registered.has(q.mapping.canonicalPath)));
});

test("Yes/No answers become real booleans on the canonical paths", () => {
  [
    "beneficiary.petitionHasValidPassport", "beneficiary.intendsToReplaceI94", "beneficiary.hasDependents", "beneficiary.anyPersonInRemovalProceedings",
    "beneficiary.employerPreviouslyFiledImmigrantPetition", "beneficiary.hasPreviousO1VisaWithinSevenYears", "beneficiary.hasO1VisaDenialWithinSevenYears",
  ].forEach((path) => {
    assert.equal(Transform.normalizeByPath(path, "Yes"), true, path);
    assert.equal(Transform.normalizeByPath(path, "No"), false, path);
  });
});

test("a structured address answer is flattened to the generic fields without overwriting", () => {
  const profile = PartyAlias.apply({
    beneficiary: { currentUSAddress: { line1: "55 Oak Street", line2: "Apt 4B", city: "Columbus", state: "OH", postalCode: "43004", country: "United States" } },
    petitioner: { company: { address: { line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "United States" } } },
    case: { caseStructure: "employer_employee" },
  });
  assert.deepEqual([profile.beneficiary.address, profile.beneficiary.apartment, profile.beneficiary.city, profile.beneficiary.state, profile.beneficiary.zipCode], ["55 Oak Street", "Apt 4B", "Columbus", "OH", "43004"]);
  assert.deepEqual([profile.petitioner.address.line1, profile.petitioner.address.city, profile.petitioner.address.zip], ["1 Main St", "Austin", "78701"]);
});
