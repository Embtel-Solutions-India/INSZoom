const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const { COS_B1_B2_CHECKLIST_DEFINITIONS } = require("../../questionnaires/cosB1B2Checklist");
const { resolveTransitionFilingType } = require("../../../config/filingTypes");

// Covers the governing task spec's §16 acceptance matrix: H-1B/F-1/L-1A ->
// B-1 and -> B-2 all resolve to the correct, INDEPENDENT destination
// checklist and VisaFormMapping, current/requested status are captured,
// conditional documents work, and only the destination's forms are ever in
// scope. No live DB connection needed for these checks.

const [b1Def, b2Def] = COS_B1_B2_CHECKLIST_DEFINITIONS;
const b1ByKey = new Map(b1Def.questions.map((q) => [q.key, q]));
const b2ByKey = new Map(b2Def.questions.map((q) => [q.key, q]));

const SOURCE_STATUSES = ["H-1B", "F-1", "L-1A", "H-4", "F-2"];

// ── §16: correct destination detected for every source status, dynamically ─
test("every supported source status -> B-1 resolves to COS_B1 with cos_b1_questionnaire content", () => {
  SOURCE_STATUSES.forEach((fromStatus) => {
    const resolved = resolveTransitionFilingType(fromStatus, "B-1");
    assert.equal(resolved.key, "COS_B1", `${fromStatus} -> B-1`);
    assert.equal(resolved.questionnaireKey, "cos_b1_questionnaire");
    assert.equal(resolved.visaType, "COSB1");
  });
});

test("every supported source status -> B-2 resolves to cos_b2_questionnaire content (via COS_B2 or the more-specific F1_TO_B2)", () => {
  SOURCE_STATUSES.forEach((fromStatus) => {
    const resolved = resolveTransitionFilingType(fromStatus, "B-2");
    assert.equal(resolved.questionnaireKey, "cos_b2_questionnaire", `${fromStatus} -> B-2`);
    assert.equal(resolved.visaType, "COSB2");
  });
});

// ── §7/§8/§11: independent VisaFormMapping per destination, no cross-bleed ─
test("VisaFormMapping registry: COSB1 has exactly I-539 (AUTO_CREATE), no DS-160/I-539A/I-129/I-765/I-140", () => {
  const rows = mappings.filter((m) => m.visaType === "COSB1");
  assert.equal(rows.length, 1, "no duplicate rows from a doubled seed run");
  assert.equal(rows[0].formNumber, "I-539");
  assert.equal(rows[0].provisioningType, "AUTO_CREATE");
});

test("VisaFormMapping registry: COSB2 has exactly I-539 (AUTO_CREATE), no DS-160/I-539A/I-129/I-765/I-140", () => {
  const rows = mappings.filter((m) => m.visaType === "COSB2");
  assert.equal(rows.length, 1, "no duplicate rows from a doubled seed run");
  assert.equal(rows[0].formNumber, "I-539");
  assert.equal(rows[0].provisioningType, "AUTO_CREATE");
});

test("regression: the generic B-1/B-2 VisaFormMapping blocks are unchanged (DS-160 AUTO_CREATE + I-539 CONDITIONAL)", () => {
  ["B-1", "B-2"].forEach((visaType) => {
    const rows = mappings.filter((m) => m.visaType === visaType);
    assert.equal(rows.length, 2);
    const ds160 = rows.find((m) => m.formNumber === "DS-160");
    const i539 = rows.find((m) => m.formNumber === "I-539");
    assert.equal(ds160.provisioningType, "AUTO_CREATE");
    assert.equal(i539.provisioningType, "CONDITIONAL", "the generic case type's own I-539 must stay conditional, unaffected by COSB1/COSB2's dedicated AUTO_CREATE rows");
  });
});

test("COSB1 and COSB2 mappings never overlap — B-1 forms are never provisioned for a B-2 destination and vice versa", () => {
  const b1FormNumbers = mappings.filter((m) => m.visaType === "COSB1").map((m) => m.formNumber);
  const b2FormNumbers = mappings.filter((m) => m.visaType === "COSB2").map((m) => m.formNumber);
  assert.deepEqual(b1FormNumbers, ["I-539"]);
  assert.deepEqual(b2FormNumbers, ["I-539"]);
});

// ── §1/§17: two independent checklist records, never a shared/parent one ──
test("COS_TO_B1 and COS_TO_B2 are two independent Questionnaire records, not a shared/parent checklist", () => {
  assert.equal(COS_B1_B2_CHECKLIST_DEFINITIONS.length, 2);
  assert.notEqual(b1Def.key, b2Def.key);
  assert.notEqual(b1Def.visaType, b2Def.visaType);
  assert.equal(b1Def.checklistRole, "client");
  assert.equal(b2Def.checklistRole, "client");
});

