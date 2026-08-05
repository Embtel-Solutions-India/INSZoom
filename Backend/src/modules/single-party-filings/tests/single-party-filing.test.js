const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FILING_TYPES,
  listFilingTypes,
  getFilingType,
  groupedForSelection,
  resolveTransitionFilingType,
} = require("../../../config/filingTypes");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../../questionnaires/singlePartyChecklists");
const router = require("../single-party-filing.routes");
const employmentCtrl = require("../../employment-workflow/employment-workflow.controller");
const familyCtrl = require("../../family-workflow/family-workflow.controller");

function routesOf(routerToInspect) {
  return routerToInspect.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

// ── Stage 1: registry shape ──
test("filing-type registry: registers the full expected set with category + transition metadata", () => {
  const expectedKeys = ["COS_F1", "COS_F2", "COS_GENERIC", "F1_REINSTATEMENT", "F1_TO_B2", "EAD", "H4_EXTENSION", "H4_EXTENSION_EAD"];
  assert.deepEqual(Object.keys(FILING_TYPES).sort(), expectedKeys.sort());
  assert.equal(listFilingTypes().length, 8);

  const cosF1 = getFilingType("COS_F1");
  assert.equal(cosF1.category, "change_of_status");
  assert.equal(cosF1.isTransition, true);
  assert.equal(cosF1.toStatus, "F-1");

  const f1ToB2 = getFilingType("F1_TO_B2");
  assert.equal(f1ToB2.isTransition, true);
  assert.equal(f1ToB2.fromStatus, "F-1");
  assert.equal(f1ToB2.toStatus, "B-2");

  const ead = getFilingType("EAD");
  assert.equal(ead.category, "ead");
  assert.equal(ead.isTransition, false);

  const h4Ext = getFilingType("H4_EXTENSION");
  assert.equal(h4Ext.category, "extension");
  assert.equal(h4Ext.includesEad, false);

  const h4ExtEad = getFilingType("H4_EXTENSION_EAD");
  assert.equal(h4ExtEad.category, "extension");
  assert.equal(h4ExtEad.includesEad, true);

  const reinstatement = getFilingType("F1_REINSTATEMENT");
  assert.equal(reinstatement.category, "reinstatement");
  assert.equal(reinstatement.isTransition, false, "F-1 Reinstatement is a standalone/named option, not part of the from->to picker");

  // Case-insensitive lookup + unknown key.
  assert.equal(getFilingType("cos_f1").key, "COS_F1");
  assert.equal(getFilingType("NOT_A_REAL_KEY"), null);
});

test("filing-type registry: is extensible (a consumer can add a new entry without touching resolution logic)", () => {
  const before = listFilingTypes().length;
  FILING_TYPES.TEST_EXTRA_TYPE = {
    key: "TEST_EXTRA_TYPE", label: "Test Extra", category: "extension", includesEad: false,
    isTransition: false, fromStatus: null, toStatus: null, visaType: "TESTEXTRA", questionnaireKey: "test_extra_questionnaire",
  };
  assert.equal(listFilingTypes().length, before + 1);
  assert.ok(getFilingType("TEST_EXTRA_TYPE"));
  delete FILING_TYPES.TEST_EXTRA_TYPE;
  assert.equal(listFilingTypes().length, before);
});

test("resolveTransitionFilingType: prefers a specific fromStatus match over a wildcard, and falls back to COS_GENERIC", () => {
  assert.equal(resolveTransitionFilingType("F-1", "B-2").key, "F1_TO_B2", "a specific F-1->B-2 pair must resolve to the dedicated filing type, not a wildcard COS");
  assert.equal(resolveTransitionFilingType("H-1B", "F-1").key, "COS_F1", "any current status -> F-1 resolves to the wildcard COS_F1 entry");
  assert.equal(resolveTransitionFilingType(null, "F-2").key, "COS_F2");
  assert.equal(resolveTransitionFilingType("F-1", "H-1B").key, "COS_GENERIC", "an unmapped pair falls back to the generic COS entry rather than resolving to nothing");
});

test("groupedForSelection: separates transition (picker) entries from standalone (named-option) entries", () => {
  const grouped = groupedForSelection();
  assert.deepEqual(grouped.transitions.map((e) => e.key).sort(), ["COS_F1", "COS_F2", "F1_TO_B2"].sort());
  assert.deepEqual(
    grouped.standalone.map((e) => e.key).sort(),
    ["COS_GENERIC", "F1_REINSTATEMENT", "EAD", "H4_EXTENSION", "H4_EXTENSION_EAD"].sort()
  );
  assert.ok(grouped.byCategory.change_of_status.length >= 4);
  assert.ok(grouped.byCategory.extension.length === 2);
  assert.ok(grouped.byCategory.ead.length === 1);
  assert.ok(grouped.byCategory.reinstatement.length === 1);
});

// ── Stage 1: scaffold checklists — single-party, no second-party role ──
test("single-party scaffold checklists: one checklist per filing type, checklistRole is the applicant only, clearly marked temporary", () => {
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.length, 8, "exactly one checklist per registered filing type");
  const visaTypesSeen = new Set();
  SINGLE_PARTY_FILING_DEFINITIONS.forEach((def) => {
    assert.equal(def.checklistRole, "client", `${def.key} must have exactly the applicant role, no second party`);
    assert.match(def.description, /SCAFFOLD/i, `${def.key} must be clearly marked as a temporary scaffold`);
    assert.ok(def.questions.length <= 5, `${def.key} should be a MINIMAL scaffold, not real content`);
    assert.ok(!visaTypesSeen.has(def.visaType), `${def.key}'s visaType ${def.visaType} must be unique across filing types`);
    visaTypesSeen.add(def.visaType);
  });
  // Every registry entry must resolve to exactly one of these definitions by key.
  listFilingTypes().forEach((filingType) => {
    const match = SINGLE_PARTY_FILING_DEFINITIONS.find((def) => def.key === filingType.questionnaireKey);
    assert.ok(match, `${filingType.key} must have a matching scaffold checklist (${filingType.questionnaireKey})`);
    assert.equal(match.visaType, filingType.visaType);
  });
});

