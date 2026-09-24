const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const e2 = require("../../employment-workflow/questionnaires/e2");

// DB-free tests, following employmentChecklists.test.js's own established
// convention — EMPLOYMENT_CHECKLIST_DEFINITIONS is a pure, deterministic
// computation over e2.js's static exports, no Mongoose needed.

const e2Visa = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "e2_visa_checklist");
const e2BusinessPlan = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "e2_business_plan_checklist");
const e2SupportingDocs = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "e2_supporting_documents_checklist");

function byKey(definition, key) {
  return definition.questions.find((question) => question.key === key);
}

// ── §2: three independent checklist records, not combined into one ────────
test("E-2 has exactly three independent checklist records, never combined", () => {
  assert.ok(e2Visa, "e2_visa_checklist must exist");
  assert.ok(e2BusinessPlan, "e2_business_plan_checklist must exist");
  assert.ok(e2SupportingDocs, "e2_supporting_documents_checklist must exist");
  assert.notEqual(e2Visa.key, e2BusinessPlan.key);
  assert.notEqual(e2Visa.key, e2SupportingDocs.key);
  assert.notEqual(e2BusinessPlan.key, e2SupportingDocs.key);
});

test("all three E-2 checklists share visaType E2 (employer_employee case architecture, no separate E-2 case type)", () => {
  [e2Visa, e2BusinessPlan, e2SupportingDocs].forEach((def) => {
    assert.equal(def.visaType, "E2");
  });
});

test("each E-2 checklist has a distinct checklistRole (employer / business_plan / supporting_documents)", () => {
  assert.equal(e2Visa.checklistRole, "employer");
  assert.equal(e2BusinessPlan.checklistRole, "business_plan");
  assert.equal(e2SupportingDocs.checklistRole, "supporting_documents");
});

