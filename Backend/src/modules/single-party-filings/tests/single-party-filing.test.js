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
  const expectedKeys = ["COS_F1", "COS_F2", "COS_B1", "COS_B2", "COS_GENERIC", "F1_REINSTATEMENT", "F1_TO_B2", "EAD", "H4_EXTENSION", "H4_EAD", "H4_EXTENSION_EAD"];
  assert.deepEqual(Object.keys(FILING_TYPES).sort(), expectedKeys.sort());
  assert.equal(listFilingTypes().length, 11);

  const cosF1 = getFilingType("COS_F1");
  assert.equal(cosF1.category, "change_of_status");
  assert.equal(cosF1.isTransition, true);
  assert.equal(cosF1.toStatus, "F-1");

  const cosB1 = getFilingType("COS_B1");
  assert.equal(cosB1.isTransition, true);
  assert.equal(cosB1.fromStatus, null, "COS_B1 accepts any current status");
  assert.equal(cosB1.toStatus, "B-1");
  assert.equal(cosB1.visaType, "COSB1");

  const cosB2 = getFilingType("COS_B2");
  assert.equal(cosB2.isTransition, true);
  assert.equal(cosB2.fromStatus, null, "COS_B2 accepts any current status");
  assert.equal(cosB2.toStatus, "B-2");
  assert.equal(cosB2.visaType, "COSB2");

  // F1_TO_B2 keeps its own registry key (more specific than the COS_B2
  // wildcard) but now shares COS_B2's exact visaType/questionnaire content —
  // see cosB1B2Checklist.js's banner for why.
  const f1ToB2 = getFilingType("F1_TO_B2");
  assert.equal(f1ToB2.isTransition, true);
  assert.equal(f1ToB2.fromStatus, "F-1");
  assert.equal(f1ToB2.toStatus, "B-2");
  assert.equal(f1ToB2.visaType, "COSB2");
  assert.equal(f1ToB2.questionnaireKey, "cos_b2_questionnaire");

  const ead = getFilingType("EAD");
  assert.equal(ead.category, "ead");
  assert.equal(ead.isTransition, false);

  const h4Ext = getFilingType("H4_EXTENSION");
  assert.equal(h4Ext.category, "extension");
  assert.equal(h4Ext.includesEad, false);

  const h4Ead = getFilingType("H4_EAD");
  assert.equal(h4Ead.category, "ead");
  assert.equal(h4Ead.includesEad, true);
  assert.equal(h4Ead.isTransition, false);

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

// ── COS to B-1 / COS to B-2: current status remains fully dynamic ─────────
test("resolveTransitionFilingType: COS_B1/COS_B2 accept ANY current status (not restricted to H-1B/F-1)", () => {
  ["H-1B", "F-1", "L-1A", "H-4", "F-2", "O-1A"].forEach((fromStatus) => {
    const toB1 = resolveTransitionFilingType(fromStatus, "B-1");
    assert.equal(toB1.key, "COS_B1", `${fromStatus} -> B-1 must resolve to COS_B1`);
    assert.equal(toB1.questionnaireKey, "cos_b1_questionnaire");

    const toB2 = resolveTransitionFilingType(fromStatus, "B-2");
    assert.equal(toB2.questionnaireKey, "cos_b2_questionnaire", `${fromStatus} -> B-2 must resolve to COS_TO_B2 content`);
  });
  // F-1 -> B-2 specifically resolves through the more specific F1_TO_B2 key,
  // but with the exact same content as every other source status.
  assert.equal(resolveTransitionFilingType("F-1", "B-2").key, "F1_TO_B2");
  // Every other source status resolves through the COS_B2 wildcard itself.
  assert.equal(resolveTransitionFilingType("H-1B", "B-2").key, "COS_B2");
});