// ── §4: current status stays free-text/dynamic; requested status is fixed ──
test("current nonimmigrant status is a free-text question (not restricted to any specific source visa)", () => {
  const b1Status = b1ByKey.get("client_currentNonimmigrantStatus");
  const b2Status = b2ByKey.get("client_currentNonimmigrantStatus");
  assert.equal(b1Status.type, "text");
  assert.equal(b1Status.options.length, 0, "no fixed option list — any current status is accepted");
  assert.equal(b2Status.type, "text");
  assert.equal(b2Status.options.length, 0);
});

test("requested new status is fixed per checklist, not a client-selectable choice", () => {
  const b1Requested = b1ByKey.get("client_requestedNewStatus");
  const b2Requested = b2ByKey.get("client_requestedNewStatus");
  assert.equal(b1Requested.metadata.defaultValue, "B-1");
  assert.equal(b1Requested.metadata.locked, true);
  assert.equal(b2Requested.metadata.defaultValue, "B-2");
  assert.equal(b2Requested.metadata.locked, true);
});

test("requested effective date is captured as a real client-entered field on both checklists", () => {
  assert.equal(b1ByKey.get("client_requestedEffectiveDate").type, "date");
  assert.equal(b1ByKey.get("client_requestedEffectiveDate").required, true);
  assert.equal(b2ByKey.get("client_requestedEffectiveDate").type, "date");
  assert.equal(b2ByKey.get("client_requestedEffectiveDate").required, true);
});

// ── §6: conditional documents work, on BOTH checklists independently ───────
function assertConditionalDocs(byKey, label) {
  const cases = [
    { driver: "client_wasF1OrF2Student", value: "Yes", docs: ["cosb1b2_doc_latestI20", "cosb1b2_doc_academicCertTranscript"] },
    { driver: "client_hasEadCard", value: "Yes", docs: ["cosb1b2_doc_eadCard"] },
    { driver: "client_hasPriorApprovalNotice", value: "Yes", docs: ["cosb1b2_doc_latestApprovalNotice"] },
    { driver: "client_isEmployed", value: "Yes", docs: ["cosb1b2_doc_payStubs3Months", "cosb1b2_doc_w2"] },
    { driver: "client_hasOtherAssets", value: "Yes", docs: ["cosb1b2_doc_otherAssets"] },
  ];
  cases.forEach(({ driver, value, docs }) => {
    docs.forEach((docKey) => {
      const q = byKey.get(docKey);
      assert.ok(q, `${label}: ${docKey} must exist`);
      assert.ok(
        q.conditionalLogic.rules.some((r) => r.questionKey === driver && r.value === value),
        `${label}: ${docKey} must be gated on ${driver}=${value}`
      );
      assert.equal(q.required, false, `${label}: ${docKey} must not be unconditionally mandatory`);
    });
  });
  // Unconditional core documents remain required on both checklists.
  ["cosb1b2_doc_passportAndI94", "cosb1b2_doc_driversLicenseAndSsn", "cosb1b2_doc_bankStatements3Months", "cosb1b2_doc_tiesToHomeCountry"].forEach((docKey) => {
    assert.equal(byKey.get(docKey).required, true, `${label}: ${docKey} must remain required (source has no qualifier)`);
  });
}

test("conditional documents work identically and independently on COS_TO_B1", () => {
  assertConditionalDocs(b1ByKey, "B-1");
});

test("conditional documents work identically and independently on COS_TO_B2", () => {
  assertConditionalDocs(b2ByKey, "B-2");
});

// ── §13: no three-party structure ──────────────────────────────────────────
test("no employer/petitioner/beneficiary/sponsor role exists on either checklist — single applicant only", () => {
  [b1Def, b2Def].forEach((def) => {
    assert.equal(def.checklistRole, "client");
    def.questions.forEach((q) => {
      assert.ok(
        (q.visibility.roles || []).every((role) => !["employer", "employee", "petitioner", "beneficiary", "joint_sponsor"].includes(role)),
        `${def.key}: question ${q.key} must not target a second-party role`
      );
    });
  });
});

// ── §16: no duplicate checklist created on repeated provisioning ──────────
test("idempotency: re-requiring the checklist module never produces more than one definition per destination", () => {
  delete require.cache[require.resolve("../../questionnaires/cosB1B2Checklist")];
  const reloaded = require("../../questionnaires/cosB1B2Checklist").COS_B1_B2_CHECKLIST_DEFINITIONS;
  assert.equal(reloaded.length, 2);
  const keys = reloaded.map((d) => d.key);
  assert.equal(new Set(keys).size, 2, "no duplicate checklist keys");
});
