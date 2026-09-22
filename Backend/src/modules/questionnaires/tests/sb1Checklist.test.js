const assert = require("node:assert/strict");
const test = require("node:test");
const { SB1_CHECKLIST_DEFINITION } = require("../sb1Checklist");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");

// SB-1 (Returning Resident Visa) - a REAL, standalone, single-person
// case-creation visaType (unlike the N-565/N-400/N-600/GC-NVC optional
// add-on processes), auto-resolved via isDefault:true + checklistRole +
// visaType, exactly like EB-1A/Green Card Renewal. DB-free.

const def = SB1_CHECKLIST_DEFINITION;

test("SB-1 checklist is client-owned, IS a default template, and its visaType is the real, literal 'SB-1'", () => {
  assert.equal(def.checklistRole, "client");
  assert.equal(def.isDefault, true, "SB-1's own checklist must auto-resolve at case creation, unlike an optional add-on process");
  assert.equal(def.visaType, "SB-1");
  assert.equal(def.title, "Returning Resident (SB-1) Supporting Documents");
});

test("case classification: SB-1 is registered as caseStructure 'single' with no petitioner/beneficiary/employer/employee", () => {
  const { VISA_CATEGORIES } = require("../../../config/visaCategories");
  const entry = VISA_CATEGORIES["SB-1"];
  assert.ok(entry, "SB-1 must be registered in visaCategories");
  assert.equal(entry.caseStructure, "single");
  assert.ok(entry.forms.includes("ds-117"));
});

test("mapping: SB-1 -> DS-117 is AUTO_CREATE, STANDALONE_FORM, agency DOS (a real fillable PDF, not USCIS, not an online application)", () => {
  const ds117 = mappings.find((m) => m.visaType === "SB-1" && m.formNumber === "DS-117");
  assert.ok(ds117);
  assert.equal(ds117.provisioningType, "AUTO_CREATE");
  assert.equal(ds117.componentType, "STANDALONE_FORM");
  assert.equal(ds117.agency, "DOS");
  assert.equal(ds117.formTemplateFormCode, "ds-117");
});

test("mapping: SB-1 -> DS-260 is CONDITIONAL (never auto-created), ONLINE_APPLICATION, agency DOS, gated on CONSULAR/NVC processing paths", () => {
  const ds260 = mappings.find((m) => m.visaType === "SB-1" && m.formNumber === "DS-260");
  assert.ok(ds260);
  assert.equal(ds260.provisioningType, "CONDITIONAL");
  assert.equal(ds260.componentType, "ONLINE_APPLICATION");
  assert.equal(ds260.agency, "DOS");
  assert.deepEqual(ds260.processingPaths.slice().sort(), ["CONSULAR", "NVC"].sort());
});

test("negative: SB-1 receives no I-130/family-petition or employer/employee forms", () => {
  const sb1Forms = mappings.filter((m) => m.visaType === "SB-1").map((m) => m.formNumber);
  ["I-130", "I-864", "I-129", "I-140"].forEach((formNumber) => assert.ok(!sb1Forms.includes(formNumber)));
});

test("negative: SB-1's checklist key is never registered under family-based or employer/employee visa types", () => {
  const sb1Rows = mappings.filter((m) => m.formNumber === "DS-117" || (m.formNumber === "DS-260" && m.notes?.includes("returning-resident")));
  const forbidden = ["IR-1", "CR-1", "F2A", "F2B", "K-1", "K-3", "H-1B", "L-1A", "EB-1A", "EB-2 NIW"];
  sb1Rows.forEach((row) => assert.ok(!forbidden.includes(row.visaType)));
});

test("Section 2: spouse fields are gated on maritalStatus == Married", () => {
  const gate = [{ questionKey: "client_maritalStatus", operator: "equals", value: "Married" }];
  ["client_spouseFirstName", "client_spouseLastName", "client_spouseDateOfBirth", "client_dateOfMarriage"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, gate);
  });
});

