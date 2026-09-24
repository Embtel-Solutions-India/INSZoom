const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const { resolveH4Checklist } = require("../h4Checklist.util");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const Case = require("../../../models/Case");
const Questionnaire = require("../../../models/Questionnaire");
const caseService = require("../../cases/case.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const ctrl = require("../single-party-filing.controller");

// Covers the governing task spec's §24 test matrix (cases 1-8): the H4
// decision function, VisaFormMapping registry shape (no duplicate/stray
// forms), and the changeFilingType selection-change path's idempotency +
// non-destructive data preservation. No live DB connection - Case/
// Questionnaire/uscisFormService calls are mocked, mirroring
// form-registry/tests/sb1ConditionalDs260.test.js's pattern.

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

const fakeUser = { _id: new mongoose.Types.ObjectId(), name: "Case Manager", role: "case_manager" };

// ── Case 1-4: resolveH4Checklist decision matrix ───────────────────────────
test("resolveH4Checklist: Extension only -> H4_EXTENSION filing type, I-539 only", () => {
  const { filingType, forms } = resolveH4Checklist({ h4ExtensionSelected: true, h4EadSelected: false });
  assert.equal(filingType.key, "H4_EXTENSION");
  assert.deepEqual(forms, ["I-539"]);
});

test("resolveH4Checklist: EAD only -> H4_EAD filing type, I-765 only", () => {
  const { filingType, forms } = resolveH4Checklist({ h4ExtensionSelected: false, h4EadSelected: true });
  assert.equal(filingType.key, "H4_EAD");
  assert.deepEqual(forms, ["I-765"]);
});

test("resolveH4Checklist: both selected -> H4_EXTENSION_EAD combined filing type, I-539 + I-765", () => {
  const { filingType, forms } = resolveH4Checklist({ h4ExtensionSelected: true, h4EadSelected: true });
  assert.equal(filingType.key, "H4_EXTENSION_EAD");
  assert.deepEqual(forms, ["I-539", "I-765"]);
});

test("resolveH4Checklist: neither selected -> no filing type, no forms", () => {
  const { filingType, forms } = resolveH4Checklist({ h4ExtensionSelected: false, h4EadSelected: false });
  assert.equal(filingType, null);
  assert.deepEqual(forms, []);
});

// ── Case 5-6: VisaFormMapping registry shape — no duplicates, correct scope ─
test("VisaFormMapping registry: H4EXTENSION has exactly I-539 (AUTO_CREATE) + I-539A (CONDITIONAL supplement), no I-765/I-140/I-129", () => {
  const rows = mappings.filter((m) => m.visaType === "H4EXTENSION");
  assert.equal(rows.length, 2, "no duplicate rows from a doubled seed run");
  const i539 = rows.find((m) => m.formNumber === "I-539");
  const i539A = rows.find((m) => m.formNumber === "I-539A");
  assert.ok(i539 && i539A);
  assert.equal(i539.provisioningType, "AUTO_CREATE");
  assert.equal(i539A.provisioningType, "CONDITIONAL", "I-539A must never auto-create merely because I-539 exists");
  assert.ok(!rows.some((m) => ["I-765", "I-140", "I-129"].includes(m.formNumber)));
});

test("VisaFormMapping registry: H4EAD has exactly I-765 (AUTO_CREATE), no I-539/I-539A/I-140/I-129", () => {
  const rows = mappings.filter((m) => m.visaType === "H4EAD");
  assert.equal(rows.length, 1, "no duplicate rows from a doubled seed run");
  assert.equal(rows[0].formNumber, "I-765");
  assert.equal(rows[0].provisioningType, "AUTO_CREATE");
});

test("VisaFormMapping registry: H4EXTENSIONEAD has exactly I-539 + I-539A + I-765, both primary forms AUTO_CREATE", () => {
  const rows = mappings.filter((m) => m.visaType === "H4EXTENSIONEAD");
  assert.equal(rows.length, 3, "no duplicate rows from a doubled seed run");
  const i539 = rows.find((m) => m.formNumber === "I-539");
  const i539A = rows.find((m) => m.formNumber === "I-539A");
  const i765 = rows.find((m) => m.formNumber === "I-765");
  assert.ok(i539 && i539A && i765);
  assert.equal(i539.provisioningType, "AUTO_CREATE");
  assert.equal(i765.provisioningType, "AUTO_CREATE");
  assert.equal(i539A.provisioningType, "CONDITIONAL");
});

test("VisaFormMapping registry: no I-539A is ever unconditionally created for every H4 case (never blindly turned into a standalone form)", () => {
  const allH4Rows = mappings.filter((m) => ["H4EXTENSION", "H4EAD", "H4EXTENSIONEAD"].includes(m.visaType));
  allH4Rows.filter((m) => m.formNumber === "I-539A").forEach((m) => {
    assert.equal(m.provisioningType, "CONDITIONAL");
  });
});

// ── Case 7-8: selection change via changeFilingType — idempotent, non-destructive ─
function fakeQuestionnaire(id, key) {
  return { _id: id, key, title: key, checklistRole: "client" };
}

function fakeCase(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    petitionSubType: "H4_EXTENSION",
    visaType: "H4EXTENSION",
    visaCategory: "extension",
    petitionType: "H-4 Extension",
    questionnaireReferences: [],
    save: async () => {},
    ...overrides,
  };
}

