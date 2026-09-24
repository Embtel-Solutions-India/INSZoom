const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const { COS_F2_CHECKLIST_DEFINITIONS } = require("../../questionnaires/cosF2Checklist");
const { getFilingType } = require("../../../config/filingTypes");

// Covers the governing task spec's §37 test matrix (tests 1-10, minus the
// portal-level ones already covered by other suites): VisaFormMapping
// registry shape for COSF2 (no I-129/I-765/I-140/I-485/I-131/I-907), the
// single combined questionnaire's conditional gates (sponsor-inside-USA,
// spouse-relationship marriage certificate), and idempotency of the
// underlying registry data. No live DB connection needed for these checks.

const questionnaire = COS_F2_CHECKLIST_DEFINITIONS[0];
const byKey = new Map(questionnaire.questions.map((q) => [q.key, q]));

// ── Test 1: Basic F-2 COS — registry shape ─────────────────────────────────
test("VisaFormMapping registry: COSF2 has exactly I-539 (AUTO_CREATE) + I-539A (CONDITIONAL supplement), no I-129/I-765/I-140/I-485/I-131/I-907", () => {
  const rows = mappings.filter((m) => m.visaType === "COSF2");
  assert.equal(rows.length, 2, "no duplicate rows from a doubled seed run");
  const i539 = rows.find((m) => m.formNumber === "I-539");
  const i539A = rows.find((m) => m.formNumber === "I-539A");
  assert.ok(i539 && i539A);
  assert.equal(i539.provisioningType, "AUTO_CREATE");
  assert.equal(i539A.provisioningType, "CONDITIONAL", "I-539A must never auto-create merely because I-539 exists");
  const forbidden = ["I-129", "I-765", "I-140", "I-485", "I-131", "I-907"];
  assert.ok(!rows.some((m) => forbidden.includes(m.formNumber)), "COS to F-2 must never pull in unrelated forms");
});

// ── Test 7: Retry / idempotency — registry shape ────────────────────────────
test("VisaFormMapping registry: re-running the seed produces no duplicate COSF2 rows (natural key is visaType+formNumber+componentType)", () => {
  const rows = mappings.filter((m) => m.visaType === "COSF2");
  const seen = new Set();
  rows.forEach((m) => {
    const key = `${m.visaType}|${m.formNumber}|${m.componentType}`;
    assert.ok(!seen.has(key), `duplicate natural key ${key}`);
    seen.add(key);
  });
});

// ── Existing generic "F-2" and other I-539 workflows are untouched ─────────
test("regression: the generic F-2 VisaFormMapping block is unchanged (I-20 ref + DS-160 + I-539, no I-539A, no AUTO_CREATE I-539)", () => {
  const rows = mappings.filter((m) => m.visaType === "F-2");
  assert.equal(rows.length, 3);
  const i539 = rows.find((m) => m.formNumber === "I-539");
  assert.equal(i539.provisioningType, "CONDITIONAL", "the generic F-2 case type's I-539 must stay conditional, unaffected by COSF2's dedicated AUTO_CREATE row");
  assert.ok(!rows.some((m) => m.formNumber === "I-539A"), "generic F-2 never gained an I-539A row");
});

test("regression: H-1B/H-4/other I-539 workflows are unaffected by the COSF2 addition", () => {
  const h1b = mappings.filter((m) => m.visaType === "H-1B");
  assert.ok(h1b.some((m) => m.formNumber === "I-129" && m.provisioningType === "AUTO_CREATE"));
  const h4 = mappings.filter((m) => m.visaType === "H-4");
  assert.equal(h4.filter((m) => m.formNumber === "I-539").length, 1);
  const l2 = mappings.filter((m) => m.visaType === "L-2");
  assert.ok(l2.some((m) => m.formNumber === "I-539A"), "L-2's own I-539A precedent is untouched");
});

// ── Questionnaire shape: one combined questionnaire, not one per role ──────
test("COS_F2 questionnaire: exactly one combined questionnaire, checklistRole is the F-2 applicant (client) only", () => {
  assert.equal(COS_F2_CHECKLIST_DEFINITIONS.length, 1);
  assert.equal(questionnaire.checklistRole, "client");
  assert.equal(questionnaire.visaType, "COSF2");
  assert.equal(questionnaire.key, getFilingType("COS_F2").questionnaireKey);
});

