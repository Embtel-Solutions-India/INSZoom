// Phase 3H/3I live acceptance coverage for
// ChecklistFieldTraceabilityService.governanceDefects()/checklistHealth() -
// against the real seeded database, same convention as
// ChecklistFieldTraceabilityService.test.js (never mocks, never
// resets/deletes master-data collections - see test-utils/db.js's
// PROTECTED_COLLECTIONS).
const assert = require("node:assert/strict");
const test = require("node:test");

if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const ChecklistFieldTraceabilityService = require("../services/ChecklistFieldTraceabilityService");

async function activeTemplate(formCode) {
  return USCISFormTemplate.findOne({ status: "active", formCode }).select("_id formCode").lean();
}

test("isDocumentedGap: L-1B/I-129 and O-2/I-129 are documented GAPs (checklistMappings.seed.js's own inline comments), a random unmapped pair is not", async () => {
  assert.equal(ChecklistFieldTraceabilityService.isDocumentedGap("L-1B", "I-129"), true);
  assert.equal(ChecklistFieldTraceabilityService.isDocumentedGap("O-2", "I-907"), true);
  assert.equal(ChecklistFieldTraceabilityService.isDocumentedGap("EB-5 Regional Center", "I-526E"), true);
  assert.equal(ChecklistFieldTraceabilityService.isDocumentedGap("H-1B", "I-129"), false);
});

test("governanceDefects: I-129 returns a well-formed result (formCode, defects[], intentionalGaps[]) and every defect carries a recognized category", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129");
  const result = await ChecklistFieldTraceabilityService.governanceDefects(template._id);
  assert.equal(result.formCode, "I-129");
  assert.ok(Array.isArray(result.defects));
  assert.ok(Array.isArray(result.intentionalGaps));
  const RECOGNIZED_CATEGORIES = new Set([
    "INVALID_MAPPING_EDGE",
    "UNMAPPED_PDF_FIELD",
    "INACTIVE_MAPPING",
    "VISA_WITHOUT_CHECKLIST_MAPPING",
    "INVALID_CHECKLIST_REFERENCE",
    "INVALID_PARTICIPANT_MAPPING",
    "CONDITIONALLY_UNREACHABLE_MAPPING",
    "CHECKLIST_QUESTION_WITHOUT_CANONICAL_MAPPING",
  ]);
  [...result.defects, ...result.intentionalGaps].forEach((d) => assert.ok(RECOGNIZED_CATEGORIES.has(d.category), `unrecognized category ${d.category}`));
});

test("governanceDefects: L-1B on I-129 is reported as an intentional gap (documented in checklistMappings.seed.js), never as a defect", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129");
  const result = await ChecklistFieldTraceabilityService.governanceDefects(template._id);
  const l1b = result.intentionalGaps.find((g) => g.category === "VISA_WITHOUT_CHECKLIST_MAPPING" && g.visaType === "L-1B");
  assert.ok(l1b, "L-1B/I-129 must appear as an intentional gap");
  const flaggedAsDefect = result.defects.find((d) => d.category === "VISA_WITHOUT_CHECKLIST_MAPPING" && d.visaType === "L-1B");
  assert.equal(flaggedAsDefect, undefined, "L-1B/I-129 must never appear in the real defects list");
});

test("governanceDefects: invalid PDF-field mapping edges/unmapped fields on I-539A reuse MappingGraphService.validateGraph's own codes verbatim", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-539A");
  const result = await ChecklistFieldTraceabilityService.governanceDefects(template._id);
  const KNOWN_CODES = new Set(["INVALID_SOURCE", "INVALID_TARGET", "BROKEN_MAPPING", "BROKEN_REPEATING_MAPPING", "DUPLICATE_TARGET_MAPPING", "MISSING_FIELD_MAPPING", "MISSING_REQUIRED_MAPPING"]);
  result.defects
    .filter((d) => d.category === "INVALID_MAPPING_EDGE" || d.category === "UNMAPPED_PDF_FIELD")
    .forEach((d) => assert.ok(KNOWN_CODES.has(d.code), `expected an existing validateGraph code, got ${d.code}`));
});

test("checklistHealth: returns one row per production questionnaire with the required shape, and I-129F's checklists are recognized as direct-legacy-binding", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const rows = await ChecklistFieldTraceabilityService.checklistHealth();
  assert.ok(rows.length > 50, "expected the real questionnaire catalog (140+ latestVersion docs), not a fixture-sized list");
  const row = rows.find((r) => r.key === "h1b_employee_checklist");
  assert.ok(row, "h1b_employee_checklist must be present");
  ["key", "title", "checklistRole", "active", "applicable", "questionCount", "canonicalMappingCount", "unmappedQuestionCount", "conditionalSectionCount", "documentRequirementCount", "directLegacyBinding", "orphan", "notAssignedToLiveWorkflow", "scaffold", "invalidCanonicalPaths", "canonicalFieldsNoConsumer"]
    .forEach((field) => assert.ok(field in row, `row is missing "${field}"`));
  assert.equal(row.orphan, false, "h1b_employee_checklist is registered against H-1B/I-129 - must not be an orphan");

  const k1Petitioner = rows.find((r) => r.key === "k1_petitioner_checklist");
  assert.ok(k1Petitioner);
  assert.equal(k1Petitioner.directLegacyBinding, true, "I-129F binds directly to raw.questionnaireAnswers.<key>.value - Phase 2's own finding");
});

test("checklistHealth: a genuinely orphaned questionnaire (registered in no VisaFormMapping row and no active checklistTrigger) is flagged orphan", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const rows = await ChecklistFieldTraceabilityService.checklistHealth();
  // o1a_questionnaire is explicitly called out by checklistMappings.seed.js's
  // own "Sections 15/16/17" comment as NOT reused/attached by the seed.
  const orphanRow = rows.find((r) => r.key === "o1a_questionnaire");
  if (orphanRow) assert.equal(orphanRow.orphan, true, "o1a_questionnaire is not referenced by any VisaFormMapping.checklistMappings entry");
});
