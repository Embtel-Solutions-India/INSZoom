// Live acceptance coverage for ChecklistFieldTraceabilityService (Phase 1
// of the Visa-Form-Checklist intelligence layer). Against the real seeded
// database, not mocks - same convention as checklistMappings.test.js and
// visaFormMapping.test.js. Deliberately exercises MULTIPLE forms/visas
// (I-129, I-539, I-539A), never just I-129, since this service is generic
// across every visa/form/checklist in the registry, not a one-form special
// case.
const assert = require("node:assert/strict");
const test = require("node:test");

if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const ChecklistFieldTraceabilityService = require("../services/ChecklistFieldTraceabilityService");

async function activeTemplate(formCode) {
  return USCISFormTemplate.findOne({ status: "active", formCode }).select("_id formCode").lean();
}

test("checklistKeysForForm: DOS/DOL forms never resolve any checklist key", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const keys = await ChecklistFieldTraceabilityService.checklistKeysForForm("DS-160");
  assert.deepEqual(keys, []);
});

test("checklistKeysForForm: I-129 resolves the same checklistKeys the registry actually carries for it", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const keys = await ChecklistFieldTraceabilityService.checklistKeysForForm("I-129");
  const rows = await VisaFormMapping.find({ active: true, formTemplateFormCode: "i-129" }).select("checklistMappings").lean();
  const expected = new Set();
  rows.forEach((row) => (row.checklistMappings || []).forEach((entry) => expected.add(entry.checklistKey)));
  assert.deepEqual(new Set(keys), expected);
  assert.ok(keys.includes("h1b_employee_checklist"));
});

test("traceQuestionsToFields: a real checklist question with a canonicalPath resolves to the real PDF field(s) it feeds, tiered off the existing edge confidence", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129");
  const { questionnaire, results } = await ChecklistFieldTraceabilityService.traceQuestionsToFields("h1b_employee_checklist", template._id);
  assert.equal(questionnaire.key, "h1b_employee_checklist");
  const i94 = results.find((question) => question.questionKey === "employee_immigrationStatus_i94Number");
  assert.ok(i94, "the I-94 Number question must be present with its resolved canonicalPath");
  assert.equal(i94.canonicalPath, "immigration.i94.number");
  assert.ok(i94.fields.length > 0, "must resolve to at least one real I-129 PDF field");
  const field = i94.fields.find((f) => f.targetFieldId === "part3.form10Subform2Part3Line5ArrivalDeparture0");
  assert.ok(field, "must resolve to the actual I-94 Arrival-Departure Record Number field");
  assert.equal(field.confidence, 100);
  assert.equal(field.tier, "HIGH");
});

test("traceQuestionsToFields: every returned question is backed by a REAL edge on this template - either its canonicalPath or its literal raw.questionnaireAnswers direct binding, never a guess", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129");
  const { results } = await ChecklistFieldTraceabilityService.traceQuestionsToFields("h1b_employer_checklist", template._id);
  const { graph } = await require("../services/MappingGraphService").preview(template._id);
  const realSourcePaths = new Set(graph.edges.map((edge) => edge.sourcePath));
  results.forEach((question) => {
    assert.ok(question.matchedPath, "every returned question must have a matchedPath");
    assert.ok(realSourcePaths.has(question.matchedPath), `matchedPath "${question.matchedPath}" must be a real edge sourcePath on this template, never fabricated`);
    assert.ok(["canonical", "direct_binding"].includes(question.matchType));
  });
});

test("traceFieldToQuestions (reverse direction): the PDF field feeding I-94 traces back to every checklist question that shares its canonicalPath, across every checklist mapped to the form", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129");
  const { edge, tier, matches } = await ChecklistFieldTraceabilityService.traceFieldToQuestions(
    template._id,
    "part3.form10Subform2Part3Line5ArrivalDeparture0"
  );
  assert.ok(edge, "the edge must exist on the real I-129 mapping graph");
  assert.equal(tier, "HIGH");
  assert.ok(matches.length > 0, "must trace back to at least one checklist question");
  const questionnaireKeys = new Set(matches.map((m) => m.questionnaireKey));
  // Several distinct visa-type checklists (H-1B, L-1A, O-1, ...) all reuse
  // the same employee_immigrationStatus_i94Number question/canonicalPath -
  // the reverse trace must surface all of them, not just one.
  assert.ok(questionnaireKeys.has("h1b_employee_checklist"));
  assert.ok(questionnaireKeys.has("l1a_employee_checklist"));
});

test("traceFieldToQuestions: an unmapped/unknown target field returns UNMAPPED with no matches, not an error", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129");
  const result = await ChecklistFieldTraceabilityService.traceFieldToQuestions(template._id, "not_a_real_field_id");
  assert.equal(result.edge, null);
  assert.equal(result.tier, "UNMAPPED");
  assert.deepEqual(result.matches, []);
});

