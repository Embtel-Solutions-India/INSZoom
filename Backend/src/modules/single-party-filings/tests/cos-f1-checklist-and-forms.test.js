const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const { COS_F1_CHECKLIST_DEFINITIONS } = require("../../questionnaires/cosF1Checklist");
const { resolveTransitionFilingType, getFilingType } = require("../../../config/filingTypes");

// Covers the pasted COS-to-F-1 task's acceptance list: B-2/H-1B/H-4/L-1A/F-2
// -> F-1 all resolve to the SAME COS_TO_F1 checklist and VisaFormMapping,
// current/requested status are captured correctly, no I-765 is ever
// attached, I-20/SEVIS receipt stay client documents (never CaseForms), and
// no three-party structure is created. No live DB connection needed.

const questionnaire = COS_F1_CHECKLIST_DEFINITIONS[0];
const byKey = new Map(questionnaire.questions.map((q) => [q.key, q]));

const SOURCE_STATUSES = ["B-2", "H-1B", "H-4", "L-1A", "F-2"];

// ── Dynamic current status: every listed source resolves to COS_F1 ────────
test("every acceptance-list source status -> F-1 resolves to COS_F1 with cos_f1_questionnaire content", () => {
  SOURCE_STATUSES.forEach((fromStatus) => {
    const resolved = resolveTransitionFilingType(fromStatus, "F-1");
    assert.equal(resolved.key, "COS_F1", `${fromStatus} -> F-1`);
    assert.equal(resolved.questionnaireKey, "cos_f1_questionnaire");
    assert.equal(resolved.visaType, "COSF1");
  });
});

test("COS_F1 filing type itself accepts any current status (fromStatus: null)", () => {
  const cosF1 = getFilingType("COS_F1");
  assert.equal(cosF1.fromStatus, null);
  assert.equal(cosF1.toStatus, "F-1");
});

// ── VisaFormMapping: I-539 required, I-539A/I-907/G-28 conditional, no I-765 ─
test("VisaFormMapping registry: COSF1 has I-539 (AUTO_CREATE) + I-539A/I-907/G-28 (CONDITIONAL), no I-765/I-129/I-140/I-485/DS-160", () => {
  const rows = mappings.filter((m) => m.visaType === "COSF1");
  assert.equal(rows.length, 4, "no duplicate rows from a doubled seed run");
  const byForm = Object.fromEntries(rows.map((m) => [m.formNumber, m]));
  assert.equal(byForm["I-539"].provisioningType, "AUTO_CREATE");
  assert.equal(byForm["I-539A"].provisioningType, "CONDITIONAL");
  assert.equal(byForm["I-907"].provisioningType, "CONDITIONAL");
  assert.equal(byForm["G-28"].provisioningType, "CONDITIONAL");
  const forbidden = ["I-765", "I-129", "I-140", "I-485", "DS-160"];
  assert.ok(!rows.some((m) => forbidden.includes(m.formNumber)), "COS to F-1 must never auto-attach OPT/CPT (I-765) or unrelated forms");
});

test("regression: the generic F-1 VisaFormMapping block (I-20 ref + DS-160 + I-539 + I-765 for OPT/CPT) is unchanged", () => {
  const rows = mappings.filter((m) => m.visaType === "F-1");
  assert.equal(rows.length, 4);
  const i765 = rows.find((m) => m.formNumber === "I-765");
  assert.ok(i765, "the generic F-1 case type keeps its own I-765 (OPT/CPT) row — untouched, and irrelevant to COSF1 cases since it's a different visaType");
  assert.match(i765.notes, /OPT\/EAD/i);
});

test("I-539A never auto-creates merely because I-539 exists (co-applicant-only, per source spec)", () => {
  const rows = mappings.filter((m) => m.visaType === "COSF1" && m.formNumber === "I-539A");
  rows.forEach((m) => assert.equal(m.provisioningType, "CONDITIONAL"));
});

// ── Questionnaire shape: one combined questionnaire ────────────────────────
test("COS_F1 questionnaire: exactly one combined questionnaire, checklistRole is the F-1 applicant (client) only", () => {
  assert.equal(COS_F1_CHECKLIST_DEFINITIONS.length, 1);
  assert.equal(questionnaire.checklistRole, "client");
  assert.equal(questionnaire.visaType, "COSF1");
  assert.equal(questionnaire.key, getFilingType("COS_F1").questionnaireKey);
});

