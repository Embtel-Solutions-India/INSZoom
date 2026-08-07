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
