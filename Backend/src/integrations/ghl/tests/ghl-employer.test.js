const test = require("node:test");
const assert = require("node:assert/strict");

const { namesCompatible, companyTokens, normalizeEmail } = require("../ghlEmployerMatching");
const { planFromResolution } = require("../ghlVisaService");
const { checklistForRole } = require("../ghlEmployerService");

// ---- company name comparison (conservative on purpose) ------------------------

test("legal suffixes and punctuation are ignored", () => {
  assert.deepEqual(companyTokens("ABC Technologies, Inc."), ["abc", "technologies"]);
  assert.equal(namesCompatible("ABC Technologies Inc", "abc technologies"), true);
  assert.equal(namesCompatible("ABC Technologies, LLC", "ABC Technologies Corporation"), true);
});

test("an abbreviation or a shorter form of the same company is compatible", () => {
  assert.equal(namesCompatible("ABC Tech LLC", "ABC Technologies Inc"), true);
  assert.equal(namesCompatible("ABC", "ABC Technologies"), true);
  assert.equal(namesCompatible("ABC Technologies", "ABC Technologies Group Holdings"), true);
});

test("a different company is NOT compatible, even with a shared first word", () => {
  assert.equal(namesCompatible("ABC Technologies", "ABC Staffing"), false);
  assert.equal(namesCompatible("ABC Technologies", "Totally Different Corp"), false);
  assert.equal(namesCompatible("Acme Foods", "Acme Robotics"), false);
});

test("nothing to compare means no objection", () => {
  assert.equal(namesCompatible("", "ABC"), true);
  assert.equal(namesCompatible(undefined, undefined), true);
  assert.equal(namesCompatible("Inc", "ABC"), true); // a name that is only a legal suffix is empty
});

test("emails are normalised before matching", () => {
  assert.equal(normalizeEmail("  HR@ABC.com "), "hr@abc.com");
  assert.equal(normalizeEmail(undefined), "");
});

// ---- routing rules ----------------------------------------------------------------

const employerResolution = { status: "mapped", structure: "employer_employee", visaType: "TN", petitionSubType: "", category: "non_immigrant", field: "work_visa", value: "TN - NAFTA Professionals" };
const familyResolution = { ...employerResolution, structure: "family", visaType: "K-1" };

test("an employer visa is applied ONLY on the employer-intake path", () => {
  const intake = planFromResolution(employerResolution, { allowEmployer: true });
  assert.equal(intake.applied, true);
  assert.deepEqual(intake.fields, { visaType: "TN", visaCategory: "TN", petitionType: "TN", visaSelectionStatus: "selected" });
  assert.deepEqual(intake.attention, []);

  const existingIndividualCard = planFromResolution(employerResolution);
  assert.equal(existingIndividualCard.applied, false);
  assert.equal(existingIndividualCard.record.status, "structure_unsupported");
  assert.match(existingIndividualCard.attention[0], /never converted/);
});

test("a family visa is never applied here, even on the employer path", () => {
  assert.equal(planFromResolution(familyResolution, { allowEmployer: true }).applied, false);
});

test("an INCOMPLETE employer visa (needs a sub-type) is never routed to the employer path", () => {
  const incomplete = { ...employerResolution, status: "incomplete", visaType: "H-1B", reason: "H-1B needs a sub-type" };
  assert.equal(planFromResolution(incomplete, { allowEmployer: true }).applied, false);
});

// ---- checklist role filter parity with the existing controller -----------------------

test("checklist filtering matches the existing rule exactly", () => {
  const list = [
    { key: "a", targetRole: "employer" },
    { key: "b", targetRole: "employee" },
    { key: "c" },
    { key: "d", targetRole: "employee", questionnaireOnly: true },
  ];
  assert.deepEqual(checklistForRole(list, "employer").map((i) => i.key), ["a", "c"]);
  assert.deepEqual(checklistForRole(list, "employee").map((i) => i.key), ["b", "c"]); // questionnaireOnly never a case-level document
  assert.deepEqual(checklistForRole(undefined, "employee"), []);
});