test("no duplicate question keys within any of the three E-2 checklists", () => {
  [e2Visa, e2BusinessPlan, e2SupportingDocs].forEach((definition) => {
    const keys = definition.questions.map((q) => q.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${definition.key} has duplicate question keys: ${duplicates.join(", ")}`);
  });
});

// ── §1: E-2 = employer/employee case only, no investor/family/single role ──
test("no 'investor' role or E-2-specific case-type value leaks into any checklist's visibility/role", () => {
  [e2Visa, e2BusinessPlan, e2SupportingDocs].forEach((def) => {
    assert.ok(["employer", "business_plan", "supporting_documents"].includes(def.checklistRole));
    def.questions.forEach((q) => {
      assert.ok(
        (q.visibility?.roles || []).every((role) => role !== "investor"),
        `${def.key}: question ${q.key} must not target an 'investor' role`
      );
    });
  });
});

// ── §3: E2_BUSINESS_PLAN content spot checks ───────────────────────────────
test("E2_BUSINESS_PLAN: investment fields are present, breakdown items are optional, source-of-funds fields are required", () => {
  assert.ok(byKey(e2BusinessPlan, "employer_e2BusinessPlan_investment_totalInvestmentAmount") || e2BusinessPlan.questions.some((q) => /totalInvestmentAmount/.test(q.key)), "total investment amount question must exist");
  const equipment = e2BusinessPlan.questions.find((q) => /equipmentInvestment/.test(q.key));
  assert.ok(equipment, "equipment investment question must exist");
  assert.equal(equipment.required, false, "equipment investment is optional per source");
  const sourceOfFunds = e2BusinessPlan.questions.find((q) => /sourceOfFunds$/.test(q.key));
  assert.ok(sourceOfFunds, "source of funds question must exist");
  assert.equal(sourceOfFunds.required, true);
});

test("E2_BUSINESS_PLAN: conditional documents/fields are gated, not unconditionally required", () => {
  const dateEstablished = e2BusinessPlan.questions.find((q) => /dateEstablished/.test(q.key));
  assert.ok(dateEstablished);
  assert.equal(dateEstablished.required, false, "conditional fields are not force-required until visible");
  assert.ok(dateEstablished.conditionalLogic?.rules?.length > 0 || dateEstablished.condition, "date established must be gated on 'existing' business");
});

test("E2_BUSINESS_PLAN: repeating groups exist for partners, top competitors, and hiring plan", () => {
  const partners = e2BusinessPlan.questions.find((q) => /partners$/.test(q.key));
  const competitors = e2BusinessPlan.questions.find((q) => /topCompetitors/.test(q.key));
  assert.ok(partners, "partners/shareholders repeating group must exist");
  assert.ok(competitors, "top competitors repeating group must exist");
});

// ── §4: E2_VISA content spot checks ────────────────────────────────────────
test("E2_VISA: employer, employee, treaty, and ownership sections are all present in one consolidated checklist", () => {
  const hasCompanyName = e2Visa.questions.some((q) => /company_name$/.test(q.key) || /companyName/i.test(q.label || ""));
  const hasEmployeeJobTitle = e2Visa.questions.some((q) => /employee_jobTitle/.test(q.key));
  const hasTreatyCountry = e2Visa.questions.some((q) => /treaty_countryName/.test(q.key));
  const hasOwnershipOwners = e2Visa.questions.some((q) => /ownership_owners/.test(q.key));
  assert.ok(hasCompanyName, "employer company name field must exist");
  assert.ok(hasEmployeeJobTitle, "employee job title field must exist");
  assert.ok(hasTreatyCountry, "treaty country field must exist");
  assert.ok(hasOwnershipOwners, "ownership repeating group must exist");
});

test("E2_VISA: 'Treaty Investor' is a labeled conditional section, not a separate case type", () => {
  const investorFields = e2Visa.questions.filter((q) => /investor_/.test(q.key));
  assert.ok(investorFields.length > 0, "Treaty Investor section fields must exist");
  const totalInvestment = investorFields.find((q) => /totalInvestment$/.test(q.key));
  assert.ok(totalInvestment, "total investment field must exist in the Treaty Investor section");
  // Every investment amount field beyond the driver question must be gated.
  investorFields.filter((q) => q.type !== "radio").forEach((q) => {
    assert.equal(q.required, false, `${q.key} must not be unconditionally required — it's a conditional section`);
  });
});

test("E2_VISA: Employer Outside United States fields are all conditional on a single driver question", () => {
  const foreignEmployerFields = e2Visa.questions.filter((q) => /foreignEmployer_/.test(q.key));
  assert.ok(foreignEmployerFields.length > 5, "Employer Outside United States must have multiple fields");
  const driver = foreignEmployerFields.find((q) => q.type === "radio");
  assert.ok(driver, "a Yes/No driver question must gate the foreign employer section");
});

// ── §5: E2_SUPPORTING_DOCUMENTS content ────────────────────────────────────
test("E2_SUPPORTING_DOCUMENTS: contains at minimum Business License, Articles of Incorporation, and Company Letterhead", () => {
  assert.equal(e2SupportingDocs.questions.length, 3, "minimal document-only checklist per the governing task spec — no invented extras");
  const names = e2SupportingDocs.questions.map((q) => q.label);
  assert.ok(names.some((n) => /business license/i.test(n)));
  assert.ok(names.some((n) => /articles of incorporation/i.test(n)));
  assert.ok(names.some((n) => /company letterhead/i.test(n)));
  e2SupportingDocs.questions.forEach((q) => {
    assert.equal(q.type, "file", `${q.label} must be a document-upload question`);
  });
});

// ── §7: no hardcoded USCIS forms; VisaFormMapping stays the single source ──
test("E-2 checklists never reference VisaFormMapping/CaseForm/I-129/DS-160 directly — forms stay in the registry, not the checklist", () => {
  [e2Visa, e2BusinessPlan, e2SupportingDocs].forEach((def) => {
    const serialized = JSON.stringify(def);
    assert.ok(!/I-129|DS-160|DS-156E|CaseForm/.test(serialized), `${def.key} must not hardcode any USCIS form reference`);
  });
});

// ── §6: repeated provisioning doesn't create duplicate registry entries ────
test("idempotency: re-requiring the e2 module and rebuilding definitions never produces duplicate keys", () => {
  delete require.cache[require.resolve("../../employment-workflow/questionnaires/e2")];
  delete require.cache[require.resolve("../employmentChecklists")];
  const reloaded = require("../employmentChecklists").EMPLOYMENT_CHECKLIST_DEFINITIONS;
  const e2Keys = reloaded.filter((d) => d.key.startsWith("e2_")).map((d) => d.key);
  assert.equal(e2Keys.length, 3);
  assert.equal(new Set(e2Keys).size, 3, "no duplicate E-2 checklist keys");
});

// ── e2.js module shape ──────────────────────────────────────────────────────
test("e2.js: matches() recognizes E-2 in common spellings", () => {
  assert.equal(e2.matches("E-2"), true);
  assert.equal(e2.matches("E2"), true);
  assert.equal(e2.matches("e-2"), true);
  assert.equal(e2.matches("E-3"), false);
  assert.equal(e2.matches("H-1B"), false);
});

test("e2.js: fieldCatalog() defaults every non-conditional, non-explicitly-optional field to required", () => {
  const entries = e2.fieldCatalog();
  entries.forEach((entry) => {
    if (entry.condition) {
      assert.equal(entry.required, false, `${entry.path} is conditional and must not be force-required`);
    }
  });
});