test("Section 3: close family members is a real repeatable table with no fixed entry limit", () => {
  const q = def.questions.find((question) => question.key === "client_closeFamilyMembers");
  assert.equal(q.type, "repeating_group");
  assert.ok(q.repeatable);
  assert.deepEqual(q.metadata.fields.map((f) => f.key), ["fullName", "relationshipToApplicant", "residentStatus", "fullUsAddress"]);
});

test("Section 6: adjustment-of-status details are gated on didAdjustStatus == Yes", () => {
  const gate = [{ questionKey: "client_didAdjustStatus", operator: "equals", value: "Yes" }];
  ["client_adjustmentDate", "client_adjustmentPlace"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, gate);
  });
});

test("Section 10/11: continuing-ties and delayed-return questions are real long-text fields with the exact source question text", () => {
  const ties = def.questions.find((q) => q.key === "client_continuingUSTies");
  assert.equal(ties.type, "textarea");
  assert.match(ties.label, /continuing ties/i);
  const delayed = def.questions.find((q) => q.key === "client_reasonForNotReturning");
  assert.equal(delayed.type, "textarea");
  assert.match(delayed.label, /not returning/i);
});

test("Section 12: periods outside the US is a real repeatable table, not one free-text field", () => {
  const q = def.questions.find((question) => question.key === "client_periodsOutsideUs");
  assert.equal(q.type, "repeating_group");
  assert.deepEqual(q.metadata.fields.map((f) => f.key), ["from", "to", "country"]);
});

test("Section 13: foreign employment history is gated on employedOutsideUs == Yes and is a repeatable table", () => {
  const gate = [{ questionKey: "client_employedOutsideUs", operator: "equals", value: "Yes" }];
  const q = def.questions.find((question) => question.key === "client_foreignEmployment");
  assert.equal(q.type, "repeating_group");
  assert.deepEqual(q.conditionalLogic.rules, gate);
  assert.deepEqual(q.metadata.fields.map((f) => f.key), ["employerName", "employerAddress", "from", "to"]);
});

test("document checklist: re-entry permit is gated on hasReentryPermit == Yes (not shown to every applicant)", () => {
  const doc = def.questions.find((q) => q.key === "sb1_doc_reentryPermit");
  assert.equal(doc.required, false);
  assert.deepEqual(doc.conditionalLogic.rules, [{ questionKey: "client_hasReentryPermit", operator: "equals", value: "Yes" }]);
});

test("document checklist: every document carries a required/conditional/supporting classification, and core identity documents are required", () => {
  const docs = def.questions.filter((q) => q.type === "file");
  docs.forEach((doc) => assert.ok(["required", "conditional", "supporting"].includes(doc.metadata.classification), `${doc.key} missing classification`));
  ["sb1_doc_passport", "sb1_doc_greenCard", "sb1_doc_travelRecords", "sb1_doc_passportEntryExitStamps"].forEach((key) => {
    assert.equal(docs.find((d) => d.key === key).required, true);
  });
  // U.S.-ties evidence is supporting, not individually mandatory - and
  // physical-presence-style evidence is never collapsed into one generic
  // upload.
  ["sb1_doc_usTaxReturns", "sb1_doc_w2s", "sb1_doc_employmentVerificationLetter", "sb1_doc_usPropertyOwnership", "sb1_doc_usBusinessOwnership", "sb1_doc_otherTiesEvidence"].forEach((key) => {
    const doc = docs.find((d) => d.key === key);
    assert.equal(doc.required, false);
    assert.equal(doc.metadata.classification, "supporting");
  });
});

test("checklist visibility is client-only (no petitioner/beneficiary/employer/employee)", () => {
  def.questions.forEach((q) => {
    assert.ok(q.visibility.roles.includes("client"));
    ["petitioner", "beneficiary", "employer", "employee", "joint_sponsor"].forEach((role) => {
      assert.ok(!q.visibility.roles.includes(role), `${q.key} must not be visible to ${role}`);
    });
  });
});

test("no duplicate question keys", () => {
  const keys = def.questions.map((q) => q.key);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});
