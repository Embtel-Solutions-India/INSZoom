const assert = require("node:assert/strict");
const test = require("node:test");
const CaseForm = require("../../../models/CaseForm");
const InteractiveFormReviewService = require("../interactive-form-review.service");

test("interactive review permissions enforce role-specific capabilities", () => {
  const caseManager = InteractiveFormReviewService.permissions({ role: "case_manager" });
  const teamLead = InteractiveFormReviewService.permissions({ role: "team_lead" });
  const attorney = InteractiveFormReviewService.permissions({ role: "attorney" });
  const client = InteractiveFormReviewService.permissions({ role: "client" });
  const employee = InteractiveFormReviewService.permissions({ role: "employee" });

  assert.equal(caseManager.canEdit, true);
  assert.equal(caseManager.canApprove, false);
  assert.equal(teamLead.canReview, true);
  assert.equal(teamLead.canEdit, true);
  assert.equal(teamLead.canApprove, true);
  // updated: attorney review/approval authority removed (attorney collaboration descoped) —
  // approval now rests with admin/team_lead only.
  assert.equal(attorney.canApprove, false);
  assert.equal(attorney.canLock, false);
  assert.equal(client.readOnly, true);
  assert.equal(client.canReview, false);
  assert.equal(employee.canEdit, false);
  assert.equal(employee.canReview, false);
});

test("field review view includes canonical comparison, evidence, and conflicts", () => {
  const field = {
    fieldName: "part1.firstName",
    label: "Given Name",
    mapping: { source: "person.firstName" },
  };
  const caseForm = {
    fieldValues: { part1: { firstName: "Jon" } },
    sourceAttribution: {
      "part1.firstName": {
        source: "Passport OCR",
        sourceField: "person.firstName",
        confidence: 91,
        sourceDocumentId: "document-1",
      },
    },
    manualOverrides: {},
    fieldReviews: {},
    fieldHistory: [],
  };
  const canonicalState = {
    profile: { person: { firstName: "John" } },
    conflicts: [{ path: "person.firstName", candidates: ["John", "Jon"] }],
  };
  const documents = [{ _id: "document-1", originalName: "passport.pdf", tags: [] }];

  const view = InteractiveFormReviewService.buildFieldView(field, caseForm, canonicalState, documents);
  assert.equal(view.value, "Jon");
  assert.equal(view.canonicalValue, "John");
  assert.equal(view.source, "Passport OCR");
  assert.equal(view.confidence, 91);
  assert.equal(view.conflicts.length, 1);
  assert.equal(view.documents[0].originalName, "passport.pdf");
});

test("Phase 3 §I.2: buildFieldView surfaces a CONFLICT sync state and both conflict values", () => {
  const field = { fieldName: "part1.lastName", label: "Last Name" };
  const caseForm = {
    fieldValues: { "part1.lastName": "Smith" },
    sourceAttribution: {
      "part1.lastName": {
        source: "canonical",
        sourceField: "person.lastName",
        syncState: "CONFLICT",
        conflictCanonicalValue: "Johnson",
        conflictManualValue: "Smith",
      },
    },
    manualOverrides: { "part1.lastName": { value: "Smith" } },
    fieldReviews: {},
    fieldHistory: [],
  };
  const view = InteractiveFormReviewService.buildFieldView(field, caseForm, { profile: {}, conflicts: [] }, []);
  assert.equal(view.syncState, "CONFLICT");
  assert.deepEqual(view.conflictValues, { canonicalValue: "Johnson", manualValue: "Smith" });
});

test("Phase 3 §I.2: buildFieldView reports MANUAL_OVERRIDE/SYNCED from an explicit syncState marker", () => {
  const field = { fieldName: "part1.firstName", label: "First Name" };
  const manualOverrideForm = {
    fieldValues: { "part1.firstName": "Ada" },
    sourceAttribution: { "part1.firstName": { syncState: "MANUAL_OVERRIDE" } },
    manualOverrides: {},
    fieldReviews: {},
    fieldHistory: [],
  };
  const syncedForm = {
    fieldValues: { "part1.firstName": "Ada" },
    sourceAttribution: { "part1.firstName": { syncState: "SYNCED" } },
    manualOverrides: {},
    fieldReviews: {},
    fieldHistory: [],
  };
  assert.equal(InteractiveFormReviewService.buildFieldView(field, manualOverrideForm, {}, []).syncState, "MANUAL_OVERRIDE");
  assert.equal(InteractiveFormReviewService.buildFieldView(field, syncedForm, {}, []).syncState, "SYNCED");
  assert.equal(InteractiveFormReviewService.buildFieldView(field, syncedForm, {}, []).conflictValues, undefined);
});