test("groupedForSelection: separates transition (picker) entries from standalone (named-option) entries", () => {
  const grouped = groupedForSelection();
  assert.deepEqual(grouped.transitions.map((e) => e.key).sort(), ["COS_F1", "COS_F2", "COS_B1", "COS_B2", "F1_TO_B2"].sort());
  assert.deepEqual(
    grouped.standalone.map((e) => e.key).sort(),
    ["COS_GENERIC", "F1_REINSTATEMENT", "EAD", "H4_EXTENSION", "H4_EAD", "H4_EXTENSION_EAD"].sort()
  );
  assert.ok(grouped.byCategory.change_of_status.length >= 6);
  assert.ok(grouped.byCategory.extension.length === 2);
  assert.ok(grouped.byCategory.ead.length === 2, "EAD + H4_EAD");
  assert.ok(grouped.byCategory.reinstatement.length === 1);
});

// ── Stage 1: scaffold checklists — single-party, no second-party role ──
// H4_EXTENSION/H4_EAD/H4_EXTENSION_EAD/COS_F2/COS_B1/COS_B2/F1_TO_B2 are
// deliberately EXCLUDED from the generic scaffold generator — they have
// real, authored content instead (h4Checklist.js's H4_CHECKLIST_DEFINITIONS,
// cosF2Checklist.js's COS_F2_CHECKLIST_DEFINITIONS, cosB1B2Checklist.js's
// COS_B1_B2_CHECKLIST_DEFINITIONS, asserted separately below).
test("single-party scaffold checklists: one scaffold per real-content-EXCLUDED filing type, checklistRole is the applicant only, clearly marked temporary", () => {
  const REAL_CONTENT_KEYS = ["H4_EXTENSION", "H4_EAD", "H4_EXTENSION_EAD", "COS_F1", "COS_F2", "COS_B1", "COS_B2", "F1_TO_B2"];
  const scaffoldEligible = listFilingTypes().filter((ft) => !REAL_CONTENT_KEYS.includes(ft.key));
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.length, scaffoldEligible.length, "exactly one scaffold per real-content-excluded filing type");
  const visaTypesSeen = new Set();
  SINGLE_PARTY_FILING_DEFINITIONS.forEach((def) => {
    assert.equal(def.checklistRole, "client", `${def.key} must have exactly the applicant role, no second party`);
    assert.match(def.description, /SCAFFOLD/i, `${def.key} must be clearly marked as a temporary scaffold`);
    assert.ok(def.questions.length <= 5, `${def.key} should be a MINIMAL scaffold, not real content`);
    assert.ok(!visaTypesSeen.has(def.visaType), `${def.key}'s visaType ${def.visaType} must be unique across filing types`);
    visaTypesSeen.add(def.visaType);
  });
  scaffoldEligible.forEach((filingType) => {
    const match = SINGLE_PARTY_FILING_DEFINITIONS.find((def) => def.key === filingType.questionnaireKey);
    assert.ok(match, `${filingType.key} must have a matching scaffold checklist (${filingType.questionnaireKey})`);
    assert.equal(match.visaType, filingType.visaType);
  });
});

test("H4 real-content checklists: exactly the three H4 filing types have real (non-scaffold) content, none also has a competing scaffold", () => {
  const { H4_CHECKLIST_DEFINITIONS } = require("../../questionnaires/h4Checklist");
  const H4_REAL_CONTENT_KEYS = ["H4_EXTENSION", "H4_EAD", "H4_EXTENSION_EAD"];
  assert.equal(H4_CHECKLIST_DEFINITIONS.length, 3);
  H4_REAL_CONTENT_KEYS.forEach((key) => {
    const filingType = getFilingType(key);
    const realDef = H4_CHECKLIST_DEFINITIONS.find((d) => d.key === filingType.questionnaireKey);
    assert.ok(realDef, `${key} must have real content under ${filingType.questionnaireKey}`);
    assert.equal(realDef.visaType, filingType.visaType);
    assert.equal(realDef.checklistRole, "client");
    assert.equal(realDef.isDefault, true);
    assert.ok(realDef.questions.length > 5, `${key} must have real (non-scaffold) content`);
    assert.ok(
      !SINGLE_PARTY_FILING_DEFINITIONS.some((scaffold) => scaffold.key === filingType.questionnaireKey),
      `${key} must not also have a competing scaffold`
    );
  });
});