// ── Test 5: Spouse relationship -> marriage certificate conditional ────────
test("marriage certificate document is gated on relationship=Spouse, birth certificate is unconditional", () => {
  const marriageCert = byKey.get("cosf2_doc_marriageCertificate");
  const birthCert = byKey.get("cosf2_doc_birthCertificate");
  assert.ok(marriageCert.conditionalLogic.rules.some((r) => r.questionKey === "client_relationshipToF1Principal" && r.value === "Spouse"));
  assert.equal(birthCert.conditionalLogic.rules.length, 0, "birth certificate must remain unconditionally required per the source checklist");
  assert.equal(birthCert.required, true);
});

// ── Test 6: Child relationship — no extra invented document rules ─────────
test("relationship=Child triggers no invented document rule beyond the source (only the unconditional birth certificate applies)", () => {
  const relationshipQuestion = byKey.get("client_relationshipToF1Principal");
  assert.deepEqual(relationshipQuestion.options.map((o) => o.value), ["Spouse", "Child"]);
  // No document in the questionnaire is gated specifically on relationship=Child —
  // confirms no fabricated child-only document rule was added beyond the source.
  const childGatedDocs = questionnaire.questions.filter((q) =>
    q.type === "file" && q.conditionalLogic.rules.some((r) => r.questionKey === "client_relationshipToF1Principal" && r.value === "Child")
  );
  assert.equal(childGatedDocs.length, 0);
});

// ── Test 3 & 4: Sponsor inside/outside USA — conditional document block ───
test("sponsor-inside-USA conditional documents (Test 4): all 5 extra documents gated on client_sponsorInsideUsa=Yes", () => {
  const conditionalDocKeys = [
    "cosf2_doc_sponsorProofOfUsStatus",
    "cosf2_doc_sponsorPassport",
    "cosf2_doc_sponsorDriversLicense",
    "cosf2_doc_sponsorSsnCard",
    "cosf2_doc_sponsorW2",
  ];
  conditionalDocKeys.forEach((key) => {
    const q = byKey.get(key);
    assert.ok(q, `${key} must exist`);
    assert.ok(
      q.conditionalLogic.rules.some((r) => r.questionKey === "client_sponsorInsideUsa" && r.value === "Yes"),
      `${key} must be gated on sponsor being inside the USA`
    );
  });
});

test("sponsor-outside-USA (Test 3): base sponsor documents (tax returns, paystubs, bank statements) are NOT conditional", () => {
  const baseDocKeys = ["cosf2_doc_sponsorTaxReturns", "cosf2_doc_sponsorPaystubs3Months", "cosf2_doc_sponsorBankStatements3Months"];
  baseDocKeys.forEach((key) => {
    const q = byKey.get(key);
    assert.ok(q, `${key} must exist`);
    assert.equal(q.conditionalLogic.rules.length, 0, `${key} must always be requested regardless of sponsor location`);
    assert.equal(q.required, true);
  });
});

// ── Conditional items are never forced mandatory (task §33) ───────────────
test("conditional 'if any' documents (I-797 notices, EAD, SSN, driver's license) are never marked required", () => {
  const conditionalIfAnyKeys = [
    "cosf2_doc_approvalNotices",
    "cosf2_doc_f1PrincipalApprovalNotices",
    "cosf2_doc_f1PrincipalEad",
    "cosf2_doc_f1PrincipalSsn",
    "cosf2_doc_f1PrincipalDriversLicense",
  ];
  conditionalIfAnyKeys.forEach((key) => {
    const q = byKey.get(key);
    assert.equal(q.required, false, `${key} ("if any" in the source) must stay optional`);
  });
});

// ── Canonical/no-duplication rules (task §25) ──────────────────────────────
test("F-2 applicant identity fields reuse the same canonicalPath convention as h4Checklist.js (no duplicate canonical namespace invented)", () => {
  assert.equal(byKey.get("client_familyName").mapping.canonicalPath, "applicant.lastName");
  assert.equal(byKey.get("client_givenName").mapping.canonicalPath, "applicant.firstName");
  assert.equal(byKey.get("client_dateOfBirth").mapping.canonicalPath, "applicant.dateOfBirth");
  assert.equal(byKey.get("client_passportNumber").mapping.canonicalPath, "applicant.passportNumber");
});

test("sponsor and F-1 principal fields are NOT mapped onto the F-2 applicant's own canonical namespace (distinct person's data)", () => {
  const sponsorFieldKeys = ["client_sponsorFamilyName", "client_sponsorGivenName", "client_sponsorDateOfBirth", "client_sponsorSsn"];
  sponsorFieldKeys.forEach((key) => {
    const q = byKey.get(key);
    assert.ok(!q.mapping, `${key} must not be mapped onto the applicant's own canonical path`);
  });
});