test("changeFilingType: Extension -> Extension+EAD marks the old questionnaireReference inactive (never deletes it) and assigns the combined checklist", async (t) => {
  t.after(() => mock.restoreAll());
  const extQuestionnaireId = new mongoose.Types.ObjectId();
  const combinedQuestionnaireId = new mongoose.Types.ObjectId();
  const caseData = fakeCase({
    questionnaireReferences: [{ questionnaireId: extQuestionnaireId, active: true, status: "not_started" }],
  });

  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  mock.method(questionnaireService, "ensureDefaultVisaTemplates", async () => {});
  mock.method(Questionnaire, "findOne", async ({ key }) => {
    if (key === "h4_extension_questionnaire") return fakeQuestionnaire(extQuestionnaireId, key);
    if (key === "h4_extension_ead_questionnaire") return fakeQuestionnaire(combinedQuestionnaireId, key);
    return null;
  });
  const assignCalls = [];
  mock.method(questionnaireService, "assignQuestionnaireIfNotActive", async (questionnaire, payload) => {
    assignCalls.push({ questionnaire, payload });
    caseData.questionnaireReferences.push({ questionnaireId: questionnaire._id, active: true, status: "not_started" });
    return { case: caseData };
  });
  const ensureFormsCalls = [];
  mock.method(uscisFormService, "ensureAssignedForms", async (...args) => {
    ensureFormsCalls.push(args);
    return [{ formCode: "i-765" }];
  });

  const req = { params: { caseId: String(caseData._id) }, body: { filingTypeKey: "H4_EXTENSION_EAD" }, user: fakeUser };
  const res = fakeRes();
  await ctrl.changeFilingType(req, res, (err) => { throw err; });

  assert.equal(res.statusCode, 200);
  assert.equal(caseData.visaType, "H4EXTENSIONEAD");
  assert.equal(caseData.petitionSubType, "H4_EXTENSION_EAD");

  const oldRef = caseData.questionnaireReferences.find((r) => String(r.questionnaireId) === String(extQuestionnaireId));
  assert.equal(oldRef.active, false, "old H4_EXTENSION questionnaire reference is marked inactive, never removed from the array");
  assert.ok(caseData.questionnaireReferences.some((r) => String(r.questionnaireId) === String(combinedQuestionnaireId) && r.active !== false), "new combined checklist is assigned");
  assert.equal(assignCalls.length, 1);
  assert.equal(ensureFormsCalls.length, 1, "ensureAssignedForms is called once to add the newly-required I-765 without touching the existing I-539");
});

test("changeFilingType: calling with the same filing type the case already has is a no-op (idempotent, no duplicate assignment)", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase({ petitionSubType: "H4_EXTENSION", visaType: "H4EXTENSION" });
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  const assignSpy = mock.method(questionnaireService, "assignQuestionnaireIfNotActive", async () => { throw new Error("must not be called"); });

  const req = { params: { caseId: String(caseData._id) }, body: { filingTypeKey: "H4_EXTENSION" }, user: fakeUser };
  const res = fakeRes();
  await ctrl.changeFilingType(req, res, (err) => { throw err; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unchanged, true);
  assert.equal(assignSpy.mock.callCount(), 0);
});

test("changeFilingType: unknown filingTypeKey is rejected with 400, case is left untouched", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);

  const req = { params: { caseId: String(caseData._id) }, body: { filingTypeKey: "NOT_A_REAL_KEY" }, user: fakeUser };
  const res = fakeRes();
  await ctrl.changeFilingType(req, res, (err) => { throw err; });

  assert.equal(res.statusCode, 400);
  assert.equal(caseData.visaType, "H4EXTENSION", "unchanged");
});
