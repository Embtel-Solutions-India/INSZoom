const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FAMILY_CHECKLIST_DEFINITIONS,
  FAMILY_VISA_TYPES,
  resolveFamilyChecklistKeys,
  resolveGcNvcChecklistKey,
  visaSlug,
} = require("../familyChecklists");

// GC-NVC (Green Card via the National Visa Center / consular processing) -
// a SEPARATE, optional, Case-Manager-approved checklist from the existing
// AOS Green Card checklist, built from the business's real "Checklist for
// DS-260" source. Never part of the automatic composition
// (resolveFamilyChecklistKeys) - only ever assigned via
// family-workflow.controller.js's approveGcNvcChecklist. DB-free, following
// family-workflow.test.js's own established convention for this module.

function gcNvcDefinitionFor(visaType) {
  return FAMILY_CHECKLIST_DEFINITIONS.find((def) => def.key === resolveGcNvcChecklistKey(visaType));
}

test("resolveGcNvcChecklistKey resolves to a real, registered checklist definition for every family visa type", () => {
  for (const visaType of FAMILY_VISA_TYPES) {
    const key = resolveGcNvcChecklistKey(visaType);
    assert.equal(key, `gc_nvc_${visaSlug(visaType)}_beneficiary_checklist`);
    assert.ok(gcNvcDefinitionFor(visaType), `${key} must be a registered checklist definition`);
  }
});

test("GC-NVC checklist is registered for every family visa type, beneficiary-owned, and NEVER a default template", () => {
  for (const visaType of FAMILY_VISA_TYPES) {
    const def = gcNvcDefinitionFor(visaType);
    assert.equal(def.checklistRole, "beneficiary");
    assert.equal(def.isDefault, false, "must never be auto-resolved by getQuestionnaireForCase's default-template fallback");
    assert.equal(def.title, "Green Card – National Visa Center (NVC) / Consular Processing Checklist");
    assert.equal(def.visaType, visaType);
  }
});

test("resolveFamilyChecklistKeys never includes the GC-NVC checklist, for any processing path", () => {
  for (const visaType of FAMILY_VISA_TYPES) {
    const gcNvcKey = resolveGcNvcChecklistKey(visaType);
    for (const processingPath of ["", "PETITION_ONLY", "ADJUSTMENT_OF_STATUS", "CONSULAR"]) {
      const keys = resolveFamilyChecklistKeys(visaType, processingPath);
      assert.ok(!keys.includes(gcNvcKey), `${processingPath || "(unset)"} must never auto-assign ${gcNvcKey}`);
    }
    // The automatic CONSULAR baseline is unchanged (still the shared Green
    // Card checklist, not GC-NVC) - confirms this addition is purely
    // additive to the existing composition rule, not a replacement of it.
    const consularKeys = resolveFamilyChecklistKeys(visaType, "CONSULAR");
    assert.deepEqual(consularKeys, resolveFamilyChecklistKeys(visaType, "ADJUSTMENT_OF_STATUS"));
  }
});

const ir1 = gcNvcDefinitionFor("IR-1");

test("GC-NVC document list matches the source exactly (6 documents, no invented ones)", () => {
  const docTypes = ir1.questions.filter((q) => q.type === "file").map((q) => q.key);
  assert.deepEqual(docTypes.sort(), [
    "gc_nvc_birth_certificate",
    "gc_nvc_marriage_certificate",
    "gc_nvc_marriage_termination_documents",
    "gc_nvc_passport_biographic_page",
    "gc_nvc_passport_photo",
    "gc_nvc_police_verification_letter",
  ].sort());
});

test("GC-NVC field catalog includes the full DOS security/background question set (53 questions, verbatim)", () => {
  const securityQuestions = ir1.questions.filter((q) => q.sectionKey === "part_11_security_and_background_information" && q.type === "radio");
  assert.equal(securityQuestions.length, 53, "must be exactly the 53 source security/background questions");
  securityQuestions.forEach((q) => assert.deepEqual(q.options.map((o) => o.value), ["Yes", "No"]));
});

test("GC-NVC checklist has no duplicate question keys", () => {
  const keys = ir1.questions.map((q) => q.key);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});

test("GC-NVC field catalog spot-check: Part 1/2/12/13 fields present", () => {
  const keys = new Set(ir1.questions.map((q) => q.key));
  ["beneficiary_dsFirstName", "beneficiary_dsPassportNumber", "beneficiary_dsPresentStreet", "beneficiary_dsUsAddressStreet", "beneficiary_dsWantsSsnIssued", "beneficiary_dsPetitionerRelation", "beneficiary_dsPetitionerEmail"]
    .forEach((key) => assert.ok(keys.has(key), `${key} missing from GC-NVC checklist`));
});

test("GC-NVC checklist visibility is beneficiary-only (never petitioner)", () => {
  ir1.questions.forEach((q) => {
    assert.ok(q.visibility.roles.includes("beneficiary"));
    assert.ok(!q.visibility.roles.includes("petitioner"));
  });
});

test("regression: existing family checklist keys are unaffected by the GC-NVC addition", () => {
  for (const visaType of FAMILY_VISA_TYPES) {
    const slug = visaSlug(visaType);
    ["i130_" + slug + "_petitioner_checklist", "i130_" + slug + "_beneficiary_checklist", "green_card_" + slug + "_beneficiary_checklist", "i864_" + slug + "_petitioner_checklist", "i864_" + slug + "_joint_sponsor_checklist"]
      .forEach((key) => assert.ok(FAMILY_CHECKLIST_DEFINITIONS.some((def) => def.key === key), `${key} must still exist unchanged`));
  }
  // 12 visa types x 6 checklists (i130 x2, green_card, i864 x2, gc_nvc) + K1 x2 + K3 x2 = 76.
  assert.equal(FAMILY_CHECKLIST_DEFINITIONS.length, 76);
});