// ── Stage 2: route registration ──
test("single-party-filing routes: exactly the two expected endpoints, no invite/second-party route", () => {
  const registered = routesOf(router);
  assert.deepEqual(registered.sort(), ["GET /types", "POST /cases"].sort());
  assert.ok(!registered.some((r) => /invite/i.test(r)), "no invite-style endpoint should exist for a single-party filing");
});

// ── Stage 3: guardrail — no employer/family two-party code is reachable or triggered ──
test("guardrail: a single-party filing applicant cannot reach employer-only endpoints (employer/employee code untouched)", async () => {
  const individualApplicant = { _id: "applicant1", role: "client", applicantType: "individual", email: "applicant@example.com" };
  const res = fakeRes();
  await employmentCtrl.createEmployerCase({ user: individualApplicant, body: {} }, res, () => {});
  assert.equal(res.statusCode, 403, "createEmployerCase must still reject a plain individual applicant");
});

test("guardrail: a single-party filing applicant cannot reach family-only endpoints without providing a beneficiary (family flow never auto-triggers)", async () => {
  const individualApplicant = { _id: "applicant1", role: "client", applicantType: "individual", email: "applicant@example.com" };
  const res = fakeRes();
  // isFamilyCapable(individualApplicant) is true (any non-beneficiary can call
  // this route) but the single-party filing flow never calls it - this proves
  // the family endpoint requires its OWN explicit request (beneficiary email),
  // it does not fire as a side effect of single-party filing creation.
  await familyCtrl.createFamilyCase({ user: individualApplicant, body: {} }, res, () => {});
  assert.equal(res.statusCode, 400, "createFamilyCase requires an explicit beneficiary email — it is never implicitly invoked by a single-party filing");
});

test("guardrail: employment-workflow and family-workflow route registrations are unaffected (still exactly what they were)", () => {
  const employmentRoutes = require("../../employment-workflow/employment-workflow.routes");
  const familyRoutes = require("../../family-workflow/family-workflow.routes");
  const routesOfList = (r) => r.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`));
  // +1 for POST /:id/resend-employee-invite (account-recovery task).
  assert.equal(routesOfList(employmentRoutes).length, 9, "employment-workflow route count must be unchanged aside from the new resend-employee-invite route");
  assert.equal(routesOfList(familyRoutes).length, 4, "family-workflow route count must be unchanged");
});