test("Phase 3 §I.2: buildFieldView falls back to MANUAL_OVERRIDE for a pre-Phase-2 CaseForm with no syncState marker", () => {
  const field = { fieldName: "part1.middleName", label: "Middle Name" };
  const preExistingOverrideForm = {
    fieldValues: { "part1.middleName": "Lovelace" },
    sourceAttribution: { "part1.middleName": { source: "AttorneyOverride" } }, // no syncState key at all
    manualOverrides: { "part1.middleName": { value: "Lovelace" } },
    fieldReviews: {},
    fieldHistory: [],
  };
  const neverOverriddenForm = {
    fieldValues: { "part1.middleName": "Lovelace" },
    sourceAttribution: {},
    manualOverrides: {},
    fieldReviews: {},
    fieldHistory: [],
  };
  assert.equal(InteractiveFormReviewService.buildFieldView(field, preExistingOverrideForm, {}, []).syncState, "MANUAL_OVERRIDE");
  assert.equal(InteractiveFormReviewService.buildFieldView(field, neverOverriddenForm, {}, []).syncState, "SYNCED");
});

test("CaseForm supports the complete interactive review lifecycle", () => {
  const statusEnum = CaseForm.schema.path("status").enumValues;
  // updated: attorney_review status removed (attorney collaboration descoped) —
  // under_review now covers that stage of the review lifecycle.
  assert.ok(statusEnum.includes("under_review"));
  assert.ok(statusEnum.includes("needs_revision"));
  assert.ok(statusEnum.includes("ready_for_pdf"));
  assert.ok(statusEnum.includes("filed"));
  assert.ok(CaseForm.schema.path("fieldHistory"));
  assert.ok(CaseForm.schema.path("comments"));
  assert.ok(CaseForm.schema.path("reviewTasks"));
});

// --- P1 viewer rendering (RC1 backend): viewerPageConstraint.pageMap ---
// The component viewer PDF is an Adobe-sliced copy renumbered 1..N, so the
// frontend needs slot -> parentPage to never request a parent page number
// from an N-page document.
const I129_TEMPLATE = { _id: "tpl-1", formCode: "I-129", pdfMetadata: { pageCount: 38 } };

test("P1: component constraint maps each slice slot to its parent page", async () => {
  const constraint = await InteractiveFormReviewService.resolveViewerPageConstraint({
    caseForm: { _id: "cf-1", componentCode: "I129_H_1B_DATA_COLLECTION_AND" },
    template: I129_TEMPLATE,
    findComponentDef: async () => ({ pageRanges: [{ startPage: 21, endPage: 23 }] }),
  });
  assert.equal(constraint.type, "component");
  assert.equal(constraint.pdfSource, "component");
  assert.deepEqual(constraint.pages, [21, 22, 23]);
  assert.deepEqual(constraint.pageMap, [
    { slot: 1, parentPage: 21 },
    { slot: 2, parentPage: 22 },
    { slot: 3, parentPage: 23 },
  ]);
  assert.equal(constraint.expectedPdfPageCount, 3);
});

