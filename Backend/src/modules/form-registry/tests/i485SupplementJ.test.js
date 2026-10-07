// I-485 Supplement J (form code I-485J) provisioning. DB-free: the REAL seed rows (visaFormMappings.seed.js) stand in
// for the VisaFormMapping collection and the REAL resolver / registryAutoCreateTemplates / ensureAssignedForms run
// against them - only the Mongo reads/writes and the template lookup are stubbed. So a pass means the form is actually
// provisioned during case initialization for the right case types, not merely present in the registry.
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const CaseForm = require("../../../models/CaseForm");
const Answer = require("../../../models/Answer");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const visaFormMappingService = require("../visaFormMapping.service");
const { mappings: SEED_ROWS } = require("../seeds/visaFormMappings.seed");

const SUPP_J = "I-485J";
const AOS = "ADJUSTMENT_OF_STATUS";

// Every active template the registry could point at: any form code a seed row references gets a stub template whose
// visaTypes are derived from the registry itself (exactly what deriveVisaTypesFromRegistry does for the real one).
function templateFor(formCode) {
  const wanted = String(formCode).toLowerCase();
  const rows = SEED_ROWS.filter((row) => String(row.formTemplateFormCode || "").toLowerCase() === wanted);
  if (!rows.length) return null;
  return {
    _id: `tpl-${wanted}`,
    formCode: String(formCode).toUpperCase(),
    version: "test",
    status: "active",
    activeFlag: true,
    officialStatus: "current",
    visaTypes: [...new Set(rows.map((row) => row.visaType))],
    assignmentRules: {},
  };
}

function stubRegistry(t) {
  t.after(() => mock.restoreAll());
  mock.method(VisaFormMapping, "find", (query) => {
    const rows = SEED_ROWS.filter((row) => row.visaType === query.visaType && (query.active === undefined || row.active !== false));
    return { lean: async () => rows.map((row, index) => ({ _id: `${row.visaType}:${row.formNumber}:${index}`, active: true, ...row })) };
  });
  mock.method(uscisFormService, "findLatestActiveTemplate", async (formCode) => templateFor(formCode));
}

async function provisionedFormCodes(visaType, extra = {}) {
  const caseData = { visaType, processingPath: AOS, ...extra };
  const templates = await visaFormMappingService.registryAutoCreateTemplates(caseData, null, null);
  return templates.map((template) => String(template.formCode).toUpperCase());
}

const GETS_SUPPLEMENT_J = [
  ["EB-1B", "EB-1B outstanding professor/researcher"],
  ["EB-1C", "EB-1C multinational manager/executive"],
  ["EB-2 PERM", "EB-2 PERM / employer-sponsored"],
  ["EB-3 Skilled Worker", "EB-3 skilled worker"],
  ["EB-3 Professional", "EB-3 professional"],
  ["EB-3 Other Worker", "EB-3 other worker"],
  ["F4", "F4 (added at the business owner's explicit request)"],
];

for (const [visaType, label] of GETS_SUPPLEMENT_J) {
  test(`${label} is provisioned I-485 + I-485 Supplement J`, async (t) => {
    stubRegistry(t);
    const codes = await provisionedFormCodes(visaType);
    assert.ok(codes.includes("I-485"), `${visaType} should get I-485 (got ${codes.join(", ")})`);
    assert.ok(codes.includes(SUPP_J), `${visaType} should get ${SUPP_J} (got ${codes.join(", ")})`);
  });
}

const NO_SUPPLEMENT_J = [
  ["EB-1A", "EB-1A extraordinary ability (no job offer)"],
  ["EB-2 NIW", "EB-2 NIW (job-offer requirement waived)"],
  ["F1", "F1"],
  ["F2A", "F2A"],
  ["F2B", "F2B"],
  ["F3", "F3"],
  ["IR-1", "IR-1 spouse"],
  ["CR-1", "CR-1 spouse"],
];

for (const [visaType, label] of NO_SUPPLEMENT_J) {
  test(`${label} gets I-485 but NOT I-485 Supplement J`, async (t) => {
    stubRegistry(t);
    const codes = await provisionedFormCodes(visaType);
    assert.ok(codes.includes("I-485"), `${visaType} should still get I-485 (got ${codes.join(", ")})`);
    assert.ok(!codes.includes(SUPP_J), `${visaType} must not get ${SUPP_J}`);
  });
}

test("Supplement J is gated on adjustment of status - never provisioned for a consular/petition-only case", async (t) => {
  stubRegistry(t);
  const consular = await provisionedFormCodes("EB-3 Skilled Worker", { processingPath: "CONSULAR" });
  assert.ok(!consular.includes(SUPP_J));
  assert.ok(!consular.includes("I-485"));
});

test("the registry carries Supplement J on exactly the intended case types", () => {
  const types = SEED_ROWS.filter((row) => row.formNumber === "I-485 Supplement J").map((row) => row.visaType).sort();
  assert.deepEqual(types, ["EB-1B", "EB-1C", "EB-2", "EB-2 PERM", "EB-3", "EB-3 Other Worker", "EB-3 Professional", "EB-3 Skilled Worker", "F4"]);
  for (const row of SEED_ROWS.filter((r) => r.formNumber === "I-485 Supplement J")) {
    assert.equal(row.formTemplateFormCode, "i-485j");
    assert.equal(row.componentType, "SUPPLEMENT");
    assert.equal(row.parentForm, "I-485");
    assert.notEqual(row.provisioningType, "AUTO_CREATE", "never universally required just because I-485 is present");
  }
});

test("case initialization (ensureAssignedForms) creates a CaseForm for I-485J on an eligible case", async (t) => {
  stubRegistry(t);
  const created = [];
  mock.method(CaseForm, "create", async (doc) => {
    created.push(doc);
    return { ...doc, _id: `cf-${created.length}`, auditHistory: [], save: async () => {} };
  });
  const caseData = {
    _id: "case-1", visaType: "EB-3 Skilled Worker", processingPath: AOS, uscisFormReferences: [], timeline: [], activityLog: [],
    save: async () => {},
  };
  const chain = (value) => { const q = { select: () => q, lean: () => q, sort: () => q, limit: () => q, read: () => q, maxTimeMS: () => q, then: (resolve) => resolve(value) }; return q; };
  mock.method(Answer, "find", () => chain([]));
  mock.method(CaseForm, "find", () => chain([]));
  mock.method(CaseForm, "deleteMany", async () => ({}));
  try {
    await uscisFormService.ensureAssignedForms(caseData, { _id: "u1", role: "admin" }, null, {
      templates: await visaFormMappingService.registryAutoCreateTemplates(caseData, null, null),
    });
  } catch (error) {
    // Anything past the CaseForm.create loop (timeline/audit persistence) is out of scope for this stub harness.
    if (!created.length) throw error;
  }
  const formCodes = created.map((doc) => String(doc.formCode).toUpperCase());
  assert.ok(formCodes.includes(SUPP_J), `CaseForm for ${SUPP_J} should be created (created: ${formCodes.join(", ")})`);
});