test("COS_F1 real-content checklist: one combined questionnaire (not a scaffold), checklistRole is the F-1 applicant only", () => {
  const { COS_F1_CHECKLIST_DEFINITIONS } = require("../../questionnaires/cosF1Checklist");
  assert.equal(COS_F1_CHECKLIST_DEFINITIONS.length, 1, "exactly one combined questionnaire, not one per role");
  const filingType = getFilingType("COS_F1");
  const realDef = COS_F1_CHECKLIST_DEFINITIONS[0];
  assert.equal(realDef.key, filingType.questionnaireKey);
  assert.equal(realDef.visaType, filingType.visaType);
  assert.equal(realDef.checklistRole, "client");
  assert.equal(realDef.isDefault, true);
  assert.ok(realDef.questions.length > 5, "must have real (non-scaffold) content");
  assert.ok(
    !SINGLE_PARTY_FILING_DEFINITIONS.some((scaffold) => scaffold.key === filingType.questionnaireKey),
    "COS_F1 must not also have a competing scaffold"
  );
});

test("COS_F2 real-content checklist: one combined questionnaire (not a scaffold), checklistRole is the F-2 applicant only", () => {
  const { COS_F2_CHECKLIST_DEFINITIONS } = require("../../questionnaires/cosF2Checklist");
  assert.equal(COS_F2_CHECKLIST_DEFINITIONS.length, 1, "exactly one combined questionnaire, not one per role");
  const filingType = getFilingType("COS_F2");
  const realDef = COS_F2_CHECKLIST_DEFINITIONS[0];
  assert.equal(realDef.key, filingType.questionnaireKey);
  assert.equal(realDef.visaType, filingType.visaType);
  assert.equal(realDef.checklistRole, "client");
  assert.equal(realDef.isDefault, true);
  assert.ok(realDef.questions.length > 5, "must have real (non-scaffold) content");
  assert.ok(
    !SINGLE_PARTY_FILING_DEFINITIONS.some((scaffold) => scaffold.key === filingType.questionnaireKey),
    "COS_F2 must not also have a competing scaffold"
  );
});

test("COS_B1/COS_B2 real-content checklists: TWO independent records (never a shared one), each with real content, none also has a competing scaffold", () => {
  const { COS_B1_B2_CHECKLIST_DEFINITIONS } = require("../../questionnaires/cosB1B2Checklist");
  assert.equal(COS_B1_B2_CHECKLIST_DEFINITIONS.length, 2, "two independent checklist records, never a shared/parent one");
  const [b1Def, b2Def] = COS_B1_B2_CHECKLIST_DEFINITIONS;

  const cosB1 = getFilingType("COS_B1");
  assert.equal(b1Def.key, cosB1.questionnaireKey);
  assert.equal(b1Def.visaType, "COSB1");
  assert.equal(b1Def.checklistRole, "client");
  assert.equal(b1Def.isDefault, true);
  assert.ok(b1Def.questions.length > 5);

  const cosB2 = getFilingType("COS_B2");
  assert.equal(b2Def.key, cosB2.questionnaireKey);
  assert.equal(b2Def.visaType, "COSB2");
  assert.equal(b2Def.checklistRole, "client");
  assert.equal(b2Def.isDefault, true);
  assert.ok(b2Def.questions.length > 5);

  // Independent records: different keys/visaTypes/titles, so B-1 content can
  // diverge from B-2 content later without touching the other.
  assert.notEqual(b1Def.key, b2Def.key);
  assert.notEqual(b1Def.visaType, b2Def.visaType);
  assert.notEqual(b1Def.title, b2Def.title);

  // Neither has a competing scaffold — F1_TO_B2 shares COSB2's key/content
  // by design (not a separate scaffold), so it must not appear either.
  [cosB1.questionnaireKey, cosB2.questionnaireKey].forEach((key) => {
    assert.ok(!SINGLE_PARTY_FILING_DEFINITIONS.some((scaffold) => scaffold.key === key), `${key} must not also have a competing scaffold`);
  });
});

// ── Stage 2: route registration ──
test("single-party-filing routes: exactly the three expected endpoints, no invite/second-party route", () => {
  const registered = routesOf(router);
  assert.deepEqual(registered.sort(), ["GET /types", "POST /cases", "PATCH /cases/:caseId/filing-type"].sort());
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
