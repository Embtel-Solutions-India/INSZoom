const assert = require("node:assert/strict");
const test = require("node:test");
const Client = require("../../../models/Client");
const CaseModel = require("../../../models/Case");
const Document = require("../../../models/Document");
const Answer = require("../../../models/Answer");
const caseService = require("../../cases/case.service");
const caseWorkflowAutomation = require("../../cases/case-workflow-automation.service");
const clientIntakeService = require("../client-intake.service");

// Follows this repo's established no-DB test convention (t.mock.method on
// Mongoose model/service statics — see data-rights/tests/dataRights.service.test.js
// and documents/tests/document-upload-progress.test.js). caseData is a REAL
// (unsaved) `new CaseModel(...)` instance rather than a plain object,
// because the regression this guards against is a Mongoose schema-casting
// bug that only reproduces against real schema casting: reassigning the
// whole `journeyProgress` subdocument via spread (`caseData.journeyProgress =
// {...caseData.journeyProgress, ...}`) surfaces every unset schema path
// (e.g. `nextAction`) as an explicit `undefined`, which then fails to
// re-cast against its nested-object schema — a CastError that made every
// real call to submitClientIntake throw, before the fix in this file
// mirrored the same in-place-mutation workaround saveClientIntake already
// used for the identical footgun.

function fullSectionData() {
  return {
    firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-01-01", gender: "female",
    maritalStatus: "single", countryOfBirth: "UK", countryOfCitizenship: "UK", nationality: "British",
    email: "ada@example.com", primaryPhone: "+441234567890", address: "1 Analytical Engine Way",
    city: "London", state: "LDN", zipCode: "EC1A", country: "UK",
    passportNumber: "X1234567", passportCountry: "UK", passportExpirationDate: "2030-01-01",
    addressHistory: [{ address: "1 Analytical Engine Way" }],
    employmentHistory: [{ employer: "Acme Corp", title: "Engineer" }],
    educationHistory: [{ school: "MIT", degree: "BSc" }],
    currentVisaStatus: "F-1", immigrationStatus: "F-1 Student", immigrationHistory: [{ status: "F-1" }],
    travelHistory: [{ country: "France" }],
    children: [{ name: "N/A" }],
    emergencyName: "Charles Babbage", emergencyRelation: "Friend", emergencyPhone: "+441111111111",
    criminalRecord: "no", visaDenial: "no", deportation: "no", priorApplications: "no", declaration: true,
  };
}

function fakeClient(user) {
  return {
    _id: "client-1",
    user: user._id,
    fullName: "Ada Lovelace",
    intakeSubmission: { status: "draft", version: 1 },
    timeline: [],
    activityHistory: [],
    auditHistory: [],
    ...fullSectionData(),
    save: async function save() { return this; },
    toObject: function toObject() { return { ...this }; },
  };
}

test("submitClientIntake does not throw when writing journeyProgress on a real Mongoose Case document (regression: whole-object reassignment CastError)", async (t) => {
  const user = { _id: "user-1", role: "client" };
  const client = fakeClient(user);
  t.mock.method(Client, "findOne", async () => client);
  // buildIntakePayload (called at the end of submitClientIntake) chains
  // .sort().lean() on the same Document.find() call calculateProgress uses
  // for .distinct() — one fake needs to satisfy both call shapes.
  t.mock.method(Document, "find", () => ({ distinct: async () => [], sort: () => ({ lean: async () => [] }) }));
  t.mock.method(Answer, "find", () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }));
  t.mock.method(caseWorkflowAutomation, "runPostClientSubmission", async () => ({}));

  const caseDoc = new CaseModel({
    caseNumber: "CASE-TEST-1",
    visaType: "H-1B",
    user: user._id,
    documentChecklist: [],
    questionnaireData: { progress: { completionPercentage: 100 } },
  });
  caseDoc.save = async function save() { return this; };
  t.mock.method(caseService, "getAccessibleCaseOrThrow", async () => caseDoc);

  const result = await clientIntakeService.submitClientIntake({ user, caseId: "case-1", req: {} });

  assert.equal(result.submission.status, "submitted");
  assert.equal(result.progress.overall, 100);
  // The regression itself: journeyProgress.metrics got set via in-place
  // mutation (not a whole-object reassignment) without a CastError, and the
  // rest of the subdocument's schema-defaulted fields (e.g. currentMilestone)
  // survived untouched — proving this write no longer clobbers them.
  assert.ok(caseDoc.journeyProgress.currentMilestone);
  assert.equal(caseDoc.journeyProgress.metrics.intake.overall, 100);
});

test("saveClientIntake rejects further edits once intake is already submitted (editing locked post-submit)", async (t) => {
  const user = { _id: "user-1", role: "client" };
  const client = { _id: "client-1", user: user._id, intakeSubmission: { status: "submitted" } };
  t.mock.method(Client, "findOne", async () => client);
  const caseDoc = { _id: "case-1", user: user._id };
  t.mock.method(caseService, "getAccessibleCaseOrThrow", async () => caseDoc);

  await assert.rejects(
    () => clientIntakeService.saveClientIntake({ user, caseId: "case-1", payload: { data: { firstName: "Changed" } }, req: {}, autoSave: false }),
    (error) => error.statusCode === 403
  );
});