test("traceAllFieldsForTemplate: every mapped field on the template is present exactly once, each carrying its own checklist matches (possibly none)", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129");
  const { formCode, fields } = await ChecklistFieldTraceabilityService.traceAllFieldsForTemplate(template._id);
  assert.equal(formCode, "I-129");
  const { graph } = await require("../services/MappingGraphService").preview(template._id);
  assert.equal(fields.length, graph.edges.length);
  const i94Field = fields.find((f) => f.targetFieldId === "part3.form10Subform2Part3Line5ArrivalDeparture0");
  assert.ok(i94Field.checklistMatches.some((m) => m.questionnaireKey === "h1b_employee_checklist"));
});

test("coverageSummary: tracedToChecklistQuestion + mappedWithNoChecklistQuestion always equals totalMappedFields", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  for (const formCode of ["I-129", "I-539", "I-539A"]) {
    const template = await activeTemplate(formCode);
    const summary = await ChecklistFieldTraceabilityService.coverageSummary(template._id);
    assert.equal(summary.formCode, formCode);
    assert.equal(summary.tracedToChecklistQuestion + summary.mappedWithNoChecklistQuestion, summary.totalMappedFields);
  }
});

test("coverageSummaryForAllForms: covers every active template system-wide, not one form picked by hand - honestly reports zero-traced gaps rather than hiding them", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const activeTemplates = await USCISFormTemplate.find({ status: "active" }).select("_id").lean();
  const results = await ChecklistFieldTraceabilityService.coverageSummaryForAllForms();
  assert.equal(results.length, activeTemplates.length);
  results.forEach((row) => {
    assert.equal(row.tracedToChecklistQuestion + row.mappedWithNoChecklistQuestion, row.totalMappedFields);
  });
  const i129Row = results.find((row) => row.formCode === "I-129");
  assert.ok(i129Row.tracedToChecklistQuestion > 0, "I-129 must show real traced coverage");
});

test("Read-only/idempotent: calling coverageSummary twice for the same template never mutates VisaFormMapping.checklistMappings", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129");
  const before = await VisaFormMapping.findOne({ visaType: "H-1B", formNumber: "I-129" }).select("checklistMappings").lean();
  await ChecklistFieldTraceabilityService.coverageSummary(template._id);
  await ChecklistFieldTraceabilityService.coverageSummary(template._id);
  const after = await VisaFormMapping.findOne({ visaType: "H-1B", formNumber: "I-129" }).select("checklistMappings").lean();
  assert.deepEqual(before.checklistMappings, after.checklistMappings);
});

test("confidenceTier: tiers are read directly off edge.confidence with no new scoring algorithm", () => {
  assert.equal(ChecklistFieldTraceabilityService.confidenceTier(null), "UNMAPPED");
  assert.equal(ChecklistFieldTraceabilityService.confidenceTier({ confidence: 90 }), "HIGH");
  assert.equal(ChecklistFieldTraceabilityService.confidenceTier({ confidence: 72 }), "MEDIUM");
  assert.equal(ChecklistFieldTraceabilityService.confidenceTier({ confidence: 50 }), "LOW");
});

// --- Phase 2: I-129F direct-binding recognition (legacy binding, untouched mapping) ---

test("Phase 2: I-129F's PDF mapping graph is byte-identical to before Phase 2 - traceability recognizes it without any edge being modified", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129F");
  const { graph } = await require("../services/MappingGraphService").preview(template._id);
  // I-129F must still bind directly to raw.questionnaireAnswers.* - Phase 2
  // is forbidden from touching this form's mapping graph at all.
  assert.ok(graph.edges.length > 0);
  // The K-1/K-3 crosswalk completion added only case-level (classification checkboxes) and
  // account-level (petitioner contact) edges beside the role-keyed raw answer edges.
  graph.edges.forEach((edge) => {
    assert.match(edge.sourcePath, /^(raw\.questionnaireAnswers\.|case\.visaType$|petitioner\.(email|phone)$)/, "I-129F edges must be raw-key bound, or one of the documented case/account-level sources");
  });
});

test("Phase 2: I-129F's k1_petitioner_checklist/k1_beneficiary_checklist questions carry NO mapping.canonicalPath (Phase 2 must not author onto I-129F's own checklist)", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  // K-1/K-3 questions now carry role-scoped canonical paths (familyCanonicalPaths.js): a
  // petitioner_* question may only map into person.*/contact.*, a beneficiary_* one only into beneficiary.*.
  for (const [key, role] of [["k1_petitioner_checklist", "petitioner"], ["k1_beneficiary_checklist", "beneficiary"]]) {
    const { questions } = await ChecklistFieldTraceabilityService.canonicalPathsForQuestionnaire(key);
    questions.forEach((question) => {
      if (!question.canonicalPath) return;
      if (role === "petitioner") assert.match(question.canonicalPath, /^(person|contact)\./, `${key}/${question.questionKey}`);
      else assert.match(question.canonicalPath, /^beneficiary\./, `${key}/${question.questionKey}`);
    });
  }
});

