const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const Case = require("../../../models/Case");
const Questionnaire = require("../../../models/Questionnaire");
const caseController = require("../case.controller");
const caseService = require("../case.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const addressChangeService = require("../../canonical/services/AddressChangeService");
const canonicalSyncService = require("../../canonical/services/CanonicalSyncService");

// Optional "Change of Address" (AR-11) component - attachable to any of the
// six participant roles, gated on explicit Case Manager add + approve (not
// auto-approved on client submission). Fully mocked, no real DB connection,
// mirroring n400ProcessApproval.test.js's/n600ProcessApproval.test.js's own
// established convention - here approveResponse/syncCase (both heavy,
// already-tested-elsewhere functions) are mocked directly rather than
// re-exercising their internals, so this test focuses purely on this
// controller's own orchestration/dedup/guard logic.

function fakeQuestionnaire(key) {
  return { _id: new mongoose.Types.ObjectId(), key, checklistRole: "client", status: "active", isActive: true, latestVersion: true };
}
const fakeUser = { _id: new mongoose.Types.ObjectId(), role: "case_manager" };

function mockRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function fakeCase(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    visaType: "H-1B",
    changeOfAddressComponents: [],
    questionnaireReferences: [],
    save: async () => {},
    ...overrides,
  };
}

test("addChangeOfAddress rejects an invalid targetRole", async (t) => {
  t.after(() => mock.restoreAll());
  const req = { params: { id: new mongoose.Types.ObjectId() }, body: { targetRole: "attorney" }, user: fakeUser };
  const res = mockRes();
  await caseController.addChangeOfAddress(req, res, (err) => { throw err; });
  assert.equal(res.statusCode, 400);
});

test("addChangeOfAddress attaches the checklist for the given role and creates one component entry", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  const questionnaire = fakeQuestionnaire("change_of_address_person_checklist");
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  mock.method(Questionnaire, "findOne", () => ({ sort: async () => questionnaire }));
  const assignCalls = [];
  mock.method(questionnaireService, "assignQuestionnaire", async (...args) => { assignCalls.push(args); return {}; });

  const req = { params: { id: caseData._id }, body: { targetRole: "employee" }, user: fakeUser };
  const res = mockRes();
  await caseController.addChangeOfAddress(req, res, (err) => { throw err; });

  assert.equal(assignCalls.length, 1);
  const [, payload] = assignCalls[0];
  assert.equal(payload.targetRole, "employee");
  assert.equal(caseData.changeOfAddressComponents.length, 1);
  assert.equal(caseData.changeOfAddressComponents[0].targetRole, "employee");
  assert.equal(caseData.changeOfAddressComponents[0].status, "added");
});

test("adding Change of Address twice for the SAME role does not create a duplicate component or re-assign the questionnaire", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  const questionnaire = fakeQuestionnaire("change_of_address_person_checklist");
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  mock.method(Questionnaire, "findOne", () => ({ sort: async () => questionnaire }));
  let assignCallCount = 0;
  mock.method(questionnaireService, "assignQuestionnaire", async () => { assignCallCount += 1; return {}; });

  const req = { params: { id: caseData._id }, body: { targetRole: "employee" }, user: fakeUser };
  await caseController.addChangeOfAddress(req, mockRes(), (err) => { throw err; });
  await caseController.addChangeOfAddress(req, mockRes(), (err) => { throw err; });

  assert.equal(assignCallCount, 1, "must not re-assign the questionnaire on a repeat add");
  assert.equal(caseData.changeOfAddressComponents.length, 1, "must not create a duplicate component");
});

test("adding Change of Address for a DIFFERENT role on the same case creates a second, independent component", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  const personQuestionnaire = fakeQuestionnaire("change_of_address_person_checklist");
  const employerQuestionnaire = fakeQuestionnaire("change_of_address_employer_checklist");
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  mock.method(Questionnaire, "findOne", (query) => ({
    sort: async () => (query.key === "change_of_address_employer_checklist" ? employerQuestionnaire : personQuestionnaire),
  }));
  mock.method(questionnaireService, "assignQuestionnaire", async () => ({}));

  await caseController.addChangeOfAddress({ params: { id: caseData._id }, body: { targetRole: "employee" }, user: fakeUser }, mockRes(), (err) => { throw err; });
  await caseController.addChangeOfAddress({ params: { id: caseData._id }, body: { targetRole: "employer" }, user: fakeUser }, mockRes(), (err) => { throw err; });

  assert.equal(caseData.changeOfAddressComponents.length, 2);
  assert.deepEqual(caseData.changeOfAddressComponents.map((c) => c.targetRole).sort(), ["employee", "employer"]);
});