test("P1: core constraint is an identity subset over the full parent PDF", async () => {
  const constraint = await InteractiveFormReviewService.resolveViewerPageConstraint({
    caseForm: { _id: "cf-core", componentCode: null },
    template: I129_TEMPLATE,
    resolveCorePages: async () => [1, 2, 3, 4, 5, 6, 7, 8],
  });
  assert.equal(constraint.type, "core");
  assert.equal(constraint.pdfSource, "full");
  assert.deepEqual(constraint.pageMap.map((entry) => entry.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(constraint.pageMap.every((entry) => entry.slot === entry.parentPage));
  assert.equal(constraint.expectedPdfPageCount, 38);
});

test("P1: a form with no core subset gets a full identity map", async () => {
  const constraint = await InteractiveFormReviewService.resolveViewerPageConstraint({
    caseForm: { _id: "cf-i539", componentCode: null },
    template: { _id: "tpl-539", formCode: "I-539", pdfMetadata: { pageCount: 3 } },
    resolveCorePages: async () => null,
  });
  assert.equal(constraint.type, "full");
  assert.deepEqual(constraint.pageMap, [
    { slot: 1, parentPage: 1 },
    { slot: 2, parentPage: 2 },
    { slot: 3, parentPage: 3 },
  ]);
  assert.equal(constraint.expectedPdfPageCount, 3);
});

test("P1: missing pdfMetadata.pageCount falls back to formLayout/formFields page count", async () => {
  assert.equal(InteractiveFormReviewService.resolveTemplatePageCount({ formLayout: { pages: new Array(38).fill({}) } }), 38);
  assert.equal(InteractiveFormReviewService.resolveTemplatePageCount({ formStructure: { pages: [{}, {}] } }), 2);
  assert.equal(InteractiveFormReviewService.resolveTemplatePageCount({ formFields: [{ pageNumber: 4 }, { pageNumber: 12 }] }), 12);

  const constraint = await InteractiveFormReviewService.resolveViewerPageConstraint({
    caseForm: { _id: "cf-2", componentCode: "I129_H_CLASSIFICATION_SUPPLEM" },
    template: { _id: "tpl-1", formCode: "I-129", formLayout: { pages: new Array(38).fill({}) } },
    findComponentDef: async () => ({ pageRanges: [{ startPage: 13, endPage: 20 }] }),
  });
  assert.equal(constraint.type, "component");
  assert.equal(constraint.pages.length, 8);
  assert.equal(constraint.pageMap[0].parentPage, 13);
});

test("P1: a component constraint failure never degrades to the full parent PDF", async () => {
  const constraint = await InteractiveFormReviewService.resolveViewerPageConstraint({
    caseForm: { _id: "cf-3", componentCode: "I129_H_CLASSIFICATION_SUPPLEM" },
    template: I129_TEMPLATE,
    findComponentDef: async () => null,
  });
  assert.equal(constraint.type, "component");
  assert.equal(constraint.pdfSource, "component");
  assert.equal(constraint.pages, null);
  assert.equal(constraint.pageMap, null);
  assert.equal(constraint.error.code, "COMPONENT_DEFINITION_NOT_FOUND");
});

// P2 RC7: updateProgress used to pass caseForm.fieldValues (keyed by the
// normalized fieldId, e.g. "part1.line1Name0") straight into
// calculateCompletion, which reads each field by its raw AcroForm
// field.fieldName (e.g. "form1[0].#subform[0].Line1_Name[0]") - the two
// namespaces never match, so every required field always counted as
// missing. mergeFieldValues (the same translation renderCaseForm's viewer
// already uses) must run first. These fixtures use a non-component
// (componentCode: null) CaseForm so resolveComponentFieldIds short-circuits
// without touching the DB - see its own null-return contract above.
const RC7_TEMPLATE = {
  formCode: "P2-RC7-TEST",
  formFields: [
    { fieldId: "part1.line1Name0", fieldName: "form1[0].#subform[0].Line1_Name[0]", required: true, sectionKey: "part1" },
    { fieldId: "part1.line2Name0", fieldName: "form1[0].#subform[0].Line2_Name[0]", required: true, sectionKey: "part1" },
  ],
};

test("P2 RC7: updateProgress resolves 100% completion when required fields are filled via fieldId-keyed fieldValues", async () => {
  const caseForm = {
    componentCode: null,
    fieldValues: {
      "part1.line1Name0": "Smith",
      "part1.line2Name0": "John",
    },
    filledData: {},
  };
  const progress = await InteractiveFormReviewService.updateProgress(caseForm, RC7_TEMPLATE);
  assert.equal(progress.completion.missingRequiredFields, 0, "both required fields have values under their fieldId keys and must count as filled");
  assert.equal(progress.completion.percent, 100);
  assert.equal(Object.keys(progress.validationErrors).length, 0, "no field should show a false 'Required' error");
});

test("P2 RC7: updateProgress reports every required field missing only when fieldValues is genuinely empty", async () => {
  const caseForm = { componentCode: null, fieldValues: {}, filledData: {} };
  const progress = await InteractiveFormReviewService.updateProgress(caseForm, RC7_TEMPLATE);
  assert.equal(progress.completion.missingRequiredFields, 2);
  assert.equal(progress.completion.percent, 0);
});

test("P2 RC7: updateProgress mutates caseForm.completion/sectionProgress/validationErrors in place", async () => {
  const caseForm = { componentCode: null, fieldValues: { "part1.line1Name0": "Smith" }, filledData: {}, validationErrors: { populationWarnings: [] } };
  await InteractiveFormReviewService.updateProgress(caseForm, RC7_TEMPLATE);
  assert.equal(caseForm.completion.missingRequiredFields, 1);
  assert.equal(caseForm.completion.completedFields, 1);
  assert.ok(caseForm.sectionProgress.part1);
  // Existing validationErrors keys (e.g. populationWarnings from autofill)
  // must survive - updateProgress only ever adds/replaces the `fields` key.
  assert.deepEqual(caseForm.validationErrors.populationWarnings, []);
  assert.ok(caseForm.validationErrors.fields["form1[0].#subform[0].Line2_Name[0]"]);
});