// ── Current status stays free-text/dynamic; requested status is fixed ─────
test("current nonimmigrant status is free-text (not restricted to any specific source visa)", () => {
  const status = byKey.get("client_currentNonimmigrantStatus");
  assert.equal(status.type, "text");
  assert.equal(status.options.length, 0);
});

test("requested new status is fixed to F-1, never a client-selectable choice", () => {
  const requested = byKey.get("client_requestedNewStatus");
  assert.equal(requested.metadata.defaultValue, "F-1");
  assert.equal(requested.metadata.locked, true);

  const requestedChoice = byKey.get("client_changeOfStatusRequested");
  assert.deepEqual(requestedChoice.options.map((o) => o.value), ["F-1 Student Status"]);
  assert.equal(requestedChoice.metadata.locked, true);
});

test("requested effective date is captured as a real client-entered field", () => {
  const date = byKey.get("client_requestedEffectiveDate");
  assert.equal(date.type, "date");
  assert.equal(date.required, true);
});

// ── I-20/SEVIS receipt are client supporting documents, never CaseForms ───
test("I-20 and SEVIS receipt are file-upload questions on the checklist, not referenced by any VisaFormMapping row", () => {
  const i20 = byKey.get("cosf1_doc_i20");
  const sevis = byKey.get("cosf1_doc_sevisReceipt");
  assert.equal(i20.type, "file");
  assert.equal(i20.required, true);
  assert.equal(sevis.type, "file");
  assert.equal(sevis.required, true);
  // Confirm no VisaFormMapping row exists for these under COSF1 — they are
  // client documents only, never CaseForms.
  const cosf1FormNumbers = mappings.filter((m) => m.visaType === "COSF1").map((m) => m.formNumber);
  assert.ok(!cosf1FormNumbers.some((f) => /I-20|SEVIS/i.test(f)));
});

// ── Conditional documents (source's own "if applicable"/"conditional" items) ─
test("conditional documents are gated on driver questions, never unconditionally mandatory", () => {
  const conditionalCases = [
    { driver: "client_hasApprovalNotices", value: "Yes", doc: "cosf1_doc_approvalNotices" },
    { driver: "client_isEmployed", value: "Yes", doc: "cosf1_doc_paystubsAndW2" },
    { driver: "client_needsAcademicEvaluation", value: "Yes", doc: "cosf1_doc_academicDegreeTranscriptsEvaluation" },
    { driver: "client_hasPreviousApprovalNotice", value: "Yes", doc: "cosf1_doc_previousApprovalNotice" },
  ];
  conditionalCases.forEach(({ driver, value, doc: docKey }) => {
    const q = byKey.get(docKey);
    assert.ok(q, `${docKey} must exist`);
    assert.ok(
      q.conditionalLogic.rules.some((r) => r.questionKey === driver && r.value === value),
      `${docKey} must be gated on ${driver}=${value}`
    );
  });
});

test("unconditional source documents remain required (passport/I-94, birth certificate, I-20, SEVIS receipt, resume, ties to home country, maintaining-status evidence)", () => {
  ["cosf1_doc_passportAndI94", "cosf1_doc_birthCertificate", "cosf1_doc_i20", "cosf1_doc_sevisReceipt", "cosf1_doc_resume", "cosf1_doc_tiesToHomeCountry", "cosf1_doc_maintainingStatusEvidence"].forEach((docKey) => {
    assert.equal(byKey.get(docKey).required, true, `${docKey} must remain required per source`);
  });
});

// ── §14 of the pasted spec's own COS architecture rule / no three-party ────
test("no employer/petitioner/beneficiary/sponsor second-party role exists on the checklist — single applicant only", () => {
  assert.equal(questionnaire.checklistRole, "client");
  questionnaire.questions.forEach((q) => {
    assert.ok(
      (q.visibility.roles || []).every((role) => !["employer", "employee", "petitioner", "beneficiary", "joint_sponsor"].includes(role)),
      `question ${q.key} must not target a second-party role`
    );
  });
});

test("financial sponsor fields are captured as questionnaire data on the same checklist, not a separate participant/second checklist", () => {
  ["client_sponsorFamilyName", "client_sponsorGivenName", "client_sponsorEmployerName", "client_sponsorAnnualIncome"].forEach((key) => {
    assert.ok(byKey.has(key), `${key} must exist on the combined checklist`);
  });
  assert.ok(!byKey.get("client_sponsorFamilyName").mapping, "sponsor fields must not be mapped onto the applicant's own canonical namespace");
});