test("approveChangeOfAddress returns 409 if the client has not submitted yet", async (t) => {
  t.after(() => mock.restoreAll());
  const componentId = new mongoose.Types.ObjectId();
  const questionnaireId = new mongoose.Types.ObjectId();
  const caseData = fakeCase({
    changeOfAddressComponents: [{ _id: componentId, targetRole: "employee", questionnaireId, status: "added" }],
    questionnaireReferences: [{ questionnaireId, targetRole: "employee", responseId: "resp-1", status: "not_started" }],
  });
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);

  const req = { params: { id: caseData._id, componentId }, user: fakeUser };
  const res = mockRes();
  await caseController.approveChangeOfAddress(req, res, (err) => { throw err; });
  assert.equal(res.statusCode, 409);
});

test("approveChangeOfAddress: captures outgoing address, approves the response, re-syncs canonical data, and marks the component approved (submitted response)", async (t) => {
  t.after(() => mock.restoreAll());
  const componentId = new mongoose.Types.ObjectId();
  const questionnaireId = new mongoose.Types.ObjectId();
  const caseData = fakeCase({
    changeOfAddressComponents: [{ _id: componentId, targetRole: "employee", questionnaireId, status: "added" }],
    questionnaireReferences: [{ questionnaireId, targetRole: "employee", responseId: "resp-1", status: "submitted" }],
  });
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  const captureCalls = [];
  mock.method(addressChangeService, "captureOutgoingAddress", async (...args) => { captureCalls.push(args); return {}; });
  const approveCalls = [];
  mock.method(questionnaireService, "approveResponse", async (...args) => { approveCalls.push(args); return []; });
  const syncCalls = [];
  mock.method(canonicalSyncService, "syncCase", async (...args) => { syncCalls.push(args); return {}; });

  const req = { params: { id: caseData._id, componentId }, user: fakeUser };
  const res = mockRes();
  await caseController.approveChangeOfAddress(req, res, (err) => { throw err; });

  assert.equal(res.body.success, true);
  assert.equal(captureCalls.length, 1);
  assert.equal(captureCalls[0][1].targetRole, "employee");
  assert.equal(approveCalls.length, 1);
  assert.equal(approveCalls[0][0], "resp-1");
  assert.equal(syncCalls.length, 1);
  const updated = caseData.changeOfAddressComponents.find((c) => String(c._id) === String(componentId));
  assert.equal(updated.status, "approved");
  assert.ok(updated.approvedAt);
});

test("approveChangeOfAddress: capture-outgoing-address runs BEFORE approveResponse/syncCase overwrite the canonical value", async (t) => {
  t.after(() => mock.restoreAll());
  const componentId = new mongoose.Types.ObjectId();
  const questionnaireId = new mongoose.Types.ObjectId();
  const caseData = fakeCase({
    changeOfAddressComponents: [{ _id: componentId, targetRole: "beneficiary", questionnaireId, status: "added" }],
    questionnaireReferences: [{ questionnaireId, targetRole: "beneficiary", responseId: "resp-2", status: "completed" }],
  });
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  const order = [];
  mock.method(addressChangeService, "captureOutgoingAddress", async () => { order.push("capture"); return {}; });
  mock.method(questionnaireService, "approveResponse", async () => { order.push("approve"); return []; });
  mock.method(canonicalSyncService, "syncCase", async () => { order.push("sync"); return {}; });

  await caseController.approveChangeOfAddress({ params: { id: caseData._id, componentId }, user: fakeUser }, mockRes(), (err) => { throw err; });

  assert.deepEqual(order, ["capture", "approve", "sync"]);
});