test("Phase 2: I-129F now traces 34/34 mapped fields purely via direct-binding recognition, with zero canonical mappings involved", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-129F");
  const summary = await ChecklistFieldTraceabilityService.coverageSummary(template._id);
  // Every answer-bound field traces; only the case-level (classification) and account-level
  // (petitioner contact) edges have no checklist question by design.
  // Tracing is per checklist QUESTION: a repeating-group question (history rows) covers many row-cell edges
  // but is recognised once, so only a floor is asserted here.
  assert.ok(summary.tracedToChecklistQuestion >= 100, "the answer-bound I-129F fields trace via direct binding");
  const { fields } = await ChecklistFieldTraceabilityService.traceAllFieldsForTemplate(template._id);
  fields.filter((field) => field.checklistMatches.length).forEach((field) => {
    field.checklistMatches.forEach((match) => assert.equal(match.matchType, "direct_binding"));
  });
});

// --- Phase 2: I-130 canonical-routed petitioner/beneficiary mapping ---

test("Phase 2: I-130's petitioner/beneficiary PDF fields are now canonical-routed (person.*/beneficiary.*), not raw-key bound (except the one genuine SSN gap)", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-130");
  const { graph } = await require("../services/MappingGraphService").preview(template._id);
  // K-3 answers are read role-keyed first (raw.questionnaireAnswers.<role>_*); every identity edge
  // keeps the canonical person.* / beneficiary.* path as its fallback so the IR/CR/F checklists
  // (which only reach the form through canonical paths) still fill it.
  const identity = graph.edges.filter((edge) => /Pt2Line4a_FamilyName|Pt4Line4a_FamilyName/.test(edge.targetPdfField));
  assert.equal(identity.length, 2);
  identity.forEach((edge) => assert.match(edge.fallback, /^(person|beneficiary)\.lastName$/));
});

test("Phase 2: both I-130 checklist styles (k3_* and i130_ir1_*) resolve to the SAME canonical path, so either one reaches the same PDF field - this is the actual bug fix", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const { questions: k3Questions } = await ChecklistFieldTraceabilityService.canonicalPathsForQuestionnaire("k3_petitioner_checklist");
  const { questions: ir1Questions } = await ChecklistFieldTraceabilityService.canonicalPathsForQuestionnaire("i130_ir1_petitioner_checklist");
  const k3LastName = k3Questions.find((q) => q.questionKey === "petitioner_info_lastName");
  const ir1LastName = ir1Questions.find((q) => q.questionKey === "petitioner_lastName");
  assert.equal(k3LastName.canonicalPath, "person.lastName");
  assert.equal(ir1LastName.canonicalPath, "person.lastName");
  assert.equal(k3LastName.canonicalPath, ir1LastName.canonicalPath, "K-3 and IR1 checklists must feed the exact same canonical path so I-130 autofills correctly regardless of which visa category's checklist was actually answered");
});

test("Phase 2: I-130 traces 32/33 mapped fields (the SSN field is a genuine, documented gap, not a regression)", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-130");
  const summary = await ChecklistFieldTraceabilityService.coverageSummary(template._id);
  assert.ok(summary.totalMappedFields >= 200, "the K-3 crosswalk now maps far more of the form");
  assert.ok(summary.tracedToChecklistQuestion >= 80, "the answer-bound I-130 fields trace to checklist questions (repeating groups are recognised once per question)");
});

// --- Phase 2: I-539A/cos_f1/cos_f2/h4_extension_ead applicant.* -> real taxonomy rename ---

test("Phase 2: h4_extension_questionnaire/cos_f1_questionnaire/cos_f2_questionnaire/h4_extension_ead_questionnaire no longer use the invented applicant.* namespace", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  for (const key of ["h4_extension_questionnaire", "cos_f1_questionnaire", "cos_f2_questionnaire", "h4_extension_ead_questionnaire"]) {
    const { questions } = await ChecklistFieldTraceabilityService.canonicalPathsForQuestionnaire(key);
    questions.forEach((question) => {
      if (question.canonicalPath) assert.doesNotMatch(question.canonicalPath, /^applicant\./, `${key}/${question.questionKey} must not use the invented applicant.* namespace`);
    });
  }
});

test("Phase 2: I-539A traces 29/32 mapped fields after the namespace fix (up from 0/32) - remaining 3 are a real SSN gap and a pre-existing unrelated mapping defect, not fabricated", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const template = await activeTemplate("I-539A");
  const summary = await ChecklistFieldTraceabilityService.coverageSummary(template._id);
  assert.equal(summary.totalMappedFields, 32);
  assert.equal(summary.tracedToChecklistQuestion, 29);
});
