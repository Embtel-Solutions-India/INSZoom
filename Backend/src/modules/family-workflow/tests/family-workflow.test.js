const assert = require("node:assert/strict");
const test = require("node:test");

const familyCtrl = require("../family-workflow.controller");
const familyRoutes = require("../family-workflow.routes");
const employmentCtrl = require("../../employment-workflow/employment-workflow.controller");
const employmentRoutes = require("../../employment-workflow/employment-workflow.routes");
const familyRegistry = require("../questionnaires/registry");
const { FAMILY_CHECKLIST_DEFINITIONS } = require("../../questionnaires/familyChecklists");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../../questionnaires/employmentChecklists");
const { VISA_TYPES } = require("../../../config/visaTypes");
const Questionnaire = require("../../../models/Questionnaire");
const Case = require("../../../models/Case");

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function routesOf(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

// ── Stage 4 guardrail: a K-1/K-3 petitioner (applicantType "individual",
// role "client") must be rejected from every employer-only endpoint, and
// employment-workflow.controller.js/routes.js must be provably untouched
// (same registered routes, same rejection behavior it already had). ──
test("employer-guardrail: a family petitioner (individual client) is rejected from employer-only endpoints", async () => {
  const individualPetitioner = { _id: "petitioner1", role: "client", applicantType: "individual", email: "petitioner@example.com", name: "Pat Petitioner" };

  const createRes = fakeRes();
  await employmentCtrl.createEmployerCase({ user: individualPetitioner, body: {} }, createRes, () => {});
  assert.equal(createRes.statusCode, 403, "createEmployerCase must reject an individual-applicantType client");
  assert.match(createRes.body.message, /employer/i);

  const companyRes = fakeRes();
  await employmentCtrl.saveCompanyProfile({ user: individualPetitioner, body: {} }, companyRes, () => {});
  assert.equal(companyRes.statusCode, 403, "saveCompanyProfile must reject an individual-applicantType client");
  assert.match(companyRes.body.message, /employer/i);
});

test("employer-guardrail: employment-workflow routes are unchanged (still registered, still role-gated the same way)", () => {
  const registered = routesOf(employmentRoutes);
  // Matches the current, already-signed-off shape of employment-workflow.routes.js
  // exactly (getCaseManagerDashboard/"/case-manager/dashboard" was removed in an
  // earlier, unrelated task after confirming zero callers — not part of this route list).
  [
    "GET /me",
    "PUT /company",
    "POST /cases",
    "POST /:id/invite-employee",
    "POST /:id/resend-employee-invite",
    "PUT /:id/job",
    "PUT /:id/employee-questionnaire",
    "POST /:id/submit",
    "POST /:id/requests",
  ].forEach((route) => assert.ok(registered.includes(route), `${route} is missing from employment-workflow.routes.js — it must be untouched`));
  // +1 for POST /:id/resend-employee-invite (account-recovery task: regenerates
  // an invite token and re-sends the same employee-case-invitation email).
  assert.equal(registered.length, 9, "employment-workflow.routes.js must have exactly the same route count as before this task, plus the new resend-employee-invite route");
});

test("employer-guardrail: a beneficiary role cannot reach employer-only endpoints either", async () => {
  const beneficiary = { _id: "ben1", role: "beneficiary", applicantType: "individual", email: "ben@example.com" };
  const res = fakeRes();
  await employmentCtrl.createEmployerCase({ user: beneficiary, body: {} }, res, () => {});
  assert.equal(res.statusCode, 403);
});

// ── Family path: initiation, self-initiation rejection, access scoping ──
test("family path: only a non-beneficiary account may initiate (isFamilyCapable)", () => {
  assert.equal(familyCtrl.isFamilyCapable({ role: "client", applicantType: "individual" }), true);
  assert.equal(familyCtrl.isFamilyCapable({ role: "beneficiary" }), false);
  assert.equal(familyCtrl.isFamilyCapable({ role: "admin" }), true);
});

test("family path: a beneficiary cannot self-initiate a family case", async () => {
  const beneficiary = { _id: "ben2", role: "beneficiary", email: "ben2@example.com" };
  const res = fakeRes();
  await familyCtrl.createFamilyCase({ user: beneficiary, body: { beneficiaryEmail: "someone@example.com" } }, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /petitioner/i);
});

test("family path: canAccessFamilyCase scopes petitioner and beneficiary separately", () => {
  const petitionerId = "60d0fe4f5311236168a109ca";
  const beneficiaryId = "60d0fe4f5311236168a109cb";
  const strangerId = "60d0fe4f5311236168a109cc";
  const caseData = {
    petitionerUser: petitionerId,
    beneficiaryUser: beneficiaryId,
    beneficiaryInvite: { email: "invited@example.com" },
  };
  assert.equal(familyCtrl.canAccessFamilyCase({ _id: petitionerId, role: "client" }, caseData), true, "petitioner must access their case");
  assert.equal(familyCtrl.canAccessFamilyCase({ _id: beneficiaryId, role: "beneficiary" }, caseData), true, "beneficiary must access their case");
  assert.equal(familyCtrl.canAccessFamilyCase({ _id: "someoneElse", role: "beneficiary", email: "invited@example.com" }, caseData), true, "an invited beneficiary matched by email must access their case");
  // A genuinely unrelated client — no overlap with ANY field on the case,
  // family or otherwise — must be rejected.
  assert.equal(familyCtrl.canAccessFamilyCase({ _id: strangerId, role: "client" }, caseData), false, "an unrelated client must NOT access the case");
});

test("family path: canAccessFamilyCase's own logic never reads employerUser/employeeUser (no field overload) — proven by source inspection, not just behavior, since the shared caseService.canAccessCase fallback legitimately knows about those fields for the employer/employee path and would mask a behavioral-only check", () => {
  const source = familyCtrl.canAccessFamilyCase.toString();
  assert.doesNotMatch(source, /employerUser/, "canAccessFamilyCase must never reference employerUser");
  assert.doesNotMatch(source, /employeeUser/, "canAccessFamilyCase must never reference employeeUser");
  assert.match(source, /petitionerUser/, "canAccessFamilyCase must use its own petitionerUser field");
  assert.match(source, /beneficiaryUser/, "canAccessFamilyCase must use its own beneficiaryUser field");
});

test("family path: routes are registered and role-gated (beneficiary cannot create, client can)", () => {
  const registered = routesOf(familyRoutes);
  ["GET /me", "POST /cases", "POST /:id/invite-beneficiary", "POST /:id/submit"].forEach((route) =>
    assert.ok(registered.includes(route), `${route} is missing from family-workflow.routes.js`));

  const createRoute = familyRoutes.stack.find((layer) => layer.route?.path === "/cases" && layer.route.methods.post).route;
  const authorize = createRoute.stack[1].handle; // [0]=authenticate, [1]=authorizeRoles
  let rejectedStatus;
  authorize({ user: { role: "beneficiary" } }, { status(code) { rejectedStatus = code; return this; }, json() { return this; } }, () => {});
  assert.equal(rejectedStatus, 403, "beneficiary role must be rejected by the route-level gate on POST /cases");

  let nextCalled = false;
  authorize({ user: { role: "client" } }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true, "client role must pass the route-level gate on POST /cases");
});

// ── Roles, Case fields, visa types (Stage 1, additive) ──
test("roles: 'beneficiary' is a valid User role without disturbing employer/employee roles", () => {
  const { CANONICAL_ROLES } = require("../../authorization/roleHierarchy");
  assert.ok(CANONICAL_ROLES.includes("beneficiary"));
  assert.ok(CANONICAL_ROLES.includes("employer"));
  assert.ok(CANONICAL_ROLES.includes("employee"));
});

test("checklist roles: 'petitioner'/'beneficiary' are valid Questionnaire.checklistRole values alongside 'employer'/'employee'", () => {
  ["employer", "employee", "petitioner", "beneficiary"].forEach((checklistRole) => {
    const doc = new Questionnaire({ key: `role-check-${checklistRole}`, title: "t", version: 1, checklistRole, sections: [], questions: [] });
    const error = doc.validateSync();
    assert.equal(error?.errors?.checklistRole, undefined, `checklistRole "${checklistRole}" should validate`);
  });
});

test("Case model: new family fields coexist with employer/employee fields, all fields save-able together (schema-level, no DB write)", () => {
  const doc = new Case({
    caseNumber: "TEST-FAMILY-1",
    visaType: "K1",
    // Family fields
    petitionerUser: "60d0fe4f5311236168a109ca",
    beneficiaryUser: "60d0fe4f5311236168a109cb",
    beneficiaryInvite: { email: "b@example.com", status: "sent" },
    familyCompletionMode: "invite_beneficiary",
    familyWorkflow: { petitionerStatus: "in_progress", beneficiaryStatus: "invited", caseManagerStatus: "waiting_for_beneficiary" },
    // Employer/employee fields populated simultaneously, untouched shape,
    // proving no overload/collision between the two parallel paths.
    employerUser: "60d0fe4f5311236168a109cc",
    employeeUser: "60d0fe4f5311236168a109cd",
    employerEmployeeWorkflow: { employerStatus: "in_progress", employeeStatus: "invited", caseManagerStatus: "waiting_for_employee" },
  });
  const error = doc.validateSync();
  assert.equal(error, undefined, error?.message);
  assert.equal(doc.familyWorkflow.caseManagerStatus, "waiting_for_beneficiary");
  assert.equal(doc.employerEmployeeWorkflow.caseManagerStatus, "waiting_for_employee");
  assert.equal(String(doc.petitionerUser), "60d0fe4f5311236168a109ca");
  assert.equal(String(doc.employerUser), "60d0fe4f5311236168a109cc");
});

// ── Visa types (Stage 1) ──
test("visa types: K1 and K3 are registered", () => {
  assert.equal(VISA_TYPES.K1, "K1");
  assert.equal(VISA_TYPES.K3, "K3");
});

// ── Scaffold templates (Stage 3) — content deferral proof ──
test("family registry matches K-1/K-3 and nothing else", () => {
  assert.equal(familyRegistry.getDefinition("K-1")?.key, "k1");
  assert.equal(familyRegistry.getDefinition("K1")?.key, "k1");
  assert.equal(familyRegistry.getDefinition("K-3")?.key, "k3");
  assert.equal(familyRegistry.hasDefinition("H-1B"), false);
  assert.equal(familyRegistry.hasDefinition("O1"), false);
});

test("family templates: 4 templates registered (K1 real content x petitioner/beneficiary, K3 x petitioner/beneficiary)", () => {
  assert.equal(FAMILY_CHECKLIST_DEFINITIONS.length, 4);
  FAMILY_CHECKLIST_DEFINITIONS.forEach((def) => {
    assert.ok(["petitioner", "beneficiary"].includes(def.checklistRole));
    assert.ok(["K1", "K3"].includes(def.visaType));
  });
});

// K-3 real content (this phase) — its own separate templates, Q&A identical
// to K-1 (reused directly from k1.js — see k3.js's file banner), documents
// per K-3's own marriage-based list.
test("K-3 petitioner checklist: real content matches the authoritative source counts/fidelity", () => {
  const def = FAMILY_CHECKLIST_DEFINITIONS.find((d) => d.key === "k3_petitioner_checklist");
  assert.ok(def, "k3_petitioner_checklist must exist");
  assert.equal(def.visaType, "K3");
  assert.equal(def.checklistRole, "petitioner");
  assert.doesNotMatch(def.description || "", /SCAFFOLD/i, "K-3 petitioner checklist must no longer be marked as a scaffold");

  const section1Key = "information_about_you_u_s_sponsor_petitioner";
  const section1Fields = def.questions.filter((q) => q.sectionKey === section1Key);
  assert.equal(section1Fields.length, 15, "petitioner section 1 must have exactly 15 fields");
  assert.ok(section1Fields.some((q) => /USCIS Online Account Number/i.test(q.label)), "petitioner must have a USCIS Online Account Number field");

  const parentFields = def.questions.filter((q) => q.metadata?.sourcePath?.includes(".parents."));
  assert.equal(parentFields.length, 14, "petitioner must have exactly 14 parent fields");

  const repeatingGroups = def.questions.filter((q) => q.repeatable);
  assert.equal(repeatingGroups.length, 4, "petitioner must have 4 repeating groups (residential, employment, prior spouses, states/countries since 18)");
  repeatingGroups.forEach((q) => {
    assert.equal(q.type, "repeating_group");
    assert.ok(Array.isArray(q.metadata?.fields) && q.metadata.fields.length > 0, `${q.key} repeating group must carry its row columns in metadata.fields for the frontend's Add/Remove UI`);
  });

  // K-3's OWN document list — 8 items, different from K-1's 9.
  const documents = def.questions.filter((q) => q.type === "file");
  assert.equal(documents.length, 8, "K-3 petitioner must have exactly 8 documents");
  assert.ok(documents.some((d) => d.key === "petitioner_i130_receipt_notice"), "K-3 must add the I-130 receipt notice document");
  assert.ok(documents.some((d) => d.key === "petitioner_marriage_certificate_and_photos"), "K-3 must add the marriage certificate/photos document");
  assert.ok(!documents.some((d) => d.key === "petitioner_met_in_person_photos"), "K-3 must NOT have K-1's met-in-person photos document");
  assert.ok(!documents.some((d) => d.key === "petitioner_intent_to_marry_letter"), "K-3 must NOT have K-1's 90-day intent-to-marry letter");
});

test("K-3 beneficiary checklist: real content matches the authoritative source counts/fidelity, header differs from K-1", () => {
  const def = FAMILY_CHECKLIST_DEFINITIONS.find((d) => d.key === "k3_beneficiary_checklist");
  assert.ok(def, "k3_beneficiary_checklist must exist");
  assert.equal(def.visaType, "K3");
  assert.equal(def.checklistRole, "beneficiary");
  assert.match(def.title, /Spouse of US Citizen/, "K-3 beneficiary header must reference Spouse, not Fiancee");

  const section1Key = "information_about_the_beneficiary";
  const section1Fields = def.questions.filter((q) => q.sectionKey === section1Key);
  assert.equal(section1Fields.length, 14, "beneficiary section 1 must have exactly 14 fields (no USCIS account number)");

  const repeatingGroups = def.questions.filter((q) => q.repeatable);
  assert.equal(repeatingGroups.length, 4, "beneficiary must have 4 repeating groups");

  // K-3's OWN document list — 4 items, different from K-1's 4 (National ID
  // swapped in for the intent-to-marry letter).
  const documents = def.questions.filter((q) => q.type === "file");
  assert.equal(documents.length, 4, "K-3 beneficiary must have exactly 4 documents");
  assert.ok(documents.some((d) => d.key === "beneficiary_national_identity_card"), "K-3 must add the National identity card document");
  assert.ok(!documents.some((d) => d.key === "beneficiary_intent_to_marry_letter"), "K-3 must NOT have K-1's 90-day intent-to-marry letter");

  // Sections 13/14 retained verbatim (flagged as possibly-inapplicable for a
  // spouse-based visa, per sign-off) — same typo-corrected wording as K-1.
  assert.ok(def.sections.includes("Did you meet your wife through any International Marriage Broker:"));
  assert.ok(def.sections.includes("Has your Fiancé met and seen you within the two year period immediately preceding the filing of this petition?"));
});

test("K-3-vs-K-1 diff: Q&A sections are identical, only the beneficiary header and document lists differ", () => {
  const k1Petitioner = FAMILY_CHECKLIST_DEFINITIONS.find((d) => d.key === "k1_petitioner_checklist");
  const k3Petitioner = FAMILY_CHECKLIST_DEFINITIONS.find((d) => d.key === "k3_petitioner_checklist");
  const k1Beneficiary = FAMILY_CHECKLIST_DEFINITIONS.find((d) => d.key === "k1_beneficiary_checklist");
  const k3Beneficiary = FAMILY_CHECKLIST_DEFINITIONS.find((d) => d.key === "k3_beneficiary_checklist");

  const nonDocQuestions = (def) => def.questions.filter((q) => q.type !== "file").map((q) => ({ key: q.key, label: q.label, type: q.type, required: q.required, repeatable: q.repeatable }));
  assert.deepEqual(nonDocQuestions(k3Petitioner), nonDocQuestions(k1Petitioner), "K-3 petitioner Q&A must be field-for-field identical to K-1's");
  assert.deepEqual(nonDocQuestions(k3Beneficiary), nonDocQuestions(k1Beneficiary), "K-3 beneficiary Q&A must be field-for-field identical to K-1's");

  assert.equal(k3Petitioner.title, k1Petitioner.title, "petitioner header is identical for K-1 and K-3");
  assert.notEqual(k3Beneficiary.title, k1Beneficiary.title, "beneficiary header must differ (Spouse vs Fiancee)");
});

// K-1 real content (this phase) — verbatim fidelity + structural counts per
// the authoritative source ("Information Required from U.S Sponsor/
// Petitioner" / "Information Required from Beneficiary").
test("K-1 petitioner checklist: real content matches the authoritative source counts/fidelity", () => {
  const def = FAMILY_CHECKLIST_DEFINITIONS.find((d) => d.key === "k1_petitioner_checklist");
  assert.ok(def, "k1_petitioner_checklist must exist");
  assert.equal(def.visaType, "K1");
  assert.equal(def.checklistRole, "petitioner");
  assert.doesNotMatch(def.description || "", /SCAFFOLD/i, "K-1 petitioner checklist must no longer be marked as a scaffold");

  const section1Key = "information_about_you_u_s_sponsor_petitioner";
  const section1Fields = def.questions.filter((q) => q.sectionKey === section1Key);
  assert.equal(section1Fields.length, 15, "petitioner section 1 must have exactly 15 fields");
  assert.ok(section1Fields.some((q) => /USCIS Online Account Number/i.test(q.label)), "petitioner must have a USCIS Online Account Number field");

  const parentFields = def.questions.filter((q) => q.metadata?.sourcePath?.includes(".parents."));
  assert.equal(parentFields.length, 14, "petitioner must have exactly 14 parent fields");

  const repeatingGroups = def.questions.filter((q) => q.repeatable);
  assert.equal(repeatingGroups.length, 4, "petitioner must have 4 repeating groups (residential, employment, prior spouses, states/countries since 18)");
  repeatingGroups.forEach((q) => {
    assert.equal(q.type, "repeating_group");
    assert.ok(Array.isArray(q.metadata?.fields) && q.metadata.fields.length > 0, `${q.key} repeating group must carry its row columns in metadata.fields for the frontend's Add/Remove UI`);
  });

  const documents = def.questions.filter((q) => q.type === "file");
  assert.equal(documents.length, 9, "petitioner must have exactly 9 documents");

  const certificateNumber = def.questions.find((q) => q.key === "petitioner_citizenship_certificateNumber");
  assert.ok(certificateNumber.conditionalLogic.rules.length, "certificate number must be conditional on having a certificate");
  const i129fLastName = def.questions.find((q) => q.key === "petitioner_i129f_lastName");
  assert.ok(i129fLastName.conditionalLogic.rules.length, "I-129F detail fields must be conditional");
});

test("K-1 beneficiary checklist: real content matches the authoritative source counts/fidelity, and differs from the petitioner exactly where the source does", () => {
  const def = FAMILY_CHECKLIST_DEFINITIONS.find((d) => d.key === "k1_beneficiary_checklist");
  assert.ok(def, "k1_beneficiary_checklist must exist");
  assert.equal(def.visaType, "K1");
  assert.equal(def.checklistRole, "beneficiary");
  assert.doesNotMatch(def.description || "", /SCAFFOLD/i, "K-1 beneficiary checklist must no longer be marked as a scaffold");

  const section1Key = "information_about_the_beneficiary";
  const section1Fields = def.questions.filter((q) => q.sectionKey === section1Key);
  assert.equal(section1Fields.length, 14, "beneficiary section 1 must have exactly 14 fields (no USCIS account number)");
  assert.ok(!section1Fields.some((q) => /USCIS Online Account Number/i.test(q.label)), "beneficiary must NOT have a USCIS Online Account Number field");

  const parentFields = def.questions.filter((q) => q.metadata?.sourcePath?.includes(".parents."));
  assert.equal(parentFields.length, 14, "beneficiary must have exactly 14 parent fields");

  const repeatingGroups = def.questions.filter((q) => q.repeatable);
  assert.equal(repeatingGroups.length, 4, "beneficiary must have 4 repeating groups (residential, employment, prior spouses, children)");
  repeatingGroups.forEach((q) => {
    assert.equal(q.type, "repeating_group");
    assert.ok(Array.isArray(q.metadata?.fields) && q.metadata.fields.length > 0, `${q.key} repeating group must carry its row columns in metadata.fields for the frontend's Add/Remove UI`);
  });

  const documents = def.questions.filter((q) => q.type === "file");
  assert.equal(documents.length, 4, "beneficiary must have exactly 4 documents");

  // Beneficiary-only sections 6-14 must exist, petitioner-only sections must not.
  assert.ok(def.sections.includes("Have you ever been to the United States?"));
  assert.ok(def.sections.includes("Has your Fiancé met and seen you within the two year period immediately preceding the filing of this petition?"));
  assert.ok(!def.sections.some((title) => title.includes("US citizen Through")), "beneficiary must not have the petitioner's citizenship section");

  const metWithinTwoYears = def.questions.find((q) => q.key === "beneficiary_metWithinTwoYears");
  assert.ok(metWithinTwoYears.required, "met-within-two-years is required per the required-map");
});

test("employer/employee templates are unaffected in count (still 9 — H1B x2, L1A x3, P x2, O1 x2)", () => {
  assert.equal(EMPLOYMENT_CHECKLIST_DEFINITIONS.length, 9);
});
